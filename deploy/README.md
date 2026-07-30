# Deploy units — Beckett metrics

Systemd units and the idempotent installer for the metrics dashboard and its data refresh.

## Units

| Unit | Scope | Role |
| --- | --- | --- |
| `beckett-metrics.service` | user | Static dashboard server on `127.0.0.1:8971`. |
| `beckett-metrics-refresh.service` | system | Oneshot: harvest + atomic publish (`scripts/refresh-metrics.sh`). |
| `beckett-metrics-refresh.timer` | system | Fires the refresh **every 60s**. |
| `beckett-metrics-watch.path` | system | Watches `~/.beckett/tasks.json` and `~/.beckett/events/`. |
| `beckett-metrics-watch.service` | system | Oneshot: debounced refresh (`scripts/watch-refresh.sh`, ≤1 per 15s). |

The refresh runs on two triggers that share the same atomic publish:

- **Timer** — a steady 60s floor so data is never more than ~a minute stale.
- **Event-driven `.path` watcher** — fires within seconds of a task/event write, debounced to
  **at most once per 15s** (`METRICS_DEBOUNCE_SECONDS`) so bursts of writes coalesce into one
  publish. `PathModified` on the `events/` directory catches new per-day files; in-file appends
  are still swept up by the 60s timer.

The publish is unchanged and stays atomic: `refresh-metrics.sh` harvests into a temp file,
runs the privacy check, then `mv -f` into place. A failed harvest exits non-zero **before** the
`mv`, so the last-good `metrics.json` stays live.

## Failure alerting (#143)

Because a failed refresh leaves the last-good document serving, a wedged harvest is *silent* — it
once failed 7180 times over three days unnoticed. So the refresh keeps a two-line streak counter
next to the served dir (`refresh-state`, override with `METRICS_REFRESH_STATE`) that survives every
oneshot invocation:

- Every failure increments the counter and names the failing step; any success resets it to zero.
- On the **Nth consecutive** failure (`METRICS_FAIL_THRESHOLD`, default **10**) it posts **one**
  line to the beckett channel (`METRICS_ALERT_CHANNEL`, default `1520986792373911622`) via
  `beckett discord reply` — naming the step and a **sanitised** last-error line (quoted samples,
  parenthesised detail, absolute paths and stack frames are stripped, so a privacy-scan failure can
  never echo the value it caught). It does not alert again until the streak resets.
- The **first success after an alerted streak** posts one recovery line.

The served `metrics.json` carries `refreshed_at`, stamped at the start of each run and committed
**only** on a fully successful publish — so it is always the timestamp of the last *good* harvest,
which the dashboard can trust as an age signal.

**Manual smoke test** (mirrors `scripts/refresh-alert.test.mjs`): point the refresh at a scratch
serve dir and state file, force a failing step, and watch the streak/alert with a low threshold:

```bash
export METRICS_SERVE_DIR=/tmp/m/dist METRICS_REFRESH_STATE=/tmp/m/state
export METRICS_FAIL_THRESHOLD=2 METRICS_ALERT_CHANNEL=<your-test-channel>
# break a step, run twice → the 2nd run posts one alert; fix it, run once → one recovery line.
scripts/refresh-metrics.sh; cat "$METRICS_REFRESH_STATE"
```

The automated version of this (streak persists, alerts once, never repeats, recovers once, and
`refreshed_at` only advances on success) runs under `npm test`.

## Install (one command)

```bash
sudo deploy/install-units.sh
```

This is idempotent — re-running it just re-drops the files and reloads. It installs the system
units to `/etc/systemd/system`, enables the 60s timer and the `.path` watcher, and (re)installs
the user dashboard unit for `$SUDO_USER`.

**Privileged step:** installing/enabling the *system* units (`refresh.*`, `watch.*`) requires
root — that is the `sudo` above. Without root the script installs only the user dashboard unit
and prints the exact `sudo` command still needed. The user dashboard unit itself needs no root
(`systemctl --user`).

## Measured harvester runtimes

Measured on this host (`/usr/bin/time`), which decides whether the harvest needs splitting:

| Pass | Runtime |
| --- | --- |
| `harvest-telemetry.ts` (tasks, events, spend, activity, …) | ~5.0s |
| `harvest-code-stats.ts` (walks local git history) | ~0.65s |
| `prepare-data.mjs` (rollups + privacy scan) | ~1.45s |
| **Full refresh, end to end** | **~7s** |

~7s sits comfortably inside the 60s interval (≈12% duty cycle), and the event-driven path is
debounced to 15s, so **no fast/slow split is required** — the full harvest runs on every tick.
(The code-stats pass caches its git aggregates, which is why the reputedly "expensive" walk is
sub-second here; if it ever grows past the interval, split it onto the timer's slower cadence and
merge in `prepare-data.mjs`.)

## Manual UI/code publish

Data refreshes are automatic; shipping UI or code changes is one command:

```bash
scripts/publish-ui.sh
```

It runs `bunx --no-install vite build`, folds `src/generated/metrics.json` into `dist/`, swaps
the build into `METRICS_SERVE_DIR`, restarts `beckett-metrics.service`, and curls `/` and
`/metrics.json` — failing loudly unless both return 200.
