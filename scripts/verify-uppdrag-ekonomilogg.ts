/**
 * Browserverifiering av den avsmalnade uppdragssidan.
 *
 *   npm run dev
 *   npx tsx scripts/verify-uppdrag-ekonomilogg.ts fixtur   # skriver .data/db.json
 *   npx tsx scripts/verify-uppdrag-ekonomilogg.ts
 *
 * Fixturen är precis det fall kravet nämner: ett uppdrag med en tidsrad och
 * en offert som ligger som utkast.
 *
 * Kontrollerar på desktop (1280x900) och mobil (375x812):
 *   1. Ingen timer, ingen dagsrapport, ingen kundvy, ingen tidslinje,
 *      ingen sektion Ändringar och tillägg, ingen sektion Foton.
 *   2. "Skapa faktura" förekommer högst en gång.
 *   3. Exakt en huvudknapp i rubriken.
 *   4. Sidan får plats på en skärm (dokumenthöjd <= viewporthöjd).
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer, { type Page } from "puppeteer-core";

const BASE = process.env.VERIFY_BASE ?? "http://localhost:3123";
const CHROME = process.env.CHROME_PATH ?? "/usr/local/bin/google-chrome";
const SHOT_DIR = process.env.VERIFY_SHOT_DIR ?? ".data/skarmbilder/uppdrag";
const FIXTURE_FILE = path.join(".data", "verify-uppdrag-fixtur.json");

let failures = 0;
function ok(label: string) {
  console.log(`  ✓ ${label}`);
}
function expect(cond: unknown, label: string) {
  if (cond) ok(label);
  else {
    failures++;
    console.log(`  ✗ ${label}`);
  }
}

/* ------------------------------- Fixturen -------------------------------- */

async function writeFixture() {
  const { replaceDb, save } = await import("../src/lib/store");
  const { buildSeed } = await import("../src/lib/seed");
  const { createCustomer } = await import("../src/lib/services/customers");
  const { createJob } = await import("../src/lib/services/jobs");
  const { createQuote } = await import("../src/lib/services/quotes");
  const { registerJobTime } = await import("../src/lib/services/job-work");

  replaceDb(buildSeed());

  const customer = createCustomer({
    kind: "privat",
    name: "Elin Nyberg",
    email: "elin.nyberg@example.se",
    phone: "070-555 88 99",
    address: "Skånegatan 78",
    postalCode: "116 37",
    city: "Stockholm",
  });

  const job = createJob({
    customerId: customer.id,
    title: "Byte av innerdörrar",
    description: "Byte av fyra innerdörrar med foder.",
  });

  registerJobTime(job.id, { hours: 6, description: "Demontering och montering av dörrar", unitPrice: 650 });

  const quote = createQuote({
    customerId: customer.id,
    jobId: job.id,
    title: "Byte av innerdörrar",
    lines: [
      {
        id: "verif-uppdrag-l1",
        kind: "arbete",
        description: "Snickeri och montering",
        qty: 14,
        unit: "tim",
        unitPrice: 650,
        vatRate: 25,
      },
    ],
    rot: null,
    paymentPlan: [],
    paymentTermsDays: 30,
    validUntil: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
    terms: "",
  });

  save();
  fs.mkdirSync(path.dirname(FIXTURE_FILE), { recursive: true });
  fs.writeFileSync(FIXTURE_FILE, JSON.stringify({ jobId: job.id, quoteId: quote.id }, null, 2));
  console.log(`Fixtur skriven: uppdrag ${job.id}, offertutkast ${quote.id} (${FIXTURE_FILE})`);
}

/* ------------------------------ Verifieringen ----------------------------- */

async function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
}

/** Vyhöjd, inte fullPage: bilden ska visa precis den skärm kravet handlar om. */
async function shot(page: Page, name: string) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const file = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file as `${string}.png` });
  console.log(`    → ${file}`);
}

// Rubriker renderas i versaler via CSS, så innerText matchas skiftlägesokänsligt.
const FORBIDDEN: [RegExp, string][] = [
  [/Starta timer|Stoppa \d\d:\d\d/i, "ingen timer"],
  [/\+1 tim/i, "ingen +1 tim"],
  [/Rapportera dagens jobb/i, "ingen dagsrapport"],
  [/Ändringar och tillägg/i, "ingen sektion Ändringar och tillägg"],
  [/Kundvy och slutunderlag/i, "ingen kundvy"],
  [/Förhandsgranska slutunderlag/i, "ingen förhandsgranskning av slutunderlaget"],
  [/Tidslinje/i, "ingen tidslinje"],
  [/\bFoton\b/i, "ingen Foton-sektion"],
  [/Inköpsreferens/i, "ingen Inköpsreferens"],
  [/Kopiera referens/i, "ingen Kopiera referens"],
  [/Fota materialköp/i, "ingen Fota materialköp"],
  [/Vidarebefordra underlag/i, "ingen Vidarebefordra-mening"],
  [/\bFV-\d+/i, "ingen FV-referens på sidan"],
];

