import { memo, useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChartCard, Label, Metric, Panel, StatChip, StatusDot } from "@/components/ui";
import { BarsPlain, ColumnsPlain, LinePlain, ProportionBar } from "@/components/charts-plain";
import { AreaViz } from "@/components/charts";
import { MemoryGraph } from "@/components/memory-graph";
import { cn } from "@/lib/utils";
import { compact, days, deriveMetrics, duration, int, lastDelta, pct, untilFire } from "@/derived";
import { metricColor, metricDither } from "@/palette";
import { shortDate, usdPrecise, type ActivityEvent, type Metrics } from "@/metrics";
import { Reveal } from "@/motion";

/*
 * The section bodies for the one-page dashboard. Each of the five narrative
 * sections — Spend, Work shipped, The loop, Runtime — is one exported view; the
 * headline strip lives in App. Dense panels use the plain hairline kit; the two
 * trend showpieces (commit velocity, delivery) keep the dither texture. Every
 * section degrades to nothing when its source was unavailable, and money is told
 * in exactly one place (Spend) with one currency format.
 *
 * Each exported view is `memo`'d on its one prop: they only ever need to re-render
 * when the metrics document advances, and re-rendering them for any other reason
 * rebuilds the chart series arrays, which dither-kit reads as new data and
 * replays the entrance animation for.
 */

// One currency voice for the whole page: whole dollars with grouping for totals
// and per-entity figures ($1,102 / $871), cents only below a dollar ($0.42).
const money = usdPrecise;
// Per-unit ratios are inherently fractional, so they carry two decimals ($2.13).
const ratio = (n: number) => `$${n.toFixed(2)}`;

const uptime = (s: number | null): string => {
  if (s === null) return "—";
  const d = Math.floor(s / 86_400);
  if (d >= 1) return `${d}d`;
  const h = Math.floor(s / 3600);
  if (h >= 1) return `${h}h`;
  return `${Math.floor(s / 60)}m`;
};

/**
 * A local wall clock for the panels that render a relative time ("in 3m", "12s").
 * They used to ride the page-wide 1s tick; now that the sections are memoized,
 * each keeps its own — so the label stays honest while the re-render stays inside
 * that one panel. Only for panels with no canvas chart in them.
 */
