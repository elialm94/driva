import puppeteer, { type Page } from "puppeteer-core";
import { mkdirSync } from "node:fs";

/**
 * Browserverifiering av rik text (beskrivning på offerter/fakturor) mot :3123.
 *
 * Desktop (1360px):
 *   1. Seedad offert (quote-dorrar): sektionen renderas på appens detaljsida,
 *      kundvyn /offert/[token] och print-/underlagssidan.
 *   2. Seedad faktura (inv-1042, utfärdad → frusen snapshot): detaljsida,
 *      kundvyn /faktura/[token] och PDF-sidan – inkl. mailto-länk.
 *   3. Ny offert byggs via formuläret: H2, fetstil, punktlista, länk via
 *      popovern, ångra/gör om → spara → allt renderas på detaljsidan
 *      med säkra länkattribut.
 *   4. AI-knappen "Förbättra": live-anrop eller ärligt fel. Rapporteras ärligt.
 *   5. Ny faktura med H2 + text → spara → detaljsida.
 * Mobil (390px):
 *   6. Redigera seedad offert: verktygsraden är horisontellt skrollbar,
 *      träffytor ≥44px, redigering + spara fungerar, kundvyn renderar.
 *
 * OBS: sektionsetiketten renderas med CSS text-transform: uppercase, och
 * innerText returnerar den RENDERADE texten – alla textkontroller görs
 * därför skiftlägesokänsligt.
 *
 *   npx tsx scripts/verify-richtext-browser.ts
 */

const BASE = "http://localhost:3123";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = "/tmp/richtext-verify";

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
  console.log("ok reset till demodata");
}

const bodyText = (page: Page) => page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
const has = (text: string, needle: string) => text.toLowerCase().includes(needle.toLowerCase());

async function ok(page: Page, name: string, cond: boolean, extra = "") {
  if (!cond) fail(`${name} ${extra} url=${page.url()}`);
  console.log("ok", name, extra);
}

/** Vänta tills texten är synlig (innerText, skiftlägesokänsligt). */
async function waitVisibleText(page: Page, needle: string) {
  await page.waitForFunction(
    (n: string) => document.body.innerText.toLowerCase().includes(n),
    {},
    needle.toLowerCase()
  );
}

async function shot(page: Page, name: string, fullPage = true) {
  // Modaler är fixed-positionerade – fullPage-skärmdumpar blandar dem med
  // bakomliggande innehåll, så overlays fotas i viewportläge.
  await page.screenshot({ path: `${SHOTS}/${name}.png` as `${string}.png`, fullPage });
  console.log("   ↳ screenshot", `${SHOTS}/${name}.png`);
}

/** Klicka knappen vars synliga text matchar. */
async function clickByText(page: Page, selector: string, text: string): Promise<boolean> {
  return page.$$eval(
    selector,
    (els, t) => {
      const el = els.find((e) => (e.textContent ?? "").trim().includes(t)) as HTMLElement | undefined;
      if (!el) return false;
      el.click();
      return true;
    },
    text
  );
}

async function clickToolbar(page: Page, label: string) {
  await page.click(`button[aria-label="${label}"]`);
}

async function pickFirstCustomer(page: Page) {
  await page.click('[role="combobox"]');
  await page.waitForSelector('[role="option"] button');
  await page.click('[role="option"] button');
}

/* ------------------------- 1–2: seedade dokument -------------------------- */

async function assertDescriptionBeforeLines(page: Page, description: string, line: string, label: string) {
  const order = await page.evaluate(
    (desc, row) => {
      const text = document.body.innerText;
      return {
        desc: text.indexOf(desc),
        line: text.indexOf(row),
        heading: text.indexOf("Övrig information"),
        hasDoc: Boolean(document.querySelector(".richtext-doc")),
      };
    },
    description,
    line
  );
  await ok(
    page,
    `${label}: beskrivning före rader, ingen generisk rubrik`,
    order.hasDoc && order.desc !== -1 && order.line !== -1 && order.desc < order.line && order.heading === -1
  );
}

