#!/usr/bin/env node
/*
 * Build-time aggregator.
 *
 * Reads the harvester's single normalized dataset (ticket #8 — data/telemetry-runs.json,
 * one row per run) and rolls it up into the small shapes the dashboard charts consume.
 * The harvester is the source of truth: we do NOT recompute cost or cycle counts here,
 * we only SUM and COUNT the fields it already emitted. Missing fields degrade to skips,
 * never a crash — matching the harvester's own fail-soft contract.
 *
 * Output: src/generated/metrics.json  (tiny, committed alongside the build so the
 * static site never ships the ~800KB raw dataset to the browser).
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPublicText } from "./lib/privacy-scan.mjs";
import { harvestTasks } from "./harvest/tasks.mjs";
import { harvestWorkers } from "./harvest/workers.mjs";
import { harvestSpend } from "./harvest/spend.mjs";
import { harvestBrowser } from "./harvest/browser.mjs";
import { harvestQuick } from "./harvest/quick.mjs";
import { harvestMemory } from "./harvest/memory.mjs";
import { harvestRoutines } from "./harvest/routines.mjs";
import { harvestLogs } from "./harvest/logs.mjs";
import { harvestDaemon } from "./harvest/daemon.mjs";
import { harvestActivity } from "./harvest/activity.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SRC = process.env.TELEMETRY_DATASET
  ? resolve(process.env.TELEMETRY_DATASET)
  : resolve(REPO_ROOT, "data", "telemetry-runs.json");
const CODE_STATS_SRC = process.env.CODE_STATS_DATASET
  ? resolve(process.env.CODE_STATS_DATASET)
  : resolve(REPO_ROOT, "data", "code-stats.json");
const CLAUDE_SESSIONS_SRC = process.env.CLAUDE_SESSIONS_DATASET
  ? resolve(process.env.CLAUDE_SESSIONS_DATASET)
  : resolve(REPO_ROOT, "data", "claude-sessions.json");
const OUT = resolve(__dirname, "..", "src", "generated", "metrics.json");
const RECALL_SRC = process.env.RECALL_EVAL_DATASET
  ? resolve(process.env.RECALL_EVAL_DATASET)
  : resolve(REPO_ROOT, "data", "recall-eval.json");
const RECALL_OUT = resolve(__dirname, "..", "src", "generated", "recall.json");

// Display label + categorical palette slot per model. Colour follows the model
// FAMILY, not the row's rank, so opus is the same hue in the cost panel, the
// wall-clock panel and the session split — and stays that hue when a filter or a
// new release changes the running order. Slot names are the palette tokens in
// src/index.css; an unrecognised family falls through to the muted role rather
// than borrowing a family's hue.
const MODEL_META = {
  "claude-opus-4-8": { label: "opus-4.8", color: "rose" },
  "claude-sonnet-5": { label: "sonnet-5", color: "indigo" },
  "claude-haiku-4-5-20251001": { label: "haiku-4.5", color: "moss" },
  "claude-fable-5": { label: "fable-5", color: "violet" },
  "gpt-5.6-terra": { label: "terra", color: "gold" },
  "gpt-5.6-luna": { label: "luna", color: "teal" },
};
const MODEL_FAMILY = [
  [/opus/i, "rose"],
  [/sonnet/i, "indigo"],
  [/haiku/i, "moss"],
  [/fable/i, "violet"],
  [/terra|^gpt/i, "gold"],
  [/luna/i, "teal"],
];

function metaFor(model) {
  if (MODEL_META[model]) return MODEL_META[model];
  const short = model.replace(/^claude-/, "").replace(/^gpt-/, "gpt-");
  const family = MODEL_FAMILY.find(([re]) => re.test(model));
  return { label: short, color: family ? family[1] : "muted" };
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v) => (typeof v === "string" ? v : null);
const nonNegative = (v) => Math.max(0, num(v) ?? 0);
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

// This is public data. Git author names occasionally carry "Name <email>" and a malformed
// source must not be able to put a home-directory path into the deployed document either.
function publicLabel(value, fallback = "unknown") {
  const cleaned = (text(value) ?? "").replace(/\s*<[^>]*>/g, "").replace(EMAIL, "").trim();
  return cleaned || fallback;
}

function publicRepo(value) {
  const label = publicLabel(value);
  return basename(label.replace(/\\/g, "/")) || "unknown";
}

// Publish-time gate: the shared privacy scanner is the single source of truth for what may not
// appear in a public document (emails, paths, Discord ids/usernames/content, memory bodies,
// secrets). The runtime verify-public-metrics.mjs re-runs the identical check on the copied file.
function assertPublicJson(value) {
  assertPublicText(JSON.stringify(value), "generated metrics");
}

// The code-stats harvester owns these aggregates. This projection only removes local paths
// before publishing the same static JSON document the dashboard already imports.
function codeStatsForDashboard(raw) {
  const empty = {
    source_generated_at: null,
    headline: { commits: 0, files: 0, projects: 0, additions: 0, deletions: 0, net: 0 },
    projects: [], authors: [], velocity: [],
  };
  if (!raw || typeof raw !== "object") return empty;
  const headline = raw.headline && typeof raw.headline === "object" ? raw.headline : {};
  return {
    source_generated_at: text(raw.generated_at),
    headline: {
      commits: nonNegative(headline.commits), files: nonNegative(headline.files), projects: nonNegative(headline.projects),
      additions: nonNegative(headline.additions), deletions: nonNegative(headline.deletions), net: num(headline.net) ?? 0,
    },
    projects: Array.isArray(raw.projects) ? raw.projects.filter((p) => p && typeof p === "object").map((p) => ({
      repo: publicRepo(p.repo), commits: nonNegative(p.commits), files: nonNegative(p.files),
      additions: nonNegative(p.additions), deletions: nonNegative(p.deletions), net: num(p.net) ?? 0,
      first_commit: text(p.first_commit), last_commit: text(p.last_commit),
    })) : [],
    // Personal emails never ship — this is a public marketing site. Keep display names and
    // counts only; both historical author shapes are scrubbed before choosing a label.
    authors: Array.isArray(raw.authors) ? raw.authors.filter((a) => a && typeof a === "object").map((a) => ({
      name: publicLabel(a.name ?? a.author),
      commits: nonNegative(a.commits), additions: nonNegative(a.additions), deletions: nonNegative(a.deletions), net: num(a.net) ?? 0,
    })) : [],
    velocity: Array.isArray(raw.velocity) ? raw.velocity.filter((v) => v && typeof v === "object" && text(v.date)).map((v) => ({
      date: v.date, commits: nonNegative(v.commits),
    })) : [],
  };
}

// ── Claude Code session analytics (#2) ────────────────────────────────────
// The harvester (scripts/harvest/claude-sessions.ts) already emits nothing but per-session
// counts/enums keyed by a salted session-id hash — this projection just rolls those rows into
// the four-ish small aggregate shapes the dashboard charts consume. Same fail-soft contract as
// codeStatsForDashboard: a missing/malformed source degrades to an empty, available:false section.
const DURATION_BUCKETS = [
  { label: "<1m", max: 60 }, { label: "1-5m", max: 300 }, { label: "5-15m", max: 900 },
  { label: "15-30m", max: 1800 }, { label: "30-60m", max: 3600 }, { label: "1-3h", max: 10_800 },
  { label: "3h+", max: Infinity },
];
const TURN_BUCKETS = [
  { label: "1", max: 1 }, { label: "2-5", max: 5 }, { label: "6-15", max: 15 },
  { label: "16-40", max: 40 }, { label: "41-100", max: 100 }, { label: "100+", max: Infinity },
];
function bucketLabel(value, buckets) {
  for (const b of buckets) if (value <= b.max) return b.label;
  return buckets[buckets.length - 1].label;
}
function statsOf(values) {
  const xs = [...values].sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) return { count: 0, mean: 0, p50: 0, p90: 0, max: 0 };
  const pct = (p) => xs[Math.min(n - 1, Math.floor((p / 100) * n))];
  return {
    count: n,
    mean: round(xs.reduce((a, b) => a + b, 0) / n, 1),
    p50: round(pct(50), 1),
    p90: round(pct(90), 1),
    max: round(xs[n - 1], 1),
  };
}
function fillDaysFromCounts(perDay) {
  const days = [...perDay.keys()].sort();
  if (days.length === 0) return [];
  const start = new Date(`${days[0]}T00:00:00Z`);
  const end = new Date(`${days[days.length - 1]}T00:00:00Z`);
  const out = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, count: perDay.get(key) ?? 0 });
  }
  return out;
}

function claudeSessionsForDashboard(raw) {
  const empty = {
    available: false, total: 0, byClassification: [], sessionsOverTime: [], toolCallMix: [],
    durationBuckets: [], turnBuckets: [], duration: { count: 0, mean: 0, p50: 0, p90: 0, max: 0 },
    turns: { count: 0, mean: 0, p50: 0, p90: 0, max: 0 }, byModel: [], totalCost: null,
    errorCount: 0, permissionDenials: 0,
  };
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.sessions) || raw.sessions.length === 0) return empty;

  const sessions = raw.sessions.filter((s) => s && typeof s === "object");
  const byClassification = new Map();
  const byDay = new Map();
  const toolMix = new Map();
  const durationBuckets = new Map();
  const turnBuckets = new Map();
  const byModel = new Map();
  const durations = [];
  const turnsArr = [];
  let totalCost = 0;
  let anyCost = false;
  let errorCount = 0;
  let permissionDenials = 0;

  for (const s of sessions) {
    const cls = text(s.classification) || "other";
    byClassification.set(cls, (byClassification.get(cls) ?? 0) + 1);

    const startHour = text(s.start_hour);
    if (startHour && startHour.length >= 10) {
      const day = startHour.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }

    const toolCounts = s.tool_calls_by_name && typeof s.tool_calls_by_name === "object" ? s.tool_calls_by_name : {};
    for (const [tool, count] of Object.entries(toolCounts)) {
      const label = publicLabel(tool, "unknown");
      toolMix.set(label, (toolMix.get(label) ?? 0) + nonNegative(count));
    }

    const dur = nonNegative(s.duration_seconds);
    durations.push(dur);
    const db = bucketLabel(dur, DURATION_BUCKETS);
    durationBuckets.set(db, (durationBuckets.get(db) ?? 0) + 1);

    const turns = nonNegative(s.turns);
    turnsArr.push(turns);
    const tb = bucketLabel(turns, TURN_BUCKETS);
    turnBuckets.set(tb, (turnBuckets.get(tb) ?? 0) + 1);

    const model = text(s.model);
    if (model) {
      const agg = byModel.get(model) ?? { sessions: 0, tokens: 0 };
      agg.sessions += 1;
      const tok = s.tokens && typeof s.tokens === "object" ? s.tokens : {};
      agg.tokens += nonNegative(tok.input) + nonNegative(tok.output) + nonNegative(tok.cache_read) + nonNegative(tok.cache_write);
      byModel.set(model, agg);
    }

    const cost = num(s.cost_usd);
    if (cost !== null) { totalCost += cost; anyCost = true; }
    errorCount += nonNegative(s.error_count);
    permissionDenials += nonNegative(s.permission_denials);
  }

  return {
    available: true,
    total: sessions.length,
    byClassification: [...byClassification.entries()].sort((a, b) => b[1] - a[1]).map(([classification, count]) => ({ classification, count })),
    sessionsOverTime: fillDaysFromCounts(byDay),
    toolCallMix: [...toolMix.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([tool, count]) => ({ tool, count })),
    durationBuckets: DURATION_BUCKETS.map((b) => ({ label: b.label, count: durationBuckets.get(b.label) ?? 0 })),
    turnBuckets: TURN_BUCKETS.map((b) => ({ label: b.label, count: turnBuckets.get(b.label) ?? 0 })),
    duration: statsOf(durations),
    turns: statsOf(turnsArr),
    byModel: [...byModel.entries()].sort((a, b) => b[1].sessions - a[1].sessions).map(([model, agg]) => {
      const meta = metaFor(model);
      return { model, label: meta.label, color: meta.color, sessions: agg.sessions, tokens: agg.tokens };
    }),
    totalCost: anyCost ? round(totalCost, 2) : null,
    errorCount,
    permissionDenials,
  };
}

function main() {
  let raw;
  try {
    raw = JSON.parse(readFileSync(SRC, "utf8"));
  } catch (err) {
    console.error(`[prepare-data] cannot read dataset at ${SRC}: ${err.message}`);
    process.exit(1);
  }

  let rawCodeStats = null;
  try { rawCodeStats = JSON.parse(readFileSync(CODE_STATS_SRC, "utf8")); }
  catch (err) { console.error(`[prepare-data] code-stats dataset unavailable at ${CODE_STATS_SRC}: ${err.message}; emitting empty code stats`); }

  let rawClaudeSessions = null;
  try { rawClaudeSessions = JSON.parse(readFileSync(CLAUDE_SESSIONS_SRC, "utf8")); }
  catch (err) { console.error(`[prepare-data] claude-sessions dataset unavailable at ${CLAUDE_SESSIONS_SRC}: ${err.message}; emitting empty claude sessions`); }

  const runs = Array.isArray(raw.runs) ? raw.runs : [];
  // The harvester excludes sessions it cannot price, but makes that exclusion explicit.
  // Carry the count into the public rollup so cost totals can never look complete by default.
  const unratedModelSessions = nonNegative(raw.unrated_model_sessions?.count);
  if (runs.length === 0) {
    console.error("[prepare-data] dataset has no runs — emitting empty aggregates");
  }

  const perModel = new Map(); // model -> {runs, cost, wallSeconds}
  const perDay = new Map(); // yyyy-mm-dd -> {runs, cost}
  const cyclesHist = new Map(); // cycles -> count
  const harnesses = new Map(); // harness -> count
  let totalCost = 0;
  let totalWall = 0;
  let skippedRows = 0;

  for (const r of runs) {
    if (!r || typeof r !== "object") {
      skippedRows++;
      continue;
    }
    const model = typeof r.model === "string" && r.model ? r.model : null;
    if (!model) {
      skippedRows++;
      continue;
    }
    const cost = num(r.cost_usd) ?? 0;
    const wall = num(r.wall_clock_seconds) ?? 0;

    const pm = perModel.get(model) ?? {
      runs: 0,
      cost: 0,
      wallSeconds: 0,
      estimate: false,
    };
    pm.runs += 1;
    pm.cost += cost;
    pm.wallSeconds += wall;
    if (r.rate_estimate === true) pm.estimate = true;
    perModel.set(model, pm);

    totalCost += cost;
    totalWall += wall;

    // Review-cycle histogram (integer bounces). Non-numeric → skip that axis only.
    const cyc = num(r.review_cycles);
    if (cyc !== null) {
      const key = Math.max(0, Math.round(cyc));
      cyclesHist.set(key, (cyclesHist.get(key) ?? 0) + 1);
    }

    // Runs over time, bucketed by UTC calendar day of the run's start timestamp.
    if (typeof r.timestamp === "string" && r.timestamp.length >= 10) {
      const day = r.timestamp.slice(0, 10);
      const pd = perDay.get(day) ?? { runs: 0, cost: 0 };
      pd.runs += 1;
      pd.cost += cost;
      perDay.set(day, pd);
    }

    if (typeof r.harness === "string" && r.harness) {
      harnesses.set(r.harness, (harnesses.get(r.harness) ?? 0) + 1);
    }
  }

  // Models sorted by spend (most expensive first) — the story leads with cost.
  const modelsByCost = [...perModel.entries()].sort((a, b) => b[1].cost - a[1].cost);
  const models = modelsByCost.map(([model, agg]) => {
    const meta = metaFor(model);
    return {
      model,
      label: meta.label,
      color: meta.color,
      runs: agg.runs,
      cost: round(agg.cost, 2),
      wallHours: round(agg.wallSeconds / 3600, 2),
      estimate: agg.estimate,
    };
  });

  // Fill any gap days between first and last run so the timeline reads honestly.
  const days = [...perDay.keys()].sort();
  let runsOverTime = [];
  if (days.length > 0) {
    const start = new Date(`${days[0]}T00:00:00Z`);
    const end = new Date(`${days[days.length - 1]}T00:00:00Z`);
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      const pd = perDay.get(key) ?? { runs: 0, cost: 0 };
      runsOverTime.push({ date: key, runs: pd.runs, cost: round(pd.cost, 2) });
    }
  }

  const maxCycle = cyclesHist.size ? Math.max(...cyclesHist.keys()) : 0;
  const reviewCycles = [];
  for (let c = 0; c <= maxCycle; c++) {
    reviewCycles.push({ cycles: c, label: String(c), count: cyclesHist.get(c) ?? 0 });
  }

  const harnessList = [...harnesses.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([harness, count]) => ({ harness, count }));

  const out = {
    // v2 (#100): widened data layer — tickets, workers, spend, browser, quick, memory graph,
    // routines, logs, daemon health, and recentActivity added alongside the v1 telemetry keys,
    // all of which stay byte-compatible so the live UI keeps rendering.
    schema_version: 2,
    // This timestamp belongs to the refresh/rollup, not to either source harvester. It lets
    // the runtime-fetched document state exactly how fresh the public view is.
    refreshed_at: process.env.METRICS_REFRESHED_AT ?? new Date().toISOString(),
    source_generated_at: raw.generated_at ?? null,
    rate_table_effective_date: raw.rate_table_effective_date ?? null,
    headline: {
      totalRuns: runs.length - skippedRows,
      totalSpend: round(totalCost, 2),
      totalWallHours: round(totalWall / 3600, 1),
      modelsUsed: perModel.size,
      firstRun: days[0] ?? null,
      lastRun: days[days.length - 1] ?? null,
      tasksTracked: null, // populated below
    },
    models,
    reviewCycles,
    runsOverTime,
    harnesses: harnessList,
    // Same generated metrics.json API as telemetry; populated from data/code-stats.json.
    codeStats: codeStatsForDashboard(rawCodeStats),
    notes: {
      skippedRows,
      unratedModelSessions,
      anyEstimated: models.some((m) => m.estimate),
    },
  };

  // Distinct task ids the harvester attributed to runs (for the headline strip).
  const taskIds = new Set();
  for (const r of runs) if (r && r.task_id) taskIds.add(r.task_id);
  out.headline.tasksTracked = taskIds.size;

  // ── Widened data layer (#100) ─────────────────────────────────────────────
  // Each harvester reads a live beckett state source and is individually fail-soft: a missing or
  // unreadable source yields an { available:false, ... } section rather than aborting the refresh.
  // Wrapped again here so an unexpected harvester bug can never sink the whole publish.
  const section = (name, fn, fallback) => {
    try {
      return fn();
    } catch (err) {
      console.error(`[prepare-data] ${name} harvest failed: ${err.message}; emitting empty section`);
      return fallback;
    }
  };
  out.tickets = section("tickets", harvestTasks, { available: false });
  out.workers = section("workers", harvestWorkers, { available: false });
  out.spend = section("spend", harvestSpend, { available: false });
  out.browserRuns = section("browserRuns", harvestBrowser, { available: false });
  out.quickRuns = section("quickRuns", harvestQuick, { available: false });
  out.memory = section("memory", harvestMemory, { available: false });
  out.routines = section("routines", harvestRoutines, { available: false });
  out.logs = section("logs", harvestLogs, { available: false });
  out.daemon = section("daemon", harvestDaemon, { available: false });
  out.recentActivity = section("recentActivity", () => harvestActivity(undefined, 50), []);
  out.claudeSessions = section("claudeSessions", () => claudeSessionsForDashboard(rawClaudeSessions), { available: false });

  assertPublicJson(out);
  // Size budget: the whole public document must stay small enough to swap atomically and fetch
  // on first paint. Roll up harder rather than shipping raw rows if this ever trips.
  const bytes = Buffer.byteLength(`${JSON.stringify(out, null, 2)}\n`);
  if (bytes > 250 * 1024) {
    throw new Error(`refusing to publish: metrics document is ${(bytes / 1024).toFixed(1)}KB, over the 250KB budget`);
  }
  mkdirSync(dirname(OUT), { recursive: true });
  const temporaryOut = `${OUT}.${process.pid}.tmp`;
  writeFileSync(temporaryOut, `${JSON.stringify(out, null, 2)}\n`);
  renameSync(temporaryOut, OUT);
  console.error(
    `[prepare-data] ${out.headline.totalRuns} runs · $${out.headline.totalSpend} · ` +
      `${models.length} models · ${runsOverTime.length} days · ${skippedRows} malformed · ` +
      `${unratedModelSessions} unrated → ${OUT}`
  );
}

function round(n, dp) {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

// ── Recall eval (#34.2) ────────────────────────────────────────────────────
// The recall-agent benchmark (moss retrieve → visibility gate → LLM agent) emits
// a single JSON document: aggregate scores per model seat plus a `perQuery` block
// of per-row scores tagged with their golden category. We roll that into the small
// shapes the recall charts consume — per-category P@1/P@5/MRR per seat, the aggregate
// head-to-head, and the latency comparison — the same fail-soft way as the telemetry
// rollup above. The raw dataset lives under the git-ignored data/ dir (local only);
// this projected, path-scrubbed document is what ships to the public build.

// Fixed seat presentation. luna (pi) vs haiku (claude -p); colours match the
// telemetry model palette so a reader who sees both tabs keeps one mental map.
const SEAT_META = {
  luna: { label: "luna", color: "pink" },
  haiku: { label: "haiku", color: "green" },
};
// Golden categories → short, glanceable axis labels.
const CATEGORY_LABEL = {
  feedback: "Feedback",
  "people-profile": "People",
  "project-status": "Project",
  "environment-setup": "Environment",
  adversarial: "Adversarial",
};
function categoryLabel(cat) {
  if (CATEGORY_LABEL[cat]) return CATEGORY_LABEL[cat];
  return String(cat)
    .split(/[-_]/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function recallForDashboard(raw, generatedAt) {
  const empty = {
    schema_version: 1,
    generated_at: generatedAt,
    available: false,
    corpus: { parsedNodes: 0, cliMemoryDir: null, legacyMemoryDir: null },
    queries: 0,
    models: [],
    categories: [],
    aggregate: [],
    perCategory: { precisionAt1: [], precisionAt5: [], mrr: [] },
    latency: [],
  };
  if (!raw || typeof raw !== "object" || !raw.models || !raw.perQuery) return empty;

  // Seats present in the run, in a stable presentation order (luna then haiku).
  const seats = Object.keys(SEAT_META).filter((s) => raw.models[s] && raw.perQuery[s]);
  if (seats.length === 0) return empty;

  const models = seats.map((seat) => {
    const m = raw.models[seat] ?? {};
    const meta = SEAT_META[seat];
    return {
      seat,
      model: text(m.model) ?? seat,
      label: meta.label,
      color: meta.color,
      queries: nonNegative(m.queries),
      precisionAt1: round(num(m.precisionAt1) ?? 0, 3),
      precisionAt5: round(num(m.precisionAt5) ?? 0, 3),
      mrr: round(num(m.mrr) ?? 0, 3),
      passRate: round(num(m.passRate) ?? 0, 3),
      fallbackRate: round(num(m.fallbackRate) ?? 0, 3),
      p50LatencyMs: nonNegative(m.p50LatencyMs),
      p95LatencyMs: nonNegative(m.p95LatencyMs),
    };
  });

  // Per-category means, computed from the per-query rows (the aggregate block is
  // corpus-wide only). Row scores are already 0..1 per the golden labels.
  const catOrder = [];
  const catRows = new Map(); // category -> { seat -> {p1:[], p5:[], mrr:[]} }
  for (const seat of seats) {
    const rows = Array.isArray(raw.perQuery[seat]?.rows) ? raw.perQuery[seat].rows : [];
    for (const r of rows) {
      if (!r || typeof r !== "object") continue;
      const cat = text(r.category);
      if (!cat) continue;
      if (!catRows.has(cat)) {
        catRows.set(cat, {});
        catOrder.push(cat);
      }
      const bySeat = catRows.get(cat);
      const acc = bySeat[seat] ?? { p1: [], p5: [], mrr: [] };
      acc.p1.push(num(r.precisionAt1) ?? 0);
      acc.p5.push(num(r.precisionAt5) ?? 0);
      acc.mrr.push(num(r.reciprocalRank) ?? 0);
      bySeat[seat] = acc;
    }
  }

  const categories = catOrder.map((cat) => {
    const bySeat = catRows.get(cat);
    const perSeat = {};
    let n = 0;
    for (const seat of seats) {
      const acc = bySeat[seat] ?? { p1: [], p5: [], mrr: [] };
      n = Math.max(n, acc.p1.length);
      perSeat[seat] = {
        precisionAt1: round(mean(acc.p1), 3),
        precisionAt5: round(mean(acc.p5), 3),
        mrr: round(mean(acc.mrr), 3),
        queries: acc.p1.length,
      };
    }
    return { category: cat, label: categoryLabel(cat), queries: n, byModel: perSeat };
  });

  // Grouped-bar rows: one entry per category, a value column per seat.
  const perCatFor = (metric) =>
    categories.map((c) => {
      const row = { label: c.label, category: c.category };
      for (const seat of seats) row[seat] = c.byModel[seat][metric];
      return row;
    });

  // Aggregate head-to-head + latency: one row per metric, a column per seat.
  const seatRow = (key, label) => {
    const row = { label };
    for (const m of models) row[m.seat] = m[key];
    return row;
  };

  // Corpus node count is a harmless public figure; the source dirs are absolute
  // local paths and never ship (the UI only shows the node count and eval date).
  const corpus = raw.corpus && typeof raw.corpus === "object" ? raw.corpus : {};
  return {
    schema_version: 1,
    generated_at: generatedAt,
    available: true,
    corpus: { parsedNodes: nonNegative(corpus.parsedNodes), cliMemoryDir: null, legacyMemoryDir: null },
    queries: nonNegative(raw.queries),
    models,
    categories,
    aggregate: [
      seatRow("precisionAt1", "P@1"),
      seatRow("precisionAt5", "P@5"),
      seatRow("mrr", "MRR"),
    ],
    perCategory: {
      precisionAt1: perCatFor("precisionAt1"),
      precisionAt5: perCatFor("precisionAt5"),
      mrr: perCatFor("mrr"),
    },
    latency: [seatRow("p50LatencyMs", "p50"), seatRow("p95LatencyMs", "p95")],
  };
}

function writeRecall() {
  // The raw eval dataset is local-only (git-ignored data/). When it is absent — e.g.
  // a clean checkout on the courier machine — never clobber the committed projection
  // with an empty document; the snapshot is a one-off eval, not a live-refreshed feed.
  if (!existsSync(RECALL_SRC)) {
    if (existsSync(RECALL_OUT)) {
      console.error(`[prepare-data] recall: no source at ${RECALL_SRC}; preserving committed ${RECALL_OUT}`);
      return;
    }
    console.error(`[prepare-data] recall: no source at ${RECALL_SRC} and no committed output; emitting empty recall`);
  }

  let rawRecall = null;
  try {
    rawRecall = JSON.parse(readFileSync(RECALL_SRC, "utf8"));
  } catch (err) {
    if (existsSync(RECALL_OUT)) {
      console.error(`[prepare-data] recall dataset unreadable at ${RECALL_SRC}: ${err.message}; preserving committed ${RECALL_OUT}`);
      return;
    }
    console.error(`[prepare-data] recall dataset unavailable at ${RECALL_SRC}: ${err.message}; emitting empty recall`);
  }

  // Stamp with the dataset file's mtime so the page can show when the eval ran,
  // without the benchmark itself having to emit a timestamp.
  let generatedAt = null;
  try {
    generatedAt = statSync(RECALL_SRC).mtime.toISOString();
  } catch {
    /* no dataset — leave null */
  }

  const recall = recallForDashboard(rawRecall, generatedAt);
  assertPublicJson(recall);
  mkdirSync(dirname(RECALL_OUT), { recursive: true });
  const temporaryOut = `${RECALL_OUT}.${process.pid}.tmp`;
  writeFileSync(temporaryOut, `${JSON.stringify(recall, null, 2)}\n`);
  renameSync(temporaryOut, RECALL_OUT);
  console.error(
    `[prepare-data] recall: ${recall.available ? "ok" : "EMPTY"} · ${recall.queries} queries · ` +
      `${recall.models.length} seats · ${recall.categories.length} categories → ${RECALL_OUT}`
  );
}

main();
writeRecall();