function useNowTick(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

/** A compact multi-figure row inside a panel body. */
function Figures({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">{children}</div>;
}

/** A horizontally-scrolling strip of derived figures, hairline-divided. */
function ChipStrip({ children }: { children: ReactNode }) {
  return (
    <Panel className="overflow-x-auto">
      <div className="flex flex-nowrap divide-x divide-border">{children}</div>
    </Panel>
  );
}

// ── Spend ─────────────────────────────────────────────────────────────────────
// Every money figure the dashboard knows, in one section: the running total and
// its derived ratios, the page-wide daily spend, cost per model, and worker cost
// per ticket. One currency format, one time window.

export const SpendView = memo(function SpendView({ metrics }: { metrics: Metrics }) {
  const h = metrics.headline;
  const d = deriveMetrics(metrics);
  const spend = metrics.spend;
  const sessionsCost = metrics.claudeSessions?.available ? metrics.claudeSessions.totalCost : null;
  const costDelta = lastDelta(metrics.runsOverTime.map((x) => ({ value: x.cost })));
  const estimatedModels = metrics.models.filter((m) => m.estimate).map((m) => m.label);
  const estimateNote = estimatedModels.length ? ` · est: ${estimatedModels.join(", ")}` : "";
  const uncostedNote = d.uncostedModels.length
    ? ` Cost unknown: ${d.uncostedModels.map((m) => `${m.label} (${int(m.runs)} runs)`).join(", ")}.`
    : "";
  const runWindow = h.firstRun && h.lastRun ? `${shortDate(h.firstRun)} – ${shortDate(h.lastRun)}` : "—";

  return (
    <div className="flex flex-col gap-6">
      <ChipStrip>
        <StatChip value={h.totalSpend} label="Total spend" format={money} />
        <StatChip value={d.costPerCommit} label="Per commit" format={ratio} />
        <StatChip value={d.linesPerDollar} label="Lines / $" format={int} />
        {spend?.available ? <StatChip value={spend.costPerTicket.mean} label="Per ticket" format={ratio} /> : null}
      </ChipStrip>

      <Reveal>
        <ChartCard
          title="Spend over time"
          kicker={`USD · daily · ${runWindow}`}
          hue={metricColor("spend")}
          action={costDelta ? <Label>{`${costDelta > 0 ? "▲" : "▼"} ${money(Math.abs(costDelta))} vs prior day`}</Label> : undefined}
          footnote={
            <>
              Known-priced sessions across all harnesses, summed by day — the same running total the
              headline reports. Unpriced sessions remain included in session and wall-time totals.
              {sessionsCost !== null
                ? ` Across every Claude Code transcript on the host — a wider lens — priced usage totals ${money(sessionsCost)}.`
                : ""}
            </>
          }
        >
          <LinePlain
            data={metrics.runsOverTime as unknown as Record<string, string | number>[]}
            xKey="date"
            series={[{ key: "cost", label: "Cost", color: metricColor("spend") }]}
            xFormat={(s) => shortDate(s)}
            yFormat={money}
            tipFormat={money}
            fill
            height={240}
          />
        </ChartCard>
      </Reveal>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Reveal>
          <ChartCard
            title="Cost per model"
            kicker="USD · current rates"
            hue={metricColor("spend")}
            footnote={
              <>
                Opus does the heavy lifting and the heavy spending. Rates from the harvester's dated table
                {metrics.rate_table_effective_date ? ` (${metrics.rate_table_effective_date})` : ""}
                {estimateNote}
                {metrics.notes.unratedModelSessions > 0
                  ? ` · ${metrics.notes.unratedModelSessions} sessions have unknown cost; their runs and wall time are included`
                  : ""}.
                {uncostedNote}
              </>
            }
          >
            <BarsPlain data={d.costSeries} color={metricColor("spend")} valueFormat={money} labelWidth={72} />
          </ChartCard>
        </Reveal>

        {spend?.available ? (
          <Reveal delay={0.05}>
            <ChartCard
              title="Cost per ticket"
              kicker={`${spend.runsPriced} priced runs`}
              hue={metricColor("spend")}
              footnote={`Worker spend ${money(spend.totalSpend)} · per ticket mean ${ratio(spend.costPerTicket.mean)}, median ${ratio(spend.costPerTicket.p50)}, max ${ratio(spend.costPerTicket.max)}.`}
            >
              <div className="flex flex-col gap-2">
                <Label>Spend by stage</Label>
                <ProportionBar
                  segments={spend.byStage.map((s) => ({ label: s.stage, value: s.cost }))}
                  valueFormat={money}
                />
              </div>
              <div className="mt-2 flex flex-col gap-2">
                <Label>Top tickets</Label>
                <BarsPlain
                  data={spend.costPerTicket.top.slice(0, 8).map((r) => ({ label: r.ref, value: r.cost }))}
                  color={metricColor("spend")}
                  valueFormat={money}
                  labelWidth={72}
                />
              </div>
            </ChartCard>
          </Reveal>
        ) : null}
      </div>
    </div>
  );
});

// ── Work shipped ──────────────────────────────────────────────────────────────
// Git output: the velocity showpiece, then authorship and per-project lines.

export const WorkView = memo(function WorkView({ metrics }: { metrics: Metrics }) {
  const cs = metrics.codeStats;
  const d = deriveMetrics(metrics);
  const h = metrics.headline;
  const runWindow = h.firstRun && h.lastRun ? `${shortDate(h.firstRun)} – ${shortDate(h.lastRun)}` : "—";

  return (
    <div className="flex flex-col gap-6">
      <Reveal>
        <ChartCard title="Commit velocity" kicker={`daily · ${runWindow}`} hue={metricColor("commits")}>
          <AreaViz
            data={d.velocitySeries}
            color={metricDither("commits")}
            seriesLabel="Commits"
            heightClass="h-[240px] sm:h-[300px]"
            maxTicks={7}
            xFormatter={(v) => shortDate(String(v))}
            yFormatter={(v) => int(v)}
            valueFormatter={(v) => `${int(v)} commits`}
          />
        </ChartCard>
      </Reveal>

      <ChipStrip>
        <StatChip value={d.beckettShare} label="By Beckett" format={pct} />
        <StatChip value={d.commitsPerDay} label="Commits / day" format={(n) => n.toFixed(1)} />
        <StatChip value={cs.headline.projects} label="Projects" format={int} />
        <StatChip value={cs.headline.net} label="Net lines" format={int} />
      </ChipStrip>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Reveal>
          <ChartCard title="Lines / project" kicker="added · top 8" hue={metricColor("commits")}>
            <BarsPlain
              data={d.projectSeries}
              color={metricColor("commits")}
              valueFormat={(n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : int(n))}
            />
          </ChartCard>
        </Reveal>
        <Reveal delay={0.05}>
          <ChartCard title="Authorship" kicker="commits · top 7" hue={metricColor("commits")}>
            <BarsPlain data={d.authorSeries} color={metricColor("commits")} valueFormat={int} />
          </ChartCard>
        </Reveal>
      </div>
    </div>
  );
});

// ── The loop (tickets) ────────────────────────────────────────────────────────

function TicketPanels({ metrics }: { metrics: Metrics }) {
  const t = metrics.tickets;
  if (!t?.available) return null;
  const status = Object.fromEntries(t.byStatus.map((s) => [s.status, s.count]));
  const branchDist = t.branchesPerTask.distribution.map((d) => ({ label: `${d.branches}`, value: d.count }));

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <ChartCard title="Ticket throughput" kicker="opened vs closed · per day" className="lg:col-span-2">
        <Figures>
          <Metric label="Total" value={int(t.total)} sub="tracked" />
          <Metric label="Done" value={int(status.done ?? 0)} />
          <Metric label="Active" value={int(status.active ?? 0)} />
          <Metric label="Cancelled" value={int(status.cancelled ?? 0)} />
        </Figures>
        <div className="mt-2">
          <LinePlain
            data={t.openedClosedPerDay as unknown as Record<string, string | number>[]}
            xKey="date"
            series={[
              // Two series in one chart → adjacent slots, plus a dash on the
              // opened line so the pair separates without relying on hue.
              { key: "opened", label: "Opened", color: metricColor("opened"), dashed: true },
              { key: "closed", label: "Closed", color: metricColor("closed") },
            ]}
            xFormat={(s) => shortDate(s)}
            height={240}
          />
        </div>
      </ChartCard>

      <ChartCard title="Lead time" kicker="open → done · days" footnote={`${t.leadTimeDays.count} completed tickets. p50 is the typical ticket; p90 the slow tail.`}>
        <Figures>
          <Metric label="Mean" value={days(t.leadTimeDays.mean)} />
          <Metric label="Median" value={days(t.leadTimeDays.p50)} />
          <Metric label="p90" value={days(t.leadTimeDays.p90)} />
          <Metric label="Max" value={days(t.leadTimeDays.max)} />
        </Figures>
      </ChartCard>

      <ChartCard title="Rework" kicker={`branches per task · mean ${t.branchesPerTask.mean.toFixed(1)} · max ${t.branchesPerTask.max}`} footnote={t.reworkShare !== null ? `Rework share ${pct(t.reworkShare)} — the fraction of tickets that bounced back for another pass.` : undefined}>
        <ColumnsPlain data={branchDist} ramp height={200} yFormat={int} tipFormat={(n) => `${int(n)} tasks`} />
      </ChartCard>
    </div>
  );
}

function WorkerOutcomes({ metrics }: { metrics: Metrics }) {
  const w = metrics.workers;
  const d = deriveMetrics(metrics);
  if (!w?.available) {
    // No worker journal, but the telemetry review-cycle histogram still tells the
    // rework story — show it alone rather than nothing.
    if (!metrics.reviewCycles.length) return null;
    return (
      <ChartCard title="Review cycles" kicker="telemetry runs · unscoped" footnote="Worker outcome data is unavailable, so this fallback is not comparable to the First-try pass rate.">
        <ColumnsPlain data={d.cycleSeries} ramp height={220} yFormat={int} tipFormat={(n) => `${int(n)} runs`} />
      </ChartCard>
    );
  }
  const stage = Object.fromEntries((w.byStage ?? []).map((s) => [s.stage, s.count]));

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <ChartCard title="Worker outcomes" kicker={`${int(w.totalRuns)} runs`} footnote="First-try pass rate is the share of implement runs that cleared review without a rework cycle.">
        <Figures>
          <Metric label="First-try pass" value={w.firstTryPassRate !== null ? pct(w.firstTryPassRate) : "—"} />
          <Metric label="Tokens / run" value={compact(w.perRun.tokens.p50)} sub={`p90 ${compact(w.perRun.tokens.p90 ?? 0)}`} />
          <Metric label="Turns / run" value={int(w.perRun.turns.p50)} sub={`p90 ${int(w.perRun.turns.p90 ?? 0)}`} />
          <Metric label="Wall / run" value={`${w.perRun.wallMinutes.p50.toFixed(1)}m`} sub={`p90 ${(w.perRun.wallMinutes.p90 ?? 0).toFixed(0)}m`} />
        </Figures>
        <div className="mt-1 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Outcomes</Label>
            <ProportionBar segments={w.byOutcome.map((o) => ({ label: o.outcome, value: o.count }))} valueFormat={int} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Implement vs review</Label>
            <ProportionBar
              segments={[
                { label: "implement", value: stage.implement ?? 0 },
                { label: "review", value: stage.review ?? 0 },
              ]}
              valueFormat={int}
            />
          </div>
        </div>
      </ChartCard>

      <ChartCard title="Review cycles" kicker="reviewable worker outcomes · ordered" footnote="The same terminal implement population used for First-try pass: 0 is first-pass done; 1 is a rework or failed terminal outcome.">
        <ColumnsPlain data={d.cycleSeries} ramp height={220} yFormat={int} tipFormat={(n) => `${int(n)} runs`} />
      </ChartCard>
    </div>
  );
}

