process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { buildSeed } from "./seed";
import { db, replaceDb } from "./store";
import { invoicePdfBytes, quotePdfBytes } from "./invoices/document-pdf";
import { sellerIdentityFooter } from "./invoices/document-view";
import { authEmail } from "./email/auth-templates";
import { inboxDocumentEmail, ownerNoticeTestEmail, quoteDeclinedEmail } from "./email/owner-notice-templates";
import manifest from "../app/manifest";
import { FERVA_MARK_YELLOW } from "../components/ferva-mark";
import { ICON_DIR, ICON_TARGETS, checkIcons, decodePng, hexToRgb } from "./brand-icons";

/**
 * Varumärkesskanning (spec §11): produkten heter Ferva. Det gamla namnet får
 * finnas kvar som tekniska identifierare (env-prefix DRIVA_, globala nycklar,
 * loggprefix, reserverad slug, Vercel-projektnamn) men aldrig i något en
 * användare ser – gränssnitt, mejl, PDF, metadata, filnamn.
 *
 * Två lager: en statisk skanning av källkoden (allt som inte är tillåtet
 * mönster faller) och en körning av renderarna på seed-data.
 */
const ROOT = process.cwd();
const SCAN_DIRS = ["src", "public", "mobile"];
const SKIP_DIRS = new Set(["node_modules", ".next", "ios", "android", "www"]);
const TEXT_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".css", ".html", ".txt", ".webmanifest", ".xml"]);

/** Tekniska förekomster av det gamla namnet som är tillåtna. Allt annat faller. */
const ALLOWED = [
  /\bDRIVA_[A-Z0-9_]+/g, // env-variabler (DRIVA_TEST, DRIVA_STORAGE, DRIVA_APP_URL …)
  /\bdriva_[a-z_]+/g, // cookienamn och databasrollen driva_app (byts aldrig utan migration + utloggning)
  /driva-(platform|wholesaler-catalog|collaboration|live-refresh|demo-sessions|db\.json)\b/g, // /tmp-filer och BroadcastChannel i JSON-läget
  /driva:scroll/g, // sessionStorage-nyckel
  /\bdriva Ferva\b/g, // verbet "driva" i löptext
  /__driva\w*/g, // globala nycklar på globalThis/window
  /\[driva:[a-z]+\]/g, // loggprefix i serverloggen
  /@?driva\\?\.(local|internal)\b/g, // interna platshållardomäner (aldrig i utskick), även som regex
  /data-driva-demo/g, // DOM-attribut för klientgrindar
  /x-driva-public-host/g, // intern proxy-header
  /"driva",?/g, // reserverad inbox-slug
  /\bdriva-alpha\.vercel\.app\b/g, // Vercel-projektets historiska URL
  /elialm94\/driva/g, // GitHub-repots namn
  /\bisDrivaAppHost\b/g, // funktionsnamn
  /`driva`/g, // Vercel-projektnamnet i kommentarer
  /projektet driva\b/g,
  /VERCEL_PROJECT_NAME=driva/g,
  /\|\| "driva"/g, // default för Vercel-projektnamnet
  /in\.driva\.se/g, // äldre inbound-domän nämnd som alias i driftdokumentation
  /DRIVA ADMIN/g, // rollnivå i en kodkommentar
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (TEXT_EXT.has(path.extname(entry)) && !/\.test\.tsx?$/.test(entry)) yield full;
  }
}

function offendingLines(file: string): string[] {
  const rel = path.relative(ROOT, file);
  const out: string[] = [];
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (!/driva/i.test(line)) return;
      let rest = line;
      for (const re of ALLOWED) rest = rest.replace(re, "");
      if (/driva/i.test(rest)) out.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  return out;
}

