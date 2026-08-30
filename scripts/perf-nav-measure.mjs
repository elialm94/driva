/**
 * Mät upplevd navigeringstid i produktionsbygget med headless Chrome.
 *
 * För varje övergång: klicka på länken, vänta tills destinationens innehåll
 * syns, och rapportera tiden. Upptäcker även HELSIDESOMLADDNINGAR (en token
 * på window överlever klientnavigering men inte en riktig omladdning) samt
 * NÄR första visuella feedbacken kommer (skeleton/innehållsbyte).
 *
 * Körs med:  node scripts/perf-nav-measure.mjs [--base http://localhost:3128]
 */
import puppeteer from "puppeteer-core";

const BASE = process.argv.includes("--base")
  ? process.argv[process.argv.indexOf("--base") + 1]
  : "http://localhost:3128";

const CHROME = process.env.CHROME_PATH || "/usr/local/bin/google-chrome";

/** [namn, startväg, klickselector eller BACK, väntevillkor (JS-uttryck mot document)] */
const TRANSITIONS = [
  [
    "Hem → Kunder",
    "/",
    'aside a[href="/kunder"]',
    `document.querySelector("h1")?.textContent?.includes("Kunder")`,
  ],
  [
    "Kunder → kund-detalj",
    "/kunder",
    'a[href^="/kunder/cust-"]',
    `document.querySelector("h1") && !document.querySelector("h1").textContent.includes("Kunder")`,
  ],
  [
    "detalj → tillbaka (Kunder)",
    null,
    "BACK",
    `document.querySelector("h1")?.textContent?.includes("Kunder")`,
  ],
  [
    "Kunder → Ekonomi",
    "/kunder",
    'aside a[href="/ekonomi"]',
    `document.querySelector("h1")?.textContent?.includes("Ekonomi")`,
  ],
  [
    "Ekonomi → Inbox",
    "/ekonomi",
    'aside a[href="/inbox"]',
    `document.querySelector("h1")?.textContent?.includes("Inbox")`,
  ],
  [
    "Inbox → dokument",
    "/inbox",
    'a[href^="/inbox/"]',
    `document.querySelector("h1") && !document.querySelector("h1").textContent.includes("Inbox")`,
  ],
  [
    "Ekonomi → Bokföring",
    "/ekonomi",
    'aside a[href="/bokforing"]',
    `document.querySelector("h1")?.textContent?.includes("Bokföring")`,
  ],
  [
    "Bokföring → Hem",
    "/bokforing",
    'aside a[href="/"]',
    `document.querySelector("h1") && /God (morgon|förmiddag|eftermiddag|kväll|natt)/.test(document.querySelector("h1").textContent)`,
  ],
  [
    "Ekonomi-tab: Offerter → Fakturor",
    "/ekonomi",
    'a[href="/ekonomi?flik=fakturor"]',
    `(document.querySelector('a[href="/ekonomi?flik=fakturor"]')?.className || "").includes("bg-card")`,
  ],
];

async function measureTransition(page, name, startPath, clickSel, doneExpr) {
  if (startPath) {
    await page.goto(`${BASE}${startPath}`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1200)); // låt prefetch/hydrering bli klar
  }

  // Token som bara överlever KLIENT-navigering.
  await page.evaluate(() => {
    window.__navToken = "alive";
  });

  const t0 = Date.now();
  if (clickSel === "BACK") {
    await page.goBack({ waitUntil: "commit", timeout: 5000 }).catch(() => {});
  } else {
    const el = await page.$(clickSel);
    if (!el) return { name, error: `hittade inte ${clickSel}` };
    await el.click();
  }

  try {
    await page.waitForFunction(doneExpr, { polling: 16, timeout: 15000 });
  } catch {
    return { name, error: "timeout (15 s)" };
  }
  const ms = Date.now() - t0;
  const token = await page.evaluate(() => window.__navToken);
  const fullReload = token !== "alive";
  return { name, ms, fullReload };
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage", `--user-data-dir=/tmp/perf-chrome-profile-${Date.now()}`],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  console.log(`Mäter mot ${BASE}\n`);
  console.log("Klientnavigeringar (klick → destinationsinnehåll synligt):");
  for (const [name, startPath, clickSel, doneExpr] of TRANSITIONS) {
    const r = await measureTransition(page, name, startPath, clickSel, doneExpr);
    if (r.error) console.log(`  ${name}: FEL – ${r.error}`);
    else console.log(`  ${name}: ${r.ms} ms${r.fullReload ? "  ⚠ HELSIDESOMLADDNING" : ""}`);
  }

  // Varm upprepning: Hem→Kunder→Hem→Kunder (andra besöket bör vara cachat).
  console.log("\nUpprepad navigering (routercache-effekt):");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1200));
  for (let i = 1; i <= 2; i++) {
    let r = await measureTransition(page, `Hem → Kunder (besök ${i})`, null, 'aside a[href="/kunder"]', TRANSITIONS[0][3]);
    console.log(`  ${r.name}: ${r.error ?? r.ms + " ms"}`);
    r = await measureTransition(
      page,
      `Kunder → Hem (besök ${i})`,
      null,
      'aside a[href="/"]',
      TRANSITIONS[7][3]
    );
    console.log(`  ${r.name}: ${r.error ?? r.ms + " ms"}`);
    await new Promise((r2) => setTimeout(r2, 400));
  }

  // Full omladdning (hård) per huvudrutt: TTFB + DOMContentLoaded.
  console.log("\nHård omladdning per rutt (TTFB / DCL / load):");
  for (const path of ["/", "/kunder", "/ekonomi", "/inbox", "/bokforing", "/samarbeta"]) {
    await page.goto("about:blank");
    await page.goto(`${BASE}${path}`, { waitUntil: "load" });
    const nav = await page.evaluate(() => {
      const e = performance.getEntriesByType("navigation")[0];
      return {
        ttfb: Math.round(e.responseStart - e.requestStart),
        dcl: Math.round(e.domContentLoadedEventEnd - e.startTime),
        load: Math.round(e.loadEventEnd - e.startTime),
      };
    });
    console.log(`  ${path}: TTFB ${nav.ttfb} ms, DCL ${nav.dcl} ms, load ${nav.load} ms`);
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
