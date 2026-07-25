import pw from '/home/beckett/beckett/node_modules/playwright/index.js';
const { chromium } = pw;
const base = 'http://127.0.0.1:4599/';
const b = await chromium.launch();
async function autoscroll(pg){
  await pg.evaluate(async () => {
    await new Promise((res)=>{ let y=0; const step=()=>{ window.scrollBy(0,600); y+=600; if(y>=document.body.scrollHeight){ window.scrollTo(0,0); setTimeout(res,400);} else setTimeout(step,120);}; step(); });
  });
}
async function shot(theme, tab, vw, name){
  const ctx = await b.newContext({ colorScheme: theme, viewport:{width:vw,height:900}, deviceScaleFactor: vw<500?2:1.5 });
  await ctx.addInitScript(([t,tab])=>{ try{localStorage.setItem('bkt-theme',t);localStorage.setItem('bkt-tab',tab);}catch(e){} }, [theme,tab]);
  const pg = await ctx.newPage();
  await pg.goto(base, { waitUntil:'networkidle' });
  await autoscroll(pg);
  await pg.waitForTimeout(1400);
  await pg.screenshot({ path:`shots/${name}.png`, fullPage:true });
  await ctx.close();
  console.log('wrote', name);
}
await shot('light','work',1280,'light-work');
await shot('dark','work',1280,'dark-work');
await shot('light','ops',1280,'light-ops');
await shot('dark','ops',1280,'dark-ops');
await shot('light','recall',1280,'light-recall');
await shot('light','ops',375,'light-ops-375');
await shot('dark','work',375,'dark-work-375');
await b.close();
