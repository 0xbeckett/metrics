import { useEffect, useRef, useState, type ReactNode } from "react";
import { scaleLinear } from "d3-scale";
import { cn } from "@/lib/utils";
import { rampColor, segmentColor } from "@/palette";

/*
 * The plain hairline chart vocabulary — for the dense panels where the reader is
 * there to read a number. Per the dataviz method: hairline axes/grid at ~8% ink,
 * recessive chrome, small grotesque tick labels in muted ink, tabular figures,
 * no gradients.
 *
 * Colour (#3) sits in the marks and nowhere else. A series takes a categorical
 * slot token (`var(--series-N)`) chosen by *what it measures*, not by its index
 * in this chart, so the same metric is the same hue in every panel; ordered
 * buckets take the one-hue `--seq-*` ramp; outcome words take the reserved
 * status tokens. Identity never rides on hue alone — every series carries a
 * legend entry or a printed label, and multi-series lines also differ by dash.
 * Text stays on text tokens; only the mark is coloured.
 */

/** Measure the container so the SVG can be pixel-crisp and responsive. */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width ?? 0;
      setW(cw);
    });
    ro.observe(el);
    setW(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const INK = "var(--ink)";
/** Marks fade to this while another mark is hovered — focus without a repaint. */
const DIM = 0.35;
/** Fast, opacity-only mark transition. The reduced-motion block in index.css
 *  carries `!important`, so it overrides this inline declaration. */
const FADE = { transition: "opacity 180ms ease-out" } as const;

type Tip = { x: number; y: number; node: ReactNode } | null;

function Tooltip({ tip, width }: { tip: Tip; width: number }) {
  if (!tip) return null;
  const left = Math.min(Math.max(tip.x, 8), Math.max(8, width - 8));
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-[var(--radius-small)] border border-border-strong bg-popover px-2 py-1 text-[11px] leading-tight text-foreground shadow-none"
      style={{ left, top: Math.max(tip.y - 8, 0) }}
    >
      {tip.node}
    </div>
  );
}

