/**
 * Probe: förenklad "Ny kund" + progressiv validering.
 *
 *  1. /kunder → Ny kund: bara namn krävs; personnummer syns INTE som
 *     standard; "+ Fler uppgifter" och "+ Lägg till fastighet" finns.
 *     "Erik" → Skapa kund → kundkortet öppnas.
 *  2. Ny offert till Erik (utan e-post) → Skicka offert → "E-postadress
 *     saknas" med inline-fält → fyll i → sändningen FORTSÄTTER direkt
 *     till bekräftelsen och offerten blir skickad.
 *  3. Mobil (390×844): modalen är användbar – fält och Skapa kund nås.
 */
import puppeteer from "puppeteer-core";

const BASE = "http://localhost:3123";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function fail(msg: string): never {
  console.error("FAIL", msg);
  process.exit(1);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  page.on("dialog", (d) => d.accept());

  async function ok(name: string, cond: boolean, extra = "") {
    if (!cond) fail(`${name} ${extra} url=${page.url()}`);
    console.log("ok", name, extra);
  }

  /** Klicka första SYNLIGA knapp/länk vars text innehåller `text` (ev. inom `scope`). */
  async function clickByText(text: string, scope = "body") {
    const clicked = await page.evaluate(
      (t, s) => {
        const roots = Array.from(document.querySelectorAll(s));
        for (const root of roots) {
          const els = Array.from(root.querySelectorAll("button, a")) as HTMLElement[];
          const el = els.find(
            (e) => e.getClientRects().length > 0 && (e.textContent ?? "").replace(/\s+/g, " ").trim().includes(t)
          );
          if (el) {
            el.click();
            return true;
          }
        }
        return false;
      },
      text,
      scope
    );
    if (!clicked) fail(`hittade ingen synlig knapp/länk med texten "${text}" i ${scope} url=${page.url()}`);
  }

  async function dialogHasText(text: string): Promise<boolean> {
    return page.evaluate((t) => {
      const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
      return dialogs.some((d) => (d.textContent ?? "").includes(t));
    }, text);
  }

  /* ---------------- 1. Ny kund: bara namn ---------------- */
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/kunder`, { waitUntil: "networkidle0" });
  await clickByText("Ny kund");
  await page.waitForSelector("#ny-kund-namn");

  await ok("1 personnummer är inte ett standardfält", (await page.$("#ny-kund-personnummer")) === null);
  await ok("1 e-post är inte required", await page.evaluate(() => !(document.getElementById("ny-kund-epost") as HTMLInputElement).required));
  await ok("1 + Fler uppgifter finns", await dialogHasText("Fler uppgifter"));
  await ok("1 + Lägg till fastighet finns", await dialogHasText("Lägg till fastighet"));
  await ok("1 fastighetsfältet är hopfällt", (await page.$("#fastighetsbeteckning")) === null);

  // Fler uppgifter (privat) visar personnummer när man ber om det
  await clickByText("Fler uppgifter", 'div[role="dialog"]');
  await page.waitForSelector("#ny-kund-personnummer");
  await ok("1 personnummer under Fler uppgifter", true);

  // Lägg till fastighet visar beteckningsfältet
  await clickByText("Lägg till fastighet", 'div[role="dialog"]');
  await page.waitForSelector("#fastighetsbeteckning");
  await ok("1 fastighetsfält efter + Lägg till fastighet", true);

  // Skapa med BARA namn (personnummer/fastighet lämnas tomma)
  await page.type("#ny-kund-namn", "Erik");
  await clickByText("Skapa kund", 'div[role="dialog"]');
  await page.waitForFunction(() => /^\/kunder\/[^/]+$/.test(location.pathname));
  const erikUrl = page.url();
  await page.waitForFunction(() => (document.querySelector("h1")?.textContent ?? "").includes("Erik"));
  await ok("1 Erik skapad med bara namn → kundkort", true, erikUrl);

  /* ------- 2. Skicka offert utan e-post → komplettera inline → fortsätt ------- */
  await clickByText("Ny offert");
  await page.waitForSelector("#offert-rubrik");
  await page.type("#offert-rubrik", "Altanbygge");
  await page.type("#rad-start-arbete-beskrivning", "Montering altan");
  await page.click("#rad-start-arbete-pris");
  await page.type("#rad-start-arbete-pris", "50000");
  await clickByText("Spara utkast");
  await page.waitForFunction(
    () => /^\/ekonomi\/offerter\/[^/]+$/.test(location.pathname) && !location.pathname.endsWith("/ny")
  );
  await ok("2 offertutkast sparat", true, page.url());

  // Checklistan namnger saknad e-post explicit
  await page.waitForSelector("#quote-send-blockers");
  const checklist = await page.$eval("#quote-send-blockers", (el) => el.textContent ?? "");
  await ok("2 checklistan namnger e-post", checklist.includes("e-postadress"), checklist.trim().slice(0, 80));

  // Skicka → prompten frågar om exakt det som saknas, inline
  await clickByText("Skicka offert");
  await page.waitForSelector("#komplettera-epost");
  await ok("2 inline e-postfält i skickaflödet", await dialogHasText("saknar e-postadress"));
  await page.type("#komplettera-epost", "erik@example.se");
  await clickByText("Spara och fortsätt", 'div[role="dialog"]');

  // …och flödet FORTSÄTTER direkt till bekräftelsen
  await page.waitForFunction(() => {
    const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
    return dialogs.some((d) => (d.textContent ?? "").includes("Skicka offert?"));
  });
  await ok("2 fortsätter till bekräftelsen utan omstart", true);
  await clickByText("Skicka offert", 'div[role="dialog"]');
  await page.waitForFunction(() => /[?&]skickad=(1|manuell)/.test(location.search));
  await page.waitForFunction(() =>
    /(skickades till|markerad som skickad)/.test(document.body.textContent ?? "")
  );
  await ok("2 offerten skickad efter komplettering", true, page.url());

  // E-posten sparades på kundkortet
  await page.goto(erikUrl, { waitUntil: "networkidle0" });
  const hasEmail = await page.evaluate(() => (document.body.textContent ?? "").includes("erik@example.se"));
  await ok("2 e-posten sparad på kunden", hasEmail);

  /* ---------------- 3. Mobil: modalen är användbar ---------------- */
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${BASE}/kunder`, { waitUntil: "networkidle0" });
  await clickByText("Skapa"); // mobilens skapa-meny
  await clickByText("Ny kund");
  await page.waitForSelector("#ny-kund-namn");
  const layout = await page.evaluate(() => {
    const name = document.getElementById("ny-kund-namn")!.getBoundingClientRect();
    const submit = Array.from(document.querySelectorAll('div[role="dialog"] button')).find((b) =>
      (b.textContent ?? "").includes("Skapa kund")
    );
    const dialog = document.querySelector('div[role="dialog"]')!.getBoundingClientRect();
    const submitRect = submit ? submit.getBoundingClientRect() : null;
    return {
      nameVisible: name.width > 0 && name.left >= 0 && name.right <= window.innerWidth,
      dialogFits: dialog.width <= window.innerWidth + 1,
      hasSubmit: Boolean(submitRect),
      submitReachable: submitRect ? submitRect.top < window.innerHeight + 400 : false,
      noHorizontalScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
    };
  });
  await ok("3 mobil: namnfält inom viewport", layout.nameVisible);
  await ok("3 mobil: modalen ryms i bredd", layout.dialogFits && layout.noHorizontalScroll);
  await ok("3 mobil: Skapa kund nåbar", layout.hasSubmit && layout.submitReachable);

  await page.type("#ny-kund-namn", "Mobil-Erika");
  await clickByText("Skapa kund", 'div[role="dialog"]');
  await page.waitForFunction(() => /^\/kunder\/[^/]+$/.test(location.pathname));
  await ok("3 mobil: kund skapad med bara namn", true, page.url());

  await browser.close();
  console.log("\nAlla ny kund-probes klara ✓");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
