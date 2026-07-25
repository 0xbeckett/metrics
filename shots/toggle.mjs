import pw from '/home/beckett/beckett/node_modules/playwright/index.js';
const { chromium } = pw;
const b = await chromium.launch();
const ctx = await b.newContext({ colorScheme:'light', viewport:{width:1000,height:900}, deviceScaleFactor:1.5 });
await ctx.addInitScript(()=>{ try{localStorage.setItem('bkt-theme','light');localStorage.setItem('bkt-tab','work');}catch(e){} });
const pg = await ctx.newPage();
await pg.goto('http://127.0.0.1:4599/', { waitUntil:'networkidle' });
await pg.waitForTimeout(1200);
// click theme toggle (the icon button, aria-label switch to dark)
await pg.click('button[aria-label="Switch to dark theme"]');
await pg.waitForTimeout(1200);
await pg.screenshot({ path:'shots/toggle-to-dark.png' });
console.log('toggled');
await b.close();
