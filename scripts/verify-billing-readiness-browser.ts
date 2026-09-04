/**
 * Browserverifiering av Komplettera för fakturering: persist/stäng.
 *   npx tsx scripts/verify-billing-readiness-browser.ts
 */
import fs from "node:fs";
import puppeteer, { type Page } from "puppeteer-core";

const BASE = process.env.READINESS_VERIFY_URL ?? "http://localhost:3123";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";
const OUT = process.env.READINESS_SHOTS ?? "/tmp/driva-readiness-shots";

fs.mkdirSync(OUT, { recursive: true });

function fail(msg: string): never {
  console.error("FAIL", msg);
  process.exit(1);
}

async function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
}

async function setInput(page: Page, selector: string, value: string) {
  await page.waitForSelector(selector);
  await page.$eval(
    selector,
    (el, next) => {
      const input = el as HTMLInputElement;
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
      proto?.set?.call(input, next);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    value
  );
}

async function clickButton(page: Page, label: string) {
  const handle = await page.evaluateHandle((wanted) => {
    const buttons = Array.from(document.querySelectorAll("button"));
    return buttons.find((b) => (b.textContent ?? "").trim() === wanted) ?? null;
  }, label);
  const el = handle.asElement();
  if (!el) fail(`knapp saknas: ${label}`);
  await el.click();
}

async function modalOpen(page: Page): Promise<boolean> {
  return page.evaluate(() => Boolean(document.querySelector("[data-testid='billing-complete-modal']")));
}

async function saveSettings(page: Page) {
  const clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const save = buttons.find((b) => /Spara ändringar/.test(b.textContent ?? ""));
    if (!save || save.disabled) return false;
    save.click();
    return true;
  });
  if (clicked) {
    await page.waitForFunction(
      () => {
        const t = document.body.innerText;
        return t.includes("Ändringarna är sparade") || t.includes("Inga osparade ändringar");
      },
      { timeout: 15000 }
    );
  }
}

