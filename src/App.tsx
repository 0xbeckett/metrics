import { memo, useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { AreaViz, Spark } from "@/components/charts";
import { BarsPlain, ColumnsPlain, LinePlain } from "@/components/charts-plain";
import { ChartCard, HeroStat, Label, LiveDot, Panel, StatChip } from "@/components/ui";
import { Reveal } from "@/motion";
import { cn } from "@/lib/utils";
import { useTheme } from "@/theme";
import { formatAge, useLiveMetrics } from "@/live";
import { shortDate, usd, usdPrecise, type Metrics } from "@/metrics";
import { compact, deriveMetrics, int, lastDelta, pct } from "@/derived";
import { OperationsView } from "@/panels";
import { RecallView } from "@/RecallView";

const usdFull = (n: number) => `$${int(n)}`;

type TabId = "work" | "ops" | "recall";
const TABS: { id: TabId; label: string }[] = [
  { id: "work", label: "Proof of Work" },
  { id: "ops", label: "Operations" },
  { id: "recall", label: "Recall Eval" },
];

const MAST: Record<TabId, { kicker: string; title: string; blurb: string }> = {
  work: {
    kicker: "Beckett · Autonomous Agent",
    title: "Proof of Work",
    blurb: "Every figure is harvested from real git history and session logs — no numbers by hand.",
  },
  ops: {
    kicker: "Beckett · Operations",
    title: "The machine, running",
    blurb: "Tickets, worker economics, spend, memory and system health — the live shape of the loop.",
  },
  recall: {
    kicker: "Beckett · Recall Eval",
    title: "Recall scores",
    blurb: "How the memory-recall agent ranks against the golden set — P@1, P@5 and MRR per category.",
  },
};

/**
 * The code-stats + telemetry view — lines shipped, commit velocity, authorship,
 * cost and runs. The commit-velocity trend keeps the dither texture as a
 * showpiece; the dense ranking/throughput panels use the plain hairline kit.
 */
const CodeStatsView = memo(function CodeStatsView({ metrics }: { metrics: Metrics }) {
  const h = metrics.headline;
  const cs = metrics.codeStats;
  const {
    authorSeries, beckettShare, commitsPerDay, costPerCommit, costSeries, cycleSeries,
    firstTryRate, linesPerDollar, projectSeries, runsSeries, velocitySeries, wallSeries,
  } = deriveMetrics(metrics);
  const dailyCommits = cs.velocity.map((v) => v.commits);
  const dailyRuns = metrics.runsOverTime.map((d) => d.runs);
  const dailyCost = metrics.runsOverTime.map((d) => d.cost);
  const runsDelta = lastDelta(runsSeries);
  const costDelta = lastDelta(metrics.runsOverTime.map((d) => ({ value: d.cost })));
  const estimatedModels = metrics.models.filter((m) => m.estimate).map((m) => m.label);
  const estimateNote = estimatedModels.length ? ` · est: ${estimatedModels.join(", ")}` : "";
  const runWindow = h.firstRun && h.lastRun ? `${shortDate(h.firstRun)} – ${shortDate(h.lastRun)}` : "—";

  return (
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <HeroStat label="Lines shipped" value={cs.headline.additions} format={int} sub={`+${int(cs.headline.net)} net`} />
        <HeroStat label="Commits" value={cs.headline.commits} format={int} spark={<Spark data={dailyCommits} />} />
        <HeroStat label="Projects" value={cs.headline.projects} format={int} sub="repositories" />
        <HeroStat label="Spent" value={h.totalSpend} format={usdFull} delta={Math.round(costDelta)} deltaFormat={(n) => `$${Math.round(n)}`} spark={<Spark data={dailyCost} />} />
        <HeroStat label="Sessions" value={h.totalRuns} format={int} delta={runsDelta} spark={<Spark data={dailyRuns} />} />
        <HeroStat label="Compute" value={h.totalWallHours} format={(n) => `${int(n)}h`} sub={`${h.modelsUsed} models`} />
      </section>

      <Reveal>
        <ChartCard title="Commit velocity" kicker={`daily · ${runWindow}`}>
          <AreaViz
            data={velocitySeries}
            color="ink"
            seriesLabel="Commits"
            heightClass="h-[260px] sm:h-[320px]"
            maxTicks={7}
            xFormatter={(v) => shortDate(String(v))}
            yFormatter={(v) => int(v)}
            valueFormatter={(v) => `${int(v)} commits`}
          />
        </ChartCard>
      </Reveal>

      <Panel className="overflow-x-auto">
        <div className="flex flex-nowrap divide-x divide-border">
          <StatChip value={firstTryRate} label="First try" format={pct} />
          <StatChip value={beckettShare} label="By Beckett" format={pct} />
          <StatChip value={costPerCommit} label="/ commit" format={(n) => `$${n.toFixed(2)}`} />
          <StatChip value={linesPerDollar} label="Lines / $" format={(n) => int(n)} />
          <StatChip value={commitsPerDay} label="Commits / day" format={(n) => n.toFixed(1)} />
          <StatChip value={h.tasksTracked ?? 0} label="Tasks" format={int} />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Reveal>
          <ChartCard title="Lines / project" kicker="added · top 8">
            <BarsPlain data={projectSeries} valueFormat={(n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : int(n))} />
          </ChartCard>
        </Reveal>
        <Reveal delay={0.05}>
          <ChartCard title="Authorship" kicker="commits · top 7">
            <BarsPlain data={authorSeries} valueFormat={int} />
          </ChartCard>
        </Reveal>
        <Reveal>
          <ChartCard
            title="API cost / model"
            kicker="USD · current rates"
            footnote={
              <>
                Opus does the heavy lifting and the heavy spending. Rates from the harvester's dated table
                {metrics.rate_table_effective_date ? ` (${metrics.rate_table_effective_date})` : ""}
                {estimateNote}
                {metrics.notes.unratedModelSessions > 0
                  ? ` · ${metrics.notes.unratedModelSessions} sessions excluded pending model rates`
                  : ""}.
              </>
            }
          >
            <BarsPlain data={costSeries} valueFormat={usdPrecise} labelWidth={72} />
          </ChartCard>
        </Reveal>
        <Reveal delay={0.05}>
          <ChartCard title="Runs / day" kicker={`sessions · ${runWindow}`}>
            <LinePlain
              data={runsSeries as unknown as Record<string, string | number>[]}
              xKey="date"
              series={[{ key: "value", label: "Runs" }]}
              xFormat={(s) => shortDate(s)}
              yFormat={int}
              tipFormat={(n) => `${int(n)} runs`}
              fill
            />
          </ChartCard>
        </Reveal>
        <Reveal>
          <ChartCard title="Wall-clock / model" kicker="hours">
            <BarsPlain data={wallSeries} valueFormat={(n) => `${n.toFixed(1)}h`} labelWidth={72} />
          </ChartCard>
        </Reveal>
        <Reveal delay={0.05}>
          <ChartCard title="Review cycles" kicker="impl → review bounces">
            <ColumnsPlain data={cycleSeries} height={220} yFormat={int} tipFormat={(n) => `${int(n)} runs`} />
          </ChartCard>
        </Reveal>
      </div>

      <footer>
        <Panel className="flex flex-col gap-3 p-4 text-[11px] leading-relaxed text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="label-caps text-foreground">Sources</span>
            {metrics.harnesses.map((hn) => (
              <span key={hn.harness} className="whitespace-nowrap tabular-nums">
                {hn.harness}
                <span className="text-foreground"> {hn.count.toLocaleString()}</span>
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
            <span>
              git <span className="text-foreground">{cs.source_generated_at ? cs.source_generated_at.slice(0, 10) : "—"}</span>
            </span>
            <span>
              telemetry <span className="text-foreground">{metrics.source_generated_at ? metrics.source_generated_at.slice(0, 10) : "—"}</span>
            </span>
            <span>
              charts{" "}
              <a
                href="https://www.tripwire.sh/dither-kit"
                target="_blank"
                rel="noreferrer"
                className="text-foreground underline decoration-primary decoration-1 underline-offset-2 hover:text-primary"
              >
                dither-kit
              </a>
              {" · "}
              plain
            </span>
          </div>
        </Panel>
      </footer>
      <div className="sr-only">{compact(cs.headline.additions)} lines across {cs.headline.projects} projects.</div>
    </div>
  );
});

/** Masthead live indicator: a pulsing dot + honest data age that degrades to stale. */
function LiveIndicator({ ageSeconds, stale }: { ageSeconds: number | null; stale: boolean }) {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-[12px] tabular-nums text-muted-foreground"
      aria-live="polite"
      title={stale ? "Data has not advanced recently" : "Live — polling every 15s"}
    >
      <LiveDot live={!stale} />
      <span>{stale ? "stale" : `updated ${formatAge(ageSeconds)}`}</span>
    </div>
  );
}

export function App() {
  const { dark, toggle } = useTheme();
  const { metrics, ageSeconds, stale } = useLiveMetrics();
  const [tab, setTab] = useState<TabId>(() => {
    const saved = localStorage.getItem("bkt-tab");
    return saved === "ops" || saved === "recall" ? saved : "work";
  });
  useEffect(() => {
    localStorage.setItem("bkt-tab", tab);
  }, [tab]);

  const mast = MAST[tab];

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <header className="mb-8 flex flex-col gap-6 sm:mb-12">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-3">
              <Label>{mast.kicker}</Label>
              <h1 className="font-display text-[2.75rem] leading-[0.95] text-foreground sm:text-6xl lg:text-7xl">
                {mast.title}
              </h1>
              <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{mast.blurb}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-3">
              <button
                type="button"
                onClick={toggle}
                aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
                className="rounded-md border border-border p-2.5 text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {dark ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
              </button>
              <LiveIndicator ageSeconds={ageSeconds} stale={stale} />
            </div>
          </div>

          <nav className="flex w-fit gap-1 rounded-lg border border-border p-1" aria-label="Dashboard views">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4",
                  tab === t.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </header>

        <main>
          {tab === "work" ? (
            <CodeStatsView metrics={metrics} />
          ) : tab === "ops" ? (
            <OperationsView metrics={metrics} />
          ) : (
            <RecallView />
          )}
        </main>
      </div>
    </div>
  );
}
