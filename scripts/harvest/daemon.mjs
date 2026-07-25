/*
 * Daemon-health section — beckett CLI version + systemd --user service state.
 *
 * Shells out to `beckett --version` and `systemctl --user show` for the beckett* units. Both
 * are optional: on a box without systemd or the CLI (a clean checkout, CI) this returns
 * available:false rather than throwing.
 *
 * PUBLIC-SAFE: unit names, active/sub state and uptime seconds only — no unit descriptions
 * (which mention Discord) and no environment.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const empty = () => ({ available: false, version: null, services: [] });

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

function procUptimeSeconds() {
  try {
    return parseFloat(readFileSync("/proc/uptime", "utf8").split(" ")[0]);
  } catch {
    return null;
  }
}

export function harvestDaemon() {
  const version = (() => {
    const out = sh("beckett", ["--version"]) ?? sh("beckett", ["version"]);
    if (!out) return null;
    const m = out.match(/\d+\.\d+\.\d+/);
    return m ? m[0] : out.trim().split("\n")[0].slice(0, 40) || null;
  })();

  const listing = sh("systemctl", ["--user", "list-units", "--type=service", "--all", "--no-legend", "--plain", "beckett*"]);
  const services = [];
  if (listing) {
    const bootUptime = procUptimeSeconds();
    for (const line of listing.split("\n")) {
      const unit = line.trim().split(/\s+/)[0];
      if (!unit || !unit.endsWith(".service")) continue;
      const show = sh("systemctl", ["--user", "show", unit, "--property=ActiveState,SubState,ActiveEnterTimestampMonotonic"]);
      if (!show) continue;
      const props = Object.fromEntries(
        show
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            const i = l.indexOf("=");
            return [l.slice(0, i), l.slice(i + 1)];
          })
      );
      let uptimeSeconds = null;
      const mono = Number(props.ActiveEnterTimestampMonotonic);
      if (props.ActiveState === "active" && bootUptime != null && Number.isFinite(mono) && mono > 0) {
        uptimeSeconds = Math.max(0, Math.round(bootUptime - mono / 1_000_000));
      }
      services.push({
        name: unit.replace(/\.service$/, ""),
        active: props.ActiveState ?? "unknown",
        subState: props.SubState ?? "unknown",
        uptimeSeconds,
      });
    }
  }

  const available = version != null || services.length > 0;
  return { available, version, services };
}