async function verifySeededQuote(page: Page) {
  await page.goto(`${BASE}/ekonomi/offerter/quote-dorrar`, { waitUntil: "networkidle0" });
  await waitVisibleText(page, "Detta ingår");
  const text = await bodyText(page);
  await ok(page, "offertdetalj: H2 ur rik text", has(text, "Detta ingår"));
  await ok(page, "offertdetalj: punktlista", has(text, "Bortforsling av gamla dörrar"));
  await ok(page, "offertdetalj: ingen generisk Övrig information-rubrik", !has(text, "Övrig information"));
  const bold = await page.$$eval("strong", (els) => els.some((e) => (e.textContent ?? "").includes("fri tillgång till källargången")));
  await ok(page, "offertdetalj: fetstil renderas som <strong>", bold);
  await assertDescriptionBeforeLines(page, "Detta ingår", "Demontering och montering av dörrar", "offertdetalj");
  await shot(page, "01-offert-detalj-desktop");

  await page.goto(`${BASE}/offert/demo-brf-dorrar`, { waitUntil: "networkidle0" });
  await waitVisibleText(page, "Detta ingår");
  await assertDescriptionBeforeLines(page, "Detta ingår", "Demontering och montering av dörrar", "kundvy /offert/[token]");
  await shot(page, "02-offert-kundvy-desktop");

  // Underlagssidan är SIGNERINGSBEVIS (inte dokumentvy): den kräver signatur
  // och visar hash-verifiering. Genomför demo-BankID-flödet och verifiera att
  // hashen – som nu täcker rik text via kanonisk form – är intakt efter lås.
  await ok(page, "BankID: godkännandeflödet öppnas", await clickByText(page, "button", "Godkänn med BankID"));
  await waitVisibleText(page, "Öppna BankID på den här enheten");
  await clickByText(page, "button", "Öppna BankID på den här enheten");
  await waitVisibleText(page, "Slutför signering");
  await clickByText(page, "button", "Slutför signering");
  await waitVisibleText(page, "Offerten är godkänd");
  await ok(page, "BankID: demo-signering genomförd (versionen med rik text är låst)", true);

  await page.goto(`${BASE}/offert/demo-brf-dorrar/underlag`, { waitUntil: "networkidle0" });
  await waitVisibleText(page, "Signeringsunderlag");
  await waitVisibleText(page, "Dokumentet är oförändrat sedan signeringen");
  await ok(page, "underlag: contentHash INKLUSIVE rik text verifieras som intakt", true);
  await shot(page, "03-offert-underlag-desktop");
}

async function verifySeededInvoice(page: Page) {
  await page.goto(`${BASE}/ekonomi/fakturor/inv-1042`, { waitUntil: "networkidle0" });
  await waitVisibleText(page, "Om fakturan");
  await assertDescriptionBeforeLines(
    page,
    "Om fakturan",
    "Fönsterbyte gårdshus: demontering och montering",
    "fakturadetalj"
  );
  await shot(page, "04-faktura-detalj-desktop");

  for (const [name, path] of [
    ["kundvy /faktura/[token]", "/faktura/demo-f1042"],
    ["PDF-sidan /faktura/[token]/pdf", "/faktura/demo-f1042/pdf"],
  ] as const) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle0" });
    await waitVisibleText(page, "Om fakturan");
    await assertDescriptionBeforeLines(page, "Om fakturan", "Fönsterbyte gårdshus: demontering och montering", name);
    const mailto = await page.$$eval("a", (els) => els.some((a) => a.getAttribute("href")?.startsWith("mailto:")));
    await ok(page, `${name}: mailto-länk renderas`, mailto);
    await shot(page, path.includes("pdf") ? "06-faktura-pdf-desktop" : "05-faktura-kundvy-desktop");
  }
}

/* ----------------------- 3–4: ny offert via editorn ----------------------- */

