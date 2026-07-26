import pw from "/home/beckett/beckett/node_modules/playwright/index.js";
const { chromium } = pw;
const b = await chromium.launch();
const theme = process.argv[2] ?? "light";
const ctx = await b.newContext({ colorScheme: theme, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
await ctx.addInitScript(
  ([t]) => {
    try {
      localStorage.setItem("bkt-theme", t);
      localStorage.setItem("bkt-tab", "ops");
    } catch (e) {}
  },
  [theme],
);
const pg = await ctx.newPage();
await pg.goto("http://127.0.0.1:4599/", { waitUntil: "networkidle" });
await pg.waitForTimeout(1200);
const sections = await pg.$$("section");
let i = 0;
for (const s of sections) {
  const title = (await s.textContent())?.trim().slice(0, 20).replace(/\W+/g, "-") ?? String(i);
  await s.screenshot({ path: `.palette-scratch/crop-${theme}-${i}-${title}.png` }).catch(() => {});
  i++;
}
console.log("crops", i);
await b.close();
