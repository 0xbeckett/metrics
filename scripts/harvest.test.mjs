/*
 * Tests for the widened-data-layer harvesters.
 *
 * Two properties every section must hold: (1) fail-soft — an absent source yields
 * available:false, never a throw; (2) the memory graph ships a drawable node/edge list and
 * NEVER a memory body. Run with: node --test scripts/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harvestTasks } from "./harvest/tasks.mjs";
import { harvestWorkers } from "./harvest/workers.mjs";
import { harvestSpend } from "./harvest/spend.mjs";
import { harvestBrowser } from "./harvest/browser.mjs";
import { harvestQuick } from "./harvest/quick.mjs";
import { harvestMemory } from "./harvest/memory.mjs";
import { harvestRoutines } from "./harvest/routines.mjs";
import { harvestLogs } from "./harvest/logs.mjs";
import { harvestActivity } from "./harvest/activity.mjs";
import { assertPublicText } from "./lib/privacy-scan.mjs";

test("every harvester is fail-soft when its source is absent", () => {
  const empty = join(tmpdir(), `mx-absent-${process.pid}`); // never created
  for (const fn of [harvestTasks, harvestWorkers, harvestSpend, harvestBrowser, harvestQuick, harvestMemory, harvestRoutines, harvestLogs]) {
    let section;
    assert.doesNotThrow(() => { section = fn(empty); }, `${fn.name} threw on absent source`);
    assert.equal(section.available, false, `${fn.name} should report available:false`);
  }
  assert.doesNotThrow(() => harvestActivity(empty, 50));
  assert.deepEqual(harvestActivity(empty, 50), []);
});

test("memory graph emits nodes/edges/degree and no memory body", () => {
  const dir = mkdtempSync(join(tmpdir(), "mx-mem-"));
  const memDir = join(dir, "memory", "people");
  mkdirSync(memDir, { recursive: true });
  const SECRET = "OWNER_ID 1151230208783945818 and token qM_NqRE_5paxbGEdFo1dUTL_8IyVirxEBjecIrTx8A4";
  writeFileSync(
    join(memDir, "jason.md"),
    `---\nname: jason\ndescription: the owner\nmetadata:\n  type: person\n  created: 2026-07-01T00:00:00.000Z\n---\n\n${SECRET}. Works with [[loom-desk]].\n**Why:** private.\n`
  );
  writeFileSync(
    join(memDir, "loom-desk.md"),
    `---\nname: loom-desk\nmetadata:\n  type: env\n  created: 2026-07-10T00:00:00.000Z\n---\n\nThe host box for [[jason]].\n`
  );
  try {
    const mem = harvestMemory(dir, Date.parse("2026-07-25T00:00:00.000Z"));
    assert.equal(mem.available, true);
    assert.equal(mem.nodeCount, 2);
    assert.equal(mem.edgeCount, 1); // jason<->loom-desk, de-duplicated
    const jason = mem.nodes.find((n) => n.name === "jason");
    assert.equal(jason.type, "person");
    assert.equal(jason.degree, 1);
    assert.deepEqual(mem.edges[0], { from: "jason", to: "loom-desk" });

    const serialized = JSON.stringify(mem);
    assert.ok(!serialized.includes("OWNER_ID"), "memory body must not appear");
    assert.ok(!serialized.includes("qM_NqRE"), "token from body must not appear");
    assert.ok(!serialized.includes("[["), "no raw wiki-link syntax");
    // And it survives the public gate.
    assert.doesNotThrow(() => assertPublicText(serialized, "memory"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("memory graph relabels discord-id node names and survives the public gate", () => {
  const dir = mkdtempSync(join(tmpdir(), "mx-mem-id-"));
  const memDir = join(dir, "memory", "people");
  mkdirSync(memDir, { recursive: true });
  const SNOWFLAKE = "1151230208783945818";
  // A person memory whose frontmatter name IS the raw discord id, linked to a normal node.
  writeFileSync(
    join(memDir, `${SNOWFLAKE}.md`),
    `---\nname: ${SNOWFLAKE}\nmetadata:\n  type: person\n  created: 2026-07-01T00:00:00.000Z\n---\n\nWorks with [[loom-desk]].\n`
  );
  writeFileSync(
    join(dir, "memory", "loom-desk.md"),
    `---\nname: loom-desk\nmetadata:\n  type: env\n  created: 2026-07-10T00:00:00.000Z\n---\n\nHost box, owned by [[${SNOWFLAKE}]].\n`
  );
  try {
    const mem = harvestMemory(dir, Date.parse("2026-07-25T00:00:00.000Z"));
    assert.equal(mem.available, true);
    assert.equal(mem.nodeCount, 2);
    assert.equal(mem.edgeCount, 1); // person<->loom-desk, both link directions de-duplicated

    const serialized = JSON.stringify(mem);
    assert.ok(!serialized.includes(SNOWFLAKE), "bare discord snowflake must not appear anywhere");
    // The person node is still present under a stable, non-identifying label.
    const person = mem.nodes.find((n) => n.type === "person");
    assert.match(person.name, /^person-[0-9a-f]{8}$/, "id-shaped name becomes a person-<hash> label");
    assert.equal(person.degree, 1, "topology preserved: the relabelled node keeps its edge");
    // Same id → same label on both the node and the edge endpoint.
    assert.ok(mem.edges.some((e) => e.from === person.name || e.to === person.name));
    // And it survives the public gate.
    assert.doesNotThrow(() => assertPublicText(serialized, "memory"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("activity events are {ts,kind,ref,title} newest-first, capped at the limit", () => {
  const dir = mkdtempSync(join(tmpdir(), "mx-act-"));
  mkdirSync(join(dir, "events"), { recursive: true });
  writeFileSync(join(dir, "tasks.json"), JSON.stringify({ tasks: [{ number: 5, title: "Fix the thing" }] }));
  const rows = [
    { ts: "2026-07-01T00:00:00.000Z", ticketRef: "#5", stage: "state:in_progress", outcome: "info" },
    { ts: "2026-07-03T00:00:00.000Z", ticketRef: "#5.1", stage: "state:done", outcome: "info" },
    { ts: "2026-07-02T00:00:00.000Z", ticketRef: "#5", stage: "publish", outcome: "passed", message: "should not leak" },
  ];
  writeFileSync(join(dir, "events", "dispatch.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  try {
    const acts = harvestActivity(dir, 2);
    assert.equal(acts.length, 2);
    assert.ok(acts[0].ts >= acts[1].ts, "newest first");
    for (const a of acts) assert.deepEqual(Object.keys(a).sort(), ["kind", "ref", "title", "ts"]);
    const done = acts.find((a) => a.kind === "done");
    assert.equal(done.title, "Fix the thing"); // looked up from tasks.json by base ref #5
    assert.ok(!JSON.stringify(acts).includes("should not leak"), "dispatch message must not leak");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
