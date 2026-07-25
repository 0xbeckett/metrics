/*
 * Workers section — per-run outcomes across the implement/review lanes.
 *
 * Primary source is ~/.beckett/spend.jsonl (one structured row per run: turns, toolCalls,
 * tokensIn/Out, durationMs, stage, outcome, reviewTier). The dispatch stream
 * (events/dispatch.jsonl) supplies stalls (wedge events), restarts, and the review-bounce count
 * that yields rework cycles and first-try pass rate. dispatcher-state.json adds retry counters.
 * The journal/ and workers/ directories contribute light activity counts. Every source is
 * optional; each missing one just drops its contribution.
 *
 * PUBLIC-SAFE: counts, distributions and summary stats only — no run text, ids, or paths.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { beckettDir, readJsonlSafe, readJsonSafe, num, round, bump, countRows, stats } from "./shared.mjs";

const empty = () => ({
  available: false,
  totalRuns: 0,
  byStage: [],
  byOutcome: [],
  firstTryPassRate: null,
  reworkCycles: { count: 0, mean: 0, max: 0, distribution: [] },
  stalls: 0,
  restarts: 0,
  totals: { turns: 0, toolCalls: 0, tokensIn: 0, tokensOut: 0, wallHours: 0 },
  perRun: { turns: {}, toolCalls: {}, tokens: {}, wallMinutes: {} },
  journalFiles: 0,
  workerDirs: 0,
});

function countDir(path, filter) {
  try {
    return readdirSync(path, { withFileTypes: true }).filter(filter).length;
  } catch {
    return 0;
  }
}

function baseRef(ref) {
  const m = String(ref ?? "").match(/#?(\d+)/);
  return m ? `#${m[1]}` : null;
}

export function harvestWorkers(dir = beckettDir()) {
  const rows = readJsonlSafe(join(dir, "spend.jsonl"));
  const journalFiles = countDir(join(dir, "journal"), (e) => e.isFile() && e.name.endsWith(".log"));
  const workerDirs = countDir(join(dir, "workers"), (e) => e.isDirectory());

  if (rows.length === 0) {
    // No run rows, but still report directory activity if present.
    const base = empty();
    if (journalFiles || workerDirs) {
      base.available = true;
      base.journalFiles = journalFiles;
      base.workerDirs = workerDirs;
    }
    return base;
  }

  const byStage = new Map();
  const byOutcome = new Map();
  const turns = [];
  const toolCalls = [];
  const tokens = [];
  const wallMinutes = [];
  const totals = { turns: 0, toolCalls: 0, tokensIn: 0, tokensOut: 0, wallHours: 0 };
  let implDone = 0;
  let implTerminal = 0; // done + rework + failed (implement attempts that reached a verdict)

  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const stage = typeof r.stage === "string" && r.stage ? r.stage : "unknown";
    const outcome = typeof r.outcome === "string" && r.outcome ? r.outcome : "unknown";
    bump(byStage, stage);
    bump(byOutcome, outcome);

    const t = num(r.turns);
    const tc = num(r.toolCalls);
    const ti = num(r.tokensIn) ?? 0;
    const to = num(r.tokensOut) ?? 0;
    const ms = num(r.durationMs);
    if (t !== null) { turns.push(t); totals.turns += t; }
    if (tc !== null) { toolCalls.push(tc); totals.toolCalls += tc; }
    tokens.push(ti + to);
    totals.tokensIn += ti;
    totals.tokensOut += to;
    if (ms !== null) { wallMinutes.push(ms / 60000); totals.wallHours += ms / 3_600_000; }

    if (stage === "implement" && (outcome === "done" || outcome === "rework" || outcome === "failed")) {
      implTerminal += 1;
      if (outcome === "done") implDone += 1;
    }
  }

  // Rework cycles + stalls + restarts from the dispatch stream.
  const bouncesPerTicket = new Map();
  let stalls = 0;
  let restarts = 0;
  for (const ev of readJsonlSafe(join(dir, "events", "dispatch.jsonl"))) {
    if (!ev || typeof ev !== "object") continue;
    if (ev.outcome === "bounced") {
      const ref = baseRef(ev.ticketRef);
      if (ref) bump(bouncesPerTicket, ref);
    }
    if (typeof ev.stage === "string" && ev.stage.endsWith("wedge")) stalls += 1;
    if (ev.stage === "restart-restaff") restarts += 1;
  }
  // Fold in explicit retry counters from dispatcher-state.json.
  const dstate = readJsonSafe(join(dir, "dispatcher-state.json")) ?? {};
  for (const v of Object.values(dstate.implementRetries ?? {})) restarts += num(v) ?? 0;

  const bounceCounts = [...bouncesPerTicket.values()];
  const cycleHist = new Map();
  for (const c of bounceCounts) bump(cycleHist, c);

  return {
    available: true,
    totalRuns: rows.length,
    byStage: countRows(byStage, "stage"),
    byOutcome: countRows(byOutcome, "outcome"),
    firstTryPassRate: implTerminal ? round(implDone / implTerminal, 3) : null,
    reworkCycles: {
      count: bounceCounts.length,
      mean: bounceCounts.length ? round(bounceCounts.reduce((a, b) => a + b, 0) / bounceCounts.length, 2) : 0,
      max: bounceCounts.length ? Math.max(...bounceCounts) : 0,
      distribution: [...cycleHist.entries()].sort((a, b) => a[0] - b[0]).map(([cycles, count]) => ({ cycles, count })),
    },
    stalls,
    restarts,
    totals: {
      turns: totals.turns,
      toolCalls: totals.toolCalls,
      tokensIn: totals.tokensIn,
      tokensOut: totals.tokensOut,
      wallHours: round(totals.wallHours, 1),
    },
    perRun: {
      turns: stats(turns, 1),
      toolCalls: stats(toolCalls, 1),
      tokens: stats(tokens, 0),
      wallMinutes: stats(wallMinutes, 1),
    },
    journalFiles,
    workerDirs,
  };
}
