import puppeteer from "puppeteer-core";

/**
 * Browserverifiering av de finansiella flödena mot dev-servern på :3123.
 *
 *   1. Hem visar exceptions från actionmotorn (kvitto saknas, förfallen faktura).
 *   2. Simulera inbetalning på skickad faktura → automatisk matchning → Betald.
 *   3. Bokföring visar bankavstämning och momsläge.
 *   4. Huvudboken: översikt per konto → paginerad kontodetalj (1930).
 *   5. Verifikationer: betalningsverifikationen syns överst.
 */

const BASE = "http://localhost:3123";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function fail(msg: string): never {
  console.error("FAIL", msg);
  process.exit(1);
}

async function main() {
  const reset = await fetch(`${BASE}/api/dev/reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "seed" }),
  });
  if (!reset.ok) fail(`reset: ${reset.status}`);
  console.log("ok reset till demodata");

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  await page.setViewport({ width: 1360, height: 950 });

  async function ok(name: string, cond: boolean, extra = "") {
    if (!cond) fail(`${name} ${extra} url=${page.url()}`);
    console.log("ok", name, extra);
  }
  const bodyText = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));

  // 1. Hem – exceptions från actionmotorn
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  let text = await bodyText();
  await ok("Hem: förfallen faktura-exception", /dag(ar)? sen/.test(text), "");
  await ok("Hem: oklar utgift-exception (fråga)", text.includes("Vad gällde betalningen"), "");
  const expanded = await page.$$eval("button", (btns) => {
    const b = btns.find((x) => /Visa \d+ till/.test(x.textContent ?? ""));
    if (!b) return false;
    (b as HTMLButtonElement).click();
    return true;
  });
  if (expanded) {
    await page.waitForFunction(() => document.body.innerText.includes("Kvitto saknas"));
  }
  text = await bodyText();
  await ok("Hem: kvitto saknas-exception", text.includes("Kvitto saknas"), "");

  // 2. Skickad faktura → simulera inbetalning → automatiskt matchad & bokförd
  await page.goto(`${BASE}/ekonomi/fakturor/inv-1047`, { waitUntil: "networkidle0" });
  text = await bodyText();
  await ok("Faktura 1047: öppen fordran före betalning", /Förfallen|Skickad/.test(text), "");
  const simulate = await page.$$eval("button", (btns) => {
    const b = btns.find((x) => (x.textContent ?? "").includes("Simulera inbetalning"));
    if (!b) return false;
    (b as HTMLButtonElement).click();
    return true;
  });
  await ok("Faktura 1047: demoknappen finns", simulate, "");
  await page.waitForFunction(
    () => document.body.innerText.includes("Betald"),
    { timeout: 20000 }
  );
  await ok("Faktura 1047: auto-matchad till Betald", true, "");

  // 3. Bokföring – hälsa: antingen "avstämd ✓" eller härledda problem för
  //    varje obokförd transaktion (aldrig en tyst diff).
  await page.goto(`${BASE}/bokforing`, { waitUntil: "networkidle0" });
  text = await bodyText();
  const reconOk = text.includes("Banken är avstämd");
  const derivedProblems =
    text.includes("Kvitto saknas") || text.includes("Vad gällde betalningen") || text.includes("Banken stämmer inte");
  await ok("Bokföring: avstämd ✓ eller härledda problem", reconOk || derivedProblems, reconOk ? "avstämd" : "härledda problem");
  await ok("Bokföring: momsläge syns", text.includes("Moms") || text.includes("moms"), "");

  // 4. Huvudbok – översikt → paginerad kontodetalj
  await page.goto(`${BASE}/bokforing/huvudbok`, { waitUntil: "networkidle0" });
  text = await bodyText();
  await ok("Huvudbok: översikt visar 1930", text.includes("1930"), "");
  await page.goto(`${BASE}/bokforing/huvudbok?konto=1930`, { waitUntil: "networkidle0" });
  text = await bodyText();
  await ok("Huvudbok 1930: kontodetalj renderas", text.includes("Företagskonto"), "");
  await ok("Huvudbok 1930: nya betalningen syns", text.includes("1047"), "");

  // 5. Verifikationer – betalningsverifikationen finns
  await page.goto(`${BASE}/bokforing/verifikationer`, { waitUntil: "networkidle0" });
  text = await bodyText();
  await ok("Verifikationer: betalning för 1047 bokförd", /1047/.test(text), "");

  await browser.close();
  console.log("\nAlla browserkontroller godkända.");
}

main().catch((e) => fail(String(e)));
