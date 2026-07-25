/*
 * Browser-runs section — sourced from ~/.beckett/browser-agent/runs.json.
 *
 * Each entry describes one background browser run. We keep ONLY the aggregate shape: how many
 * ran, the outcome mix (by `state`), and the wall-duration distribution (finishedAt-startedAt).
 *
 * PUBLIC-SAFE: the raw runs carry the task prompt, the model's result text, and Discord
 * channel/requester ids — NONE of that is read here. Only `state` and the two timestamps.
 */
import { join } from "node:path";
import { beckettDir, readJsonSafe, bump, countRows, stats } from "./shared.mjs";

const empty = () => ({ available: false, total: 0, byOutcome: [], durationSeconds: {}, durationBuckets: [] });

const BUCKETS = [
  { label: "<15s", max: 15 },
  { label: "15–60s", max: 60 },
  { label: "1–3m", max: 180 },
  { label: "3–6m", max: 360 },
  { label: ">6m", max: Infinity },
];

export function harvestBrowser(dir = beckettDir()) {
  const runs = readJsonSafe(join(dir, "browser-agent", "runs.json"));
  if (!Array.isArray(runs)) return empty();

  const byOutcome = new Map();
  const durations = [];
  const bucketCounts = new Map(BUCKETS.map((b) => [b.label, 0]));

  for (const r of runs) {
    if (!r || typeof r !== "object") continue;
    bump(byOutcome, typeof r.state === "string" && r.state ? r.state : "unknown");
    if (typeof r.startedAt === "number" && typeof r.finishedAt === "number" && r.finishedAt >= r.startedAt) {
      const secs = (r.finishedAt - r.startedAt) / 1000;
      durations.push(secs);
      const bucket = BUCKETS.find((b) => secs < b.max) ?? BUCKETS[BUCKETS.length - 1];
      bucketCounts.set(bucket.label, (bucketCounts.get(bucket.label) ?? 0) + 1);
    }
  }

  return {
    available: true,
    total: runs.length,
    byOutcome: countRows(byOutcome, "outcome"),
    durationSeconds: stats(durations, 1),
    durationBuckets: BUCKETS.map((b) => ({ label: b.label, count: bucketCounts.get(b.label) ?? 0 })),
  };
}
