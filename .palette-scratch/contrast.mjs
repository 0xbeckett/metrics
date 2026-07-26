import pw from "/home/beckett/beckett/node_modules/playwright/index.js";
const { chromium } = pw;
const b = await chromium.launch();

const AUDIT = () => {
  const parse = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, c) => {
    const [hi, lo] = [lum(a), lum(c)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.95) return c;
      n = n.parentElement;
    }
    return parse(getComputedStyle(document.documentElement).backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 };
  };

  const rows = [];
  const push = (el, colorStr, kind) => {
    const st = getComputedStyle(el);
    const fg = parse(colorStr);
    if (!fg || fg.a === 0) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const text = (el.textContent || "").trim();
    if (!text) return;
    const bg = bgOf(el);
    const eff = over(fg, bg);
    const size = parseFloat(st.fontSize);
    const weight = Number(st.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const got = ratio(eff, bg);
    rows.push({ kind, text: text.slice(0, 30), size, weight, got: Math.round(got * 100) / 100, need, pass: got >= need });
  };

  for (const el of document.querySelectorAll("*")) {
    if (el.children.length > 0) continue;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none") continue;
    if (el.namespaceURI === "http://www.w3.org/2000/svg") {
      if (el.tagName === "text") push(el, st.fill, "svg");
    } else {
      push(el, st.color, "html");
    }
  }
  const seen = new Set();
  const uniq = rows.filter((r) => {
    const k = `${r.got}|${r.size}|${r.weight}|${r.kind}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { fails: uniq.filter((r) => !r.pass), worst: uniq.sort((a, b) => a.got - b.got).slice(0, 8) };
};

for (const theme of ["light", "dark"]) {
  for (const tab of ["work", "ops", "recall"]) {
    const ctx = await b.newContext({ colorScheme: theme, viewport: { width: 1280, height: 900 } });
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
          window.scrollBy(0, 800);
          y += 800;
          if (y >= document.body.scrollHeight) { window.scrollTo(0, 0); setTimeout(res, 300); } else setTimeout(step, 60);
        };
        step();
      });
    });
    await pg.waitForTimeout(600);
    const r = await pg.evaluate(AUDIT);
    console.log(`\n=== ${theme}/${tab}: ${r.fails.length} failures`);
    for (const f of r.fails) console.log(`  FAIL ${f.got} (need ${f.need}) ${f.size}px/${f.weight} [${f.kind}] "${f.text}"`);
    console.log("  worst:", r.worst.map((x) => `${x.got}@${x.size}px`).join(" "));
    await ctx.close();
  }
}
await b.close();
