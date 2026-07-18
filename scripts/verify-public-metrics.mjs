#!/usr/bin/env node
/** Refuse a public metrics document containing common email or absolute-path forms. */
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) throw new Error("usage: verify-public-metrics.mjs PATH");
const json = readFileSync(path, "utf8");
JSON.parse(json); // also catches a truncated/partial copy before it can be installed
const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const localPath = /(?:\/home\/|\/Users\/|[A-Za-z]:[\\/])/;
if (email.test(json) || localPath.test(json)) {
  throw new Error(`privacy check failed for ${path}: email or absolute local path found`);
}
console.error(`[verify-public-metrics] safe public JSON: ${path}`);
