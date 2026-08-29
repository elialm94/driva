import puppeteer, { type Page } from "puppeteer-core";

/**
 * Webbläsarpass för påminnelser på :3123.
 *
 * Fraserna nedan går den DETERMINISTISKA snabbvägen (noll LLM-anrop, noll
 * kostnad) – LLM-vägen är separat verifierad i scripts/smoke-reminders.ts.
 *
 *   1. "Påminn mig att ringa Sara på onsdag" → svar med tolkad tid + kundkoppling.
 *   2. Framtida påminnelse syns under Hem → På gång.
 *   3. Förfallen påminnelse ("idag kl 06:00") → Behöver din uppmärksamhet,
 *      markerad Försenad, med [Klar] och [Snooza].
 *   4. Snooza → 1 timme → raden försvinner.
 *   5. Klar → raden försvinner.
 *   6. Mobil 390: rader och knappar ≥44px, Klar fungerar.
 *
 *   npx tsx scripts/verify-reminders-browser.ts
 */

const BASE = "http://localhost:3123";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let passed = 0;
function ok(name: string, detail = "") {
  passed += 1;
  console.log(`ok  ${name}${detail ? `  — ${detail}` : ""}`);
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

const INPUT = 'input[placeholder="Vad vill du göra?"]';

async function sendPhrase(page: Page, phrase: string): Promise<string> {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  await page.click(INPUT);
  await page.type(INPUT, phrase);
  // Den deterministiska "Skapa påminnelse"-raden ska leda innan Enter.
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('[role="option"]')).some((el) =>
      (el.textContent ?? "").includes("Skapa påminnelse")
    )
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => (document.body.textContent ?? "").includes("påminner dig") || (document.body.textContent ?? "").includes("gick inte"),
    { timeout: 20_000 }
  );
  return page.evaluate(() => document.body.textContent ?? "");
}

async function attentionSection(page: Page): Promise<string> {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  return page.evaluate(() => {
    const titles = Array.from(document.querySelectorAll("h2, h3"));
    const t = titles.find((el) => (el.textContent ?? "").includes("Behöver din uppmärksamhet"));
    return t?.parentElement?.parentElement?.textContent ?? "";
  });
}

async function clickButtonInRow(page: Page, rowText: string, label: string): Promise<boolean> {
  return page.evaluate(
    (rowText, label) => {
      const rows = Array.from(document.querySelectorAll("div")).filter(
        (el) =>
          (el.textContent ?? "").includes(rowText) &&
          Array.from(el.querySelectorAll("button")).some((b) => (b.textContent ?? "").trim() === label)
      );
      const row = rows[rows.length - 1];
      const btn = row
        ? Array.from(row.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === label)
        : undefined;
      if (!btn) return false;
      (btn as HTMLButtonElement).click();
      return true;
    },
    rowText,
    label
  );
}

