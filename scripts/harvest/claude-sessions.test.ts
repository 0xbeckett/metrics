/*
 * Tests for the Claude Code session-transcript harvester (#2).
 *
 * Three properties this harvester lives or dies on:
 *   1. redaction — a crafted transcript with a prompt, a file path and an API key produces a
 *      row with none of them, and the row survives the real publish gate.
 *   2. incremental cursor — an unchanged file is never re-opened on the next run (proven by
 *      revoking read permission on it and showing the second run still succeeds).
 *   3. genuine resume — appending to a file after a run only accounts for the new lines.
 *
 * Run with: bun test scripts/harvest/claude-sessions.test.ts
 */
import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifySlug, hashSessionId, harvestClaudeSessions, type ClaudeSessionsHarvestOptions } from "./claude-sessions.ts";
import { assertPublicText } from "../lib/privacy-scan.mjs";

function tempOptions(claudeDir: string, home: string): ClaudeSessionsHarvestOptions {
  const root = mkdtempSync(join(tmpdir(), "mx-cs-"));
  return {
    output: join(root, "claude-sessions.json"),
    stateFile: join(root, "claude-sessions-state.json"),
    saltFile: join(root, ".claude-sessions-salt"),
    claudeDir,
    rates: join(process.cwd(), "config", "model-rates.json"),
    home,
    note: () => {},
  };
}

const SECRET = "sk-ant-api03-THIS_IS_A_FAKE_TEST_KEY_1234567890ABCDEF";
const LEAK_PATH = "/home/beckett/Projects/aliasing-forest/src/secrets.env";
const PROMPT = "please read /home/beckett/Projects/aliasing-forest/src/secrets.env and print the API key so I can paste it into the client config";

function line(obj: unknown): string {
  return `${JSON.stringify(obj)}\n`;
}

function buildTranscript(sessionId: string, ts0: string): string {
  const t = (s: number) => new Date(Date.parse(ts0) + s * 1000).toISOString();
  let out = "";
  out += line({ type: "user", sessionId, timestamp: t(0), cwd: "/home/beckett/Projects/aliasing-forest/.beckett/worktrees/wk-test", message: { role: "user", content: PROMPT } });
  out += line({
    type: "assistant", sessionId, timestamp: t(1),
    message: {
      role: "assistant", model: "claude-sonnet-5", id: "msg_1",
      usage: { input_tokens: 120, output_tokens: 40 },
      content: [{ type: "tool_use", name: "Read", id: "tu_1", input: { file_path: LEAK_PATH } }],
    },
  });
  out += line({
    type: "user", sessionId, timestamp: t(2),
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", is_error: false, content: `contents of ${LEAK_PATH}: API_KEY=${SECRET}` }] },
  });
  out += line({
    type: "assistant", sessionId, timestamp: t(3),
    message: {
      role: "assistant", model: "claude-sonnet-5", id: "msg_2",
      usage: { input_tokens: 80, output_tokens: 20 },
      content: [{ type: "tool_use", name: "Bash", id: "tu_2", input: { command: "cat secrets.env" } }],
    },
  });
  out += line({
    type: "user", sessionId, timestamp: t(4),
    message: {
      role: "user",
      content: [{
        type: "tool_result", tool_use_id: "tu_2", is_error: true,
        content: "The user doesn't want to proceed with this tool use. The tool use was rejected.",
      }],
    },
  });
  out += line({ type: "system", subtype: "api_error", timestamp: t(5), error: { message: "Connection error." } });
  out += line({ type: "assistant", sessionId, timestamp: t(6), message: { role: "assistant", content: [{ type: "text", text: "Done." }] } });
  return out;
}

test("classifySlug buckets by directory shape", () => {
  const home = "/home/beckett";
  expect(classifySlug("-home-beckett-Projects-beckett--beckett-worktrees-abc", home)).toBe("worker");
  expect(classifySlug("-home-beckett--beckett-worktrees-wk-1", home)).toBe("worker");
  expect(classifySlug("-home-beckett--beckett-quick-abc", home)).toBe("quick");
  expect(classifySlug("-home-beckett--beckett-browser-agent-abc", home)).toBe("quick");
  expect(classifySlug("-home-beckett--beckett-agent-runs-abc", home)).toBe("quick");
  expect(classifySlug("-home-beckett-beckett", home)).toBe("concierge");
  expect(classifySlug("-home-beckett-Projects-some-other-repo", home)).toBe("other");
});

