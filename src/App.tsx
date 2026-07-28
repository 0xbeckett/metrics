import { memo, type ReactNode } from "react";
import { Moon, Sun } from "lucide-react";
import { Spark } from "@/components/charts";
import { HeroStat, Label, LiveDot, Panel } from "@/components/ui";
import { SectionNav, useScrollSpy, type NavSection } from "@/components/section-nav";
import { cn } from "@/lib/utils";
import { useTheme } from "@/theme";
import { formatAge, useDataAge, useLiveMetrics } from "@/live";
import { shortDate, usdPrecise, type Metrics } from "@/metrics";
import { compact, deriveMetrics, int, lastDelta } from "@/derived";
import { metricDither } from "@/palette";
import { SpendView, WorkView, LoopView, RuntimeView } from "@/panels";

const SECTIONS: NavSection[] = [
  { id: "overview", label: "Overview" },
  { id: "spend", label: "Spend" },
  { id: "work", label: "Work" },
  { id: "loop", label: "The loop" },
  { id: "runtime", label: "Runtime" },
];

/**
 * The headline strip: the six numbers that carry the whole story, each pointing
 * forward to the section that expands it — spend, tickets, code output, sessions,
 * quality. Figures count up on reveal and re-tween on every live poll.
 */
const Overview = memo(function Overview({ metrics }: { metrics: Metrics }) {
  const h = metrics.headline;
  const cs = metrics.codeStats;
  const d = deriveMetrics(metrics);
  const t = metrics.tickets;
  const doneTickets = t?.byStatus.find((s) => s.status === "done")?.count ?? 0;
  const dailyCommits = cs.velocity.map((v) => v.commits);
  const dailyRuns = metrics.runsOverTime.map((x) => x.runs);
  const dailyCost = metrics.runsOverTime.map((x) => x.cost);
  const runsDelta = lastDelta(metrics.runsOverTime.map((x) => ({ value: x.runs })));
  const costDelta = lastDelta(metrics.runsOverTime.map((x) => ({ value: x.cost })));

  return (
    <section id="overview" className="scroll-mt-24">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <HeroStat
          label="Total spend"
          value={h.totalSpend}
          format={usdPrecise}
          sub={metrics.notes.unratedModelSessions > 0 ? `${int(metrics.notes.unratedModelSessions)} sessions uncosted` : undefined}
          delta={Math.round(costDelta)}
          deltaFormat={(n) => usdPrecise(Math.round(n))}
          deltaGoodWhen="down"
          spark={<Spark data={dailyCost} color={metricDither("spend")} />}
        />
        <HeroStat
          label="Sessions"
          value={h.totalRuns}
          format={int}
          delta={runsDelta}
          deltaGoodWhen="up"
          spark={<Spark data={dailyRuns} color={metricDither("sessions")} />}
        />
        <HeroStat
          label="Commits"
          value={cs.headline.commits}
          format={int}
          sub={`+${compact(cs.headline.additions)} lines`}
          spark={<Spark data={dailyCommits} color={metricDither("commits")} />}
        />
        <HeroStat label="Lines shipped" value={cs.headline.additions} format={int} sub={`across ${int(cs.headline.projects)} projects`} />
        {t?.available ? (
          <HeroStat label="Tickets shipped" value={doneTickets} format={int} sub={`of ${int(t.total)} tracked`} />
        ) : (
          <HeroStat label="Compute" value={h.totalWallHours} format={(n) => `${int(n)}h`} sub={`${h.modelsUsed} models`} />
        )}
        <HeroStat label="First-try pass" value={d.firstTryRate} format={(n) => `${Math.round(n * 100)}%`} sub="reviewable worker runs only" />
      </div>
    </section>
  );
});

/**
 * Masthead live indicator: a pulsing good-state dot + honest data age, which
 * degrades to a hollow warn ring and the word "stale". Three channels — glyph
 * shape, wording, colour — so the state never rides on hue alone.
 *
 * It owns the 1s clock rather than taking an age from above, so the per-second
 * tick re-renders these few spans and nothing else on the page.
 */
