import pw from "/home/beckett/beckett/node_modules/playwright/index.js";
const { chromium } = pw;
const b = await chromium.launch();

async function shot(theme, tab, name, width = 1280) {
  const ctx = await b.newContext({ colorScheme: theme, viewport: { width, height: 900 }, deviceScaleFactor: 1 });
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
  await pg.goto("http://127.0.0.1:4599/", { waitUntil: "networkidle" });
  await pg.evaluate(async () => {
    await new Promise((res) => {
      let y = 0;
      const step = () => {
        window.scrollBy(0, 700);
        y += 700;
        if (y >= document.body.scrollHeight) { window.scrollTo(0, 0); setTimeout(res, 400); } else setTimeout(step, 70);
      };
      step();
    });
  });
  await pg.waitForTimeout(1200);
  await pg.screenshot({ path: `docs/screenshots/${name}.png`, fullPage: true });
  await ctx.close();
  console.log("wrote", name);
}

await shot("light", "work", "light-proof-of-work");
await shot("dark", "work", "dark-proof-of-work");
await shot("light", "ops", "light-operations");
await shot("dark", "ops", "dark-operations");
await shot("light", "work", "light-mobile-375", 375);
await b.close();
