/**
 * Browserverifiering av fakturadokumentet och utskicket (DEL B).
 *
 *   npm run dev
 *   npx tsx scripts/verify-faktura-utskick-browser.ts fixturer   # skriver .data/db.json
 *   # starta om dev-servern så JSON-lagret läser filen
 *   npx tsx scripts/verify-faktura-utskick-browser.ts
 *
 * Kontrollerar:
 *   1. ROT-faktura: maskerat personnummer och fastighetsbeteckning, skärm + PDF.
 *   2. RUT-faktura: ingen fastighetsbeteckning trots registrerad småhusbostad.
 *   3. Kund utan e-post: fakturan går att utfärda - "Ladda ner PDF" och
 *      "Markera som skickad" utan att checklistan blockerar.
 *
 * Personnumren i fixturerna är påhittade (1 januari, 12 december) och hör inte
 * till någon verklig person.
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer, { type Page } from "puppeteer-core";

const BASE = process.env.VERIFY_BASE ?? "http://localhost:3123";
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOT_DIR = process.env.VERIFY_SHOT_DIR ?? ".data/skarmbilder/faktura";
const FIXTURE_FILE = path.join(".data", "verify-faktura-fixturer.json");

const ROT_PERSONNUMMER = "19940101-3542";
const ROT_PERSONNUMMER_MASKED = "1994••••-3542";
const ROT_DESIGNATION = "Södermalm 12:34";
const RUT_PERSONNUMMER = "19771212-8765";
const RUT_PERSONNUMMER_MASKED = "1977••••-8765";
const RUT_DESIGNATION = "Kungsholmen 5:6";

interface Fixtures {
  rotInvoiceId: string;
  rotToken: string;
  rutInvoiceId: string;
  rutToken: string;
  printInvoiceId: string;
  manualInvoiceId: string;
  noEmailCustomer: string;
}

/* ------------------------------- Fixturerna ------------------------------- */

async function writeFixtures() {
  const { replaceDb, save } = await import("../src/lib/store");
  const { buildSeed } = await import("../src/lib/seed");
  const { createCustomer } = await import("../src/lib/services/customers");
  const { createInvoice, markInvoiceSentManually } = await import("../src/lib/services/invoices");
  const { requireCustomer } = await import("../src/lib/services/data");
  const { labor } = await import("../src/lib/invoices/test-db");

  replaceDb(buildSeed());

  function housing(customerId: string) {
    const locations = requireCustomer(customerId).workLocations ?? [];
    const id = locations[0]?.id;
    if (!id) throw new Error(`Kunden ${customerId} fick ingen bostad ur propertyDesignations`);
    return id;
  }

  const rotCustomer = createCustomer({
    kind: "privat",
    name: "Bo Karlsson",
    email: "bo.karlsson@example.se",
    phone: "070-555 11 22",
    address: "Ringvägen 44",
    postalCode: "118 63",
    city: "Stockholm",
    personalIdentityNumber: ROT_PERSONNUMMER,
    propertyDesignations: [ROT_DESIGNATION],
  });
  const rot = createInvoice({
    customerId: rotCustomer.id,
    type: "faktura",
    workLocationId: housing(rotCustomer.id),
    rot: { type: "rot" },
    lines: [
      labor({ description: "Snickeriarbete badrum", qty: 32, unit: "tim", unitPrice: 650 }),
      labor({ kind: "material", description: "Kakel och fix", qty: 1, unit: "st", unitPrice: 8_400 }),
      // Nollrad: ska inte renderas på dokumentet (punkt 2).
      labor({ kind: "material", description: "Framkörning", qty: 1, unit: "st", unitPrice: 0 }),
    ],
  });
  // Levererad, inte bara utfärdad: utan vald kanal flaggar sidan (med rätta)
  // ett leveransfel, och det hör inte till det de här bilderna visar.
  markInvoiceSentManually(rot.id);

  const rutCustomer = createCustomer({
    kind: "privat",
    name: "Inger Svensson",
    email: "inger.svensson@example.se",
    phone: "070-555 33 44",
    address: "Hantverkargatan 8",
    postalCode: "112 21",
    city: "Stockholm",
    personalIdentityNumber: RUT_PERSONNUMMER,
    propertyDesignations: [RUT_DESIGNATION],
  });
  const rut = createInvoice({
    customerId: rutCustomer.id,
    type: "faktura",
    workLocationId: housing(rutCustomer.id),
    rot: { type: "rut" },
    lines: [labor({ description: "Flyttstädning", qty: 8, unit: "tim", unitPrice: 600 })],
  });
  markInvoiceSentManually(rut.id);

  // Kund helt utan e-postadress: två utkast, ett per utskicksväg.
  const noEmail = createCustomer({
    kind: "privat",
    name: "Gunnar Persson",
    phone: "070-555 66 77",
    address: "Skånegatan 21",
    postalCode: "116 35",
    city: "Stockholm",
  });
  const print = createInvoice({
    customerId: noEmail.id,
    type: "faktura",
    rot: null,
    lines: [labor({ description: "Byte av köksluckor", qty: 6, unit: "tim", unitPrice: 700 })],
  });
  const manual = createInvoice({
    customerId: noEmail.id,
    type: "faktura",
    rot: null,
    lines: [labor({ description: "Montering av hylla", qty: 3, unit: "tim", unitPrice: 700 })],
  });

  save();

  const fixtures: Fixtures = {
    rotInvoiceId: rot.id,
    rotToken: rot.token,
    rutInvoiceId: rut.id,
    rutToken: rut.token,
    printInvoiceId: print.id,
    manualInvoiceId: manual.id,
    noEmailCustomer: noEmail.id,
  };
  fs.mkdirSync(path.dirname(FIXTURE_FILE), { recursive: true });
  fs.writeFileSync(FIXTURE_FILE, JSON.stringify(fixtures, null, 2), "utf8");
  console.log("ok fixturer skrivna till .data/db.json och", FIXTURE_FILE);
}

