/**
 * Webbläsarkontroll av varumärkesmärket (spec §9, FervaMark).
 *
 * Kör mot en lokal dev-server:
 *   npm run dev
 *   npx tsx scripts/verify-ferva-market-browser.ts
 *
 * Skärmbilder hamnar i FERVA_SHOT_DIR (default .data/ux-audit/ferva-market).
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.FERVA_BASE ?? "http://localhost:3123";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOT_DIR = process.env.FERVA_SHOT_DIR ?? path.join(process.cwd(), ".data", "ux-audit", "ferva-market");

const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 375, height: 812 };

function fail(msg: string): never {
  console.error("FAIL", msg);
  process.exit(1);
}

/** Ikonfilerna inbakade som data-URL:er, så arket kan renderas utan server. */
function proofSheetHtml(): string {
  const asset = (rel: string, mime: string) =>
    `data:${mime};base64,${fs.readFileSync(path.join(process.cwd(), "public", rel)).toString("base64")}`;
  const png = (name: string) => asset(`icons/${name}`, "image/png");
  const tab = (label: string, muted: boolean) =>
    `<div class="tab${muted ? " bg" : ""}"><img src="${png("icon-16.png")}" width="16" height="16"><span>${label}</span></div>`;
  const cell = (src: string, shown: number, caption: string) =>
    `<div class="cell"><img src="${src}" width="${shown}" height="${shown}"><div class="cap">${caption}</div></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#dee1e6;font:13px -apple-system,system-ui,sans-serif;color:#3c4043;padding:28px}
  h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#5f6368;margin:0 0 10px}
  .tabs{display:flex;gap:2px;margin-bottom:26px}
  .tab{display:flex;align-items:center;gap:9px;background:#fff;border-radius:10px 10px 0 0;padding:9px 14px;min-width:190px}
  .tab.bg{background:#f1f3f4;color:#5f6368}
  .tab img,.cell img{display:block}
  .row{display:flex;align-items:flex-end;gap:34px;background:#fff;border-radius:12px;padding:20px 24px}
  .cell{text-align:center}
  .cell img{margin:0 auto 8px}
  .cap{font-size:11px;color:#5f6368}
</style></head><body>
  <h2>Så ser fliken ut (ikonen i naturlig storlek)</h2>
  <div class="tabs">${tab("Ferva", false)}${tab("Ferva &middot; Ekonomi", true)}</div>
  <h2>Ikonfilerna i repot</h2>
  <div class="row">
    ${cell(png("icon-16.png"), 16, "icon-16<br>16&times;16")}
    ${cell(png("icon-32.png"), 32, "icon-32<br>32&times;32")}
    ${cell(asset("brand/favicon.svg", "image/svg+xml"), 64, "favicon.svg<br>vektor")}
    ${cell(png("apple-touch-icon.png"), 90, "apple-touch-icon<br>180&times;180")}
    ${cell(png("icon-192.png"), 96, "icon-192<br>192&times;192")}
    ${cell(png("icon-maskable-512.png"), 96, "maskable-512<br>512&times;512")}
  </div>
</body></html>`;
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  const passed: string[] = [];

  async function ok(name: string, cond: boolean, extra = "") {
    if (!cond) fail(`${name} ${extra} url=${page.url()}`);
    passed.push(name);
    console.log("ok", name, extra ? `- ${extra}` : "");
  }

  async function shot(name: string) {
    const file = path.join(SHOT_DIR, `${name}.png`);
    await page.screenshot({ path: file as `${string}.png` });
    console.log("   bild", file);
  }

  /** Antal FervaMark-SVG:er (banan är unik för märket). */
  async function markCount(): Promise<number> {
    return page.evaluate(() =>
      Array.from(document.querySelectorAll("svg path")).filter((p) =>
        (p.getAttribute("d") ?? "").startsWith("M20 16 H44")
      ).length
    );
  }

  /** Ensam versal i ett element – den gamla "D"-brickan. */
  async function loneLetterBadges(): Promise<string[]> {
    return page.evaluate(() =>
      Array.from(document.querySelectorAll("span, div"))
        .filter((el) => /^[A-ZÅÄÖ]$/.test((el.textContent ?? "").trim()) && el.children.length === 0)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`)
    );
  }

  // 1. Inloggad app, desktop: märket i sidomenyn, ingen D-bricka.
  await page.setViewport(DESKTOP);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  await page.waitForSelector('a[href="/"]');
  await ok("app desktop: FervaMark i sidomenyn", (await markCount()) >= 1, `${await markCount()} märken`);
  const badgesDesktop = await loneLetterBadges();
  await ok("app desktop: ingen ensam bokstav som bricka", badgesDesktop.length === 0, badgesDesktop.join(", "));
  await ok(
    "app desktop: ordmärket Ferva står kvar",
    await page.evaluate(() => document.body.innerText.includes("Ferva"))
  );
  await shot("01-app-nav-desktop");

  // 2. Samma sida på 375.
  await page.setViewport(MOBILE);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  const badgesMobile = await loneLetterBadges();
  await ok("app 375: ingen ensam bokstav som bricka", badgesMobile.length === 0, badgesMobile.join(", "));
  await shot("02-app-nav-375");

  // 3. Inloggningssidan.
  for (const [label, vp] of [["desktop", DESKTOP], ["375", MOBILE]] as const) {
    await page.setViewport(vp);
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
    await ok(`login ${label}: märket finns`, (await markCount()) === 1);
    await shot(label === "desktop" ? "03-login-desktop" : "04-login-375");
  }

  // 4. Landningssidan: märket i header och sidfot.
  for (const [label, vp] of [["desktop", DESKTOP], ["375", MOBILE]] as const) {
    await page.setViewport(vp);
    await page.goto(`${BASE}/valkommen`, { waitUntil: "networkidle0" });
    await ok(`valkommen ${label}: märket i header och sidfot`, (await markCount()) === 2, `${await markCount()}`);
    await shot(label === "desktop" ? "05-valkommen-desktop" : "06-valkommen-375");
  }

  // 5. Felsida: rot-404 (ingen rutt matchar).
  for (const [label, vp] of [["desktop", DESKTOP], ["375", MOBILE]] as const) {
    await page.setViewport(vp);
    const res = await page.goto(`${BASE}/finns-inte-alls`, { waitUntil: "networkidle0" });
    await ok(`404 ${label}: status 404`, res?.status() === 404, `status=${res?.status()}`);
    await ok(
      `404 ${label}: ingen FervaMark (läcker annars in i RSC på /offert)`,
      (await markCount()) === 0,
      `${await markCount()}`
    );
    await ok(
      `404 ${label}: svensk text`,
      await page.evaluate(() => document.body.innerText.includes("Sidan finns inte"))
    );
    await shot(label === "desktop" ? "07-404-desktop" : "08-404-375");
  }

  // 5b. Publikt kunddokument: avsändaren är företaget, inte Ferva.
  await page.setViewport(DESKTOP);
  await page.goto(`${BASE}/offert/demo-anna-kok`, { waitUntil: "networkidle0" });
  await ok("offert publik: ingen FervaMark", (await markCount()) === 0, `${await markCount()}`);
  await ok(
    "offert publik: ingen produktfot",
    await page.evaluate(() => !document.body.innerText.includes("Skickad med Ferva"))
  );
  await ok(
    "offert publik: företagskontakt",
    await page.evaluate(() => document.body.innerText.includes("Frågor? Kontakta") && document.body.innerText.includes("Södermalms"))
  );
  await shot("07b-offert-publik");

  // 6. Offlinesidan – märket ska vara inline SVG, inte en bokstav.
  await page.setViewport(MOBILE);
  await page.goto(`${BASE}/offline`, { waitUntil: "networkidle0" });
  await ok("offline: märket finns", (await markCount()) === 1);
  await ok("offline: ingen bokstavsbricka", (await loneLetterBadges()).length === 0);
  await shot("09-offline-375");

  // 7. Ikonlänkarna i <head> och att filerna faktiskt serveras.
  await page.setViewport(DESKTOP);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  const icons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')).map((l) => ({
      rel: l.getAttribute("rel"),
      href: l.getAttribute("href"),
      type: l.getAttribute("type"),
    }))
  );
  await ok(
    "head: favicon.svg länkas",
    icons.some((i) => i.href === "/brand/favicon.svg" && i.type === "image/svg+xml"),
    JSON.stringify(icons)
  );
  await ok("head: .ico länkas", icons.some((i) => (i.href ?? "").includes("favicon") && (i.href ?? "").includes(".ico")));
  await ok("head: apple-touch-icon länkas", icons.some((i) => i.rel === "apple-touch-icon"));

  for (const asset of [
    "/brand/favicon.svg",
    "/brand/ferva-market.svg",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/icon-maskable-512.png",
    "/icons/apple-touch-icon.png",
    "/icons/icon-32.png",
    "/icons/icon-16.png",
    "/favicon.ico",
    "/opengraph-image",
  ]) {
    const res = await page.goto(`${BASE}${asset}`, { waitUntil: "domcontentloaded" });
    // 304 = webbläsaren har filen cachad sedan en tidigare sida; också levererad.
    await ok(`asset ${asset}`, res?.status() === 200 || res?.status() === 304, `status=${res?.status()}`);
  }

  // 8. De borttagna Next-mallfilerna ska vara borta.
  for (const gone of ["/next.svg", "/vercel.svg", "/window.svg", "/globe.svg", "/file.svg"]) {
    const res = await page.goto(`${BASE}${gone}`, { waitUntil: "domcontentloaded" });
    await ok(`borttagen ${gone}`, res?.status() === 404, `status=${res?.status()}`);
  }

  // 9. Fliken: rendera favicon.svg stor så att märket syns i en skärmbild.
  await page.setViewport({ width: 400, height: 400 });
  await page.goto(`${BASE}/brand/favicon.svg`, { waitUntil: "networkidle0" });
  await shot("10-favicon-svg");

  // 10. Kontaktkarta över ikonfilerna i naturlig storlek. En skärmbild kan
  //     inte visa webbläsarens egen flikrad, så flikarna här är ritade - men
  //     bilderna i dem är de verkliga filerna i public/icons, oskalade.
  await page.setViewport({ width: 760, height: 300, deviceScaleFactor: 2 });
  await page.goto("about:blank");
  await page.setContent(proofSheetHtml(), { waitUntil: "load" });
  await shot("11-favicon-och-ikoner");

  await browser.close();
  console.log(`\n${passed.length} kontroller ok. Bilder i ${SHOT_DIR}`);
}

main().catch((e) => fail(String(e)));
