#!/usr/bin/env node
// Full shell build for code/style deployments. Routine data refreshes deliberately do not use
// this: the browser fetches the independently swapped /metrics.json at runtime.
import { cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run(process.execPath, ["scripts/prepare-data.mjs"]);
run("bun", ["x", "--no-install", "vite", "build"]);
mkdirSync(resolve(root, "dist"), { recursive: true });
cpSync(resolve(root, "src/generated/metrics.json"), resolve(root, "dist/metrics.json"));
