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
import { assertSourceModelsAccountedFor } from "./lib/model-rates.mjs";

const path = process.argv[2];
if (!path) throw new Error("usage: verify-public-metrics.mjs PATH");
const json = readFileSync(path, "utf8");
const doc = JSON.parse(json); // also catches a truncated/partial copy before it can be installed
assertPublicText(json, path);
// Hard publish gate: an unpriced source model must remain visible as a cost:null row with its
// runs counted. Fail loudly if one was dropped — a missing price must not shrink the totals.
assertSourceModelsAccountedFor(doc);
console.error(`[verify-public-metrics] safe public JSON with every source model accounted for: ${path}`);
