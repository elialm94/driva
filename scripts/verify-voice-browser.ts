import puppeteer, { type Page } from "puppeteer-core";

/**
 * Webbläsarverifiering av röstinmatningen i kommandofältet (:3123).
 *
 * En deterministisk mockleverantör injiceras via utvecklingskroken
 * window.__drivaSpeechProvider (finns bara i icke-produktion) och testet
 * driver sessionen händelse för händelse. Det som verifieras är hela
 * UI-kedjan: kapabilitet, tillstånd (Lyssnar/Tolkar), live-interim, auto-stopp
 * via mockad speechend, slutligt transkript in i SAMMA Enter-pipeline, avbryt,
 * fel. Ingen separat röstguide.
 *
 * OBS: riktig sv-SE-igenkänning (Googles/Apples tjänster + mikrofon) kan inte
 * verifieras headless – kräver manuellt öra-test. Se rapporten.
 *
 *   npx tsx scripts/verify-voice-browser.ts
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

/* ------------------------- Mockleverantör i sidan ------------------------- */

interface VoiceTestState {
  starts: number;
  stops: number;
  aborts: number;
  lang: string;
  handlers: {
    onStart(): void;
    onUpdate(update: { text: string; isFinal: boolean }): void;
    onEnd(): void;
    onError(error: { code: string }): void;
  } | null;
}

/** Injicerar en styrbar mock FÖRE sidans skript (kapabilitet läses vid mount). */
async function injectMock(page: Page) {
  await page.evaluateOnNewDocument(() => {
    const state: VoiceTestState = { starts: 0, stops: 0, aborts: 0, lang: "", handlers: null };
    const w = window as unknown as Record<string, unknown>;
    w.__voiceTest = state;
    w.__drivaSpeechProvider = {
      start(options: { lang: string }, handlers: NonNullable<VoiceTestState["handlers"]>) {
        state.starts += 1;
        state.lang = options.lang;
        state.handlers = handlers;
        return {
          stop() {
            state.stops += 1;
          },
          abort() {
            state.aborts += 1;
          },
        };
      },
    };
  });
}

/** Simulerar "stöds ej" (t.ex. Firefox): kroken satt till null. */
async function injectUnsupported(page: Page) {
  await page.evaluateOnNewDocument(() => {
    (window as unknown as Record<string, unknown>).__drivaSpeechProvider = null;
  });
}

function driver(page: Page) {
  return {
    getState: () =>
      page.evaluate(() => {
        const s = (window as unknown as { __voiceTest: VoiceTestState }).__voiceTest;
        return { starts: s.starts, stops: s.stops, aborts: s.aborts, lang: s.lang };
      }),
    grant: () =>
      page.evaluate(() => {
        const s = (window as unknown as { __voiceTest: VoiceTestState }).__voiceTest;
        if (!s.handlers) throw new Error("ingen aktiv session i mocken");
        s.handlers.onStart();
      }),
    update: (text: string, isFinal: boolean) =>
      page.evaluate(
        (t: string, f: boolean) => {
          const s = (window as unknown as { __voiceTest: VoiceTestState }).__voiceTest;
          if (!s.handlers) throw new Error("ingen aktiv session i mocken");
          s.handlers.onUpdate({ text: t, isFinal: f });
        },
        text,
        isFinal
      ),
    end: () =>
      page.evaluate(() => {
        const s = (window as unknown as { __voiceTest: VoiceTestState }).__voiceTest;
        if (!s.handlers) throw new Error("ingen aktiv session i mocken");
        s.handlers.onEnd();
      }),
    error: (code: string) =>
      page.evaluate((c: string) => {
        const s = (window as unknown as { __voiceTest: VoiceTestState }).__voiceTest;
        if (!s.handlers) throw new Error("ingen aktiv session i mocken");
        s.handlers.onError({ code: c });
      }, code),
  };
}

/* --------------------------------- Hjälpare ------------------------------- */

const INPUT = 'input[role="combobox"]';
const MIC = 'button[aria-label="Använd röst"]';
const STOP = 'button[aria-label="Stoppa inspelning"]';
const CANCEL = 'button[aria-label="Avbryt röstinmatning"]';

