import { memo, useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChartCard, Label, Metric, Panel, SectionHeader, StatusDot } from "@/components/ui";
import { BarsPlain, ColumnsPlain, LinePlain, ProportionBar } from "@/components/charts-plain";
import { AreaViz } from "@/components/charts";
import { MemoryGraph } from "@/components/memory-graph";
import { compact, days, duration, int, pct, untilFire } from "@/derived";
import { shortDate, usd, type ActivityEvent, type Metrics } from "@/metrics";

/*
 * The Operations view — everything #80.1 emits, laid out as its own information
 * architecture. Dense panels (throughput, worker economics, spend, log volume)
 * use the plain hairline kit; the memory graph and the throughput trend are the
 * showpieces. Each section degrades to nothing when its source was unavailable.
 */

const uptime = (s: number | null): string => {
  if (s === null) return "—";
  const d = Math.floor(s / 86_400);
  if (d >= 1) return `${d}d`;
  const h = Math.floor(s / 3600);
  if (h >= 1) return `${h}h`;
  return `${Math.floor(s / 60)}m`;
};

/** A compact multi-figure row inside a panel body. */
function Figures({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">{children}</div>;
}

// ── System status ───────────────────────────────────────────────────────────

function SystemStrip({ metrics }: { metrics: Metrics }) {
  const { daemon, logs, routines } = metrics;
  if (!daemon?.available && !logs?.available && !routines?.available) return null;
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
        {logs?.available ? (
          <Metric label="Log volume" value={compact(logs.totalLines)} unit="lines" sub={`${pct(logs.errorRate)} errors`} />
        ) : null}
        {routines?.available ? (
          <Metric label="Routines" value={`${routines.enabled}`} sub={`of ${routines.total} enabled`} />
        ) : null}
        {nextRoutine ? (
          <Metric label="Next fire" value={untilFire(nextRoutine.nextFireAt, Date.now())} sub={nextRoutine.name} />
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

// ── Tickets ──────────────────────────────────────────────────────────────────

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
              { key: "opened", label: "Opened", shade: 1 },
              { key: "closed", label: "Closed", shade: 0.42 },
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

      <ChartCard title="Branches per task" kicker={`mean ${t.branchesPerTask.mean.toFixed(1)} · max ${t.branchesPerTask.max}`} footnote={t.reworkShare !== null ? `Rework share ${pct(t.reworkShare)} — the fraction of tickets that bounced back for another pass.` : undefined}>
        <ColumnsPlain data={branchDist} height={200} yFormat={int} tipFormat={(n) => `${int(n)} tasks`} />
      </ChartCard>
    </div>
  );
}

// ── Worker economics ─────────────────────────────────────────────────────────

function WorkerPanels({ metrics }: { metrics: Metrics }) {
  const w = metrics.workers;
  const spend = metrics.spend;
  if (!w?.available && !spend?.available) return null;
  const stage = Object.fromEntries((w?.byStage ?? []).map((s) => [s.stage, s.count]));

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {w?.available ? (
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
              <ProportionBar
                segments={w.byOutcome.map((o) => ({ label: o.outcome, value: o.count }))}
                valueFormat={int}
              />
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
      ) : null}

      {spend?.available ? (
        <ChartCard title="Worker spend" kicker={`$${int(spend.totalSpend)} · ${spend.runsPriced} priced runs`} footnote={`Cost per ticket: mean $${spend.costPerTicket.mean.toFixed(2)}, median $${spend.costPerTicket.p50.toFixed(2)}, max $${spend.costPerTicket.max.toFixed(0)}.`}>
          <div className="flex flex-col gap-2">
            <Label>Spend by stage</Label>
            <ProportionBar
              segments={spend.byStage.map((s) => ({ label: s.stage, value: s.cost }))}
              valueFormat={(n) => `$${int(n)}`}
            />
          </div>
          <div className="mt-2 flex flex-col gap-2">
            <Label>Cost per ticket · top</Label>
            <BarsPlain
              data={spend.costPerTicket.top.slice(0, 8).map((r) => ({ label: r.ref, value: r.cost }))}
              valueFormat={(n) => `$${n.toFixed(0)}`}
              labelWidth={72}
            />
          </div>
        </ChartCard>
      ) : null}

      {spend?.available ? (
        <ChartCard title="Spend over time" kicker="USD · per day" className="lg:col-span-2">
          <LinePlain
            data={spend.overTime as unknown as Record<string, string | number>[]}
            xKey="date"
            series={[{ key: "cost", label: "Cost", shade: 1 }]}
            xFormat={(s) => shortDate(s)}
            yFormat={(n) => usd(n)}
            tipFormat={(n) => `$${n.toFixed(2)}`}
            fill
            height={220}
          />
        </ChartCard>
      ) : null}
    </div>
  );
}

// ── Browser + quick runs ─────────────────────────────────────────────────────

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
              data={b.durationBuckets.map((d) => ({ label: d.label, value: d.count }))}
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

// ── Routines ─────────────────────────────────────────────────────────────────

function RoutinesPanel({ metrics }: { metrics: Metrics }) {
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
        {rows.map((item) => (
          <li key={item.id ?? item.name} className="flex items-center justify-between gap-3 py-2 text-[13px]">
            <span className="min-w-0 flex-1 truncate text-foreground">{item.name}</span>
            <span className="shrink-0 label-caps">{item.kind}</span>
            <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
              {untilFire(item.nextFireAt, Date.now())}
            </span>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

// ── Memory ───────────────────────────────────────────────────────────────────

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
        footnote={`${m.orphanCount} orphan notes with no links. Hubs (self · person · project) are filled; hover a node to trace its links.`}
      >
        <MemoryGraph mem={m} />
      </ChartCard>
      <ChartCard title="Notes by type" kicker={`age p50 ${m.ageDays.p50.toFixed(0)}d`} footnote={`Newest cohort: ${m.ageDays.distribution.find((d) => d.bucket === "<1w")?.count ?? 0} notes under a week old.`}>
        <BarsPlain data={typeBars} valueFormat={int} labelWidth={84} />
      </ChartCard>
    </div>
  );
}

// ── Claude Code session analytics (#2) ───────────────────────────────────────

function ClaudeSessionsPanels({ metrics }: { metrics: Metrics }) {
  const c = metrics.claudeSessions;
  if (!c?.available) return null;
  const toolBars = c.toolCallMix.map((t) => ({ label: t.tool, value: t.count }));
  const modelBars = c.byModel.map((m) => ({ label: m.label, value: m.sessions }));

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <ChartCard
        title="Sessions over time"
        kicker={`${int(c.total)} transcripts · worker vs. concierge vs. quick`}
        footnote="Every Claude Code transcript on the host, split by which project directory it ran in — worker ticket worktrees, the concierge checkout, or a short quick/browser dispatch."
      >
        <Figures>
          <Metric label="Total" value={int(c.total)} sub="sessions" />
          <Metric label="Errors" value={int(c.errorCount)} />
          <Metric label="Permission denials" value={int(c.permissionDenials)} />
          <Metric label="Cost" value={c.totalCost !== null ? usd(c.totalCost) : "—"} sub={c.totalCost === null ? "no priced sessions" : undefined} />
        </Figures>
        <div className="mt-2">
          <LinePlain
            data={c.sessionsOverTime as unknown as Record<string, string | number>[]}
            xKey="date"
            series={[{ key: "count", label: "Sessions", shade: 1 }]}
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

      <ChartCard title="Tool-call mix" kicker="calls · by tool name, top 12" footnote="Tool name and a count only — arguments and results are never read past a same-pass error/permission check.">
        <BarsPlain data={toolBars} valueFormat={int} labelWidth={110} />
      </ChartCard>

      <ChartCard title="Session duration" kicker={`median ${duration(c.duration.p50)} · p90 ${duration(c.duration.p90 ?? 0)}`}>
        <ColumnsPlain data={c.durationBuckets.map((d) => ({ label: d.label, value: d.count }))} height={200} yFormat={int} tipFormat={(n) => `${int(n)} sessions`} />
      </ChartCard>

      <ChartCard title="Turns per session" kicker={`median ${int(c.turns.p50)} · p90 ${int(c.turns.p90 ?? 0)}`}>
        <ColumnsPlain data={c.turnBuckets.map((t) => ({ label: t.label, value: t.count }))} height={200} yFormat={int} tipFormat={(n) => `${int(n)} sessions`} />
      </ChartCard>

      <ChartCard title="Model split" kicker="sessions · primary model per transcript" className="lg:col-span-2">
        <BarsPlain data={modelBars} valueFormat={int} labelWidth={80} />
      </ChartCard>
    </div>
  );
}

// ── Activity stream (live) ───────────────────────────────────────────────────

function ago(ts: string, now: number): string {
  const delta = Math.max(0, Math.floor((now - Date.parse(ts)) / 1000));
  if (delta < 60) return `${delta}s`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m`;
  if (delta < 86_400) return `${Math.floor(delta / 3600)}h`;
  return `${Math.floor(delta / 86_400)}d`;
}

export function ActivityStream({ activity }: { activity: ActivityEvent[] }) {
  const reduce = useReducedMotion();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
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
                <span className="w-16 shrink-0 label-caps">{e.kind}</span>
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
                transition={{ duration: 0.35, ease: "easeOut" }}
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

// ── The view ─────────────────────────────────────────────────────────────────

export const OperationsView = memo(function OperationsView({ metrics }: { metrics: Metrics }) {
  const hasTrend = (metrics.tickets?.openedClosedPerDay.length ?? 0) > 1;
  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-5">
        <SectionHeader kicker="Runtime" title="System &amp; throughput" />
        <SystemStrip metrics={metrics} />
        {hasTrend ? (
          <ChartCard title="Delivery trend" kicker="tickets closed · per day">
            <AreaViz
              data={(metrics.tickets?.openedClosedPerDay ?? []).map((d) => ({ date: d.date, value: d.closed }))}
              color="ink"
              seriesLabel="Closed"
              xFormatter={(v) => shortDate(String(v))}
              yFormatter={(v) => int(v)}
              valueFormatter={(v) => `${int(v)} closed`}
              heightClass="h-[200px] sm:h-[220px]"
            />
          </ChartCard>
        ) : null}
        <TicketPanels metrics={metrics} />
      </section>

      <section className="flex flex-col gap-5">
        <SectionHeader kicker="Economics" title="Worker output &amp; spend" />
        <WorkerPanels metrics={metrics} />
      </section>

      <section className="flex flex-col gap-5">
        <SectionHeader kicker="Automation" title="Runs &amp; routines" />
        <RunPanels metrics={metrics} />
        <RoutinesPanel metrics={metrics} />
      </section>

      <section className="flex flex-col gap-5">
        <SectionHeader kicker="Knowledge" title="Memory graph" />
        <MemoryPanels metrics={metrics} />
      </section>

      <section className="flex flex-col gap-5">
        <SectionHeader kicker="Sessions" title="Claude Code session analytics" />
        <ClaudeSessionsPanels metrics={metrics} />
      </section>

      <section className="flex flex-col gap-5">
        <SectionHeader kicker="Stream" title="Recent activity" />
        {metrics.recentActivity?.length ? <ActivityStream activity={metrics.recentActivity} /> : null}
      </section>
    </div>
  );
});
