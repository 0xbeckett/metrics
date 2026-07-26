import { validate, validateOrdinal, contrast } from "/tmp/claude-1001/bundled-skills/2.1.216/5c0f0fa716521619bed8d2425435b547/dataviz/scripts/validate_palette.js";

// ── sRGB <-> OKLCH ───────────────────────────────────────────────────────────
const f = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
const fi = (x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));

export function oklchToHex(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const to = (v) => Math.round(clamp(f(clamp(v))) * 255).toString(16).padStart(2, "0");
  const oog = [r, g, bl].some((v) => v < -0.002 || v > 1.002);
  return { hex: `#${to(r)}${to(g)}${to(bl)}`, oog };
}

export function hexToOklch(hex) {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => fi(parseInt(n.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return { L, C: Math.hypot(A, B), H: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

export const LIGHT_SURFACE = "#f8f6f2";
export const DARK_SURFACE = "#161311";

export function report(name, hexes, mode, surface, opts = {}) {
  const r = opts.ordinal
    ? validateOrdinal(hexes, { mode, surface })
    : validate(hexes, { mode, surface, pairs: opts.pairs ?? "adjacent" });
  console.log(`\n== ${name} [${mode}] ${hexes.join(" ")}`);
  for (const row of r.report) console.log("  ", JSON.stringify(row));
  console.log("   ok:", r.ok);
  return r;
}

export { contrast };