async function check(page: Page, label: string, jobId: string, viewportHeight: number) {
  console.log(`\n${label}:`);
  await page.goto(`${BASE}/uppdrag/${jobId}`, { waitUntil: "networkidle0" });
  await page.waitForSelector("[data-job-add-entry]", { timeout: 20000 });
  const text = await bodyText(page);

  expect(/Byte av innerdörrar/.test(text), "rubriken visas");
  expect(/Elin Nyberg/.test(text), "kunden visas");
  expect(/Offerten är ett utkast - skicka den när den är klar\./.test(text), "utkastraden med bindestreck");
  expect(/Avtalat/i.test(text) && /Fakturerat/i.test(text) && /Kvar/i.test(text), "Ekonomi: Avtalat, Fakturerat, Kvar");
  expect(/Arbete och material/i.test(text), "sektionen Arbete och material");
  expect(/Demontering och montering av dörrar/.test(text), "tidsraden syns i listan");

  for (const [re, why] of FORBIDDEN) expect(!re.test(text), why);

  const invoiceCount = (text.match(/Skapa (?:slut|del)?faktura/g) ?? []).length;
  expect(invoiceCount <= 1, `Skapa faktura förekommer högst en gång (hittade ${invoiceCount})`);

  // Rubrikens åtgärder: exakt en synlig huvudknapp plus "…"-menyn.
  const header = await page.evaluate(() => {
    const menu = document.querySelector("button[aria-label='Fler åtgärder']");
    const row = menu?.closest("div")?.parentElement;
    if (!row) return null;
    const controls = Array.from(row.querySelectorAll("a, button")).filter(
      (el) => (el as HTMLElement).offsetParent !== null && el !== menu && !menu?.contains(el),
    );
    return { menus: document.querySelectorAll("button[aria-label='Fler åtgärder']").length, labels: controls.map((el) => (el.textContent ?? "").trim()) };
  });
  expect(header?.menus === 1, "exakt en …-meny");
  expect(header?.labels.length === 1, `exakt en huvudknapp (${JSON.stringify(header?.labels)})`);
  expect(header?.labels[0] === "Fortsätt offert", "huvudknappen är Fortsätt offert för ett offertutkast");

  // En skärm = inget innehåll hamnar under vykanten. Mobilens fasta bottennav
  // ligger över sidan, så dess höjd räknas bort från den synliga ytan.
  const fit = await page.evaluate(() => {
    const root = document.querySelector(".animate-fade-up");
    if (!root) return null;
    let bottom = 0;
    for (const el of Array.from(root.children)) {
      bottom = Math.max(bottom, el.getBoundingClientRect().bottom + window.scrollY);
    }
    const bar = Array.from(document.querySelectorAll("body *")).find((el) => {
      const box = el.getBoundingClientRect();
      return (
        getComputedStyle(el).position === "fixed" &&
        box.height > 0 &&
        // En list i underkant, inte en fast sidokolumn i full höjd.
        box.height < window.innerHeight / 3 &&
        box.bottom >= window.innerHeight - 1
      );
    });
    return {
      contentBottom: Math.round(bottom),
      visible: Math.round(window.innerHeight - (bar?.getBoundingClientRect().height ?? 0)),
    };
  });
  expect(
    fit != null && fit.contentBottom <= fit.visible,
    `sidan får plats på en skärm: innehållet slutar ${fit?.contentBottom} px, synlig yta ${fit?.visible} px av ${viewportHeight} px vy`,
  );

  // "…"-menyn: Avsluta uppdrag och Foton finns, men inte som sidyta.
  await page.click("button[aria-label='Fler åtgärder']");
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("[role='menu']")).some(
        (el) => (el as HTMLElement).offsetParent !== null,
      ),
    { timeout: 5000 },
  );
  const menuItems = await page.$$eval("[role='menu'] [role='menuitem']", (els) =>
    els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => (e.textContent ?? "").trim()),
  );
  expect(menuItems.includes("Avsluta uppdrag"), `…-menyn har Avsluta uppdrag (${JSON.stringify(menuItems)})`);
  expect(menuItems.includes("Foton"), "…-menyn har Foton");
  await page.keyboard.press("Escape");
}

async function main() {
  if (process.argv[2] === "fixtur") {
    await writeFixture();
    return;
  }
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_FILE, "utf8")) as { jobId: string };

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=sv-SE"],
  });

  const desktop = await browser.newPage();
  await desktop.setViewport({ width: 1280, height: 900 });
  await check(desktop, "Desktop 1280x900", fixture.jobId, 900);
  await shot(desktop, "uppdrag-desktop");

  const mobile = await browser.newPage();
  await mobile.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await check(mobile, "Mobil 375x812", fixture.jobId, 812);
  await shot(mobile, "uppdrag-mobil-375");

  await browser.close();
  console.log(failures === 0 ? "\nAllt grönt." : `\n${failures} kontroller underkända.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
