/* Verifierar adress-autocomplete i Ny kund-modalen (demo-läge utan API-nyckel). */
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
async function waitText(text, timeout = 10000) {
  await page.waitForFunction((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), { timeout }, text);
}
async function clickText(selector, text) {
  const clicked = await page.evaluate((sel, t) => {
    const el = [...document.querySelectorAll(sel)].find(
      (e) => (e.textContent || "").toLowerCase().includes(t.toLowerCase()) && !e.disabled
    );
    if (el) { el.scrollIntoView({ block: "center" }); el.click(); return true; }
    return false;
  }, selector, text);
  if (!clicked) throw new Error(`Hittade inte "${text}"`);
  await sleep(400);
}

try {
  await page.goto(BASE + "/kunder", { waitUntil: "networkidle0" });
  await clickText("button", "Ny kund");
  await waitText("Spara kund");

  await page.type('input[name="name"]', "Adam Larsson");
  await page.type('input[name="email"]', "adam@gmail.com");
  await page.type('input[name="phone"]', "0708379821");

  // Skriv i adressfältet → förslag ska dyka upp
  await page.type('input[name="address"]', "Vädurs", { delay: 40 });
  await waitText("141 43 Huddinge", 6000);
  await shot("33-adress-forslag");

  // Välj förslaget → postnummer + ort ska fyllas i
  await clickText('[role="option"] button, [role="listbox"] button', "Vädursvägen 13");
  await sleep(600);
  const values = await page.evaluate(() => ({
    address: document.querySelector('input[name="address"]')?.value,
    postalCode: document.querySelector('input[name="postalCode"]')?.value,
    city: document.querySelector('input[name="city"]')?.value,
  }));
  console.log("Ifyllt:", JSON.stringify(values));
  if (values.address === "Vädursvägen 13" && values.postalCode === "141 43" && values.city === "Huddinge") {
    console.log("OK  Postnummer och ort autofylldes från adressen");
  } else {
    console.log("FEL Autofyllning stämmer inte");
  }
  await shot("34-adress-ifylld");

  // Spara och verifiera kunddetaljen
  await clickText("button", "Spara kund");
  await page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }).catch(() => {});
  await waitText("Adam Larsson", 10000);
  (await page.evaluate(() => document.body.innerText.includes("Vädursvägen 13, 141 43 Huddinge")))
    ? console.log("OK  Kunddetalj visar adress med postnummer och ort")
    : console.log("FEL Kunddetalj saknar fullständig adress");
  await shot("35-kund-sparad");
  console.log("KLART");
} catch (e) {
  console.log("FEL: " + e.message);
  await shot("97-fel-adress");
}
await browser.close();
