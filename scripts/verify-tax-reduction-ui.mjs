/* Verifierar ROT/RUT-villkor, progressiv visning och att BankID inte krävs för faktura. */
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
  await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 45000 });
  await sleep(400);
}
async function bodyText() {
  return page.evaluate(() => document.body.innerText);
}
async function has(text) {
  return page.evaluate((t) => document.body.innerText.includes(t), text);
}
async function inputValues() {
  return page.evaluate(() =>
    [...document.querySelectorAll("input, textarea")].map((el) => el.value).join("\n")
  );
}
async function hasInput(text) {
  return (await inputValues()).includes(text);
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
  await goto("/ekonomi/offerter/ny");
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
  await page.waitForFunction(() => location.pathname.includes("/ekonomi/offerter/") && !location.pathname.endsWith("/ny"), {
    timeout: 20000,
  });
  await sleep(800);

  // 2. Offertdetaljen är förhandsvisningen – klausulen ska synas på dokumentet
  check("Ingen extra förhandsgranskning", !(await has("Förhandsgranska & skicka")));
  check("Primär CTA är Skicka offert", await has("Skicka offert"));
  check("Offertdokumentet visar ROT/RUT-avdrag", await has("ROT/RUT-avdrag"));
  check("Offertdokumentet visar Skatteverket-villkor", await has("Om Skatteverket helt eller delvis nekar utbetalning"));
  check("Offertdokumentet visar Preliminärt ROT-avdrag", await has("Preliminärt ROT-avdrag"));
  check("Offertdokumentet har villkoret", await has("har utföraren rätt att fakturera kunden"));

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
  await goto("/ekonomi/fakturor/ny");
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
  check("Ingen BankID-varning på ROT-faktura", !(await has("Kunden har inte godkänt något ROT/RUT-villkor i Driva")));
  check("Ingen rekommendation om BankID innan skick", !(await has("Villkoren är inte avtalade via BankID")));
  check("Tom ROT-faktura skriker inte om saknad uppgift", !(await has("En uppgift saknas för ROT")));
  check("ROT-formuläret är inte en stor uppgiftssektion", !(await has("Uppgifter för ROT")));
  check("ROT har ingen adressruta", !(await has("Adress där arbetet utförts")));
  check("ROT visar beräkning först", (await has("Arbetskostnad")) && (await has("Preliminärt ROT-avdrag")) && (await has("Att betala")));
  check("ROT-editorn har diskret preliminärt-hint", await has("Avdraget är preliminärt"));
  check("ROT-editorn domineras inte av lång disclaimer", !(await has("förutsätter att Skatteverket")));
  check("ROT döljer utförandedatum när period finns", !(await has("Utförandedatum")));
  check("ROT visar bostadstyp när den saknas", await has("Fastighet/småhus") && (await has("Bostadsrätt")));
  check("Faktura summering Att betala nu", await has("Att betala nu"));
  check("Faktura har Hur räknas detta", await has("Hur räknas detta?"));
  check("Känd kund visar maskat personnummer", await has("1985••••-1234"));
  check("Känd kund har inte personnummer i input", !(await hasInput("19850515-1234")));

  check("Klickade RUT", await clickText("button", "RUT"));
  await sleep(200);
  check("RUT-formuläret är inte en stor uppgiftssektion", !(await has("Uppgifter för RUT")));
  check("RUT döljer fastighetsbeteckning", !(await has("Fastighetsbeteckning")));
  check("RUT döljer BRF-fält", !(await has("BRF organisationsnummer")));
  check("RUT döljer bostadstyp", !(await has("Fastighet/småhus")));

  check("Klickade ROT igen", await clickText("button", "ROT"));
  await sleep(200);
  check("Klickade Bostadsrätt", await clickText("button", "Bostadsrätt"));
  await sleep(200);
  check("Bostadsrätt visar BRF+lgh", (await has("BRF organisationsnummer")) && (await has("Lägenhetsnummer")));
  check("Bostadsrätt döljer fastighetsbeteckning", !(await has("Fastighetsbeteckning")));
  const openedDwelling = await page.evaluate(() => {
    const row = [...document.querySelectorAll("p")].find((e) => (e.textContent || "").includes("Bostadstyp"));
    const btn = row?.querySelector("button");
    if (!btn) return false;
    btn.click();
    return true;
  });
  await sleep(200);
  check("Öppnade bostadstyp för byte", openedDwelling);
  check("Klickade Fastighet/småhus", await clickText("button", "Fastighet/småhus"));
  await sleep(200);
  check("Småhus visar fastighetsbeteckning", await has("Fastighetsbeteckning"));
  check("Småhus döljer BRF", !(await has("BRF organisationsnummer")));

  check("Klickade Ingen", await clickText("button", "Ingen"));
  await sleep(200);
  check("Ingen döljer ROT-hint", !(await has("Avdraget är preliminärt")));
  check("Ingen döljer personnummer-fält", !(await has("Personnummer")));
  check("Ingen har ingen varning", !(await has("Kunden har inte godkänt")));
  check("Ingen visar utförandedatum igen", await has("Utförandedatum"));

  check("Klickade ROT för att spara", await clickText("button", "ROT"));
  await sleep(200);

  check("Sparade fakturautkast", await clickText("button", "Spara utkast"));
  await page.waitForFunction(() => location.pathname.includes("/ekonomi/fakturor/") && !location.pathname.endsWith("/ny"), {
    timeout: 20000,
  });
  await sleep(800);
  check("Fakturasidan visar inte BankID-varning", !(await has("Kunden har inte godkänt något ROT/RUT-villkor i Driva")));
  check("Fakturadokumentet visar kort klausul", await has("ROT/RUT är preliminärt"));
  check("Fakturadokumentet visar Att betala nu", await has("Att betala nu"));

  // Prefill från Köksrenovering
  await goto("/ekonomi/fakturor/ny?job=job-kok");
  await page.waitForSelector("button", { timeout: 20000 });
  check("Köksrenovering: klickade ROT", await clickText("button", "ROT"));
  await sleep(400);
  check("Köksrenovering har ingen adressruta", !(await has("Adress där arbetet utförts")));
  check("Köksrenovering prefillar inte adress i input", !(await hasInput("Folkungagatan")));
  check("Köksrenovering visar maskat personnummer", await has("1985••••-1234"));
  check("Köksrenovering har inte personnummer i input", !(await hasInput("19850515-1234")));
  check("Köksrenovering visar arbetsperiod som sammanfattning", await has("Arbetsperiod:"));
  check("Köksrenovering har Ändra för kända fält", await has("Ändra"));
  check("Köksrenovering saknar bara fastighetsbeteckning", await has("Fastighetsbeteckning"));
  check("Köksrenovering soft-hint för ansökan", await has("Fastighetsbeteckning saknas för ROT-ansökan"));
  check("Köksrenovering visar beräkning", await has("Preliminärt ROT-avdrag"));
  check("Köksrenovering ingen BankID-varning", !(await has("Kunden har inte godkänt något ROT/RUT-villkor")));

  check("Köksrenovering: klickade RUT", await clickText("button", "RUT"));
  await sleep(300);
  check("RUT med känt PN och period är komplett", await has("Alla uppgifter finns"));
  check("RUT från uppdrag döljer fastighetsbeteckning", !(await has("Fastighetsbeteckning")));

  check("Köksrenovering: ROT igen för att spara bostad", await clickText("button", "ROT"));
  await sleep(200);
  await page.evaluate(() => {
    const desc = [...document.querySelectorAll("input")].find(
      (i) => i.placeholder && i.placeholder.includes("Vad ingår")
    );
    const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    if (desc) {
      proto.set.call(desc, "Snickeriarbete kök");
      desc.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const housing = [...document.querySelectorAll("input")].find(
      (i) => i.placeholder && i.placeholder.includes("Södermalm")
    );
    if (housing) {
      proto.set.call(housing, "Södermalm 12:34");
      housing.dispatchEvent(new Event("input", { bubbles: true }));
      housing.dispatchEvent(new Event("blur", { bubbles: true }));
    }
  });
  await sleep(200);
  check("Sparade ROT-faktura från uppdrag", await clickText("button", "Spara utkast"));
  await page.waitForFunction(() => location.pathname.includes("/ekonomi/fakturor/") && !location.pathname.endsWith("/ny"), {
    timeout: 20000,
  });
  await sleep(600);

  await goto("/ekonomi/fakturor/ny?job=job-kok");
  await page.waitForSelector("button", { timeout: 20000 });
  check("Andra fakturan: klickade ROT", await clickText("button", "ROT"));
  await sleep(400);
  check("Andra fakturan har alla uppgifter", await has("Alla uppgifter finns"));
  check("Andra fakturan döljer fastighetsbeteckning-input", !(await has("Fastighetsbeteckning saknas")));

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await sleep(300);
  check("Mobil 390: beräkning syns", await has("Preliminärt ROT-avdrag"));
  check("Mobil 390: diskret hint syns", await has("Avdraget är preliminärt"));
  check("Mobil 390: ingen adressruta", !(await has("Adress där arbetet utförts")));

  // Publik kundvy verifieras redan via offertdokumentet ovan (samma klausul).
  // /offert/[token] kan hänga om ett annat flöde redigerar den sidan parallellt.
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
