/**
 * Browserverifiering av kundens aktivitetslista: mindre tom yta, Visa fler.
 *
 *   npm run dev
 *   npx tsx scripts/verify-kund-aktivitet-browser.ts
 *
 * Desktop 1280 och 375 px. Fixtur via POST /api/dev/reset activity-list.
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer, { type Page } from "puppeteer-core";

const BASE = process.env.VERIFY_BASE ?? "http://localhost:3123";
const CHROME = process.env.CHROME_PATH ?? "/usr/local/bin/google-chrome";
const SHOT_DIR =
  process.env.VERIFY_SHOT_DIR ??
  "/private/var/folders/qr/nb_08jxn69s5t5hkyvq3m9yc0000gn/T/cursor_agent_stores/dd4ee813-7ec4-4686-bbd2-844117024105/files/media/kund-aktivitet-visa-fler";

let failures = 0;
function ok(label: string) {
  console.log(`  ✓ ${label}`);
}
function expect(cond: unknown, label: string) {
  if (cond) ok(label);
  else {
    failures++;
    console.log(`  ✗ ${label}`);
  }
}

async function resetFixture(): Promise<string> {
  const res = await fetch(`${BASE}/api/dev/reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "activity-list" }),
  });
  if (!res.ok) throw new Error(`reset activity-list: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { customerId: string; rows: number };
  if (body.rows !== 21) throw new Error(`fixtur gav ${body.rows} rader, ville ha 21`);
  return body.customerId;
}

async function restoreSeed() {
  await fetch(`${BASE}/api/dev/reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "seed" }),
  });
}

async function shot(page: Page, name: string) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const file = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file as `${string}.png` });
  console.log(`    → ${file}`);
}

type Metrics = {
  panel: number;
  table: number;
  minHeight: number;
  visible: number;
  total: number;
  tabY: number;
  hole: number;
};

async function metrics(page: Page): Promise<Metrics> {
  return page.evaluate(() => {
    const panel = document.querySelector("[data-activity-list]") as HTMLElement | null;
    const table = panel?.querySelector("table") as HTMLElement | null;
    const tabs = document.querySelector("[data-activity-tabs]") as HTMLElement | null;
    const panelH = panel?.getBoundingClientRect().height ?? 0;
    const tableH = table?.getBoundingClientRect().height ?? 0;
    return {
      panel: Math.round(panelH),
      table: Math.round(tableH),
      minHeight: Number(panel?.dataset.activityMinHeight ?? 0),
      visible: Number(panel?.dataset.activityVisible ?? 0),
      total: Number(panel?.dataset.activityTotal ?? 0),
      tabY: tabs ? Math.round(tabs.getBoundingClientRect().top * 1000) / 1000 : -1,
      hole: Math.round(panelH - tableH),
    };
  });
}

async function clickTab(page: Page, label: string) {
  await page.evaluate((name) => {
    const tabs = document.querySelector("[data-activity-tabs]");
    const btn = Array.from(tabs?.querySelectorAll("button") ?? []).find((b) => b.textContent?.trim() === name);
    if (!btn) throw new Error(`flik ${name} saknas`);
    (btn as HTMLButtonElement).click();
  }, label);
}

async function scrollTabsNearTop(page: Page) {
  await page.evaluate(() => {
    const tabs = document.querySelector("[data-activity-tabs]");
    if (!tabs) return;
    const top = tabs.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, top - 80));
  });
}

async function check(page: Page, label: string, prefix: string) {
  console.log(`\n${label}:`);
  await page.waitForSelector("[data-activity-list]", { timeout: 20000 });
  await scrollTabsNearTop(page);

  const alla = await metrics(page);
  expect(alla.total === 21, `Alla har 21 händelser (${alla.total})`);
  expect(alla.visible === 20, `Alla visar 20 rader (${alla.visible})`);
  expect(alla.minHeight === 0, `Alla har ingen extra min-höjd (${alla.minHeight})`);
  expect(alla.hole <= 8, `Alla har inget stort hål (panel ${alla.panel}, tabell ${alla.table}, hål ${alla.hole})`);
  const visaFler = await page.$("[data-activity-visa-fler]");
  expect(Boolean(visaFler), "Visa fler syns");
  const btnText = visaFler ? await page.evaluate((el) => el.textContent?.trim(), visaFler) : "";
  expect(btnText === "Visa fler", `knappen heter Visa fler (${JSON.stringify(btnText)})`);
  expect(!(await page.evaluate(() => /sida\s*\d|page\s*\d/i.test(document.body.innerText))), "inga sidnummer");
  await shot(page, `${prefix}-alla`);

  await clickTab(page, "Betalningar");
  await page.waitForFunction(() => document.querySelector("[data-activity-list]")?.getAttribute("data-activity-visible") === "0");
  const empty = await metrics(page);
  expect(empty.visible === 0, "Betalningar är tom");
  expect(empty.minHeight >= 42 + 4 * 64 && empty.minHeight <= 42 + 6 * 64, `tom min-höjd är 4-6 rader (${empty.minHeight})`);
  expect(empty.panel + 40 >= empty.minHeight, `tom panel är ungefär golvet (panel ${empty.panel}, golv ${empty.minHeight})`);
  const emptyText = await page.evaluate(() => document.body.innerText);
  expect(emptyText.includes("Ingen aktivitet ännu"), "tom text Ingen aktivitet ännu");
  await shot(page, `${prefix}-betalningar`);

  const beforeAlla = empty.tabY;
  await clickTab(page, "Alla");
  await page.waitForFunction(() => document.querySelector("[data-activity-list]")?.getAttribute("data-activity-visible") === "20");
  const afterAlla = await metrics(page);
  expect(Math.abs(afterAlla.tabY - beforeAlla) <= 1.5, `flik-Y stilla Betalningar → Alla (${beforeAlla} → ${afterAlla.tabY})`);
  await shot(page, `${prefix}-alla-efter-betalningar`);

  await page.click("[data-activity-visa-fler]");
  await page.waitForFunction(() => document.querySelector("[data-activity-list]")?.getAttribute("data-activity-visible") === "21");
  const more = await metrics(page);
  expect(more.visible === 21, `21:a raden efter Visa fler (${more.visible})`);
  expect((await page.$("[data-activity-visa-fler]")) == null, "Visa fler försvinner när allt syns");
  expect(more.minHeight === 0, "full lista efter Visa fler har ingen extra min-höjd");
  expect(more.hole <= 8, `ingen stor platta efter Visa fler (hål ${more.hole})`);
  await shot(page, `${prefix}-visa-fler`);
}

async function main() {
  const customerId = await resetFixture();
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=sv-SE"],
  });

  try {
    const desktop = await browser.newPage();
    await desktop.setViewport({ width: 1280, height: 900 });
    await desktop.goto(`${BASE}/kunder/${customerId}`, { waitUntil: "networkidle0" });
    await check(desktop, "Desktop 1280x900", "desktop");

    const mobile = await browser.newPage();
    await mobile.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await mobile.goto(`${BASE}/kunder/${customerId}`, { waitUntil: "networkidle0" });
    await check(mobile, "Mobil 375x812", "mobile");
  } finally {
    await browser.close();
    await restoreSeed();
  }

  console.log(failures === 0 ? "\nAllt grönt." : `\n${failures} kontroller underkända.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
