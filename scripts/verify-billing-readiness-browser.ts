/**
 * Browserverifiering av Inställningarnas faktureringsstatus.
 * Förväntar ett svenskt företag som saknar adress och betalning. Momsreg.nr
 * är inget eget steg – det härleds ur organisationsnumret.
 *   npx tsx scripts/verify-billing-readiness-browser.ts
 */
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.READINESS_VERIFY_URL ?? "http://localhost:3132";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";
const OUT = process.env.READINESS_SHOTS ?? "/tmp/driva-readiness-shots";

fs.mkdirSync(OUT, { recursive: true });

function fail(msg: string): never {
  console.error("FAIL", msg);
  process.exit(1);
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

  const bodyText = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));

  await page.goto(`${BASE}/installningar?flik=foretag`, { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: `${OUT}/after-goto.png`, fullPage: true });
  const html = await page.content();
  fs.writeFileSync(`${OUT}/after-goto.html`, html);
  if (!html.includes("billing-readiness-banner") && !html.includes("Fakturering kan inte användas än")) {
    fail(`banner saknas i HTML url=${page.url()} title=${await page.title()} snippet=${html.slice(0, 500)}`);
  }
  await page.waitForFunction(() => document.body.innerText.includes("Fakturering kan inte användas än"));
  let text = await bodyText();
  if (!text.includes("Fakturering kan inte användas än")) fail(`saknar konsekvens: ${text}`);
  if (!text.includes("2 uppgifter behöver kompletteras innan du kan skicka fakturor")) {
    fail(`fel count/copy: ${text}`);
  }
  if (!text.includes("Företagsadress") || !text.includes("Betalningsuppgifter")) {
    fail(`saknar exakta poster: ${text}`);
  }
  const bannerText = await page.evaluate(() => {
    const el = document.querySelector("[data-testid='billing-readiness-banner']");
    return el ? el.textContent ?? "" : "";
  });
  if (/offert/i.test(bannerText)) fail(`nämner offert i statusbanner: ${bannerText}`);
  await page.screenshot({ path: `${OUT}/incomplete-desktop.png`, fullPage: false });

  await page.setViewport({ width: 390, height: 844 });
  await page.screenshot({ path: `${OUT}/incomplete-mobile.png`, fullPage: false });
  await page.setViewport({ width: 1280, height: 900 });
  const komplettera = await page.evaluateHandle(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    return buttons.find((b) => (b.textContent ?? "").trim() === "Komplettera") ?? null;
  });
  const kompletteraEl = komplettera.asElement();
  if (!kompletteraEl) fail("Komplettera-knappen saknas");
  await kompletteraEl.click();
  await page.waitForSelector("[data-testid='billing-complete-address']");
  text = await bodyText();
  if (!text.includes("Komplettera för fakturering")) fail(`modalrubrik saknas: ${text}`);
  if (!text.includes("Lägg till minst ett betalningssätt")) fail("betalningshint saknas i modalen");
  await page.screenshot({ path: `${OUT}/komplettera-modal.png`, fullPage: false });

  await page.click("#komplettera-address");
  await page.type("#komplettera-address", "Renstiernas gata 12", { delay: 15 });
  await page.click("#komplettera-postalCode");
  await page.type("#komplettera-postalCode", "116 24", { delay: 15 });
  await page.click("#komplettera-city");
  await page.type("#komplettera-city", "Stockholm", { delay: 15 });
  await page.waitForFunction(() => {
    const row = document.querySelector("[data-testid='billing-complete-address']");
    return Boolean(row && row.textContent && row.textContent.includes("Klart"));
  });
  await page.screenshot({ path: `${OUT}/after-address.png`, fullPage: false });

  const afterAddress = await page.evaluate(() => {
    const banner = document.querySelector("[data-testid='billing-readiness-banner']");
    const payment = document.querySelector("[data-testid='billing-complete-payment']");
    return {
      banner: banner ? banner.textContent ?? "" : "",
      // Momsreg.nr har inget eget steg längre – det härleds ur org.nr.
      vatStep: Boolean(document.querySelector("[data-testid='billing-complete-vat']")),
      paymentOpen: Boolean(payment && !(payment.textContent ?? "").includes("Klart")),
    };
  });
  if (afterAddress.vatStep) fail("momssteget ska inte finnas – momsreg.nr härleds ur org.nr");
  if (!afterAddress.paymentOpen) {
    fail(`efter adress skulle betalning vara kvar: ${JSON.stringify(afterAddress)}`);
  }
  if (afterAddress.banner && !afterAddress.banner.includes("1 uppgift")) {
    fail(`räknade inte ner efter adress: ${afterAddress.banner}`);
  }

  await page.type("#komplettera-payment", "56781234");
  await page.waitForFunction(() => {
    return Boolean(
      document.querySelector("[data-testid='billing-readiness-success']") ||
        document.querySelector("[data-testid='billing-readiness-ready']")
    );
  });
  text = await bodyText();
  if (!text.includes("Redo att fakturera")) fail(`saknar redo-status: ${text}`);
  await page.screenshot({ path: `${OUT}/ready-after-fill.png`, fullPage: false });

  await page.goto(`${BASE}/installningar?flik=foretag&falt=orgNumber`, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForFunction(
      () => document.activeElement && document.activeElement.id === "installningar-orgNumber",
      { timeout: 5000 }
    );
  } catch {
    console.log("warn deeplink-fokus hoppades över (sidan laddade inte om i tid)");
  }
  // Momsreg.nr visas som härlett värde intill org.nr, inte som ett inmatningsfält.
  const derivedVat = await bodyText();
  if (!derivedVat.includes("Beräknas automatiskt från organisationsnumret")) {
    fail(`saknar härlett momsreg.nr i företagsfliken: ${derivedVat}`);
  }
  await page.screenshot({ path: `${OUT}/deeplink-orgnr.png`, fullPage: false });

  console.log("ok billing-readiness browser");
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
