/**
 * Webbläsarverifiering: sidofältets fot (Inställningar som riktig nav-rad,
 * Logga ut dold i JSON-läge, demodata-återställning flyttad till Inställningar)
 * samt mobilens "Mer"-ark. Körs mot dev-servern på :3123 i JSON-läge.
 *
 *   npx tsx scripts/verify-sidebar-footer-browser.ts
 *
 * Skärmdumpar hamnar i .shots/.
 */
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = "http://localhost:3123";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function fail(msg: string): never {
  console.error("FAIL", msg);
  process.exit(1);
}

async function main() {
  mkdirSync(".shots", { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);

  // Bekräftelsedialoger: fånga texten och AVBRYT (rör inte demodatat –
  // andra agenters webbläsartester kan köra samtidigt).
  let lastDialogMessage = "";
  page.on("dialog", async (d) => {
    lastDialogMessage = d.message();
    await d.dismiss();
  });

  const results: string[] = [];
  async function ok(name: string, cond: boolean, extra = "") {
    if (!cond) fail(`${name} ${extra} url=${page.url()}`);
    results.push(`ok ${name}`);
    console.log("ok", name, extra);
  }

  /* ------------------------- 1. Desktop: sidofotens struktur ------------------------- */
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });

  const footer = await page.evaluate(() => {
    const aside = document.querySelector("aside");
    if (!aside) return null;
    const links = [...aside.querySelectorAll('a[href="/installningar"]')];
    const link = links[0] ?? null;
    const footerDiv = link?.closest("div");
    const nameP = footerDiv?.querySelector("p");
    return {
      settingsLinkCount: links.length,
      settingsText: (link?.textContent ?? "").trim(),
      settingsHasIcon: Boolean(link?.querySelector("svg")),
      settingsAriaCurrent: link?.getAttribute("aria-current") ?? null,
      companyName: (nameP?.textContent ?? "").trim(),
      companyNameInsideLink: Boolean(nameP?.closest("a")),
      asideText: aside.innerText,
    };
  });
  if (!footer) fail("sidofältet (aside) saknas");
  await ok("1 exakt EN Inställningar-länk i sidofältet", footer.settingsLinkCount === 1, `count=${footer.settingsLinkCount}`);
  await ok("1 Inställningar-raden har text + kugghjulsikon", footer.settingsText.includes("Inställningar") && footer.settingsHasIcon);
  await ok("1 företagsnamn visas som ren text (ej länk)", footer.companyName.length > 0 && !footer.companyNameInsideLink, footer.companyName);
  await ok("1 gamla 'Återställ demodata' borta ur sidofältet", !footer.asideText.includes("Återställ demodata"));
  await ok("1 Logga ut ABSENT i JSON-läge (sidofältet)", !footer.asideText.includes("Logga ut"));
  const floatingLogout = await page.$('button[aria-label="Logga ut"]');
  await ok("1 ingen flytande utloggningsknapp", !floatingLogout);

  const linkBox = await (await page.$('aside a[href="/installningar"]'))!.boundingBox();
  await ok("1 Inställningar-raden är ≥44px hög (touchyta)", !!linkBox && linkBox.height >= 44 && linkBox.width >= 200, JSON.stringify(linkBox));
  await page.screenshot({ path: ".shots/sidebar-footer-desktop.png" });

  /* ------------------------- 2. Hover-tillstånd på Inställningar ------------------------- */
  await page.hover('aside a[href="/installningar"]');
  await new Promise((r) => setTimeout(r, 350));
  const hoverBg = await page.$eval('aside a[href="/installningar"]', (el) => getComputedStyle(el).backgroundColor);
  await ok("2 hover ger synlig bakgrund", hoverBg !== "rgba(0, 0, 0, 0)" && hoverBg !== "transparent", hoverBg);
  await page.screenshot({ path: ".shots/sidebar-footer-hover.png" });

  /* ------------------------- 3. Tangentbordsfokus (focus-visible) ------------------------- */
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  let focused = false;
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el instanceof HTMLAnchorElement && el.getAttribute("href") === "/installningar" && Boolean(el.closest("aside"));
    });
    if (focused) break;
  }
  await ok("3 Inställningar nåbar med Tab", focused);
  const outline = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement as Element);
    return `${s.outlineStyle} ${s.outlineWidth}`;
  });
  await ok("3 focus-visible ring (2px solid)", outline.includes("solid") && outline.includes("2px"), outline);
  await page.screenshot({ path: ".shots/sidebar-footer-focus.png" });

  /* ------------------------- 4. Aktivt tillstånd + demosektionen ------------------------- */
  await page.goto(`${BASE}/installningar`, { waitUntil: "networkidle0" });
  const active = await page.evaluate(() => {
    const link = document.querySelector('aside a[href="/installningar"]');
    if (!link) return null;
    const s = getComputedStyle(link);
    return {
      ariaCurrent: link.getAttribute("aria-current"),
      className: link.className,
      bg: s.backgroundColor,
      color: s.color,
    };
  });
  await ok(
    "4 aktivt tillstånd på /installningar (mjuk fyllning + aria-current)",
    !!active &&
      active.ariaCurrent === "page" &&
      active.className.includes("bg-ink/5 font-medium") &&
      !active.className.includes("bg-ink text-white") &&
      active.color !== "rgb(255, 255, 255)",
    JSON.stringify(active)
  );

  await page.goto(`${BASE}/support`, { waitUntil: "networkidle0" });
  const supportActive = await page.evaluate(() => {
    const link = [...document.querySelectorAll("aside a")].find((a) => (a.getAttribute("href") ?? "").startsWith("/support"));
    if (!link) return null;
    const s = getComputedStyle(link);
    const kunder = [...document.querySelectorAll("aside a")].find((a) => a.getAttribute("href") === "/kunder");
    return {
      ariaCurrent: link.getAttribute("aria-current"),
      className: link.className,
      bg: s.backgroundColor,
      color: s.color,
      kunderClass: kunder?.className ?? "",
    };
  });
  await ok(
    "4 Hjälp & support använder samma mjuka fyllning som övrig nav",
    !!supportActive &&
      supportActive.ariaCurrent === "page" &&
      supportActive.className.includes("bg-ink/5 font-medium") &&
      !supportActive.kunderClass.includes("bg-ink/5 font-medium") &&
      supportActive.color !== "rgb(255, 255, 255)",
    JSON.stringify(supportActive)
  );

  // Obs: rubriken renderas med text-transform: uppercase → innerText är versal.
  const bodyText = await page.evaluate(() => document.body.innerText);
  await ok(
    "4 demosektionen syns på Inställningar (JSON-läge)",
    /demo & utveckling/i.test(bodyText) && bodyText.includes("Återställ demodata")
  );

  // Bekräftelseflödet: klicka men AVBRYT via dialoghanteraren ovan.
  lastDialogMessage = "";
  await page.evaluate(() => {
    const section = document.querySelector('section[aria-labelledby="demo-sektion-rubrik"]');
    const btn = [...(section?.querySelectorAll("button") ?? [])].find((b) => (b.textContent ?? "").includes("Återställ demodata"));
    (btn as HTMLButtonElement | undefined)?.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  await ok("4 confirm-dialog visas och avbröts", lastDialogMessage.includes("Återställa demodata?"), lastDialogMessage);
  await page.screenshot({ path: ".shots/installningar-demo-section.png", fullPage: true });

  /* ------------------------- 5. Mobil 390px: Mer-arket ------------------------- */
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  const merBtn = await page.evaluateHandle(() =>
    [...document.querySelectorAll("nav button")].find((b) => (b.textContent ?? "").includes("Mer")) ?? null
  );
  if (!merBtn.asElement()) fail("Mer-knappen saknas i bottennavet");
  await (merBtn.asElement() as puppeteer.ElementHandle<Element>).click();
  await page.waitForSelector('[role="dialog"][aria-label="Mer"]');
  const sheet = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"][aria-label="Mer"]');
    if (!dlg) return null;
    const settings = dlg.querySelector('a[href="/installningar"]');
    const rect = settings?.getBoundingClientRect();
    return {
      text: (dlg as HTMLElement).innerText,
      settingsHeight: rect?.height ?? 0,
      settingsHasIcon: Boolean(settings?.querySelector("svg")),
    };
  });
  await ok("5 Mer-arket har Inställningar med ikon", !!sheet && sheet.text.includes("Inställningar") && sheet.settingsHasIcon);
  await ok("5 Inställningar-raden ≥44px (mobil)", !!sheet && sheet.settingsHeight >= 44, String(sheet?.settingsHeight));
  await ok("5 Logga ut ABSENT i Mer-arket (JSON-läge)", !!sheet && !sheet.text.includes("Logga ut"));
  await page.screenshot({ path: ".shots/mer-sheet-mobile.png" });

  // Arket stängs vid navigation.
  await page.click('[role="dialog"][aria-label="Mer"] a[href="/installningar"]');
  await page.waitForFunction(() => location.pathname === "/installningar");
  const sheetGone = await page.evaluate(() => !document.querySelector('[role="dialog"][aria-label="Mer"]'));
  await ok("5 arket stängs vid navigation", sheetGone);
  await page.screenshot({ path: ".shots/installningar-mobile.png", fullPage: true });

  await browser.close();
  console.log("\nAlla fotens/utloggningens scenarier passerade:\n" + results.map((r) => "  " + r).join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
