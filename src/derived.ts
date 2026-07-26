import type { Metrics } from "./metrics";

export type Author = { name: string; commits: number; net: number; additions: number };

function computeDerived(metrics: Metrics) {
  const h = metrics.headline;
  const cs = metrics.codeStats;
  const authors: Author[] = (() => {
    const map = new Map<string, Author>();
    for (const a of cs.authors) {
      const cur = map.get(a.name) ?? { name: a.name, commits: 0, net: 0, additions: 0 };
      cur.commits += a.commits;
      cur.net += a.net;
      cur.additions += a.additions;
      map.set(a.name, cur);
    }
    return [...map.values()].sort((x, y) => y.commits - x.commits);
  })();
  const beckettCommits = authors.find((a) => /^beckett$/i.test(a.name.trim()))?.commits ?? 0;
  const short = (s: string, n = 9) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const firstTry = metrics.reviewCycles.find((c) => c.cycles === 0)?.count ?? 0;

  return {
    firstTryRate: h.totalRuns > 0 ? firstTry / h.totalRuns : 0,
    beckettShare: cs.headline.commits > 0 ? beckettCommits / cs.headline.commits : 0,
    costPerCommit: cs.headline.commits > 0 ? h.totalSpend / cs.headline.commits : 0,
    linesPerDollar: h.totalSpend > 0 ? cs.headline.additions / h.totalSpend : 0,
    commitsPerDay: cs.velocity.length > 0 ? cs.headline.commits / cs.velocity.length : 0,
    velocitySeries: cs.velocity.map((v) => ({ date: v.date, value: v.commits })),
    projectSeries: [...cs.projects].sort((a, b) => b.additions - a.additions).slice(0, 8)
      .map((p) => ({ label: short(p.repo), value: p.additions })),
    authorSeries: authors.slice(0, 7).map((a) => ({ label: short(a.name), value: a.commits })),
    costSeries: metrics.models.map((m) => ({ label: m.label, value: m.cost })),
    wallSeries: metrics.models.map((m) => ({ label: m.label, value: m.wallHours })),
    cycleSeries: metrics.reviewCycles.map((c) => ({ label: c.label, value: c.count })),
    runsSeries: metrics.runsOverTime.map((d) => ({ date: d.date, value: d.runs })),
  };
}

export type Derived = ReturnType<typeof computeDerived>;

const cache = new WeakMap<Metrics, Derived>();

/**
 * Pure marketing projections over one fetched harvester rollup, memoized on the
 * document itself. The series arrays here are handed straight to the charts, and
 * dither-kit keys its entrance replay on `data` *identity* — so recomputing them
 * on an unrelated re-render would re-animate every plot. One document in, one
 * result out, for as long as that document is the live one.
 */
export function deriveMetrics(metrics: Metrics): Derived {
  const hit = cache.get(metrics);
  if (hit) return hit;
  const derived = computeDerived(metrics);
  cache.set(metrics, derived);
  return derived;
}

export function int(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** Compact big numbers: 1.2M / 3.4k / 12 — for token counts and log lines. */
export function compact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

/** The change between the last two points of a daily series (for a delta cue). */
export function lastDelta(series: { value: number }[]): number {
  if (series.length < 2) return 0;
  return series[series.length - 1].value - series[series.length - 2].value;
}

/** "1.2d" / "6.5h" / "12m" from a day count — lead time / durations. */
export function days(n: number): string {
  if (n >= 1) return `${n.toFixed(n < 10 ? 2 : 1)}d`;
  const hours = n * 24;
  if (hours >= 1) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours * 60)}m`;
}

/** "1m 28s" / "48s" from seconds — browser-run durations. */
export function duration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

/** Time until a future ISO instant, relative to `now`: "in 3m" / "in 2h" / "due". */
export function untilFire(iso: string | null, now: number): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const delta = Math.floor((t - now) / 1000);
  if (delta <= 0) return "due";
  if (delta < 3600) return `in ${Math.floor(delta / 60)}m`;
  if (delta < 86_400) return `in ${Math.floor(delta / 3600)}h`;
  return `in ${Math.floor(delta / 86_400)}d`;
}
