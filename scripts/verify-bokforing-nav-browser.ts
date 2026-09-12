/**
 * Regressionsvakt för navigeringen i Bokföring (§ prestandapasset).
 *
 * Tre påståenden, alla mätta i en riktig webbläsare:
 *
 *   1. Enkelt är standardläget och enkelt ↔ avancerat är RENT chrome-byte:
 *      inga serverhämtningar utöver prefetch, ingen serveråtgärd, ingen
 *      helsidesladdning – och flikraden byts aldrig ut mot en ny DOM-nod.
 *   2. Ett flikbyte (Moms ↔ Skattekonto) hämtar bara den flikens vy. Flikraden
 *      och toggeln ligger kvar monterade.
 *   3. Att öppna Skattekonto navigerar aldrig till Huvudbok, Verifikationer
 *      eller Lön – inte ens i avancerat läge där flikarna syns.
 *
 * Körs mot dev (3123) eller ett produktionsbygge:
 *   npx tsx scripts/verify-bokforing-nav-browser.ts [--base http://127.0.0.1:3128]
 */
import puppeteer, { type HTTPRequest, type Page } from "puppeteer-core";

const baseFlag = process.argv.indexOf("--base");
const BASE = baseFlag === -1 ? (process.env.BASE_URL ?? "http://localhost:3123") : process.argv[baseFlag + 1];
const CHROME = process.env.CHROME_PATH || "/usr/local/bin/google-chrome";

const results: string[] = [];

function fail(msg: string): never {
  console.error("FAIL", msg);
  process.exit(1);
}

function ok(name: string, cond: boolean, extra = ""): void {
  if (!cond) fail(`${name} ${extra}`);
  results.push(`ok ${name}${extra ? ` (${extra})` : ""}`);
  console.log("ok", name, extra);
}

/**
 * Serverhämtningar som INTE är prefetch – alltså det användaren faktiskt
 * väntar på. Prefetch räknas separat: den är ofarlig så länge den bara hämtar
 * skalet till loading-gränsen.
 */
function trackRequests(page: Page) {
  const blocking: string[] = [];
  const prefetch: string[] = [];
  const onReq = (req: HTTPRequest) => {
    const url = req.url();
    if (!url.startsWith(BASE)) return;
    if (url.includes("/_next/static") || url.includes("/_next/image") || url.includes("favicon")) return;
    const headers = req.headers();
    const isPrefetch = headers["next-router-prefetch"] === "1" || "next-router-segment-prefetch" in headers;
    const path = url.slice(BASE.length).replace(/[?&]_rsc=[^&]+/, "");
    (isPrefetch ? prefetch : blocking).push(`${req.method()} ${path}`);
  };
  page.on("request", onReq);
  return { blocking, prefetch, stop: () => page.off("request", onReq) };
}

/** Stämpla flikraden så att en remount kan upptäckas efteråt. */
async function stampChrome(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __navToken?: string }).__navToken = "alive";
    for (const sel of ["[data-bokforing-tabs]", "button[data-bokforing-mode]"]) {
      const el = document.querySelector(sel) as (HTMLElement & { __stamp?: string }) | null;
      if (el) el.__stamp = "before";
    }
  });
}

async function chromeSurvived(page: Page): Promise<{ tabs: boolean; toggle: boolean; sameDocument: boolean }> {
  return page.evaluate(() => {
    const tabs = document.querySelector("[data-bokforing-tabs]") as (HTMLElement & { __stamp?: string }) | null;
    const toggle = document.querySelector("button[data-bokforing-mode]") as
      | (HTMLElement & { __stamp?: string })
      | null;
    return {
      tabs: tabs?.__stamp === "before",
      toggle: toggle?.__stamp === "before",
      sameDocument: (window as unknown as { __navToken?: string }).__navToken === "alive",
    };
  });
}

async function tabLabels(page: Page): Promise<string[]> {
  return page.$$eval("[data-bokforing-tabs] a", (links) =>
    links.map((a) => (a.textContent ?? "").trim())
  );
}

async function settle(page: Page, path: string): Promise<void> {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2" });
  await page.waitForSelector("[data-bokforing-tabs]");
  await new Promise((r) => setTimeout(r, 1500));
}

