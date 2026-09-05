/**
 * Browserverifiering av Grossistbeställningar (JSON-demoläget på :3123):
 *   npx tsx scripts/verify-wholesalers-browser.ts
 *
 * Kontrollerar att funktionen är osynlig när den är avstängd, att aktivering
 * landar i Grossister med demoprislista, hela flödet sök → varukorg → granska
 * → skicka (simulerat) → demobekräftelse i inboxen, orderdetaljen, mobilens
 * tryckytor/tangentbord och att avstängning inte raderar historiken.
 */
import fs from "node:fs";
import puppeteer, { type Page } from "puppeteer-core";

const BASE = process.env.VERIFY_URL ?? "http://localhost:3123";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";
const OUT = process.env.WHOLESALER_SHOTS ?? "/tmp/driva-wholesaler-shots";
const JOB = process.env.VERIFY_JOB_ID ?? "job-kok";

fs.mkdirSync(OUT, { recursive: true });

let step = 0;
function ok(msg: string) {
  step += 1;
  console.log(`  ✓ ${msg}`);
}
function fail(msg: string): never {
  console.error("FAIL", msg);
  process.exit(1);
}
function expect(cond: unknown, msg: string) {
  if (!cond) fail(msg);
  ok(msg);
}

async function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/${String(step).padStart(2, "0")}-${name}.png`, fullPage: false });
}

async function clickButton(page: Page, re: RegExp, scope = "body") {
  await page.waitForFunction(
    (source, flags, sel) => {
      const root = document.querySelector(sel) ?? document.body;
      const rx = new RegExp(source, flags);
      return Array.from(root.querySelectorAll("button, a")).some((b) => rx.test((b.textContent ?? "").replace(/\s+/g, " ").trim()) && !(b as HTMLButtonElement).disabled);
    },
    { timeout: 20000 },
    re.source,
    re.flags,
    scope,
  );
  const handle = await page.evaluateHandle(
    (source, flags, sel) => {
      const root = document.querySelector(sel) ?? document.body;
      const rx = new RegExp(source, flags);
      return Array.from(root.querySelectorAll("button, a")).find((b) => rx.test((b.textContent ?? "").replace(/\s+/g, " ").trim()) && !(b as HTMLButtonElement).disabled) ?? null;
    },
    re.source,
    re.flags,
    scope,
  );
  const el = handle.asElement();
  if (!el) fail(`knapp saknas: ${re}`);
  await (el as unknown as { click(): Promise<void> }).click();
}

async function waitText(page: Page, re: RegExp, timeout = 20000) {
  await page.waitForFunction((source, flags) => new RegExp(source, flags).test(document.body.innerText.replace(/\s+/g, " ")), { timeout }, re.source, re.flags);
}

const FEATURE = "[data-feature='wholesalers']";

/** Sätt funktionen av/på via Inställningar → Funktioner (stabila data-feature-selektorer). */
/** Öppna materialytan – klicket kan landa före hydreringen, så försök igen. */
async function openMaterial(page: Page) {
  await page.waitForSelector("[data-job-add-material]", { timeout: 20000 });
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.$eval("[data-job-add-material]", (el) => (el as HTMLElement).click());
    const opened = await page.waitForSelector("[role='dialog']", { timeout: 2500 }).catch(() => null);
    if (opened) return;
  }
  fail("materialytan öppnades inte");
}

async function replaceQuery(page: Page, value: string) {
  await page.focus("[data-wholesaler-search]");
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.type("[data-wholesaler-search]", value);
}

async function domClick(page: Page, selector: string) {
  await page.waitForSelector(selector, { timeout: 20000 });
  await page.$eval(selector, (el) => (el as HTMLElement).click());
}

async function setFeature(page: Page, on: boolean) {
  await page.goto(`${BASE}/installningar?flik=funktioner`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(`${FEATURE}[data-feature-action]`, { timeout: 20000 });
  const current = await page.$eval(`${FEATURE}[data-feature-action]`, (el) => el.getAttribute("data-feature-action"));
  if (on && current === "activate") {
    for (let attempt = 0; attempt < 5; attempt++) {
      await domClick(page, `${FEATURE}[data-feature-action='activate']`);
      const landed = await page
        .waitForFunction(() => location.search.includes("flik=grossister"), { timeout: 6000 })
        .catch(() => null);
      if (landed) break;
    }
    await page.waitForFunction(() => location.search.includes("flik=grossister"), { timeout: 30000 });
  } else if (!on && current === "deactivate") {
    // Klicket kan landa före hydreringen – försök igen tills bekräftelsen syns.
    for (let attempt = 0; attempt < 5; attempt++) {
      await domClick(page, `${FEATURE}[data-feature-action='deactivate']`);
      const confirm = await page
        .waitForSelector(`${FEATURE}[data-feature-action='confirm-deactivate']`, { timeout: 3000 })
        .catch(() => null);
      if (confirm) break;
    }
    await domClick(page, `${FEATURE}[data-feature-action='confirm-deactivate']`);
    await page.waitForSelector(`${FEATURE}[data-feature-action='activate']`, { timeout: 20000 });
  }
}

async function resetDemo(page: Page) {
  const res = await page.evaluate(async (base) => {
    const r = await fetch(`${base}/api/dev/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "seed" }),
    });
    return r.status;
  }, BASE);
  if (res !== 200) console.log(`  (demo-reset svarade ${res})`);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=sv-SE"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await resetDemo(page);

  console.log("\nAvstängd funktion:");
  await setFeature(page, false);
  await page.goto(`${BASE}/installningar?flik=grossister`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => location.search.includes("flik=funktioner"), { timeout: 15000 });
  ok("direktlänk till ?flik=grossister landar på Funktioner när funktionen är avstängd");
  const tabsOff = await page.evaluate(() => Array.from(document.querySelectorAll("a")).map((a) => a.textContent?.trim()).filter((t) => t === "Grossister").length);
  expect(tabsOff === 0, "ingen flik Grossister när funktionen är avstängd");

  await page.goto(`${BASE}/uppdrag/${JOB}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-job-add-material]");
  expect(!(await page.$("[data-purchase-orders-section]")), "ingen sektion Materialbeställningar för ett uppdrag utan beställningar");
  await openMaterial(page);
  await waitText(page, /Beskrivning/);
  expect(!(await page.$("[data-wholesaler-search]")), "Lägg till material öppnar dagens manuella formulär (inget grossistsök)");
  await shot(page, "avstangd-manuellt-material");
  await page.keyboard.press("Escape");

  console.log("\nAktivering:");
  await page.goto(`${BASE}/installningar?flik=funktioner`, { waitUntil: "domcontentloaded" });
  await waitText(page, /Sök material med dina priser och skicka beställningar till grossisten\./);
  ok("Funktioner visar Grossistbeställningar med beskrivningen");
  await setFeature(page, true);
  ok("aktivering landar direkt på Inställningar → Grossister");
  await waitText(page, /Demo-grossisten/, 30000);
  await waitText(page, /Dina priser uppdaterades/, 30000);
  await waitText(page, /artiklar importerades/);
  ok("demogrossisten med prislista är seedad (Dina priser uppdaterades … artiklar importerades)");
  await shot(page, "grossister-installningar");

  console.log("\nLägg till grossist + prisfil via UI:");
  await clickButton(page, /^Lägg till grossist$/);
  await page.waitForSelector("[role='dialog']");
  await page.select("[role='dialog'] select", "dahl");
  await page.type("[role='dialog'] input[id$='-kundnummer']", "778899");
  await page.type("[role='dialog'] input[id$='-ordermejl']", "order@dahl-test.example");
  await clickButton(page, /^Spara grossist$/, "[role='dialog']");
  await waitText(page, /Kundnummer 778899/);
  ok("ny grossist (Dahl) sparas och visas med kundnummer och ordermejl");
  expect(/Ingen prislista ännu/.test(await bodyText(page)), "utan prislista visas 'Ingen prislista ännu'");
  // Öppna uppladdningen för Dahl-kortet (det utan prislista).
  const openedUpload = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("[data-wholesaler-connection]"));
    const card = cards.find((c) => /778899/.test(c.textContent ?? ""));
    const btn = card ? Array.from(card.querySelectorAll("button")).find((b) => /Ladda upp prisfil/.test(b.textContent ?? "")) : undefined;
    if (!btn) return false;
    btn.click();
    return true;
  });
  expect(openedUpload, "Ladda upp prisfil finns på kortet");
  await page.waitForSelector("[data-price-file-input]", { timeout: 20000 });
  const csvPath = `${OUT}/prislista-test.csv`;
  fs.writeFileSync(
    csvPath,
    [
      "Artikelnr;Benämning;E-nummer;RSK;Enhet;Förp;Listpris;Nettopris",
      "100200;Kabel EKK 3G1,5 vit;0010012;;m;100;18,90;12,50",
      "300400;Vägguttag 2-vägs jordat infällt;1780235;;st;1;89,00;61,20",
      "500600;Rörkoppling 15 mm;;8103567;st;10;45,00;30,00",
    ].join("\r\n"),
    "utf8",
  );
  const fileInput = await page.$("[data-price-file-input]");
  await fileInput!.uploadFile(csvPath);
  await waitText(page, /Artikelnummer|Benämning/, 30000);
  const preview = await bodyText(page);
  expect(/3 rader|rader/.test(preview) && /Importera prislistan/.test(preview), "förhandsgranskningen visar kolumner, rader och Importera prislistan");
  expect(!/parser|mappning|XML|EDI/i.test(preview.replace(/XML eller ZIP/, "")), "förhandsgranskningen använder enkel svenska (inga tekniska ord)");
  await shot(page, "prisfil-forhandsgranskning");
  await clickButton(page, /^Importera prislistan$/, "[role='dialog']");
  await waitText(page, /3 artiklar importerades|artiklar importerades/, 30000);
  ok("importen går igenom och rapporterar antal artiklar");
  await clickButton(page, /^Klar$/, "[role='dialog']");
  await page.waitForFunction(() => !document.querySelector("[role='dialog']"), { timeout: 10000 });
  await waitText(page, /Dina priser uppdaterades/);
  const settingsAfter = await bodyText(page);
  expect((settingsAfter.match(/artiklar importerades/g) ?? []).length >= 2, "båda grossisterna har nu prislistestatus");
  await shot(page, "grossister-tva-anslutningar");

  console.log("\nSök → varukorg → skicka (desktop):");
  await page.goto(`${BASE}/uppdrag/${JOB}`, { waitUntil: "domcontentloaded" });
  await openMaterial(page);
  await page.waitForSelector("[data-wholesaler-search]");
  const focused = await page.evaluate(() => document.activeElement?.hasAttribute("data-wholesaler-search"));
  expect(focused, "sökfältet får fokus när materialytan öppnas");
  // Två grossister → väljare. Välj demogrossisten uttryckligen.
  const pickerValue = await page.evaluate(() => {
    const select = document.querySelector("select[aria-label='Välj grossist']") as HTMLSelectElement | null;
    if (!select) return null;
    const option = Array.from(select.options).find((o) => /Demo-grossisten/.test(o.textContent ?? ""));
    return option?.value ?? null;
  });
  expect(pickerValue, "grossistväljaren visas när flera grossister är kopplade");
  await page.select("select[aria-label='Välj grossist']", pickerValue!);
  await page.focus("[data-wholesaler-search]");
  await page.type("[data-wholesaler-search]", "kabel");
  await page.waitForSelector("[data-wholesaler-result]", { timeout: 20000 });
  const firstResult = await page.$eval("[data-wholesaler-result]", (el) => el.textContent ?? "");
  expect(/Kundpris/.test(firstResult) && /kr/.test(firstResult), "sökresultatet visar inköpspris och kundpris");
  expect(/Priser från/.test(await bodyText(page)), "prislistans datum visas i sökvyn");
  await shot(page, "sok-kabel");
  await domClick(page, "[data-wholesaler-add]");
  await page.waitForFunction(() => /Visa varukorg \(1\)/.test(document.body.innerText), { timeout: 20000 });
  ok("Lägg i varukorg → Visa varukorg (1)");
  // En artikel till via E-nummer.
  await replaceQuery(page, "1857005");
  await page.waitForFunction(() => Array.from(document.querySelectorAll("[data-wholesaler-result]")).some((r) => /Vägguttag/.test(r.textContent ?? "")), { timeout: 20000 });
  ok("sökning på E-nummer hittar rätt artikel");
  await domClick(page, "[data-wholesaler-add]");
  await page.waitForFunction(() => /Visa varukorg \(2\)/.test(document.body.innerText), { timeout: 20000 });
  await domClick(page, "[data-wholesaler-cart-button]");
  await page.waitForSelector("[data-wholesaler-cart-lines]");
  const cartText = await bodyText(page);
  expect(/Förväntad inköpskostnad/.test(cartText) && /Kundpris totalt/.test(cartText), "varukorgen visar inköpskostnad och kundpris separat");
  expect(!/vinst/i.test(cartText), "varukorgen påstår ingen vinst");
  await shot(page, "varukorg");
  await domClick(page, "[data-wholesaler-review-button]");
  await page.waitForSelector("[data-wholesaler-mail-preview]", { timeout: 20000 });
  const review = await bodyText(page);
  expect(/order@demo-grossisten\.example/.test(review), "granskningen visar mottagaren");
  expect(/Din Ferva-inbox/.test(review), "granskningen visar att svaret hamnar i Ferva-inboxen");
  expect(/DEMO-4711/.test(review), "granskningen visar kundnumret");
  expect(/bestallning-FV-\d+\.pdf/.test(review), "PDF-underlag bifogas");
  await shot(page, "granska");
  await domClick(page, "[data-wholesaler-send]");
  await waitText(page, /simulerades|är skickad/, 30000);
  const sent = await bodyText(page);
  expect(/Inget mejl lämnade Ferva/.test(sent), "demoutskicket är ärligt: inget mejl lämnade Ferva");
  await shot(page, "skickad");
  await clickButton(page, /^Klar$/);
  await page.waitForSelector("[data-purchase-orders-section]", { timeout: 20000 });
  const section = await page.$eval("[data-purchase-orders-section]", (el) => el.textContent ?? "");
  expect(/FV-\d+/.test(section) && /Demo-grossisten/.test(section), "uppdraget visar sektionen Materialbeställningar med referensen");
  expect(/bekräftat|Avvikelse|Delvis/.test(section), "demobekräftelsen har stämts av mot beställningen");
  await shot(page, "uppdrag-materialbestallningar");

  console.log("\nOrderdetalj + inbox:");
  await domClick(page, "[data-purchase-orders-section] a");
  await page.waitForSelector("[data-purchase-order-lines]", { timeout: 20000 });
  const detail = await bodyText(page);
  expect(/Beställning FV-\d+/.test(detail), "orderdetaljen har referensen i rubriken");
  expect(/Vad grossisten fick/i.test(detail), "den skickade snapshoten visas");
  expect(/Svar från grossisten/i.test(detail), "bekräftelsen listas");
  expect(!/needs_review|partially_confirmed|"sent"/.test(detail), "inga råa statusvärden");
  await shot(page, "orderdetalj");
  await page.goto(`${BASE}/inbox?visning=alla`, { waitUntil: "domcontentloaded" });
  await waitText(page, /Orderbekräftelse Demo-grossisten · FV-\d+/);
  ok("inboxen visar orderbekräftelsen med grossist och referens");
  const inboxHref = await page.evaluate(
    () => (Array.from(document.querySelectorAll("a")).find((a) => /Orderbekräftelse Demo-grossisten/.test(a.textContent ?? "")) as HTMLAnchorElement | undefined)?.href ?? null,
  );
  expect(inboxHref, "inboxraden länkar till posten");
  await page.goto(inboxHref!, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-inbox-linked-order]", { timeout: 20000 });
  ok("inboxposten är kopplad till beställningen (ingen fakturavy)");
  expect(!/Förfaller|Betalningsuppgifter/.test(await bodyText(page)), "orderbekräftelsen visar inga faktura-/betalfält");
  await shot(page, "inbox-orderbekraftelse");

  console.log("\nMobil:");
  const mobile = await browser.newPage();
  await mobile.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await mobile.goto(`${BASE}/uppdrag/${JOB}`, { waitUntil: "domcontentloaded" });
  await openMaterial(mobile);
  await mobile.waitForSelector("[data-wholesaler-search]");
  const mobilePicker = await mobile.evaluate(() => {
    const select = document.querySelector("select[aria-label='Välj grossist']") as HTMLSelectElement | null;
    return select ? (Array.from(select.options).find((o) => /Demo-grossisten/.test(o.textContent ?? ""))?.value ?? null) : null;
  });
  if (mobilePicker) await mobile.select("select[aria-label='Välj grossist']", mobilePicker);
  await mobile.focus("[data-wholesaler-search]");
  await mobile.type("[data-wholesaler-search]", "dosa");
  await mobile.waitForSelector("[data-wholesaler-result]", { timeout: 20000 });
  const small = await mobile.evaluate(() => {
    const dialog = document.querySelector("[role='dialog']") ?? document.body;
    return Array.from(dialog.querySelectorAll("button, input, select, a[href]"))
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => ({ tag: el.tagName, label: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30), h: el.getBoundingClientRect().height, w: el.getBoundingClientRect().width }))
      .filter((r) => r.h < 44 || r.w < 44);
  });
  expect(small.length === 0, `alla tryckytor i materialytan är minst 44 px${small.length ? `: ${JSON.stringify(small)}` : ""}`);
  // Tangentbord: Tab från sökfältet når antal + Lägg i varukorg; Enter i antal lägger till.
  await mobile.focus("[data-wholesaler-search]");
  let reachedAdd = false;
  for (let i = 0; i < 8 && !reachedAdd; i++) {
    await mobile.keyboard.press("Tab");
    reachedAdd = await mobile.evaluate(() => document.activeElement?.hasAttribute("data-wholesaler-add") ?? false);
  }
  expect(reachedAdd, "Lägg i varukorg nås med Tab från sökfältet");
  await mobile.keyboard.press("Enter");
  await mobile.waitForFunction(() => /Visa varukorg \(1\)/.test(document.body.innerText), { timeout: 20000 });
  ok("Enter på Lägg i varukorg lägger artikeln i varukorgen (mobil)");
  const sticky = await mobile.evaluate(() => {
    const btn = document.querySelector("[data-wholesaler-cart-button]") as HTMLElement | null;
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { bottom: r.bottom, inner: window.innerHeight, h: r.height };
  });
  expect(sticky && sticky.bottom <= sticky.inner && sticky.h >= 44, "Visa varukorg är synlig i botten av mobilytan");
  await shot(mobile, "mobil-sok");
  await mobile.keyboard.press("Escape");
  await mobile.waitForFunction(() => !document.querySelector("[data-wholesaler-search]"), { timeout: 10000 });
  ok("Escape stänger materialytan");
  await mobile.close();

  console.log("\nAvstängning:");
  await page.goto(`${BASE}/installningar?flik=funktioner`, { waitUntil: "domcontentloaded" });
  await waitText(page, /Grossistbeställningar/);
  await setFeature(page, false);
  ok("funktionen är avstängd igen");
  await page.goto(`${BASE}/uppdrag/${JOB}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-job-add-material]");
  expect(Boolean(await page.$("[data-purchase-orders-section]")), "historiska beställningar visas fortfarande på uppdraget");
  await openMaterial(page);
  await waitText(page, /Beskrivning/);
  expect(!(await page.$("[data-wholesaler-search]")), "Lägg till material är dagens manuella formulär igen");
  await page.keyboard.press("Escape");
  await page.goto(`${BASE}/installningar?flik=grossister`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => location.search.includes("flik=funktioner"), { timeout: 15000 });
  ok("direktlänk till Grossister följer redirect-mönstret");

  await resetDemo(page);
  await browser.close();
  console.log(`\n${step} kontroller godkända. Skärmdumpar i ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
