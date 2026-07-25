/*
 * Quick-agent section — sourced from ~/.beckett/quick/<runId>/.
 *
 * Each run is a directory. When a run records a status/meta file we read the agent type and
 * outcome from it; otherwise we fall back to a coarse "delivered vs empty" outcome based on
 * whether the run produced any artifact beyond its mcp.json config. Either way we emit counts
 * only.
 *
 * PUBLIC-SAFE: run directories contain mcp.json with a browser CONTROL TOKEN and playwright
 * page dumps — none of that is read. We inspect directory listings and, if present, small
 * status files, taking only the `agentType`/`outcome` scalar fields.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { beckettDir, readJsonSafe, bump, countRows, text } from "./shared.mjs";

const empty = () => ({ available: false, total: 0, byType: [], byOutcome: [] });

const STATUS_FILES = ["status.json", "result.json", "meta.json", "run.json"];

export function harvestQuick(dir = beckettDir()) {
  const root = join(dir, "quick");
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return empty();
  }
  if (entries.length === 0) return empty();

  const byType = new Map();
  const byOutcome = new Map();

  for (const e of entries) {
    const runDir = join(root, e.name);
    let meta = null;
    for (const f of STATUS_FILES) {
      meta = readJsonSafe(join(runDir, f));
      if (meta && typeof meta === "object") break;
    }

    const type = (meta && (text(meta.agentType) || text(meta.agent) || text(meta.type))) || "unknown";
    bump(byType, type);

    let outcome = meta && (text(meta.outcome) || text(meta.state) || text(meta.status));
    if (!outcome) {
      // No structured outcome: infer from whether the run left any artifact behind.
      let files = [];
      try {
        files = readdirSync(runDir).filter((n) => n !== "mcp.json" && !n.startsWith("."));
      } catch {
        /* unreadable run dir */
      }
      outcome = files.length ? "delivered" : "empty";
    }
    bump(byOutcome, outcome);
  }

  return {
    available: true,
    total: entries.length,
    byType: countRows(byType, "type"),
    byOutcome: countRows(byOutcome, "outcome"),
  };
}
