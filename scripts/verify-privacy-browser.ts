/**
 * Browserkoll av integritets-UX på den publika sajten.
 *   npx tsx scripts/verify-privacy-browser.ts
 */
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.PRIVACY_VERIFY_URL ?? "http://localhost:3147";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";
const OUT = process.env.PRIVACY_SHOTS ?? "/tmp/driva-privacy-shots";

fs.mkdirSync(OUT, { recursive: true });

function fail(msg: string): never {
  console.error("FAIL", msg);
  process.exit(1);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--window-size=1280,900"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  await page.goto(`${BASE}/sajt`, { waitUntil: "networkidle0" });
  const form = await page.evaluate(() => {
    const notice = document.querySelector("[data-privacy-notice]");
    const submit = document.querySelector('button[type="submit"]');
    const checkbox = document.querySelector('input[type="checkbox"]');
    const footer = document.querySelector("footer")?.textContent ?? "";
    const formEl = document.querySelector("form");
    const noticeBeforeSubmit = Boolean(
      notice && submit && notice.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING
    );
    return {
      notice: notice?.textContent ?? "",
      noticeHref: notice?.querySelector("a")?.getAttribute("href") ?? "",
      submit: submit?.textContent ?? "",
      checkbox: Boolean(checkbox),
      footer,
      noticeBeforeSubmit,
      inForm: Boolean(formEl?.contains(notice)),
    };
  });
  if (!form.notice.includes("Södermalms Snickeri AB")) fail(`notice saknar företagsnamn: ${form.notice}`);
  if (!form.notice.includes("integritetspolicyn")) fail(`notice saknar länktext: ${form.notice}`);
  if (form.noticeHref !== "/integritetspolicy") fail(`fel href ${form.noticeHref}`);
  if (form.checkbox) fail("samtyckesruta finns");
  if (!form.noticeBeforeSubmit) fail("notisen ligger inte ovanför Skicka");
  if (!form.footer.includes("Integritetspolicy")) fail("sidfot saknar Integritetspolicy");
  if (!form.footer.includes("559123-4567")) fail("sidfot saknar org.nr");
  await page.screenshot({ path: `${OUT}/sajt-desktop.png`, fullPage: true });

  await page.setViewport({ width: 390, height: 844 });
  await page.evaluate(() => document.querySelector("#kontakt")?.scrollIntoView());
  await page.screenshot({ path: `${OUT}/sajt-mobile-form.png` });

  await page.setViewport({ width: 1280, height: 900 });
  await page.click("[data-privacy-notice] a");
  await page.waitForSelector("[data-privacy-policy]");
  const policy = await page.evaluate(() => document.body.innerText);
  for (const must of [
    "Södermalms Snickeri AB",
    "559123-4567",
    "Renstiernas gata 12",
    "Personuppgiftsansvarig",
    "6.1 b",
    "6.1 f",
    "inte samtycke",
    "Integritetsskyddsmyndigheten",
  ]) {
    if (!policy.includes(must)) fail(`policy saknar: ${must}`);
  }
  if (policy.includes("Instagram")) fail("policy nämner Instagram utan integration");
  await page.screenshot({ path: `${OUT}/policy-desktop.png`, fullPage: true });

  await page.goto(`${BASE}/sajt`, { waitUntil: "networkidle0" });
  await page.waitForSelector("form [data-privacy-notice]");
  await page.click('input[name="name"]');
  await page.keyboard.type("Karin Testsson");
  await page.click('input[name="email"]');
  await page.keyboard.type("karin-privacy@example.se");
  await page.click('input[name="phone"]');
  await page.keyboard.type("0701112233");
  await page.click("textarea[name=message]");
  await page.keyboard.type("Hej, vi vill ha offert pa en bokhylla.");
  await page.click('button[type="submit"]');
  try {
    await page.waitForFunction(() => document.body.innerText.includes("Tack för ditt meddelande"), {
      timeout: 10000,
    });
  } catch {
    const leftover = await page.evaluate(() => document.body.innerText);
    fail(`formuläret skickades inte. Sidtext:\n${leftover.slice(-600)}`);
  }
  await page.screenshot({ path: `${OUT}/sajt-submitted.png` });

  await page.goto(`${BASE}/hemsida`, { waitUntil: "networkidle0" });
  const settingsTab = await page.$('#sitetab-installningar');
  if (settingsTab) await settingsTab.click();
  const builder = await page.evaluate(() => document.body.innerText);
  if (!builder.includes("Standard") && !builder.includes("Anpassad")) {
    fail("byggaren saknar integritetskort");
  }
  await page.screenshot({ path: `${OUT}/hemsida-settings.png`, fullPage: true });

  await browser.close();
  console.log("OK privacy browser", OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
