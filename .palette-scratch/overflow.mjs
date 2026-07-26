import pw from "/home/beckett/beckett/node_modules/playwright/index.js";
const { chromium } = pw;
const b = await chromium.launch();
const ctx = await b.newContext({ colorScheme: "light", viewport: { width: 375, height: 900 } });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("bkt-theme", "light");
    localStorage.setItem("bkt-tab", "work");
  } catch (e) {}
});
const pg = await ctx.newPage();
await pg.goto("http://127.0.0.1:4599/", { waitUntil: "networkidle" });
await pg.waitForTimeout(800);
console.log(
  await pg.evaluate(() => {
    const out = [];
    const walk = (el) => {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 0.5) {
        // Report only the OUTERMOST offenders whose parent stays in bounds and
        // which are not inside a horizontal scroller.
        let p = el.parentElement, clipped = false;
        while (p) {
          const st = getComputedStyle(p);
          if (st.overflowX === "auto" || st.overflowX === "scroll" || st.overflowX === "hidden") { clipped = true; break; }
          p = p.parentElement;
        }
        if (!clipped) out.push(`${el.tagName}.${(el.className || "").toString().slice(0, 70)} right=${Math.round(r.right)}`);
      }
      for (const c of el.children) walk(c);
    };
    walk(document.body);
    return {
      docScroll: document.documentElement.scrollWidth,
      bodyScroll: document.body.scrollWidth,
      inner: window.innerWidth,
      offenders: out.slice(0, 10),
    };
  }),
);
await b.close();
