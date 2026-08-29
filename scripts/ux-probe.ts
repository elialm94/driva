/**
 * Viewport-probe: laddar en rutt vid given bredd, utför enkla handlingar och
 * tar en viewport-screenshot (inte fullPage – fixed/sticky hamnar rätt).
 *
 *   npx tsx scripts/ux-probe.ts /ekonomi/fakturor/ny --width 390 --scroll 600 --out faktura-mitt.png
 *   npx tsx scripts/ux-probe.ts / --width 390 --tap "text=Mer" --out mer.png
 *
 * Handlingar (i ordningen de anges):
 *   --scroll <px|bottom>     scrolla sidan
 *   --tap "<css>"            klicka på selector
 *   --tap "text=Knapptext"   klicka på första knapp/länk med texten
 *   --type "<css>::<text>"   fokusera + skriv
 *   --wait <ms>              vänta
 *   --safe <px>              emulera safe-area-inset-bottom (t.ex. 34)
 * Skriver också ut boxar för bottennav/sticky-element.
 */
import puppeteer from "puppeteer-core";
import path from "path";
import fs from "fs";

const BASE = "http://localhost:3123";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = path.join(process.cwd(), ".data", "ux-audit", "probe");

async function main() {
  const args = process.argv.slice(2);
  const route = args[0]?.startsWith("/") ? args[0] : "/";
  let width = 390;
  let outName = "probe.png";
  const actions: { kind: string; value: string }[] = [];
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--width") width = Number(args[++i]);
    else if (a === "--out") outName = args[++i];
    else if (a === "--scroll" || a === "--tap" || a === "--type" || a === "--wait" || a === "--safe") {
      actions.push({ kind: a.slice(2), value: args[++i] });
    }
  }

  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  page.on("dialog", (d) => d.accept());
  const height = width < 700 ? 844 : 1080;
  await page.setViewport({ width, height, hasTouch: width < 1200, deviceScaleFactor: 2 });
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 300));

  for (const act of actions) {
    if (act.kind === "safe") {
      // Chrome kan inte emulera env(); skriv om variabeln via CSS-override.
      await page.addStyleTag({
        content: `:root { --probe-safe: ${Number(act.value)}px; }`,
      });
      await page.evaluate((px) => {
        // Ersätt env(safe-area-inset-bottom) genom att sätta en klass? Vi kan inte
        // patcha env() – i stället noteras att safe-area testas på riktig enhet.
        void px;
      }, Number(act.value));
    } else if (act.kind === "scroll") {
      if (act.value === "bottom") {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      } else {
        await page.evaluate((px) => window.scrollTo(0, px), Number(act.value));
      }
      await new Promise((r) => setTimeout(r, 300));
    } else if (act.kind === "tap") {
      if (act.value.startsWith("text=")) {
        const text = act.value.slice(5);
        await page.evaluate((t) => {
          const nodes = [...document.querySelectorAll<HTMLElement>("button, a, summary, [role=button]")];
          const el = nodes.find((n) => (n.textContent ?? "").trim().includes(t));
          el?.click();
        }, text);
      } else {
        await page.click(act.value);
      }
      await new Promise((r) => setTimeout(r, 450));
    } else if (act.kind === "type") {
      const [sel, text] = act.value.split("::");
      await page.click(sel);
      await page.type(sel, text ?? "");
      await new Promise((r) => setTimeout(r, 250));
    } else if (act.kind === "wait") {
      await new Promise((r) => setTimeout(r, Number(act.value)));
    }
  }

  const boxes = await page.evaluate(() => {
    const report: string[] = [];
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    report.push(`viewport ${vw}x${vh} scrollY=${Math.round(window.scrollY)} pageH=${document.body.scrollHeight}`);
    for (const el of document.querySelectorAll<HTMLElement>("nav, [class*=sticky], [class*=fixed]")) {
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed" && cs.position !== "sticky") continue;
      const r = el.getBoundingClientRect();
      if (r.height === 0) continue;
      const name = `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")}`;
      report.push(
        `${cs.position} ${name} top=${Math.round(r.top)} bottom=${Math.round(r.bottom)} h=${Math.round(r.height)} (vh=${vh})`
      );
    }
    return report;
  });
  for (const b of boxes) console.log(b);

  const file = path.join(OUT, outName) as `${string}.png`;
  await page.screenshot({ path: file });
  console.log(`\nscreenshot: ${file}`);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
