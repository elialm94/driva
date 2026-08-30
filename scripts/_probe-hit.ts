import puppeteer from "puppeteer-core";

/** Engångsprobe: hit-test över bekräftelsekortet. Tas bort efteråt. */
const BASE = "http://localhost:3123";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  await page.setViewport({ width: 1280, height: 860 });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  const input = 'input[role="combobox"]';
  await page.click(input);
  await page.type(input, "fakturera Johan");
  await page.waitForFunction(() => document.querySelectorAll('[role="option"]').length > 0);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('[role="option"]')).some((el) => (el.textContent ?? "").includes("Johan"))
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('[role="option"]')).some((el) =>
      (el.textContent ?? "").includes("Altanrenovering")
    )
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => (document.body.textContent ?? "").includes("Johan Lindberg · Altanrenovering"));
  await new Promise((r) => setTimeout(r, 600));

  const info = await page.evaluate(() => {
    const panels = Array.from(document.querySelectorAll("div")).filter((el) =>
      el.className.includes("shadow-pop")
    ) as HTMLElement[];
    const details = panels.map((p) => {
      const r = p.getBoundingClientRect();
      const cs = getComputedStyle(p);
      return {
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        opacity: cs.opacity,
        z: cs.zIndex,
        bg: cs.backgroundColor,
        text: (p.textContent ?? "").replace(/\s+/g, " ").slice(0, 80),
      };
    });
    const cta = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Skapa fakturautkast")
    );
    let hit = "no-cta";
    let ctaRect = null;
    if (cta) {
      const r = cta.getBoundingClientRect();
      ctaRect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      hit = top ? `${top.tagName}.${String((top as HTMLElement).className).slice(0, 60)} inCta=${cta.contains(top) || top === cta}` : "none";
    }
    return { panelCount: panels.length, details, ctaRect, hit };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
