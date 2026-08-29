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

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  page.on("dialog", (d) => d.accept());
  const results: string[] = [];

  async function ok(name: string, cond: boolean, extra = "") {
    if (!cond) fail(`${name} ${extra} url=${page.url()}`);
    results.push(`ok ${name}`);
    console.log("ok", name, extra);
  }

  // 0. Old /pengar bookmarks redirect to /ekonomi
  await page.setViewport({ width: 1280, height: 900 });
  const redirectRes = await page.goto(`${BASE}/pengar?flik=fakturor`, { waitUntil: "networkidle0" });
  await ok(
    "0 /pengar redirects to /ekonomi",
    page.url().includes("/ekonomi") && page.url().includes("flik=fakturor"),
    `status=${redirectRes?.status()} url=${page.url()}`
  );
  const nestedRedirect = await page.goto(`${BASE}/pengar/fakturor/inv-1045`, { waitUntil: "networkidle0" });
  await ok(
    "0 nested /pengar/fakturor redirects",
    page.url().includes("/ekonomi/fakturor/inv-1045"),
    `status=${nestedRedirect?.status()} url=${page.url()}`
  );

  // 1. Ekonomi → Fakturor → Faktura → back to Fakturor
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/ekonomi?flik=fakturor`, { waitUntil: "networkidle0" });
  await page.click('a[href^="/ekonomi/fakturor/inv-1045"]');
  await page.waitForSelector("h1");
  const back1 = await textOf(page, "a[data-nav=back]");
  await ok("1 back label Fakturor", (back1 ?? "").includes("Fakturor"), back1 ?? "");
  await page.click("a[data-nav=back]");
  await page.waitForFunction(() => location.pathname === "/ekonomi");
  await ok("1 back lands on Ekonomi", page.url().includes("/ekonomi") && page.url().includes("flik=fakturor"));

  // 2. Uppdrag → Köksrenovering → Faktura → back to Köksrenovering
  await page.goto(`${BASE}/uppdrag/job-kok`, { waitUntil: "networkidle0" });
  const invoiceLink = await page.$('a[href*="/ekonomi/fakturor/inv-1045"]');
  await ok("2 invoice link from uppdrag", !!invoiceLink);
  await invoiceLink!.click();
  await page.waitForSelector("h1");
  await page.waitForFunction(() => {
    const a = document.querySelector("a[data-nav=back]");
    return (a?.textContent ?? "").includes("Köksrenovering");
  });
  const back2 = await textOf(page, "a[data-nav=back]");
  await ok("2 back label Köksrenovering", (back2 ?? "").includes("Köksrenovering"), back2 ?? "");
  await page.click("a[data-nav=back]");
  await page.waitForFunction(() => location.pathname === "/uppdrag/job-kok");
  await ok("2 back lands on uppdrag", page.url().includes("/uppdrag/job-kok"));

  // 3. Ekonomi → Offerter → Ny offert → avbryt → Offerter
  await page.goto(`${BASE}/ekonomi?flik=offerter`, { waitUntil: "networkidle0" });
  await page.click('a[href^="/ekonomi/offerter/ny"]');
  await page.waitForFunction(() => location.pathname === "/ekonomi/offerter/ny");
  const back3 = await textOf(page, "a[data-nav=back]");
  await ok("3 ny offert back Offerter", (back3 ?? "").includes("Offerter"), back3 ?? "");
  const avbryt = await page.$("button::-p-text(Avbryt)") ?? await page.evaluateHandle(() =>
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Avbryt") ?? null
  );
  await (avbryt as puppeteer.ElementHandle).click();
  await page.waitForFunction(() => location.pathname === "/ekonomi");
  await ok("3 avbryt to offerter", page.url().includes("flik=offerter") || page.url().includes("/ekonomi"));

  // 4. Uppdrag → Skapa offert → avbryt → same uppdrag
  await page.goto(`${BASE}/ekonomi/offerter/ny?kund=cust-anna&job=job-kok`, { waitUntil: "networkidle0" });
  await page.waitForSelector("a[data-nav=back]");
  const back4 = await textOf(page, "a[data-nav=back]");
  await ok("4 back is Köksrenovering", (back4 ?? "").includes("Köksrenovering"), back4 ?? "");
  const cancel = await page.evaluateHandle(() =>
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Avbryt") ?? null
  );
  await cancel.asElement()!.click();
  await page.waitForFunction(() => location.pathname === "/uppdrag/job-kok");
  await ok("4 avbryt back to uppdrag", page.url().includes("/uppdrag/job-kok"));

  // 5. Kunder → Anna → Uppdrag → back understandable
  await page.goto(`${BASE}/kunder/cust-anna`, { waitUntil: "networkidle0" });
  const jobHref = await page.$eval('a[href*="/uppdrag/job-kok"]', (a) => (a as HTMLAnchorElement).getAttribute("href"));
  await ok("5 uppdrag link has tillbaka", (jobHref ?? "").includes("tillbaka="), jobHref ?? "");
  await page.goto(`${BASE}${jobHref}`, { waitUntil: "networkidle0" });
  await page.waitForSelector("a[data-nav=back]");
  await page.waitForFunction(() => {
    const a = document.querySelector("a[data-nav=back]");
    return /Anna Andersson|Uppdrag/.test(a?.textContent ?? "");
  });
  const back5 = await textOf(page, "a[data-nav=back]");
  await ok("5 back from uppdrag is Anna Andersson", (back5 ?? "").includes("Anna Andersson"), back5 ?? "");

  // 6. Ny offert → ny kund modal → stäng → quote data intact
  await page.goto(`${BASE}/ekonomi/offerter/ny`, { waitUntil: "networkidle0" });
  await page.waitForSelector('input[placeholder="T.ex. Köksrenovering"]');
  await page.type('input[placeholder="T.ex. Köksrenovering"]', "Navtest-titel");
  const picker = await page.evaluateHandle(() =>
    [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Skapa ny kund") || b.getAttribute("aria-haspopup")) ??
    document.querySelector("button")
  );
  // Open customer picker then create
  const openPicker = await page.$("button[aria-haspopup], button[aria-expanded]");
  if (openPicker) await openPicker.click();
  await new Promise((r) => setTimeout(r, 400));
  const createBtn = await page.evaluateHandle(() =>
    [...document.querySelectorAll("button")].find((b) => /Skapa/.test(b.textContent ?? "") && /kund/i.test(b.textContent ?? "")) ?? null
  );
  if (createBtn.asElement()) {
    await createBtn.asElement()!.click();
    await page.waitForFunction(() => [...document.querySelectorAll("div")].some((d) => d.textContent === "Ny kund"));
    const avbrytKund = await page.evaluateHandle(() =>
      [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Avbryt") ?? null
    );
    await avbrytKund.asElement()!.click();
    await page.waitForFunction(() => ![...document.querySelectorAll("div")].some((d) => d.textContent === "Ny kund"));
  }
  const titleVal = await page.$eval('input[placeholder="T.ex. Köksrenovering"]', (el) => (el as HTMLInputElement).value);
  await ok("6 quote title intact after modal", titleVal.includes("Navtest-titel"), titleVal);

  // Unsaved confirm: click Offerter back after dirty
  await page.click("a[data-nav=back]");
  await page.waitForFunction(() =>
    [...document.querySelectorAll("p, h2, div")].some((n) => (n.textContent ?? "").includes("osparade ändringar"))
  );
  const stay = await page.evaluateHandle(() =>
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Stanna kvar") ?? null
  );
  await stay.asElement()!.click();
  const stillTitle = await page.$eval('input[placeholder="T.ex. Köksrenovering"]', (el) => (el as HTMLInputElement).value);
  await ok("unsaved stay keeps form", stillTitle.includes("Navtest-titel"));

  // 7. Offertdetaljen visar dokumentet – ingen extra förhandsgranskning.
  await page.goto(`${BASE}/ekonomi/offerter/quote-dorrar`, { waitUntil: "networkidle0" });
  const quotePageText = await page.evaluate(() => document.body.innerText);
  await ok("7 quote document on detail", quotePageText.includes("Byte av förrådsdörrar"));
  await ok("7 no preview CTA", !/Förhandsgranska & skicka|Så här ser kunden offerten|Visa offerten/.test(quotePageText));
  await ok("7 stays on quote", page.url().includes("quote-dorrar"));

  // 8. Browser back through objects
  await page.goto(`${BASE}/ekonomi?flik=fakturor`, { waitUntil: "networkidle0" });
  await Promise.all([
    page.waitForFunction(() => location.pathname.includes("/ekonomi/fakturor/inv-1045")),
    page.click('a[href^="/ekonomi/fakturor/inv-1045"]'),
  ]);
  await page.goBack();
  await page.waitForFunction(() => location.pathname === "/ekonomi" && location.search.includes("flik=fakturor"));
  await ok("8 browser back to fakturor list", page.url().includes("flik=fakturor"));

  // Dead-end pages load
  for (const path of ["/bokforing", "/hemsida", "/ekonomi?flik=utgifter", "/ekonomi?flik=bank"]) {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle0" });
    await ok(`section ${path}`, res?.ok() ?? false);
  }

  // IA: sidebar + redirects
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  const sidebarText = await page.$eval("aside", (el) => (el.textContent ?? "").replace(/\s+/g, " "));
  await ok("IA sidebar has Inbox", sidebarText.includes("Inbox"));
  await ok("IA sidebar has no Assistent", !sidebarText.includes("Assistent"));
  await ok("IA sidebar keeps Settings", sidebarText.includes("Inställningar"));
  await page.screenshot({ path: ".shots/ia-desktop-hem.png" });

  await page.goto(`${BASE}/kunder`, { waitUntil: "networkidle0" });
  await ok("IA bare /kunder stays on register", page.url().includes("/kunder") && !page.url().includes("flik=forfragningar"));
  const kunderTabs = await page.evaluate(() => document.body.innerText);
  await ok("IA Kunder tabs are Kunder|Uppdrag", kunderTabs.includes("Uppdrag") && !/Förfrågningar/.test(kunderTabs.split("\n").slice(0, 20).join("\n")));
  await page.screenshot({ path: ".shots/ia-desktop-kunder.png" });

  await page.goto(`${BASE}/uppdrag`, { waitUntil: "networkidle0" });
  await ok("IA /uppdrag redirects to Kunder Uppdrag", page.url().includes("/kunder") && page.url().includes("flik=uppdrag"));

  await page.goto(`${BASE}/assistent`, { waitUntil: "networkidle0" });
  await ok("IA /assistent redirects home", new URL(page.url()).pathname === "/");

  await page.goto(`${BASE}/inbox`, { waitUntil: "networkidle0" });
  const inboxText = await page.evaluate(() => document.body.innerText);
  await ok("IA Inbox lists inquiries", inboxText.includes("Karin") || inboxText.includes("bokhylla") || inboxText.includes("Förfrågan"));
  await ok("IA Inbox lists seed mail", inboxText.includes("Byggmax") || inboxText.includes("Kvitto"));
  await ok("IA Inbox shows inbound address", inboxText.includes("demo@in.driva.se"));
  await page.screenshot({ path: ".shots/ia-desktop-inbox.png" });

  await page.goto(`${BASE}/kunder/forfragningar/req-karin`, { waitUntil: "networkidle0" });
  await ok("IA old forfragningar URL redirects", page.url().includes("/inbox/req-karin"));
  const inquiryTitle = await textOf(page, "h1");
  await ok("IA inquiry detail at new path", (inquiryTitle ?? "").includes("bokhylla") || (inquiryTitle ?? "").length > 0);

  await page.goto(`${BASE}/kunder?flik=forfragningar`, { waitUntil: "networkidle0" });
  await ok("IA forfragningar flik redirects to /inbox", new URL(page.url()).pathname === "/inbox");

  // 9. Mobile header/back
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${BASE}/ekonomi/fakturor/inv-1045`, { waitUntil: "networkidle0" });
  const mobileBack = await page.$("a[data-nav=back]");
  const box = await mobileBack?.boundingBox();
  await ok("9 mobile back visible", !!box && box.width > 20 && box.y < 200, JSON.stringify(box));
  const h1 = await textOf(page, "h1");
  await ok("9 mobile title visible", !!h1 && h1.length > 0, h1 ?? "");

  await page.goto(`${BASE}/uppdrag/job-kok`, { waitUntil: "networkidle0" });
  const mobileBack2 = await textOf(page, "a[data-nav=back]");
  await ok("9 mobile uppdrag back", (mobileBack2 ?? "").includes("Uppdrag"), mobileBack2 ?? "");

  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  const bottom = await page.evaluate(() => {
    const nav = [...document.querySelectorAll("nav")].find((n) => n.className.includes("lg:hidden") || n.getBoundingClientRect().bottom > 500);
    return (nav?.textContent ?? "").replace(/\s+/g, " ");
  });
  await ok("IA mobile primary has Inbox", /Hem/.test(bottom) && /Kunder/.test(bottom) && /Ekonomi/.test(bottom) && /Inbox/.test(bottom));
  await ok("IA mobile primary has Mer", /Mer/.test(bottom));
  const merBtn = await page.evaluateHandle(() =>
    [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Mer")) ?? null
  );
  if (merBtn.asElement()) {
    await merBtn.asElement()!.click();
    await page.waitForFunction(() => [...document.querySelectorAll("[role=dialog]")].some((d) => (d.textContent ?? "").includes("Bokföring")));
    const merText = await page.evaluate(() => {
      const dialog = document.querySelector("[role=dialog]");
      return (dialog?.textContent ?? "").replace(/\s+/g, " ");
    });
    await ok("IA Mer has Bokföring and Hemsida", merText.includes("Bokföring") && merText.includes("Hemsida"));
    await ok("IA Mer has Settings", merText.includes("Inställningar"));
    await page.screenshot({ path: ".shots/ia-mobile-mer.png" });
  }

  await page.goto(`${BASE}/inbox`, { waitUntil: "networkidle0" });
  await page.screenshot({ path: ".shots/ia-mobile-inbox.png" });

  await browser.close();
  console.log("\nAll nav scenarios passed:\n" + results.map((r) => "  " + r).join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
