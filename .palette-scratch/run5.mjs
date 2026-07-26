import { validate, validateOrdinal, contrast } from "/tmp/claude-1001/bundled-skills/2.1.216/5c0f0fa716521619bed8d2425435b547/dataviz/scripts/validate_palette.js";
import { oklchToHex, hexToOklch, LIGHT_SURFACE, DARK_SURFACE } from "./explore.mjs";

// slot order fixed by the optimiser: rose > indigo > moss > violet > gold > teal
const SLOTS = [
  ["rose", 8, [0.56, 0.16], [0.65, 0.15]],
  ["indigo", 262, [0.48, 0.15], [0.62, 0.14]],
  ["moss", 143, [0.62, 0.12], [0.6, 0.12]],
  ["violet", 305, [0.48, 0.15], [0.6, 0.15]],
  ["gold", 82, [0.64, 0.145], [0.66, 0.13]],
  ["teal", 197, [0.6, 0.11], [0.65, 0.11]],
];

const build = (mode) =>
  SLOTS.map(([n, H, l, d]) => {
    const [L, C] = mode === "light" ? l : d;
    return oklchToHex(L, C, H).hex;
  });

for (const mode of ["light", "dark"]) {
  const surface = mode === "light" ? LIGHT_SURFACE : DARK_SURFACE;
  const hexes = build(mode);
  const r = validate(hexes, { mode, surface });
  console.log("\n==", mode, hexes.join(" "));
  for (const row of r.report) console.log("  ", JSON.stringify(row));
  console.log("   ok:", r.ok);
  hexes.forEach((h, i) => {
    const { L, C, H } = hexToOklch(h);
    console.log(
      `   slot${i + 1} ${SLOTS[i][0]} ${h} L=${L.toFixed(2)} C=${C.toFixed(3)} H=${H.toFixed(0)} contrast=${contrast(h, surface).toFixed(2)}`,
    );
  });
}

// ── ordinal / sequential ramp: the clay family (brand-adjacent, warm) ────────
const rampLight = [0.78, 0.71, 0.63, 0.55, 0.47].map((L, i) => oklchToHex(L, 0.06 + i * 0.022, 45).hex);
const rampDark = [0.4, 0.48, 0.56, 0.64, 0.72].map((L, i) => oklchToHex(L, 0.075 + i * 0.018, 45).hex);
console.log("\n== ordinal light", rampLight.join(" "));
for (const row of validateOrdinal(rampLight, { mode: "light", surface: LIGHT_SURFACE }).report) console.log("  ", JSON.stringify(row));
console.log("   contrasts", rampLight.map((h) => contrast(h, LIGHT_SURFACE).toFixed(2)).join(" "));
console.log("== ordinal dark", rampDark.join(" "));
for (const row of validateOrdinal(rampDark, { mode: "dark", surface: DARK_SURFACE }).report) console.log("  ", JSON.stringify(row));
console.log("   contrasts", rampDark.map((h) => contrast(h, DARK_SURFACE).toFixed(2)).join(" "));

// ── status ───────────────────────────────────────────────────────────────────
const STATUS_LIGHT = { good: "#1f7a3d", warn: "#a1690a", critical: "#c0392b" };
const STATUS_DARK = { good: "#5fbe7d", warn: "#d9a441", critical: "#f0796a" };
console.log("\n== status contrast");
for (const [k, v] of Object.entries(STATUS_LIGHT)) console.log("  light", k, v, contrast(v, LIGHT_SURFACE).toFixed(2));
for (const [k, v] of Object.entries(STATUS_DARK)) console.log("  dark ", k, v, contrast(v, DARK_SURFACE).toFixed(2));

// ── chrome / text tokens ─────────────────────────────────────────────────────
console.log("\n== chrome contrast");
const pairs = [
  ["light primary #b8431f", "#b8431f", LIGHT_SURFACE],
  ["light fg", "#1c1612", LIGHT_SURFACE],
  ["light muted-fg", "#6b6259", LIGHT_SURFACE],
  ["dark primary #e07850", "#e07850", DARK_SURFACE],
  ["dark fg", "#f2eee7", DARK_SURFACE],
];
for (const [n, a, b] of pairs) console.log("  ", n, contrast(a, b).toFixed(2));
