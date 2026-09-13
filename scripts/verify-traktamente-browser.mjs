/**
 * Verifierar traktamente som reseräkning i webbläsaren.
 *
 *   1. En inrikesresa: Göteborg, avresa 07.00, hemkomst 17.00 dagen efter,
 *      ingen fri kost, inget kvitto → Bokför.
 *   2. Ett norskt resmål: landet fylls i från förslaget och sparningen
 *      blockeras med "Utland - saknar schablon för Norge".
 *
 * Körs med:  node scripts/verify-traktamente-browser.mjs [--base http://localhost:3123]
 * Skärmbilder hamnar i SHOTS_DIR (default .shots/traktamente).
 */
import puppeteer from "puppeteer-core";
import fs from "fs";

const BASE = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "http://localhost:3123";
const CHROME = process.env.CHROME_PATH || "/usr/local/bin/google-chrome";
const OUT = (process.env.SHOTS_DIR || ".shots/traktamente").replace(/\/$/, "") + "/";
const NY = "/ekonomi/utgifter/ny?typ=traktamente";

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

function ok(pass, text) {
  if (!pass) failures += 1;
  console.log(`${pass ? "OK " : "FEL"} ${text}`);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1400, deviceScaleFactor: 2 });

async function shot(name) {
  await sleep(400);
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true });
  console.log(`  ↳ ${OUT}${name}.png`);
}

const text = () => page.evaluate(() => document.body.innerText);

/** Skriv i ett React-kontrollerat fält (tid, select) utan tangentbord. */
async function setValue(selector, value) {
  await page.evaluate(
    (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`Hittade inte ${sel}`);
      const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    selector,
    value
  );
  await sleep(150);
}

async function pickSuggestion(label) {
  await page.waitForFunction(
    (t) => [...document.querySelectorAll("[data-address-suggestions] button")].some((b) => b.innerText.includes(t)),
    { timeout: 8000 },
    label
  );
  await page.evaluate((t) => {
    [...document.querySelectorAll("[data-address-suggestions] button")].find((b) => b.innerText.includes(t)).click();
  }, label);
  await sleep(400);
}

const val = (sel) => page.evaluate((s) => document.querySelector(s)?.value ?? null, sel);

try {
  /* ---------------------------- 1. Inrikes resa ---------------------------- */
  await page.goto(BASE + NY, { waitUntil: "networkidle0" });
  await page.waitForSelector("#traktamente-resmal", { timeout: 20000 });
  await shot("01-reserakning-tom");

  const empty = await text();
  ok(!/Släpp kvittot här/.test(empty), "ingen kvittoruta på traktamente");
  ok(!/ruta 050/.test(empty), "ingen uppsats om ruta 050");
  ok(/Resmål eller arbetsort/.test(empty), "resmålsfältet finns");
  ok(/Avresa/.test(empty) && /Hemkomst/.test(empty), "avresa och hemkomst finns");
  ok(await page.$("#traktamente-avresetid"), "avresan har klockslag");
  ok(await page.$("#traktamente-frikost"), "fri kost finns");
  ok(await page.$("#traktamente-50km"), "50 km-villkoret finns");
  ok(!/Hela dagar/.test(empty) && !/Halva dagar/.test(empty), "inga dagräknare kvar");

  await page.type("#traktamente-resmal", "Göteborg", { delay: 30 });
  await pickSuggestion("Göteborg");
  ok((await val("#traktamente-resmal")) === "Göteborg", "resmålet valdes ur listan");
  ok((await val("#traktamente-land")) === "SE", "landet blev Sverige");

  await setValue("#traktamente-avresetid", "07:00");
  await setValue("#traktamente-hemkomsttid", "17:00");
  await page.type("#traktamente-anledning", "Montage hos kund", { delay: 20 });
  await page.click("#traktamente-50km");
  await sleep(300);

  const filled = await text();
  ok(/1 heldag, 1 halvdag, 1 natt/.test(filled), "dagarna räknas ur tiderna");
  ok(
    /Hur bokförs det\? Skattefritt traktamente \(7321\) mot skuld till dig \(2893\), ingen moms\./.test(filled),
    "en rad om konteringen i stället för uppsatsen"
  );
  const amount = await page.evaluate(() => document.querySelector("[data-traktamente-belopp]")?.innerText ?? "");
  ok(/600/.test(amount), `skattefritt belopp 600 kr (visade "${amount}")`);
  const submitText = await page.evaluate(() => document.querySelector("#expense-submit")?.innerText ?? "");
  const submitEnabled = await page.evaluate(() => !document.querySelector("#expense-submit")?.disabled);
  ok(submitEnabled && /600/.test(submitText), `Bokför-knappen är aktiv (${submitText})`);
  await shot("02-se-goteborg-ifylld");

  await page.click("#expense-submit");
  await page.waitForFunction(() => location.pathname === "/ekonomi", { timeout: 20000 });
  await page.waitForFunction(() => /Traktamente/.test(document.body.innerText), { timeout: 20000 });
  await sleep(1200);
  const booked = await text();
  ok(/Traktamente/.test(booked), "utgiften ligger i registret");
  ok(/bokförd|Bokfört/.test(booked), "utgiften är bokförd");
  await shot("03-bokford-utan-kvitto");

  /* ----------------------------- 2. Norge --------------------------------- */
  await page.goto(BASE + NY, { waitUntil: "networkidle0" });
  await page.waitForSelector("#traktamente-resmal", { timeout: 20000 });
  await page.type("#traktamente-resmal", "Oslo", { delay: 30 });
  await pickSuggestion("Oslo");
  ok((await val("#traktamente-resmal")) === "Oslo, Norge", `resmålet blev "${await val("#traktamente-resmal")}"`);
  ok((await val("#traktamente-land")) === "utland", "landet blev Annat land");
  ok((await val("#traktamente-landnamn")) === "Norge", "landnamnet blev Norge");
  await page.click("#traktamente-50km");
  await sleep(300);
  const norway = await text();
  ok(/Utland - saknar schablon för Norge/.test(norway), "utlandsresan blockeras med rätt text");
  ok(!/300 kr/.test(norway.split("Hur bokförs")[0] ?? ""), "ingen tyst svensk schablon visas");
  ok(await page.evaluate(() => document.querySelector("#expense-submit")?.disabled), "Bokför är låst för Norge");
  await shot("04-norge-blockerad");
} catch (e) {
  failures += 1;
  console.log("FEL: " + (e?.message ?? e));
  await shot("99-fel");
}

console.log(failures === 0 ? "KLART - allt gick igenom" : `KLART - ${failures} fel`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
