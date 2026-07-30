// Coverage for the #143 failure-alert plumbing in refresh-metrics.sh + lib/refresh-alert.sh.
//
// Two layers:
//   1. Unit tests of the sourceable helpers (redaction + reason extraction) in a bare bash shell.
//   2. An end-to-end simulation that runs the REAL refresh-metrics.sh in a throwaway sandbox with
//      `bun`/`node`/`beckett` stubbed on PATH, so we can force a failure streak and a recovery and
//      assert: the counter persists across runs, exactly ONE alert fires on the Nth failure and is
//      not repeated, the alert names the step and a sanitised reason (no stack/quotes/paths/values),
//      ONE recovery line fires on the first success, and the served metrics.json's refreshed_at only
//      advances on success.
//
// Run: `node --test scripts/refresh-alert.test.mjs` (also covered by `npm test`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const LIB = join(here, "lib", "refresh-alert.sh");
const REFRESH = join(here, "refresh-metrics.sh");

/** Source the lib in a fresh bash and run `snippet`; return trimmed stdout. */
function bashWithLib(snippet) {
  const r = spawnSync("bash", ["-c", `set -euo pipefail; source ${JSON.stringify(LIB)}\n${snippet}`], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `bash snippet failed: ${r.stderr}`);
  return r.stdout.replace(/\n$/, "");
}

test("ra_sanitize_reason strips scanned values, paths, quotes and parens", () => {
  // Mirrors a real privacy-scan throw, whose message quotes the very value it caught.
  const dirty = `privacy check failed for /home/beckett/x.json: email address ("leak@example.com")`;
  const clean = bashWithLib(`printf '%s' ${JSON.stringify(dirty)} | ra_sanitize_reason`);
  assert.ok(!clean.includes("leak@example.com"), `leaked scanned value: ${clean}`);
  assert.ok(!clean.includes("/home/"), `leaked absolute path: ${clean}`);
  assert.ok(!clean.includes('"') && !clean.includes("("), `left quotes/parens: ${clean}`);
  assert.ok(/privacy check failed/.test(clean), `dropped the useful gist: ${clean}`);
});

test("ra_extract_reason prefers the error message over stack frames and the node banner", () => {
  const log = join(mkdtempSync(join(tmpdir(), "ra-log-")), "err.log");
  writeFileSync(
    log,
    ["/app/scripts/x.mjs:12", "    throw new Error(msg);", "", "Error: harvest source went missing", "    at run (/home/beckett/x.mjs:1:1)", "Node.js v20.11.0", ""].join("\n"),
  );
  const reason = bashWithLib(`ra_extract_reason ${JSON.stringify(log)}`);
  assert.ok(/harvest source went missing/.test(reason), `wrong line: ${reason}`);
  assert.ok(!/Node\.js v/.test(reason) && !/^\s*at /.test(reason), `picked a frame/banner: ${reason}`);
});

test("ra state file round-trips and resets", () => {
  const dir = mkdtempSync(join(tmpdir(), "ra-state-"));
  const f = join(dir, "nested", "state");
  const out = bashWithLib(
    `ra_write_state ${JSON.stringify(f)} 4 1; ra_read_state ${JSON.stringify(f)}; printf '%s/%s' "$RA_FAILURES" "$RA_ALERTED"`,
  );
  assert.equal(out, "4/1");
  const reset = bashWithLib(`ra_read_state ${JSON.stringify(join(dir, "does-not-exist"))}; printf '%s/%s' "$RA_FAILURES" "$RA_ALERTED"`);
  assert.equal(reset, "0/0", "a missing state file must read as a clean slate");
});

// --- End-to-end simulation -------------------------------------------------------------------

const OLD_STAMP = "2000-01-01T00:00:00Z";