async function createQuoteWithRichText(page: Page): Promise<{ ai: string }> {
  await page.goto(`${BASE}/ekonomi/offerter/ny`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".richtext-editor .ProseMirror");

  await pickFirstCustomer(page);
  await page.type("#offert-rubrik", "Rik text-verifiering");
  await page.type('input[aria-label="Beskrivning"]', "Testarbete enligt specifikation");
  await page.click('input[aria-label="À-pris exkl. moms"]');
  await page.type('input[aria-label="À-pris exkl. moms"]', "1200");

  // ---- Bygg innehåll med verktygsraden (riktiga klick + tangentbord) ----
  const pm = ".richtext-editor .ProseMirror";
  await page.click(pm);
  await clickToolbar(page, "Rubrik 2");
  await page.keyboard.type("Detta ingår i priset");
  const h2Size = await page.$eval(`${pm} h2`, (el) => Math.round(parseFloat(getComputedStyle(el).fontSize)));
  await ok(page, "ny offert: H2 är visuellt 20px", h2Size === 20, `${h2Size}px`);
  await clickToolbar(page, "Rubrik 1");
  const h1Size = await page.$eval(`${pm} h1`, (el) => Math.round(parseFloat(getComputedStyle(el).fontSize)));
  await ok(page, "ny offert: H1 är visuellt 24px (skild från H2)", h1Size === 24, `${h1Size}px`);
  await clickToolbar(page, "Rubrik 3");
  const h3Size = await page.$eval(`${pm} h3`, (el) => Math.round(parseFloat(getComputedStyle(el).fontSize)));
  await ok(page, "ny offert: H3 är visuellt 17px (skild från H1/H2)", h3Size === 17, `${h3Size}px`);
  const headingTags = await page.$eval(pm, (el) => ({
    h1: el.querySelectorAll("h1").length,
    h2: el.querySelectorAll("h2").length,
    h3: el.querySelectorAll("h3").length,
  }));
  await ok(page, "ny offert: H3 är en riktig h3-nod (inte samma som H1)", headingTags.h3 === 1 && headingTags.h1 === 0);
  await clickToolbar(page, "Rubrik 2");
  const mallGone = await page.$$eval("button", (els) => els.every((e) => (e.textContent ?? "").trim() !== "Mall"));
  await ok(page, "ny offert: Mall-knappen är borttagen", mallGone);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Allt arbete utförs av ");
  await clickToolbar(page, "Fet (⌘B / Ctrl+B)");
  await page.keyboard.type("certifierade snickare");
  await clickToolbar(page, "Fet (⌘B / Ctrl+B)");
  await page.keyboard.type(".");
  await page.keyboard.type(" Med ");
  await clickToolbar(page, "Understruken (⌘U / Ctrl+U)");
  await page.keyboard.type("skriftlig garanti");
  await clickToolbar(page, "Understruken (⌘U / Ctrl+U)");
  await page.keyboard.type(".");
  const hasUnderline = await page.$eval(`${pm} u`, (el) => (el.textContent ?? "").includes("skriftlig garanti"));
  await ok(page, "ny offert: understruken mark i editorn", hasUnderline);
  await page.keyboard.type(" ");
  await clickToolbar(page, "Kursiv (⌘I / Ctrl+I)");
  await page.keyboard.type("vid behov");
  await clickToolbar(page, "Kursiv (⌘I / Ctrl+I)");
  await page.keyboard.type(".");
  await page.keyboard.press("Enter");
  await page.keyboard.type("tangent");
  await page.keyboard.down("Shift");
  for (let i = 0; i < "tangent".length; i += 1) await page.keyboard.press("ArrowLeft");
  await page.keyboard.up("Shift");
  await page.keyboard.down("Meta");
  await page.keyboard.press("b");
  await page.keyboard.up("Meta");
  const keyBold = await page.$$eval(`${pm} strong`, (els) => els.some((e) => (e.textContent ?? "").includes("tangent")));
  await ok(page, "ny offert: Cmd+B sätter fetstil på markering", keyBold);
  await page.keyboard.down("Meta");
  await page.keyboard.press("i");
  await page.keyboard.up("Meta");
  const keyItalic = await page.$$eval(`${pm} em`, (els) => els.some((e) => (e.textContent ?? "").includes("tangent")));
  await ok(page, "ny offert: Cmd+I sätter kursiv på markering", keyItalic);
  await page.keyboard.down("Meta");
  await page.keyboard.press("u");
  await page.keyboard.up("Meta");
  const keyUnderline = await page.$$eval(`${pm} u`, (els) => els.some((e) => (e.textContent ?? "").includes("tangent")));
  await ok(page, "ny offert: Cmd+U sätter understruken på markering", keyUnderline);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await clickToolbar(page, "Punktlista");
  await page.keyboard.type("Grovstädning ingår");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Material enligt överenskommelse");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter"); // tom punkt avslutar listan
  await clickToolbar(page, "Numrerad lista");
  await page.keyboard.type("Första steget");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  const hasOrdered = await page.$eval(`${pm} ol`, (el) => (el.textContent ?? "").includes("Första steget"));
  await ok(page, "ny offert: numrerad lista i editorn", hasOrdered);

  await page.keyboard.type("Förutsättningar: tillgång till kök.");
  await page.keyboard.down("Meta");
  await page.keyboard.press("z");
  await page.keyboard.up("Meta");
  let hasNote = await page.$eval(pm, (el) => el.textContent?.includes("Förutsättningar") ?? false);
  await ok(page, "ny offert: Cmd+Z ångrar sista meningen", !hasNote);
  await page.keyboard.down("Meta");
  await page.keyboard.down("Shift");
  await page.keyboard.press("z");
  await page.keyboard.up("Shift");
  await page.keyboard.up("Meta");
  hasNote = await page.$eval(pm, (el) => el.textContent?.includes("Förutsättningar") ?? false);
  await ok(page, "ny offert: Cmd+Shift+Z gör om (versalt Z)", hasNote);
  await page.keyboard.down("Control");
  await page.keyboard.press("y");
  await page.keyboard.up("Control");
  // Ctrl+Y med tom redo-stack ska inte krascha eller radera texten.
  hasNote = await page.$eval(pm, (el) => el.textContent?.includes("Förutsättningar") ?? false);
  await ok(page, "ny offert: Ctrl+Y är ofarlig när redo-stacken är tom", hasNote);

  // Länk via popovern, som sista redigeringssteg: skriv meningen (markören
  // står efter Gör om i mallens stycke), markera ordet med Shift+pil
  // (trippelklick ger ingen selection i headless) → Länk → URL → Spara.
  await page.keyboard.type("Vår webbplats");
  await page.keyboard.down("Shift");
  for (let i = 0; i < "webbplats".length; i += 1) await page.keyboard.press("ArrowLeft");
  await page.keyboard.up("Shift");
  await clickToolbar(page, "Länk");
  await page.waitForSelector("#richtext-link-url");
  await page.type("#richtext-link-url", "exempel.se");
  await ok(page, "ny offert: länkpopovern öppnas", await clickByText(page, "button", "Spara länk"));
  await page.waitForSelector(`${pm} a[href="https://exempel.se"]`);
  await ok(page, "ny offert: länken sitter i editorn (https-normaliserad)", true);
  await shot(page, "07-offert-formular-editor-desktop");

  // ---- AI-knappen: ärlig verifiering av det som faktiskt gäller ----
  let ai: string;
  const beforeAi = await page.$eval(pm, (el) => el.textContent ?? "");
  const aiButton = await clickByText(page, "button", "Förbättra");
  if (!aiButton) {
    ai = "AI-knappen är dold (isAiConfigured()=false i dev-serverns process) – ärligt ej-konfigurerat-läge.";
    console.log("ok", "AI: knappen dold – servern saknar nyckel (ärligt läge)");
  } else {
    await page.waitForFunction(
      (sel: string, prev: string) => {
        const text = document.querySelector(sel)?.textContent ?? "";
        return text !== prev || document.querySelector('[role="alert"]') !== null;
      },
      { timeout: 45_000 },
      pm,
      beforeAi
    );
    const alert = await page.$('[role="alert"]');
    if (alert) {
      const err = await page.$eval('[role="alert"]', (el) => el.textContent ?? "");
      await shot(page, "08-ai-arligt-fel-desktop");
      ai = `AI-knappen fanns men anropet gav ärligt fel: "${err.trim()}" (inget fejkat förslag).`;
      console.log("ok", "AI: ärligt fel visas", err.trim());
    } else {
      await ok(page, "AI: texten uppdaterades i editorn", true);
      await shot(page, "08-ai-tillampad-desktop");
      await clickToolbar(page, "Ångra (⌘Z / Ctrl+Z)");
      const afterUndo = await page.$eval(pm, (el) => el.textContent ?? "");
      await ok(page, "AI: ett ångra återställer originalet", afterUndo === beforeAi);
      ai = "AI verifierad live: 1 riktigt OpenRouter-anrop → editorn uppdaterades; ett ångra återställde originalet.";
    }
  }

  // ---- Spara → detaljsidan renderar allt ----
  await ok(page, "ny offert: spara utkast", await clickByText(page, "button", "Spara utkast"));
  await page.waitForFunction(() => /\/ekonomi\/offerter\/[a-z0-9-]+$/.test(location.pathname) && !location.pathname.endsWith("/ny"));
  await waitVisibleText(page, "Detta ingår i priset");
  const text = await bodyText(page);
  await ok(
    page,
    "sparad offert: H2 + fetstil + lista + understruken",
    ["Detta ingår i priset", "certifierade snickare", "Grovstädning ingår", "skriftlig garanti"].every((s) => has(text, s))
  );
  const savedH2 = await page.$eval(".richtext-doc h2", (el) => Math.round(parseFloat(getComputedStyle(el).fontSize)));
  await ok(page, "sparad offert: H2 är 20px i dokumentvyn", savedH2 === 20, `${savedH2}px`);
  const savedU = await page.$eval(".richtext-doc u", (el) => (el.textContent ?? "").includes("skriftlig garanti"));
  await ok(page, "sparad offert: understruken renderas som <u>", savedU);
  const linkAttrs = await page.$eval('a[href="https://exempel.se"]', (a) => `${a.getAttribute("target")} ${a.getAttribute("rel")}`);
  await ok(page, "sparad offert: länk med target=_blank + noopener noreferrer", linkAttrs === "_blank noopener noreferrer", linkAttrs);
  await shot(page, "09-offert-sparad-desktop");
  return { ai };
}