async function main() {
  await resetSeed();
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
    page.setDefaultTimeout(30_000);

    // 1. Naturligt språk → tolkad tid + kundkoppling (Sara Nilsson är unik i seedet).
    let body = await sendPhrase(page, "Påminn mig att ringa Sara på onsdag");
    if (!/påminner dig onsdag/i.test(body)) fail(`svaret saknar tolkad tid: ${body.slice(0, 300)}`);
    if (!body.includes("Sara Nilsson")) fail("kundkopplingen (Sara Nilsson) saknas i svaret");
    ok("1 fras → svar med tolkad dag/tid + kundkoppling", "”påminner dig onsdag … kl 10:00” + Sara Nilsson");

    // Exakta specfrasen: ingen Göran i seedet → ärlig text utan koppling.
    body = await sendPhrase(page, "Påminn mig att ringa Göran på onsdag");
    if (!/utan koppling/i.test(body)) fail("noll kundträffar ska ge ärlig ’utan koppling’-not");
    ok("2 okänd kund → textpåminnelse, aldrig gissad koppling");

    // 2. Framtida påminnelse under På gång (kan ligga bakom "Visa fler").
    await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").startsWith("Visa ")
      );
      (btn as HTMLButtonElement | undefined)?.click();
    });
    const watching = await page.evaluate(() => document.body.textContent ?? "");
    if (!watching.toLowerCase().includes("ringa sara")) fail("framtida påminnelsen syns inte under På gång");
    ok("3 framtida påminnelse under På gång", "”ringa Sara” listad, inte i uppmärksamhet");

    // 3. Förfallen påminnelse → Behöver din uppmärksamhet med Försenad + knappar.
    await sendPhrase(page, "Påminn mig idag kl 06:00 att kolla pannan");
    let attention = await attentionSection(page);
    if (!attention.includes("kolla pannan")) fail("förfallen påminnelse saknas i uppmärksamhetslistan");
    if (!/Försenad – skulle gjorts idag kl 06:00/.test(attention)) fail(`Försenad-presentation saknas: ${attention.slice(0, 400)}`);
    if (!attention.includes("Klar") || !attention.includes("Snooza")) fail("Klar/Snooza-knappar saknas");
    ok("4 förfallen → uppmärksamhet med Försenad + [Klar][Snooza]");

    // 4. Snooza → 1 timme → försvinner.
    if (!(await clickButtonInRow(page, "kolla pannan", "Snooza"))) fail("kunde inte klicka Snooza");
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll("button")).some((b) => (b.textContent ?? "").trim() === "1 timme")
    );
    const presets = await page.evaluate(() =>
      Array.from(document.querySelectorAll("button"))
        .map((b) => (b.textContent ?? "").trim())
        .filter((t) => ["1 timme", "Imorgon", "Välj tid"].includes(t))
    );
    if (presets.length < 3) fail(`snooze-presets saknas: ${presets.join(", ")}`);
    if (!(await clickButtonInRow(page, "kolla pannan", "1 timme"))) fail("kunde inte klicka 1 timme");
    await page.waitForFunction(() => (document.body.textContent ?? "").includes("Uppskjuten"));
    attention = await attentionSection(page);
    if (attention.includes("kolla pannan")) fail("uppskjuten påminnelse ligger kvar i uppmärksamhet");
    ok("5 Snooza 1 timme → presets synliga, raden försvinner");

    // 5. Klar → försvinner (historiken kvar).
    await sendPhrase(page, "Påminn mig idag kl 06:30 att beställa skruv");
    attention = await attentionSection(page);
    if (!attention.includes("beställa skruv")) fail("andra förfallna påminnelsen saknas");
    if (!(await clickButtonInRow(page, "beställa skruv", "Klar"))) fail("kunde inte klicka Klar");
    await page.waitForFunction(() => {
      const els = Array.from(document.querySelectorAll("span"));
      return els.some((el) => (el.textContent ?? "").trim() === "Klar" && el.className.includes("text-ok"));
    });
    attention = await attentionSection(page);
    if (attention.includes("beställa skruv")) fail("avklarad påminnelse ligger kvar");
    ok("6 Klar → raden försvinner");

    // 6. Mobil 390: touchytor ≥44px och Klar fungerar.
    await sendPhrase(page, "Påminn mig idag kl 06:45 att tanka bilen"); // skapas på desktop-vy
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
    const btnBox = await page.evaluate(() => {
      let found: Element | null = null;
      for (const b of Array.from(document.querySelectorAll("button"))) {
        if ((b.textContent ?? "").trim() !== "Klar") continue;
        let el: Element | null = b;
        for (let i = 0; i < 6 && el; i++) {
          if ((el.textContent ?? "").includes("tanka bilen")) {
            found = b;
            break;
          }
          el = el.parentElement;
        }
        if (found) break;
      }
      if (!found) return null;
      const r = found.getBoundingClientRect();
      return { h: r.height, w: r.width };
    });
    if (!btnBox) fail("mobil: Klar-knappen hittades inte");
    if (btnBox.h < 44) fail(`mobil: Klar-knappen är ${btnBox.h}px hög (<44)`);
    if (!(await clickButtonInRow(page, "tanka bilen", "Klar"))) fail("mobil: kunde inte klicka Klar");
    await page.waitForFunction(() => {
      const els = Array.from(document.querySelectorAll("span"));
      return els.some((el) => (el.textContent ?? "").trim() === "Klar" && el.className.includes("text-ok"));
    });
    ok("7 mobil 390 → knapphöjd ≥44px, Klar fungerar", `höjd=${Math.round(btnBox.h)}px`);

    console.log(`\n${passed} webbläsarkontroller godkända.`);
  } finally {
    await browser.close();
    await resetSeed();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
