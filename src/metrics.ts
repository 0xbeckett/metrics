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
  notes: { skippedRows: number; unratedModelSessions: number; anyEstimated: boolean };

  // ── Widened data layer (#100, schema_version 2) ───────────────────────────
  // Every section below is optional: a stale v1 document fetched mid-rollout, or a section whose
  // source was absent at refresh time (available:false), must still render the rest of the page.
  tickets?: TicketsSection;
  workers?: WorkersSection;
  spend?: SpendSection;
  browserRuns?: BrowserRunsSection;
  quickRuns?: QuickRunsSection;
  memory?: MemorySection;
  routines?: RoutinesSection;
  logs?: LogsSection;
  daemon?: DaemonSection;
  recentActivity?: ActivityEvent[];
};

/** Summary stats shared by several sections (all pre-rounded by the harvester). */
export type StatSummary = { count: number; mean: number; p50: number; p90?: number; max: number };

export type TicketsSection = {
  available: boolean;
  total: number;
  byStatus: { status: string; count: number }[];
  openedClosedPerDay: { date: string; opened: number; closed: number }[];
  leadTimeDays: { count: number; mean: number; p50: number; p90: number; max: number };
  branchesPerTask: { mean: number; max: number; distribution: { branches: number; count: number }[] };
  reworkShare: number | null;
};

export type WorkersSection = {
  available: boolean;
  totalRuns: number;
  byStage: { stage: string; count: number }[];
  byOutcome: { outcome: string; count: number }[];
  firstTryPassRate: number | null;
  reworkCycles: { count: number; mean: number; max: number; distribution: { cycles: number; count: number }[] };
  stalls: number;
  restarts: number;
  totals: { turns: number; toolCalls: number; tokensIn: number; tokensOut: number; wallHours: number };
  perRun: { turns: StatSummary; toolCalls: StatSummary; tokens: StatSummary; wallMinutes: StatSummary };
  journalFiles: number;
  workerDirs: number;
};

export type SpendSection = {
  available: boolean;
  totalSpend: number;
  runsPriced: number;
  overTime: { date: string; cost: number; runs: number }[];
  byModel: { model: string; label: string; color: DitherColor; cost: number; runs: number }[];
  byStage: { stage: string; cost: number; runs: number }[];
  costPerTicket: { count: number; mean: number; p50: number; max: number; top: { ref: string; cost: number }[] };
};

export type BrowserRunsSection = {
  available: boolean;
  total: number;
  byOutcome: { outcome: string; count: number }[];
  durationSeconds: StatSummary;
  durationBuckets: { label: string; count: number }[];
};

export type QuickRunsSection = {
  available: boolean;
  total: number;
  byType: { type: string; count: number }[];
  byOutcome: { outcome: string; count: number }[];
};

export type MemorySection = {
  available: boolean;
  nodeCount: number;
  edgeCount: number;
  orphanCount: number;
  byType: { type: string; count: number }[];
  ageDays: { count: number; mean: number; p50: number; max: number; distribution: { bucket: string; count: number }[] };
  nodes: { name: string; type: string; degree: number }[];
  edges: { from: string; to: string }[];
};

export type RoutinesSection = {
  available: boolean;
  total: number;
  enabled: number;
  disabled: number;
  byKind: { kind: string; count: number }[];
  items: { id: string | null; name: string; kind: string; enabled: boolean; nextFireAt: string | null; lastFiredAt: string | null }[];
};

export type LogsSection = {
  available: boolean;
  files: number;
  totalLines: number;
  errorLines: number;
  errorRate: number;
  perDay: { date: string; lines: number; errors: number }[];
};

export type DaemonSection = {
  available: boolean;
  version: string | null;
  services: { name: string; active: string; subState: string; uptimeSeconds: number | null }[];
};

export type ActivityEvent = { ts: string; kind: string; ref: string | null; title: string | null };

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
