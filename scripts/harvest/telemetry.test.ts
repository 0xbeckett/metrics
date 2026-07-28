import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harvest, type HarvestOptions } from "./telemetry.ts";

function transcript(model: string, id: string): string {
  return [
    { type: "user", sessionId: id, timestamp: "2026-07-27T00:00:00.000Z", message: { role: "user", content: "run" } },
    {
      type: "assistant", sessionId: id, timestamp: "2026-07-27T00:00:01.000Z",
      message: { role: "assistant", model, id: `msg-${id}`, usage: { input_tokens: 100, output_tokens: 20 } },
    },
  ].map((entry) => JSON.stringify(entry)).join("\n");
}

test("telemetry preserves unpriced runs and accepts dated model aliases", async () => {
  const root = mkdtempSync(join(tmpdir(), "mx-telemetry-"));
  const claudeDir = join(root, "claude");
  const project = join(claudeDir, "project");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "dated.jsonl"), transcript("claude-haiku-4-5-20251001", "dated"));
  writeFileSync(join(project, "unknown.jsonl"), transcript("claude-unpriced-future", "unknown"));
  const rates = join(root, "rates.json");
  writeFileSync(rates, JSON.stringify({
    schema_version: 1, effective_date: "2026-07-27", currency: "USD", unit: "USD per million tokens",
    models: {
      "claude-haiku-4-5": {
        input: 1, output: 5, cache_read: 0.1, cache_write: 1.25,
        cache_read_multiplier: 0.1, cache_creation_multiplier: 1.25,
        estimate: true, source: "test rate",
      },
    },
  }));
  const options: HarvestOptions = {
    output: join(root, "telemetry.json"), rates, claudeDir,
    piDir: join(root, "pi"), codexDir: join(root, "codex"), boredStateDir: join(root, "state"), note: () => {},
  };

  try {
    const dataset = await harvest(options);
    expect(dataset.runs).toHaveLength(2);
    expect(dataset.runs.find((run) => run.model === "claude-haiku-4-5-20251001")?.cost_usd).not.toBeNull();
    const unknown = dataset.runs.find((run) => run.model === "claude-unpriced-future");
    expect(unknown?.cost_usd).toBeNull();
    expect(unknown?.wall_clock_seconds).toBe(1);
    expect(dataset.unrated_model_sessions).toEqual({ count: 1, models: { "claude-unpriced-future": 1 } });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