export const LoopView = memo(function LoopView({ metrics }: { metrics: Metrics }) {
  const hasTrend = (metrics.tickets?.openedClosedPerDay.length ?? 0) > 1;
  return (
    <div className="flex flex-col gap-6">
      {hasTrend ? (
        <Reveal>
          <ChartCard title="Delivery trend" kicker="tickets closed · per day" hue={metricColor("closed")}>
            <AreaViz
              data={(metrics.tickets?.openedClosedPerDay ?? []).map((x) => ({ date: x.date, value: x.closed }))}
              color={metricDither("closed")}
              seriesLabel="Closed"
              xFormatter={(v) => shortDate(String(v))}
              yFormatter={(v) => int(v)}
              valueFormatter={(v) => `${int(v)} closed`}
              heightClass="h-[200px] sm:h-[220px]"
            />
          </ChartCard>
        </Reveal>
      ) : null}
      <TicketPanels metrics={metrics} />
      <WorkerOutcomes metrics={metrics} />
    </div>
  );
});

// ── Runtime ───────────────────────────────────────────────────────────────────

function SystemStrip({ metrics }: { metrics: Metrics }) {
  const now = useNowTick(30_000);
  const { daemon, logs, routines, headline } = metrics;
  const activeSvc = daemon?.services.filter((s) => s.active === "active").length ?? 0;
  const totalSvc = daemon?.services.length ?? 0;
  const nextRoutine = routines?.items
    .filter((r) => r.enabled && r.nextFireAt)
    .sort((a, b) => Date.parse(a.nextFireAt!) - Date.parse(b.nextFireAt!))[0];

  return (
    <Panel className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Label>System status</Label>
        {daemon?.version ? (
          <span className="text-[12px] tabular-nums text-muted-foreground">daemon v{daemon.version}</span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
        {daemon?.available ? (
          <Metric label="Services up" value={`${activeSvc}/${totalSvc}`} sub="systemd units" />
        ) : null}
        <Metric label="Compute" value={`${int(headline.totalWallHours)}h`} sub={`${headline.modelsUsed} models`} />
        {logs?.available ? (
          <Metric label="Log volume" value={compact(logs.totalLines)} unit="lines" sub={`${pct(logs.errorRate)} errors`} />
        ) : null}
        {routines?.available ? (
          <Metric label="Routines" value={`${routines.enabled}`} sub={`of ${routines.total} enabled`} />
        ) : null}
        {nextRoutine ? (
          <Metric label="Next fire" value={untilFire(nextRoutine.nextFireAt, now)} sub={nextRoutine.name} />
        ) : null}
      </div>
      {daemon?.available ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border pt-3">
          {daemon.services.map((s) => (
            <StatusDot key={s.name} ok={s.active === "active"} label={`${s.name.replace(/^beckett-/, "")} ${s.active === "active" ? uptime(s.uptimeSeconds) : "dead"}`} />
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

function ClaudeSessionsPanels({ metrics }: { metrics: Metrics }) {
  const c = metrics.claudeSessions;
  const d = deriveMetrics(metrics);
  if (!c?.available) return null;
  const toolBars = c.toolCallMix.map((t) => ({ label: t.tool, value: t.count }));
  const modelBars = c.byModel.map((m) => ({ label: m.label, value: m.sessions }));
  const totalTokens = c.byModel.reduce((sum, m) => sum + m.tokens, 0);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <ChartCard
        title="Sessions over time"
        kicker={`${int(c.total)} transcripts · worker vs. concierge vs. quick`}
        hue={metricColor("sessions")}
        className="lg:col-span-2"
        footnote="Every Claude Code transcript on the host, split by which project directory it ran in — worker ticket worktrees, the concierge checkout, or a short quick/browser dispatch."
      >
        <Figures>
          <Metric label="Total" value={int(c.total)} sub="sessions" />
          <Metric label="Errors" value={int(c.errorCount)} />
          <Metric label="Permission denials" value={int(c.permissionDenials)} />
          <Metric label="Tokens" value={compact(totalTokens)} sub="in + out · all models" />
        </Figures>
        <div className="mt-2">
          <LinePlain
            data={c.sessionsOverTime as unknown as Record<string, string | number>[]}
            xKey="date"
            series={[{ key: "count", label: "Sessions", color: metricColor("sessions") }]}
            xFormat={(s) => shortDate(s)}
            yFormat={int}
            tipFormat={(n) => `${int(n)} sessions`}
            fill
            height={220}
          />
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <Label>By classification</Label>
          <ProportionBar
            segments={c.byClassification.map((b) => ({ label: b.classification, value: b.count }))}
            valueFormat={int}
          />
        </div>
      </ChartCard>

      <ChartCard title="Tool-call mix" kicker="calls · by tool name, top 12" hue={metricColor("sessions")} footnote="Tool name and a count only — arguments and results are never read past a same-pass error/permission check.">
        <BarsPlain data={toolBars} color={metricColor("sessions")} valueFormat={int} labelWidth={110} />
      </ChartCard>

      <ChartCard title="Wall-clock / model" kicker={`${int(metrics.headline.totalWallHours)}h total · hours per model`} hue={metricColor("sessions")}>
        <BarsPlain data={d.wallSeries} color={metricColor("sessions")} valueFormat={(n) => `${n.toFixed(1)}h`} labelWidth={72} />
      </ChartCard>

      <ChartCard title="Session duration" kicker={`median ${duration(c.duration.p50)} · p90 ${duration(c.duration.p90 ?? 0)}`}>
        <ColumnsPlain data={c.durationBuckets.map((x) => ({ label: x.label, value: x.count }))} ramp height={200} yFormat={int} tipFormat={(n) => `${int(n)} sessions`} />
      </ChartCard>

      <ChartCard title="Turns per session" kicker={`median ${int(c.turns.p50)} · p90 ${int(c.turns.p90 ?? 0)}`}>
        <ColumnsPlain data={c.turnBuckets.map((t) => ({ label: t.label, value: t.count }))} ramp height={200} yFormat={int} tipFormat={(n) => `${int(n)} sessions`} />
      </ChartCard>

      <ChartCard title="Model split" kicker="sessions · primary model per transcript" hue={metricColor("sessions")}>
        <BarsPlain data={modelBars} color={metricColor("sessions")} valueFormat={int} labelWidth={80} />
      </ChartCard>
    </div>
  );
}

function RunPanels({ metrics }: { metrics: Metrics }) {
  const b = metrics.browserRuns;
  const q = metrics.quickRuns;
  if (!b?.available && !q?.available) return null;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {b?.available ? (
        <ChartCard title="Browser runs" kicker={`${int(b.total)} runs`} footnote={`Duration: median ${duration(b.durationSeconds.p50)}, p90 ${duration(b.durationSeconds.p90 ?? 0)}.`}>
          <div className="flex flex-col gap-2">
            <Label>Outcomes</Label>
            <ProportionBar segments={b.byOutcome.map((o) => ({ label: o.outcome, value: o.count }))} valueFormat={int} />
          </div>
          <div className="mt-2">
            <Label>Duration</Label>
            <ColumnsPlain
              data={b.durationBuckets.map((x) => ({ label: x.label, value: x.count }))}
              ramp
              height={180}
              yFormat={int}
              tipFormat={(n) => `${int(n)} runs`}
            />
          </div>
        </ChartCard>
      ) : null}

      {q?.available ? (
        <ChartCard title="Quick-agent runs" kicker={`${int(q.total)} runs`} footnote="Short single-shot agent tasks — delivered means it returned a usable result.">
          <div className="flex flex-col gap-2">
            <Label>Outcomes</Label>
            <ProportionBar segments={q.byOutcome.map((o) => ({ label: o.outcome, value: o.count }))} valueFormat={int} />
          </div>
        </ChartCard>
      ) : null}
    </div>
  );
}

function RoutinesPanel({ metrics }: { metrics: Metrics }) {
  const now = useNowTick(30_000);
  const r = metrics.routines;
  if (!r?.available) return null;
  const rows = [...r.items].sort((a, b) => {
    const ta = a.nextFireAt ? Date.parse(a.nextFireAt) : Infinity;
    const tb = b.nextFireAt ? Date.parse(b.nextFireAt) : Infinity;
    return ta - tb;
  });

  return (
    <ChartCard title="Routines" kicker={`${r.enabled} enabled · next fire`}>
      <ul className="flex flex-col divide-y divide-border">
        {rows.map((item) => {
          const fires = untilFire(item.nextFireAt, now);
          return (
            <li
              key={item.id ?? item.name}
              className="flex items-center justify-between gap-3 py-2 text-[13px] transition-colors duration-150 hover:bg-secondary/60"
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    item.enabled ? "bg-good" : "border border-muted-foreground bg-transparent",
                  )}
                />
                <span className="truncate text-foreground">{item.name}</span>
              </span>
              <span className="shrink-0 label-caps">{item.kind}</span>
              <span
                className={cn(
                  "w-16 shrink-0 text-right tabular-nums",
                  fires === "due" ? "font-medium text-warn" : "text-muted-foreground",
                )}
              >
                {fires}
              </span>
            </li>
          );
        })}
      </ul>
    </ChartCard>
  );
}

function MemoryPanels({ metrics }: { metrics: Metrics }) {
  const m = metrics.memory;
  if (!m?.available) return null;
  const typeBars = [...m.byType].sort((a, b) => b.count - a.count).map((t) => ({ label: t.type, value: t.count }));

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <ChartCard
        title="Memory graph"
        kicker={`${m.nodeCount} notes · ${m.edgeCount} links`}
        className="lg:col-span-2"
        footnote={`${m.orphanCount} orphan notes with no links. Node size and depth of fill both read link count — the darkest, largest notes are the hubs; hover one to trace its links.`}
      >
        <MemoryGraph mem={m} />
      </ChartCard>
      <ChartCard
        title="Notes by type"
        kicker={`age p50 ${m.ageDays.p50.toFixed(0)}d`}
        hue={metricColor("memory")}
        footnote={`Newest cohort: ${m.ageDays.distribution.find((d) => d.bucket === "<1w")?.count ?? 0} notes under a week old.`}
      >
        <BarsPlain data={typeBars} color={metricColor("memory")} valueFormat={int} labelWidth={84} />
      </ChartCard>
    </div>
  );
}

// ── Activity stream (live) ────────────────────────────────────────────────────

function ago(ts: string, now: number): string {
  const delta = Math.max(0, Math.floor((now - Date.parse(ts)) / 1000));
  if (delta < 60) return `${delta}s`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m`;
  if (delta < 86_400) return `${Math.floor(delta / 3600)}h`;
  return `${Math.floor(delta / 86_400)}d`;
}

/** An event kind → the hue of the thing it happened to, so the stream keys into
 *  the same map as the panels above it. Unknown kinds stay neutral. */
function kindColor(kind: string): string {
  if (/worker|run|session/i.test(kind)) return metricColor("sessions");
  if (/commit|push/i.test(kind)) return metricColor("commits");
  if (/done|closed|shipped/i.test(kind)) return metricColor("closed");
  if (/start|open|ticket|task/i.test(kind)) return metricColor("opened");
  return "var(--ink-soft)";
}

function ActivityStream({ activity }: { activity: ActivityEvent[] }) {
  const reduce = useReducedMotion();
  const now = useNowTick(5000);
  const rows = activity.slice(0, 14);

  return (
    <ChartCard title="Activity" kicker="most recent · live">
      <ul className="flex flex-col divide-y divide-border">
        <AnimatePresence initial={false}>
          {rows.map((e, i) => {
            const key = `${e.ts}-${e.ref ?? ""}-${e.kind}-${i}`;
            const body = (
              <div className="flex items-baseline gap-3 py-2 text-[13px]">
                <span className="w-10 shrink-0 text-right tabular-nums text-label">{ago(e.ts, now)}</span>
                <span className="flex w-16 shrink-0 items-center gap-1.5 label-caps">
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ background: kindColor(e.kind) }}
                  />
                  {e.kind}
                </span>
                {e.ref ? <span className="shrink-0 font-medium tabular-nums text-foreground">{e.ref}</span> : null}
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{e.title}</span>
              </div>
            );
            return reduce ? (
              <li key={key}>{body}</li>
            ) : (
              <motion.li
                key={key}
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
              >
                {body}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </ChartCard>
  );
}

export const RuntimeView = memo(function RuntimeView({ metrics }: { metrics: Metrics }) {
  return (
    <div className="flex flex-col gap-6">
      <SystemStrip metrics={metrics} />
      <ClaudeSessionsPanels metrics={metrics} />
      <RunPanels metrics={metrics} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <RoutinesPanel metrics={metrics} />
        {metrics.recentActivity?.length ? <ActivityStream activity={metrics.recentActivity} /> : null}
      </div>
      <MemoryPanels metrics={metrics} />
    </div>
  );
});
