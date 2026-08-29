import { mkdirSync } from "node:fs";
import puppeteer, { type Page } from "puppeteer-core";

/**
 * Webbläsarpass för "Behöver din uppmärksamhet" på :3123.
 *
 *   1. Rubriken visar diskret räknare ("· N") = alla aktiva rader inkl. hopfällda.
 *   2. Initialt 5 rader + fullbredds-fot I kortet ("Visa N till ↓").
 *   3. Fot → expanderar på plats → "Visa färre ↑" → kollapsar igen.
 *   4. "Skicka påminnelse" på sen faktura → bekräftelsedialog (mottagare synlig),
 *      Avbryt skickar ingenting.
 *   5. ⋯-meny → Snooza → preset ("Imorgon") → raden försvinner + räknaren
 *      uppdateras utan omladdning; kvarstår efter omladdning (persistens).
 *   6. ⋯-meny → Snooza → "Välj datum …" → kalender → raden försvinner.
 *   7. Förfrågan: ⋯ → "Markera hanterad" → domänövergång; kunden kvar i registret.
 *   8. Offert: ⋯ → "Inte aktuell" → lätt bekräftelse → status avböjd.
 *   9. Påminnelse: ⋯ → "Ta bort" (befintlig dismiss-tjänst).
 *  10. Mobil 390: fot fullbredd ≥44px, ⋯ ≥44px, bottensheet med stora träffytor.
 *
 *   npx tsx scripts/verify-attention-browser.ts
 */

const BASE = "http://localhost:3123";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = ".shots";

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

async function gotoHome(page: Page) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
}

/** Läser rubrikens räknare ("Behöver din uppmärksamhet · N") → N, eller null. */
async function headingCount(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const h = Array.from(document.querySelectorAll("h2, h3")).find((el) =>
      (el.textContent ?? "").includes("Behöver din uppmärksamhet")
    );
    const m = /·\s*(\d+)/.exec(h?.textContent ?? "");
    return m ? Number(m[1]) : null;
  });
}

type CardState = { rows: string[]; footer: string | null; footerExpanded: string | null };

/** Kortets rader (titeltexter) + fotknappens etikett, allt INUTI samma kort. */
async function cardState(page: Page): Promise<CardState> {
  return page.evaluate(() => {
    const h = Array.from(document.querySelectorAll("h2, h3")).find((el) =>
      (el.textContent ?? "").includes("Behöver din uppmärksamhet")
    );
    const card = h?.parentElement?.parentElement?.querySelector(".card");
    if (!card) return { rows: [], footer: null, footerExpanded: null };
    const rows = Array.from(card.children)
      .filter((c) => c.tagName === "DIV")
      .map((c) => (c.querySelector("p")?.textContent ?? "").trim());
    const footerBtn = Array.from(card.children).find((c) => c.tagName === "BUTTON") as HTMLButtonElement | undefined;
    return {
      rows,
      footer: footerBtn ? (footerBtn.textContent ?? "").trim() : null,
      footerExpanded: footerBtn ? footerBtn.getAttribute("aria-expanded") : null,
    };
  });
}

async function clickFooter(page: Page) {
  await page.evaluate(() => {
    const h = Array.from(document.querySelectorAll("h2, h3")).find((el) =>
      (el.textContent ?? "").includes("Behöver din uppmärksamhet")
    );
    const card = h?.parentElement?.parentElement?.querySelector(".card");
    const btn = card ? Array.from(card.children).find((c) => c.tagName === "BUTTON") : null;
    (btn as HTMLButtonElement | null)?.click();
  });
}

/** Hittar attentionraden vars text/knappar matchar och klickar knappen med given etikett. */
async function clickInRow(page: Page, rowMatch: string, label: string): Promise<boolean> {
  return page.evaluate(
    (rowMatch, label) => {
      const h = Array.from(document.querySelectorAll("h2, h3")).find((el) =>
        (el.textContent ?? "").includes("Behöver din uppmärksamhet")
      );
      const card = h?.parentElement?.parentElement?.querySelector(".card");
      if (!card) return false;
      const row = Array.from(card.children).find(
        (c) => c.tagName === "DIV" && (c.textContent ?? "").includes(rowMatch)
      );
      if (!row) return false;
      const btn = Array.from(row.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").trim().includes(label)
      );
      if (!btn) return false;
      (btn as HTMLButtonElement).click();
      return true;
    },
    rowMatch,
    label
  );
}

