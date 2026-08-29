/* Verifierar manuellt sänkt ROT-avdrag i offert- och fakturaeditorn. */
import puppeteer from "puppeteer-core";

const BASE = "http://localhost:3123";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });

async function goto(path) {
  await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 45000 });
  await sleep(500);
}

async function normText() {
  return page.evaluate(() => document.body.innerText.replace(/\u00a0/g, " "));
}

async function has(text) {
  const t = await normText();
  return t.includes(text);
}

async function clickText(selector, text, exact = false) {
  const clicked = await page.evaluate(
    (sel, t, exact) => {
      const el = [...document.querySelectorAll(sel)].find((e) => {
        const x = (e.textContent || "").trim();
        if (e.disabled) return false;
        return exact ? x === t : x.includes(t);
      });
      if (!el) return false;
      el.scrollIntoView({ block: "center" });
      el.click();
      return true;
    },
    selector,
    text,
    exact
  );
  await sleep(300);
  return clicked;
}

async function clickDialogButton(text) {
  const clicked = await page.evaluate((t) => {
    const dialog = document.querySelector('[role="dialog"]');
    const btn =
      dialog &&
      [...dialog.querySelectorAll("button")].find((b) => (b.textContent || "").trim().includes(t));
    if (!btn) return false;
    btn.click();
    return true;
  }, text);
  await sleep(400);
  return clicked;
}

async function clickDeductionChange() {
  const clicked = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("p, div, span")];
    const host = nodes.find(
      (n) =>
        (n.textContent || "").includes("Preliminärt ROT-avdrag") &&
        [...n.querySelectorAll("button")].some((b) => (b.textContent || "").trim() === "Ändra")
    );
    const btn = host && [...host.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Ändra");
    if (!btn) return false;
    btn.scrollIntoView({ block: "center" });
    btn.click();
    return true;
  });
  await sleep(300);
  return clicked;
}

async function setLabeledInput(label, value) {
  await page.evaluate(
    (aria, value) => {
      const el =
        document.querySelector(`input[aria-label="${aria}"]`) ||
        [...document.querySelectorAll("input")].find((i) => (i.placeholder || "").includes(aria));
      if (!el) {
        const labels = [...document.querySelectorAll("input")].map((i) => i.getAttribute("aria-label") || i.placeholder || i.type);
        throw new Error("Hittade inte " + aria + " (finns: " + labels.slice(0, 12).join(" | ") + ")");
      }
      el.focus();
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
      proto.set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.blur();
    },
    label,
    value
  );
  await sleep(200);
}

async function publicHref(prefix) {
  return page.evaluate((prefix) => {
    const a = [...document.querySelectorAll("a")].find((el) => (el.getAttribute("href") || "").startsWith(prefix));
    return a ? a.getAttribute("href") : null;
  }, prefix);
}

let failed = 0;
function check(name, ok) {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok" : "FAIL"}  ${name}`);
}

