#!/usr/bin/env node
/**
 * Refuse to publish a metrics document that has implausibly collapsed.
 *
 * The privacy scanner (verify-public-metrics.mjs) checks for *leaks*; this gate checks for
 * *plausibility*. It exists because a mis-configured harvest (no HOME, every source path
 * resolved relative and found nothing) produced a document with totalRuns/totalSpend/modelsUsed
 * all zero, sailed through the privacy scan as "safe public JSON", and got published over the
 * live dashboard.
 *
 * Two failure modes:
 *   1. Absolute floor — zero runs, zero spend, or zero models is never a valid public document.
 *   2. Relative collapse — the run ledger is append-only, so totalRuns should never drop far
 *      below the currently-served document. A large drop means the harvest lost its sources.
 *
 * A first publish (no served document yet) is allowed. A genuine dataset reset can be forced
 * through with METRICS_ALLOW_COLLAPSE=1.
 *
 * Usage: verify-plausible-metrics.mjs CANDIDATE_PATH [SERVED_PATH]
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// A totalRuns drop of more than this fraction below the served document fails the gate.
export const COLLAPSE_THRESHOLD = 0.2;

/** Pull the three headline numbers we sanity-check out of a parsed document. */
function headlineNumbers(doc) {
  const h = (doc && doc.headline) || {};
  return {
    totalRuns: Number(h.totalRuns),
    totalSpend: Number(h.totalSpend),
    modelsUsed: Number(h.modelsUsed),
  };
}

/**
 * Decide whether `candidate` (parsed) may be published, given the optional `served` (parsed, or
 * null when nothing is live yet). Returns { ok: true } or { ok: false, reason }.
 * `allowCollapse` mirrors METRICS_ALLOW_COLLAPSE and skips the collapse checks entirely.
 */
export function checkPlausible(candidate, served, allowCollapse = false) {
  const cand = headlineNumbers(candidate);

  for (const key of ["totalRuns", "totalSpend", "modelsUsed"]) {
    if (!Number.isFinite(cand[key])) {
      return { ok: false, reason: `candidate headline.${key} is missing or not a number` };
    }
  }

  if (allowCollapse) return { ok: true };

  // Absolute floor: a document with nothing in it is never valid to publish.
  if (cand.totalRuns <= 0) return { ok: false, reason: "candidate has zero runs (headline.totalRuns <= 0)" };
  if (cand.totalSpend <= 0) return { ok: false, reason: "candidate has zero spend (headline.totalSpend <= 0)" };
  if (cand.modelsUsed <= 0) return { ok: false, reason: "candidate has zero models (headline.modelsUsed <= 0)" };

  // Relative collapse: the run ledger is append-only, so a big drop means lost sources.
  if (served) {
    const live = headlineNumbers(served);
    if (Number.isFinite(live.totalRuns) && live.totalRuns > 0) {
      const floor = live.totalRuns * (1 - COLLAPSE_THRESHOLD);
      if (cand.totalRuns < floor) {
        return {
          ok: false,
          reason:
            `candidate totalRuns ${cand.totalRuns} collapsed more than ` +
            `${Math.round(COLLAPSE_THRESHOLD * 100)}% below the live ${live.totalRuns} ` +
            `(floor ${Math.round(floor)}); set METRICS_ALLOW_COLLAPSE=1 if the dataset was really reset`,
        };
      }
    }
  }

  return { ok: true };
}

function main(argv, env) {
  const candidatePath = argv[2];
  if (!candidatePath) throw new Error("usage: verify-plausible-metrics.mjs CANDIDATE_PATH [SERVED_PATH]");
  const servedPath = argv[3];

  const candidate = JSON.parse(readFileSync(candidatePath, "utf8"));
  let served = null;
  if (servedPath && existsSync(servedPath)) {
    served = JSON.parse(readFileSync(servedPath, "utf8"));
  }

  const allowCollapse = env.METRICS_ALLOW_COLLAPSE === "1";
  const result = checkPlausible(candidate, served, allowCollapse);
  if (!result.ok) {
    console.error(`[verify-plausible-metrics] REJECTED ${candidatePath}: ${result.reason}`);
    process.exit(1);
  }
  const note = allowCollapse
    ? "collapse checks overridden via METRICS_ALLOW_COLLAPSE=1"
    : served
      ? "plausible vs live document"
      : "first publish, no live document";
  console.error(`[verify-plausible-metrics] plausible public JSON (${note}): ${candidatePath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv, process.env);
}