async function ensureIncomplete(page: Page) {
  await page.goto(`${BASE}/installningar?flik=fakturering`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#installningar-bankgiro");
  const bankgiro = await page.$eval("#installningar-bankgiro", (el) => (el as HTMLInputElement).value);
  if (bankgiro.trim()) {
    await setInput(page, "#installningar-bankgiro", "");
    await saveSettings(page);
  }

  await page.goto(`${BASE}/installningar?flik=foretag`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#installningar-vatNumber");
  const vat = await page.$eval("#installningar-vatNumber", (el) => (el as HTMLInputElement).value);
  if (vat.trim()) {
    await setInput(page, "#installningar-vatNumber", "");
    await saveSettings(page);
  }

  await page.goto(`${BASE}/installningar?flik=foretag`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("Fakturering kan inte användas än"), {
    timeout: 15000,
  });
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--window-size=1280,900"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  await page.setViewport({ width: 1280, height: 900 });

  await ensureIncomplete(page);
  await page.screenshot({ path: `${OUT}/incomplete-banner.png`, fullPage: false });

  await clickButton(page, "Komplettera");
  await page.waitForSelector("[data-testid='billing-complete-modal']");
  let text = await bodyText(page);
  if (!text.includes("Komplettera för fakturering")) fail(`modalrubrik saknas: ${text}`);
  if (text.includes("Fyll i") || text.includes("Visa fältet")) {
    fail(`accordion-UI kvar: ${text}`);
  }
  const bothFields = await page.evaluate(() => ({
    vat: Boolean(document.querySelector("#komplettera-vat")),
    payment: Boolean(document.querySelector("#komplettera-payment")),
  }));
  if (!bothFields.vat || !bothFields.payment) fail(`båda fälten syns inte: ${JSON.stringify(bothFields)}`);
  await page.screenshot({ path: `${OUT}/modal-plain-form.png`, fullPage: false });

  const suggest = await page.$("[data-testid='billing-complete-suggest-vat']");
  if (!suggest) fail("Använd förslaget saknas");
  await suggest.click();
  if (!(await modalOpen(page))) fail("Använd förslaget stängde modalen");
  const vatAfterSuggest = await page.$eval("#komplettera-vat", (el) => (el as HTMLInputElement).value);
  if (!vatAfterSuggest.startsWith("SE")) fail(`förslag fyllde inte moms: ${vatAfterSuggest}`);
  await page.screenshot({ path: `${OUT}/after-suggestion-still-open.png`, fullPage: false });

  await page.click("#komplettera-payment");
  await page.type("#komplettera-payment", "56781234", { delay: 10 });
  await clickButton(page, "Stäng");
  await page.waitForFunction(() => !document.querySelector("[data-testid='billing-complete-modal']"));

  await page.goto(`${BASE}/installningar?flik=fakturering`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#installningar-bankgiro");
  const bankgiroAfterClose = await page.$eval("#installningar-bankgiro", (el) => (el as HTMLInputElement).value);
  if (bankgiroAfterClose.replace(/\s/g, "").length > 0) {
    fail(`Stäng utan Spara sparade bankgiro: ${bankgiroAfterClose}`);
  }
  await page.screenshot({ path: `${OUT}/after-stang-no-save.png`, fullPage: false });

  await page.goto(`${BASE}/installningar?flik=foretag`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("Fakturering kan inte användas än"));
  await clickButton(page, "Komplettera");
  await page.waitForSelector("[data-testid='billing-complete-modal']");
  const suggestAgain = await page.$("[data-testid='billing-complete-suggest-vat']");
  if (suggestAgain) await suggestAgain.click();
  else await setInput(page, "#komplettera-vat", "SE559123456701");
  await setInput(page, "#komplettera-payment", "5678-1234");
  if (!(await modalOpen(page))) fail("modalen stängdes när fälten blev giltiga, innan Spara");
  await clickButton(page, "Spara");
  await page.waitForFunction(() => !document.querySelector("[data-testid='billing-complete-modal']"), {
    timeout: 15000,
  });
  await page.waitForFunction(
    () =>
      Boolean(
        document.querySelector("[data-testid='billing-readiness-success']") ||
          document.querySelector("[data-testid='billing-readiness-ready']")
      ),
    { timeout: 15000 }
  );
  text = await bodyText(page);
  if (!text.includes("Redo att fakturera")) fail(`saknar redo-status efter Spara: ${text}`);

  const vatSaved = await page.$eval("#installningar-vatNumber", (el) => (el as HTMLInputElement).value);
  if (vatSaved.replace(/\s/g, "") !== "SE559123456701") fail(`moms sparades inte: ${vatSaved}`);
  await page.goto(`${BASE}/installningar?flik=fakturering`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#installningar-bankgiro");
  const bankgiroSaved = await page.$eval("#installningar-bankgiro", (el) => (el as HTMLInputElement).value);
  if (!/5678-?1234/.test(bankgiroSaved.replace(/\s/g, ""))) fail(`bankgiro sparades inte: ${bankgiroSaved}`);
  await page.screenshot({ path: `${OUT}/after-spara.png`, fullPage: false });

  await page.goto(`${BASE}/ekonomi/fakturor/inv-1048`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("body");
  const invoiceText = await bodyText(page);
  if (/Momsregistreringsnummer saknas|Betalningsuppgifter saknas/.test(invoiceText)) {
    fail(`faktura fortfarande blockerad av säljarfält: ${invoiceText}`);
  }
  const sendDisabled = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const send = buttons.find((b) => (b.textContent ?? "").includes("Skicka faktura"));
    return send ? send.disabled || send.getAttribute("aria-disabled") === "true" : null;
  });
  if (sendDisabled === true) {
    fail(`Skicka faktura fortfarande disabled efter Spara: ${invoiceText.slice(0, 400)}`);
  }
  await page.screenshot({ path: `${OUT}/invoice-unblocked.png`, fullPage: false });

  console.log("ok billing-readiness browser");
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
