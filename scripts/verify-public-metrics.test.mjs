/*
 * Tests for the public-metrics privacy gate.
 *
 * Covers the shared scanner (scripts/lib/privacy-scan.mjs) that verify-public-metrics.mjs runs,
 * plus one end-to-end check that the CLI actually exits non-zero on a leaky file. Run with:
 *   node --test scripts/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanForViolations, assertPublicText } from "./lib/privacy-scan.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The rule ids that fire for a given string. */
const hits = (s) => scanForViolations(s).map((v) => v.id);

// ── Things that MUST be allowed (the dashboard depends on them) ──────────────
test("allows ticket refs, titles, model ids and dates", () => {
  const ok = JSON.stringify({
    recentActivity: [
      { ts: "2026-07-25T08:30:11.037Z", kind: "done", ref: "#80.1", title: "Widen the data layer + event-driven refresh" },
      { ts: "2026-07-20T20:11:15.609Z", kind: "deploy", ref: "OPS-125", title: "Audit routing path, fix real issues" },
    ],
    spend: { byModel: [{ model: "claude-opus-4-8", label: "opus-4.8", cost: 11.29 }] },
    memory: { nodes: [{ name: "beta-access-gate", type: "project", degree: 3 }], edges: [{ from: "jason", to: "loom-desk" }] },
  });
  assert.deepEqual(hits(ok), []);
  assert.doesNotThrow(() => assertPublicText(ok, "clean"));
});

test("does not flag a 40-char git SHA as a secret", () => {
  // All-lowercase hex, no uppercase — must not trip the high-entropy token rule.
  assert.deepEqual(hits("baseSha 4b3ab54c79aa1b397eb9a63b1547117ea3bd98ef end"), []);
});

// ── Things that MUST be rejected ─────────────────────────────────────────────
test("rejects email addresses", () => {
  assert.ok(hits("contact jason.awz2005@gmail.com now").includes("email"));
});

test("rejects absolute local paths", () => {
  assert.ok(hits("/home/beckett/.beckett/tasks.json").includes("local-path"));
  assert.ok(hits("workspace at /Users/foo/x").includes("local-path"));
});

test("rejects Discord numeric ids (snowflakes)", () => {
  assert.ok(hits('{"channelId":"1520986792373911622"}').includes("discord-snowflake"));
  assert.ok(hits('{"requesterId":"1151230208783945818"}').includes("discord-snowflake"));
});

test("rejects Discord mention markup and user: content", () => {
  assert.ok(hits("hey <@1151230208783945818> look").includes("discord-mention"));
  assert.ok(hits("Requested by ro (user:1151230208783945818)").includes("discord-mention"));
  assert.ok(hits("in channel <#1520986792373911622>").includes("discord-mention"));
});

test("rejects legacy Discord username#discriminator", () => {
  assert.ok(hits("pinged beckett#4211 earlier").includes("discord-username"));
});

test("rejects memory file bodies (wiki-links and body markers)", () => {
  assert.ok(hits("relates to [[beta-access-gate]] strongly").includes("memory-body"));
  assert.ok(hits("**Why:** this is the gate for who can task me").includes("memory-body"));
  assert.ok(hits("**How to apply:** evaluate the pitch in character").includes("memory-body"));
});

test("rejects token/secret-shaped strings", () => {
  assert.ok(hits("BECKETT_BROWSER_CONTROL_TOKEN=qM_NqRE_5paxbGEdFo1dUTL_8IyVirxEBjecIrTx8A4").length > 0);
  assert.ok(hits("qM_NqRE_5paxbGEdFo1dUTL_8IyVirxEBjecIrTx8A4").includes("secret-high-entropy"));
  assert.ok(hits("token ghp_16C7e42F292c6912E7710c838347Ae178B4a").includes("secret-prefixed"));
  assert.ok(hits("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9").length > 0);
  assert.ok(hits("aws AKIAIOSFODNN7EXAMPLE key").includes("secret-prefixed"));
});

test("assertPublicText throws naming the offending rule", () => {
  assert.throws(() => assertPublicText("leak /home/beckett/secret", "doc"), /local filesystem path/i);
});

// ── Claude Code session analytics (#2): generic free-text backstop ───────────
// Every legitimate string in this document is a short label (ticket ref, model id, tool name).
// A harvester regression that lets raw transcript prose through won't necessarily look like an
// email/path/secret, so a bare "string is suspiciously long" rule is the last line of defense.
test("rejects a JSON string value over the length bound, even with no other tell", () => {
  const prose = "please open the config file and swap the staging endpoint for the production one, then rerun the deploy script and let me know once it finishes so I can tell the whole team on discord it went out fine";
  assert.ok(prose.length > 200);
  assert.ok(hits(JSON.stringify({ note: prose })).includes("long-string-field"));
});

test("allows short claude-sessions rollup fields", () => {
  const ok = JSON.stringify({
    claudeSessions: {
      total: 42,
      byClassification: [{ classification: "worker", count: 30 }],
      toolCallMix: [{ tool: "Bash", count: 118 }],
      byModel: [{ model: "claude-sonnet-5", label: "sonnet-5", sessions: 20 }],
    },
  });
  assert.deepEqual(hits(ok), []);
  assert.doesNotThrow(() => assertPublicText(ok, "claude-sessions"));
});

test("rejects a claude-sessions row that leaked free text into a tool-name-shaped field", () => {
  const bad = JSON.stringify({
    claudeSessions: {
      toolCallMix: [{
        tool: "please fix the login bug for the user and don't forget to remove the debug console.log statements before you commit this change, thanks so much for all the help today",
        count: 1,
      }],
    },
  });
  assert.ok(hits(bad).includes("long-string-field"));
});

// ── End-to-end: the CLI verifier rejects a leaky file ────────────────────────
test("verify-public-metrics.mjs exits non-zero on a leaky document", () => {
  const good = join(tmpdir(), `mx-good-${process.pid}.json`);
  const bad = join(tmpdir(), `mx-bad-${process.pid}.json`);
  writeFileSync(good, JSON.stringify({ recentActivity: [{ ref: "#100", title: "ok" }] }));
  writeFileSync(bad, JSON.stringify({ leak: "user:1151230208783945818" }));
  const run = (p) => {
    try {
      execFileSync(process.execPath, [join(HERE, "verify-public-metrics.mjs"), p], { stdio: "pipe" });
      return 0;
    } catch (e) {
      return e.status ?? 1;
    } finally {
      rmSync(p, { force: true });
    }
  };
  assert.equal(run(good), 0, "clean file should pass");
  assert.notEqual(run(bad), 0, "leaky file should fail");
});
