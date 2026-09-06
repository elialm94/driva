/**
 * Browserverifiering av onboarding, Kom igång och importen (JSON-demoläget på :3123):
 *   npx tsx scripts/verify-onboarding-browser.ts
 *
 * Onboardingens två steg körs via /dev/onboarding (JSON-läget har inga
 * riktiga konton – själva skapandet kräver Supabase och täcks av
 * scripts/adapter-validate.ts). Här kontrolleras formulären på mobil (390 px
 * och 320 px), härlett momsnummer, betalning nu/senare, ärligt besked om
 * företagsform, Kom igång-centret (profil, gör senare, ta upp igen), Hem-kortet
 * och hela importflödet: uppladdning → kort → kolumner → bekräfta → klart →
 * dubblettskydd.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer, { type Page } from "puppeteer-core";

const BASE = process.env.VERIFY_URL ?? "http://localhost:3123";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";
const OUT = process.env.ONBOARDING_SHOTS ?? "/tmp/driva-onboarding-shots";

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

async function waitText(page: Page, re: RegExp, timeout = 20000) {
  await page.waitForFunction((source, flags) => new RegExp(source, flags).test(document.body.innerText.replace(/\s+/g, " ")), { timeout }, re.source, re.flags);
}

async function domClick(page: Page, selector: string) {
  await page.waitForSelector(selector, { timeout: 20000 });
  await page.$eval(selector, (el) => (el as HTMLElement).click());
}

async function clickButton(page: Page, re: RegExp, scope = "body") {
  await page.waitForFunction(
    (source, flags, sel) => {
      const root = document.querySelector(sel) ?? document.body;
      const rx = new RegExp(source, flags);
      return Array.from(root.querySelectorAll("button, a, label")).some((b) => rx.test((b.textContent ?? "").replace(/\s+/g, " ").trim()) && !(b as HTMLButtonElement).disabled);
    },
    { timeout: 20000 },
    re.source,
    re.flags,
    scope,
  );
  await page.evaluate(
    (source, flags, sel) => {
      const root = document.querySelector(sel) ?? document.body;
      const rx = new RegExp(source, flags);
      const el = Array.from(root.querySelectorAll("button, a, label")).find((b) => rx.test((b.textContent ?? "").replace(/\s+/g, " ").trim()) && !(b as HTMLButtonElement).disabled);
      (el as HTMLElement | undefined)?.click();
    },
    re.source,
    re.flags,
    scope,
  );
}

async function noHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function smallTargets(page: Page, scope = "body"): Promise<string[]> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel) ?? document.body;
    return Array.from(root.querySelectorAll("button, input:not([type='checkbox']):not([type='radio']), select, a[href], label"))
      .filter((el) => (el as HTMLElement).offsetParent !== null && !el.classList.contains("sr-only"))
      // Vanliga fältetiketter är inte tryckytor – bara etiketter som ÄR valknappen (innehåller sin input).
      .filter((el) => el.tagName !== "LABEL" || el.querySelector("input") !== null)
      .filter((el) => !(el.tagName === "A" && (el as HTMLElement).closest("p, dd, li:not([data-setup-task])")))
      .map((el) => ({ label: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30), h: el.getBoundingClientRect().height, w: el.getBoundingClientRect().width }))
      .filter((r) => r.h < 44 || r.w < 44)
      .map((r) => `${r.label} (${Math.round(r.w)}×${Math.round(r.h)})`);
  }, scope);
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
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await resetDemo(page);

  console.log("\nOnboarding steg 1 (mobil 390 px):");
  await page.goto(`${BASE}/dev/onboarding`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-onboarding-step='company']");
  const step1 = await bodyText(page);
  expect(/Berätta om företaget/.test(step1) && /1 av 2/.test(step1), "rubrik + diskret progression 1 av 2");
  expect(!/EDI|XML|reskontra/i.test(step1), "inga tekniska ord i steg 1");
  expect(await noHorizontalOverflow(page), "ingen horisontell overflow på 390 px");
  const small1 = await smallTargets(page, "form");
  expect(small1.length === 0, `alla tryckytor i steg 1 är minst 44 px${small1.length ? `: ${small1.join(", ")}` : ""}`);
  await shot(page, "steg1-tom");

  await clickButton(page, /^Annan företagsform$/);
  await waitText(page, /stödjer just nu aktiebolag och enskild firma/);
  expect(await page.$eval("[data-onboarding-continue]", (b) => (b as HTMLButtonElement).disabled), "företagsform som inte stöds ger ärligt besked och stoppar Fortsätt");
  await clickButton(page, /^Aktiebolag$/);
  await page.type("#ob-orgnr", "5591234567");
  await page.waitForFunction(() => /SE559123456701/.test(document.querySelector("[data-onboarding-vat]")?.textContent ?? ""));
  expect(/Uträknat automatiskt/.test(await bodyText(page)), "momsregistreringsnumret räknas ut ur organisationsnumret (inget textfält)");
  expect(!(await page.$("input[name='vatNumber']:not([type='hidden'])")), "ingen manuell momsinmatning");
  await page.type("#ob-name", "Ekvägens El AB");
  await clickButton(page, /^Gör det senare$/);
  await waitText(page, /Vi påminner dig under Kom igång/);
  expect(!(await page.$("#ob-payment-method")), "Gör det senare döljer betalningssättet");
  await clickButton(page, /^Lägg till nu$/);
  await page.waitForSelector("#ob-payment-method");
  await clickButton(page, /^Bankgiro$/, "#ob-payment-method");
  await page.waitForSelector("input[name='bankgiro']");
  ok("Lägg till nu visar betalningssätt och fältet för valt sätt");
  await shot(page, "steg1-ifylld");

  // Validering: skicka utan adress → första felet fokuseras, sammanfattning visas.
  await domClick(page, "[data-onboarding-continue]");
  await waitText(page, /Rätta uppgifterna ovan/);
  const focused = await page.evaluate(() => document.activeElement?.id ?? "");
  expect(focused === "ob-bankgiro" || focused === "ob-address", `första felet fokuseras (${focused})`);
  await shot(page, "steg1-fel");

  console.log("\nOnboarding steg 2 (mobil 390 px):");
  await page.goto(`${BASE}/dev/onboarding?steg=2`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-onboarding-step='personalize']");
  const step2 = await bodyText(page);
  expect(/Anpassa Ferva efter företaget/.test(step2) && /2 av 2/.test(step2), "rubrik + 2 av 2");
  expect(/Vad arbetar företaget med\?/.test(step2) && /Betalar företaget ut lön\?/.test(step2) && /Hur ser bokföringen ut idag\?/.test(step2), "tre frågegrupper");
  expect(!/Fortnox|Mowin|Visma/i.test(step2), "inga systemnamn i svarsalternativen");
  const small2 = await smallTargets(page, "form");
  expect(small2.length === 0, `alla tryckytor i steg 2 är minst 44 px${small2.length ? `: ${small2.join(", ")}` : ""}`);
  await domClick(page, "[data-onboarding-open]");
  await waitText(page, /Välj minst ett område/);
  ok("Öppna Ferva utan val ger fältfel");
  await clickButton(page, /^Annat$/);
  await page.waitForSelector("#ob-otherIndustry");
  ok("Annat visar ett kort fritextfält");
  await clickButton(page, /Företaget har bokföring som ska flyttas hit/);
  await waitText(page, /Flytta in bokföringen/);
  ok("befintlig bokföring förklarar att filer inte behövs nu");
  await shot(page, "steg2");

  console.log("\nKom igång i Inställningar:");
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/installningar?flik=kom-igang`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-setup-center]");
  await page.waitForSelector("[data-setup-profile-save]", { timeout: 20000 });
  await clickButton(page, /^El$/, "[data-setup-center]");
  await clickButton(page, /Nej, inte idag/, "[data-setup-center]");
  await clickButton(page, /Företaget har bokföring som ska flyttas hit/, "[data-setup-center]");
  await domClick(page, "[data-setup-profile-save]");
  await page.waitForSelector("[data-setup-profile-edit]", { timeout: 20000 });
  await page.waitForSelector("[data-setup-task='move_bookkeeping']", { timeout: 20000 });
  const profileText = await bodyText(page);
  expect(/Verksamhet\s*El\b/.test(profileText), `profilen sparas och visas (${profileText.slice(profileText.indexOf("Företagets profil"), profileText.indexOf("Företagets profil") + 160)})`);
  const move = await page.$eval("[data-setup-task='move_bookkeeping']", (el) => el.getAttribute("data-setup-status"));
  expect(move === "todo", "Flytta in bokföringen är en öppen uppgift när bokföring ska flyttas");
  const articles = await page.$eval("[data-setup-task='articles_prices']", (el) => el.getAttribute("data-setup-status"));
  expect(articles === "todo", "Lägg in artiklar och priser rekommenderas för el");
  await shot(page, "kom-igang");

  await clickButton(page, /^Senare$/, "[data-setup-task='move_bookkeeping']");
  await page.waitForFunction(() => document.querySelector("[data-setup-task='move_bookkeeping']")?.getAttribute("data-setup-status") === "later", { timeout: 20000 });
  ok("Gör senare flyttar uppgiften till Gör senare");
  await clickButton(page, /Ta upp igen/, "[data-setup-task='move_bookkeeping']");
  await page.waitForFunction(() => document.querySelector("[data-setup-task='move_bookkeeping']")?.getAttribute("data-setup-status") === "todo", { timeout: 20000 });
  ok("Ta upp igen återaktiverar uppgiften");

  console.log("\nHem:");
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-setup-home-card]", { timeout: 20000 });
  const home = await bodyText(page);
  expect(/Gör Ferva redo/.test(home), "Hem visar Gör Ferva redo när uppgifter återstår");
  const firstTask = await page.$eval("[data-setup-home-card] [data-setup-task]", (el) => el.getAttribute("data-setup-task"));
  expect(firstTask === "move_bookkeeping", "Flytta in bokföringen prioriteras högst på Hem");
  await shot(page, "hem-kort");

  console.log("\nImport – Flytta dina uppgifter till Ferva:");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ferva-import-"));
  const csvPath = path.join(tmp, "kunder.csv");
  fs.writeFileSync(
    csvPath,
    "Kundnamn;Kontaktperson;Org.nr;E-post;Telefon;Adress;Postnr;Ort;Typ\nBrowsertest Bygg AB;Lisa Berg;559900-1234;lisa@browsertest.se;08-123 45 67;Ekvägen 1;116 24;Stockholm;Företag\nTest Testsson;;;test@browsertest.se;070-111 22 33;Björkvägen 2;11630;Stockholm;Privat\n",
  );
  await clickButton(page, /Ladda upp filer/, "[data-setup-home-card], body");
  await page.goto(`${BASE}/kom-igang/importera`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-import-dropzone]");
  const importText = await bodyText(page);
  expect(/Flytta dina uppgifter till Ferva/.test(importText) && /Dra filer hit eller välj från enheten/.test(importText), "importsidan med primär yta");
  expect(!/\.xlsx|SIE 4|XML/.test(importText), "inga tekniska filformat i primärvyn");
  await clickButton(page, /Vilka filer fungerar\?/);
  await waitText(page, /SIE-fil/);
  ok("Vilka filer fungerar? visar mer information på begäran");

  const input = await page.$("[data-import-file-input]");
  if (!input) fail("filväljaren saknas");
  await (input as unknown as { uploadFile(...paths: string[]): Promise<void> }).uploadFile(csvPath);
  await page.waitForSelector("[data-import-card][data-import-state='ready']", { timeout: 30000 });
  const card = await bodyText(page);
  expect(/Kundregister/.test(card) && /2 kunder/.test(card), "kortet visar Kundregister • 2 kunder");
  expect(/Vi tror att dessa kolumner hör ihop/.test(card), "mappningsvyn visas");
  const nameMapping = await page.$eval("[data-import-field='name']", (el) => (el as HTMLSelectElement).value);
  expect(nameMapping === "Kundnamn", "namnkolumnen är föreslagen");
  await shot(page, "import-kort");

  await domClick(page, "[data-import-confirm-open]");
  await page.waitForSelector("[data-import-confirm]");
  ok("Importera kräver en tydlig bekräftelse");
  await domClick(page, "[data-import-run]");
  await page.waitForSelector("[data-import-card][data-import-state='done']", { timeout: 30000 });
  const done = await bodyText(page);
  expect(/är inflyttat/.test(done) && /2 kunder/.test(done), "klart först när servern sparat: 2 kunder");
  await shot(page, "import-klart");

  await (await page.$("[data-import-file-input]") as unknown as { uploadFile(...paths: string[]): Promise<void> }).uploadFile(csvPath);
  await page.waitForFunction(() => /redan inflyttad/.test(document.body.innerText), { timeout: 30000 });
  ok("samma fil igen: redan inflyttad – importeras inte två gånger");

  await page.goto(`${BASE}/kunder`, { waitUntil: "domcontentloaded" });
  await waitText(page, /Browsertest Bygg AB/);
  ok("kunden finns i kundregistret");

  await page.goto(`${BASE}/installningar?flik=kom-igang`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-setup-imports]", { timeout: 20000 });
  expect(/Kunder · kunder\.csv/.test(await bodyText(page)), "importen finns under Genomförda importer");

  console.log("\nMobil 320 px:");
  const narrow = await browser.newPage();
  await narrow.setViewport({ width: 320, height: 640, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  for (const url of ["/dev/onboarding", "/dev/onboarding?steg=2", "/kom-igang/importera", "/installningar?flik=kom-igang"]) {
    await narrow.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
    await new Promise((r) => setTimeout(r, 600));
    expect(await noHorizontalOverflow(narrow), `ingen horisontell overflow på 320 px: ${url}`);
  }
  await shot(narrow, "320-import");

  await resetDemo(page);
  await browser.close();
  console.log(`\n${step} kontroller godkända. Skärmdumpar i ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
