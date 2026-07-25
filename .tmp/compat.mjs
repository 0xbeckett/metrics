import { execSync } from "node:child_process";
import fs from "node:fs";
const old = JSON.parse(execSync("git show HEAD:src/generated/metrics.json", {encoding:"utf8"}));
const neu = JSON.parse(fs.readFileSync("src/generated/metrics.json","utf8"));
// structural signature: keys + types (recursive, arrays -> element sig of [0])
function sig(v){
  if(Array.isArray(v)) return v.length? ["arr", sig(v[0])] : ["arr","empty"];
  if(v && typeof v==="object") return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sig(v[k])]));
  return typeof v;
}
const EXISTING = ["source_generated_at","rate_table_effective_date","headline","models","reviewCycles","runsOverTime","harnesses","codeStats","notes"];
let ok=true;
for(const k of EXISTING){
  const a=JSON.stringify(sig(old[k])), b=JSON.stringify(sig(neu[k]));
  if(a!==b){ ok=false; console.log("MISMATCH", k, "\n old:",a,"\n new:",b); }
  else console.log("ok  ", k);
}
console.log("refreshed_at present:", "refreshed_at" in neu);
console.log("schema_version old->new:", old.schema_version, "->", neu.schema_version);
console.log(ok? "ALL EXISTING SHAPES PRESERVED":"SHAPE DRIFT!");
