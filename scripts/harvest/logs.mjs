/*
 * Logs section — sourced from ~/.beckett/logs/*.log.
 *
 * Emits log volume (line counts) and an error rate. Per-day bucketing uses each file's mtime,
 * since these logs are rolling and their lines are not individually timestamped.
 *
 * PUBLIC-SAFE: only counts leave this harvester. Log lines are read to classify error-level
 * entries but are never emitted.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beckettDir, round, dayOf } from "./shared.mjs";

const empty = () => ({ available: false, files: 0, totalLines: 0, errorLines: 0, errorRate: 0, perDay: [] });

const ERROR_RE = /\b(error|fatal|panic|exception|failed|✗)\b/i;

export function harvestLogs(dir = beckettDir()) {
  const root = join(dir, "logs");
  let names;
  try {
    names = readdirSync(root).filter((n) => n.endsWith(".log"));
  } catch {
    return empty();
  }
  if (names.length === 0) return empty();

  const perDay = new Map(); // day -> { lines, errors }
  let totalLines = 0;
  let errorLines = 0;
  let filesRead = 0;

  for (const name of names) {
    const path = join(root, name);
    let raw;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    filesRead += 1;
    let lines = 0;
    let errors = 0;
    for (const line of raw.split("\n")) {
      if (!line) continue;
      lines += 1;
      if (ERROR_RE.test(line)) errors += 1;
    }
    totalLines += lines;
    errorLines += errors;

    let day = null;
    try {
      day = dayOf(statSync(path).mtime.toISOString());
    } catch {
      /* leave unbucketed */
    }
    if (day) {
      const d = perDay.get(day) ?? { lines: 0, errors: 0 };
      d.lines += lines;
      d.errors += errors;
      perDay.set(day, d);
    }
  }

  return {
    available: filesRead > 0,
    files: filesRead,
    totalLines,
    errorLines,
    errorRate: totalLines ? round(errorLines / totalLines, 4) : 0,
    perDay: [...perDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({ date, lines: v.lines, errors: v.errors })),
  };
}
