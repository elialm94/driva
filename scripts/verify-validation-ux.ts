/**
 * Browserverifiering av valideringsmönstret ("aldrig oförklarat grå knapp").
 * Kör mot den redan startade dev-servern på :3123.
 *
 *   npx tsx scripts/verify-validation-ux.ts
 */
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:3123";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = "/tmp/driva-ux";

function fail(msg: string): never {
  console.error("FAIL", msg);
  process.exit(1);
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  page.on("dialog", (d) => d.accept());

  async function ok(name: string, cond: boolean, extra = "") {
    if (!cond) {
      await page.screenshot({ path: `${SHOTS}/FAIL.png` as `${string}.png`, fullPage: true });
      fail(`${name} ${extra} url=${page.url()}`);
    }
    console.log("ok", name, extra);
  }

  const bodyText = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  const activeId = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? `${el.id || el.tagName}${el.closest("[id]") && !el.id ? `@${(el.closest("[id]") as HTMLElement).id}` : ""}` : "";
    });
  async function clickText(selector: string, text: string) {
    const handle = await page.evaluateHandle(
      (sel, t) => {
        const els = Array.from(document.querySelectorAll<HTMLElement>(sel));
        return els.find((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim().includes(t)) ?? null;
      },
      selector,
      text
    );
    const el = handle.asElement();
    if (!el) fail(`hittar inte "${text}" i ${selector} på ${page.url()}`);
    await (el as puppeteer.ElementHandle<Element>).click();
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /* ---------------- 1. Ny offert (desktop): tomt → summering → realtid → spara ---------------- */
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/ekonomi/offerter/ny`, { waitUntil: "networkidle0" });
  await clickText("button", "Spara utkast");
  await page.waitForSelector("#offert-saknas");
  let text = await bodyText();
  await ok("1a offert: summering visas med Rubrik", /uppgifter saknas/.test(text) && text.includes("Rubrik"));
  // Kund är förvald (autofyllt räknas) – första saknade fältet är Rubrik.
  await ok("1b offert: första saknade fältet (Rubrik) fokuserat", (await activeId()).includes("offert-rubrik"));
  await page.screenshot({ path: `${SHOTS}/offert-summary.png` as `${string}.png`, fullPage: false });

  const countBefore = await page.evaluate(() => document.querySelectorAll("#offert-saknas li").length);
  await page.type("#offert-rubrik", "UX-test altan");
  await sleep(150);
  const countAfter = await page.evaluate(() => document.querySelectorAll("#offert-saknas li").length);
  await ok("1c offert: rubrik ifylld → posten försvinner i realtid", countAfter === countBefore - 1, `${countBefore}→${countAfter}`);

  // Klick på radposten i summeringen fokuserar första radens beskrivning.
  await clickText("#offert-saknas button", "prisrad");
  await sleep(400);
  await ok("1d offert: summeringsklick fokuserar radfältet", (await activeId()).includes("-beskrivning"));

  // Fyll raden → spara fungerar.
  const descSel = '[id^="rad-"][id$="-beskrivning"]';
  await page.type(descSel, "Montering av altan");
  const priceSel = '[id^="rad-"][id$="-pris"]';
  await page.click(priceSel, { clickCount: 3 });
  await page.type(priceSel, "45000");
  await sleep(150);
  const gone = await page.$("#offert-saknas");
  await ok("1e offert: allt ifyllt → summeringen borta (ingen brus)", gone === null);
  await clickText("button", "Spara utkast");
  await page.waitForFunction(() => /\/ekonomi\/offerter\/(?!ny)[\w-]+/.test(location.pathname));
  await ok("1f offert: utkast sparades och landar på detaljsidan", true, page.url());

  /* ---------------- 2. Offertdetalj: skicka-flödet är oförändrat, ingen checklista i onödan ---------------- */
  text = await bodyText();
  await ok("2a offertdetalj: ingen 'Innan offerten kan skickas' när inget blockerar", !text.includes("Innan offerten kan skickas"));
  await clickText("button", "Skicka offert");
  await page.waitForFunction(() => document.body.innerText.includes("Skicka offert?"));
  await ok("2b offertdetalj: Skicka öppnar bekräftelsen (kund har e-post)", true);
  await clickText("button", "Avbryt");
  await sleep(300);

  /* ---------------- 3. Ny faktura: per-rad-fel + ROT-luckor med fokus ---------------- */
  await page.goto(`${BASE}/ekonomi/fakturor/ny`, { waitUntil: "networkidle0" });
  await page.type('[id^="rad-"][id$="-beskrivning"]', "Montör");
  await clickText("button", "Spara utkast");
  await page.waitForSelector("#faktura-saknas");
  text = await bodyText();
  await ok("3a faktura: per-rad-post 'Pris på raden ”Montör”'", text.includes("Pris på raden ”Montör”"));
  await page.click('[id^="rad-"][id$="-pris"]', { clickCount: 3 });
  await page.type('[id^="rad-"][id$="-pris"]', "800");
  await sleep(150);
  text = await bodyText();
  await ok("3b faktura: pris ifyllt → radposten borta i realtid", !text.includes("Pris på raden ”Montör”"));

  await clickText("button", "ROT");
  await sleep(300);
  text = await bodyText();
  await ok(
    "3c ROT: bara faktiska luckor listas (personnummer prefyllt ⇒ arbetsperiod, bostadstyp)",
    /uppgifter saknas för ROT-ansökan/.test(text) && text.includes("Arbetsperiod") && text.includes("Bostadstyp")
  );
  await clickText("button", "Arbetsperiod");
  await sleep(400);
  await ok(
    "3d ROT: luck-klick fokuserar arbetsperiodfältet",
    await page.evaluate(() => !!document.activeElement?.closest("#rot-arbetsperiod"))
  );
  await page.screenshot({ path: `${SHOTS}/faktura-rot.png` as `${string}.png`, fullPage: false });

  /* ---------------- 4. Ny kund-modal: fältfel + fokus i stället för bubbla ---------------- */
  await page.click('#faktura-kund button[role="combobox"]');
  await page.waitForSelector('ul[role="listbox"]');
  await clickText("button", "Skapa ny kund");
  await page.waitForSelector("#ny-kund-namn");
  await clickText("button", "Spara kund");
  await page.waitForSelector("#ny-kund-namn-fel");
  text = await bodyText();
  await ok("4a ny kund: fältfel för namn + e-post", text.includes("Ange kundens namn.") && text.includes("Ange kundens e-postadress."));
  await ok("4b ny kund: första ogiltiga fältet fokuserat", (await activeId()).includes("ny-kund-namn"));
  await page.screenshot({ path: `${SHOTS}/ny-kund-fel.png` as `${string}.png` });
  await clickText("button", "Avbryt");
  await sleep(200);

  /* ---------------- 5. Inställningar: trasigt orgnr → fältfel + summering, rättas i realtid ---------------- */
  await page.goto(`${BASE}/installningar`, { waitUntil: "networkidle0" });
  text = await bodyText();
  await ok("5a inställningar: oförändrat läge förklaras ('Inga osparade ändringar.')", text.includes("Inga osparade ändringar."));
  await page.click("#installningar-orgNumber", { clickCount: 3 });
  await page.type("#installningar-orgNumber", "123");
  await clickText("button", "Spara ändringar");
  await page.waitForSelector("#installningar-orgNumber-fel");
  text = await bodyText();
  await ok(
    "5b inställningar: fältfel + summering 'behöver rättas'",
    text.includes("NNNNNN-NNNN") && text.includes("behöver rättas")
  );
  await page.screenshot({ path: `${SHOTS}/installningar-orgnr.png` as `${string}.png` });
  await page.click("#installningar-orgNumber", { clickCount: 3 });
  await page.type("#installningar-orgNumber", "5591234567");
  await sleep(150);
  const fixed = await page.$("#installningar-saknas");
  await ok("5c inställningar: rättat orgnr → summeringen borta i realtid", fixed === null);

  /* ---------------- 6. Mobil 390: summering nära knappen, tap fokuserar ---------------- */
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${BASE}/ekonomi/offerter/ny`, { waitUntil: "networkidle0" });
  await clickText("button", "Spara utkast");
  await page.waitForSelector("#offert-saknas");
  const nearCta = await page.evaluate(() => {
    const summary = document.getElementById("offert-saknas");
    const buttons = Array.from(document.querySelectorAll("button"));
    const cta = buttons.find((b) => (b.textContent ?? "").includes("Spara utkast"));
    if (!summary || !cta) return false;
    const s = summary.getBoundingClientRect();
    const c = cta.getBoundingClientRect();
    return Math.abs(c.top - s.bottom) < 120; // summeringen sitter intill knappen
  });
  await ok("6a mobil: summeringen sitter intill CTA:n", nearCta);
  await clickText("#offert-saknas button", "Rubrik");
  await sleep(600);
  const focusedMobile = await activeId();
  const visible = await page.evaluate(() => {
    const el = document.getElementById("offert-rubrik");
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight;
  });
  await ok("6b mobil: tap på 'Rubrik' rullar till och fokuserar fältet", focusedMobile.includes("offert-rubrik") && visible, focusedMobile);
  await page.screenshot({ path: `${SHOTS}/mobil-offert.png` as `${string}.png` });

  await browser.close();
  console.log("\nAlla browserkontroller gick igenom.");
}

main().catch((e) => fail(String(e)));
