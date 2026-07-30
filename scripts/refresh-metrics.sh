#!/usr/bin/env bash
# Harvest and publish just the runtime data document. Nothing in the served directory changes
# until every source, rollup, and privacy check has succeeded.
#
# Failure is deliberately non-fatal to the live view: on any error the last-good metrics.json
# stays served, untouched. The price of that resilience is silence — a wedged refresh can keep
# failing indefinitely while the dashboard serves a frozen-but-valid document. It once failed
# 7180 times across three days with nothing anywhere saying so (#143). So alongside the publish we
# keep a tiny cross-invocation failure counter (scripts/lib/refresh-alert.sh): once a streak
# crosses METRICS_FAIL_THRESHOLD we announce it to the beckett channel exactly once, then announce
# the first recovery. The served metrics.json's `refreshed_at` is stamped from this run and is only
# ever committed on full success, so it always names the last GOOD harvest — a trustworthy age
# signal for the dashboard.
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "${script_dir}/.." && pwd)
serve_dir=${METRICS_SERVE_DIR:-"${HOME}/.local/share/beckett-metrics/dist"}
# Persist the failure streak next to (not inside) the served dir: it must survive every systemd
# invocation, yet must never be swept into the public directory.
state_file=${METRICS_REFRESH_STATE:-"$(dirname -- "$serve_dir")/refresh-state"}
alert_channel=${METRICS_ALERT_CHANNEL:-1520986792373911622}
fail_threshold=${METRICS_FAIL_THRESHOLD:-10}

# shellcheck source=scripts/lib/refresh-alert.sh
source "${script_dir}/lib/refresh-alert.sh"

# Timestamp of THIS harvest, committed into metrics.json only on the successful atomic publish
# below. Because a failed run never reaches the publish, the served document's refreshed_at is
# always the moment of the last good harvest.
refreshed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

temporary_file=""
error_log=$(mktemp)
current_step="startup"

# Prior streak, read once up front so the EXIT trap can decide whether to alert or recover.
ra_read_state "$state_file"

send_alert() {
  # Best-effort: a failed delivery must never change our exit status or mask the real error.
  beckett discord reply --channel "$alert_channel" "$1" >/dev/null 2>&1 \
    || echo "[metrics-refresh] WARN: could not deliver alert to channel ${alert_channel}" >&2
}

on_exit() {
  local status=$?
  if [[ -n "${temporary_file}" && -e "${temporary_file}" ]]; then rm -f -- "${temporary_file}"; fi

  if (( status == 0 )); then
    # Success resets the streak. If we had announced this streak, announce the recovery once.
    if (( RA_ALERTED == 1 )); then
      send_alert "$(ra_recovery_line "$RA_FAILURES")"
      echo "[metrics-refresh] recovered after ${RA_FAILURES} failed run(s); recovery announced" >&2
    fi
    ra_write_state "$state_file" 0 0
  else
    echo "[metrics-refresh] failed; the last-good ${serve_dir}/metrics.json remains live" >&2
    local streak=$(( RA_FAILURES + 1 ))
    if (( streak >= fail_threshold && RA_ALERTED == 0 )); then
      local reason
      reason=$(ra_extract_reason "$error_log")
      send_alert "$(ra_failure_line "$streak" "$current_step" "$reason")"
      echo "[metrics-refresh] ${streak} consecutive failures — alerted channel ${alert_channel}" >&2
      ra_write_state "$state_file" "$streak" 1
    else
      # Below threshold, or already alerted for this streak: count it, stay quiet.
      ra_write_state "$state_file" "$streak" "$RA_ALERTED"
    fi
  fi

  rm -f -- "$error_log" 2>/dev/null || true
  exit "$status"
}
trap on_exit EXIT

# Run one pipeline step, capturing its stderr so a failure can be summarised into the alert while
# the full text still reaches the journal. Naming the step lets the alert say where it broke.
step() {
  current_step="$1"
  shift
  : >"$error_log"
  local rc=0
  "$@" 2>>"$error_log" || rc=$?
  # Surface whatever the step wrote to stderr (errors and warnings alike) to the journal.
  [[ -s "$error_log" ]] && cat -- "$error_log" >&2
  return "$rc"
}

cd "$repo_root"
echo "[metrics-refresh] harvesting into ${repo_root}/data"
step harvest-telemetry        bun scripts/harvest-telemetry.ts
step harvest-code-stats       bun scripts/harvest-code-stats.ts
step harvest-claude-sessions  bun scripts/harvest-claude-sessions.ts
step prepare-data             env METRICS_REFRESHED_AT="$refreshed_at" node scripts/prepare-data.mjs
step verify-public-metrics    node scripts/verify-public-metrics.mjs src/generated/metrics.json

# mktemp beside the target and rename: POSIX rename is atomic within this filesystem, so
# python http.server sees either the complete old JSON or the complete new JSON, never a copy.
current_step="publish"
: >"$error_log"
mkdir -p "$serve_dir"
temporary_file=$(mktemp "${serve_dir}/.metrics.json.XXXXXX")
cp -- src/generated/metrics.json "$temporary_file"
step verify-public-metrics-staged  node scripts/verify-public-metrics.mjs "$temporary_file"
# Plausibility gate: reject an implausible collapse (zero runs/spend/models, or totalRuns
# dropping far below the live document) before it can overwrite the last-good metrics.json.
step plausibility-gate  node scripts/verify-plausible-metrics.mjs "$temporary_file" "${serve_dir}/metrics.json"
chmod 0644 "$temporary_file"
mv -f -- "$temporary_file" "${serve_dir}/metrics.json"
temporary_file=""
echo "[metrics-refresh] published ${serve_dir}/metrics.json atomically"
