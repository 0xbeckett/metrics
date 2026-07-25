/*
 * Routines section — sourced from ~/.beckett/routines.json.
 *
 * Emits each routine's enabled state, action kind, and next/last fire time, plus headline
 * enabled/disabled counts and a by-kind breakdown.
 *
 * PUBLIC-SAFE: routine id/name/kind and ISO fire timestamps only. Action internals such as
 * credential-store entries or account handles are not emitted.
 */
import { join } from "node:path";
import { beckettDir, readJsonSafe, text, bump, countRows } from "./shared.mjs";

const empty = () => ({ available: false, total: 0, enabled: 0, disabled: 0, byKind: [], items: [] });

export function harvestRoutines(dir = beckettDir()) {
  const doc = readJsonSafe(join(dir, "routines.json"));
  const list = doc && Array.isArray(doc.routines) ? doc.routines : Array.isArray(doc) ? doc : null;
  if (!list) return empty();

  const byKind = new Map();
  let enabled = 0;
  const items = [];

  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const on = r.enabled === true;
    if (on) enabled += 1;
    const kind = (r.action && text(r.action.kind)) || "unknown";
    bump(byKind, kind);
    items.push({
      id: text(r.id) ?? null,
      name: text(r.name) ?? text(r.id) ?? "routine",
      kind,
      enabled: on,
      nextFireAt: (r.state && text(r.state.chosenFireAt)) || null,
      lastFiredAt: (r.state && text(r.state.lastFiredAt)) || null,
    });
  }

  return {
    available: true,
    total: items.length,
    enabled,
    disabled: items.length - enabled,
    byKind: countRows(byKind, "kind"),
    items,
  };
}