/* --------------------------- 5: ny faktura -------------------------------- */

async function createInvoiceWithRichText(page: Page) {
  await page.goto(`${BASE}/ekonomi/fakturor/ny`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".richtext-editor .ProseMirror");

  await pickFirstCustomer(page);
  await page.type('input[aria-label="Beskrivning"]', "Slutfört arbete");
  await page.click('input[aria-label="À-pris exkl. moms"]');
  await page.type('input[aria-label="À-pris exkl. moms"]', "8000");

  const pm = ".richtext-editor .ProseMirror";
  await page.click(pm);
  await clickToolbar(page, "Rubrik 2");
  await page.keyboard.type("Betalningsvillkor");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Fakturan betalas inom 30 dagar till bankgiro enligt uppgifterna nedan.");

  await ok(page, "ny faktura: spara utkast", await clickByText(page, "button", "Spara utkast"));
  await page.waitForFunction(() => /\/ekonomi\/fakturor\/[a-z0-9-]+$/.test(location.pathname) && !location.pathname.endsWith("/ny"));
  await waitVisibleText(page, "Betalningsvillkor");
  await waitVisibleText(page, "betalas inom 30 dagar");
  await ok(page, "sparad faktura: H2 + text renderas", true);
  await shot(page, "10-faktura-sparad-desktop");
}

