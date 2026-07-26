import { validate } from "/tmp/claude-1001/bundled-skills/2.1.216/5c0f0fa716521619bed8d2425435b547/dataviz/scripts/validate_palette.js";
import { LIGHT_SURFACE, DARK_SURFACE } from "./explore.mjs";

const LIGHT = { rose: "#be4262", indigo: "#2b58b1", moss: "#579854", violet: "#7241a0", gold: "#b78100", teal: "#009497" };
const DARK = { rose: "#d9637e", indigo: "#5684da", moss: "#51924e", violet: "#9565c7", gold: "#b98918", teal: "#05a3a6" };

// Pairs that actually share a chart somewhere on the page.
const PAIRS = [
  ["moss", "teal"],   // recall: haiku vs luna
  ["moss", "indigo"],
  ["moss", "gold"],
  ["rose", "moss"],   // tickets: opened vs closed
  ["indigo", "teal"],
];
for (const [mode, set, surface] of [["light", LIGHT, LIGHT_SURFACE], ["dark", DARK, DARK_SURFACE]]) {
  for (const [a, b] of PAIRS) {
    const r = validate([set[a], set[b]], { mode, surface });
    const row = r.report.find((x) => x[0] === "CVD separation");
    const nv = r.report.find((x) => x[0] === "Normal-vision floor");
    console.log(mode, a, "vs", b, "|", row[1], row[2], "|", nv[2]);
  }
}
