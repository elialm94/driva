/**
 * Mät /bokforing-navigeringen: flikbyten och enkelt/avancerat-växlingen.
 *
 * Per övergång rapporteras
 *   ms                 klick → destinationens innehåll synligt
 *   serverhämtningar   dokument-/RSC-anrop (prefetch märks ut; statiska
 *                      chunkar räknas inte)
 *   flikrad/toggel     låg chromet kvar, eller byttes det mot nya DOM-noder
 *   chrome borta       antal animationsframes utan flikrad i DOM
 *   skelett            antal frames med pulsande skelett i innehållsytan
 *   HELSIDESOMLADDNING token på window försvann = ingen mjuk navigering
 *
 * Prefetch är avstängd i dev, så mätningen ska köras mot ett produktionsbygge:
 *   npx next build && npx next start -p 3128
 *   node scripts/measure-bokforing-nav.mjs --base http://127.0.0.1:3128
 */
import puppeteer from "puppeteer-core";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const BASE = arg("base", "http://127.0.0.1:3128");
const LABEL = arg("label", "");
const CHROME = process.env.CHROME_PATH || "/usr/local/bin/google-chrome";
const TAB_SELECTOR = 'a[href="/bokforing/moms"]';

function trackRequests(page) {
  const urls = [];
  const onReq = (req) => {
    const url = req.url();
    if (!url.startsWith(BASE)) return;
    if (url.includes("/_next/static") || url.includes("/_next/image") || url.includes("favicon")) return;
    const headers = req.headers();
    const prefetch = headers["next-router-prefetch"] === "1" || "next-router-segment-prefetch" in headers;
    urls.push(`${url.slice(BASE.length).replace(/[?&]_rsc=[^&]+/, "")}${prefetch ? " (prefetch)" : ""}`);
  };
  page.on("request", onReq);
  return { urls, stop: () => page.off("request", onReq) };
}

/** Stämpla DOM-noder + starta frame-probe före övergången. */
async function armProbe(page, tabSelector) {
  await page.evaluate((sel) => {
    window.__navToken = "alive";
    const stamp = (el) => {
      if (el) el.__drivaStamp = "before";
    };
    stamp(document.querySelector(sel));
    stamp(document.querySelector("button[data-bokforing-mode]"));
    const probe = { frames: 0, chromeGoneFrames: 0, skeletonFrames: 0 };
    window.__probe = probe;
    const tick = () => {
      probe.frames += 1;
      if (!document.querySelector(sel)) probe.chromeGoneFrames += 1;
      if (document.querySelector('[aria-busy="true"] .animate-pulse')) probe.skeletonFrames += 1;
      probe.raf = requestAnimationFrame(tick);
    };
    tick();
  }, tabSelector);
}

async function readProbe(page, tabSelector) {
  return page.evaluate((sel) => {
    cancelAnimationFrame(window.__probe?.raf);
    const tab = document.querySelector(sel);
    const btn = document.querySelector("button[data-bokforing-mode]");
    return {
      frames: window.__probe?.frames ?? 0,
      chromeGoneFrames: window.__probe?.chromeGoneFrames ?? 0,
      skeletonFrames: window.__probe?.skeletonFrames ?? 0,
      tabRemount: tab ? tab.__drivaStamp !== "before" : true,
      toggleRemount: btn ? btn.__drivaStamp !== "before" : true,
      fullReload: window.__navToken !== "alive",
    };
  }, tabSelector);
}

async function settle(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2" });
  // Låt hydrering + prefetch bli klar innan mätningen (som en riktig användare
  // som läst sidan en stund).
  await new Promise((r) => setTimeout(r, 2500));
}

async function measure(page, { name, from, click, done, tabSelector = TAB_SELECTOR }) {
  if (from) await settle(page, from);
  await armProbe(page, tabSelector);
  const reqs = trackRequests(page);
  const t0 = performance.now();
  const el = await page.$(click);
  if (!el) {
    reqs.stop();
    return { name, error: `hittade inte ${click}` };
  }
  await el.click();
  let error = null;
  try {
    await page.waitForFunction(done, { polling: "raf", timeout: 20000 });
  } catch {
    error = "timeout 20 s";
  }
  const ms = Math.round(performance.now() - t0);
  const probe = await readProbe(page, tabSelector);
  // Låt eventuella efterhämtningar (prefetch som utlöses av den nya vyn) landa.
  await new Promise((r) => setTimeout(r, 1500));
  reqs.stop();
  return { name, ms, error, ...probe, requests: reqs.urls };
}

function report(r) {
  if (r.error) console.log(`  ${r.name}: FEL – ${r.error}`);
  const flags = [
    r.fullReload ? "HELSIDESOMLADDNING" : null,
    r.tabRemount ? "flikrad remountad" : "flikrad kvar",
    r.toggleRemount ? "toggel remountad" : "toggel kvar",
    r.chromeGoneFrames > 0 ? `chrome borta ${r.chromeGoneFrames}/${r.frames} frames` : "chrome aldrig borta",
    r.skeletonFrames > 0 ? `skelett ${r.skeletonFrames}/${r.frames} frames` : "inget skelett",
  ].filter(Boolean);
  console.log(`  ${r.name}: ${r.ms} ms — ${flags.join(", ")}`);
  console.log(`      serverhämtningar (${r.requests.length}): ${r.requests.join(" ") || "-"}`);
}

