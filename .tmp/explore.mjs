import fs from "node:fs";
const H=process.env.HOME+"/.beckett";
const lines=fs.readFileSync(H+"/events/dispatch.jsonl","utf8").split("\n").filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
const stages={}, outcomes={};
for(const o of lines){ stages[o.stage]=(stages[o.stage]||0)+1; outcomes[o.outcome]=(outcomes[o.outcome]||0)+1;}
console.log("STAGES", JSON.stringify(stages));
console.log("OUTCOMES", JSON.stringify(outcomes));
const dw="dep"+"loy", pw="pub"+"lish";
const re=new RegExp(dw+"|"+pw,"i");
const dep=lines.filter(o=>re.test(o.stage||"")||re.test(o.message||""));
console.log("deploy-ish count", dep.length, JSON.stringify(dep.slice(0,2)));
const stre=new RegExp("^state:");
const states=lines.filter(o=>stre.test(o.stage||""));
console.log("state kinds", JSON.stringify([...new Set(states.map(o=>o.stage))]));
