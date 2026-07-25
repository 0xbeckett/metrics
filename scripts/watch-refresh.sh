#!/usr/bin/env bash
# Event-driven refresh entrypoint. The .path unit fires this on every change to the task
# ledger or event stream; systemd coalesces triggers that arrive while we run. On top of that
# we debounce here so the harvest runs AT MOST once per METRICS_DEBOUNCE_SECONDS (default 15s):
# if the previous refresh started less than that window ago, we sleep out the remainder before
# harvesting, absorbing bursts of file writes into a single publish.
#
# The actual harvest + atomic publish is delegated unchanged to refresh-metrics.sh, so the
# last-good metrics.json stays live on any failure exactly as before.
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
min_interval=${METRICS_DEBOUNCE_SECONDS:-15}

# Per-user, tmpfs-backed stamp so the throttle survives across triggers but not reboots.
state_dir=${XDG_RUNTIME_DIR:-/tmp}
stamp="${state_dir}/beckett-metrics-refresh.last"

now=$(date +%s)
if [[ -f "$stamp" ]]; then
  last=$(cat "$stamp" 2>/dev/null || echo 0)
  [[ "$last" =~ ^[0-9]+$ ]] || last=0
  elapsed=$(( now - last ))
  if (( elapsed >= 0 && elapsed < min_interval )); then
    sleep "$(( min_interval - elapsed ))"
  fi
fi

date +%s > "$stamp"
exec "${script_dir}/refresh-metrics.sh"
