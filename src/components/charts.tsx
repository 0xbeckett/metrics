import { memo, useMemo } from "react";
import { BarChart } from "@/components/dither-kit/bar-chart";
import { Bar } from "@/components/dither-kit/bar";
import { AreaChart } from "@/components/dither-kit/area-chart";
import { Area } from "@/components/dither-kit/area";
import { XAxis } from "@/components/dither-kit/x-axis";
import { YAxis } from "@/components/dither-kit/y-axis";
import { Grid } from "@/components/dither-kit/grid";
import { Tooltip } from "@/components/dither-kit/tooltip";
import { Sparkline } from "@/components/dither-kit/sparkline";
import { BlockLegend } from "@/components/dither-kit/block-legend";
import { useThemeKey } from "@/theme";
import type { DitherColor } from "@/metrics";

/*
 * The dither-kit chart vocabulary — texture and character, reserved for the
 * showpiece panels where the visual is the point. Rethemed to the design
 * tokens: seeds come from `--dk-*` CSS vars (warm ink on paper, warm-off-white
 * on the dark plane) and the neon bloom is off, so it reads as ink line-work
 * rather than a glow. Colour defaults to "ink"; pass "accent" for a live/delta
 * emphasis. The plain hairline kit (charts-plain.tsx) carries the dense panels.
 *
 * Every wrapper here is `memo`'d and hands the kit stable prop identities — the
 * `config` object is memoized and the tick/tooltip formatters are passed straight
 * through rather than re-wrapped in a fresh arrow. dither-kit keys its entrance
 * replay on `data` identity and re-derives its whole context off `config`, so a
 * literal rebuilt each render made the canvas re-animate on any parent re-render.
 */

type Datum = { label: string; value: number };

// Hoisted so the plot rect is one identity for the life of the module.
const BAR_MARGINS = { top: 12, right: 10, bottom: 26, left: 40 };
const AREA_MARGINS = { top: 12, right: 12, bottom: 26, left: 40 };

/** Single-series dithered bar chart — one category per bar, labelled on the axis. */
export const BarViz = memo(function BarViz({
  data,
  color = "ink",
  seriesLabel,
  valueFormatter,
  yFormatter,
  variant = "hatched",
  maxTicks = 8,
  heightClass = "h-[240px] sm:h-[260px]",
}: {
  data: Datum[];
  color?: DitherColor;
  seriesLabel: string;
  valueFormatter: (v: number) => string;
  yFormatter: (v: number) => string;
  variant?: "gradient" | "dotted" | "hatched" | "solid";
  maxTicks?: number;
  heightClass?: string;
}) {
  const config = useMemo(() => ({ value: { label: seriesLabel, color } }), [seriesLabel, color]);
  const tk = useThemeKey();
  return (
    <div key={tk} className={`dk-plot w-full ${heightClass}`}>
      <BarChart
        data={data}
        config={config}
        className="h-full w-full"
        margins={BAR_MARGINS}
        bloom="off"
      >
        <Grid />
        <YAxis tickFormatter={yFormatter} tickCount={4} />
        <XAxis dataKey="label" maxTicks={maxTicks} />
        <Bar dataKey="value" variant={variant} />
        <Tooltip labelKey="label" valueFormatter={valueFormatter} />
      </BarChart>
    </div>
  );
});

export type Series = { key: string; label: string; color: DitherColor };

/** Grouped dithered bar chart — one category per tick, a bar per series. */
export const GroupedBarViz = memo(function GroupedBarViz({
  data,
  series,
  xKey = "label",
  valueFormatter,
  yFormatter,
  variant = "hatched",
  maxTicks = 8,
  heightClass = "h-[240px] sm:h-[260px]",
}: {
  data: Record<string, string | number>[];
  series: Series[];
  xKey?: string;
  valueFormatter: (v: number) => string;
  yFormatter: (v: number) => string;
  variant?: "gradient" | "dotted" | "hatched" | "solid";
  maxTicks?: number;
  heightClass?: string;
}) {
  const config = useMemo(
    () => Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }])),
    [series],
  );
  const tk = useThemeKey();
  return (
    <div className="flex flex-col gap-3">
      <div key={tk} className={`dk-plot w-full ${heightClass}`}>
        <BarChart
          data={data}
          config={config}
          className="h-full w-full"
          margins={BAR_MARGINS}
          bloom="off"
        >
          <Grid />
          <YAxis tickFormatter={yFormatter} tickCount={4} />
          <XAxis dataKey={xKey} maxTicks={maxTicks} />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} variant={variant} />
          ))}
          <Tooltip labelKey={xKey} valueFormatter={valueFormatter} />
        </BarChart>
      </div>
      <BlockLegend config={config} align="start" />
    </div>
  );
});

/** Dithered area chart for a time series — the textured showpiece trend. */
export const AreaViz = memo(function AreaViz({
  data,
  color = "ink",
  seriesLabel,
  xFormatter,
  yFormatter,
  valueFormatter,
  maxTicks = 6,
  heightClass = "h-[240px] sm:h-[260px]",
}: {
  data: { date: string; value: number }[];
  color?: DitherColor;
  seriesLabel: string;
  xFormatter: (v: unknown) => string;
  yFormatter: (v: number) => string;
  valueFormatter: (v: number) => string;
  maxTicks?: number;
  heightClass?: string;
}) {
  const config = useMemo(() => ({ value: { label: seriesLabel, color } }), [seriesLabel, color]);
  const tk = useThemeKey();
  return (
    <div key={tk} className={`dk-plot w-full ${heightClass}`}>
      <AreaChart
        data={data}
        config={config}
        className="h-full w-full"
        margins={AREA_MARGINS}
        bloom="off"
      >
        <Grid />
        <YAxis tickFormatter={yFormatter} tickCount={4} />
        <XAxis dataKey="date" tickFormatter={xFormatter} maxTicks={maxTicks} />
        <Area dataKey="value" variant="gradient" />
        <Tooltip labelKey="date" valueFormatter={valueFormatter} />
      </AreaChart>
    </div>
  );
});

/** Tiny inline sparkline for hero stats — no axes, just the dithered trend. */
export const Spark = memo(function Spark({
  data,
  color = "ink",
}: {
  data: number[];
  color?: DitherColor;
}) {
  const tk = useThemeKey();
  return (
    <div key={tk} className="h-full w-full">
      <Sparkline data={data} color={color} variant="gradient" className="h-full w-full" />
    </div>
  );
});
