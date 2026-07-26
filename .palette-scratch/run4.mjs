import { validate } from "/tmp/claude-1001/bundled-skills/2.1.216/5c0f0fa716521619bed8d2425435b547/dataviz/scripts/validate_palette.js";
import { oklchToHex, LIGHT_SURFACE, DARK_SURFACE } from "./explore.mjs";

const FAMILIES = {
  indigo: { H: 262, light: [0.48, 0.15], dark: [0.62, 0.14] },
  gold: { H: 82, light: [0.72, 0.14], dark: [0.66, 0.13] },
  rose: { H: 8, light: [0.56, 0.16], dark: [0.65, 0.15] },
  teal: { H: 197, light: [0.6, 0.11], dark: [0.65, 0.11] },
  violet: { H: 305, light: [0.48, 0.15], dark: [0.6, 0.15] },
  moss: { H: 143, light: [0.62, 0.12], dark: [0.6, 0.12] },
};
const hexOf = (n, mode) => {
  const f = FAMILIES[n];
  return oklchToHex(f[mode][0], f[mode][1], f.H).hex;
};

const num = (s) => Number(/ΔE ([\d.]+)/.exec(s)?.[1] ?? 0);

function run(order, pairs) {
  const out = {};
  for (const mode of ["light", "dark"]) {
    const surface = mode === "light" ? LIGHT_SURFACE : DARK_SURFACE;
    const hexes = order.map((n) => hexOf(n, mode));
    const r = validate(hexes, { mode, surface, pairs });
    const rows = Object.fromEntries(r.report.map((x) => [x[0], x]));
    out[mode] = {
      hexes,
      cvd: num(rows["CVD separation"][2]),
      nv: num(rows["Normal-vision floor"][2]),
      contrast: rows["Contrast vs surface"][1],
      contrastDetail: rows["Contrast vs surface"][2],
      chroma: rows["Chroma floor"][2],
      band: rows["Lightness band"][2],
      ok: r.ok,
    };
  }
  return out;
}

const CANDIDATES = [
  ["indigo", "gold", "rose", "teal", "violet", "moss"],
  ["indigo", "gold", "moss", "violet", "teal", "rose"],
  ["teal", "rose", "indigo", "gold", "violet", "moss"],
  ["rose", "indigo", "moss", "violet", "gold", "teal"],
  ["indigo", "rose", "moss", "violet", "gold", "teal"],
  ["indigo", "gold", "violet", "moss", "rose", "teal"],
];
for (const order of CANDIDATES) {
  const adj = run(order, "adjacent");
  const all = run(order, "all");
  console.log(
    "\n" + order.join(" > "),
    "\n  adjacent  light cvd", adj.light.cvd, "nv", adj.light.nv, "| dark cvd", adj.dark.cvd, "nv", adj.dark.nv,
    "\n  all-pairs light cvd", all.light.cvd, "nv", all.light.nv, "| dark cvd", all.dark.cvd, "nv", all.dark.nv,
    "\n  ok:", adj.light.ok, adj.dark.ok, "| contrast light:", adj.light.contrast, adj.light.contrastDetail,
    "\n  contrast dark:", adj.dark.contrast, adj.dark.contrastDetail,
    "\n  light", adj.light.hexes.join(" "), "\n  dark ", adj.dark.hexes.join(" "),
  );
}