/** A legend/tooltip swatch — the only place a series colour meets its label. */
function Swatch({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-block h-[3px] w-3.5 rounded-[1px]"
      style={
        dashed
          ? { backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)` }
          : { background: color }
      }
    />
  );
}

export type LineSeries = { key: string; label: string; color?: string; dashed?: boolean };

/**
 * Multi-series line chart over a categorical/time x. A single series may carry a
 * flat tint of its own hue; multiple series read as coloured lines that also
 * differ by dash pattern, with a legend. Crosshair tooltip on hover.
 */
export function LinePlain({
  data,
  series,
  xKey = "label",
  xFormat = (s) => s,
  yFormat = (n) => String(n),
  tipFormat,
  fill = false,
  height = 220,
  maxXTicks = 6,
  className,
}: {
  data: Record<string, string | number>[];
  series: LineSeries[];
  xKey?: string;
  xFormat?: (s: string) => string;
  yFormat?: (n: number) => string;
  tipFormat?: (n: number) => string;
  fill?: boolean;
  height?: number;
  maxXTicks?: number;
  className?: string;
}) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const m = { top: 10, right: 12, bottom: 22, left: 38 };
  const iw = Math.max(0, w - m.left - m.right);
  const ih = height - m.top - m.bottom;
  const fmtTip = tipFormat ?? yFormat;
  const colorOf = (s: LineSeries) => s.color ?? INK;

  const maxY = Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)));
  const y = scaleLinear().domain([0, maxY]).nice().range([ih, 0]);
  const px = (i: number) => (data.length <= 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const yticks = y.ticks(4);
  const xstep = Math.max(1, Math.ceil(data.length / maxXTicks));

  const path = (s: LineSeries) =>
    data
      .map((d, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${y(Number(d[s.key]) || 0).toFixed(1)}`)
      .join(" ");

  const tip: Tip =
    hover != null && data[hover]
      ? {
          x: m.left + px(hover),
          y: m.top + Math.min(...series.map((s) => y(Number(data[hover][s.key]) || 0))),
          node: (
            <div className="flex flex-col gap-0.5">
              <div className="label-caps">{xFormat(String(data[hover][xKey]))}</div>
              {series.map((s) => (
                <div key={s.key} className="flex items-center gap-1.5 tabular-nums">
                  <Swatch color={colorOf(s)} dashed={s.dashed} />
                  <span className="text-muted-foreground">{s.label}</span>
                  <span className="ml-auto font-medium">{fmtTip(Number(data[hover][s.key]) || 0)}</span>
                </div>
              ))}
            </div>
          ),
        }
      : null;

  return (
    <div className={cn("relative w-full", className)} ref={ref}>
      {w > 0 && (
        <svg className="plain-plot block w-full" height={height} role="img">
          <g transform={`translate(${m.left},${m.top})`}>
            {yticks.map((t) => (
              <g key={t}>
                <line x1={0} x2={iw} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
                <text x={-8} y={y(t)} textAnchor="end" dominantBaseline="central" fontSize={10}>
                  {yFormat(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) =>
              i % xstep === 0 ? (
                <text key={i} x={px(i)} y={ih + 14} textAnchor="middle" fontSize={10}>
                  {xFormat(String(d[xKey]))}
                </text>
              ) : null,
            )}
            {fill && series.length === 1 && (
              <path
                d={`${path(series[0])} L${px(data.length - 1).toFixed(1)},${ih} L${px(0).toFixed(1)},${ih} Z`}
                fill={colorOf(series[0])}
                fillOpacity={0.12}
                stroke="none"
              />
            )}
            {series.map((s) => (
              <path
                key={s.key}
                d={path(s)}
                fill="none"
                stroke={colorOf(s)}
                strokeWidth={2}
                strokeDasharray={s.dashed ? "5 4" : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {hover != null && data[hover] && (
              <line x1={px(hover)} x2={px(hover)} y1={0} y2={ih} stroke="var(--axis)" strokeWidth={1} />
            )}
            {hover != null &&
              data[hover] &&
              series.map((s) => (
                <circle
                  key={s.key}
                  cx={px(hover)}
                  cy={y(Number(data[hover][s.key]) || 0)}
                  r={4}
                  fill={colorOf(s)}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              ))}
            {/* hit zones */}
            {data.map((_, i) => (
              <rect
                key={i}
                x={px(i) - iw / Math.max(data.length, 1) / 2}
                y={0}
                width={iw / Math.max(data.length, 1)}
                height={ih}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            ))}
          </g>
        </svg>
      )}
      <Tooltip tip={tip} width={w} />
      {series.length > 1 && <PlainLegend series={series} />}
    </div>
  );
}

function PlainLegend({ series }: { series: LineSeries[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {series.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5 label-caps">
          <Swatch color={s.color ?? INK} dashed={s.dashed} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Vertical columns — ≤24px thick, 4px-rounded cap on the baseline. `ramp` treats
 * the categories as an ordered sequence (buckets, cycles) and paints the one-hue
 * `--seq-*` ramp across them so the order is visible in the colour; otherwise
 * every column wears the single hue of the metric it measures.
 */
export function ColumnsPlain({
  data,
  color = INK,
  ramp = false,
  yFormat = (n) => String(n),
  tipFormat,
  height = 220,
  maxXTicks = 12,
  className,
}: {
  data: { label: string; value: number }[];
  color?: string;
  ramp?: boolean;
  yFormat?: (n: number) => string;
  tipFormat?: (n: number) => string;
  height?: number;
  maxXTicks?: number;
  className?: string;
}) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const m = { top: 10, right: 8, bottom: 22, left: 38 };
  const iw = Math.max(0, w - m.left - m.right);
  const ih = height - m.top - m.bottom;
  const fmtTip = tipFormat ?? yFormat;
  const maxY = Math.max(1, ...data.map((d) => d.value));
  const y = scaleLinear().domain([0, maxY]).nice().range([ih, 0]);
  const band = data.length ? iw / data.length : 0;
  // 2px of surface between neighbours, per the mark spec.
  const bw = Math.min(24, Math.max(2, band - 2));
  const yticks = y.ticks(4);
  const xstep = Math.max(1, Math.ceil(data.length / maxXTicks));
  const fillOf = (i: number) => (ramp ? rampColor(i, data.length) : color);

  const tip: Tip =
    hover != null && data[hover]
      ? {
          x: m.left + band * hover + band / 2,
          y: m.top + y(data[hover].value),
          node: (
            <div className="flex flex-col gap-0.5 tabular-nums">
              <div className="label-caps">{data[hover].label}</div>
              <div className="font-medium">{fmtTip(data[hover].value)}</div>
            </div>
          ),
        }
      : null;

  return (
    <div className={cn("relative w-full", className)} ref={ref}>
      {w > 0 && (
        <svg className="plain-plot block w-full" height={height} role="img">
          <g transform={`translate(${m.left},${m.top})`}>
            {yticks.map((t) => (
              <g key={t}>
                <line x1={0} x2={iw} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
                <text x={-8} y={y(t)} textAnchor="end" dominantBaseline="central" fontSize={10}>
                  {yFormat(t)}
                </text>
              </g>
            ))}
            <line x1={0} x2={iw} y1={ih} y2={ih} stroke="var(--axis)" strokeWidth={1} />
            {data.map((d, i) => {
              const h = ih - y(d.value);
              const cx = band * i + band / 2;
              return (
                <g key={i}>
                  <rect
                    x={cx - bw / 2}
                    y={y(d.value)}
                    width={bw}
                    height={Math.max(1, h)}
                    rx={Math.min(4, bw / 2)}
                    fill={fillOf(i)}
                    style={FADE}
                    opacity={hover === null || hover === i ? 1 : DIM}
                  />
                  {i % xstep === 0 && (
                    <text x={cx} y={ih + 14} textAnchor="middle" fontSize={10}>
                      {d.label}
                    </text>
                  )}
                  <rect
                    x={band * i}
                    y={0}
                    width={band}
                    height={ih}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                  />
                </g>
              );
            })}
          </g>
        </svg>
      )}
      <Tooltip tip={tip} width={w} />
    </div>
  );
}

export type BarRow = { label: string; value: number; hint?: string; color?: string };

/**
 * Horizontal ranking bars — label at left, solid mark, value at the tip. One hue
 * for the whole set (bar length already encodes the magnitude); a row may carry
 * its own `color` when the rows are real entities with an identity to keep, such
 * as models, which wear the same slot in every panel they appear in.
 */
export function BarsPlain({
  data,
  color = INK,
  valueFormat = (n) => String(n),
  rowHeight = 26,
  labelWidth = 92,
  className,
}: {
  data: BarRow[];
  color?: string;
  valueFormat?: (n: number) => string;
  rowHeight?: number;
  labelWidth?: number;
  className?: string;
}) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const gap = 12;
  const track = Math.max(0, w - labelWidth - gap);
  const x = scaleLinear().domain([0, max]).range([0, track]);
  const bh = Math.min(16, rowHeight - 8);

  return (
    <div className={cn("w-full", className)} ref={ref}>
      {w > 0 && (
        <div className="flex flex-col">
          {data.map((d, i) => (
            <div
              key={i}
              className="flex items-center"
              style={{ height: rowHeight }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <div
                className="shrink-0 truncate pr-2 text-right text-[12px] text-muted-foreground transition-colors duration-150"
                style={{ width: labelWidth, color: hover === i ? "var(--foreground)" : undefined }}
                title={d.hint ?? d.label}
              >
                {d.label}
              </div>
              <div className="relative" style={{ width: track, height: bh }}>
                <div
                  className="absolute inset-y-0 left-0 rounded-[4px]"
                  style={{
                    ...FADE,
                    width: Math.max(2, x(d.value)),
                    background: d.color ?? color,
                    opacity: hover === null || hover === i ? 1 : DIM,
                  }}
                />
                <span
                  className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap pl-2 text-[12px] font-medium tabular-nums text-foreground"
                  style={{ left: Math.max(2, x(d.value)) }}
                >
                  {valueFormat(d.value)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export type Segment = { label: string; value: number; color?: string };

/**
 * A single 100%-stacked proportion bar with 2px surface gaps and a legend.
 * Segments whose label names a state (done / failed / blocked …) wear the
 * reserved status tokens; anything else takes categorical slots in fixed order.
 */
export function ProportionBar({
  segments,
  valueFormat = (n) => String(n),
  className,
}: {
  segments: Segment[];
  valueFormat?: (n: number) => string;
  className?: string;
}) {
  const total = Math.max(1, segments.reduce((s, x) => s + x.value, 0));
  const [hover, setHover] = useState<number | null>(null);
  const fillOf = (s: Segment, i: number) => s.color ?? segmentColor(s.label, i);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex h-7 w-full overflow-hidden rounded-[var(--radius-small)]" style={{ gap: 2 }}>
        {segments.map((s, i) => (
          <div
            key={s.label}
            title={`${s.label}: ${valueFormat(s.value)}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            style={{
              ...FADE,
              flexGrow: Math.max(s.value, 0.0001),
              flexBasis: 0,
              background: fillOf(s, i),
              opacity: hover === null || hover === i ? 1 : DIM,
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((s, i) => (
          <span
            key={s.label}
            className="flex items-center gap-1.5 text-[12px] text-muted-foreground"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span
              aria-hidden
              className="inline-block size-2.5 rounded-[2px]"
              style={{ background: fillOf(s, i) }}
            />
            <span className="text-foreground">{s.label}</span>
            <span className="tabular-nums text-label">
              {valueFormat(s.value)} · {Math.round((s.value / total) * 100)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
