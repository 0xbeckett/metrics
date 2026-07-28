/*
 * Tests for the metrics plausibility gate.
 *
 * Covers the pure decision function (checkPlausible) plus one end-to-end check that the CLI
 * exits non-zero on a collapsed document and honours the served-document / override arguments.
 * Run with: node --test scripts/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPlausible } from "./verify-plausible-metrics.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "verify-plausible-metrics.mjs");

const doc = (totalRuns, totalSpend, modelsUsed) => ({ headline: { totalRuns, totalSpend, modelsUsed } });
const live = doc(2549, 1920.32, 7);

// ── Absolute floor ───────────────────────────────────────────────────────────
test("rejects zero runs", () => {
  const r = checkPlausible(doc(0, 100, 5), live);
  assert.equal(r.ok, false);
  assert.match(r.reason, /zero runs/);
});

test("rejects zero spend", () => {
  const r = checkPlausible(doc(2549, 0, 7), live);
  assert.equal(r.ok, false);
  assert.match(r.reason, /zero spend/);
});

test("rejects zero models", () => {
  const r = checkPlausible(doc(2549, 1920, 0), live);
  assert.equal(r.ok, false);
  assert.match(r.reason, /zero models/);
});

test("rejects the fully-collapsed empty harvest (all three zero)", () => {
  const r = checkPlausible(doc(0, 0, 0), live);
  assert.equal(r.ok, false);
  assert.match(r.reason, /zero runs/);
});

test("rejects a missing/non-numeric headline number", () => {
  assert.equal(checkPlausible({ headline: {} }, live).ok, false);
  assert.equal(checkPlausible({}, live).ok, false);
});

// ── Relative collapse ────────────────────────────────────────────────────────
test("rejects totalRuns collapsing far below the live document", () => {
  const r = checkPlausible(doc(100, 1920, 7), live);
  assert.equal(r.ok, false);
  assert.match(r.reason, /collapsed/);
});

test("allows a small dip within the 20% threshold", () => {
  // 2549 * 0.8 = 2039.2 floor; 2100 is above it.
  assert.equal(checkPlausible(doc(2100, 1920, 7), live).ok, true);
});

test("allows growth over the live document", () => {
  assert.equal(checkPlausible(doc(3000, 2500, 8), live).ok, true);
});

// ── First publish / override ─────────────────────────────────────────────────
test("allows a first publish with no served document", () => {
  assert.equal(checkPlausible(doc(2549, 1920, 7), null).ok, true);
});

test("still enforces the absolute floor on a first publish", () => {
  assert.equal(checkPlausible(doc(0, 0, 0), null).ok, false);
});

test("override lets a genuine reset through", () => {
  assert.equal(checkPlausible(doc(5, 1, 1), live, true).ok, true);
});

test("override still rejects a structurally broken document", () => {
  // A non-numeric headline is malformed data, not a legitimate reset.
  assert.equal(checkPlausible({ headline: {} }, live, true).ok, false);
});

// ── End-to-end CLI ───────────────────────────────────────────────────────────
test("CLI exits non-zero on a collapsed candidate and zero when plausible", () => {
  const candOk = join(tmpdir(), `mp-ok-${process.pid}.json`);
  const candBad = join(tmpdir(), `mp-bad-${process.pid}.json`);
  const servedPath = join(tmpdir(), `mp-served-${process.pid}.json`);
  writeFileSync(servedPath, JSON.stringify(live));
  writeFileSync(candOk, JSON.stringify(doc(2600, 2000, 7)));
  writeFileSync(candBad, JSON.stringify(doc(0, 0, 0)));

  const run = (args, env = {}) => {
    try {
      execFileSync(process.execPath, [CLI, ...args], { stdio: "pipe", env: { ...process.env, ...env } });
      return 0;
    } catch (e) {
      return e.status ?? 1;
    }
  };

  try {
    assert.equal(run([candOk, servedPath]), 0, "plausible candidate should pass");
    assert.notEqual(run([candBad, servedPath]), 0, "collapsed candidate should fail");
    // No served document present → first publish, but floor still applies.
    assert.equal(run([candOk, join(tmpdir(), `mp-missing-${process.pid}.json`)]), 0, "first publish should pass");
    // Override forces the collapsed document through.
    assert.equal(run([candBad, servedPath], { METRICS_ALLOW_COLLAPSE: "1" }), 0, "override should pass");
  } finally {
    rmSync(candOk, { force: true });
    rmSync(candBad, { force: true });
    rmSync(servedPath, { force: true });
  }
});

test("CLI rejects an unpriced source model dropped from the rollup", () => {
  const candidate = join(tmpdir(), `mp-dropped-model-${process.pid}.json`);
  writeFileSync(candidate, JSON.stringify({
    ...doc(2600, 2000, 7),
    models: [{ model: "claude-opus-4-8", label: "opus-4.8", cost: 12.3 }],
    notes: { unratedModelModels: ["claude-unpriced-future"] },
  }));
  try {
    assert.throws(
      () => execFileSync(process.execPath, [CLI, candidate], { stdio: "pipe" }),
      /missing from the rollup/,
    );
  } finally {
    rmSync(candidate, { force: true });
  }
});

test("CLI allows an unpriced source model kept visible as a cost:null row", () => {
  const candidate = join(tmpdir(), `mp-visible-uncosted-${process.pid}.json`);
  writeFileSync(candidate, JSON.stringify({
    ...doc(2600, 2000, 7),
    models: [{ model: "claude-unpriced-future", label: "unpriced", runs: 3, cost: null, wallHours: 1 }],
    notes: { unratedModelModels: ["claude-unpriced-future"] },
  }));
  try {
    assert.doesNotThrow(() => execFileSync(process.execPath, [CLI, candidate], { stdio: "pipe" }));
  } finally {
    rmSync(candidate, { force: true });
  }
});
