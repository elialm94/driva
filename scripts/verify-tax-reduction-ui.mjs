/* Verifierar ROT/RUT-villkor i offertförhandsgranskning, avstängning och fakturavarning. */
import puppeteer from "puppeteer-core";

const BASE = "http://localhost:3123";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });

async function goto(path) {
  await page.goto(BASE + path, { waitUntil: "networkidle0", timeout: 45000 });
}
async function bodyText() {
  return page.evaluate(() => document.body.innerText);
}
async function has(text) {
  return page.evaluate((t) => document.body.innerText.includes(t), text);
}
async function clickText(selector, text) {
  const clicked = await page.evaluate((sel, t) => {
    const el = [...document.querySelectorAll(sel)].find(
      (e) => (e.textContent || "").includes(t) && !e.disabled
    );
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    el.click();
    return true;
  }, selector, text);
  await sleep(400);
  return clicked;
}

let failed = 0;
function check(name, ok) {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok" : "FAIL"}  ${name}`);
}

try {
  // 1. Ny offert: välj ROT → klausul syns i formuläret
  await goto("/pengar/offerter/ny");
  await page.waitForSelector("input, textarea, button", { timeout: 20000 });
  await page.evaluate(() => {
    const title = [...document.querySelectorAll("input")].find(
      (i) => i.placeholder && i.placeholder.includes("Köksrenovering")
    );
    if (title) {
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
      proto.set.call(title, "ROT-testoffert");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  check("Klickade ROT", await clickText("button", "ROT (30 % på arbete)"));
  await sleep(300);
  check("Formuläret visar ROT/RUT-avdrag-rubrik", await has("ROT/RUT-avdrag"));
  check("Formuläret visar preliminärt villkor", await has("preliminärt och förutsätter att Skatteverket"));
  check("Formuläret säger inte rabatt", !(await has("Du får")) && !(await has("rabatt")));
  check("Summering säger Preliminärt ROT-avdrag", await has("Preliminärt ROT-avdrag"));

  check("Sparade utkast", await clickText("button", "Spara utkast"));
  await page.waitForFunction(() => location.pathname.includes("/pengar/offerter/") && !location.pathname.endsWith("/ny"), {
    timeout: 20000,
  });
  await sleep(800);

  // 2. Förhandsgranska – klausulen ska synas där kunden ser den
  check("Öppnade förhandsgranskning", await clickText("button", "Förhandsgranska & skicka"));
  await sleep(800);
  check("Preview visar ROT/RUT-avdrag", await has("ROT/RUT-avdrag"));
  check("Preview visar Skatteverket-villkor", await has("Om Skatteverket helt eller delvis nekar utbetalning"));
  check("Preview visar Preliminärt ROT-avdrag", await has("Preliminärt ROT-avdrag"));

  await page.keyboard.press("Escape");
  await sleep(400);

  // 3. BankID-kundvy via skicka + öppna länk är tungt; offertdokumentet på sidan är samma QuoteDocument
  check("Offertdokumentet på sidan har villkoret", await has("har utföraren rätt att fakturera kunden"));

  // 4. Stäng av ROT → klausulen försvinner, egna villkor kvar
  check("Öppnade redigering", await clickText("a", "Redigera"));
  await page.waitForFunction(() => location.pathname.endsWith("/redigera"), { timeout: 15000 });
  await sleep(500);
  check("Klickade Ingen", await clickText("button", "Ingen"));
  await sleep(200);
  check("Klausulen borta i formuläret efter avstängning", !(await has("preliminärt och förutsätter att Skatteverket")));
  check("Sparade utan ROT", await clickText("button", "Spara ändringar"));
  await page.waitForFunction(() => !location.pathname.endsWith("/redigera"), { timeout: 15000 });
  await sleep(800);
  const after = await bodyText();
  check("Klausulen borta på offertdokumentet", !after.includes("preliminärt och förutsätter att Skatteverket"));
  check("Egna standardvillkor kvar", after.includes("konsumenttjänstlagen"));

  // 5. Manuell ROT-faktura utan signerad offert → varning
  await goto("/pengar/fakturor/ny");
  await page.waitForSelector("button", { timeout: 20000 });
  await page.evaluate(() => {
    const desc = [...document.querySelectorAll("input")].find(
      (i) => i.placeholder && i.placeholder.includes("Vad ingår")
    );
    if (desc) {
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
      proto.set.call(desc, "Snickeriarbete");
      desc.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  check("Klickade ROT på faktura", await clickText("button", "ROT"));
  await sleep(400);
  check("Varnar att kunden inte godkänt villkor", await has("Kunden har inte godkänt något ROT/RUT-villkor i Driva"));
  check("Rekommenderar godkännande innan skick", await has("Vi rekommenderar att villkoren godkänns innan fakturan skickas"));
  check("Faktura summering Att betala nu", await has("Att betala nu"));
  check("Faktura säger Preliminärt ROT-avdrag", await has("Preliminärt ROT-avdrag"));

  check("Sparade fakturautkast", await clickText("button", "Spara utkast"));
  await page.waitForFunction(() => location.pathname.includes("/pengar/fakturor/") && !location.pathname.endsWith("/ny"), {
    timeout: 20000,
  });
  await sleep(800);
  check("Fakturasidan visar varningen", await has("Kunden har inte godkänt något ROT/RUT-villkor i Driva"));
  check("Fakturadokumentet visar kort klausul", await has("ROT/RUT är preliminärt"));
  check("Fakturadokumentet visar Att betala nu", await has("Att betala nu"));

  // 6. Befintlig skickad ROT-offert (garderob) – kundvy
  await goto("/offert/demo-anna-garderob");
  await sleep(500);
  check("Publik ROT-offert visar villkor", await has("ROT/RUT-avdrag"));
  check("Publik ROT-offert nämner Skatteverket", await has("Skatteverket"));
} catch (e) {
  failed += 1;
  console.error("FAIL  Script error:", e);
} finally {
  await browser.close();
}

if (failed > 0) {
  console.error(`\n${failed} UI-kontroller misslyckades.`);
  process.exit(1);
}
console.log("\nUI-verifiering godkänd.");
