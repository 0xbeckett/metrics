import type { Metrics } from "./metrics";

export type Author = { name: string; commits: number; net: number; additions: number };

/** Pure marketing projections over one fetched harvester rollup. */
export function deriveMetrics(metrics: Metrics) {
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

export function int(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