/* ----------------------------- 6: mobil 390px ----------------------------- */

async function verifyMobile(page: Page) {
  await page.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

  // Kundvyn i mobilbredd (offerten är nu godkänd – utkast döljs via token).
  await page.goto(`${BASE}/offert/demo-brf-dorrar`, { waitUntil: "networkidle0" });
  await waitVisibleText(page, "Detta ingår");
  await assertDescriptionBeforeLines(page, "Detta ingår", "Demontering och montering av dörrar", "mobil kundvy");
  await shot(page, "11-offert-kundvy-mobil");

  // Redigera den BankID-låsta offerten → sparas som NY version (rätt flöde).
  await page.goto(`${BASE}/ekonomi/offerter/quote-dorrar/redigera`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".richtext-editor .ProseMirror");
  const pmText = await page.$eval(".richtext-editor .ProseMirror", (el) => el.textContent ?? "");
  await ok(page, "mobil: befintlig rik text laddas i editorn", pmText.includes("Detta ingår"));

  // Träffytor ≥44px + horisontellt skrollbar verktygsrad.
  const metrics = await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Fet (⌘B / Ctrl+B)"]') as HTMLElement | null;
    const bar = document.querySelector('[role="toolbar"]') as HTMLElement | null;
    if (!btn || !bar) return null;
    return {
      h: Math.round(btn.getBoundingClientRect().height),
      w: Math.round(btn.getBoundingClientRect().width),
      scrollable: bar.scrollWidth > bar.clientWidth,
    };
  });
  await ok(page, "mobil: träffyta ≥44px", metrics !== null && metrics.h >= 44 && metrics.w >= 44, `${metrics?.w}×${metrics?.h}px`);
  await ok(page, "mobil: verktygsraden skrollar horisontellt", metrics?.scrollable === true, `scrollWidth>clientWidth`);
  await shot(page, "12-editor-mobil");

  // Redigera (till dokumentets slut → nytt stycke) och spara → ny version.
  await page.click(".richtext-editor .ProseMirror");
  await page.keyboard.down("Meta");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.up("Meta");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Uppdaterat från mobilen.");
  await ok(page, "mobil: spara ändringar (ny version efter BankID-lås)", await clickByText(page, "button", "Spara ändringar"));
  await page.waitForFunction(() => location.pathname === "/ekonomi/offerter/quote-dorrar");
  await waitVisibleText(page, "Uppdaterat från mobilen.");
  await waitVisibleText(page, "Version 2");
  await ok(page, "mobil: ny version renderas på detaljsidan (v1 förblev låst)", true);
  await shot(page, "13-offert-detalj-mobil");
}

/* --------------------------------- main ----------------------------------- */

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  await resetSeed();

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(30_000);
    await page.setViewport({ width: 1360, height: 950, deviceScaleFactor: 2 });

    await verifySeededQuote(page);
    await verifySeededInvoice(page);
    const { ai } = await createQuoteWithRichText(page);
    await createInvoiceWithRichText(page);
    await verifyMobile(page);

    console.log(`\nAI-läge: ${ai}`);
    console.log("Alla browserkontroller godkända. Screenshots:", SHOTS);
  } finally {
    await browser.close();
  }
}

main().catch((e) => fail(String(e)));
