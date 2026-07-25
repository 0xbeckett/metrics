import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { CountUp } from "@/motion";

/*
 * The one design system — datacurve direction. Warm ink on warm paper, hairline
 * surfaces (no shadows, no elevation), a serif display face for headings and
 * large metric values, a grotesque for body/labels/data, and exactly one accent
 * reserved for live/delta states. Dark mode is the same tokens inverted.
 */

/** A surface that sits on the page plane, separated by a 1px hairline. 8px radius. */
export function Panel({
  className,
  children,
  as: As = "div",
}: {
  className?: string;
  children: ReactNode;
  as?: "div" | "section" | "header";
}) {
  return (
    <As className={cn("rounded-lg border border-border bg-card", className)}>{children}</As>
  );
}

/** Small uppercase, letter-spaced grotesque label — the quiet caption voice. */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("label-caps", className)}>{children}</div>;
}

/** A serif section heading, tight negative tracking. */
export function SectionHeader({
  title,
  kicker,
  className,
}: {
  title: string;
  kicker?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {kicker ? <Label>{kicker}</Label> : null}
      <h2 className="font-display text-2xl leading-[1.05] text-foreground sm:text-3xl">{title}</h2>
    </div>
  );
}

/** Signed delta beside a metric — the one accent, direction shown by glyph+sign. */
export function Delta({ value, format }: { value: number; format?: (n: number) => string }) {
  if (!value) return null;
  const up = value > 0;
  const fmt = format ?? ((n: number) => String(Math.abs(Math.round(n))));
  return (
    <span className="inline-flex items-center gap-0.5 text-[13px] font-medium tabular-nums text-primary">
      {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      {fmt(Math.abs(value))}
    </span>
  );
}

/**
 * Hero figure: an oversized serif count-up value over a small-caps label, a
 * small grotesque sub / unit, optional delta and a decorative sparkline. Values
 * tween on first reveal and again whenever they change on a live poll.
 */
export function HeroStat({
  label,
  value,
  format,
  sub,
  unit,
  delta,
  deltaFormat,
  spark,
  className,
}: {
  label: string;
  value: number;
  format: (n: number) => string;
  sub?: string;
  unit?: string;
  delta?: number;
  deltaFormat?: (n: number) => string;
  spark?: ReactNode;
  className?: string;
}) {
  return (
    <Panel className={cn("flex flex-col justify-between gap-3 p-4 sm:gap-4 sm:p-5", className)}>
      <Label>{label}</Label>
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline gap-1.5">
          <CountUp
            value={value}
            format={format}
            className="font-display text-[2.4rem] leading-[0.95] tabular-nums text-foreground sm:text-5xl"
          />
          {unit ? <span className="text-sm text-muted-foreground">{unit}</span> : null}
          {delta !== undefined ? <Delta value={delta} format={deltaFormat} /> : null}
        </div>
        {sub ? <div className="text-[12px] tabular-nums text-muted-foreground">{sub}</div> : null}
      </div>
      {spark ? <div className="h-8 w-full sm:h-10">{spark}</div> : null}
    </Panel>
  );
}

/**
 * A compact metric — serif value with a grotesque unit and optional delta. Used
 * inside panels where a HeroStat would be too loud. Takes a pre-formatted string.
 */
export function Metric({
  label,
  value,
  unit,
  sub,
  delta,
  deltaFormat,
  className,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  delta?: number;
  deltaFormat?: (n: number) => string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Label>{label}</Label>
      <div className="flex items-baseline gap-1.5">
        <span className="font-display text-2xl leading-none tabular-nums text-foreground sm:text-[1.75rem]">
          {value}
        </span>
        {unit ? <span className="text-[12px] text-muted-foreground">{unit}</span> : null}
        {delta !== undefined ? <Delta value={delta} format={deltaFormat} /> : null}
      </div>
      {sub ? <div className="text-[12px] tabular-nums text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

/** Static headline figure (pre-formatted string) — matches HeroStat's frame. */
export function Stat({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  className?: string;
}) {
  return (
    <Panel className={cn("flex flex-col justify-between gap-3 p-4 sm:gap-4 sm:p-5", className)}>
      <Label>{label}</Label>
      <div className="flex flex-col gap-1">
        <div className="font-display text-[1.9rem] leading-[0.95] tabular-nums text-foreground sm:text-4xl">
          {value}
        </div>
        {sub ? <div className="text-[12px] tabular-nums text-muted-foreground">{sub}</div> : null}
      </div>
    </Panel>
  );
}

/** One figure in a derived-ratio strip: serif number, tiny caps label, inline. */
export function StatChip({
  value,
  label,
  format,
}: {
  value: number;
  label: string;
  format: (n: number) => string;
}) {
  return (
    <div className="flex shrink-0 items-baseline gap-2 whitespace-nowrap px-4 py-3 sm:px-5">
      <CountUp
        value={value}
        format={format}
        className="font-display text-xl tabular-nums text-foreground sm:text-2xl"
      />
      <Label>{label}</Label>
    </div>
  );
}

/** A titled chart panel: serif title + kicker, roomy plot area, optional footnote. */
export function ChartCard({
  title,
  kicker,
  footnote,
  action,
  children,
  className,
}: {
  title: string;
  kicker?: string;
  footnote?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Panel as="section" className={cn("flex flex-col", className)}>
      <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex flex-col gap-0.5">
          <h3 className="font-display text-lg leading-none text-foreground">{title}</h3>
          {kicker ? <Label>{kicker}</Label> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">{children}</div>
      {footnote ? (
        <div className="border-t border-border px-4 py-2 text-[11px] leading-relaxed text-muted-foreground sm:px-5">
          {footnote}
        </div>
      ) : null}
    </Panel>
  );
}

/** A pulsing accent dot — the "live" indicator glyph. Steady under reduced motion. */
export function LiveDot({ live = true }: { live?: boolean }) {
  return (
    <span className="relative inline-flex size-2">
      {live ? (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60 motion-reduce:hidden" />
      ) : null}
      <span
        className={cn(
          "relative inline-flex size-2 rounded-full",
          live ? "bg-primary" : "bg-muted-foreground",
        )}
      />
    </span>
  );
}

/** A small square status dot + label — daemon/service state, not color-alone. */
export function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] tabular-nums text-muted-foreground">
      <span
        aria-hidden
        className={cn("size-1.5 rounded-[1px]", ok ? "bg-foreground" : "bg-primary")}
      />
      {label}
    </span>
  );
}
