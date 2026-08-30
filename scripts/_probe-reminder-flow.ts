import puppeteer, { type Page } from "puppeteer-core";

/**
 * TEMPORÄR PROBE: guidade påminnelseflödet i kommandofältet på :3123.
 *
 * Buggens repro: "Skapa påminnelse" → "Ring Göran klockan 8 imorgon" fick
 * INTE fråga om tiden igen – VAD+NÄR ska tolkas ur en mening och gå direkt
 * till förhandsvisning → skapa → persistens → Hem-läsmodellen.
 *
 *   npx tsx scripts/_probe-reminder-flow.ts
 */

const BASE = "http://localhost:3123";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const INPUT = 'input[role="combobox"]';
const WHEN_PLACEHOLDER = "imorgon / onsdag / om 2 timmar";
const OPTIONAL_WHEN_HINT = "Ändra tid? Skriv t.ex. imorgon kl 9";

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

async function placeholderOf(page: Page): Promise<string> {
  return page.$eval(INPUT, (el) => (el as HTMLInputElement).placeholder);
}

async function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.textContent ?? "");
}

/** Starta kommandot Skapa påminnelse och vänta in titelsteget. */
async function startReminderFlow(page: Page) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  await page.click(INPUT);
  await page.type(INPUT, "skapa påminnelse");
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('[role="option"]')).some((el) =>
      (el.textContent ?? "").includes("Skapa påminnelse")
    )
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    (sel) => (document.querySelector(sel) as HTMLInputElement | null)?.placeholder === "T.ex. Ring Göran",
    {},
    INPUT
  );
}

async function waitForConfirmCard(page: Page) {
  await page.waitForFunction(() =>
    (document.body.textContent ?? "").includes("Intern påminnelse – skickas inte till kunden")
  );
}

