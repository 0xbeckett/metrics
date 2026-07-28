#!/usr/bin/env node
/**
 * Refuse to install a public metrics document that leaks anything private.
 *
 * This is the last gate before metrics.json is copied into the served directory. It re-runs the
 * shared privacy scanner (scripts/lib/privacy-scan.mjs) on the exact bytes about to be published,
 * hard-failing on: email addresses, absolute local paths, Discord ids/usernames/mention-content,
 * memory file bodies, and token/secret-shaped strings. Ticket refs and titles are allowed.
 */
import { readFileSync } from "node:fs";
import { assertPublicText } from "./lib/privacy-scan.mjs";
import { assertSourceModelsHaveRates, DEFAULT_RATE_TABLE } from "./lib/model-rates.mjs";

const path = process.argv[2];
const ratePath = process.argv[3] ?? DEFAULT_RATE_TABLE;
if (!path) throw new Error("usage: verify-public-metrics.mjs PATH [RATE_TABLE_PATH]");
const json = readFileSync(path, "utf8");
const doc = JSON.parse(json); // also catches a truncated/partial copy before it can be installed
assertPublicText(json, path);
// This is intentionally a hard publish gate: a new source model must add a price
// (or an explicit estimate) instead of silently falling out of the dashboard.
assertSourceModelsHaveRates(doc, ratePath);
console.error(`[verify-public-metrics] safe public JSON with priced source models: ${path}`);