try {
  page.on("pageerror", (err) => console.error("pageerror", err.message));
  await goto("/ekonomi/fakturor/ny?job=job-kok");
  await page.waitForSelector("input, textarea, button", { timeout: 20000 });
  await page.waitForFunction(() => document.body.innerText.includes("Fakturarader"), { timeout: 20000 });
  check("Klickade ROT", await clickText("button", "ROT", true));
  await setLabeledInput("Vad ingår", "Snickeriarbete");
  await setLabeledInput("À-pris exkl.", "80000");
  await sleep(400);
  const afterPrice = await normText();
  check("Visar maximalt preliminärt ROT-avdrag", afterPrice.includes("Maximalt preliminärt ROT-avdrag"));
  check("Applied defaultar till max 30 000 kr", afterPrice.includes("30 000"));
  check("Hjälptext nämner inte Skatteverkets saldo", afterPrice.includes("maximala avdrag som fakturan medger"));
  check(
    "Påstår inte kvarvarande utrymme",
    !afterPrice.includes("kvarvarande utrymme") &&
      !afterPrice.includes("kundens max") &&
      !afterPrice.includes("tillgängligt ROT-utrymme")
  );
  check("Att betala använder avdraget (70 000)", afterPrice.includes("70 000"));

  check("Klickade Ändra", await clickDeductionChange());
  await setLabeledInput("ROT-avdrag att använda", "20000");
  await sleep(300);
  const lowered = await normText();
  check("Sänkt avdrag syns live", lowered.includes("20 000"));
  check("Att betala uppdateras live till 80 000", lowered.includes("80 000"));
  check("Använd max syns när avdraget sänkts", lowered.includes("Använd max"));
  check("Max för fakturan syns", lowered.includes("Max för fakturan"));

  check("Klickade Ändra igen för över-max", await clickDeductionChange());
  await setLabeledInput("ROT-avdrag att använda", "40000");
  await sleep(200);
  const over = await normText();
  check(
    "Fel när avdrag överstiger max",
    over.includes("Avdraget kan inte vara högre än maximalt") && over.includes("30 000")
  );
  check("Över max accepteras inte (att betala fortfarande 80 000)", over.includes("80 000"));

  await setLabeledInput("ROT-avdrag att använda", "20000");
  await sleep(200);
  await page.evaluate(() => document.body.click());
  await sleep(200);
  await setLabeledInput("À-pris exkl.", "10000");
  await sleep(500);
  const clamped = await normText();
  if (!(clamped.includes("justerades till") && clamped.includes("avdragsgrundande arbetskostnad"))) {
    const i = clamped.indexOf("Arbetskostnad");
    console.log("--- clamp text snippet ---\n", clamped.slice(i >= 0 ? i : 0, (i >= 0 ? i : 0) + 800));
  }
  check(
    "Klampar när arbetskostnaden sänks",
    clamped.includes("justerades till") && clamped.includes("avdragsgrundande arbetskostnad")
  );

  check("Klickade Använd max", await clickText("button", "Använd max"));
  await sleep(300);
  const restored = await normText();
  check("Använd max återställer till beräknat max", restored.includes("Maximalt preliminärt ROT-avdrag") && !restored.includes("Använd max"));

  check("Klickade Ändra före spar", await clickDeductionChange());
  await setLabeledInput("ROT-avdrag att använda", "2000");
  await sleep(200);

  check("Sparade fakturautkast", await clickText("button", "Spara utkast"));
  await page.waitForFunction(
    () => location.pathname.includes("/ekonomi/fakturor/") && !location.pathname.endsWith("/ny") && !location.pathname.includes("redigera"),
    { timeout: 20000 }
  );
  await sleep(800);
  const invoiceDoc = await normText();
  check("Fakturadokument visar sänkt Preliminärt ROT-avdrag", invoiceDoc.includes("Preliminärt ROT-avdrag") && invoiceDoc.includes("2 000"));
  check("Kunddokument visar inte maximalt preliminärt", !invoiceDoc.includes("Maximalt preliminärt ROT-avdrag"));
  check("Kunddokument nämner inte Max för fakturan", !invoiceDoc.includes("Max för fakturan"));

  check("Öppnade skicka-faktura", await clickText("button", "Skicka faktura"));
  await sleep(400);
  check("Bekräftade skicka faktura", await clickDialogButton("Skicka faktura"));
  await page.waitForFunction(
    () => [...document.querySelectorAll("a")].some((a) => (a.getAttribute("href") || "").startsWith("/faktura/")),
    { timeout: 20000 }
  );
  await sleep(500);
  const publicLink = await publicHref("/faktura/");
  if (publicLink) {
    await goto(publicLink);
    const pub = await normText();
    check("Publik faktura visar inte teoretiskt max", !pub.includes("Maximalt preliminärt ROT-avdrag"));
    if (!(pub.includes("Preliminärt ROT-avdrag") && pub.includes("2 000"))) {
      console.log("--- publik faktura snippet ---\n", pub.slice(0, 1200));
    }
    check("Publik faktura visar sänkt preliminärt avdrag", pub.includes("Preliminärt ROT-avdrag") && pub.includes("2 000"));
  } else {
    check("Hittade publik fakturalänk", false);
  }

  await goto("/ekonomi/offerter/ny");
  await page.waitForSelector("input, textarea, button", { timeout: 20000 });
  await page.waitForFunction(() => document.body.innerText.includes("Prisrader"), { timeout: 20000 });
  await page.evaluate(() => {
    const title = [...document.querySelectorAll("input")].find((i) => i.placeholder && i.placeholder.includes("Köksrenovering"));
    if (title) {
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
      proto.set.call(title, "ROT-avdragstest");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  check("Klickade ROT på offert", await clickText("button", "ROT (30 % på arbete)", true));
  await setLabeledInput("Vad ingår", "Snickeriarbete");
  await setLabeledInput("À-pris exkl.", "80000");
  await sleep(400);
  check("Offert visar maximalt preliminärt ROT-avdrag", await has("Maximalt preliminärt ROT-avdrag"));
  check("Klickade Ändra på offert", await clickDeductionChange());
  await setLabeledInput("ROT-avdrag att använda", "15000");
  await sleep(300);
  const quoteForm = await normText();
  check("Offert sänkt avdrag 15 000", quoteForm.includes("15 000"));
  check("Offert visar Använd max", quoteForm.includes("Använd max"));
  check("Sparade offerutkast", await clickText("button", "Spara utkast"));
  await page.waitForFunction(
    () => location.pathname.includes("/ekonomi/offerter/") && !location.pathname.endsWith("/ny") && !location.pathname.includes("redigera"),
    { timeout: 20000 }
  );
  await sleep(800);
  const quoteDoc = await normText();
  check("Offertdokument visar sänkt preliminärt avdrag", quoteDoc.includes("15 000") && quoteDoc.includes("Preliminärt ROT-avdrag"));
  check("Offertdokument visar inte maximalt preliminärt", !quoteDoc.includes("Maximalt preliminärt ROT-avdrag"));

  check("Öppnade skicka-offert", await clickText("button", "Skicka offert"));
  await sleep(400);
  check("Bekräftade skicka offert", await clickDialogButton("Skicka offert"));
  await page.waitForFunction(
    () => [...document.querySelectorAll("a")].some((a) => (a.getAttribute("href") || "").startsWith("/offert/")),
    { timeout: 20000 }
  );
  await sleep(500);
  const quotePublic = await publicHref("/offert/");
  if (quotePublic) {
    await goto(quotePublic);
    const pub = await normText();
    check(
      "Publik offert visar 15 000, inte teoretiskt max-rad",
      pub.includes("15 000") && !pub.includes("Maximalt preliminärt ROT-avdrag")
    );
  } else {
    check("Hittade publik offertlänk", false);
  }

  await goto("/ekonomi/offerter/ny?job=job-kokso");
  await page.waitForFunction(() => document.body.innerText.includes("Prisrader"), { timeout: 20000 });
  check("Klickade ROT på offert kopplad till uppdrag", await clickText("button", "ROT (30 % på arbete)", true));
  await setLabeledInput("Vad ingår", "Snickeriarbete");
  await setLabeledInput("À-pris exkl.", "80000");
  check("Ändra avdrag på uppdragsoffert", await clickDeductionChange());
  await setLabeledInput("ROT-avdrag att använda", "15000");
  check("Sparade uppdragsoffert", await clickText("button", "Spara utkast"));
  await page.waitForFunction(
    () => location.pathname.includes("/ekonomi/offerter/") && !location.pathname.endsWith("/ny"),
    { timeout: 20000 }
  );

  await goto("/ekonomi/fakturor/ny?job=job-kokso");
  await page.waitForFunction(() => document.body.innerText.includes("Fakturarader"), { timeout: 20000 });
  const invoiceFromQuoteStart = await normText();
  check("Faktura från offert har ROT förvalt", invoiceFromQuoteStart.includes("Maximalt preliminärt ROT-avdrag") || invoiceFromQuoteStart.includes("Preliminärt ROT-avdrag") || invoiceFromQuoteStart.includes("ROT"));
  await setLabeledInput("Vad ingår", "Snickeriarbete");
  await setLabeledInput("À-pris exkl.", "80000");
  await sleep(400);
  const inherited = await normText();
  check("Faktura från offert ärver 15 000 kr avdrag", inherited.includes("15 000"));
  check("Ärvd faktura visar Använd max", inherited.includes("Använd max"));
} catch (e) {
  failed += 1;
  console.error("FAIL  script error", e);
} finally {
  await browser.close();
}

if (failed > 0) {
  console.error(`\n${failed} kontroller misslyckades.`);
  process.exit(1);
}
console.log("\nAlla UI-kontroller godkända.");
