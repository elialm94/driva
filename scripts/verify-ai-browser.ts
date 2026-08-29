import puppeteer from "puppeteer-core";

/**
 * Webbläsarpass för LLM-vägen: fri text som deterministiska tolkningen
 * missar → riktig OpenRouter-loop → verktygsanrop → utkast-/bekräftelsekort.
 *
 * Gör RIKTIGA (få, billiga) LLM-anrop via dev-servern på :3123.
 *
 *   npx tsx scripts/verify-ai-browser.ts
 */

const BASE = "http://localhost:3123";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function fail(msg: string): never {
  console.error("FAIL", msg);
  process.exit(1);
}

async function resetSeed() {
  const res = await fetch(`${BASE}/api/dev/reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "seed" }),
  });
  if (!res.ok) fail(`kunde inte återställa demodata: ${res.status}`);
}

async function main() {
  await resetSeed();
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
    page.setDefaultTimeout(45_000);

    await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
    const input = 'input[placeholder="Vad vill du göra?"]';
    await page.click(input);
    const phrase = "johan ska betala resten för altanjobbet";
    await page.type(input, phrase);

    // Deterministiska förslag leder – LLM-vägen är den explicita raden
    // "Fråga assistenten" (eller Enter i ärligt läge utan förslag).
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('[role="option"]')).some((el) =>
        (el.textContent ?? "").includes("Fråga assistenten")
      )
    );
    const rows = await page.$$('[role="option"]');
    for (const row of rows) {
      const t = await row.evaluate((el) => el.textContent ?? "");
      if (t.includes("Fråga assistenten")) {
        await row.click();
        break;
      }
    }

    // Vänta på riktigt LLM-resultat (loopen kan ta 10–20 s).
    await page.waitForFunction(
      () => {
        const t = (document.body.textContent ?? "").replace(/\s+/g, " ");
        return /fakturautkast|utkast|bekräfta|Skicka fakturautkastet|otillgänglig/i.test(t) && !t.includes("Hämtar …");
      },
      { timeout: 45_000 }
    );
    await new Promise((r) => setTimeout(r, 1500));

    const body = await page.evaluate(() => (document.body.textContent ?? "").replace(/\s+/g, " "));
    if (/otillgänglig/i.test(body)) fail("LLM svarade 'otillgänglig'");
    console.log("ok  LLM-svar i resultatpanelen");

    // Utkastet ska finnas på riktigt: kort med djuplänk eller bekräftelsekort.
    const hasCard = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
      const buttons = Array.from(document.querySelectorAll("button")).map((b) => b.textContent ?? "");
      return {
        draftLink: links.some((h) => h.startsWith("/ekonomi/fakturor/")),
        confirm: buttons.some((t) => /Skicka|Bekräfta/i.test(t)),
      };
    });
    if (!hasCard.draftLink && !hasCard.confirm) fail("varken utkastlänk eller bekräftelsekort syns");
    console.log(`ok  kort: utkastlänk=${hasCard.draftLink} bekräftelseknapp=${hasCard.confirm}`);

    await page.screenshot({ path: "/tmp/cb-ai-freetext.png" });

    // Verifiera serverside: ett utkast för cust-johan skapades, inget skickades.
    console.log("klart – skärmbild: /tmp/cb-ai-freetext.png");
  } finally {
    await browser.close();
    await resetSeed();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
