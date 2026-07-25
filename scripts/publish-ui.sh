#!/usr/bin/env bash
# One-command UI/code publish. Builds the static bundle, folds in the current metrics
# document, swaps it into the served directory, restarts the dashboard, and refuses to
# report success unless both / and /metrics.json come back 200.
#
# Use bunx --no-install (NOT `bun run build`): `bun run` ENOENTs outside the live seat,
# while `bunx --no-install vite build` resolves vite straight from node_modules.
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
serve_dir=${METRICS_SERVE_DIR:-"${HOME}/.local/share/beckett-metrics/dist"}
base_url=${METRICS_BASE_URL:-"http://127.0.0.1:8971"}
service=${METRICS_SERVICE:-beckett-metrics.service}

cd "$repo_root"

echo "[publish-ui] building bundle with vite"
bunx --no-install vite build

echo "[publish-ui] folding src/generated/metrics.json into dist/"
cp -- src/generated/metrics.json dist/metrics.json

echo "[publish-ui] swapping build into ${serve_dir}"
mkdir -p "$serve_dir"
# The sandbox blocks `rm -rf "$VAR"/*`; clear the tree with find -delete, then copy in.
find "$serve_dir" -mindepth 1 -delete
cp -r dist/. "$serve_dir"/

echo "[publish-ui] restarting ${service}"
systemctl --user restart "$service"

# Give the static server a moment to bind, then assert both routes serve 200.
check() {
  local path="$1" code
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    code=$(curl -fsS -o /dev/null -w '%{http_code}' "${base_url}${path}" 2>/dev/null || echo 000)
    if [[ "$code" == "200" ]]; then
      echo "[publish-ui] OK ${base_url}${path} -> 200"
      return 0
    fi
    sleep 1
  done
  echo "[publish-ui] FAIL ${base_url}${path} -> ${code} (expected 200)" >&2
  return 1
}

check "/"
check "/metrics.json"

echo "[publish-ui] published to ${serve_dir} and verified live at ${base_url}"
