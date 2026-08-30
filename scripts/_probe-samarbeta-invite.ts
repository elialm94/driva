/**
 * Probe: Samarbeta invite dialog (owner, JSON demo).
 * 1. Dialog shows ONLY email + explanation + Avbryt/Skicka inbjudan (no role selector).
 * 2. Sending creates a pending invite with role accounting_consultant.
 * 3. Skicka igen + Ta tillbaka inbjudan still work.
 * 4. Dialog usable at 375px viewport.
 */
import { readFileSync } from "fs";
import puppeteer from "puppeteer-core";

const BASE = "http://localhost:3123";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TEST_EMAIL = `probe.${Date.now()}@byra.se`;

function fail(msg: string): never {
  console.error("FAIL", msg);
  process.exit(1);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);

  async function ok(name: string, cond: boolean, extra = "") {
    if (!cond) fail(`${name} ${extra} url=${page.url()}`);
    console.log("ok", name, extra);
  }

  async function clickButtonByText(text: string, scope = "body") {
    const clicked = await page.evaluate(
      (t, s) => {
        const root = document.querySelector(s);
        if (!root) return false;
        const els = [...root.querySelectorAll("button")];
        const el = els.find((b) => (b.textContent ?? "").replace(/\s+/g, " ").trim() === t);
        if (!el) return false;
        (el as HTMLButtonElement).click();
        return true;
      },
      text,
      scope
    );
    if (!clicked) fail(`button "${text}" not found in ${scope}`);
  }

  const dialogText = () =>
    page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return d ? (d.textContent ?? "").replace(/\s+/g, " ").trim() : null;
    });

  // ---------- Desktop ----------
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/samarbeta`, { waitUntil: "networkidle0" });
  const h1 = await page.evaluate(() => document.querySelector("h1")?.textContent ?? "");
  await ok("1 owner sees Samarbeta page", h1.includes("Samarbeta"), h1);

  // Cleanup: revoke pending probe invites left by earlier runs.
  for (let i = 0; i < 5; i++) {
    const found = await page.evaluate(() => {
      const li = [...document.querySelectorAll("li")].find((n) =>
        /probe\.[\w.]*@byra\.se/.test(n.textContent ?? "")
      );
      if (!li) return false;
      const btn = [...li.querySelectorAll("button")].find((b) =>
        (b.textContent ?? "").includes("Ta tillbaka inbjudan")
      );
      if (!btn) return false;
      (btn as HTMLButtonElement).click();
      return true;
    });
    if (!found) break;
    await page.waitForSelector('[role="dialog"]');
    await clickButtonByText("Ta tillbaka inbjudan", '[role="dialog"]');
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    console.log("cleanup: revoked leftover probe invite");
  }

  await clickButtonByText("Bjud in");
  await page.waitForSelector('[role="dialog"] #invite-email');
  const dt = (await dialogText()) ?? "";
  await ok("2 dialog title", dt.includes("Bjud in till Driva"));
  await ok("3 dialog has E-post", dt.includes("E-post"));
  await ok(
    "4 dialog has explanation",
    dt.includes("Personen får tillgång till företagets bokföring och kan hjälpa dig hantera den.") &&
      dt.includes("Du kan ta bort åtkomsten när som helst.")
  );
  await ok("5 no role selector text", !dt.includes("Åtkomst") && !dt.includes("Revisor"));
  const radios = await page.evaluate(() => document.querySelectorAll('[role="dialog"] input[type="radio"]').length);
  await ok("6 zero radio inputs", radios === 0, `radios=${radios}`);
  const inputs = await page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"] input')].map((i) => (i as HTMLInputElement).type)
  );
  await ok("7 only email input", inputs.length === 1 && inputs[0] === "email", JSON.stringify(inputs));
  await ok("8 footer buttons", dt.includes("Avbryt") && dt.includes("Skicka inbjudan"));
  const placeholder = await page.evaluate(
    () => (document.querySelector("#invite-email") as HTMLInputElement | null)?.placeholder ?? ""
  );
  await ok("9 placeholder", placeholder === "namn@byra.se", placeholder);

  // ---------- Send invite ----------
  await page.type("#invite-email", TEST_EMAIL);
  await clickButtonByText("Skicka inbjudan", '[role="dialog"]');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"] #invite-email'));
  await page.waitForFunction(
    (email) => (document.body.textContent ?? "").includes(email),
    {},
    TEST_EMAIL
  );
  const bodyText = await page.evaluate(() => (document.body.textContent ?? "").replace(/\s+/g, " "));
  await ok("10 pending row shown", bodyText.includes("Inbjudan skickad"));
  await ok("11 pending row role label", bodyText.includes("Inbjudan skickad · Redovisningskonsult"));
  await ok("12 Skicka igen visible", bodyText.includes("Skicka igen"));
  await ok("13 Ta tillbaka inbjudan visible", bodyText.includes("Ta tillbaka inbjudan"));

  // ---------- Invitation role persisted as accounting_consultant ----------
  const db = JSON.parse(readFileSync(".data/db.json", "utf8"));
  const inv = (db.collaborationInvitations ?? []).find((i: { email: string }) => i.email === TEST_EMAIL);
  await ok("14 invitation persisted", Boolean(inv));
  await ok("15 role accounting_consultant", inv?.role === "accounting_consultant", `role=${inv?.role}`);
  await ok("16 status pending", inv?.status === "pending", `status=${inv?.status}`);
  const reg = JSON.parse(readFileSync(".data/collaboration.json", "utf8"));
  const regInv = (reg.invitations ?? []).find((i: { email: string }) => i.email === TEST_EMAIL);
  await ok("17 registry role accounting_consultant", !regInv || regInv.role === "accounting_consultant", `role=${regInv?.role}`);

  // ---------- Mobile usability (375px) ----------
  await page.setViewport({ width: 375, height: 812 });
  await page.goto(`${BASE}/samarbeta`, { waitUntil: "networkidle0" });
  await clickButtonByText("Bjud in");
  await page.waitForSelector('[role="dialog"] #invite-email');
  const boxes = await page.evaluate(() => {
    const input = document.querySelector("#invite-email");
    const submit = document.querySelector('button[form="invite-form"]');
    const ib = input ? input.getBoundingClientRect() : null;
    const sb = submit ? submit.getBoundingClientRect() : null;
    return {
      input: ib ? { left: ib.left, right: ib.right, top: ib.top, bottom: ib.bottom } : null,
      submit: sb ? { left: sb.left, right: sb.right, top: sb.top, bottom: sb.bottom } : null,
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });
  await ok(
    "18 mobile: email input inside viewport",
    Boolean(boxes.input && boxes.input.left >= 0 && boxes.input.right <= boxes.vw),
    JSON.stringify(boxes.input)
  );
  await ok(
    "19 mobile: submit button visible in viewport",
    Boolean(boxes.submit && boxes.submit.right <= boxes.vw && boxes.submit.bottom <= boxes.vh && boxes.submit.top >= 0),
    JSON.stringify(boxes.submit)
  );
  await page.screenshot({ path: ".data/ux-audit/samarbeta-invite-mobile.png" });
  await clickButtonByText("Avbryt", '[role="dialog"]');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));

  // ---------- Skicka igen ----------
  await page.setViewport({ width: 1280, height: 900 });
  await clickButtonByText("Skicka igen");
  await page.waitForFunction(() =>
    /Inbjudan (skickad igen|uppdaterad)/.test(document.body.textContent ?? "")
  );
  await ok("20 resend works", true);

  // ---------- Ta tillbaka inbjudan (also cleans up probe data) ----------
  await clickButtonByText("Ta tillbaka inbjudan");
  await page.waitForSelector('[role="dialog"]');
  const confirmText = (await dialogText()) ?? "";
  await ok("21 revoke confirm dialog", confirmText.includes("Ta tillbaka inbjudan?") && confirmText.includes(TEST_EMAIL));
  await clickButtonByText("Ta tillbaka inbjudan", '[role="dialog"]');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  // Rendered rows only – body.textContent would also see the stale RSC flight payload in <script>.
  await page.waitForFunction(
    (email) => ![...document.querySelectorAll("li")].some((li) => (li.textContent ?? "").includes(email)),
    {},
    TEST_EMAIL
  );
  await ok("22 invite revoked and gone from list", true);
  const db2 = JSON.parse(readFileSync(".data/db.json", "utf8"));
  const inv2 = (db2.collaborationInvitations ?? []).find((i: { email: string }) => i.email === TEST_EMAIL);
  await ok("23 invitation revoked in db", inv2?.status === "revoked", `status=${inv2?.status}`);

  await browser.close();
  console.log("ALL OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