async function waitForCreated(page: Page) {
  await page.waitForFunction(
    () =>
      (document.body.textContent ?? "").includes("påminner dig") ||
      (document.body.textContent ?? "").includes("gick inte"),
    { timeout: 20_000 }
  );
  const body = await bodyText(page);
  if (!body.includes("påminner dig")) fail(`skapandet misslyckades: ${body.slice(0, 300)}`);
  return body;
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
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    // 1. BUGGENS REPRO: en mening med VAD+NÄR i titelsteget → direkt förhandsvisning.
    await startReminderFlow(page);
    await page.type(INPUT, "Ring Göran klockan 8 imorgon");
    await page.waitForFunction(() => (document.body.textContent ?? "").includes("granska och skapa"));
    ok("1a tolkningen visas redan i titelsteget", "raden bär tolkad tid + ”granska och skapa”");
    await page.keyboard.press("Enter");
    await waitForConfirmCard(page);
    const ph = await placeholderOf(page);
    if (ph === WHEN_PLACEHOLDER) fail("flödet frågade om tiden IGEN trots att den fanns i meningen");
    let body = await bodyText(page);
    if (!body.includes("kl 08:00")) fail(`förhandsvisningen saknar 08:00: ${body.slice(0, 300)}`);
    if (!body.includes("Ring Göran")) fail("förhandsvisningen saknar titeln");
    ok("1b EN mening → förhandsvisning direkt (ingen ny tidsfråga)", `placeholder: ”${ph}”`);
    await page.keyboard.press("Enter");
    body = await waitForCreated(page);
    if (!body.includes("kl 08:00")) fail("bekräftelsen saknar den tolkade tiden");
    ok("1c skapad med tolkad tid", "”påminner dig … kl 08:00”");

    // 2. Persistens + läsmodell: framtida påminnelse under Hem → Påminnelser.
    await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
    body = await bodyText(page);
    if (!body.toLowerCase().includes("påminnelser")) fail("Påminnelser-sektionen saknas");
    if (!body.includes("Ring Göran")) fail("skapad påminnelse syns inte under Påminnelser");
    ok("2 persisterad och läses tillbaka på Hem (Påminnelser)");

    // 3. Bara VAD → förhandsvisning med ”Ingen tid”, tid är valfritt.
    await startReminderFlow(page);
    await page.type(INPUT, "Ring Göran");
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => (document.body.textContent ?? "").includes("Ingen tid")
    );
    const whenPh = await placeholderOf(page);
    if (whenPh === WHEN_PLACEHOLDER) fail("flödet tvingade fram obligatorisk tidsfråga");
    if (!whenPh.includes("Ändra tid") && whenPh !== OPTIONAL_WHEN_HINT) {
      fail(`oväntad tidsplaceholder: ${whenPh}`);
    }
    ok("3a utan tid i meningen → förhandsvisning med Ingen tid, inte obligatorisk När-fråga");
    await page.type(INPUT, "blahonga");
    await page.waitForFunction(() => (document.body.textContent ?? "").includes("Jag förstod inte tidpunkten"));
    const keptValue = await page.$eval(INPUT, (el) => (el as HTMLInputElement).value);
    if (keptValue !== "blahonga") fail("användarens text tappades vid obegriplig tidfras");
    ok("3b obegriplig tidfras → ärligt fel, texten bevaras");
    await page.keyboard.press("Escape"); // appens egen väg: rensa fältet, behåll flödet
    await page.waitForFunction((sel) => (document.querySelector(sel) as HTMLInputElement | null)?.value === "", {}, INPUT);
    await page.type(INPUT, "imorgon kl 8");
    const typed = await page.$eval(INPUT, (el) => (el as HTMLInputElement).value);
    if (typed !== "imorgon kl 8") fail(`fältet fick fel värde: ”${typed}”`);
    await waitForConfirmCard(page);
    await page.keyboard.press("Enter");
    await waitForCreated(page);
    ok("3c tvåstegsvägen (titel → tid) skapar som förut");

    // 4. Korrigering: en mening → ”kl 9 istället” ändrar tiden, behåller VAD.
    await startReminderFlow(page);
    await page.type(INPUT, "Ring Göran imorgon kl 8");
    await page.keyboard.press("Enter");
    await waitForConfirmCard(page);
    await page.type(INPUT, "kl 9 istället");
    await page.waitForFunction(() => (document.body.textContent ?? "").includes("kl 09:00"));
    ok("4a ”kl 9 istället” uppdaterar förhandsvisningen till 09:00");
    await page.keyboard.press("Enter");
    body = await waitForCreated(page);
    if (!body.includes("kl 09:00")) fail("korrigerade tiden användes inte vid skapandet");
    ok("4b skapad med korrigerad tid – titeln behållen");

    // 5. Förfallen via flödet → Behöver din uppmärksamhet (hela kedjan i UI:t).
    await startReminderFlow(page);
    await page.type(INPUT, "Kolla pannan");
    await page.keyboard.press("Enter");
    await page.type(INPUT, "idag kl 06:00");
    await waitForConfirmCard(page);
    await page.keyboard.press("Enter");
    await waitForCreated(page);
    await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
    // Expandera ev. hopfällda listor ("Visa 8 till") innan kontrollen.
    await page.evaluate(() => {
      for (const b of Array.from(document.querySelectorAll("button"))) {
        if ((b.textContent ?? "").trim().startsWith("Visa ")) (b as HTMLButtonElement).click();
      }
    });
    body = await page.evaluate(() => {
      const titles = Array.from(document.querySelectorAll("h2, h3"));
      const t = titles.find((el) => (el.textContent ?? "").includes("Behöver din uppmärksamhet"));
      return t?.parentElement?.parentElement?.textContent ?? "";
    });
    if (!body.includes("Kolla pannan")) fail("förfallen påminnelse saknas i uppmärksamhetslistan");
    if (!/Försenad – skulle gjorts idag kl 06:00/.test(body)) fail(`Försenad-presentation saknas: ${body.slice(0, 300)}`);
    ok("5 kommandofält → persistens → uppmärksamhetsläsmodellen på Hem");

    // 6. NL-först i huvudfältet (befintlig väg): tolkningen syns FÖRE skapandet.
    await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
    await page.click(INPUT);
    await page.type(INPUT, "Påminn mig att ringa Göran imorgon kl 8");
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('[role="option"]')).some(
        (el) => (el.textContent ?? "").includes("Skapa påminnelse") && (el.textContent ?? "").includes("kl 08:00")
      )
    );
    ok("6a huvudfältets NL-rad visar tolkad tid före Enter");
    await page.keyboard.press("Enter");
    await waitForCreated(page);
    ok("6b ”Påminn mig att ringa Göran imorgon kl 8” skapar direkt från huvudfältet");

    if (pageErrors.length > 0) fail(`sidfel i konsolen: ${pageErrors.join(" | ")}`);
    console.log(`\nAlla ${passed} kontroller gröna.`);
  } finally {
    await browser.close();
    await resetSeed();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
