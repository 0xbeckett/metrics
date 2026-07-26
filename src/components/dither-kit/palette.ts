export type Rgb = [number, number, number]

export type DitherColor =
  // The categorical slots (#3) — the same six hues the SVG kit paints with.
  | "rose"
  | "indigo"
  | "moss"
  | "violet"
  | "gold"
  | "teal"
  // Legacy hue names kept so a stale metrics.json still resolves to a slot.
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "orange"
  | "red"
  | "grey"
  // Token-driven roles — warm ink / accent / muted from the design tokens.
  | "ink"
  | "accent"
  | "muted"

export type Seed = { fill: Rgb; line: Rgb; star: Rgb }

/**
 * Every dither colour resolves to ONE CSS custom property holding an "r g b"
 * triplet — the same `--series-*-rgb` token the SVG chart kit paints from. There
 * is no second palette here: legacy hue names are aliases onto the slots.
 */
const VAR_OF: Record<DitherColor, string> = {
  rose: "--series-1-rgb",
  indigo: "--series-2-rgb",
  moss: "--series-3-rgb",
  violet: "--series-4-rgb",
  gold: "--series-5-rgb",
  teal: "--series-6-rgb",
  red: "--series-1-rgb",
  blue: "--series-2-rgb",
  green: "--series-3-rgb",
  purple: "--series-4-rgb",
  orange: "--series-5-rgb",
  pink: "--series-6-rgb",
  grey: "--dk-muted",
  ink: "--dk-ink",
  accent: "--dk-accent",
  muted: "--dk-muted",
}

// Static fallbacks — used before the DOM exists, or if a token is missing. These
// mirror the light-mode token values; the CSS vars are the source of truth.
const FALLBACK: Record<string, Rgb> = {
  "--series-1-rgb": [190, 66, 98],
  "--series-2-rgb": [43, 88, 177],
  "--series-3-rgb": [87, 152, 84],
  "--series-4-rgb": [114, 65, 160],
  "--series-5-rgb": [183, 129, 0],
  "--series-6-rgb": [0, 148, 151],
  "--dk-ink": [28, 22, 18],
  "--dk-accent": [184, 67, 31],
  "--dk-muted": [120, 110, 100],
}

const seedOf = (c: Rgb): Seed => ({ fill: c, line: c, star: c })

export const PALETTE: Record<DitherColor, Seed> = Object.fromEntries(
  (Object.keys(VAR_OF) as DitherColor[]).map((name) => [
    name,
    seedOf(FALLBACK[VAR_OF[name]] ?? FALLBACK["--dk-muted"]),
  ])
) as Record<DitherColor, Seed>

export const rgb = ([r, g, b]: Rgb, k = 1, a = 1) =>
  `rgba(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)},${a})`

// ── Token-driven seed resolution ────────────────────────────────────────────
// seedOf* is hot (called per render frame), so results are cached and the cache
// is version-bumped on theme flips via `refreshDitherSeeds()`.
let seedCache = new Map<DitherColor, Seed>()

function readCssSeed(color: DitherColor): Seed | null {
  if (typeof document === "undefined") return null
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(VAR_OF[color] ?? "--dk-muted")
    .trim()
  if (!raw) return null
  const parts = raw.split(/[\s,]+/).map(Number)
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null
  return seedOf([parts[0], parts[1], parts[2]])
}

export const seedOfColor = (color: DitherColor): Seed => {
  const cached = seedCache.get(color)
  if (cached) return cached
  const seed = readCssSeed(color) ?? PALETTE[color] ?? PALETTE.muted
  seedCache.set(color, seed)
  return seed
}

/** Drop the seed cache so the next paint re-reads the CSS vars (theme toggle). */
export function refreshDitherSeeds() {
  seedCache = new Map()
}

export const isDitherColor = (value: unknown): value is DitherColor =>
  typeof value === "string" && value in VAR_OF
