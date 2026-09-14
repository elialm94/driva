import { mkdirSync } from "node:fs";
import puppeteer, { type Page } from "puppeteer-core";

/**
 * Webbläsarpass för representationens bekräftelsesteg på :3123.
 *
 *   1. Ekonomi -> Utgifter: Grand Hôtel-raden frågar vad betalningen gällde.
 *   2. Svaret "Kundrepresentation" bokför ingenting - det öppnar formuläret
 *      med sorts representation, antal personer och alkohol.
 *   3. Ifyllt svar bokför uppdelningen, och verifikationen bär samma
 *      klarspråksförklaring som Ny utgift ger.
 *
 *   npx tsx scripts/verify-representation-browser.ts
 */

const BASE = "http://localhost:3123";
const CHROME = process.env.CHROME_PATH ?? "/usr/local/bin/google-chrome";
const SHOTS = process.env.SHOTS_DIR ?? ".shots/representation";

function ok(name: string, detail = "") {
  console.log(`ok  ${name}${detail ? `  - ${detail}` : ""}`);
}
function fail(msg: string): never {
  console.error("FAIL", msg);
  process.exit(1);
}

async function resetSeed() {
  const res = await fetch(`${BASE}/api/dev/reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "seed" }),
  });
  if (!res.ok) fail(`kunde inte återställa demodata: ${res.status}`);
}

async function clickText(page: Page, selector: string, text: string): Promise<boolean> {
  const handles = await page.$$(selector);
  for (const h of handles) {
    const label = (await h.evaluate((el) => el.textContent ?? "")).trim();
    if (label === text) {
      await h.click();
      return true;
    }
  }
  return false;
}

async function shot(page: Page, name: string) {
  // Modalen tonar in, och skärmbilden ska visa den färdiga vyn.
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  ok(`skärmbild ${name}.png`);
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  await resetSeed();

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    defaultViewport: { width: 1280, height: 1000 },
  });
  const page = await browser.newPage();

  await page.goto(`${BASE}/ekonomi?flik=utgifter`, { waitUntil: "networkidle0" });
  const question = await page.evaluate(() =>
    document.body.innerText.includes("Vad gällde betalningen på 4 250 kr till Grand Hôtel?")
  );
  if (!question) fail("hittade inte bokföringsfrågan för Grand Hôtel");
  ok("frågan står på utgiftsraden");
  await shot(page, "1-fragan-i-utgifter");

  if (!(await clickText(page, "button", "Kundrepresentation"))) fail("hittade inte svaret Kundrepresentation");
  await page.waitForSelector("[data-representation-answer]", { timeout: 10_000 });
  ok("svaret bokför inte - formuläret öppnas i stället");
  await shot(page, "2-bekraftelsesteget");

  const personsInput = await page.$('[data-representation-answer] input[aria-label="Antal personer"]');
  if (!personsInput) fail("hittade inte fältet Antal personer");
  await personsInput.click({ count: 3 });
  await personsInput.type("4");
  if (!(await clickText(page, '[data-representation-answer] [role="radio"] span', "Måltid med kund"))) {
    const kinds = await page.$$('[data-representation-answer] [role="radio"]');
    await kinds[0]?.click();
  }
  const alcohol = await page.$('[data-representation-answer] input[type="checkbox"]');
  await alcohol?.click();
  const participants = await page.$$('[data-representation-answer] input:not([type="checkbox"])');
  await participants[1]?.type("Anna Berg (Bergs Bygg), jag");
  await participants[2]?.type("genomgång av offert Villa Ek");
  await shot(page, "3-ifyllt-svar");

  if (!(await clickText(page, "button", "Bokför representationen"))) fail("hittade inte knappen Bokför representationen");
  await page.waitForFunction(() => !document.querySelector("[data-representation-answer]"), { timeout: 15_000 });
  ok("svaret bokfördes");

  await page.goto(`${BASE}/ekonomi?flik=utgifter`, { waitUntil: "networkidle0" });
  const bookedRow = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("tr, li, article"));
    const row = rows.find((el) => (el.textContent ?? "").includes("Grand Hôtel"));
    return (row?.textContent ?? "").replace(/\s+/gu, " ").trim();
  });
  if (!/Bokfört/.test(bookedRow)) fail(`utgiftsraden är inte bokförd: ${bookedRow}`);
  ok("utgiftsraden är bokförd", bookedRow.slice(0, 120));
  await shot(page, "4-utgiften-bokford");

  await page.goto(`${BASE}/bokforing/verifikationer?q=Grand`, { waitUntil: "networkidle0" });
  const rows = await page.$$("button");
  for (const r of rows) {
    const t = await r.evaluate((el) => el.textContent ?? "");
    if (t.includes("Grand Hôtel")) {
      await r.click();
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 2_000));
  const text = await page.evaluate(() => document.body.innerText);
  if (!/6072/.test(text)) {
    await shot(page, "5-verifikationen-utan-6072");
    fail("verifikationen visar inte 6072");
  }
  const rule = /Kostnaden för måltider[^\n]*/u.exec(text);
  ok("verifikationen visar uppdelningen och regeln", rule ? rule[0].slice(0, 140) : "6072");
  await shot(page, "5-verifikationen");

  await browser.close();
  console.log("\nklart");
}

void main();