/* ------------------------------ Verifieringen ----------------------------- */

let failed = 0;
function check(name: string, ok: boolean, extra = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? ` ${extra}` : ""}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Viewport = "desktop" | "mobile";

async function verify(fixtures: Fixtures, viewports: readonly Viewport[]) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none"],
  });
  const saved: string[] = [];

  async function withViewport(label: Viewport, run: (page: Page, shot: (name: string) => Promise<void>) => Promise<void>) {
    const page = await browser.newPage();
    page.setDefaultTimeout(25_000);
    await page.setViewport(
      label === "desktop"
        ? { width: 1440, height: 1000, deviceScaleFactor: 1 }
        : { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    );
    page.on("pageerror", (err) => console.error("pageerror", err.message));
    // En öppen dialog ligger fixerad över sidan: fullPage skulle sträcka ut
    // bakgrunden och klippa dialogen. Då är vyporten den sanna bilden.
    const shot = async (name: string) => {
      const file = path.join(SHOT_DIR, `${name}-${label}.png`);
      const dialogOpen = await page.evaluate(() => !!document.querySelector('[role="dialog"]'));
      await page.screenshot({ path: file as `${string}.png`, fullPage: !dialogOpen });
      saved.push(file);
    };
    await run(page, shot);
    await page.close();
  }

  const text = (page: Page) =>
    page.evaluate(() => document.body.innerText.replace(/\u00a0/g, " ").replace(/\s+/g, " "));

  /** Hela dokumentet, inklusive RSC-payloaden – inte bara det synliga. */
  const html = (page: Page) => page.evaluate(() => document.documentElement.outerHTML);

  async function goto(page: Page, url: string) {
    await page.goto(BASE + url, { waitUntil: "networkidle0" });
    await sleep(350);
  }

  /**
   * Klickar på en knapp vars text innehåller `label`, i dialogen om `inDialog`.
   * Valkorten och bekräftelseknappen kan bära samma ord, så `last` väljer
   * knappen längst ned - bekräftelsen ligger sist i dialogen.
   */
  async function click(page: Page, label: string, inDialog = false, last = false) {
    const clicked = await page.evaluate(
      (label, inDialog, last) => {
        const root = inDialog ? document.querySelector('[role="dialog"]') : document;
        if (!root) return false;
        const matches = [...root.querySelectorAll("button, a")].filter(
          (b) => (b.textContent ?? "").trim().includes(label) && !(b as HTMLButtonElement).disabled
        );
        const el = last ? matches.at(-1) : matches[0];
        if (!el) return false;
        (el as HTMLElement).scrollIntoView({ block: "center" });
        (el as HTMLElement).click();
        return true;
      },
      label,
      inDialog,
      last
    );
    await sleep(900);
    return clicked;
  }

  for (const label of viewports) {
    await withViewport(label, async (page, shot) => {
      /* 1. ROT: maskerat personnummer + fastighetsbeteckning, skärm och PDF. */
      await goto(page, `/ekonomi/fakturor/${fixtures.rotInvoiceId}`);
      let t = await text(page);
      check(`[${label}] ROT skärm: maskerat personnummer`, t.includes(ROT_PERSONNUMMER_MASKED));
      check(`[${label}] ROT skärm: hela personnummret finns inte`, !t.includes(ROT_PERSONNUMMER));
      // Inte bara det synliga: RSC-payloaden ligger i samma HTML och skulle
      // bära hela numret om ett serverobjekt råkar följa med till en
      // klientkomponent.
      check(`[${label}] ROT skärm: hela personnummret finns inte i sidans HTML`, !(await html(page)).includes(ROT_PERSONNUMMER));
      check(`[${label}] ROT skärm: fastighetsbeteckning`, t.includes("Fastighetsbeteckning") && t.includes(ROT_DESIGNATION));
      check(`[${label}] ROT skärm: nollraden renderas inte`, !t.includes("Framkörning"));
      await shot("01-rot-faktura-skarm");

      await goto(page, `/faktura/${fixtures.rotToken}/pdf`);
      t = await text(page);
      check(`[${label}] ROT PDF: maskerat personnummer`, t.includes(ROT_PERSONNUMMER_MASKED));
      check(`[${label}] ROT PDF: hela personnummret finns inte`, !t.includes(ROT_PERSONNUMMER));
      check(`[${label}] ROT PDF: fastighetsbeteckning`, t.includes("Fastighetsbeteckning") && t.includes(ROT_DESIGNATION));
      await shot("02-rot-faktura-pdf");

      /* 2. RUT: ingen fastighetsbeteckning. */
      await goto(page, `/ekonomi/fakturor/${fixtures.rutInvoiceId}`);
      t = await text(page);
      check(`[${label}] RUT skärm: RUT-avdrag visas`, t.includes("RUT-avdrag"));
      check(`[${label}] RUT skärm: maskerat personnummer`, t.includes(RUT_PERSONNUMMER_MASKED));
      check(`[${label}] RUT skärm: ingen fastighetsbeteckning`, !t.includes("Fastighetsbeteckning") && !t.includes(RUT_DESIGNATION));
      check(`[${label}] RUT skärm: hela personnummret finns inte i sidans HTML`, !(await html(page)).includes(RUT_PERSONNUMMER));
      await shot("03-rut-faktura-ingen-beteckning");

      await goto(page, `/faktura/${fixtures.rutToken}/pdf`);
      t = await text(page);
      check(`[${label}] RUT PDF: ingen fastighetsbeteckning`, !t.includes("Fastighetsbeteckning"));
      await shot("04-rut-faktura-pdf");

      /* 3. Kund utan e-post: checklistan blockerar inte utfärdandet. */
      await goto(page, `/ekonomi/fakturor/${fixtures.printInvoiceId}`);
      t = await text(page);
      check(`[${label}] utan e-post: checklistan kräver inte e-postadress`, !/e-postadress/i.test(t));
      const sendEnabled = await page.evaluate(() =>
        [...document.querySelectorAll("button")].some(
          (b) => (b.textContent ?? "").includes("Skicka faktura") && !(b as HTMLButtonElement).disabled
        )
      );
      check(`[${label}] utan e-post: Skicka faktura är klickbar`, sendEnabled);
      await shot("05-utkast-utan-epost");

      check(`[${label}] utskicksdialogen öppnas`, await click(page, "Skicka faktura"));
      t = await text(page);
      check(
        `[${label}] dialogen erbjuder tre vägar`,
        t.includes("Mejla") && t.includes("Ladda ner PDF") && t.includes("Markera som skickad")
      );
      check(`[${label}] dialogen frågar efter adressen för mejl-valet`, t.includes("Kundens e-post"));
      await shot("06-utskicksval-tre-vagar");

      /* Ladda ner PDF: utfärdar och landar i A4-vyn. */
      check(`[${label}] väljer Ladda ner PDF`, await click(page, "Ladda ner PDF", true));
      await shot("07-utskicksval-ladda-ner-pdf");
      check(`[${label}] utfärdar och laddar ner`, await click(page, "Utfärda och ladda ner", true));
      await page.waitForFunction(() => location.pathname.includes("/pdf"), { timeout: 25_000 });
      await sleep(600);
      t = await text(page);
      check(`[${label}] PDF-vyn har ett fakturanummer`, /faktura\s*#\s*\d+/i.test(t), t.slice(0, 90));
      await shot("08-pdf-efter-utfardande");

      await goto(page, `/ekonomi/fakturor/${fixtures.printInvoiceId}`);
      t = await text(page);
      check(`[${label}] pappersfaktura: utfärdad`, t.includes("Utfärdad"));
      check(`[${label}] pappersfaktura: inget falskt leveransfel`, !t.includes("kunde inte skickas"));
      await shot("09-faktura-efter-ladda-ner-pdf");

      /* Markera som skickad. */
      await goto(page, `/ekonomi/fakturor/${fixtures.manualInvoiceId}`);
      check(`[${label}] utskicksdialogen öppnas igen`, await click(page, "Skicka faktura"));
      check(`[${label}] väljer Markera som skickad`, await click(page, "Markera som skickad", true));
      await shot("10-utskicksval-markera-som-skickad");
      check(`[${label}] markerar som skickad`, await click(page, "Utfärda och markera som skickad", true, true));
      await page.waitForFunction(() => document.body.innerText.includes("markerad som skickad"), {
        timeout: 25_000,
      });
      await sleep(500);
      t = await text(page);
      check(`[${label}] markerad som skickad: bekräftelse`, t.includes("markerad som skickad"));
      check(`[${label}] markerad som skickad: inget falskt leveransfel`, !t.includes("kunde inte skickas"));
      await shot("11-faktura-efter-markera-som-skickad");
    });
  }

  await browser.close();
  console.log(`\n${saved.length} skärmbilder:`);
  for (const file of saved) console.log("  ", path.resolve(file));
}

/* ---------------------------------- Main ---------------------------------- */

async function main() {
  const arg = process.argv[2];
  if (arg === "fixturer") {
    await writeFixtures();
    return;
  }
  if (!fs.existsSync(FIXTURE_FILE)) {
    console.error(`Saknar ${FIXTURE_FILE}. Kör först: npx tsx ${process.argv[1]} fixturer`);
    process.exit(1);
  }
  // Utskicksvägarna utfärdar fakturorna, så en vy per körning: bygg om
  // fixturerna och starta om dev-servern mellan desktop och mobil.
  const viewports: Viewport[] = arg === "desktop" || arg === "mobile" ? [arg] : ["desktop", "mobile"];
  const fixtures = JSON.parse(fs.readFileSync(FIXTURE_FILE, "utf8")) as Fixtures;
  await verify(fixtures, viewports);
  if (failed) {
    console.error(`\n${failed} kontroller underkända.`);
    process.exit(1);
  }
  console.log("\nAlla kontroller godkända.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
