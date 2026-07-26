import pw from "/home/beckett/beckett/node_modules/playwright/index.js";
const { chromium } = pw;
const b = await chromium.launch();
const ctx = await b.newContext({
  colorScheme: "light",
  reducedMotion: "reduce",
  viewport: { width: 1280, height: 900 },
});
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("bkt-theme", "light");
    localStorage.setItem("bkt-tab", "ops");
  } catch (e) {}
});
const pg = await ctx.newPage();
await pg.goto("http://127.0.0.1:4599/", { waitUntil: "networkidle" });
await pg.waitForTimeout(500);
console.log(
  await pg.evaluate(() => {
    const slow = [];
    for (const el of document.querySelectorAll("*")) {
      const st = getComputedStyle(el);
      for (const d of st.transitionDuration.split(",")) {
        const ms = d.trim().endsWith("ms") ? parseFloat(d) : parseFloat(d) * 1000;
        if (ms > 1) slow.push(`${el.tagName}.${(el.className || "").toString().slice(0, 40)} ${d.trim()}`);
      }
      for (const d of st.animationDuration.split(",")) {
        const ms = d.trim().endsWith("ms") ? parseFloat(d) : parseFloat(d) * 1000;
        if (ms > 1) slow.push(`ANIM ${el.tagName} ${d.trim()}`);
      }
    }
    // Values must be final, not mid-tween, under reduced motion.
    const firstMetric = document.querySelector("h3")?.textContent;
    return { slowCount: slow.length, sample: slow.slice(0, 5), firstMetric };
  }),
);
await pg.screenshot({ path: ".palette-scratch/reduced-motion.png" });
await b.close();
