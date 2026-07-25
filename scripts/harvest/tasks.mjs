/*
 * Tickets section — sourced from ~/.beckett/tasks.json.
 *
 * Rolls the task ledger into: counts by status, opened/closed per day, created→done lead time,
 * branches per task, and the share of tasks that needed rework. The dispatch event log
 * (events/dispatch.jsonl) is consulted as a secondary signal for the exact done-time and the
 * review-bounce that marks rework; if it is absent those degrade gracefully.
 *
 * PUBLIC-SAFE: emits status labels, dates, counts and distributions only — never a ticket
 * description, channel id, or worktree path. Ticket titles are not needed here (they ride in
 * recentActivity), so this section carries no free text at all.
 */
import { join } from "node:path";
import { beckettDir, readJsonSafe, readJsonlSafe, round, dayOf, bump, countRows, fillDays, percentile, mean } from "./shared.mjs";

const empty = () => ({
  available: false,
  total: 0,
  byStatus: [],
  openedClosedPerDay: [],
  leadTimeDays: { count: 0, mean: 0, p50: 0, p90: 0, max: 0 },
  branchesPerTask: { mean: 0, max: 0, distribution: [] },
  reworkShare: null,
});

// "#10.1" / "#10" / 10 -> "#10" (task-level ref, branch suffix stripped).
function baseRef(ref) {
  const s = String(ref ?? "").trim();
  const m = s.match(/#?(\d+)/);
  return m ? `#${m[1]}` : null;
}

export function harvestTasks(dir = beckettDir()) {
  const doc = readJsonSafe(join(dir, "tasks.json"));
  const tasks = doc && Array.isArray(doc.tasks) ? doc.tasks : null;
  if (!tasks) return empty();

  // Secondary signal from the dispatch stream: first state:done ts and any review bounce,
  // keyed by task-level ref. Absent stream -> empty maps, everything still works.
  const doneAt = new Map();
  const reworked = new Set();
  for (const ev of readJsonlSafe(join(dir, "events", "dispatch.jsonl"))) {
    const ref = baseRef(ev?.ticketRef);
    if (!ref) continue;
    if (ev.stage === "state:done" && typeof ev.ts === "string" && !doneAt.has(ref)) doneAt.set(ref, ev.ts);
    if (ev.outcome === "bounced") reworked.add(ref);
  }

  const byStatus = new Map();
  const perDay = new Map(); // day -> { opened, closed }
  const leadDays = [];
  const branchCounts = [];
  const branchHist = new Map();
  let reworkedTasks = 0;

  for (const t of tasks) {
    if (!t || typeof t !== "object") continue;
    const status = typeof t.status === "string" ? t.status : "unknown";
    bump(byStatus, status);

    const openDay = dayOf(t.createdAt);
    if (openDay) dayBucket(perDay, openDay).opened += 1;

    const ref = t.number != null ? `#${t.number}` : null;
    const terminal = status === "done" || status === "cancelled";
    // Closed-time: prefer the dispatch done event, else the ledger's last-updated stamp.
    const closeIso = (ref && doneAt.get(ref)) || (terminal ? t.updatedAt : null);
    const closeDay = dayOf(closeIso);
    if (terminal && closeDay) dayBucket(perDay, closeDay).closed += 1;

    if (status === "done" && openDay && closeIso) {
      const ms = new Date(closeIso).getTime() - new Date(t.createdAt).getTime();
      if (Number.isFinite(ms) && ms >= 0) leadDays.push(ms / 86_400_000);
    }

    const branches = Array.isArray(t.branches) ? t.branches.length : 0;
    branchCounts.push(branches);
    bump(branchHist, branches);

    if (ref && reworked.has(ref)) reworkedTasks++;
  }

  const branchDist = [...branchHist.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([branches, count]) => ({ branches, count }));

  return {
    available: true,
    total: tasks.length,
    byStatus: countRows(byStatus, "status"),
    openedClosedPerDay: fillDays(perDay, () => ({ opened: 0, closed: 0 })),
    leadTimeDays: {
      count: leadDays.length,
      mean: round(mean(leadDays), 2),
      p50: round(percentile(leadDays, 50), 2),
      p90: round(percentile(leadDays, 90), 2),
      max: leadDays.length ? round(Math.max(...leadDays), 2) : 0,
    },
    branchesPerTask: {
      mean: round(mean(branchCounts), 2),
      max: branchCounts.length ? Math.max(...branchCounts) : 0,
      distribution: branchDist,
    },
    // null when we had no dispatch stream to judge rework from — honestly "unknown", not "0%".
    reworkShare: reworked.size ? round(reworkedTasks / tasks.length, 3) : null,
  };
}

function dayBucket(map, day) {
  if (!map.has(day)) map.set(day, { opened: 0, closed: 0 });
  return map.get(day);
}
