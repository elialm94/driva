import puppeteer from "puppeteer-core";

/**
 * Webbläsarverifiering av kommandofältet (Hem + Assistent).
 *
 * Kör mot dev-servern på :3123 i JSON-läget. Återställer demodata via
 * /api/dev/reset före och efter de muterande stegen.
 *
 *   npx tsx scripts/verify-command-bar.ts
 */

const BASE = "http://localhost:3123";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

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

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  // Server actions är POST med next-action-header – det är "nätverk" vi mäter.
  let actionPosts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.headers()["next-action"]) actionPosts += 1;
  });

  async function ok(name: string, cond: boolean, extra = "") {
    if (!cond) fail(`${name} ${extra} url=${page.url()}`);
    console.log("ok", name, extra);
  }

  async function optionTexts(): Promise<string[]> {
    return page.$$eval('[role="option"]', (els) =>
      els.map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
    );
  }

  /** Hela sidans text med normaliserade blanksteg (kr() använder NBSP). */
  async function bodyText(): Promise<string> {
    return page.evaluate(() => (document.body.textContent ?? "").replace(/\s+/g, " "));
  }

  async function waitForOption(substr: string) {
    await page.waitForFunction(
      (s: string) =>
        Array.from(document.querySelectorAll('[role="option"]')).some((el) =>
          (el.textContent ?? "").includes(s)
        ),
      {},
      substr
    );
  }

  async function clickOption(substr: string) {
    await waitForOption(substr);
    const handle = await page.evaluateHandle((s: string) => {
      return Array.from(document.querySelectorAll('[role="option"]')).find((el) =>
        (el.textContent ?? "").includes(s)
      );
    }, substr);
    await (handle.asElement() as puppeteer.ElementHandle<Element>).click();
  }

  const input = 'input[role="combobox"]';

  await resetSeed();

  /* ------------------------- 1. Desktop: "fak" utan nätverk ------------------------- */
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  await page.waitForSelector(input);

  actionPosts = 0;
  await page.click(input);
  await page.type(input, "fak");
  await waitForOption("Skapa faktura");
  const fakOptions = await optionTexts();
  await ok(
    "1 ”fak” → Skapa faktura först, Visa fakturor + obetalda med",
    fakOptions[0]?.includes("Skapa faktura") === true &&
      fakOptions.some((t) => t.includes("Visa fakturor")) &&
      fakOptions.some((t) => t.includes("Visa obetalda fakturor")),
    fakOptions.slice(0, 4).join(" | ")
  );
  await ok("1 kommandomatchning körde utan nätverk", actionPosts === 0, `posts=${actionPosts}`);

  /* ----------------------- 2. Dynamiska snabbåtgärder (riktig data) ------------------ */
  const chipTexts = await page.$$eval("button,a", (els) =>
    els
      .filter((el) => el.className.includes("rounded-full"))
      .map((el) => (el.textContent ?? "").trim())
  );
  await ok(
    "2 dynamisk snabbåtgärd ur åtgärdsmotorn (sena fakturor)",
    chipTexts.some((t) => /sen(a)? faktur/i.test(t)),
    chipTexts.join(" | ")
  );

  /* ------------------------- 3. Tangentbord: Escape + Cmd+K ------------------------- */
  await page.keyboard.press("Escape"); // rensar frågan
  const clearedValue = await page.$eval(input, (el) => (el as HTMLInputElement).value);
  await ok("3 Escape rensar frågan", clearedValue === "");
  await page.keyboard.press("Escape"); // stänger panelen
  await page.waitForFunction(() => !document.querySelector('[role="listbox"]'));
  await ok("3 Escape stänger panelen", true);

  await page.keyboard.down("Meta");
  await page.keyboard.press("k");
  await page.keyboard.up("Meta");
  await page.waitForFunction(() => {
    const el = document.activeElement as HTMLElement | null;
    return el?.getAttribute("role") === "combobox";
  });
  await ok("3 Cmd+K fokuserar och öppnar fältet", true);

  /* --------------------------- 4. Pilar + aria-selected ----------------------------- */
  await page.type(input, "fak");
  await waitForOption("Skapa faktura");
  await page.keyboard.press("ArrowDown");
  const secondSelected = await page.$$eval('[role="option"]', (els) =>
    els.map((el) => el.getAttribute("aria-selected"))
  );
  await ok(
    "4 pil ner flyttar markeringen till rad 2",
    secondSelected[0] === "false" && secondSelected[1] === "true",
    secondSelected.slice(0, 3).join(",")
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  /* --------------------- 5. Hela flödet: Skapa faktura → utkast --------------------- */
  await page.click(input);
  await page.type(input, "skapa faktura");
  await waitForOption("Skapa faktura");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      (document.querySelector('input[role="combobox"]') as HTMLInputElement | null)?.placeholder ===
      "Vem vill du fakturera?"
  );
  await ok("5 kundsteget frågar ”Vem vill du fakturera?”", true);

  actionPosts = 0;
  await page.type(input, "Joh");
  await waitForOption("Johan Lindberg");
  await ok("5 serversök hittar Johan Lindberg (debouncat)", actionPosts >= 1, `posts=${actionPosts}`);
  await page.keyboard.press("Enter");

  await waitForOption("Altanrenovering");
  const targetTexts = await optionTexts();
  await ok(
    "5 uppdragsval visar 25 500 kr kvar enligt offert",
    targetTexts.some((t) => t.includes("Altanrenovering") && t.includes("25 500 kr kvar enligt offert")) &&
      targetTexts.some((t) => t.includes("Fristående faktura")),
    targetTexts.join(" | ")
  );
  await page.keyboard.press("Enter"); // förvald rad = Altanrenovering

  await page.waitForFunction(() =>
    (document.body.textContent ?? "").includes("Johan Lindberg · Altanrenovering")
  );
  const confirmText = await bodyText();
  await ok(
    "5 bekräftelsekortet visar kund · uppdrag · belopp",
    confirmText.includes("Johan Lindberg · Altanrenovering · 25 500 kr kvar enligt offert")
  );

  const ctaClicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Skapa fakturautkast")
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  await ok("5 CTA ”Skapa fakturautkast” finns", ctaClicked);
  await page.waitForFunction(() => location.pathname.startsWith("/ekonomi/fakturor/"));
  await page.waitForFunction(() => (document.body.textContent ?? "").includes("Utkast"));
  await ok("5 djuplänk till fakturautkastet öppnades", true, page.url());

  /* --------------------- 6. Vem har inte betalat? (READ_ONLY) ----------------------- */
  await resetSeed();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  await page.click(input);
  await page.type(input, "Vem har inte betalat?");
  await waitForOption("Visa obetalda fakturor");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => (document.body.textContent ?? "").includes("väntar på betalning"));
  const unpaidLinks = await page.$$eval('[role="listbox"] a, div a[href*="/ekonomi/fakturor/"]', (els) =>
    els.map((el) => el.getAttribute("href") ?? "")
  );
  await ok(
    "6 obetalda listas med djuplänkar till fakturor",
    unpaidLinks.filter((h) => h.includes("/ekonomi/fakturor/")).length >= 2,
    unpaidLinks.slice(0, 3).join(" | ")
  );

  /* ------------------- 7. Vad behöver jag göra idag? = Hem-åtgärder ------------------ */
  const attentionFirst = await page.$eval(
    "main",
    (el) => {
      const m = (el.textContent ?? "").match(/Faktura #\d+ är \d+ dagar sen/);
      return m ? m[0] : "";
    }
  );
  await page.click(input);
  await page.type(input, "Vad behöver jag göra idag?");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() =>
    (document.body.textContent ?? "").includes("behöver din uppmärksamhet idag")
  );
  const todayText = await bodyText();
  await ok(
    "7 ”idag” svarar med samma åtgärder som Hem",
    attentionFirst.length > 0 && todayText.includes(attentionFirst),
    `första=${attentionFirst}`
  );
  await page.keyboard.press("Escape");

  /* ---------------------- 8. Okänd fri text → ärlig fallback ------------------------ */
  // Med konfigurerad LLM-nyckel skickar Enter texten till modellen (riktiga,
  // kostande anrop – testas separat i scripts/verify-ai-browser.ts). Här
  // verifierar vi det deterministiska: ärligt besked + förslag utan nätverk,
  // och att Enter INTE kör något när ingen nyckel finns.
  actionPosts = 0;
  await page.click(input);
  await page.type(input, "hur mår du idag kompis");
  await page.waitForFunction(() =>
    (document.body.textContent ?? "").includes("Jag kan ännu inte tolka helt fri text")
  );
  const honestOptions = await optionTexts();
  const aiConfiguredInUi = honestOptions.some((t) => t.includes("Fråga assistenten"));
  await ok(
    "8 okänd text → ärligt besked + förslag, inget fejkat svar, noll nätverk vid matchning",
    honestOptions.length >= 2 && actionPosts === 0,
    `förslag=${honestOptions.length} posts=${actionPosts} ai=${aiConfiguredInUi}`
  );
  if (!aiConfiguredInUi) {
    await page.keyboard.press("Enter"); // ingen förvald rad – får INTE köra något
    await new Promise((r) => setTimeout(r, 400));
    const honestStill = await page.evaluate(() =>
      (document.body.textContent ?? "").includes("Jag kan ännu inte tolka helt fri text")
    );
    await ok("8b utan nyckel: Enter kör ingenting", honestStill && actionPosts === 0, `posts=${actionPosts}`);
  }
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  /* ------------------------------ 9. /assistent-sidan ------------------------------- */
  await page.goto(`${BASE}/assistent`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[role="listbox"]');
  const assistentText = await page.evaluate(() => document.body.textContent ?? "");
  await ok(
    "9 /assistent visar samma kommandofält i full layout",
    assistentText.includes("Vanliga åtgärder") && assistentText.includes("Senaste"),
    ""
  );

  /* ------------------------------- 10. Mobil 390 ------------------------------------ */
  const mobile = await browser.newPage();
  mobile.setDefaultTimeout(20000);
  mobile.on("pageerror", (e) => pageErrors.push(String(e)));
  await mobile.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true });
  await mobile.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  await mobile.tap('input[role="combobox"]');
  await mobile.waitForFunction(() => Boolean(document.querySelector("[data-command-sheet] input[role='combobox']")));
  const sheetLayout = await mobile.evaluate(() => {
    const sheet = document.querySelector("[data-command-sheet]") as HTMLElement | null;
    if (!sheet) return null;
    const inputEl = sheet.querySelector('input[role="combobox"]') as HTMLInputElement;
    const rect = inputEl.getBoundingClientRect();
    const focused = document.activeElement === inputEl;
    const sections = (sheet.textContent ?? "").replace(/\s+/g, " ");
    const labels = Array.from(sheet.querySelectorAll('[role="option"]')).map((el) =>
      (el.textContent ?? "").replace(/\s+/g, " ").trim()
    );
    return {
      inputTop: rect.top,
      focused,
      senasteFirst: sections.indexOf("Senaste") < sections.indexOf("Vanliga"),
      rows: labels.length,
      labels,
    };
  });
  await ok(
    "10 mobil: ark öppnas vid fokus, sökfältet överst (tangentbordet täcker inte listan)",
    sheetLayout !== null && sheetLayout.focused && sheetLayout.inputTop < 100 && sheetLayout.rows >= 3 && sheetLayout.rows <= 8,
    JSON.stringify(sheetLayout)
  );
  await ok("10 mobil: Senaste före Vanliga", sheetLayout?.senasteFirst === true);
  await ok(
    "10 mobil: idle är kompakt (faktura/offert/påminnelse, inte hela katalogen)",
    Boolean(sheetLayout?.labels.some((t) => t.includes("Skapa faktura"))) &&
      Boolean(sheetLayout?.labels.some((t) => t.includes("Skapa offert"))) &&
      Boolean(sheetLayout?.labels.some((t) => t.includes("Skapa påminnelse"))) &&
      !sheetLayout?.labels.some((t) => t.includes("Hitta kund")),
    JSON.stringify(sheetLayout?.labels)
  );

  await mobile.type('input[role="combobox"]', "Påminn mig att ringa Göran kl 12");
  await mobile.waitForFunction(() =>
    Array.from(document.querySelectorAll("[data-command-sheet] [role='option']")).some((el) =>
      (el.textContent ?? "").includes("Ring Göran")
    )
  );
  const typedLabels = await mobile.evaluate(() =>
    Array.from(document.querySelectorAll("[data-command-sheet] [role='option']")).map((el) =>
      (el.textContent ?? "").replace(/\s+/g, " ").trim()
    )
  );
  await ok(
    "10 mobil: NL-påminnelse döljer generiska actions",
    typedLabels.some((t) => t.includes("Ring Göran")) &&
      !typedLabels.some((t) => t.includes("Skapa faktura")) &&
      !typedLabels.some((t) => t.includes("Hitta kund")),
    typedLabels.join(" | ")
  );
  await mobile.evaluate(() => {
    const input = document.querySelector("[data-command-sheet] input[role='combobox']") as HTMLInputElement | null;
    if (input) input.value = "";
  });
  // Töm fältet så nästa steg (Skapa faktura) ser idle-listan igen.
  for (let i = 0; i < 40; i++) await mobile.keyboard.press("Backspace");

  // Tryck på en rad: Skapa faktura → kundsteget med stora radytor.
  const tapped = await mobile.evaluate(() => {
    const row = Array.from(document.querySelectorAll('[role="option"]')).find((el) =>
      (el.textContent ?? "").includes("Skapa faktura")
    ) as HTMLElement | undefined;
    if (!row) return null;
    const h = row.getBoundingClientRect().height;
    row.click();
    return { height: h };
  });
  await mobile.waitForFunction(() => {
    const inputs = Array.from(document.querySelectorAll('input[role="combobox"]'));
    return inputs.some((el) => (el as HTMLInputElement).placeholder === "Vem vill du fakturera?");
  });
  await ok(
    "10 mobil: rader är tryckbara (≥44px) och flödet fortsätter",
    tapped !== null && tapped.height >= 44,
    `radhöjd=${tapped?.height}`
  );
  const cancelled = await mobile.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === "Avbryt");
    if (!btn) return false;
    (btn as HTMLElement).click();
    return true;
  });
  await mobile.waitForFunction(() => {
    const sheets = document.querySelectorAll(".fixed.inset-0");
    return !Array.from(sheets).some((el) => el.querySelector('input[role="combobox"]'));
  });
  await ok("10 mobil: Avbryt stänger arket", cancelled);

  await resetSeed();

  if (pageErrors.length > 0) fail(`klientfel: ${pageErrors.join(" ;; ")}`);
  console.log("\nAlla kommandofältskontroller godkända.");
  await browser.close();
}

main().catch((e) => fail(String(e)));