describe("varumärke: Ferva överallt där en användare ser det", () => {
  it("källkod, public och mobilskal innehåller inget synligt 'Driva'", () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walk(path.join(ROOT, dir))) offenders.push(...offendingLines(file));
    }
    assert.deepEqual(
      offenders,
      [],
      `Gammalt varumärke utanför de tillåtna tekniska mönstren:\n${offenders.join("\n")}`
    );
  });

  it("webbmanifestet heter Ferva", () => {
    const m = manifest();
    assert.equal(m.name, "Ferva");
    assert.equal(m.short_name, "Ferva");
    assert.doesNotMatch(JSON.stringify(m), /driva/i);
  });

  it("fakturans och offertens PDF-bilaga och sidfot är fria från det gamla namnet", () => {
    replaceDb(buildSeed());
    const settings = db().settings;
    const invoice = db().invoices.find((i) => i.status !== "utkast") ?? db().invoices[0];
    assert.ok(invoice, "seeden har en faktura");
    const customer = db().customers.find((c) => c.id === invoice.customerId);
    const pdf = invoicePdfBytes(invoice, settings, customer?.name ?? "Kund").toString("latin1");
    assert.match(pdf, /Faktura/);
    assert.doesNotMatch(pdf, /driva/i);

    const quote = quotePdfBytes({
      companyName: settings.name,
      customerName: customer?.name ?? "Kund",
      quoteNumber: 1,
      title: "Badrum",
      amount: 12_000,
      validUntil: "2026-12-31",
    }).toString("latin1");
    assert.doesNotMatch(quote, /driva/i);

    const footer = sellerIdentityFooter(settings);
    assert.doesNotMatch(JSON.stringify(footer), /driva/i);
  });

  it("systemmejlen (auth, ägarnotiser) nämner bara Ferva", () => {
    const kinds = [
      "signup",
      "magiclink",
      "recovery",
      "invite",
      "email_change_current",
      "email_change_new",
      "reauthentication",
      "password_changed_notification",
      "identity_linked_notification",
    ] as const;
    for (const kind of kinds) {
      const mail = authEmail({ kind, confirmUrl: "https://app.example/x", token: "123456", newEmail: "ny@example.se" });
      const all = `${mail.subject}\n${mail.text}\n${mail.html}`;
      assert.doesNotMatch(all, /driva/i, `authEmail(${kind})`);
      assert.match(all, /Ferva/);
    }

    const footer = "Ferva · automatiskt meddelande";
    const notices = [
      quoteDeclinedEmail({
        businessName: "Bygg AB",
        quoteNumber: 7,
        title: "Altan",
        customerName: "Anna",
        amount: 5000,
        url: "https://app.example/offert/1",
        footer,
      }),
      inboxDocumentEmail({
        businessName: "Bygg AB",
        documentWord: "kvitto",
        supplier: "Bauhaus",
        amount: 1200,
        outcome: "bokford",
        url: "https://app.example/inkorg",
        footer,
      }),
      ownerNoticeTestEmail({ businessName: "Bygg AB", footer, url: "https://app.example" }),
    ];
    for (const n of notices) {
      assert.doesNotMatch(`${n.subject}\n${n.text}\n${n.html}`, /driva/i);
    }
  });

  it("filer som användaren laddar ner heter ferva-…", () => {
    replaceDb(buildSeed());
    for (const f of db().paymentFiles ?? []) {
      assert.match(f.filename, /^ferva-betalningar-/, f.filename);
    }
  });

  /**
   * Sidomenyn visade länge ett hårdkodat "D" i en bricka – Driva-initialen,
   * synlig i produktion. Namnskanningen ovan ser bara hela ord, så en ensam
   * bokstav slank igenom. Märket är numera FervaMark; en bokstavsbricka är
   * alltid ett återfall.
   */
  it("ingen ensam bokstav används som varumärkesbricka", () => {
    // Brickan skrevs över tre rader, med bokstaven ensam på sin egen rad, så
    // mönstret måste läsas över radbrytningar – inte rad för rad.
    const LONE_LETTER = />\s*[A-ZÅÄÖ]\s*<\//g;
    const LONE_LETTER_EXPR = /\{\s*["'][A-ZÅÄÖ]["']\s*\}/g;
    const offenders: string[] = [];
    for (const dir of ["src", "mobile"]) {
      for (const file of walk(path.join(ROOT, dir))) {
        if (!/\.(tsx|jsx)$/.test(file)) continue;
        const text = readFileSync(file, "utf8");
        for (const re of [LONE_LETTER, LONE_LETTER_EXPR]) {
          for (const m of text.matchAll(re)) {
            const line = text.slice(0, m.index).split("\n").length;
            offenders.push(`${path.relative(ROOT, file)}:${line}: ${m[0].replace(/\s+/g, " ")}`);
          }
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `Ensam bokstav som bricka – använd <FervaMark /> i stället:\n${offenders.join("\n")}`
    );
  });

  /**
   * public/icons innehöll platshållare som scripts/generate-pwa-icons.ts ritade
   * för hand (grön accent + ljus canvas). De riktiga ikonerna är Ferva-gula med
   * bläckmärket och rastrerade ur public/brand/.
   */
  it("public/icons innehåller de riktiga ikonerna, inte platshållarna", () => {
    const failed = checkIcons().filter((r) => !r.ok);
    assert.deepEqual(
      failed.map((r) => `${r.file}: ${r.problem}`),
      [],
      "varje ikon ska vara en rastrering av sin SVG-källa i public/brand/"
    );

    // Platshållarna hade ingen gul pixel alls. Kräv varumärkesfärgen explicit.
    const yellow = hexToRgb(FERVA_MARK_YELLOW);
    for (const { file } of ICON_TARGETS) {
      const { rgba } = decodePng(readFileSync(path.join(ICON_DIR, file)));
      let found = false;
      for (let i = 0; i < rgba.length && !found; i += 4) {
        found =
          rgba[i + 3] === 255 &&
          Math.abs(rgba[i] - yellow[0]) <= 2 &&
          Math.abs(rgba[i + 1] - yellow[1]) <= 2 &&
          Math.abs(rgba[i + 2] - yellow[2]) <= 2;
      }
      assert.ok(found, `${file} saknar Ferva-gult – ser ut som en platshållare`);
    }
  });
});
