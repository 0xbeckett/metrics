import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { scaleLinear } from "d3-scale";
import { cn } from "@/lib/utils";

/*
 * The plain hairline chart vocabulary — for the dense panels where the reader is
 * there to read a number. Per the dataviz method: hairline axes/grid at ~8% ink,
 * 1px ink data strokes, a single flat ink tint for fills, small grotesque tick
 * labels in muted ink, tabular figures, no dithering and no gradients. Two-series
 * charts separate by ink *lightness* (a CVD-safe channel) plus a legend — colour
 * stays reserved for the one live/delta accent, never for series identity.
 *
 * Everything reads from the design tokens (var(--ink) / --grid / --axis / --tint),
 * so a token change moves this kit and the dither kit together.
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

const inkShade = (shade: number) =>
  shade >= 1 ? "var(--ink)" : `color-mix(in srgb, var(--ink) ${Math.round(shade * 100)}%, transparent)`;

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

export type LineSeries = { key: string; label: string; shade?: number };

/**
 * Multi-series line chart over a categorical/time x. Single series may carry a
 * flat ink tint fill; multiple series read as ink lines at different lightness
 * with a legend. Crosshair tooltip on hover.
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
                  <span
                    className="inline-block h-[2px] w-3"
                    style={{ background: inkShade(s.shade ?? 1) }}
                  />
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
                <text
                  key={i}
                  x={px(i)}
                  y={ih + 14}
                  textAnchor="middle"
                  fontSize={10}
                >
                  {xFormat(String(d[xKey]))}
                </text>
              ) : null,
            )}
            {fill && series.length === 1 && (
              <path
                d={`${path(series[0])} L${px(data.length - 1).toFixed(1)},${ih} L${px(0).toFixed(1)},${ih} Z`}
                fill="var(--tint)"
                stroke="none"
              />
            )}
            {series.map((s) => (
              <path
                key={s.key}
                d={path(s)}
                fill="none"
                stroke={inkShade(s.shade ?? 1)}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {hover != null && data[hover] && (
              <line
                x1={px(hover)}
                x2={px(hover)}
                y1={0}
                y2={ih}
                stroke="var(--axis)"
                strokeWidth={1}
              />
            )}
            {hover != null &&
              data[hover] &&
              series.map((s) => (
                <circle
                  key={s.key}
                  cx={px(hover)}
                  cy={y(Number(data[hover][s.key]) || 0)}
                  r={3.5}
                  fill={inkShade(s.shade ?? 1)}
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
          <span className="inline-block h-[2px] w-3.5" style={{ background: inkShade(s.shade ?? 1) }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** Vertical columns — ≤24px thick, 4px-rounded cap, single ink tint fill. */
export function ColumnsPlain({
  data,
  yFormat = (n) => String(n),
  tipFormat,
  height = 220,
  maxXTicks = 12,
  className,
}: {
  data: { label: string; value: number }[];
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
  const bw = Math.min(24, band - 2);
  const yticks = y.ticks(4);
  const xstep = Math.max(1, Math.ceil(data.length / maxXTicks));

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
                    height={Math.max(0, h)}
                    rx={Math.min(4, bw / 2)}
                    fill={hover === i ? "var(--ink)" : "var(--tint)"}
                    stroke="var(--ink)"
                    strokeWidth={1}
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

/** Horizontal ranking bars — label at left, single ink tint fill, value at tip. */
export function BarsPlain({
  data,
  valueFormat = (n) => String(n),
  rowHeight = 26,
  labelWidth = 92,
  className,
}: {
  data: { label: string; value: number; hint?: string }[];
  valueFormat?: (n: number) => string;
  rowHeight?: number;
  labelWidth?: number;
  className?: string;
}) {
  const [ref, w] = useWidth();
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
            <div key={i} className="flex items-center" style={{ height: rowHeight }}>
              <div
                className="shrink-0 truncate pr-2 text-right text-[12px] text-muted-foreground"
                style={{ width: labelWidth }}
                title={d.hint ?? d.label}
              >
                {d.label}
              </div>
              <div className="relative" style={{ width: track, height: bh }}>
                <div
                  className="absolute inset-y-0 left-0 rounded-[3px]"
                  style={{
                    width: Math.max(2, x(d.value)),
                    background: "var(--tint)",
                    boxShadow: "inset 0 0 0 1px var(--ink)",
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

export type Segment = { label: string; value: number; shade?: number };

/** A single 100%-stacked proportion bar with 2px surface gaps and a legend. */
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
  const shades = useMemo(
    () => segments.map((_, i) => 1 - (i / Math.max(1, segments.length - 1)) * 0.6),
    [segments],
  );
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex h-7 w-full overflow-hidden rounded-[var(--radius-small)]" style={{ gap: 2 }}>
        {segments.map((s, i) => (
          <div
            key={s.label}
            title={`${s.label}: ${valueFormat(s.value)}`}
            style={{
              flexGrow: Math.max(s.value, 0.0001),
              flexBasis: 0,
              background: inkShade(s.shade ?? shades[i]),
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((s, i) => (
          <span key={s.label} className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <span
              className="inline-block size-2.5 rounded-[2px]"
              style={{ background: inkShade(s.shade ?? shades[i]) }}
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
