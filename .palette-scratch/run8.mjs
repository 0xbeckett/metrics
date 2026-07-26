import { validate } from "/tmp/claude-1001/bundled-skills/2.1.216/5c0f0fa716521619bed8d2425435b547/dataviz/scripts/validate_palette.js";
import { LIGHT_SURFACE, DARK_SURFACE } from "./explore.mjs";

const NAMES = ["rose", "indigo", "moss", "violet", "gold", "teal"];
const LIGHT = { rose: "#be4262", indigo: "#2b58b1", moss: "#579854", violet: "#7241a0", gold: "#b78100", teal: "#009497" };
const DARK = { rose: "#d9637e", indigo: "#5684da", moss: "#51924e", violet: "#9565c7", gold: "#b98918", teal: "#05a3a6" };

const num = (s) => Number(/ΔE ([\d.]+)/.exec(s)?.[1] ?? 0);

function scoreAll(names) {
  let cvd = Infinity, nv = Infinity;
  for (const [mode, set, surface] of [["light", LIGHT, LIGHT_SURFACE], ["dark", DARK, DARK_SURFACE]]) {
    const r = validate(names.map((n) => set[n]), { mode, surface, pairs: "all" });
    const rows = Object.fromEntries(r.report.map((x) => [x[0], x]));
    cvd = Math.min(cvd, num(rows["CVD separation"][2]));
    nv = Math.min(nv, num(rows["Normal-vision floor"][2]));
  }
  return { cvd, nv };
}

const subsets = (arr, k) =>
  k === 0 ? [[]] : arr.flatMap((v, i) => subsets(arr.slice(i + 1), k - 1).map((rest) => [v, ...rest]));

for (const k of [5, 4, 3]) {
  const passing = subsets(NAMES, k)
    .map((s) => ({ s, ...scoreAll(s) }))
    .filter((x) => x.cvd >= 8 && x.nv >= 15)
    .sort((a, b) => b.cvd - a.cvd || b.nv - a.nv);
  console.log(`\nk=${k}: ${passing.length} all-pairs-safe subsets`);
  for (const p of passing.slice(0, 6)) console.log("   ", p.s.join(","), "cvd", p.cvd.toFixed(1), "nv", p.nv.toFixed(1));
}
