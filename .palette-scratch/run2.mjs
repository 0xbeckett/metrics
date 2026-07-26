import { report, LIGHT_SURFACE, DARK_SURFACE, hexToOklch, oklchToHex, contrast } from "./explore.mjs";

const show = (label, hex) => {
  const { L, C, H } = hexToOklch(hex);
  console.log(label, hex, `L=${L.toFixed(3)} C=${C.toFixed(3)} H=${H.toFixed(0)}`);
};
show("accent-light", "#b8431f");
show("accent-dark", "#e07850");

const mk = (plan) =>
  plan.map(([n, L, C, H]) => {
    const { hex, oog } = oklchToHex(L, C, H);
    if (oog) console.log("  OOG", n, hex);
    return hex;
  });

// 6-slot categorical, warm-tempered, orange/clay family deliberately excluded
// (reserved for the brand accent + the ordinal ramp).
const LIGHT = [
  ["indigo", 0.5, 0.145, 262],
  ["teal", 0.56, 0.105, 195],
  ["gold", 0.7, 0.135, 82],
  ["rose", 0.58, 0.15, 8],
  ["moss", 0.53, 0.105, 143],
  ["violet", 0.5, 0.14, 310],
];
const lightHex = mk(LIGHT);
console.log(LIGHT.map((p, i) => p[0] + "=" + lightHex[i]).join(" "));
report("cat6", lightHex, "light", LIGHT_SURFACE);
report("cat6-allpairs", lightHex, "light", LIGHT_SURFACE, { pairs: "all" });

const DARK = [
  ["indigo", 0.62, 0.135, 262],
  ["teal", 0.64, 0.1, 195],
  ["gold", 0.66, 0.13, 82],
  ["rose", 0.65, 0.14, 8],
  ["moss", 0.63, 0.1, 143],
  ["violet", 0.62, 0.14, 310],
];
const darkHex = mk(DARK);
console.log(DARK.map((p, i) => p[0] + "=" + darkHex[i]).join(" "));
report("cat6", darkHex, "dark", DARK_SURFACE);
report("cat6-allpairs", darkHex, "dark", DARK_SURFACE, { pairs: "all" });
