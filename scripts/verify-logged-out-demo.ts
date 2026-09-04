/**
 * E2E-verifiering av den utloggade upplevelsen + publika demosessionen
 * (JSON + cookie-modellen).
 *
 * Kör mot en lokal dev-server (npm run dev, port 3123) i Supabase-läge
 * (miljövariabler i .env.local). Den lokala Supabase-stacken behöver INTE
 * vara igång: demon bor i JSON-filer (.data/demo-sessions/<id>.json), aldrig
 * i databasen – att hela sviten går igenom med stacken avstängd är i sig
 * beviset på att demon inte rör Postgres.
 *
 * Varje besökarkontext är en egen inkognitoprofil (egen cookie jar), precis
 * som separata webbläsare. Isoleringen verifieras BÅDE i UI:t och direkt mot
 * sessionernas JSON-filer.
 *
 *   npx tsx scripts/verify-logged-out-demo.ts
 *
 * Screenshots hamnar i .data/e2e-utloggad/. Signup→verifiering→onboarding
 * kräver riktig auth (Supabase + mejl) och ingår därför inte här.
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer, { type Browser, type BrowserContext, type Page } from "puppeteer-core";

const BASE = "http://localhost:3123";
const CHROME =
  ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(
    (p) => fs.existsSync(p)
  ) ?? "/usr/bin/google-chrome";
const OUT = path.join(process.cwd(), ".data", "e2e-utloggad");
const SESSIONS_DIR = path.join(process.cwd(), ".data", "demo-sessions");
const DEV_LOG = path.join(process.cwd(), ".data", "dev-3123.log");

let passed = 0;
let failed = 0;
const failures: string[] = [];

function ok(name: string) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function fail(name: string, detail: string) {
  failed += 1;
  failures.push(`${name}: ${detail}`);
  console.error(`  ✗ ${name}\n    ${detail.split("\n").slice(0, 6).join("\n    ")}`);
}

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    ok(name);
  } catch (e) {
    fail(name, e instanceof Error ? (e.stack ?? e.message) : String(e));
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** Demokakan i kontextens cookie jar (kakan är httpOnly – CDP ser den ändå). */
async function demoCookie(ctx: BrowserContext): Promise<{ value: string; httpOnly: boolean } | null> {
  const cookie = (await ctx.cookies()).find((c) => c.name === "driva_demo");
  return cookie ? { value: cookie.value, httpOnly: cookie.httpOnly } : null;
}

/** Session-id:t ur kakvärdet "utgångstid.session-id". */
function sessionIdOf(cookieValue: string): string {
  const id = cookieValue.split(".")[1] ?? "";
  assert(/^[a-z0-9]{20,64}$/.test(id), `oväntat kakvärde: ${cookieValue}`);
  return id;
}

function sessionFile(id: string): string {
  return path.join(SESSIONS_DIR, `${id}.json`);
}

/** Sessionens JSON-fil – verifieringar sker mot filen, aldrig mot en databas. */
function readSessionFile(id: string): {
  meta: { demo?: boolean };
  settings: { name: string };
  customers: Array<{ name: string }>;
  quotes: Array<{ id: string }>;
  jobs: Array<{ title: string }>;
} {
  return JSON.parse(fs.readFileSync(sessionFile(id), "utf8"));
}

function fileHasCustomer(id: string, name: string): boolean {
  return readSessionFile(id).customers.some((c) => c.name === name);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) as `${string}.png`, fullPage: true });
  console.log(`    ⭳ ${path.join(".data/e2e-utloggad", `${name}.png`)}`);
}

async function newPage(ctx: BrowserContext, width = 1440, height = 900): Promise<Page> {
  const page = await ctx.newPage();
  await page.setViewport({ width, height });
  page.setDefaultTimeout(20000);
  // Osparade utkast väcker beforeunload-dialoger som annars fryser navigeringen.
  page.on("dialog", (d) => void d.accept().catch(() => undefined));
  return page;
}

