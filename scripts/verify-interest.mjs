/* Verifierar dröjsmålsränta: fält i offert-/fakturaformulär + text i kunddokumenten. */
import puppeteer from "puppeteer-core";
import fs from "fs";

const BASE = "http://localhost:3123";
const OUT = new URL("../.shots/", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

async function shot(name) {
  await sleep(300);
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log(`  ↳ ${OUT}${name}.png`);
}
async function goto(path) {
  await page.goto(BASE + path, { waitUntil: "networkidle0", timeout: 30000 });
}
async function has(text) {
  return page.evaluate((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), text);
}
async function clickText(selector, text) {
  await page.evaluate((sel, t) => {
    const el = [...document.querySelectorAll(sel)].find(
      (e) => (e.textContent || "").toLowerCase().includes(t.toLowerCase()) && !e.disabled
    );
    if (el) { el.scrollIntoView({ block: "center" }); el.click(); }
  }, selector, text);
  await sleep(500);
}

try {
  // Färsk demodata så seedade dokument har fältet
  await goto("/");
  await clickText("button", "Återställ demo");
  await sleep(1500);

  // 1. Offertformuläret har fältet med standardvärde 10
  await goto("/ekonomi/offerter/ny");
  console.log((await has("Dröjsmålsränta (% per år)")) ? "OK  Fält i offertformuläret" : "FEL Fält saknas i offertformuläret");
  await page.evaluate(() => {
    [...document.querySelectorAll("label")]
      .find((l) => l.textContent.includes("Dröjsmålsränta"))
      ?.scrollIntoView({ block: "center" });
  });
  await shot("36-offert-drojsmalsranta");

  // 2. Fakturaformuläret har fältet
  await goto("/ekonomi/fakturor/ny");
  console.log((await has("Dröjsmålsränta (%)")) ? "OK  Fält i fakturaformuläret" : "FEL Fält saknas i fakturaformuläret");

  // 3. Kundens offert visar villkorstexten
  await goto("/offert/demo-brf-dorrar");
  console.log(
    (await has("dröjsmålsränta med 10 % per år"))
      ? "OK  Offertdokumentet visar dröjsmålsräntan"
      : "FEL Offertdokumentet saknar dröjsmålsräntan"
  );

  // 4. Kundens faktura visar texten i betalningsrutan
  await goto("/faktura/demo-f1042");
  console.log(
    (await has("dröjsmålsränta med 10 % per år"))
      ? "OK  Fakturadokumentet visar dröjsmålsräntan"
      : "FEL Fakturadokumentet saknar dröjsmålsräntan"
  );
  await page.evaluate(() => {
    [...document.querySelectorAll("p")]
      .find((p) => p.textContent.includes("dröjsmålsränta"))
      ?.scrollIntoView({ block: "center" });
  });
  await shot("37-faktura-drojsmalsranta");

  // 5. Signeringsunderlag för seedad godkänd offert är fortfarande giltigt
  await goto("/offert/demo-anna-kok/underlag");
  console.log(
    (await has("Dokumentet är oförändrat sedan signeringen"))
      ? "OK  Hashverifiering intakt med nya fältet"
      : "FEL Hashverifiering bruten"
  );
  console.log("KLART");
} catch (e) {
  console.log("FEL: " + e.message);
  await shot("96-fel-ranta");
}
await browser.close();