function makeStub(path, body) {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

/** Build a self-contained sandbox holding a copy of the real script + stubbed toolchain. */
function makeSandbox() {
  const sbx = mkdtempSync(join(tmpdir(), "refresh-e2e-"));
  mkdirSync(join(sbx, "scripts", "lib"), { recursive: true });
  mkdirSync(join(sbx, "src", "generated"), { recursive: true });
  mkdirSync(join(sbx, "serve"), { recursive: true });
  mkdirSync(join(sbx, "bin"), { recursive: true });
  mkdirSync(join(sbx, "log"), { recursive: true });

  copyFileSync(REFRESH, join(sbx, "scripts", "refresh-metrics.sh"));
  copyFileSync(LIB, join(sbx, "scripts", "lib", "refresh-alert.sh"));

  // A last-good served document so we can prove refreshed_at only advances on success.
  writeFileSync(
    join(sbx, "serve", "metrics.json"),
    JSON.stringify({ schema_version: 2, refreshed_at: OLD_STAMP, headline: { totalRuns: 42, totalSpend: 1.5, modelsUsed: 3 } }),
  );

  // `bun`: fail iff STUB_FAIL_STEP names one of its args (a harvest pass), else succeed.
  makeStub(
    join(sbx, "bin", "bun"),
    `#!/usr/bin/env bash
if [[ -n "\${STUB_FAIL_STEP:-}" ]]; then
  for a in "\$@"; do
    if [[ "\$a" == *"\$STUB_FAIL_STEP"* ]]; then
      echo "scripts/\$STUB_FAIL_STEP:12" >&2
      echo "error: boom in \$a for user \\"leak@example.com\\" under /home/beckett/thing" >&2
      echo "    at foo (/home/beckett/x.ts:1:1)" >&2
      echo "Node.js v20.11.0" >&2
      exit 1
    fi
  done
fi
exit 0
`,
  );

  // `node`: same failure hook; prepare-data writes a generated doc stamped with the run's
  // METRICS_REFRESHED_AT; the verify/plausible gates just pass.
  makeStub(
    join(sbx, "bin", "node"),
    `#!/usr/bin/env bash
if [[ -n "\${STUB_FAIL_STEP:-}" ]]; then
  for a in "\$@"; do
    if [[ "\$a" == *"\$STUB_FAIL_STEP"* ]]; then
      echo "error: boom in \$a" >&2
      exit 1
    fi
  done
fi
for a in "\$@"; do
  case "\$a" in
    *prepare-data.mjs)
      printf '{"schema_version":2,"refreshed_at":"%s","headline":{"totalRuns":42,"totalSpend":1.5,"modelsUsed":3}}\\n' "\${METRICS_REFRESHED_AT:-unset}" > src/generated/metrics.json
      exit 0 ;;
  esac
done
exit 0
`,
  );

  // `beckett`: record the alert text (the last positional arg) one line per delivery.
  makeStub(
    join(sbx, "bin", "beckett"),
    `#!/usr/bin/env bash
msg="\${@: -1}"
printf '%s\\n' "\$msg" >> "\$BECKETT_LOG"
exit 0
`,
  );

  return sbx;
}

function runRefresh(sbx, { failStep = "", threshold = 3 } = {}) {
  const env = {
    ...process.env,
    PATH: `${join(sbx, "bin")}:${process.env.PATH}`,
    HOME: sbx,
    METRICS_SERVE_DIR: join(sbx, "serve"),
    METRICS_REFRESH_STATE: join(sbx, "state"),
    METRICS_ALERT_CHANNEL: "999",
    METRICS_FAIL_THRESHOLD: String(threshold),
    BECKETT_LOG: join(sbx, "log", "beckett.log"),
    STUB_FAIL_STEP: failStep,
  };
  return spawnSync("bash", [join(sbx, "scripts", "refresh-metrics.sh")], { env, encoding: "utf8" });
}

const alertLines = (sbx) => {
  const p = join(sbx, "log", "beckett.log");
  return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean) : [];
};
const state = (sbx) => {
  const raw = readFileSync(join(sbx, "state"), "utf8");
  return {
    failures: Number(raw.match(/failures=(\d+)/)[1]),
    alerted: Number(raw.match(/alerted=(\d)/)[1]),
  };
};
const servedStamp = (sbx) => JSON.parse(readFileSync(join(sbx, "serve", "metrics.json"), "utf8")).refreshed_at;

