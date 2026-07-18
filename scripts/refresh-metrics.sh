#!/usr/bin/env bash
# Harvest and publish just the runtime data document. Nothing in the served directory changes
# until every source, rollup, and privacy check has succeeded.
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
serve_dir=${METRICS_SERVE_DIR:-"${HOME}/.local/share/beckett-metrics/dist"}
temporary_file=""

cleanup() {
  status=$?
  if [[ -n "${temporary_file}" && -e "${temporary_file}" ]]; then rm -f -- "${temporary_file}"; fi
  if (( status != 0 )); then
    echo "[metrics-refresh] failed; the last-good ${serve_dir}/metrics.json remains live" >&2
  fi
  exit "$status"
}
trap cleanup EXIT

cd "$repo_root"
echo "[metrics-refresh] harvesting into ${repo_root}/data"
bun scripts/harvest-telemetry.ts
bun scripts/harvest-code-stats.ts
METRICS_REFRESHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" node scripts/prepare-data.mjs
node scripts/verify-public-metrics.mjs src/generated/metrics.json

# mktemp beside the target and rename: POSIX rename is atomic within this filesystem, so
# python http.server sees either the complete old JSON or the complete new JSON, never a copy.
mkdir -p "$serve_dir"
temporary_file=$(mktemp "${serve_dir}/.metrics.json.XXXXXX")
cp -- src/generated/metrics.json "$temporary_file"
node scripts/verify-public-metrics.mjs "$temporary_file"
chmod 0644 "$temporary_file"
mv -f -- "$temporary_file" "${serve_dir}/metrics.json"
temporary_file=""
echo "[metrics-refresh] published ${serve_dir}/metrics.json atomically"
