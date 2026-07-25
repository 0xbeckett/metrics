/*
 * Shared helpers for the "wider data layer" harvesters (#100).
 *
 * Every harvester in this directory reads a live beckett state source and rolls it up into a
 * small section of the public metrics document. The contract they all share: a missing or
 * unreadable source SKIPS its section (returns { available:false, ... } with empty aggregates),
 * it never throws. That keeps a clean checkout or a partially-populated box from breaking the
 * whole refresh.
 */
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The beckett state root. Overridable for tests via BECKETT_DIR. */
export function beckettDir() {
  return process.env.BECKETT_DIR || join(homedir(), ".beckett");
}

export const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
export const text = (v) => (typeof v === "string" ? v : null);
export const nonNeg = (v) => Math.max(0, num(v) ?? 0);

export function round(n, dp = 2) {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** Read+parse a JSON file, or return `fallback` on any error (missing, unreadable, malformed). */
export function readJsonSafe(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

/** Read a JSONL file into an array of parsed objects, skipping blank/malformed lines. */
export function readJsonlSafe(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      /* skip a torn or partial line */
    }
  }
  return out;
}

/** File mtime as an ISO string, or null if the path is unreadable. */
export function mtimeIso(path) {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return null;
  }
}

/** Percentile (0..100) of a numeric array. Sorts a copy; returns 0 for an empty array. */
export function percentile(values, p) {
  const xs = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return 0;
  if (xs.length === 1) return xs[0];
  const idx = (p / 100) * (xs.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return xs[lo];
  return xs[lo] + (xs[hi] - xs[lo]) * (idx - lo);
}

export function mean(values) {
  const xs = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Summary stats for a numeric array, all rounded to `dp` decimals. */
export function stats(values, dp = 2) {
  const xs = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  return {
    count: xs.length,
    mean: round(mean(xs), dp),
    p50: round(percentile(xs, 50), dp),
    p90: round(percentile(xs, 90), dp),
    max: xs.length ? round(Math.max(...xs), dp) : 0,
  };
}

/** Increment a Map counter. */
export function bump(map, key, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

/** A Map<string,number> as a sorted [{key:label, count}] array (descending by count). */
export function countRows(map, keyName = "key") {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, count]) => ({ [keyName]: k, count }));
}

/** The yyyy-mm-dd prefix of an ISO timestamp, or null. */
export function dayOf(iso) {
  return typeof iso === "string" && iso.length >= 10 ? iso.slice(0, 10) : null;
}

// Display label + dither-kit palette colour per model — mirrors prepare-data.mjs so the
// spend/worker charts share one colour vocabulary with the telemetry tab.
const MODEL_META = {
  "claude-opus-4-8": { label: "opus-4.8", color: "red" },
  "claude-opus-5": { label: "opus-5", color: "red" },
  "claude-sonnet-5": { label: "sonnet-5", color: "blue" },
  "claude-haiku-4-5-20251001": { label: "haiku-4.5", color: "green" },
  "claude-fable-5": { label: "fable-5", color: "purple" },
  "gpt-5.6-terra": { label: "terra", color: "orange" },
  "gpt-5.6-luna": { label: "luna", color: "pink" },
};
const FALLBACK_COLORS = ["blue", "green", "purple", "orange", "pink", "red"];

/** Stable label+colour for a model id. Unknown models still render off the fallback ramp. */
export function modelMeta(model, idx = 0) {
  if (MODEL_META[model]) return MODEL_META[model];
  const short = String(model).replace(/^claude-/, "").replace(/^gpt-/, "gpt-");
  return { label: short, color: FALLBACK_COLORS[idx % FALLBACK_COLORS.length] };
}

/** Fill a per-day map into a gap-free [{date, ...}] series between its first and last day. */
export function fillDays(perDay, makeEmpty) {
  const days = [...perDay.keys()].filter(Boolean).sort();
  if (days.length === 0) return [];
  const out = [];
  const end = new Date(`${days[days.length - 1]}T00:00:00Z`);
  for (let d = new Date(`${days[0]}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, ...(perDay.get(key) ?? makeEmpty()) });
  }
  return out;
}