/** innerText gemener: CSS text-transform (uppercase-rubriker) ska inte fälla textjämförelser. */
async function text(page: Page): Promise<string> {
  return (await page.evaluate(() => document.body?.innerText ?? "")).toLowerCase();
}

function has(t: string, needle: string): boolean {
  return t.includes(needle.toLowerCase());
}

async function clickByText(page: Page, selector: string, needle: string) {
  const handles = await page.$$(selector);
  const want = needle.toLowerCase();
  for (const h of handles) {
    const t = ((await h.evaluate((el) => (el as HTMLElement).innerText ?? el.textContent ?? "")) || "")
      .trim()
      .toLowerCase();
    if (t.includes(want)) {
      await h.evaluate((el) => (el as HTMLElement).scrollIntoView({ block: "center" }));
      try {
        await h.click();
      } catch {
        await h.evaluate((el) => (el as HTMLElement).click());
      }
      return;
    }
  }
  throw new Error(`Hittade ingen ${selector} med texten "${needle}"`);
}

async function waitForText(page: Page, needle: string, timeoutMs = 20000) {
  await page.waitForFunction(
    (n: string) => (document.body?.innerText ?? "").toLowerCase().includes(n),
    { timeout: timeoutMs },
    needle.toLowerCase()
  );
}

async function gotoOk(page: Page, url: string) {
  const res = await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
  assert(res, `Ingen respons för ${url}`);
  assert(res.status() < 400, `${url} → HTTP ${res.status()}`);
}

