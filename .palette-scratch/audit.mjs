import pw from "/home/beckett/beckett/node_modules/playwright/index.js";
const { chromium } = pw;
const base = "http://127.0.0.1:4599/";
const b = await chromium.launch();

async function audit(theme, tab, width) {
  const ctx = await b.newContext({ colorScheme: theme, viewport: { width, height: 900 } });
  await ctx.addInitScript(
    ([t, tb]) => {
      try {
        localStorage.setItem("bkt-theme", t);
        localStorage.setItem("bkt-tab", tb);
      } catch (e) {}
    },
    [theme, tab],
  );
  const pg = await ctx.newPage();
  await pg.goto(base, { waitUntil: "networkidle" });
  await pg.waitForTimeout(900);
  const res = await pg.evaluate(() => {
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll("*")]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 6)
      .map((el) => `${el.tagName}.${el.className}`.slice(0, 90));
    const cs = getComputedStyle(document.documentElement);
    const tokens = {};
    for (const k of ["--series-1", "--series-2", "--series-3", "--series-4", "--series-5", "--series-6", "--seq-1", "--seq-5", "--good", "--warn", "--critical", "--background", "--foreground", "--muted-foreground", "--label", "--primary"]) {
      tokens[k] = cs.getPropertyValue(k).trim();
    }
    // Sample every text node's effective colour against its背 background.
    const samples = [];
    const seen = new Set();
    for (const el of document.querySelectorAll("span,div,p,h1,h2,h3,a,button,li,text")) {
      if (!el.textContent || el.children.length > 0) continue;
      const st = getComputedStyle(el);
      const key = `${st.color}|${st.fontSize}|${st.fontWeight}`;
      if (seen.has(key)) continue;
      seen.add(key);
      samples.push({ color: st.color, size: parseFloat(st.fontSize), weight: st.fontWeight, text: el.textContent.trim().slice(0, 24) });
    }
    return { overflow, wide, tokens, samples };
  });
  await ctx.close();
  return res;
}

for (const [theme, tab, width] of [
  ["light", "work", 375],
  ["light", "ops", 375],
  ["dark", "ops", 375],
  ["light", "recall", 375],
  ["light", "ops", 1280],
]) {
  const r = await audit(theme, tab, width);
  console.log(`\n${theme}/${tab}@${width}: overflow=${r.overflow}px`, r.wide.length ? r.wide : "");
  if (width === 1280 && theme === "light") console.log("tokens", r.tokens);
}

// Text contrast audit on both themes at desktop width.
for (const [theme, tab] of [["light", "work"], ["dark", "work"], ["light", "ops"], ["dark", "ops"], ["light", "recall"], ["dark", "recall"]]) {
  const r = await audit(theme, tab, 1280);
  const bg = r.tokens["--background"];
  console.log(`\n--- ${theme}/${tab} text samples (bg ${bg})`);
  for (const s of r.samples) console.log(`  ${s.color}  ${s.size}px ${s.weight}  "${s.text}"`);
}
await b.close();
