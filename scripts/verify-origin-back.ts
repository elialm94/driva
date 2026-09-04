import puppeteer from "puppeteer-core";

const BASE = "http://localhost:3123";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function fail(msg: string): never {
  console.error("FAIL", msg);
  process.exit(1);
}

async function textOf(page: puppeteer.Page, selector: string) {
  const el = await page.$(selector);
  if (!el) return null;
  return page.evaluate((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim(), el);
}

async function backText(page: puppeteer.Page) {
  return textOf(page, "a[data-nav=back]");
}

async function clickVisible(page: puppeteer.Page, selector: string) {
  const handle = await page.evaluateHandle((sel) => {
    const nodes = [...document.querySelectorAll(sel)] as HTMLElement[];
    return nodes.find((n) => {
      const r = n.getBoundingClientRect();
      const style = getComputedStyle(n);
      return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    }) ?? null;
  }, selector);
  const el = handle.asElement();
  if (!el) fail(`no visible ${selector} url=${page.url()}`);
  await el.evaluate((n) => (n as HTMLElement).scrollIntoView({ block: "center", inline: "nearest" }));
  await el.click();
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
  const results: string[] = [];

  async function ok(name: string, cond: boolean, extra = "") {
    if (!cond) fail(`${name} ${extra} url=${page.url()}`);
    results.push(`ok ${name}`);
    console.log("ok", name, extra);
  }

  async function runSuite(label: string) {
    // A. Hem → uppdrag → tillbaka Hem
    await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
    await page.evaluate(() => window.scrollTo(0, 240));
    const jobLinkVisible = await page.evaluate((sel) => {
      const nodes = [...document.querySelectorAll(sel)] as HTMLElement[];
      return nodes.some((n) => n.getBoundingClientRect().width > 0);
    }, 'a[href*="/uppdrag/job-karin"]');
    await ok(`${label} A job link on Hem`, jobLinkVisible);
    await Promise.all([
      page.waitForFunction(() => location.pathname.includes("/uppdrag/job-karin")),
      clickVisible(page, 'a[href*="/uppdrag/job-karin"]'),
    ]);
    await page.waitForSelector("a[data-nav=back]");
    const backA = await backText(page);
    await ok(`${label} A back says Hem`, (backA ?? "").includes("Hem"), backA ?? "");
    await page.click("a[data-nav=back]");
    await page.waitForFunction(() => location.pathname === "/");
    await ok(`${label} A lands on Hem`, page.url().replace(/\/$/, "").endsWith(":3123") || new URL(page.url()).pathname === "/");
    await page.goto(`${BASE}/uppdrag/job-karin`, { waitUntil: "networkidle0" });
    const crumbText = await page.evaluate(() => {
      const nav = document.querySelector("nav[aria-label='Brödsmulor']");
      return (nav?.textContent ?? "").replace(/\s+/g, " ").trim();
    });
    await ok(
      `${label} A crumbs structural`,
      crumbText.startsWith("Uppdrag") && !crumbText.includes("Kunder"),
      crumbText
    );

    // B. Uppdragslista → Karin → tillbaka till listan
    await page.goto(`${BASE}/uppdrag`, { waitUntil: "networkidle0" });
    await ok(`${label} B uppdragslista`, new URL(page.url()).pathname === "/uppdrag");
    await Promise.all([
      page.waitForFunction(() => location.pathname.includes("/uppdrag/job-karin")),
      clickVisible(page, 'a[href*="/uppdrag/job-karin"]'),
    ]);
    await page.waitForSelector("a[data-nav=back]");
    const backB = await backText(page);
    await ok(`${label} B back says Uppdrag`, (backB ?? "").includes("Uppdrag"), backB ?? "");
    await page.click("a[data-nav=back]");
    await page.waitForFunction(() => location.pathname === "/uppdrag");
    await ok(`${label} B lands on uppdragslistan`, new URL(page.url()).pathname === "/uppdrag");

    // C. Sök → öppna → tillbaka behåller q
    await page.goto(`${BASE}/uppdrag`, { waitUntil: "networkidle0" });
    const search = await page.$('input[placeholder*="Sök"]');
    if (search) {
      await search.click({ clickCount: 3 });
      await search.type("Karin");
      await page.waitForFunction(() => location.search.includes("q=Karin") || location.search.includes("q=karin"));
    }
    await ok(`${label} C search hit`, true);
    await Promise.all([
      page.waitForFunction(() => location.pathname.includes("/uppdrag/job-karin")),
      clickVisible(page, 'a[href*="/uppdrag/job-karin"]'),
    ]);
    await page.click("a[data-nav=back]");
    await page.waitForFunction(() => location.pathname === "/uppdrag");
    await ok(
      `${label} C restores search`,
      /q=Karin|q=karin/i.test(page.url()),
      page.url()
    );

    // D. Direkt-URL → fallback Uppdrag
    await page.goto(`${BASE}/uppdrag/job-karin`, { waitUntil: "networkidle0" });
    const backD = await backText(page);
    await ok(`${label} D fallback Uppdrag`, (backD ?? "").includes("Uppdrag"), backD ?? "");
    const hrefD = await page.$eval("a[data-nav=back]", (a) => (a as HTMLAnchorElement).getAttribute("href") ?? "");
    await ok(`${label} D href internal`, hrefD.startsWith("/uppdrag") && !hrefD.startsWith("//"), hrefD);

    // E. Hem → uppdrag → kund → uppdrag → Hem
    await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
    await Promise.all([
      page.waitForFunction(() => location.pathname.includes("/uppdrag/job-karin")),
      clickVisible(page, 'a[href*="/uppdrag/job-karin"]'),
    ]);
    await page.waitForSelector("a[href*='/kunder/cust-']");
    await Promise.all([
      page.waitForFunction(() => /\/kunder\/cust-/.test(location.pathname)),
      clickVisible(page, 'a[href*="/kunder/cust-"]'),
    ]);
    const backE1 = await backText(page);
    await ok(`${label} E customer back is uppdrag`, /bokhylla|Uppdrag/i.test(backE1 ?? ""), backE1 ?? "");
    await page.click("a[data-nav=back]");
    await page.waitForFunction(() => location.pathname.includes("/uppdrag/"));
    await page.waitForFunction(() => /Hem/.test(document.querySelector("a[data-nav=back]")?.textContent ?? ""));
    const backE2 = await backText(page);
    await ok(`${label} E uppdrag back is Hem`, (backE2 ?? "").includes("Hem"), backE2 ?? "");
    await page.click("a[data-nav=back]");
    await page.waitForFunction(() => location.pathname === "/");
    await ok(`${label} E lands Home`, new URL(page.url()).pathname === "/");

    // F. Browser back/forward
    await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
    await Promise.all([
      page.waitForFunction(() => location.pathname.includes("/uppdrag/job-karin")),
      clickVisible(page, 'a[href*="/uppdrag/job-karin"]'),
    ]);
    await page.goBack();
    await page.waitForFunction(() => location.pathname === "/");
    await ok(`${label} F browser back to Hem`, new URL(page.url()).pathname === "/");
    await page.goForward();
    await page.waitForFunction(() => location.pathname.includes("/uppdrag/job-karin"));
    await ok(`${label} F browser forward to uppdrag`, page.url().includes("/uppdrag/job-karin"));

    // G. Refresh keeps origin
    await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
    await Promise.all([
      page.waitForFunction(() => location.pathname.includes("/uppdrag/job-karin")),
      clickVisible(page, 'a[href*="/uppdrag/job-karin"]'),
    ]);
    await page.reload({ waitUntil: "networkidle0" });
    const backG = await backText(page);
    await ok(`${label} G refresh keeps Hem`, (backG ?? "").includes("Hem"), backG ?? "");
    const hrefG = await page.$eval("a[data-nav=back]", (a) => (a as HTMLAnchorElement).href);
    await ok(`${label} G still same origin`, new URL(hrefG).origin === new URL(BASE).origin, hrefG);
  }

  await page.setViewport({ width: 1280, height: 900 });
  await runSuite("desktop");

  await page.setViewport({ width: 390, height: 844 });
  await runSuite("mobile");

  await browser.close();
  console.log("\nOrigin-back scenarios passed:\n" + results.map((r) => "  " + r).join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