/** Dev-loggen från en byteposition (statSync.size) – aldrig String.slice på ett byteindex (multibyte-svenska). */
function devLogSince(byteOffset: number): string {
  if (!fs.existsSync(DEV_LOG)) return "";
  const buf = fs.readFileSync(DEV_LOG);
  return buf.subarray(Math.min(byteOffset, buf.length)).toString("utf8");
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const browser: Browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=sv-SE"],
  });

  try {
    // ------------------------------------------------------------------
    console.log("\n(a) Landningssidan – utloggad /:");
    const ctxLanding = await browser.createBrowserContext();
    {
      const page = await newPage(ctxLanding);
      await gotoOk(page, `${BASE}/`);
      await check("utloggad / visar landningssidan med all nyckelcopy", async () => {
        const t = await text(page);
        for (const needle of [
          "Driva ditt företag. Inte administrationen.",
          "Testa gratis i 14 dagar",
          "Se demo",
          "199 kr/mån",
          "Inget kort krävs",
          "Säg upp när du vill",
          "Så fungerar det",
          "Redo att slippa administrationen?",
        ]) {
          assert(has(t, needle), `saknar "${needle}"`);
        }
        assert(page.url() === `${BASE}/`, `URL blev ${page.url()} (redirect-loop?)`);
      });
      await check("SEO-titel och beskrivning", async () => {
        const title = await page.title();
        assert(title.includes("Driva – mindre administration"), `titel: ${title}`);
        const desc = await page.$eval('meta[name="description"]', (el) => el.getAttribute("content") ?? "");
        assert(desc.includes("Testa gratis i 14 dagar"), `description: ${desc}`);
      });
      await check("landningssidan sätter ingen demokaka och laddar inte Google Maps", async () => {
        assert((await demoCookie(ctxLanding)) === null, "driva_demo sattes redan på landningssidan");
        const external = await page.evaluate(() =>
          Array.from(document.querySelectorAll("script[src]")).map((s) => (s as HTMLScriptElement).src)
        );
        assert(!external.some((s) => s.includes("maps.googleapis")), `Maps-script: ${external.join(", ")}`);
      });
      await shot(page, "landing-desktop");
      await page.setViewport({ width: 390, height: 844 });
      await page.reload({ waitUntil: "networkidle2" });
      await shot(page, "landing-mobil");

      await check("footerlänkarna Villkor/Integritetspolicy/Logga in fungerar", async () => {
        for (const [href, needle] of [
          ["/villkor", "Allmänna villkor"],
          ["/integritet", "Integritetspolicy"],
          ["/login", "Logga in"],
        ] as const) {
          await gotoOk(page, `${BASE}${href}`);
          const t = await text(page);
          assert(has(t, needle), `${href} saknar "${needle}"`);
        }
      });
      await check("login-sidan har Glömt lösenord, Skapa konto och Se demo-rad", async () => {
        await gotoOk(page, `${BASE}/login`);
        const t = await text(page);
        for (const needle of ["Glömt lösenord", "Skapa konto", "Vill du testa först?", "Se demo"]) {
          assert(has(t, needle), `saknar "${needle}"`);
        }
      });
      await page.close();
    }

    // ------------------------------------------------------------------
    console.log("\n(b) Se demo → cookie + egen JSON-fil, direkt in i produkten:");
    const ctxA = await browser.createBrowserContext();
    let sesA = "";
    {
      const page = await newPage(ctxA);
      await gotoOk(page, `${BASE}/`);
      await check("Se demo går direkt in i appen som Södermalms Snickeri", async () => {
        await Promise.all([
          page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }),
          clickByText(page, "a", "Se demo"),
        ]);
        assert(new URL(page.url()).pathname === "/", `hamnade på ${page.url()}`);
        // Appskalet (inte landningssidan): demosessionens attribut på rotdiven.
        await page.waitForSelector("[data-driva-demo]", { timeout: 20000 });
        const t = await text(page);
        assert(has(t, "Södermalms Snickeri"), "företagsnamnet saknas i appskalet");
        assert(has(t, "Behöver din uppmärksamhet") || has(t, "Att göra"), "dashboard-innehåll saknas");
      });
      await check("httpOnly-kakan pekar på sessionens egen JSON-fil (klon av seedet)", async () => {
        const cookie = await demoCookie(ctxA);
        assert(cookie, "driva_demo-kakan saknas");
        assert(cookie.httpOnly, "driva_demo är inte httpOnly");
        sesA = sessionIdOf(cookie.value);
        assert(fs.existsSync(sessionFile(sesA)), `sessionsfilen saknas: ${sessionFile(sesA)}`);
        const state = readSessionFile(sesA);
        assert(state.meta.demo === true, "meta.demo är inte true i sessionsfilen");
        assert(state.settings.name.includes("Södermalms Snickeri"), `seedbolag: ${state.settings.name}`);
        assert(state.customers.length > 0, "seedkunder saknas i sessionsfilen");
      });
      await check("diskret demo-indikator + konto-CTA i appskalet", async () => {
        const t = await text(page);
        assert(has(t, "Avsluta demo") || has(t, "Demo"), "demo-indikator saknas");
        assert(has(t, "Skapa eget konto") || has(t, "Skapa ditt eget konto"), "konto-CTA saknas");
      });
      await shot(page, "demo-hem");
      await page.close();
    }

    // ------------------------------------------------------------------
    console.log("\n(c) Demo A muterar: kund, offert, uppdrag, faktura + reload:");
    {
      const page = await newPage(ctxA);

      await check("skapa kund i demon", async () => {
        await gotoOk(page, `${BASE}/kunder`);
        await clickByText(page, "button, a", "Ny kund");
        await page.waitForSelector("#ny-kund-namn", { visible: true });
        await page.type("#ny-kund-namn", "Anna Testkund E2E");
        await page.type("#ny-kund-epost", "anna.e2e@example.se");
        await page.type("#ny-kund-telefon", "070-111 22 33");
        await clickByText(page, "[role=dialog] button[type=submit]", "Skapa kund");
        await waitForText(page, "Anna Testkund E2E");
      });

      await check("skapa offert (utkast) i demon", async () => {
        // Offerten skapas för E2E-kunden (id ur sessionens JSON-fil) så att
        // skickaflödet i (d) har en komplett mottagare utan ROT-blockerare.
        const kundId = readSessionFile(sesA).customers.find((c) => c.name === "Anna Testkund E2E")?.id;
        assert(kundId, "E2E-kundens id hittades inte i sessionsfilen");
        await gotoOk(page, `${BASE}/ekonomi/offerter/ny?kund=${kundId}`);
        await page.waitForSelector("#offert-rubrik", { visible: true });
        await page.type("#offert-rubrik", "Altantrappa E2E");
        // Minst en komplett prisrad krävs för att spara. Radens beskrivning
        // är fältet med "Vad ingår?"-placeholder (inte offertbeskrivningen).
        await page.type('[placeholder^="Vad ingår?"]', "Arbete altantrappa");
        await page.keyboard.press("Escape"); // stäng ev. förslagslista
        const price = await page.$('#rad-start-arbete-pris');
        assert(price, "à-prisfältet saknas");
        await price.click({ clickCount: 3 });
        await price.type("5000");
        await clickByText(page, "button", "Spara utkast");
        await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => undefined);
        await waitForText(page, "Altantrappa E2E");
      });

      await check("skapa uppdrag i demon", async () => {
        // Uppdragslistan bor på /uppdrag; skapaknappen heter "Uppdrag".
        await gotoOk(page, `${BASE}/uppdrag`);
        const opener = await page.$('button[aria-label="Uppdrag"]');
        assert(opener, "skapa uppdrag-knappen hittades inte");
        await opener.click();
        await page.waitForSelector('[role=dialog] input[name="title"]', { visible: true });
        await page.type('[role=dialog] input[name="title"]', "Trallbyte E2E");
        await clickByText(page, "[role=dialog] button[type=submit]", "Skapa uppdrag");
        await waitForText(page, "Trallbyte E2E", 30000);
      });

      await check("skapa faktura (utkast) i demon", async () => {
        await gotoOk(page, `${BASE}/ekonomi/fakturor/ny`);
        await page.waitForSelector('[placeholder^="Vad ingår?"]', { visible: true });
        await page.type('[placeholder^="Vad ingår?"]', "Arbete faktura E2E");
        await page.keyboard.press("Escape"); // stäng ev. förslagslista
        const price = await page.$('#rad-start-arbete-pris');
        assert(price, "à-prisfältet saknas");
        await price.click({ clickCount: 3 });
        await price.type("2500");
        await clickByText(page, "button", "Spara utkast");
        await page.waitForFunction(
          () => /\/ekonomi\/fakturor\/[^/]+$/.test(location.pathname) && !location.pathname.endsWith("/ny"),
          { timeout: 30000 }
        );
        await waitForText(page, "utkast", 15000);
      });

      await check("reload behåller demo A:s ändringar (samma fil)", async () => {
        await gotoOk(page, `${BASE}/kunder`);
        await page.reload({ waitUntil: "networkidle2" });
        await waitForText(page, "Anna Testkund E2E");
        await gotoOk(page, `${BASE}/ekonomi?flik=offerter`);
        await waitForText(page, "Altantrappa E2E");
        await gotoOk(page, `${BASE}/uppdrag`);
        await waitForText(page, "Trallbyte E2E");
      });
      await check("ändringarna landade i A:s JSON-fil – och bara där", async () => {
        assert(fileHasCustomer(sesA, "Anna Testkund E2E"), "kunden saknas i A:s sessionsfil");
        const state = readSessionFile(sesA);
        assert(state.jobs.some((j) => j.title === "Trallbyte E2E"), "uppdraget saknas i A:s sessionsfil");
        // Den globala JSON-filen (lokala utvecklingsläget) lämnas orörd.
        const globalDb = path.join(process.cwd(), ".data", "db.json");
        if (fs.existsSync(globalDb)) {
          assert(!fs.readFileSync(globalDb, "utf8").includes("Anna Testkund E2E"), "demon skrev i .data/db.json!");
        }
      });
      await shot(page, "demo-a-kunder");
      await page.close();
    }

    // ------------------------------------------------------------------
    console.log("\n(d) Extern åtgärd i demo – skicka offert utan riktiga provider-anrop:");
    {
      const page = await newPage(ctxA);
      await check("skicka offert visar success utan riktigt mejlanrop", async () => {
        // E2E:ns egen offert (kund med e-post, utan ROT) är skickbar direkt.
        // Seedets utkast (bokhyllan) är medvetet ofullständigt – ROT utan
        // personnummer/bostad – och har skickaknappen avstängd.
        await gotoOk(page, `${BASE}/ekonomi?flik=offerter`);
        await waitForText(page, "Altantrappa E2E");
        await Promise.all([
          page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }),
          clickByText(page, "a", "Altantrappa E2E"),
        ]);
        await waitForText(page, "Skicka offert");
        const logStart = fs.existsSync(DEV_LOG) ? fs.statSync(DEV_LOG).size : 0;
        await clickByText(page, "button", "Skicka offert");
        await waitForText(page, "Skicka offert?");
        await clickByText(page, "[role=dialog] button", "Skicka offert");
        await waitForText(page, "Skickad", 30000);
        // Dev-serverns stdout är blockbuffrad mot loggfilen – ge raden en
        // stund att flushas innan den bedöms som saknad.
        let log = "";
        for (let i = 0; i < 20; i++) {
          log = devLogSince(logStart);
          if (log.includes("demo_simulated") || log.includes("demo_sink")) break;
          await new Promise((r) => setTimeout(r, 500));
        }
        assert(log.includes("demo_simulated") || log.includes("demo_sink"), "demo-simulerat utskick loggades inte");
        assert(!log.includes("mode=live"), "ett LIVE-utskick loggades i demon!");
      });
      await page.close();
    }

    // ------------------------------------------------------------------
    console.log("\n(e) Demo B (egen cookie jar) får egen fil och ser inte A:s data:");
    const ctxB = await browser.createBrowserContext();
    let sesB = "";
    {
      const page = await newPage(ctxB);
      await gotoOk(page, `${BASE}/demo`);
      await check("demo B får egen kaka + egen färsk klon av seedet", async () => {
        assert(new URL(page.url()).pathname === "/", `hamnade på ${page.url()}`);
        const cookie = await demoCookie(ctxB);
        assert(cookie, "driva_demo-kakan saknas hos B");
        sesB = sessionIdOf(cookie.value);
        assert(sesB !== sesA, "B fick samma session-id som A!");
        assert(fs.existsSync(sessionFile(sesB)), "B:s sessionsfil saknas");
      });
      await check("demo B ser inte Anna Testkund E2E", async () => {
        await gotoOk(page, `${BASE}/kunder`);
        const t = await text(page);
        assert(!has(t, "Anna Testkund E2E"), "A:s kund läckte till B!");
        assert(has(t, "Karin Ek") || has(t, "Anna Andersson") || has(t, "Brf Eken"), "seedkunder saknas hos B");
      });
      await check("demo B ser inte A:s offert/uppdrag", async () => {
        await gotoOk(page, `${BASE}/ekonomi?flik=offerter`);
        assert(!has(await text(page), "Altantrappa E2E"), "A:s offert läckte till B!");
        await gotoOk(page, `${BASE}/uppdrag`);
        assert(!has(await text(page), "Trallbyte E2E"), "A:s uppdrag läckte till B!");
      });
      await check("JSON-filerna bekräftar isoleringen (kunden bara i A:s fil)", async () => {
        assert(fileHasCustomer(sesA, "Anna Testkund E2E"), "kunden saknas i A:s fil");
        assert(!fileHasCustomer(sesB, "Anna Testkund E2E"), "kunden läckte till B:s fil!");
      });
      await check("aktiv demosession på /demo återanvänder filen (ingen ny klon)", async () => {
        await gotoOk(page, `${BASE}/demo`);
        assert(new URL(page.url()).pathname === "/", `hamnade på ${page.url()}`);
        const cookie = await demoCookie(ctxB);
        assert(cookie && sessionIdOf(cookie.value) === sesB, "B:s session byttes ut av /demo");
      });
      await shot(page, "demo-b-kunder");
      await page.close();
    }

    // ------------------------------------------------------------------
    console.log("\n(f) Återställ demo → filen skrivs över med färskt seed:");
    {
      const page = await newPage(ctxA);
      await check("återställningsdialogen har exakt copy och återställer", async () => {
        await gotoOk(page, `${BASE}/installningar`);
        await clickByText(page, "button", "Återställ demo");
        await waitForText(page, "Återställa demon?");
        await waitForText(page, "Alla ändringar du gjort i den här demosessionen tas bort.");
        await clickByText(page, "[role=dialog] button, dialog button", "Återställ");
        // Återställningen skriver över sessionens fil – vänta tills kundlistan är färsk.
        await new Promise((r) => setTimeout(r, 1500));
        await gotoOk(page, `${BASE}/kunder`);
        for (let i = 0; i < 20; i++) {
          const t = await text(page);
          if (!has(t, "Anna Testkund E2E") && (has(t, "Karin Ek") || has(t, "Anna Andersson"))) return;
          await new Promise((r) => setTimeout(r, 1000));
          await page.reload({ waitUntil: "networkidle2" });
        }
        const t = await text(page);
        assert(!has(t, "Anna Testkund E2E"), "E2E-kunden finns kvar efter återställning");
        assert(has(t, "Karin Ek") || has(t, "Anna Andersson"), "seedkunderna saknas efter återställning");
      });
      await check("offerten och uppdraget från E2E är borta efter återställning", async () => {
        await gotoOk(page, `${BASE}/ekonomi?flik=offerter`);
        assert(!has(await text(page), "Altantrappa E2E"), "offerten kvar");
        await gotoOk(page, `${BASE}/uppdrag`);
        assert(!has(await text(page), "Trallbyte E2E"), "uppdraget kvar");
      });
      await check("A:s fil är färskt seed igen; B:s fil rördes inte", async () => {
        assert(!fileHasCustomer(sesA, "Anna Testkund E2E"), "kunden kvar i A:s fil efter återställning");
        assert(fs.existsSync(sessionFile(sesB)), "B:s fil försvann vid A:s återställning!");
      });
      await page.close();
    }

    // ------------------------------------------------------------------
    console.log("\n(g) Avsluta demo → filen slängs, kakan rensas, landningssidan:");
    {
      const page = await newPage(ctxA);
      await check("Avsluta demo tar bort sessionens fil och kakan", async () => {
        await gotoOk(page, `${BASE}/`);
        await clickByText(page, "button", "Avsluta demo");
        await waitForText(page, "Driva ditt företag. Inte administrationen.", 30000);
        assert((await demoCookie(ctxA)) === null, "driva_demo-kakan finns kvar efter Avsluta demo");
        assert(!fs.existsSync(sessionFile(sesA)), "A:s sessionsfil finns kvar efter Avsluta demo");
        assert(fs.existsSync(sessionFile(sesB)), "B:s fil försvann när A avslutade!");
      });
      await check("Skapa ditt eget konto avslutar demon → /signup", async () => {
        // Ny demosession i A:s kontext (kakan är rensad sedan nyss).
        await gotoOk(page, `${BASE}/demo`);
        await page.waitForSelector("[data-driva-demo]", { timeout: 20000 });
        const cookie = await demoCookie(ctxA);
        assert(cookie, "ny demosession sattes inte");
        const ses = sessionIdOf(cookie.value);
        await clickByText(page, "button", "Skapa ditt eget konto");
        for (let i = 0; i < 15; i++) {
          if (new URL(page.url()).pathname === "/signup") break;
          await new Promise((r) => setTimeout(r, 1000));
        }
        assert(new URL(page.url()).pathname === "/signup", `hamnade på ${page.url()}`);
        assert((await demoCookie(ctxA)) === null, "demokakan kvar efter Skapa eget konto");
        assert(!fs.existsSync(sessionFile(ses)), "sessionsfilen kvar efter Skapa eget konto");
      });
      await shot(page, "signup-efter-demo");
      await page.close();
    }

    // ------------------------------------------------------------------
    console.log("\n(h) Kaklivscykel: utgången kaka rensas, städad fil ger färsk klon:");
    {
      await check("utgången demokaka rensas och besökaren landar på landningssidan", async () => {
        const ctx = await browser.createBrowserContext();
        const page = await newPage(ctx);
        await gotoOk(page, `${BASE}/`); // origin måste finnas innan kakan kan sättas
        await page.setCookie({
          name: "driva_demo",
          value: `${Date.now() - 1000}.aaaaaaaaaaaaaaaaaaaaaaaaaa`,
          url: BASE,
          httpOnly: true,
        });
        await gotoOk(page, `${BASE}/kunder`);
        assert(new URL(page.url()).pathname === "/", `hamnade på ${page.url()}`);
        assert(has(await text(page), "Driva ditt företag. Inte administrationen."), "landningssidan visas inte");
        assert((await demoCookie(ctx)) === null, "den utgångna kakan rensades inte");
        await page.close();
        await ctx.close();
      });
      await check("giltig kaka utan fil (städad/påhittad) → egen färsk klon, aldrig annans data", async () => {
        // Ett klientpåstått session-id når bara SIN egen fil: saknas den
        // klonas färskt seed – samma väg som när katalogstädningen tagit
        // filen på en kall instans. Ingen väg till andra sessioner/data.
        // Slumpat per körning: ett återanvänt id kan ligga kvar i serverns
        // instanscache från en tidigare körning och maskera klonvägen.
        const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
        const forged = Array.from({ length: 26 }, () => alphabet[Math.floor(Math.random() * 36)]).join("");
        const ctx = await browser.createBrowserContext();
        const page = await newPage(ctx);
        await gotoOk(page, `${BASE}/`);
        await page.setCookie({
          name: "driva_demo",
          value: `${Date.now() + 3_600_000}.${forged}`,
          url: BASE,
          httpOnly: true,
        });
        await gotoOk(page, `${BASE}/kunder`);
        const t = await text(page);
        assert(has(t, "Karin Ek") || has(t, "Anna Andersson") || has(t, "Brf Eken"), "färskt seed visas inte");
        assert(fs.existsSync(sessionFile(forged)), "ingen ny klon skrevs för det påhittade id:t");
        assert(!fileHasCustomer(forged, "Anna Testkund E2E"), "främmande data i den nya klonen!");
        await page.close();
        await ctx.close();
      });
    }

    // ------------------------------------------------------------------
    console.log("\n(i) Routing och grindar:");
    {
      await check("demo på /onboarding och /login skickas rätt (ingen onboarding i demon)", async () => {
        const page = await newPage(ctxB);
        await gotoOk(page, `${BASE}/onboarding`);
        assert(new URL(page.url()).pathname === "/", `/onboarding i demo → ${page.url()}`);
        // Demosessionen får däremot registrera sig – /signup ska INTE studsa hem.
        await gotoOk(page, `${BASE}/signup`);
        assert(new URL(page.url()).pathname === "/signup", `/signup i demo → ${page.url()}`);
        await page.close();
      });
      await check("inga redirect-loopar på /, /login, /signup; /demo → appen", async () => {
        const ctxFresh = await browser.createBrowserContext();
        const p = await newPage(ctxFresh);
        for (const route of ["/", "/login", "/signup"]) {
          const res = await p.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
          assert(res && res.status() === 200, `${route} → ${res?.status()}`);
        }
        const res = await p.goto(`${BASE}/demo`, { waitUntil: "networkidle2", timeout: 60000 });
        assert(res && res.status() === 200 && new URL(p.url()).pathname === "/", `/demo → ${p.url()}`);
        await p.close();
        await ctxFresh.close();
      });
      await check("utloggad utan demo på skyddad rutt → /login?next=", async () => {
        const ctx = await browser.createBrowserContext();
        const page = await newPage(ctx);
        await gotoOk(page, `${BASE}/kunder`);
        const url = new URL(page.url());
        assert(url.pathname === "/login", `hamnade på ${page.url()}`);
        assert(url.searchParams.get("next") === "/kunder", `next=${url.searchParams.get("next")}`);
        await page.close();
        await ctx.close();
      });
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${passed} godkända, ${failed} underkända.`);
  if (failures.length) {
    console.log("\nUnderkända kontroller:");
    for (const f of failures) console.log(`  – ${f.split("\n")[0]}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
