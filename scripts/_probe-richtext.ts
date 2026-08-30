import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 950 });
  await page.goto("http://localhost:3123/ekonomi/offerter/ny", { waitUntil: "networkidle0" });
  const pm = ".richtext-editor .ProseMirror";
  await page.waitForSelector(pm);
  await page.click(pm);
  await page.keyboard.type("Vår webbplats");
  await page.keyboard.down("Shift");
  for (let i = 0; i < "webbplats".length; i += 1) await page.keyboard.press("ArrowLeft");
  await page.keyboard.up("Shift");
  const sel = await page.evaluate(() => window.getSelection()?.toString());
  console.log("selection:", JSON.stringify(sel));
  await page.click('button[aria-label="Länk"]');
  await page.waitForSelector("#richtext-link-url");
  await page.type("#richtext-link-url", "exempel.se");
  await page.$$eval("button", (els) => { (els.find((e) => (e.textContent ?? "").includes("Spara länk")) as HTMLElement).click(); });
  await new Promise((r) => setTimeout(r, 800));
  const html = await page.$eval(pm, (el) => el.innerHTML);
  console.log("editor-HTML:", html.slice(0, 500));
  await browser.close();
}
main();
