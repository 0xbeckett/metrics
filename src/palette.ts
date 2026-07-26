import type { DitherColor } from "@/metrics";

/*
 * The identity layer over the colour tokens in index.css (#3).
 *
 * One rule: a measure keeps its hue everywhere. Commits are indigo in the
 * velocity trend, in the per-project ranking and in the authorship ranking;
 * sessions are teal in the hero spark, the runs-per-day line, the session trend
 * and the tool mix; spend is gold wherever dollars appear. Nothing in here holds
 * a colour value — every entry resolves to a `--series-*` / `--seq-*` / status
 * token, so the palette still lives in exactly one file.
 *
 * Slot order is fixed (1 rose · 2 indigo · 3 moss · 4 violet · 5 gold · 6 teal)
 * and assigned, never cycled — that order is what the CVD validation measured,
 * and only *neighbouring* slots are validated against each other. So: series
 * that share a chart take adjacent slots, ordered bucket sets take the one-hue
 * `--seq-*` ramp, and a nominal ranking (projects, authors, models, tools) wears
 * the single hue of the thing it measures — bar length already carries the
 * ranking, and spending six hues on row identity would put unvalidated pairs
 * side by side for nothing.
 */

export type Slot = 1 | 2 | 3 | 4 | 5 | 6;

/** The paint value for a slot: `var(--series-N)`. */
export const slotColor = (slot: Slot): string => `var(--series-${slot})`;

/** The dither-kit seed name for a slot (canvas kit reads the same triplet). */
export const SLOT_DITHER: Record<Slot, DitherColor> = {
  1: "rose",
  2: "indigo",
  3: "moss",
  4: "violet",
  5: "gold",
  6: "teal",
};

/** Legacy + slot colour names → slot, so a stale metrics.json still paints. */
export const SLOT_OF_DITHER: Partial<Record<DitherColor, Slot>> = {
  rose: 1, indigo: 2, moss: 3, violet: 4, gold: 5, teal: 6,
  red: 1, blue: 2, green: 3, purple: 4, orange: 5, pink: 6,
};

/** A model/entity colour straight off the data document → a paint value. */
export function ditherColorValue(color: DitherColor): string {
  const slot = SLOT_OF_DITHER[color];
  return slot ? slotColor(slot) : "var(--ink-soft)";
}

// ── Metric identity ──────────────────────────────────────────────────────────
// The subjects this dashboard measures. Each owns one slot for the whole page.
//
// Two metrics that share a chart must sit on ADJACENT slots — the fixed order is
// the CVD-safety mechanism and it is only validated pairwise on neighbours. The
// one such pair here is tickets opened (4) vs closed (3).

export type Metric =
  | "memory"    // notes and links
  | "commits"   // git output: velocity, lines per project, authorship
  | "closed"    // tickets closed / delivered
  | "opened"    // tickets opened
  | "spend"     // dollars
  | "sessions"; // runs / transcripts / tool calls

export const METRIC_SLOT: Record<Metric, Slot> = {
  memory: 1,
  commits: 2,
  closed: 3,
  opened: 4,
  spend: 5,
  sessions: 6,
};

/** `var(--series-N)` for a metric — the value both chart kits and chrome use. */
export const metricColor = (metric: Metric): string => slotColor(METRIC_SLOT[metric]);

/** The dither-kit seed name for a metric (canvas showpieces). */
export const metricDither = (metric: Metric): DitherColor => SLOT_DITHER[METRIC_SLOT[metric]];

// ── Ordinal ramp ─────────────────────────────────────────────────────────────

const seqStep = (t: number): string =>
  `var(--seq-${Math.min(5, Math.max(1, 1 + Math.round(t * 4)))})`;

/** One-hue ramp step for bucket `i` of `n` ordered buckets (light → dark). */
export function rampColor(i: number, n: number): string {
  return n <= 1 ? "var(--seq-3)" : seqStep(i / (n - 1));
}

/** One-hue ramp step for a continuous magnitude — heavier value, deeper step. */
export function rampValue(value: number, max: number): string {
  return seqStep(max > 0 ? Math.min(1, Math.max(0, value / max)) : 0);
}

// ── Status ───────────────────────────────────────────────────────────────────

export type Tone = "good" | "warn" | "critical" | "neutral";

const TONE_WORDS: Record<Exclude<Tone, "neutral">, RegExp> & { neutral: RegExp } = {
  good: /^(done|delivered|complete|completed|closed|ok|pass|passed|success|active|healthy)$/i,
  warn: /^(blocked|stalled|partial|pending|paused|timeout|retry|rework|empty|stale|degraded)$/i,
  critical: /^(failed|fail|error|errors|dead|denied|abandoned)$/i,
  neutral: /^(cancelled|canceled|skipped|unknown|n\/a|none)$/i,
};

/** Map an outcome/state word to a reserved status tone, or null if it is just a
 *  category. Callers always pair the colour with the label itself. */
export function toneOf(label: string): Tone | null {
  const word = label.trim();
  for (const tone of ["good", "warn", "critical", "neutral"] as const) {
    if (TONE_WORDS[tone].test(word)) return tone;
  }
  return null;
}

export const toneColor = (tone: Tone): string =>
  tone === "neutral" ? "var(--ink-soft)" : `var(--${tone})`;

/**
 * Outcome/stage segments: the reserved status token where the word names a
 * state, else categorical slots assigned in fixed order — never cycled, never
 * skipped, so only validated neighbours can touch. The printed label carries the
 * identity either way.
 */
export function segmentColor(label: string, index: number): string {
  const tone = toneOf(label);
  if (tone) return toneColor(tone);
  return slotColor((Math.min(index, 5) + 1) as Slot);
}