async function waitForValue(page: Page, expected: string) {
  await page.waitForFunction(
    (want: string) => {
      const el = document.querySelector('input[role="combobox"]') as HTMLInputElement | null;
      return el?.value === want;
    },
    {},
    expected
  );
}

async function waitForBody(page: Page, substr: string) {
  await page.waitForFunction(
    (s: string) => (document.body.textContent ?? "").includes(s),
    {},
    substr
  );
}

async function settle() {
  await new Promise((r) => setTimeout(r, 400));
}

async function main() {
  await resetSeed();
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const pageErrors: string[] = [];
  try {
    /* ============================== DESKTOP ============================== */
    const page = await browser.newPage();
    page.setDefaultTimeout(20_000);
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    await injectMock(page);
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });

    // Server actions är POST med next-action-header – beviset för "ingen autosänd".
    let actionPosts = 0;
    page.on("request", (r) => {
      if (r.method() === "POST" && r.headers()["next-action"]) actionPosts += 1;
    });

    const d = driver(page);
    await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
    await page.waitForSelector(MIC);

    // 1. Idle: mikrofon synlig, ⌘K flyttad (uppdateras rendern efter mount).
    await page.waitForFunction(() => document.querySelector("kbd")?.className.includes("right-12") ?? false);
    ok("1 idle: mikrofonknapp (aria 'Använd röst') i fältet, ⌘K flyttad åt vänster");
    await settle();
    await page.screenshot({ path: ".shots/voice-01-desktop-idle.png" });

    // 2. Tryck → requesting → beviljad behörighet → Lyssnar-läge.
    await page.click(INPUT);
    actionPosts = 0;
    await page.click(MIC);
    let s = await d.getState();
    if (s.starts !== 1) fail(`förväntade 1 sessionstart, fick ${s.starts}`);
    if (s.lang !== "sv-SE") fail(`språkhint är ${s.lang}, inte sv-SE`);
    await page.waitForSelector(CANCEL); // requesting: knappen = avbryt
    ok("2 tryck startar EN session med sv-SE, väntar på behörighet");

    await d.grant();
    await waitForBody(page, "Lyssnar");
    await page.waitForSelector(STOP);
    const hasPulse = await page.evaluate(() => document.querySelector(".animate-pulse") !== null);
    if (!hasPulse) fail("ingen pulserande indikator i lyssnar-läget");
    ok("3 lyssnar-läge: 'Lyssnar…' + pulserande röd indikator + stoppknapp");
    await settle();
    await page.screenshot({ path: ".shots/voice-02-desktop-lyssnar.png" });

    // 3. Interim live i fältet – INGEN pipeline. Stopp → Tolkar → samma Enter-väg.
    await d.update("påminn mig att ringa", false);
    await waitForValue(page, "påminn mig att ringa");
    ok("4 interimresultat visas live i fältet");
    if (actionPosts !== 0) fail(`åtgärd från interim: ${actionPosts} server action-POST`);

    await page.click(STOP);
    s = await d.getState();
    if (s.stops !== 1) fail(`stop() nådde inte leverantören (stops=${s.stops})`);
    await waitForBody(page, "Tolkar");
    ok("5 stopp → 'Tolkar…'-läge, leverantörens stop() anropad");

    await d.update("Påminn mig att ringa Göran på onsdag", true);
    await d.end();
    await waitForValue(page, "Påminn mig att ringa Göran på onsdag");
    await page.waitForSelector(MIC); // tillbaka i idle
    await page.waitForFunction(
      () =>
        (document.body.textContent ?? "").includes("påminner dig") ||
        (document.body.textContent ?? "").includes("gick inte") ||
        Array.from(document.querySelectorAll('[role="option"]')).some((el) =>
          (el.textContent ?? "").includes("Skapa påminnelse")
        ),
      { timeout: 20_000 }
    );
    ok("6 slutligt transkript → samma kommando-pipeline som Enter (ingen separat röstguide)");
    await settle();
    await page.screenshot({ path: ".shots/voice-03-desktop-transkript.png" });

    const reminderBody = await page.evaluate(() => document.body.textContent ?? "");
    if (/påminner dig/i.test(reminderBody)) {
      if (actionPosts < 1) fail("slutligt transkript skickade inget server action-anrop");
      ok("7 auto-commit körde deterministiska påminnelseflödet");
    } else {
      ok("7 auto-commit landade i samma tolk/lista som skriven text (Enter-väg)");
    }
    await settle();
    await page.screenshot({ path: ".shots/voice-04-desktop-paminnelse-kort.png" });

    // 5. Append: förskriven text + transkript → sammanfogat med mellanslag.
    await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
    await page.click(INPUT);
    await page.type(INPUT, "Skapa offert till Anna");
    await page.click(MIC);
    await d.grant();
    await waitForBody(page, "Lyssnar");
    await d.update("för köksrenovering på 85 000 kronor", true);
    await d.end();
    await waitForValue(page, "Skapa offert till Anna för köksrenovering på 85 000 kronor");
    ok("8 append: befintlig text + mellanslag + transkript, aldrig överskrivning");

    // 6. Avbryt (Escape): fältet återställs exakt, sessionen abortas.
    await page.click(INPUT);
    await page.keyboard.press("Escape"); // fältets egen rensning (rösten är idle)
    await waitForValue(page, "");
    await page.type(INPUT, "hej");
    const beforeCancel = await d.getState();
    await page.click(MIC);
    await d.grant();
    await waitForBody(page, "Lyssnar");
    await d.update("nu pratar jag", false);
    await waitForValue(page, "hej nu pratar jag");
    await page.keyboard.press("Escape");
    await waitForValue(page, "hej");
    s = await d.getState();
    if (s.aborts !== beforeCancel.aborts + 1) fail(`Escape abortade inte sessionen (aborts=${s.aborts})`);
    const panelStillOpen = await page.evaluate(() => document.querySelector('[role="listbox"]') !== null);
    if (!panelStillOpen) fail("Escape under inspelning stängde panelen (skulle bara avbryta rösten)");
    ok("9 Escape avbryter: fältet exakt återställt ('hej'), abort() anropad, panelen kvar");

    // 7. Nekad mikrofon → vänligt svenskt meddelande i panelens hintyta.
    await page.click(MIC);
    await d.error("permission-denied");
    await waitForBody(page, "Tillåt mikrofonåtkomst för att använda röstkommandon.");
    ok("10 nekad behörighet → vänlig svensk hint i panelen, inga tekniska koder");
    await settle();
    await page.screenshot({ path: ".shots/voice-05-desktop-behorighet-nekad.png" });

    // Att skriva själv rensar hinten (felet är inte längre relevant).
    await page.type(INPUT, "x");
    await page.waitForFunction(() => !(document.body.textContent ?? "").includes("Tillåt mikrofonåtkomst"));
    ok("11 hint försvinner när användaren skriver – textfältet opåverkat");

    // 8. no-speech → 'Försök igen' + mikrofonknappen fungerar som nytt försök.
    await page.click(INPUT);
    await page.keyboard.press("Escape"); // rensa frågan ("hejx")
    await waitForValue(page, "");
    await page.click(MIC);
    await d.grant();
    await d.error("no-speech");
    await waitForBody(page, "Jag hörde inget. Försök igen.");
    const beforeRetry = await d.getState();
    await page.click(MIC); // nytt försök direkt från felläget
    s = await d.getState();
    if (s.starts !== beforeRetry.starts + 1) fail("nytt försök startade ingen ny session");
    await d.grant();
    await waitForBody(page, "Lyssnar");
    ok("12 no-speech → vänligt fel + nytt försök via mikrofonknappen fungerar");

    // 9. Inga dubbelinspelningar: tryck under pågående session startar inget nytt.
    const beforeDouble = await d.getState();
    await page.click(STOP); // först: stoppa pågående → transcribing
    await page.click(MIC).catch(() => undefined); // knappen är disabled under transkribering
    s = await d.getState();
    if (s.starts !== beforeDouble.starts) fail(`dubbelstart: ${s.starts} ≠ ${beforeDouble.starts}`);
    await d.end(); // tomt slut → no-speech-fel; städa via Escape
    await page.keyboard.press("Escape");
    ok("13 tryck under övergång ignoreras – ingen dubbelinspelning");

    /* ==================== KAPABILITET SAKNAS (t.ex. Firefox) ==================== */
    const noSupport = await browser.newPage();
    noSupport.setDefaultTimeout(20_000);
    noSupport.on("pageerror", (e) => pageErrors.push(String(e)));
    await injectUnsupported(noSupport);
    await noSupport.setViewport({ width: 1280, height: 900 });
    await noSupport.goto(`${BASE}/`, { waitUntil: "networkidle0" });
    await noSupport.waitForSelector(INPUT);
    const micCount = await noSupport.$$eval(MIC, (els) => els.length);
    if (micCount !== 0) fail("mikrofonen renderas trots att stöd saknas");
    const kbdDefault = await noSupport.$eval("kbd", (el) => el.className);
    if (!kbdDefault.includes("right-3.5")) fail(`⌘K ska stå kvar på right-3.5: ${kbdDefault}`);
    await noSupport.click(INPUT);
    await noSupport.type(INPUT, "fak");
    await noSupport.waitForFunction(() =>
      Array.from(document.querySelectorAll('[role="option"]')).some((el) =>
        (el.textContent ?? "").includes("Skapa faktura")
      )
    );
    ok("14 utan stöd: ingen död knapp, textfältet fungerar exakt som förut");
    await noSupport.close();

    /* ================================ MOBIL 390 ================================ */
    const mobile = await browser.newPage();
    mobile.setDefaultTimeout(20_000);
    mobile.on("pageerror", (e) => pageErrors.push(String(e)));
    await injectMock(mobile);
    await mobile.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    let mobileActionPosts = 0;
    mobile.on("request", (r) => {
      if (r.method() === "POST" && r.headers()["next-action"]) mobileActionPosts += 1;
    });
    const dm = driver(mobile);
    await mobile.goto(`${BASE}/`, { waitUntil: "networkidle0" });
    await mobile.tap(INPUT); // öppnar mobilarket
    await mobile.waitForSelector(`.fixed.inset-0 ${MIC}`);
    const micBox = await mobile.$eval(`.fixed.inset-0 ${MIC}`, (el) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height };
    });
    if (micBox.w < 44 || micBox.h < 44) fail(`touchyta ${micBox.w}×${micBox.h}px < 44px`);
    const micsTotal = await mobile.$$eval(MIC, (els) => els.length);
    if (micsTotal !== 1) fail(`förväntade exakt 1 mikrofon på mobilen (arket), fick ${micsTotal}`);
    ok("15 mobil: mikrofon i arket med touchyta ≥44×44px", `${Math.round(micBox.w)}×${Math.round(micBox.h)}px`);

    mobileActionPosts = 0;
    await mobile.tap(`.fixed.inset-0 ${MIC}`);
    await dm.grant();
    await waitForBody(mobile, "Lyssnar");
    await settle();
    await mobile.screenshot({ path: ".shots/voice-06-mobil-lyssnar.png" });
    ok("16 mobil: lyssnar-läge i arket");

    await dm.update("Visa obetalda fakturor", true);
    await dm.end();
    await mobile.waitForFunction(() => {
      const sheet = Array.from(document.querySelectorAll(".fixed.inset-0")).find((el) =>
        el.querySelector('input[role="combobox"]')
      );
      const el = sheet?.querySelector('input[role="combobox"]') as HTMLInputElement | undefined;
      return el?.value === "Visa obetalda fakturor";
    });
    ok("17 mobil: transkript i arkets fält och samma pipeline som desktop");
    await settle();
    await mobile.screenshot({ path: ".shots/voice-07-mobil-transkript.png" });
    await mobile.close();

    if (pageErrors.length > 0) fail(`klientfel: ${pageErrors.join(" ;; ")}`);
    console.log(`\n${passed} röstkontroller godkända.`);
  } finally {
    await browser.close();
    await resetSeed();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