/** Slå på/av ett långsamt nät (CDP). Utan strypning landar prefetchen alltid. */
async function throttle(page, on) {
  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: on ? 300 : 0,
    downloadThroughput: on ? (500 * 1024) / 8 : -1,
    uploadThroughput: on ? (500 * 1024) / 8 : -1,
  });
  await cdp.detach();
}

/** Sätt läget genom att klicka toggeln (skriver cookie efter fixen, db före). */
async function setMode(page, wanted) {
  await settle(page, "/bokforing/skattekonto");
  const current = await page.$eval("button[data-bokforing-mode]", (b) => b.dataset.bokforingMode);
  if (current !== wanted) {
    await page.click("button[data-bokforing-mode]");
    await page
      .waitForFunction(
        `document.querySelector("button[data-bokforing-mode]")?.dataset.bokforingMode === "${wanted}"`,
        { timeout: 10000 }
      )
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));
  }
}

async function coldOpen(page, path, tabSelector = TAB_SELECTOR) {
  // Hård laddning: vilka segment renderar servern när Skattekonto öppnas?
  await page.goto("about:blank");
  const reqs = trackRequests(page);
  const t0 = performance.now();
  await page.goto(`${BASE}${path}`, { waitUntil: "load" });
  const ms = Math.round(performance.now() - t0);
  await page.waitForFunction(`!!document.querySelector('${tabSelector}')`, { timeout: 10000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 3000)); // prefetch efter hydrering
  reqs.stop();
  console.log(`  hård laddning ${path}: ${ms} ms till load`);
  console.log(`      serverhämtningar (${reqs.urls.length}): ${reqs.urls.join(" ") || "-"}`);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage", `--user-data-dir=/tmp/measure-chrome-${Date.now()}`],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`      [browser error] ${m.text().slice(0, 160)}`);
  });

  console.log(`\n=== ${LABEL || "mätning"} mot ${BASE} ===\n`);

  console.log("Öppna Skattekonto direkt (vilka segment hämtas?):");
  await coldOpen(page, "/bokforing/skattekonto");

  console.log("\nFlikbyten och lägesväxling:");
  const cases = [
    {
      name: "Moms → Skattekonto",
      from: "/bokforing/moms",
      click: 'a[href="/bokforing/skattekonto"]',
      done: `document.querySelector("h1")?.textContent?.includes("Skattekonto")`,
    },
    {
      name: "Skattekonto → Moms",
      from: "/bokforing/skattekonto",
      click: 'a[href="/bokforing/moms"]',
      done: `document.querySelector("h1")?.textContent?.trim() === "Moms"`,
      tabSelector: 'a[href="/bokforing/skattekonto"]',
    },
    {
      name: "Visa avancerat (från Skattekonto)",
      from: "/bokforing/skattekonto",
      click: "button[data-bokforing-mode]",
      done: `!!document.querySelector('a[href="/bokforing/huvudbok"]')`,
    },
    {
      name: "Visa enkelt (från Skattekonto)",
      from: null,
      click: "button[data-bokforing-mode]",
      done: `!document.querySelector('a[href="/bokforing/huvudbok"]')`,
    },
    {
      name: "Visa avancerat (från Moms)",
      from: "/bokforing/moms",
      click: "button[data-bokforing-mode]",
      done: `!!document.querySelector('a[href="/bokforing/huvudbok"]')`,
      tabSelector: 'a[href="/bokforing/skattekonto"]',
    },
    {
      name: "Visa enkelt (från Moms)",
      from: null,
      click: "button[data-bokforing-mode]",
      done: `!document.querySelector('a[href="/bokforing/huvudbok"]')`,
      tabSelector: 'a[href="/bokforing/skattekonto"]',
    },
  ];
  for (const c of cases) {
    const r = await measure(page, c);
    report(r);
  }

  console.log("\nÖppna Skattekonto i AVANCERAT läge (alla flikar synliga):");
  await setMode(page, "avancerat");
  await coldOpen(page, "/bokforing/skattekonto");

  console.log("\nLångsamt nät (500 kbit/s, 300 ms latens) – enkelt läge:");
  await setMode(page, "enkelt");
  await throttle(page, true);
  for (const c of [
    {
      name: "Moms → Skattekonto (långsamt nät)",
      from: "/bokforing/moms",
      click: 'a[href="/bokforing/skattekonto"]',
      done: `document.querySelector("h1")?.textContent?.includes("Skattekonto")`,
    },
    {
      name: "Visa avancerat (långsamt nät)",
      from: "/bokforing/skattekonto",
      click: "button[data-bokforing-mode]",
      done: `!!document.querySelector('a[href="/bokforing/huvudbok"]')`,
    },
    {
      name: "Visa enkelt (långsamt nät)",
      from: null,
      click: "button[data-bokforing-mode]",
      done: `!document.querySelector('a[href="/bokforing/huvudbok"]')`,
    },
  ]) {
    const r = await measure(page, c);
    report(r);
  }
  await throttle(page, false);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
