#!/usr/bin/env bash
# Idempotent installer for the Beckett metrics systemd units. Safe to re-run: it copies the
# unit files into place, reloads systemd, and enables what should be enabled. Running it twice
# leaves the system in the same state as running it once.
#
# Split by scope (matching how they are wired today):
#   - system units (require root): the refresh timer/service and the event-driven watcher,
#     which read /home/beckett/.beckett and publish to /home/beckett/.local/share.
#   - user unit: the dashboard static server (systemctl --user).
#
# The system half needs a privileged install. Run the whole thing with:
#     sudo deploy/install-units.sh
# and it will re-drop the --user unit as the invoking (SUDO_USER) account. Without root it
# installs only the user unit and prints exactly which privileged step still has to be run.
set -euo pipefail

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

SYSTEM_UNITS=(
  beckett-metrics-refresh.service
  beckett-metrics-refresh.timer
  beckett-metrics-watch.service
  beckett-metrics-watch.path
)
USER_UNITS=(
  beckett-metrics.service
)

install_system() {
  echo "[install-units] installing system units into /etc/systemd/system"
  for unit in "${SYSTEM_UNITS[@]}"; do
    install -m 0644 -- "${here}/${unit}" "/etc/systemd/system/${unit}"
    echo "  + ${unit}"
  done
  systemctl daemon-reload
  # Enabling the timer and the path watcher is what actually schedules refreshes.
  systemctl enable --now beckett-metrics-refresh.timer
  systemctl enable --now beckett-metrics-watch.path
  echo "[install-units] system units enabled (timer @60s + event-driven .path watcher)"
}

install_user() {
  local runner="$1"
  echo "[install-units] installing user units for ${runner}"
  if [[ "$runner" == "$(id -un)" ]]; then
    dest="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
    mkdir -p "$dest"
    for unit in "${USER_UNITS[@]}"; do
      install -m 0644 -- "${here}/${unit}" "${dest}/${unit}"
      echo "  + ${unit}"
    done
    systemctl --user daemon-reload
    systemctl --user enable --now beckett-metrics.service
  else
    # Re-invoke this function as the target user so --user targets the right bus.
    sudo -u "$runner" XDG_RUNTIME_DIR="/run/user/$(id -u "$runner")" \
      bash -c "$(declare -f install_user); install_user '$runner'"
  fi
  echo "[install-units] user dashboard service installed and enabled"
}

if [[ "$(id -u)" -eq 0 ]]; then
  target_user=${SUDO_USER:-beckett}
  install_system
  install_user "$target_user"
  echo "[install-units] done."
else
  install_user "$(id -un)"
  cat >&2 <<EOF
[install-units] NOTE: system units were NOT installed (no root).
[install-units] Run the privileged step to install the refresh timer + event watcher:
[install-units]     sudo ${here}/install-units.sh
EOF
fi
