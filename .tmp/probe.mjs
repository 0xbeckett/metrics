import fs from "node:fs";
const RE = {
  snow: new RegExp("\\b\\d{17,20}\\b", "g"),
  wiki: new RegExp("\\[\\[", "g"),
  mention: new RegExp("<[@#][!&]?\\d+>", "g"),
  hash4: new RegExp("\\b\\S{2,32}#\\d{4}\\b", "g"),
  tok: new RegExp("(?=[A-Za-z0-9_-]{25,})(?=[^\\s\"]*[A-Z])(?=[^\\s\"]*[a-z])(?=[^\\s\"]*\\d)[A-Za-z0-9_-]{25,}", "g"),
  sha: new RegExp("\\b[0-9a-f]{40}\\b", "g"),
};
for (const f of ["src/generated/metrics.json", "src/generated/recall.json"]) {
  const s = fs.readFileSync(f, "utf8");
  const c = {};
  for (const [k, r] of Object.entries(RE)) c[k] = (s.match(r) || []);
  console.log(f);
  for (const [k, v] of Object.entries(c)) console.log("  ", k, v.length, v.slice(0, 4));
}
