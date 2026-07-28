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
 * The rollup's model rows are directly sourced from telemetry runs. `unratedModelModels`
 * additionally catches documents made by an older harvester that omitted those runs.
 */
export function sourceModelsInDocument(doc) {
  const models = new Set();
  for (const row of Array.isArray(doc?.models) ? doc.models : []) {
    if (row && typeof row.model === "string" && row.model) models.add(row.model);
  }
  for (const model of Array.isArray(doc?.notes?.unratedModelModels) ? doc.notes.unratedModelModels : []) {
    if (typeof model === "string" && model) models.add(model);
  }
  return [...models].sort();
}

export function assertSourceModelsHaveRates(doc, ratePath = DEFAULT_RATE_TABLE) {
  const rates = JSON.parse(readFileSync(ratePath, "utf8"));
  const missing = sourceModelsInDocument(doc).filter((model) => !hasRateForModel(model, rates));
  if (missing.length) {
    throw new Error(
      `source model(s) missing from rate table ${ratePath}: ${missing.join(", ")}. ` +
      "Add an honest rate entry before publishing; unpriced runs remain visible but cannot be silently priced.",
    );
  }
}