const LiveIndicator = memo(function LiveIndicator({
  refreshedAt,
  fetchOk,
}: {
  refreshedAt: number | null;
  fetchOk: boolean;
}) {
  const { ageSeconds, stale } = useDataAge(refreshedAt, fetchOk);

  return (
    <div
      className={cn(
        "inline-flex min-h-11 items-center gap-2 rounded-md border px-2.5 text-[13px] tabular-nums transition-colors duration-200 sm:min-h-0 sm:py-2",
        stale ? "border-warn/40 text-warn" : "border-border text-muted-foreground",
      )}
      aria-live="polite"
      title={stale ? "Data has not advanced recently" : "Live — polling every 15s"}
    >
      <LiveDot live={!stale} />
      <span className="hidden sm:inline">{stale ? "stale" : `updated ${formatAge(ageSeconds)}`}</span>
      <span className="sr-only">{stale ? "data stale" : `updated ${formatAge(ageSeconds)}`}</span>
    </div>
  );
});

/** A titled page section: a hairline rule and roomy whitespace above, an eyebrow
 *  + serif heading, then the body. The eyebrow names the section's role. */
function Section({
  id,
  kicker,
  title,
  blurb,
  children,
}: {
  id: string;
  kicker: string;
  title: string;
  blurb: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-border pt-10 sm:pt-12">
      <header className="mb-6 flex flex-col gap-2">
        <Label>{kicker}</Label>
        <h2 className="font-display text-3xl leading-[1.02] text-foreground sm:text-4xl">{title}</h2>
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">{blurb}</p>
      </header>
      {children}
    </section>
  );
}

function Colophon({ metrics }: { metrics: Metrics }) {
  const cs = metrics.codeStats;
  return (
    <Panel className="mt-12 flex flex-col gap-3 p-4 text-[11px] leading-relaxed text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:p-5">
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
            className="rounded-[2px] text-foreground underline decoration-primary decoration-1 underline-offset-2 transition-colors duration-150 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            dither-kit
          </a>
          {" · "}
          plain
        </span>
      </div>
    </Panel>
  );
}

export function App() {
  const { dark, toggle } = useTheme();
  const { metrics, refreshedAt, fetchOk } = useLiveMetrics();
  const active = useScrollSpy(SECTIONS.map((s) => s.id));

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12 lg:px-8">
        <header className="mb-6 flex flex-col gap-3">
          <Label>Beckett · Autonomous Agent</Label>
          <h1 className="font-display text-[2.75rem] leading-[0.95] text-foreground sm:text-6xl lg:text-7xl">
            Proof of Work
          </h1>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            One coding agent, told entirely in numbers — every figure harvested from real git history
            and session logs, none by hand.
          </p>
        </header>

        <SectionNav
          sections={SECTIONS}
          active={active}
          controls={
            <>
              <LiveIndicator refreshedAt={refreshedAt} fetchOk={fetchOk} />
              <button
                type="button"
                onClick={toggle}
                aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
                className="inline-flex size-11 items-center justify-center rounded-md border border-border text-foreground transition-[color,background-color,border-color,transform] duration-200 ease-out hover:border-border-strong hover:bg-secondary hover:text-primary active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:size-9"
              >
                {dark ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
              </button>
            </>
          }
        />

        <main className="flex flex-col gap-10 sm:gap-12">
          <Overview metrics={metrics} />

          <Section
            id="spend"
            kicker="The money"
            title="Where the dollars go"
            blurb="Every cost the agent incurs, in one place: the running total and its per-outcome ratios, daily spend, cost per model, and cost per ticket — one currency, one window."
          >
            <SpendView metrics={metrics} />
          </Section>

          <Section
            id="work"
            kicker="Output"
            title="Work shipped"
            blurb="What the spend bought: commit velocity, lines per project, and who authored them."
          >
            <WorkView metrics={metrics} />
          </Section>

          <Section
            id="loop"
            kicker="The loop"
            title="Tickets in, work out"
            blurb="The delivery loop end to end — throughput, lead time, rework, and how worker runs land."
          >
            <LoopView metrics={metrics} />
          </Section>

          <Section
            id="runtime"
            kicker="Runtime"
            title="The machine, running"
            blurb="System health, session analytics, automation and memory — the live shape of the host."
          >
            <RuntimeView metrics={metrics} />
          </Section>
        </main>

        <Colophon metrics={metrics} />
        <div className="sr-only">
          {compact(metrics.codeStats.headline.additions)} lines across {metrics.codeStats.headline.projects} projects.
        </div>
      </div>
    </div>
  );
}
