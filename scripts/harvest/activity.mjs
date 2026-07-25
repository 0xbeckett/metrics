/*
 * recentActivity — the last 50 lifecycle events, newest first.
 *
 * Sourced from the dispatch stream (events/dispatch.jsonl): ticket state transitions (opened,
 * started, in-review, done, cancelled), worker finishes (implement/review verdicts), and
 * deploys (the publish stage). Ticket titles are looked up from tasks.json by ref.
 *
 * PUBLIC-SAFE: each event is emitted as { ts, kind, ref, title } only — ref is a ticket ref and
 * title is a ticket title, both explicitly allowed. The dispatch `message`/`error` fields
 * (which can carry raw output) are never read.
 */
import { join } from "node:path";
import { beckettDir, readJsonSafe, readJsonlSafe, text } from "./shared.mjs";

const STATE_KIND = {
  "state:todo": "opened",
  "state:in_progress": "started",
  "state:in_review": "in-review",
  "state:done": "done",
  "state:cancelled": "cancelled",
};

function baseRef(ref) {
  const m = String(ref ?? "").match(/#?(\d+)/);
  return m ? `#${m[1]}` : null;
}

export function harvestActivity(dir = beckettDir(), limit = 50) {
  const events = readJsonlSafe(join(dir, "events", "dispatch.jsonl"));
  if (events.length === 0) return [];

  // Ticket title lookup, keyed by "#<number>".
  const titles = new Map();
  const doc = readJsonSafe(join(dir, "tasks.json"));
  if (doc && Array.isArray(doc.tasks)) {
    for (const t of doc.tasks) {
      if (t && t.number != null && typeof t.title === "string") titles.set(`#${t.number}`, t.title);
    }
  }

  const out = [];
  for (const ev of events) {
    if (!ev || typeof ev !== "object" || typeof ev.ts !== "string") continue;
    let kind = null;
    if (STATE_KIND[ev.stage]) {
      kind = STATE_KIND[ev.stage];
    } else if (ev.stage === "publish" && (ev.outcome === "passed" || ev.outcome === "started")) {
      kind = "deploy";
    } else if ((ev.stage === "implement" || ev.stage === "review") && (ev.outcome === "passed" || ev.outcome === "failed")) {
      kind = "worker";
    }
    if (!kind) continue;
    const ref = text(ev.ticketRef);
    out.push({ ts: ev.ts, kind, ref: ref ?? null, title: (ref && titles.get(baseRef(ref))) ?? null });
  }

  // Newest first. dispatch.jsonl is roughly chronological; sort to be certain.
  out.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  return out.slice(0, limit);
}
