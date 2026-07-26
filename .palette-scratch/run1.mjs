import { report, LIGHT_SURFACE, DARK_SURFACE, hexToOklch, oklchToHex, contrast } from "./explore.mjs";

const DOC7 = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7"];
report("doc7", DOC7, "light", LIGHT_SURFACE);

// warm-tempered candidate, light mode: OKLCH-designed
const plan = [
  ["indigo", 0.52, 0.155, 258],
  ["rust", 0.58, 0.155, 45],
  ["teal", 0.58, 0.115, 190],
  ["gold", 0.72, 0.145, 85],
  ["rose", 0.62, 0.15, 5],
  ["moss", 0.55, 0.115, 145],
  ["violet", 0.5, 0.15, 305],
];
const hexes = plan.map(([n, L, C, H]) => {
  const { hex, oog } = oklchToHex(L, C, H);
  if (oog) console.log("OOG", n, hex);
  return hex;
});
console.log(plan.map((p, i) => p[0] + "=" + hexes[i]).join(" "));
report("warm7", hexes, "light", LIGHT_SURFACE);