/** Öppnar ⋯-menyn för raden som matchar texten. */
async function openOverflow(page: Page, rowMatch: string): Promise<boolean> {
  return page.evaluate((rowMatch) => {
    const h = Array.from(document.querySelectorAll("h2, h3")).find((el) =>
      (el.textContent ?? "").includes("Behöver din uppmärksamhet")
    );
    const card = h?.parentElement?.parentElement?.querySelector(".card");
    if (!card) return false;
    const row = Array.from(card.children).find(
      (c) => c.tagName === "DIV" && (c.textContent ?? "").includes(rowMatch)
    );
    const btn = row?.querySelector('button[aria-label^="Fler alternativ"]');
    if (!btn) return false;
    (btn as HTMLButtonElement).click();
    return true;
  }, rowMatch);
}

/** Klickar ett menyalternativ (role=menuitem) i den öppna menyn. */
async function clickMenuItem(page: Page, label: string): Promise<boolean> {
  return page.evaluate((label) => {
    const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
    const item = items.find((el) => (el.textContent ?? "").trim().startsWith(label));
    if (!item) return false;
    (item as HTMLElement).click();
    return true;
  }, label);
}

async function menuItemLabels(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="menuitem"]')).map((el) => (el.textContent ?? "").trim())
  );
}

async function waitForBody(page: Page, needle: string) {
  await page.waitForFunction((needle) => (document.body.textContent ?? "").includes(needle), { timeout: 20_000 }, needle);
}

