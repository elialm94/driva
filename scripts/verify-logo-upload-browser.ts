import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer, { type ElementHandle, type Page } from "puppeteer-core";

/**
 * Webbläsarpass för det kompakta logotypfältet (Inställningar → Företag) och
 * det återanvända mönstret i hemsidans sektions-/tjänsteredigerare.
 *
 *   1. Utgångsläge: initialer som förhandsvisning, en klick-/släppzon, INGEN separat "Välj bild"-knapp.
 *   2. Uppladdning via zonens filväljare → förhandsvisningen uppdateras direkt och
 *      autosparas (ingen "Spara ändringar" behövs) – överlever omladdning.
 *   3. Formulärkoherens: annan fältändring + fullt formulärspar backar inte logotypen.
 *   4. "Ta bort" autosparar borttagningen.
 *   5. Fel filtyp (GIF) → tydligt felmeddelande, inget sparas.
 *   6. Mobil 390: "Tryck för att välja bild", zon och Ta bort ≥44px, uppladdning fungerar.
 *   7. Hemsida: startsektionens bildfält är kompakt, uppladdning + Spara fungerar; tjänstemodal likaså.
 *
 *   npx tsx scripts/verify-logo-upload-browser.ts
 */

const BASE = "http://localhost:3123";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = new URL("../.shots/", import.meta.url).pathname;
const PNG_PATH = "/tmp/driva-logo-test.png";
const GIF_PATH = "/tmp/driva-logo-test.gif";

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

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}${name}` as `${string}.png`, fullPage: false });
  console.log(`    · skärmdump ${SHOTS}${name}`);
}

/** Logotypfältets rot på Inställningar (label "Logotyp" → förälder). Körs i sidan. */
const LOGO_ROOT = `
  (() => {
    const label = Array.from(document.querySelectorAll("label")).find((l) => (l.textContent ?? "").trim() === "Logotyp");
    return label ? label.parentElement : null;
  })()
