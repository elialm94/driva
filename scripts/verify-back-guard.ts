/**
 * Verifierar mobil-bakåtbeteendet för osparade ändringar (spec E16):
 *  1. SPA-navigering in i Ny faktura via länk
 *  2. Smutsa formuläret
 *  3. history.back() (= swipe-back/bakåtknapp på mobil)
 *  4. Rapportera: URL efteråt, native dialog?, in-app dialog?, dubbla poster?
 */
import puppeteer from "puppeteer-core";

const BASE = "http://localhost:3123";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, hasTouch: true });
  page.setDefaultTimeout(20000);

  let nativeDialog = false;
  page.on("dialog", (d) => {
    nativeDialog = true;
    void d.accept();
  });

  // 1. Start på fakturalistan, klicka in till Ny faktura (SPA-transition).
  await page.goto(`${BASE}/ekonomi?flik=fakturor`, { waitUntil: "networkidle0" });
  const linkFound = await page.evaluate(() => {
    const a = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].find((x) =>
      x.getAttribute("href")?.startsWith("/ekonomi/fakturor/ny")
    );
    if (a) a.click();
    return Boolean(a);
  });
  if (!linkFound) {
    console.log("HITTADE INGEN LÄNK till /ekonomi/fakturor/ny från fakturalistan");
    await page.goto(`${BASE}/ekonomi/fakturor/ny`, { waitUntil: "networkidle0" });
  }
  await page.waitForFunction(() => location.pathname === "/ekonomi/fakturor/ny");
  await new Promise((r) => setTimeout(r, 800));

  // 2. Smutsa formuläret: skriv i beskrivningsfältet på första raden.
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>("input[placeholder^='Vad ingår']");
    input?.focus();
  });
  await page.keyboard.type("Testarbete");
  await new Promise((r) => setTimeout(r, 300));

  // 3. Bakåt.
  await page.goBack().catch(() => null);
  await new Promise((r) => setTimeout(r, 1200));

  const after = await page.evaluate(() => ({
    url: location.pathname + location.search,
    inAppDialog: Boolean(document.querySelector("[role=dialog]")),
    bodyText: document.body.innerText.slice(0, 200),
  }));

  console.log("efter back():", after.url);
  console.log("native beforeunload-dialog:", nativeDialog);
  console.log("in-app dialog synlig:", after.inAppDialog);

  // 4. Framåt igen – lever formulärstate kvar?
  await page.goForward().catch(() => null);
  await new Promise((r) => setTimeout(r, 1200));
  const restored = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>("input[placeholder^='Vad ingår']");
    return { url: location.pathname, desc: input?.value ?? "(fältet saknas)" };
  });
  console.log("efter forward():", restored.url, "· beskrivning:", JSON.stringify(restored.desc));

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
