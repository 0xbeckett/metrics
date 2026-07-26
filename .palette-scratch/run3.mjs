import { validate } from "/tmp/claude-1001/bundled-skills/2.1.216/5c0f0fa716521619bed8d2425435b547/dataviz/scripts/validate_palette.js";
import { oklchToHex, hexToOklch, LIGHT_SURFACE, DARK_SURFACE, report } from "./explore.mjs";

// Hue families for this design system's warm-paper plane. Each family carries a
// light-mode step and a dark-mode step (same hue, re-stepped for the band).
const FAMILIES = {
  indigo: { H: 262, light: [0.48, 0.15], dark: [0.62, 0.14] },
  gold: { H: 82, light: [0.72, 0.14], dark: [0.66, 0.13] },
  rose: { H: 8, light: [0.56, 0.16], dark: [0.65, 0.15] },
  teal: { H: 197, light: [0.6, 0.11], dark: [0.65, 0.11] },
  violet: { H: 305, light: [0.48, 0.15], dark: [0.6, 0.15] },
  moss: { H: 143, light: [0.62, 0.12], dark: [0.6, 0.12] },
  rust: { H: 45, light: [0.6, 0.16], dark: [0.66, 0.14] },
};

const hexOf = (name, mode) => {
  const f = FAMILIES[name];
  const [L, C] = f[mode];
  const { hex, oog } = oklchToHex(L, C, f.H);
  if (oog) console.log("  OOG", name, mode, hex);
  return hex;
};

function scoreOrder(names) {
  let worst = Infinity;
  let worstNormal = Infinity;
  const out = {};
  for (const mode of ["light", "dark"]) {
    const surface = mode === "light" ? LIGHT_SURFACE : DARK_SURFACE;
    const hexes = names.map((n) => hexOf(n, mode));
    const r = validate(hexes, { mode, surface });
    const rows = Object.fromEntries(r.report.map((x) => [x[0], x]));
    const cvd = Number(/ΔE ([\d.]+)/.exec(rows["CVD separation"][2])?.[1] ?? 0);
    const nv = Number(/ΔE ([\d.]+)/.exec(rows["Normal-vision floor"][2])?.[1] ?? 0);
    worst = Math.min(worst, cvd);
    worstNormal = Math.min(worstNormal, nv);
    out[mode] = { hexes, cvd, nv, chroma: rows["Chroma floor"][1], band: rows["Lightness band"][1] };
  }
  return { worst, worstNormal, out };
}

// Exhaustive over orderings of a chosen 6-set (and the 7-set with rust).
function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const res = [];
  arr.forEach((v, i) => {
    for (const rest of permutations([...arr.slice(0, i), ...arr.slice(i + 1)])) res.push([v, ...rest]);
  });
  return res;
}

for (const pool of [
  ["indigo", "gold", "rose", "teal", "violet", "moss"],
  ["indigo", "gold", "rose", "teal", "violet", "rust"],
  ["indigo", "gold", "rose", "teal", "violet", "moss", "rust"],
]) {
  let best = null;
  for (const order of permutations(pool)) {
    const s = scoreOrder(order);
    if (!s.out.light.chroma || !s.out.dark.chroma || !s.out.light.band || !s.out.dark.band) continue;
    const key = [Math.min(s.worst, 12), s.worstNormal];
    if (!best || key[0] > best.key[0] || (key[0] === best.key[0] && key[1] > best.key[1])) {
      best = { order, ...s, key };
    }
  }
  console.log("\nPOOL", pool.join(","), "→ best order:", best.order.join(" > "));
  console.log("  worst adjacent CVD ΔE", best.worst.toFixed(1), " worst normal ΔE", best.worstNormal.toFixed(1));
  console.log("  light", best.out.light.hexes.join(" "));
  console.log("  dark ", best.out.dark.hexes.join(" "));
}