async function shoot(page: Page, name: string, settleMs = 0) {
  if (settleMs > 0) await new Promise((r) => setTimeout(r, settleMs)); // låt fade-in bli klar
  await page.screenshot({ path: `${SHOTS}/${name}.png` as `${string}.png` });
}

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
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
    page.setDefaultTimeout(30_000);

    /* 1–2: räknare + initialt 5 rader + fot i kortet. */
    await gotoHome(page);
    const total = await headingCount(page);
    if (total === null) fail("rubriken saknar räknare (· N)");
    if (total < 6) fail(`seedet gav bara ${total} rader – förväntade ≥6 för expansionsflödet`);
    let card = await cardState(page);
    if (card.rows.length !== 5) fail(`initialt ${card.rows.length} rader, förväntade 5`);
    if (card.footer !== `Visa ${total - 5} till`) fail(`fel fot: ${card.footer}`);
    if (card.footerExpanded !== "false") fail(`fot saknar aria-expanded=false: ${card.footerExpanded}`);
    await shoot(page, "attention-desktop-collapsed");
    ok("1 rubrik med räknare + 5 rader + fot i kortet", `· ${total}, fot "Visa ${total - 5} till"`);

    /* 3: expandera på plats → Visa färre → kollaps. */
    await clickFooter(page);
    card = await cardState(page);
    if (card.rows.length !== total) fail(`efter expansion ${card.rows.length} rader, förväntade ${total}`);
    if (card.footer !== "Visa färre") fail(`fel fot efter expansion: ${card.footer}`);
    if (card.footerExpanded !== "true") fail("fot saknar aria-expanded=true efter expansion");
    await shoot(page, "attention-desktop-expanded");
    await clickFooter(page);
    card = await cardState(page);
    if (card.rows.length !== 5) fail("kollaps återställde inte 5 rader");
    ok("2 expansion på plats + Visa färre", `5 → ${total} → 5 rader, ingen navigering`);

    /* 4: bekräftelse före externt utskick (sen faktura). Avbryt = inget skickas. */
    await clickFooter(page); // expandera så alla rader nås
    const invoiceRow = (await cardState(page)).rows.find((r) => r.includes("dagar sen"));
    if (!invoiceRow) fail("ingen sen faktura-rad (”… är N dagar sen”) i seedet");
    if (!(await clickInRow(page, invoiceRow, "Skicka påminnelse")))
      fail("sen faktura-raden saknar [Skicka påminnelse]");
    await page.waitForSelector('[role="dialog"]');
    const dialogText = await page.evaluate(
      () => document.querySelector('[role="dialog"]')?.textContent ?? ""
    );
    if (!dialogText.includes("Skicka påminnelse?")) fail(`dialogrubrik saknas: ${dialogText.slice(0, 200)}`);
    if (!dialogText.includes("Mottagare") || !dialogText.includes("@"))
      fail("bekräftelsen visar inte mottagarens e-post");
    if (!dialogText.includes("Avbryt")) fail("Avbryt saknas i dialogen");
    await shoot(page, "attention-desktop-confirm", 450);
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('[role="dialog"] button')).find(
        (b) => (b.textContent ?? "").trim() === "Avbryt"
      );
      (btn as HTMLButtonElement | undefined)?.click();
    });
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    const bodyAfterCancel = await page.evaluate(() => document.body.textContent ?? "");
    if (bodyAfterCancel.includes("Påminnelse skickad")) fail("Avbryt skickade ändå!");
    ok("3 sen faktura → bekräftelsedialog med mottagare, Avbryt skickar inget", invoiceRow ?? "");

    /* 5: ⋯ → Snooza → Imorgon → räknare uppdateras direkt + persistens. */
    if (!(await openOverflow(page, invoiceRow))) fail("kunde inte öppna ⋯ för sena fakturan");
    let labels = await menuItemLabels(page);
    if (!labels.includes("Visa faktura")) fail(`"Visa faktura" saknas i menyn: ${labels.join(", ")}`);
    if (!labels.some((l) => l.includes("Snooza"))) fail("Snooza saknas i menyn");
    if (labels.some((l) => l.includes("Dölj") || l.includes("Ta bort")))
      fail("sen faktura får INTE ha permanent avfärdan");
    await shoot(page, "attention-desktop-menu");
    if (!(await clickMenuItem(page, "Snooza"))) fail("kunde inte klicka Snooza");
    labels = await menuItemLabels(page);
    for (const preset of ["Senare idag", "Imorgon", "Om 3 dagar", "Nästa vecka", "Välj datum"]) {
      if (!labels.some((l) => l.startsWith(preset))) fail(`snoozepreset saknas: ${preset} (${labels.join(", ")})`);
    }
    await shoot(page, "attention-desktop-snooze");
    if (!(await clickMenuItem(page, "Imorgon"))) fail("kunde inte klicka Imorgon");
    await waitForBody(page, "Uppskjuten – imorgon");
    let count = await headingCount(page);
    if (count !== total - 1) fail(`räknaren uppdaterades inte direkt: ${count} (förväntade ${total - 1})`);
    await gotoHome(page); // omladdning → persistens via attention_states
    count = await headingCount(page);
    if (count !== total - 1) fail(`snoozen överlevde inte omladdning: ${count}`);
    if ((await cardState(page)).rows.some((r) => r === invoiceRow))
      fail("snoozad rad syns fortfarande efter omladdning");
    ok("4 snooza Imorgon via ⋯", `räknare ${total} → ${total - 1} utan omladdning, persistent`);

    /* 6: ⋯ → Snooza → Välj datum → kalender. (Saknat kvitto-raden.) */
    await clickFooter(page);
    if (!(await openOverflow(page, "Kvitto saknas"))) fail("kunde inte öppna ⋯ för kvittoraden");
    if (!(await clickMenuItem(page, "Snooza"))) fail("kvittorad: Snooza saknas");
    if (!(await clickMenuItem(page, "Välj datum"))) fail("kvittorad: Välj datum saknas");
    await page.evaluate(() => {
      const trigger = Array.from(document.querySelectorAll('[role="menu"] button')).find((b) =>
        (b.textContent ?? "").includes("Välj dag")
      );
      (trigger as HTMLButtonElement | undefined)?.click();
    });
    await page.waitForSelector('[role="dialog"][aria-label="Välj datum"]');
    await page.evaluate(() => {
      (document.querySelector('button[aria-label="Nästa månad"]') as HTMLButtonElement).click();
    });
    await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="Välj datum"]');
      const day = Array.from(dialog?.querySelectorAll("button") ?? []).find(
        (b) => (b.textContent ?? "").trim() === "15" && !b.className.includes("text-muted")
      );
      (day as HTMLButtonElement | undefined)?.click();
    });
    await waitForBody(page, "Uppskjuten");
    await gotoHome(page);
    count = await headingCount(page);
    if (count !== total - 2) fail(`datumsnooze persisterade inte: ${count} (förväntade ${total - 2})`);
    ok("5 snooza Välj datum via kalendern", `räknare ${total - 1} → ${total - 2}`);

    /* 7: förfrågan → Markera hanterad (domänövergång, kunden kvar i registret). */
    await clickFooter(page);
    const inquiryRow = (await cardState(page)).rows.find((r) => r.startsWith("Ny förfrågan"));
    if (!inquiryRow) fail("ingen förfråganrad i seedet");
    // Kundnamnet står i undertexten ("Karin Lindqvist · …").
    const inquiryName = await page.evaluate((rowTitle) => {
      const h = Array.from(document.querySelectorAll("h2, h3")).find((el) =>
        (el.textContent ?? "").includes("Behöver din uppmärksamhet")
      );
      const card = h?.parentElement?.parentElement?.querySelector(".card");
      const row = Array.from(card?.children ?? []).find((c) => (c.textContent ?? "").includes(rowTitle));
      const sub = row?.querySelectorAll("p")[1]?.textContent ?? "";
      return sub.split("·")[0]?.trim() ?? "";
    }, inquiryRow);
    if (!inquiryName) fail("kunde inte läsa kundnamnet ur förfrågans undertext");
    if (!(await openOverflow(page, inquiryRow))) fail("kunde inte öppna ⋯ för förfrågan");
    labels = await menuItemLabels(page);
    if (!labels.includes("Visa förfrågan")) fail(`"Visa förfrågan" saknas: ${labels.join(", ")}`);
    if (!(await clickMenuItem(page, "Markera hanterad"))) fail("Markera hanterad saknas i menyn");
    await waitForBody(page, "Hanterad");
    count = await headingCount(page);
    if (count !== total - 3) fail(`räknaren efter Markera hanterad: ${count} (förväntade ${total - 3})`);
    await page.goto(`${BASE}/kunder?flik=forfragningar&visning=alla`, { waitUntil: "networkidle0" });
    const kunderBody = await page.evaluate(() => document.body.textContent ?? "");
    if (!kunderBody.includes(inquiryName)) fail(`förfrågan (${inquiryName}) försvann ur registret`);
    if (!kunderBody.includes("Hanterad")) fail("förfrågan saknar Hanterad-märkning i registret");
    ok("6 Markera hanterad på förfrågan", `${inquiryName} kvar i registret som Hanterad, borta ur uppmärksamhet`);

    /* 8: offert → Inte aktuell (lätt bekräftelse → status avböjd). */
    await gotoHome(page);
    await clickFooter(page);
    if (!(await openOverflow(page, "har väntat i"))) fail("kunde inte öppna ⋯ för offertraden");
    if (!(await clickMenuItem(page, "Inte aktuell"))) fail("Inte aktuell saknas i offertmenyn");
    await page.waitForSelector('[role="dialog"]');
    const dismissDialog = await page.evaluate(() => document.querySelector('[role="dialog"]')?.textContent ?? "");
    if (!dismissDialog.includes("Markera som inte aktuell?")) fail(`fel dialog: ${dismissDialog.slice(0, 150)}`);
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('[role="dialog"] button')).find(
        (b) => (b.textContent ?? "").trim() === "Inte aktuell"
      );
      (btn as HTMLButtonElement | undefined)?.click();
    });
    await waitForBody(page, "Markerad som inte aktuell");
    count = await headingCount(page);
    if (count !== total - 4) fail(`räknaren efter Inte aktuell: ${count}`);
    ok("7 Inte aktuell på offert med lätt bekräftelse", `räknare → ${total - 4}`);

    /* 9: påminnelse → ⋯ → Ta bort (befintlig dismiss-tjänst). */
    const INPUT = 'input[placeholder="Vad vill du göra?"]';
    await gotoHome(page);
    await page.click(INPUT);
    await page.type(INPUT, "Påminn mig idag kl 06:00 att kolla pannan");
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('[role="option"]')).some((el) =>
        (el.textContent ?? "").includes("Skapa påminnelse")
      )
    );
    await page.keyboard.press("Enter");
    await waitForBody(page, "påminner dig");
    await gotoHome(page);
    await clickFooter(page);
    if (!(await openOverflow(page, "kolla pannan"))) fail("kunde inte öppna ⋯ för påminnelsen");
    labels = await menuItemLabels(page);
    if (!labels.includes("Ta bort")) fail(`Ta bort saknas i påminnelsemenyn: ${labels.join(", ")}`);
    if (labels.some((l) => l.includes("Snooza")))
      fail("påminnelser ska INTE ha attention-snooze i menyn (egen domänsnooze finns inline)");
    if (!(await clickMenuItem(page, "Ta bort"))) fail("kunde inte klicka Ta bort");
    await waitForBody(page, "Borttagen");
    await gotoHome(page);
    const bodyAfterDismiss = await page.evaluate(() => document.body.textContent ?? "");
    if (bodyAfterDismiss.includes("kolla pannan")) fail("borttagen påminnelse syns fortfarande");
    ok("8 Ta bort på påminnelse via ⋯", "raden borta efter omladdning");

    /* 10: mobil 390 – fot fullbredd ≥44px, ⋯ ≥44px, bottensheet. */
    await resetSeed(); // tillbaka till 8 rader så foten finns (≤5 rader ⇒ ingen fot, korrekt)
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await gotoHome(page);
    const metrics = await page.evaluate(() => {
      const h = Array.from(document.querySelectorAll("h2, h3")).find((el) =>
        (el.textContent ?? "").includes("Behöver din uppmärksamhet")
      );
      const card = h?.parentElement?.parentElement?.querySelector(".card");
      if (!card) return null;
      const cardW = card.getBoundingClientRect().width;
      const footerBtn = Array.from(card.children).find((c) => c.tagName === "BUTTON");
      const f = footerBtn?.getBoundingClientRect();
      const more = card.querySelector('button[aria-label^="Fler alternativ"]');
      const m = more?.getBoundingClientRect();
      const primary = Array.from(card.querySelectorAll("button, a")).find((b) =>
        (b.textContent ?? "").includes("Skicka påminnelse")
      );
      const p = primary?.getBoundingClientRect();
      return {
        cardW,
        footer: f ? { w: f.width, h: f.height } : null,
        more: m ? { w: m.width, h: m.height } : null,
        primary: p ? { h: p.height } : null,
      };
    });
    if (!metrics?.footer) fail("mobil: fot saknas");
    if (metrics.footer.w < metrics.cardW - 4) fail(`mobil: foten är inte fullbredd (${metrics.footer.w}/${metrics.cardW})`);
    if (metrics.footer.h < 44) fail(`mobil: foten ${metrics.footer.h}px hög (<44)`);
    if (!metrics.more || metrics.more.h < 44 || metrics.more.w < 44)
      fail(`mobil: ⋯-knappen för liten: ${JSON.stringify(metrics.more)}`);
    if (metrics.primary && metrics.primary.h < 44) fail(`mobil: primärknapp ${metrics.primary.h}px (<44)`);
    await shoot(page, "attention-mobile");
    if (!(await openOverflow(page, ""))) fail("mobil: kunde inte öppna ⋯");
    await page.waitForSelector('[role="menu"]');
    const sheetMetrics = await page.evaluate(() => {
      const menu = document.querySelector('[role="menu"]');
      const items = Array.from(menu?.querySelectorAll('[role="menuitem"]') ?? []).map(
        (el) => el.getBoundingClientRect().height
      );
      const inModal = Boolean(menu?.closest('[role="dialog"]')) || Boolean(menu?.closest(".fixed"));
      return { items, inModal };
    });
    if (!sheetMetrics.inModal) fail("mobil: ⋯ öppnade ingen bottensheet");
    if (sheetMetrics.items.some((h) => h < 44)) fail(`mobil: menyalternativ <44px: ${sheetMetrics.items.join(", ")}`);
    await shoot(page, "attention-mobile-sheet", 450);
    ok("9 mobil 390", `fot ${Math.round(metrics.footer.w)}×${Math.round(metrics.footer.h)}px fullbredd, sheetalternativ ≥44px`);

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
