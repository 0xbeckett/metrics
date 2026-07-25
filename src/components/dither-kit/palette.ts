export type Rgb = [number, number, number]

export type DitherColor =
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "orange"
  | "red"
  | "grey"
  // Token-driven roles used by the rethemed showpiece panels — these resolve to
  // the warm ink / accent CSS variables so dither-kit follows the design tokens.
  | "ink"
  | "accent"
  | "muted"

export type Seed = { fill: Rgb; line: Rgb; star: Rgb }

// Static fallbacks — used before the DOM exists, or if a --dk-* var is missing.
// The redesign paints dither showpieces in ink/accent, but the original hues are
// kept so any legacy usage still resolves.
export const PALETTE: Record<DitherColor, Seed> = {
  green: { fill: [90, 104, 74], line: [90, 104, 74], star: [90, 104, 74] },
  blue: { fill: [74, 82, 96], line: [74, 82, 96], star: [74, 82, 96] },
  purple: { fill: [96, 82, 110], line: [96, 82, 110], star: [96, 82, 110] },
  pink: { fill: [150, 84, 96], line: [150, 84, 96], star: [150, 84, 96] },
  orange: { fill: [158, 96, 44], line: [158, 96, 44], star: [158, 96, 44] },
  red: { fill: [184, 67, 31], line: [184, 67, 31], star: [184, 67, 31] },
  grey: { fill: [120, 110, 100], line: [120, 110, 100], star: [120, 110, 100] },
  ink: { fill: [28, 22, 18], line: [28, 22, 18], star: [28, 22, 18] },
  accent: { fill: [184, 67, 31], line: [184, 67, 31], star: [184, 67, 31] },
  muted: { fill: [120, 110, 100], line: [120, 110, 100], star: [120, 110, 100] },
}

export const rgb = ([r, g, b]: Rgb, k = 1, a = 1) =>
  `rgba(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)},${a})`

// ── Token-driven seed resolution ────────────────────────────────────────────
// Each dither colour maps to a `--dk-<name>` CSS variable holding an "r g b"
// triplet, so light/dark and any palette change flow straight into the canvas
// paint. seedOf* is hot (called per render frame), so results are cached and the
// cache is version-bumped on theme flips via `refreshDitherSeeds()`.
let seedCache = new Map<DitherColor, Seed>()

function readCssSeed(color: DitherColor): Seed | null {
  if (typeof document === "undefined") return null
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(`--dk-${color}`)
    .trim()
  if (!raw) return null
  const parts = raw.split(/[\s,]+/).map(Number)
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null
  const c: Rgb = [parts[0], parts[1], parts[2]]
  return { fill: c, line: c, star: c }
}

export const seedOfColor = (color: DitherColor): Seed => {
  const cached = seedCache.get(color)
  if (cached) return cached
  const seed = readCssSeed(color) ?? PALETTE[color] ?? PALETTE.grey
  seedCache.set(color, seed)
  return seed
}

/** Drop the seed cache so the next paint re-reads the CSS vars (theme toggle). */
export function refreshDitherSeeds() {
  seedCache = new Map()
}

export const isDitherColor = (value: unknown): value is DitherColor =>
  typeof value === "string" && value in PALETTE
