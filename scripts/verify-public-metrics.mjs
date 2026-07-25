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

const path = process.argv[2];
if (!path) throw new Error("usage: verify-public-metrics.mjs PATH");
const json = readFileSync(path, "utf8");
JSON.parse(json); // also catches a truncated/partial copy before it can be installed
assertPublicText(json, path);
console.error(`[verify-public-metrics] safe public JSON: ${path}`);
