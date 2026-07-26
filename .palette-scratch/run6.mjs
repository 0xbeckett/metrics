import { validateOrdinal, contrast } from "/tmp/claude-1001/bundled-skills/2.1.216/5c0f0fa716521619bed8d2425435b547/dataviz/scripts/validate_palette.js";
import { oklchToHex, hexToOklch, LIGHT_SURFACE, DARK_SURFACE } from "./explore.mjs";

const rampLight = [0.74, 0.67, 0.6, 0.53, 0.46].map((L, i) => oklchToHex(L, 0.07 + i * 0.02, 45).hex);
const rampDark = [0.44, 0.51, 0.58, 0.65, 0.72].map((L, i) => oklchToHex(L, 0.085 + i * 0.015, 45).hex);
for (const [name, ramp, mode, surface] of [
  ["light", rampLight, "light", LIGHT_SURFACE],
  ["dark", rampDark, "dark", DARK_SURFACE],
]) {
  console.log("\n== ordinal", name, ramp.join(" "));
  for (const row of validateOrdinal(ramp, { mode, surface }).report) console.log("  ", JSON.stringify(row));
  console.log("   contrasts", ramp.map((h) => contrast(h, surface).toFixed(2)).join(" "));
}

const STATUS_LIGHT = { good: "#1f7a3d", warn: "#8f5c07", critical: "#c0392b" };
const STATUS_DARK = { good: "#5fbe7d", warn: "#d9a441", critical: "#f0796a" };
console.log("\n== status");
for (const [k, v] of Object.entries(STATUS_LIGHT)) {
  const { L, C } = hexToOklch(v);
  console.log("  light", k, v, contrast(v, LIGHT_SURFACE).toFixed(2), `L=${L.toFixed(2)} C=${C.toFixed(2)}`);
}
for (const [k, v] of Object.entries(STATUS_DARK)) {
  const { L, C } = hexToOklch(v);
  console.log("  dark ", k, v, contrast(v, DARK_SURFACE).toFixed(2), `L=${L.toFixed(2)} C=${C.toFixed(2)}`);
}
