import raw from "./generated/metrics.json";

// dither-kit's fixed palette identifiers.
export type DitherColor = "green" | "blue" | "purple" | "pink" | "orange" | "red" | "grey";

export type ModelRow = {
  model: string;
  label: string;
  color: DitherColor;
  runs: number;
  cost: number;
  wallHours: number;
  estimate: boolean;
};

/** The small public rollup fetched from /metrics.json after the app shell loads. */
export type Metrics = {
  schema_version: number;
  refreshed_at?: string;
  source_generated_at: string | null;
  rate_table_effective_date: string | null;
  headline: {
    totalRuns: number;
    totalSpend: number;
    totalWallHours: number;
    modelsUsed: number;
    firstRun: string | null;
    lastRun: string | null;
    tasksTracked: number | null;
  };
  models: ModelRow[];
  reviewCycles: { cycles: number; label: string; count: number }[];
  runsOverTime: { date: string; runs: number; cost: number }[];
  harnesses: { harness: string; count: number }[];
  codeStats: {
    source_generated_at: string | null;
    headline: { commits: number; files: number; projects: number; additions: number; deletions: number; net: number };
    projects: { repo: string; commits: number; files: number; additions: number; deletions: number; net: number; first_commit: string | null; last_commit: string | null }[];
    authors: { name: string; commits: number; additions: number; deletions: number; net: number }[];
    velocity: { date: string; commits: number }[];
  };
  notes: { skippedRows: number; anyEstimated: boolean };
};

// The committed rollup is a resilient first-paint fallback. The deployed page then requests
// /metrics.json, which the refresh timer swaps atomically without rebuilding this app shell.
export const fallbackMetrics = raw as Metrics;

export async function fetchMetrics(): Promise<Metrics> {
  const response = await fetch("/metrics.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`metrics fetch failed: ${response.status}`);
  return await response.json() as Metrics;
}

export function usd(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 100) return `$${Math.round(n)}`;
  if (n >= 1) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}

export function usdPrecise(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: n < 1 ? 2 : 0,
  });
}

export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m) - 1]} ${Number(d)}`;
}
