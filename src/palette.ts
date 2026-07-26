import type { DitherColor } from "@/metrics";

/*
 * The identity layer over the colour tokens in index.css (#3).
 *
 * One rule: a thing keeps its hue everywhere. Commits are indigo in the velocity
 * trend, in the per-project ranking and in the authorship ranking; sessions are
 * teal in the hero spark, the runs-per-day line and the session trend; a model
 * carries the same slot in cost, wall-clock and session-split. Nothing in here
 * holds a colour value — every entry resolves to a `--series-*` / `--seq-*` /
 * status token, so the palette still lives in exactly one file.
 *
 * Slot order is fixed (1 rose · 2 indigo · 3 moss · 4 violet · 5 gold · 6 teal)
 * and assigned, never cycled — that order is what the CVD validation measured.
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

export type Metric =
  | "commits"   // git output: velocity, lines per project, authorship
  | "sessions"  // runs / transcripts / tool calls
  | "spend"     // dollars
  | "opened"    // tickets opened
  | "closed"    // tickets closed / delivered
  | "memory";   // notes and links

export const METRIC_SLOT: Record<Metric, Slot> = {
  opened: 1,
  commits: 2,
  closed: 3,
  memory: 4,
  spend: 5,
  sessions: 6,
};

/** `var(--series-N)` for a metric — the value both chart kits and chrome use. */
export const metricColor = (metric: Metric): string => slotColor(METRIC_SLOT[metric]);

/** The dither-kit seed name for a metric (canvas showpieces). */
export const metricDither = (metric: Metric): DitherColor => SLOT_DITHER[METRIC_SLOT[metric]];

// ── Ordinal ramp ─────────────────────────────────────────────────────────────

/** One-hue ramp step for bucket `i` of `n` ordered buckets (light → dark). */
export function rampColor(i: number, n: number): string {
  if (n <= 1) return "var(--seq-3)";
  const step = 1 + Math.round((i / (n - 1)) * 4);
  return `var(--seq-${Math.min(5, Math.max(1, step))})`;
}

// ── Status ───────────────────────────────────────────────────────────────────

export type Tone = "good" | "warn" | "critical";

const TONE_WORDS: Record<Tone, RegExp> = {
  good: /^(done|delivered|complete|completed|closed|ok|pass|passed|success|active|healthy)$/i,
  warn: /^(blocked|stalled|partial|pending|paused|skipped|timeout|retry|review)$/i,
  critical: /^(failed|fail|error|errors|cancelled|canceled|dead|denied|abandoned)$/i,
};

/** Map an outcome/state word to a reserved status tone, or null if it is just a
 *  category. Callers always pair the colour with the label itself. */
export function toneOf(label: string): Tone | null {
  const word = label.trim();
  for (const tone of ["good", "warn", "critical"] as const) {
    if (TONE_WORDS[tone].test(word)) return tone;
  }
  return null;
}

export const toneColor = (tone: Tone): string => `var(--${tone === "critical" ? "critical" : tone})`;

/** Outcome/stage segments: status tone where the word means one, else slots in
 *  fixed order. Identity is always carried by the printed label too. */
export function segmentColor(label: string, index: number): string {
  const tone = toneOf(label);
  if (tone) return toneColor(tone);
  return slotColor(((index % 6) + 1) as Slot);
}

// ── Memory note types ────────────────────────────────────────────────────────
// The graph and the "notes by type" ranking share this map, so a type is the
// same hue in both panels.

const MEMORY_TYPE_SLOT: Record<string, Slot> = {
  self: 4,
  person: 1,
  project: 2,
  reference: 6,
  feedback: 5,
  user: 3,
};

export function memoryTypeColor(type: string, index = 0): string {
  const slot = MEMORY_TYPE_SLOT[type.toLowerCase()] ?? (((index % 6) + 1) as Slot);
  return slotColor(slot);
}