async function main(): Promise<void> {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  await page.setViewport({ width: 1440, height: 900 });

  // 1. Enkelt är standard.
  await settle(page, "/bokforing/skattekonto");
  const simple = await tabLabels(page);
  ok("enkelt är standardläget", !simple.includes("Huvudbok") && simple.includes("Skattekonto"), simple.join(" · "));
  ok(
    "toggeln erbjuder avancerat",
    (await page.$eval("button[data-bokforing-mode]", (b) => (b.textContent ?? "").trim())) === "Visa avancerat"
  );

  // 2. Växlingen byter bara chrome – inga blockerande serverhämtningar.
  for (const [step, wanted, expectHuvudbok] of [
    ["Visa avancerat", "avancerat", true],
    ["Visa enkelt", "enkelt", false],
  ] as const) {
    await stampChrome(page);
    const reqs = trackRequests(page);
    const t0 = Date.now();
    await page.click("button[data-bokforing-mode]");
    await page.waitForFunction(
      (want: boolean) => Boolean(document.querySelector('a[href="/bokforing/huvudbok"]')) === want,
      {},
      expectHuvudbok
    );
    const ms = Date.now() - t0;
    await new Promise((r) => setTimeout(r, 1200)); // låt ev. prefetch landa
    reqs.stop();
    const survived = await chromeSurvived(page);
    ok(`${step}: ingen blockerande serverhämtning`, reqs.blocking.length === 0, reqs.blocking.join(", "));
    ok(`${step}: ingen helsidesladdning`, survived.sameDocument);
    ok(`${step}: flikraden och toggeln ligger kvar`, survived.tabs && survived.toggle);
    ok(`${step}: innehållet står kvar på Skattekonto`, (await page.$eval("h1", (h) => h.textContent)) === "Skattekonto");
    ok(`${step}: läget står på ${wanted}`, (await page.$eval("button[data-bokforing-mode]", (b) => b.dataset.bokforingMode)) === wanted, `${ms} ms`);
  }

  // 3. Läget sitter kvar över en hård omladdning (cookie, inte databas).
  await page.click("button[data-bokforing-mode]");
  await page.waitForFunction(() => Boolean(document.querySelector('a[href="/bokforing/huvudbok"]')));
  await settle(page, "/bokforing/skattekonto");
  ok("avancerat överlever omladdning", (await tabLabels(page)).includes("Huvudbok"));

  // 4. Att öppna Skattekonto i avancerat läge navigerar aldrig till andra flikvyer.
  const openReqs = trackRequests(page);
  await settle(page, "/bokforing/skattekonto");
  openReqs.stop();
  const strayNav = openReqs.blocking.filter((r) => /\/bokforing\/(huvudbok|verifikationer|lon)/.test(r));
  ok("Skattekonto hämtar inte Huvudbok/Verifikationer/Lön", strayNav.length === 0, strayNav.join(", "));

  await page.click("button[data-bokforing-mode]"); // tillbaka till enkelt
  await page.waitForFunction(() => !document.querySelector('a[href="/bokforing/huvudbok"]'));

  // 5. Flikbyte: bara den flikens vy, chromet ligger kvar.
  for (const [name, from, href, heading] of [
    ["Moms → Skattekonto", "/bokforing/moms", "/bokforing/skattekonto", "Skattekonto"],
    ["Skattekonto → Moms", "/bokforing/skattekonto", "/bokforing/moms", "Moms"],
  ] as const) {
    await settle(page, from);
    await stampChrome(page);
    const reqs = trackRequests(page);
    await page.click(`[data-bokforing-tabs] a[href="${href}"]`);
    await page.waitForFunction((want: string) => document.querySelector("h1")?.textContent?.trim() === want, {}, heading);
    reqs.stop();
    const survived = await chromeSurvived(page);
    ok(`${name}: chromet laddas inte om`, survived.tabs && survived.toggle && survived.sameDocument);
    const pages = reqs.blocking.filter((r) => r.includes("/bokforing"));
    ok(`${name}: bara flikens egen vy hämtas`, pages.length <= 1 && pages.every((r) => r.includes(href)), reqs.blocking.join(", "));
  }

  await browser.close();
  console.log(`\nBokföringsnavigering OK:\n${results.map((r) => `  ${r}`).join("\n")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
