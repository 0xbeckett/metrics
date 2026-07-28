import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_RATE_TABLE = resolve(SCRIPTS_DIR, "..", "config", "model-rates.json");

/** Claude model ids may carry an eight-digit release suffix while rates use the base SKU. */
export function hasRateForModel(model, rateTable) {
  if (typeof model !== "string" || !model.trim()) return false;
  const normalized = model.toLowerCase();
  const models = rateTable?.models ?? {};
  return Boolean(models[normalized] ?? models[normalized.replace(/-\d{8}$/, "")]);
}

/**
 * The source models the harvester could not price (`notes.unratedModelModels`) that are ALSO
 * missing from the rollup's `models` rows — i.e. models whose runs were silently dropped.
 *
 * A missing price is not a missing model: an unpriced model must remain a counted row with
 * cost:null so its runs still reach headline.totalRuns. Any unrated model that fails to appear
 * as a row was dropped, which is exactly the "silently shrinking the totals" regression this
 * gate exists to catch. Priced models are, by construction, already present as costed rows.
 */
export function droppedSourceModels(doc) {
  const rows = new Set(
    (Array.isArray(doc?.models) ? doc.models : [])
      .filter((r) => r && typeof r.model === "string" && r.model)
      .map((r) => r.model.toLowerCase()),
  );
  const flagged = Array.isArray(doc?.notes?.unratedModelModels) ? doc.notes.unratedModelModels : [];
  const missing = flagged.filter((m) => typeof m === "string" && m && !rows.has(m.toLowerCase()));
  return [...new Set(missing)].sort();
}

/**
 * Publish gate: every source model absent from the rate table must still be visible as a
 * cost:null row with its runs counted. Fail loudly if any was dropped — a missing price must
 * never quietly erase real usage from the totals (the Opus-5 defect this ticket fixes).
 */
export function assertSourceModelsAccountedFor(doc) {
  const dropped = droppedSourceModels(doc);
  if (dropped.length) {
    throw new Error(
      `unpriced source model(s) missing from the rollup: ${dropped.join(", ")}. ` +
        "A model absent from the rate table must stay visible with cost:null and its runs " +
        "counted in headline.totalRuns — never silently dropped, which shrinks the totals. " +
        "Add a rate entry, or fix the harvester so the model keeps its row.",
    );
  }
}
