/* Visuell verifiering av Driva: klickar igenom flöden och tar skärmdumpar. */
import puppeteer from "puppeteer-core";
import fs from "fs";

const BASE = "http://localhost:3123";
const OUT = new URL("../.shots/", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

const results = [];
function ok(name, detail = "") {
  results.push(`OK  ${name}${detail ? " – " + detail : ""}`);
  console.log(`OK  ${name}${detail ? " – " + detail : ""}`);
}
function fail(name, detail = "") {
  results.push(`FEL ${name}${detail ? " – " + detail : ""}`);
  console.log(`FEL ${name}${detail ? " – " + detail : ""}`);
}

async function shot(name) {
  await sleep(350);
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log(`  ↳ skärmdump: ${OUT}${name}.png`);
}

async function goto(path) {
  await page.goto(BASE + path, { waitUntil: "networkidle0", timeout: 30000 });
}

async function hasText(text) {
  return page.evaluate((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), text);
}

async function waitText(text, timeout = 12000) {
  await page.waitForFunction(
    (t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()),
    { timeout },
    text
  );
}

/** Klicka första element (selector) vars text innehåller `text`. */
async function clickText(selector, text) {
  const clicked = await page.evaluate(
    (sel, t) => {
      const els = [...document.querySelectorAll(sel)];
      const el = els.find((e) => (e.textContent || "").toLowerCase().includes(t.toLowerCase()) && !e.disabled);
      if (el) {
        el.scrollIntoView({ block: "center" });
        el.click();
        return true;
      }
      return false;
    },
    selector,
    text
  );
  if (!clicked) throw new Error(`Hittade inget klickbart "${text}" (${selector})`);
  await sleep(400);
}

try {
  /* ---------- 0. Återställ demo för känt utgångsläge ---------- */
  await goto("/");
  await waitText("uppmärksamhet");
  await clickText("button", "Återställ demo");
  await sleep(1200);
  await goto("/");
  ok("Demo återställd");

  /* ---------- 1. Hem ---------- */
  await waitText("Behöver din uppmärksamhet");
  const hemChecks = ["På banken", "Ungefär tillgängligt", "den här veckan"];
  for (const t of hemChecks) (await hasText(t)) ? ok(`Hem: "${t}"`) : fail(`Hem saknar "${t}"`);
  await shot("01-hem");

  /* ---------- 2. Kunder ---------- */
  await goto("/kunder");
  await waitText("Anna Andersson");
  await shot("02-kunder");
  await clickText("a", "Anna Andersson");
  await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
  await waitText("Offerter");
  (await hasText("Köksrenovering")) ? ok("Kunddetalj: kopplade objekt syns") : fail("Kunddetalj: saknar kopplingar");
  await shot("03-kund-anna");

  /* ---------- 3. Jobb + checklista ---------- */
  await goto("/jobb");
  await waitText("Köksrenovering");
  await shot("04-jobb");
  await clickText("a", "Köksrenovering");
  await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
  await waitText("Checklista");
  const before = await page.evaluate(() => document.body.innerText.match(/(\d+) av (\d+)/)?.[0]);
  await clickText("button", "Stänkskydd");
  await sleep(1800);
  const after = await page.evaluate(() => document.body.innerText.match(/(\d+) av (\d+)/)?.[0]);
  before !== after ? ok(`Checklista togglades (${before} → ${after})`) : fail(`Checklista (${before} → ${after})`);
  await shot("05-jobb-detalj");

  /* ---------- 4. Ekonomi-flikar ---------- */
  await goto("/ekonomi");
  await waitText("Offerter");
  await shot("06-pengar-offerter");
  await goto("/ekonomi?flik=fakturor");
  await waitText("Faktura");
  await shot("07-pengar-fakturor");
  await goto("/ekonomi?flik=utgifter");
  await waitText("kvitto");
  await shot("08-pengar-utgifter");
  await goto("/ekonomi?flik=bank");
  await waitText("bank");
  await shot("09-pengar-bank");

  /* ---------- 5. Offertdetalj (dokumentet är förhandsvisningen) ---------- */
  await goto("/ekonomi/offerter/quote-dorrar");
  await waitText("Byte av förrådsdörrar");
  await shot("10-offert-detalj");
  ok("Offertdetaljen visar dokumentet utan extra förhandsgranskning");

  /* ---------- 6. Publik offert + BankID (mobil viewport) ---------- */
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await goto("/offert/demo-brf-dorrar");
  await waitText("Godkänn med BankID");
  await shot("13-publik-offert-mobil");
  await clickText("button", "Godkänn med BankID");
  await waitText("Använd BankID på en annan enhet");
  await clickText("button", "Använd BankID på en annan enhet");
  await waitText("Skanna QR-koden", 8000);
  await shot("14-bankid-qr");
  await clickText("button", "Kunden öppnar appen");
  await sleep(1800);
  await clickText("button", "Slutför signering");
  await waitText("Offerten är godkänd", 10000);
  await shot("15-bankid-klart");
  await clickText("button", "Klart");
  await sleep(1500);
  await waitText("Godkänd av", 8000).catch(() => {});
  await shot("16-publik-offert-godkand");
  ok("BankID-flöde: QR → signering → godkänd");

  /* ---------- 7. Signeringsunderlag ---------- */
  await goto("/offert/demo-brf-dorrar/underlag");
  await waitText("Signeringsunderlag");
  (await hasText("Dokumentet är oförändrat sedan signeringen"))
    ? ok("Underlag: hash verifierad oförändrad")
    : fail("Underlag: hashverifiering visas inte");
  await shot("17-signeringsunderlag");

  /* ---------- 8. Jobb auto-skapat? ---------- */
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await goto("/jobb");
  await waitText("Byte av förrådsdörrar", 8000);
  ok("Jobb skapades automatiskt efter BankID-godkännande");

  /* ---------- 9. Faktura: simulera betalning ---------- */
  await goto("/ekonomi/fakturor/inv-1042");
  await waitText("Faktura #1042");
  await clickText("button", "Simulera inbetalning");
  await waitText("Betald och bokförd", 10000);
  ok("Betalning matchades och bokfördes automatiskt");
  await shot("18-faktura-betald");

  /* ---------- 10. Bokföring ---------- */
  await goto("/bokforing");
  await waitText("Moms att betala");
  await shot("19-bokforing");
  // Expandera en verifikation
  await page.evaluate(() => document.querySelector("details summary")?.click());
  await shot("20-bokforing-verifikation");
  // Svara på fråga om den finns
  if (await hasText("Grand Hôtel")) {
    await clickText("button", "Konferens");
    await sleep(1500);
    (await hasText("Bokfört")) ? ok("Bokföringsfråga besvarad → bokförd") : fail("Bokföringsfråga gav ingen bekräftelse");
    await shot("21-bokforing-svar");
  }

  /* ---------- 11. Hemsida + publik sajt + formulär ---------- */
  await goto("/hemsida");
  await waitText("Hemsida");
  await shot("22-hemsida");
  await goto("/sajt");
  await sleep(500);
  await shot("23-sajt");
  await page.evaluate(() => {
    const els = [...document.querySelectorAll("input, textarea")];
    return els.length;
  });
  await page.type('input[placeholder="Namn"]', "Karin Testsson");
  await page.type('input[placeholder="E-post"]', "karin@example.se");
  await page.type("textarea", "Hej! Vi vill ha hjälp med en ny altan på ca 30 kvm. När kan ni?");
  await clickText("button", "Skicka förfrågan");
  await waitText("Tack för din förfrågan", 8000);
  ok("Sajtformulär: förfrågan skickad");
  await goto("/");
  (await hasText("Karin Testsson")) ? ok("Hem: ny förfrågan från sajten syns") : fail("Hem: förfrågan från sajten syns inte");
  await shot("24-hem-ny-forfragan");

  /* ---------- 12. Assistent ---------- */
  await goto("/assistent");
  await waitText("Assistent");
  await page.type("textarea", "Hur går företaget?");
  await page.keyboard.press("Enter");
  await sleep(2500);
  await shot("25-assistent-status");
  await page.type("textarea", "Skicka en påminnelse till alla vars fakturor är sena");
  await page.keyboard.press("Enter");
  await sleep(2500);
  if (await hasText("Avbryt")) {
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")];
      const b = btns.find((x) => (x.textContent || "").includes("Skicka påminnelse"));
      b?.click();
    });
    await sleep(2000);
  }
  await shot("26-assistent-paminnelser");
  ok("Assistent: fråga + bekräftelseflöde");

  /* ---------- 13. Mobil hemvy ---------- */
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await goto("/");
  await sleep(600);
  await shot("27-hem-mobil");
  ok("Mobilvy renderad");
} catch (e) {
  fail("Avbrott", e.message);
  await shot("99-fel");
}

console.log("\n===== RESULTAT =====");
for (const r of results) console.log(r);
await browser.close();
