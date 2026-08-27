/* Kompletterande verifiering: offertformulär, assistentens bekräftelseflöde, mobil hemvy. */
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
  await sleep(350);
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log(`  ↳ ${OUT}${name}.png`);
}
async function goto(path) {
  await page.goto(BASE + path, { waitUntil: "networkidle0", timeout: 30000 });
}
async function waitText(text, timeout = 12000) {
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
  // Återställ demo för känt läge (försenad faktura #1042 finns igen)
  await goto("/");
  await clickText("button", "Återställ demo");
  await sleep(1500);

  // 1. Nytt offertformulär
  await goto("/pengar/offerter/ny");
  await waitText("Ny offert");
  await shot("28-offert-formular");

  // 2. Assistentens bekräftelseflöde
  await goto("/assistent");
  await page.type("textarea", "Skicka en påminnelse till alla vars fakturor är sena");
  await page.keyboard.press("Enter");
  await sleep(2500);
  await waitText("Faktura #1042", 8000);
  await shot("29-assistent-bekrafta");
  // Klicka bekräftelseknappen (rounded-xl-knapp i confirm-kortet, inte förslagschipsen)
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const b = btns.find(
      (x) => /Skicka påminnelse/i.test(x.textContent || "") && !x.className.includes("rounded-full")
    );
    b?.click();
  });
  await sleep(2500);
  await waitText("Klart!", 8000).catch(() => {});
  await shot("30-assistent-utfort");

  // 3. Mobil hemvy med nya layoutfixen
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await goto("/");
  await waitText("uppmärksamhet");
  await shot("31-hem-mobil");

  // 4. Publik offert – avböj-läge + fråga (visuellt)
  await goto("/offert/demo-anna-garderob");
  await sleep(600);
  await shot("32-publik-offert-garderob");
  console.log("KLART");
} catch (e) {
  console.log("FEL: " + e.message);
  await shot("98-fel2");
}
await browser.close();