test("failure streak alerts exactly once, never repeats, then recovers exactly once", () => {
  const sbx = makeSandbox();
  try {
    // Runs 1..2: below the threshold of 3 — counted, silent, served doc untouched.
    for (let i = 1; i <= 2; i++) {
      const r = runRefresh(sbx, { failStep: "harvest-telemetry" });
      assert.equal(r.status, 1, `run ${i} should exit non-zero`);
      assert.deepEqual(state(sbx), { failures: i, alerted: 0 });
      assert.equal(alertLines(sbx).length, 0, `no alert expected on run ${i}`);
      assert.equal(servedStamp(sbx), OLD_STAMP, "a failed run must not touch the served document");
    }

    // Run 3: crosses the threshold — exactly one alert, naming the step and a safe reason.
    assert.equal(runRefresh(sbx, { failStep: "harvest-telemetry" }).status, 1);
    assert.deepEqual(state(sbx), { failures: 3, alerted: 1 });
    let alerts = alertLines(sbx);
    assert.equal(alerts.length, 1, "exactly one alert on the Nth failure");
    const alert = alerts[0];
    assert.ok(/failed 3 runs in a row/.test(alert), `alert should count the streak: ${alert}`);
    assert.ok(/harvest-telemetry/.test(alert), `alert should name the step: ${alert}`);
    assert.ok(/last error:/.test(alert), `alert should carry a reason: ${alert}`);
    // No stack trace, no scanned value, no absolute path.
    assert.ok(!alert.includes("leak@example.com"), `alert leaked a scanned value: ${alert}`);
    assert.ok(!/Node\.js v/.test(alert) && !/\bat foo\b/.test(alert), `alert pasted a stack trace: ${alert}`);
    assert.ok(!alert.includes("/home/"), `alert pasted an absolute path: ${alert}`);
    assert.ok(!alert.includes("\n"), "alert must be a single line");

    // Runs 4..5: streak continues but must stay silent (already alerted).
    for (let i = 4; i <= 5; i++) {
      assert.equal(runRefresh(sbx, { failStep: "harvest-telemetry" }).status, 1);
      assert.deepEqual(state(sbx), { failures: i, alerted: 1 });
      assert.equal(alertLines(sbx).length, 1, `no repeat alert on run ${i}`);
    }

    // First success: resets the streak, advances refreshed_at, and announces recovery once.
    assert.equal(runRefresh(sbx, { failStep: "" }).status, 0);
    assert.deepEqual(state(sbx), { failures: 0, alerted: 0 });
    alerts = alertLines(sbx);
    assert.equal(alerts.length, 2, "one recovery line after the alerted streak");
    assert.ok(/recovered after 5 failed runs/.test(alerts[1]), `recovery should name the streak: ${alerts[1]}`);
    assert.notEqual(servedStamp(sbx), OLD_STAMP, "a success must advance the served refreshed_at");

    // A second success stays quiet — no duplicate recovery.
    assert.equal(runRefresh(sbx, { failStep: "" }).status, 0);
    assert.deepEqual(state(sbx), { failures: 0, alerted: 0 });
    assert.equal(alertLines(sbx).length, 2, "recovery must not repeat");
  } finally {
    rmSync(sbx, { recursive: true, force: true });
  }
});

test("a short streak that never reached the threshold recovers silently", () => {
  const sbx = makeSandbox();
  try {
    // Two failures (threshold 3) then success: never alerted, so no recovery line either.
    runRefresh(sbx, { failStep: "prepare-data" });
    runRefresh(sbx, { failStep: "prepare-data" });
    assert.deepEqual(state(sbx), { failures: 2, alerted: 0 });
    assert.equal(runRefresh(sbx, { failStep: "" }).status, 0);
    assert.deepEqual(state(sbx), { failures: 0, alerted: 0 });
    assert.equal(alertLines(sbx).length, 0, "no alert and no recovery for a sub-threshold streak");
  } finally {
    rmSync(sbx, { recursive: true, force: true });
  }
});