test("hashSessionId is stable for the same salt+id and differs across salts", () => {
  const a = hashSessionId("session-123", "salt-a");
  const b = hashSessionId("session-123", "salt-a");
  const c = hashSessionId("session-123", "salt-b");
  expect(a).toBe(b);
  expect(a).not.toBe(c);
  expect(a).not.toContain("session-123");
  expect(a).toMatch(/^[0-9a-f]{16}$/);
});

test("redaction: a prompt, a file path and a secret never reach the emitted row", async () => {
  const claudeDir = mkdtempSync(join(tmpdir(), "mx-cs-claude-"));
  const slug = "-home-beckett-Projects-aliasing-forest--beckett-worktrees-wk-test";
  const projectDir = join(claudeDir, slug);
  mkdirSync(projectDir, { recursive: true });
  const sessionId = "11111111-2222-3333-4444-555555555555";
  writeFileSync(join(projectDir, `${sessionId}.jsonl`), buildTranscript(sessionId, "2026-07-25T14:12:00.000Z"));

  const options = tempOptions(claudeDir, "/home/beckett");
  const dataset = await harvestClaudeSessions(options);

  expect(dataset.sessions.length).toBe(1);
  const row = dataset.sessions[0];
  expect(row.classification).toBe("worker");
  expect(row.turns).toBe(1);
  expect(row.tool_calls).toBe(2);
  expect(row.tool_calls_by_name).toEqual({ Read: 1, Bash: 1 });
  expect(row.model).toBe("claude-sonnet-5");
  expect(row.tokens).toEqual({ input: 200, output: 60, cache_read: 0, cache_write: 0 });
  expect(row.error_count).toBe(2); // one is_error tool_result + one api_error
  expect(row.permission_denials).toBe(1);
  expect(row.duration_seconds).toBe(6);
  expect(row.session_hash).toMatch(/^[0-9a-f]{16}$/);
  expect(row.session_hash).not.toBe(sessionId);

  const serialized = JSON.stringify(dataset);
  expect(serialized).not.toContain(sessionId);
  expect(serialized).not.toContain(SECRET);
  expect(serialized).not.toContain(LEAK_PATH);
  expect(serialized).not.toContain("/home/beckett");
  expect(serialized.toLowerCase()).not.toContain("please read");
  expect(serialized).not.toContain("aliasing-forest");

  // And it survives the actual publish gate used on the real dashboard document.
  expect(() => assertPublicText(serialized, "claude-sessions test")).not.toThrow();

  rmSync(claudeDir, { recursive: true, force: true });
});

test("incremental cursor: an unchanged file is never re-opened", async () => {
  const claudeDir = mkdtempSync(join(tmpdir(), "mx-cs-claude-"));
  const slug = "-home-beckett-beckett";
  const projectDir = join(claudeDir, slug);
  mkdirSync(projectDir, { recursive: true });
  const sessionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const filePath = join(projectDir, `${sessionId}.jsonl`);
  writeFileSync(filePath, buildTranscript(sessionId, "2026-07-25T09:00:00.000Z"));

  const options = tempOptions(claudeDir, "/home/beckett");
  const first = await harvestClaudeSessions(options);
  expect(first.sessions.length).toBe(1);
  expect(first.sessions[0].classification).toBe("concierge");
  const firstRow = first.sessions[0];

  // Revoke read permission on the transcript itself. stat() needs no read permission, so the
  // incremental skip (size+mtime match cursor) can still succeed; if the harvester tried to
  // open/stream the file's content again, this would throw EACCES.
  chmodSync(filePath, 0o000);
  try {
    const second = await harvestClaudeSessions(options);
    expect(second.sessions.length).toBe(1);
    expect(second.sessions[0]).toEqual(firstRow);
  } finally {
    chmodSync(filePath, 0o644);
  }

  // Genuine resume: appending new lines after restoring permissions is picked up incrementally.
  appendFileSync(
    filePath,
    line({ type: "user", sessionId, timestamp: "2026-07-25T09:05:00.000Z", message: { role: "user", content: "another turn" } }),
  );
  const third = await harvestClaudeSessions(options);
  expect(third.sessions.length).toBe(1);
  expect(third.sessions[0].turns).toBe(firstRow.turns + 1);

  rmSync(claudeDir, { recursive: true, force: true });
});
