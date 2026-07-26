#!/usr/bin/env bun
import { defaultClaudeSessionsOptions, harvestClaudeSessions } from "./harvest/claude-sessions.ts";

const options = defaultClaudeSessionsOptions();
const args = process.argv.slice(2);

function take(flag: string): string {
  const value = args.shift();
  if (!value) throw new Error(`${flag} requires a path`);
  return value;
}

while (args.length) {
  const flag = args.shift()!;
  switch (flag) {
    case "--output": options.output = take(flag); break;
    case "--state-file": options.stateFile = take(flag); break;
    case "--salt-file": options.saltFile = take(flag); break;
    case "--claude-dir": options.claudeDir = take(flag); break;
    case "--rates": options.rates = take(flag); break;
    case "--help":
      console.log("Usage: bun run claude-sessions:refresh [--output PATH] [--state-file PATH] [--salt-file PATH] [--claude-dir PATH] [--rates PATH]");
      process.exit(0);
    default: throw new Error(`unknown option: ${flag}`);
  }
}

await harvestClaudeSessions(options);