`;

async function logoFileInput(page: Page): Promise<ElementHandle<HTMLInputElement>> {
  const handle = await page.evaluateHandle(`${LOGO_ROOT}?.querySelector('input[type="file"]') ?? null`);
  const el = handle.asElement();
  if (!el) fail("hittar inte logotypens filinput");
  return el as ElementHandle<HTMLInputElement>;
}

/** Vänta tills React hydrerat elementet (fiber-nyckel finns) – annars gör klick/uppladdning ingenting. */
async function waitForHydrated(page: Page, elementExpr: string) {
  await page.waitForFunction(`(() => {
    const el = ${elementExpr};
    if (!el) return false;
    return Object.keys(el).some((k) => k.startsWith("__reactFiber") || k.startsWith("__reactProps"));
  })()`);
}

async function settingsReady(page: Page) {
  await page.waitForFunction(`${LOGO_ROOT} !== null`);
  await waitForHydrated(page, `${LOGO_ROOT}?.querySelector('[role="button"]')`);
}

async function gotoSettings(page: Page) {
  await page.goto(`${BASE}/installningar?flik=foretag`, { waitUntil: "domcontentloaded" });
  await settingsReady(page);
}

/** Ladda om Inställningar; en hängd omladdning (kompilerings-storm) får ett nytt försök via goto. */
async function reloadSettings(page: Page) {
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
  } catch {
    await page.goto(`${BASE}/installningar?flik=foretag`, { waitUntil: "domcontentloaded" });
  }
  await settingsReady(page);
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  await resetSeed();
  // Minimal giltig 1×1-GIF – blockeras av filtypskontrollen (image/gif stöds inte).
  writeFileSync(
    GIF_PATH,
    Buffer.from("47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b", "hex")
  );

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
    page.setDefaultTimeout(60_000);
    // Dev-servern kan stanna länge i omkompilering när andra arbetsflöden rör filer.
    page.setDefaultNavigationTimeout(150_000);
    page.on("dialog", (d) => void d.accept());

    /* ---------------- 1. Utgångsläge på Inställningar → Företag ---------------- */
    await gotoSettings(page);

    // Testbild skapas i sidan (canvas) → giltig PNG på disk.
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 48;
      c.height = 48;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#c2410c";
      ctx.fillRect(0, 0, 48, 48);
      ctx.fillStyle = "#fff7ed";
      ctx.fillRect(10, 10, 28, 28);
      return c.toDataURL("image/png");
    });
    writeFileSync(PNG_PATH, Buffer.from(dataUrl.split(",")[1], "base64"));

    const initial = await page.evaluate(`(() => {
      const root = ${LOGO_ROOT};
      if (!root) return null;
      const initials = Array.from(root.querySelectorAll("div")).some((d) => (d.textContent ?? "").trim() === "SS");
      const zone = root.querySelector('[role="button"][aria-label="Ladda upp logotyp"]');
      const zoneText = zone ? zone.textContent ?? "" : "";
      const anyPickButton = Array.from(document.querySelectorAll("button")).some(
        (b) => (b.textContent ?? "").trim() === "Välj bild"
      );
      const img = root.querySelector('img[src^="data:image/"]');
      return { initials, hasZone: !!zone, zoneText, anyPickButton, hasImg: !!img };
    })()`) as { initials: boolean; hasZone: boolean; zoneText: string; anyPickButton: boolean; hasImg: boolean } | null;
    if (!initial) fail("logotypfältet hittades inte");
    if (!initial.initials) fail("initialerna (SS) visas inte som förhandsvisning");
    if (initial.hasImg) fail("oväntad logotypbild i utgångsläget");
    if (!initial.hasZone) fail("klickzonen med aria-label \"Ladda upp logotyp\" saknas");
    if (!initial.zoneText.includes("Klicka eller släpp logotyp här")) fail(`zonens text: ${initial.zoneText}`);
    if (!initial.zoneText.includes("JPG, PNG eller WebP · Valfritt")) fail(`formathinten saknas: ${initial.zoneText}`);
    if (initial.anyPickButton) fail("separat \"Välj bild\"-knapp finns kvar");
    await shot(page, "logo-01-installningar-initial.png");
    ok("1 utgångsläge: initialer + en zon, ingen Välj bild-knapp");

    // Tangentbord: fokusera zonen och tryck Enter → filväljaren öppnas (ingen mus behövs).
    const zoneHandle = await page.evaluateHandle(
      `${LOGO_ROOT}?.querySelector('[role="button"][aria-label="Ladda upp logotyp"]') ?? null`
    );
    const zoneEl = zoneHandle.asElement() as ElementHandle<HTMLElement> | null;
    if (!zoneEl) fail("zonen hittades inte för tangentbordstest");
    await zoneEl.focus();
    const [chooser] = await Promise.all([
      page.waitForFileChooser({ timeout: 15_000 }),
      page.keyboard.press("Enter"),
    ]);
    await chooser.cancel();
    ok("1b tangentbord: fokus + Enter öppnar filväljaren");

    /* ---------------- 2. Uppladdning autosparas ---------------- */
    await (await logoFileInput(page)).uploadFile(PNG_PATH);
    // Förhandsvisningen uppdateras direkt (optimistiskt) …
    await page.waitForFunction(`!!(${LOGO_ROOT}?.querySelector('img[src^="data:image/"]'))`);
    // … zonen byter till "Byt logotyp" och Ta bort dyker upp …
    await page.waitForFunction(`!!(${LOGO_ROOT}?.querySelector('[role="button"][aria-label="Byt logotyp"]'))`);
    const hasRemove = await page.evaluate(`(() => {
      const root = ${LOGO_ROOT};
      return !!root && Array.from(root.querySelectorAll("button")).some((b) => (b.textContent ?? "").trim() === "Ta bort");
    })()`);
    if (!hasRemove) fail("Ta bort-knappen saknas efter uppladdning");
    // … och autosparet går klart: formuläret blir "rent" igen utan att spara-knappen rörts.
    await page.waitForFunction(
      () => (document.body.textContent ?? "").includes("Inga osparade ändringar")
    );
    await shot(page, "logo-02-uppladdad.png");
    ok("2 uppladdning → direkt förhandsvisning + Byt logotyp + Ta bort, autosparad");

    // Överlever omladdning utan att spara-knappen använts.
    await reloadSettings(page);
    await page.waitForFunction(`!!(${LOGO_ROOT}?.querySelector('img[src^="data:image/"]'))`);
    const cleanAfterReload = await page.evaluate(() =>
      (document.body.textContent ?? "").includes("Inga osparade ändringar")
    );
    if (!cleanAfterReload) fail("formuläret är inte rent efter omladdning");
    await shot(page, "logo-03-reload-persist.png");
    ok("3 logotypen kvar efter omladdning (persisterad utan formulärspar)");

    /* ---------------- 3. Fullt formulärspar backar inte logotypen ---------------- */
    await page.evaluate(() => {
      const label = Array.from(document.querySelectorAll("label")).find((l) => (l.textContent ?? "").trim() === "Telefon");
      const input = label?.parentElement?.querySelector("input");
      if (!input) throw new Error("telefonfältet hittades inte");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "070-999 88 77");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll("button")).some(
        (b) => (b.textContent ?? "").trim() === "Spara ändringar" && !(b as HTMLButtonElement).disabled
      )
    );
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find(
        (b) => (b.textContent ?? "").trim() === "Spara ändringar" && !(b as HTMLButtonElement).disabled
      );
      (btn as HTMLButtonElement).click();
    });
    await page.waitForFunction(() => (document.body.textContent ?? "").includes("Ändringarna är sparade"));
    await reloadSettings(page);
    const logoAfterFullSave = await page.evaluate(`!!(${LOGO_ROOT}?.querySelector('img[src^="data:image/"]'))`);
    if (!logoAfterFullSave) fail("fullt formulärspar backade logotypen");
    ok("4 annan fältändring + Spara ändringar → logotypen ligger kvar");

    /* ---------------- 4. Ta bort autosparas ---------------- */
    await page.evaluate(`(() => {
      const root = ${LOGO_ROOT};
      const btn = root ? Array.from(root.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === "Ta bort") : null;
      if (btn) btn.click();
    })()`);
    await page.waitForFunction(`(() => {
      const root = ${LOGO_ROOT};
      if (!root) return false;
      const noImg = !root.querySelector('img[src^="data:image/"]');
      const initials = Array.from(root.querySelectorAll("div")).some((d) => (d.textContent ?? "").trim() === "SS");
      return noImg && initials;
    })()`);
    await page.waitForFunction(() => (document.body.textContent ?? "").includes("Inga osparade ändringar"));
    await reloadSettings(page);
    await page.waitForFunction(`(() => {
      const root = ${LOGO_ROOT};
      if (!root) return false;
      return !root.querySelector('img[src^="data:image/"]') &&
        Array.from(root.querySelectorAll("div")).some((d) => (d.textContent ?? "").trim() === "SS");
    })()`);
    await shot(page, "logo-04-borttagen.png");
    ok("5 Ta bort → initialerna tillbaka, borttagningen autosparad och kvar efter omladdning");

    /* ---------------- 5. Fel filtyp ger tydligt fel ---------------- */
    await (await logoFileInput(page)).uploadFile(GIF_PATH);
    await page.waitForFunction(`(${LOGO_ROOT}?.textContent ?? "").includes("Filformatet stöds inte.")`);
    const stillNoImg = await page.evaluate(`!(${LOGO_ROOT}?.querySelector('img[src^="data:image/"]'))`);
    if (!stillNoImg) fail("GIF:en laddades upp trots filtypsfel");
    await shot(page, "logo-05-fel-filtyp.png");
    ok("6 GIF avvisas med \"Filformatet stöds inte.\", inget sparas");

    /* ---------------- 6. Mobil 390 ---------------- */
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await gotoSettings(page);
    const mobile = await page.evaluate(`(() => {
      const root = ${LOGO_ROOT};
      const zone = root?.querySelector('[role="button"][aria-label="Ladda upp logotyp"]');
      if (!zone) return null;
      const rect = zone.getBoundingClientRect();
      // "Tryck för att välja bild" är mobilversionen (sm:hidden) – kontrollera att den faktiskt syns.
      const touchSpan = Array.from(zone.querySelectorAll("span")).find(
        (s) => (s.textContent ?? "").trim() === "Tryck för att välja bild"
      );
      const touchVisible = touchSpan ? getComputedStyle(touchSpan).display !== "none" : false;
      const desktopSpan = Array.from(zone.querySelectorAll("span")).find(
        (s) => (s.textContent ?? "").includes("Klicka eller släpp")
      );
      const desktopHidden = desktopSpan ? getComputedStyle(desktopSpan).display === "none" : true;
      return { h: rect.height, touchVisible, desktopHidden };
    })()`) as { h: number; touchVisible: boolean; desktopHidden: boolean } | null;
    if (!mobile) fail("mobil: zonen hittades inte");
    // Math.round: DPR-2-rendering kan rapportera 43.99997 för en CSS-höjd på exakt 44px.
    if (Math.round(mobile.h) < 44) fail(`mobil: zonen är ${mobile.h}px hög (<44)`);
    if (!mobile.touchVisible) fail("mobil: \"Tryck för att välja bild\" syns inte");
    if (!mobile.desktopHidden) fail("mobil: desktopcopyn med dra-och-släpp syns på mobil");
    await shot(page, "logo-06-mobil-tom.png");
    ok("7 mobil: tryckyta med rätt copy", `zonhöjd=${Math.round(mobile.h)}px`);

    await (await logoFileInput(page)).uploadFile(PNG_PATH);
    await page.waitForFunction(`!!(${LOGO_ROOT}?.querySelector('img[src^="data:image/"]'))`);
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll("button")).some((b) => (b.textContent ?? "").trim() === "Inga osparade ändringar")
    );
    const removeBox = await page.evaluate(`(() => {
      const root = ${LOGO_ROOT};
      const btn = root ? Array.from(root.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === "Ta bort") : null;
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { h: r.height };
    })()`) as { h: number } | null;
    if (!removeBox) fail("mobil: Ta bort-knappen saknas efter uppladdning");
    if (Math.round(removeBox.h) < 44) fail(`mobil: Ta bort är ${removeBox.h}px hög (<44)`);
    await shot(page, "logo-07-mobil-uppladdad.png");
    ok("8 mobil: uppladdning fungerar, Ta bort ≥44px", `höjd=${Math.round(removeBox.h)}px`);

    /* ---------------- 7. Hemsida: samma mönster i sektionseditorn ---------------- */
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
    await page.goto(`${BASE}/hemsida`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[aria-label="Redigera startsektion"]');
    await waitForHydrated(page, `document.querySelector('[aria-label="Redigera startsektion"]')`);
    await page.click('[aria-label="Redigera startsektion"]');
    await page.waitForFunction(() => (document.body.textContent ?? "").includes("Bild (valfritt)"));
    // Vänta tills en ev. befintlig bild hämtats (filinputen är disabled under hämtning).
    await page.waitForFunction(() => {
      const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
      const last = inputs[inputs.length - 1] as HTMLInputElement | undefined;
      return !!last && !last.disabled;
    });
    const heroModal = await page.evaluate(() => {
      const zone = document.querySelector('[role="button"][aria-label="Ladda upp bild"], [role="button"][aria-label="Byt bild"]');
      const anyPickButton = Array.from(document.querySelectorAll("button")).some(
        (b) => (b.textContent ?? "").trim() === "Välj bild"
      );
      return { hasZone: !!zone, anyPickButton };
    });
    if (!heroModal.hasZone) fail("hemsida: kompakt bildzon saknas i startsektionens redigerare");
    if (heroModal.anyPickButton) fail("hemsida: separat Välj bild-knapp finns kvar i redigeraren");
    const heroInputs = await page.$$('input[type="file"]');
    await heroInputs[heroInputs.length - 1].uploadFile(PNG_PATH);
    await page.waitForFunction(`!!document.querySelector('[role="button"][aria-label="Byt bild"]')`);
    await shot(page, "logo-08-hemsida-hero-editor.png");
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find(
        (b) => (b.textContent ?? "").trim() === "Spara ändringar" && !(b as HTMLButtonElement).disabled
      );
      (btn as HTMLButtonElement).click();
    });
    await page.waitForFunction(() => !(document.body.textContent ?? "").includes("Redigera startsektion"));
    ok("9 hemsida: startsektionens bild laddas upp i kompakta zonen och sparas");

    // Bilden är kvar när redigeraren öppnas igen (persisterad via updateSectionAction).
    await page.click('[aria-label="Redigera startsektion"]');
    await page.waitForFunction(() => {
      const modal = (document.body.textContent ?? "").includes("Bild (valfritt)");
      const img = Array.from(document.querySelectorAll('img[src^="data:image/"]')).length > 0;
      return modal && img;
    });
    await shot(page, "logo-09-hemsida-hero-sparad.png");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !(document.body.textContent ?? "").includes("Redigera startsektion"));
    ok("10 hemsida: sparad sektionsbild visas som förhandsvisning vid nästa öppning");

    // Tjänstemodal: samma kompakta fält, ingen dubblerad knapp. (Enbart presentation – Avbryt.)
    await page.waitForSelector('[aria-label="Redigera tjänster"]');
    await page.evaluate(() => {
      (document.querySelector('[aria-label="Redigera tjänster"]') as HTMLButtonElement | null)?.click();
    });
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('[aria-label="Redigera tjänst"]')).length > 0
    );
    await page.evaluate(() => {
      (document.querySelector('[aria-label="Redigera tjänst"]') as HTMLButtonElement | null)?.click();
    });
    await page.waitForFunction(() => (document.body.textContent ?? "").includes("Bild (valfritt)"));
    const serviceModal = await page.evaluate(() => {
      const zone = document.querySelector('[role="button"][aria-label="Ladda upp bild"], [role="button"][aria-label="Byt bild"]');
      const anyPickButton = Array.from(document.querySelectorAll("button")).some(
        (b) => (b.textContent ?? "").trim() === "Välj bild"
      );
      return { hasZone: !!zone, anyPickButton };
    });
    if (!serviceModal.hasZone) fail("tjänstemodal: kompakt bildzon saknas");
    if (serviceModal.anyPickButton) fail("tjänstemodal: separat Välj bild-knapp finns kvar");
    await shot(page, "logo-10-tjanst-editor.png");
    ok("11 tjänstemodal: kompakt bildfält utan dubblerad knapp");

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
