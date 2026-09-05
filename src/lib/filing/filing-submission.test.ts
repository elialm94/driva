process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "../store";
import { emptyTestDb } from "../invoices/test-db";
import { postVerification } from "../accounting/engine";
import { generateVatReport, markVatReportDeclared } from "../accounting/vat";
import { FilingDataError } from "../accounting/filing-format";
import { buildFilingPayload, FILING_AUTHORITY } from "./payload";
import {
  fetchFilingReceipt,
  filingSubmissionsFor,
  generateFilingSubmission,
  latestFilingSubmission,
  signFilingSubmission,
  submitFilingSubmission,
  canAdvanceFiling,
  sha256Hex,
} from "./submission";
import { resolveFilingProviderKind, selectFilingProvider } from "./select";
import { readFilingConfig } from "./config";
import { MockFilingProvider, DEMO_RECEIPT_NOTE } from "./providers/mock";
import { UnconfiguredFilingProvider } from "./providers/unconfigured";
import { FilingNotConfiguredError } from "./errors";
import { filingSignText } from "./signing";
import type { FilingProvider, FilingSubmitOutcome, FilingReceiptOutcome } from "./provider";
import type { AuditAction } from "../types";

/**
 * Inlämningslagret: statusmaskinen från genererad fil till kvittens.
 *
 * Det som testas är löftena statusen ger. "Inlämnad" ska bara gå att nå med ett
 * id från myndigheten, "kvitterad" bara med en kvittens, och en signatur ska
 * bara gälla den fil som faktiskt signerades. Utan avtal ska lagret säga det
 * rakt ut i stället för att kvittera något som ingen tagit emot.
 */

const YEAR = 2026;
const PERIOD = `${YEAR}-K2`;
const BANK = 1930;
const FORSALJNING = 3001;
const UTGAENDE_MOMS = 2611;

function reset() {
  replaceDb(emptyTestDb());
  const data = db();
  data.settings.name = "Bygg & Co AB";
  data.settings.orgNumber = "556677-8899";
  data.settings.email = "hej@byggco.se";
  data.settings.phone = "08-123 45 67";
  data.settings.address = "Storgatan 1";
  data.settings.postalCode = "123 45";
  data.settings.city = "Stockholm";
  data.fiscalYears = [
    {
      id: `fy-${YEAR}`,
      label: String(YEAR),
      startDate: `${YEAR}-01-01`,
      endDate: `${YEAR}-12-31`,
      status: "oppet",
      openingBalances: {},
      openingSource: "migrering",
    },
  ];
  data.bankAccounts = [];
}

function sale(date: string, net: number) {
  const vat = Math.round(net * 0.25);
  postVerification({
    date,
    description: "Fakturerat arbete",
    entries: [
      { account: BANK, debit: net + vat },
      { account: FORSALJNING, credit: net },
      { account: UTGAENDE_MOMS, credit: vat },
    ],
    source: { type: "manuell" },
    createdBy: "anvandare",
  });
}

/** En inlämning i status genererad för momsperioden. */
function generated() {
  sale(`${YEAR}-05-14`, 40_000);
  return generateFilingSubmission({ kind: "moms", subjectId: PERIOD, by: "anvandare" });
}

function signed() {
  const submission = generated();
  return signFilingSubmission(submission.id, { signedByName: "Anna Andersson", by: "anvandare" });
}

function auditActions(): AuditAction[] {
  return db().auditTrail.map((e) => e.action);
}

/** Provider som svarar exakt det testet behöver, utan HTTP. */
function stubProvider(answers: { submit?: FilingSubmitOutcome; receipt?: FilingReceiptOutcome }): FilingProvider {
  return {
    name: "live",
    supports: () => true,
    submit: async () => answers.submit ?? { kind: "accepted", providerSubmissionId: "sv-1" },
    fetchReceipt: async () => answers.receipt ?? { kind: "pending" },
  };
}

/* ------------------------------- Nyttolasten ------------------------------- */

describe("filerna en inlämning består av", () => {
  beforeEach(reset);

  it("momsdeklarationen är en eSKD-fil till Skatteverket", () => {
    sale(`${YEAR}-05-14`, 40_000);
    const payload = buildFilingPayload("moms", PERIOD);
    assert.equal(payload.authority, "skatteverket");
    assert.equal(payload.files.length, 1);
    assert.match(payload.files[0].filename, /\.xml$/i);
    assert.ok(payload.files[0].bytes.length > 0);
    assert.equal(payload.label, "april–juni 2026");
  });

  it("en period som inte är deklarerad varnas för i stället för att tigas bort", () => {
    sale(`${YEAR}-05-14`, 40_000);
    const utkast = buildFilingPayload("moms", PERIOD);
    assert.ok(
      utkast.warnings.some((w) => w.includes("inte markerad som deklarerad")),
      "utkastet ska varna för att filen bygger på bokföringen som den ser ut nu"
    );

    const report = generateVatReport(PERIOD);
    markVatReportDeclared(report.id, "anvandare");
    assert.deepEqual(buildFilingPayload("moms", PERIOD).warnings, []);
  });

  it("INK2 är två filer: blanketterna och uppgiften om vem som lämnar", () => {
    sale(`${YEAR}-05-14`, 40_000);
    const payload = buildFilingPayload("ink2", `fy-${YEAR}`);
    assert.equal(payload.files.length, 2);
    assert.match(payload.files[0].filename, /BLANKETTER\.SRU$/);
    assert.match(payload.files[1].filename, /INFO\.SRU$/);
  });

  it("årsredovisningen går till Bolagsverket, resten till Skatteverket", () => {
    assert.equal(FILING_AUTHORITY.arsredovisning, "bolagsverket");
    assert.equal(FILING_AUTHORITY.moms, "skatteverket");
    assert.equal(FILING_AUTHORITY.agi, "skatteverket");
    assert.equal(FILING_AUTHORITY.ink2, "skatteverket");
  });

  it("saknas underlaget byggs ingen halv fil", () => {
    assert.throws(() => buildFilingPayload("agi", `${YEAR}-05`), FilingDataError);
    assert.throws(() => buildFilingPayload("ink2", "fy-finns-inte"), FilingDataError);
    assert.throws(() => buildFilingPayload("arsredovisning", "ar-finns-inte"), FilingDataError);
  });
});

/* ------------------------------ Statusmaskinen ----------------------------- */

describe("statusmaskinen", () => {
  beforeEach(reset);

  it("stegen går bara framåt och bara i ordning", () => {
    assert.equal(canAdvanceFiling("utkast", "genererad"), true);
    assert.equal(canAdvanceFiling("utkast", "signerad"), false);
    assert.equal(canAdvanceFiling("genererad", "inlamnad"), false);
    assert.equal(canAdvanceFiling("signerad", "inlamnad"), true);
    assert.equal(canAdvanceFiling("inlamnad", "kvitterad"), true);
    assert.equal(canAdvanceFiling("kvitterad", "inlamnad"), false);
    assert.equal(canAdvanceFiling("avvisad", "genererad"), false);
  });

  it("genereringen fryser filens innehåll med en kontrollsumma", () => {
    const submission = generated();
    assert.equal(submission.status, "genererad");
    assert.equal(submission.files.length, 1);
    assert.match(submission.files[0].sha256, /^[0-9a-f]{64}$/);
    assert.equal(submission.files[0].size > 0, true);
    assert.equal(submission.provider, "mock");
    assert.ok(submission.generatedAt);
    assert.ok(auditActions().includes("inlamning_genererad"));
  });

  it("samma period genererad två gånger blir en inlämning, inte två", () => {
    const first = generated();
    const second = generateFilingSubmission({ kind: "moms", subjectId: PERIOD, by: "anvandare" });
    assert.equal(second.id, first.id);
    assert.equal(filingSubmissionsFor("moms", PERIOD).length, 1);
  });

  it("en osignerad inlämning går inte att lämna in", async () => {
    const submission = generated();
    await assert.rejects(
      () => submitFilingSubmission(submission.id, { by: "anvandare" }),
      /måste signeras/
    );
    assert.equal(latestFilingSubmission("moms", PERIOD)?.status, "genererad");
  });

  it("signeringen i demo är märkt som demosignatur", () => {
    const submission = signed();
    assert.equal(submission.status, "signerad");
    assert.equal(submission.signature?.method, "bankid_mock");
    assert.equal(submission.signature?.signedByName, "Anna Andersson");
    assert.match(submission.signature?.note ?? "", /ingen riktig BankID-signering/i);
    assert.ok(auditActions().includes("inlamning_signerad"));
  });

  it("texten som signeras binder signaturen till filens kontrollsumma", () => {
    const submission = generated();
    const text = filingSignText(submission);
    assert.match(text, /momsdeklarationen för april–juni 2026/);
    assert.match(text, /Bygg & Co AB \(556677-8899\)/);
    assert.ok(text.includes(submission.files[0].sha256.slice(0, 16)));
  });

  it("inlämningen kräver ett id från myndigheten, kvittensen ett kvittensnummer", async () => {
    const submission = signed();
    const inlamnad = await submitFilingSubmission(submission.id, { by: "anvandare" });
    assert.equal(inlamnad.status, "inlamnad");
    assert.ok(inlamnad.providerSubmissionId, "utan id hos myndigheten är den inte inlämnad");
    assert.ok(inlamnad.submittedAt);
    assert.equal(inlamnad.receipt, undefined);

    const kvitterad = await fetchFilingReceipt(submission.id, { by: "anvandare" });
    assert.equal(kvitterad.status, "kvitterad");
    assert.match(kvitterad.receipt?.receiptId ?? "", /^DEMO-/);
    assert.equal(kvitterad.receipt?.message, DEMO_RECEIPT_NOTE);
    assert.deepEqual(auditActions().slice(-2), ["inlamning_inlamnad", "inlamning_kvitterad"]);
  });

  it("en kvitterad inlämning lämnas inte in igen", async () => {
    const submission = signed();
    await submitFilingSubmission(submission.id, { by: "anvandare" });
    await fetchFilingReceipt(submission.id, { by: "anvandare" });
    await assert.rejects(() => submitFilingSubmission(submission.id, { by: "anvandare" }), /redan lämnad in/);
  });

  it("kvittens som inte kommit än är väntan, inte fel", async () => {
    const submission = signed();
    await submitFilingSubmission(submission.id, { by: "anvandare", provider: stubProvider({}) });
    const same = await fetchFilingReceipt(submission.id, {
      by: "anvandare",
      provider: stubProvider({ receipt: { kind: "pending" } }),
    });
    assert.equal(same.status, "inlamnad");
    assert.equal(same.receipt, undefined);
    assert.equal(same.lastError, undefined);
  });

  it("ett avslag stannar på inlämningen med myndighetens skäl", async () => {
    const submission = signed();
    const avvisad = await submitFilingSubmission(submission.id, {
      by: "anvandare",
      provider: stubProvider({ submit: { kind: "rejected", reason: "Perioden är redan deklarerad." } }),
    });
    assert.equal(avvisad.status, "avvisad");
    assert.equal(avvisad.rejection?.reason, "Perioden är redan deklarerad.");
    assert.ok(auditActions().includes("inlamning_avvisad"));

    // Nästa försök är en ny inlämning – det avvisade försöket står kvar.
    const retry = generateFilingSubmission({ kind: "moms", subjectId: PERIOD, by: "anvandare" });
    assert.notEqual(retry.id, submission.id);
    assert.equal(filingSubmissionsFor("moms", PERIOD).length, 2);
  });

  it("ändrat underlag efter signeringen släpper signaturen", async () => {
    const submission = signed();
    const signedSha = submission.files[0].sha256;

    sale(`${YEAR}-06-02`, 12_000);
    await assert.rejects(
      () => submitFilingSubmission(submission.id, { by: "anvandare" }),
      /signera på nytt/
    );

    const after = latestFilingSubmission("moms", PERIOD)!;
    assert.equal(after.status, "genererad");
    assert.equal(after.signature, undefined);
    assert.notEqual(after.files[0].sha256, signedSha);
  });

  it("samma fil genererad om behåller signaturen", () => {
    signed();
    const again = generateFilingSubmission({ kind: "moms", subjectId: PERIOD, by: "anvandare" });
    assert.equal(again.status, "signerad");
    assert.equal(again.signature?.signedByName, "Anna Andersson");
  });

  it("utan avtal blir det ett ärligt fel och ingen kvittens", async () => {
    const submission = signed();
    await assert.rejects(
      () => submitFilingSubmission(submission.id, { by: "anvandare", provider: new UnconfiguredFilingProvider() }),
      FilingNotConfiguredError
    );
    const after = latestFilingSubmission("moms", PERIOD)!;
    assert.equal(after.status, "signerad");
    assert.match(after.lastError ?? "", /inte påslagen/);
    assert.equal(after.receipt, undefined);
  });
});

/* ------------------------------- Providervalet ----------------------------- */

describe("valet av inlämningsleverantör", () => {
  beforeEach(reset);

  it("demo ger mock, avtal ger live, avtalslöst ger unconfigured", () => {
    assert.equal(resolveFilingProviderKind({ demo: true, configured: false }), "mock");
    assert.equal(resolveFilingProviderKind({ demo: true, configured: true }), "mock");
    assert.equal(resolveFilingProviderKind({ demo: false, configured: true }), "live");
    assert.equal(resolveFilingProviderKind({ demo: false, configured: false }), "unconfigured");
  });

  it("miljön är konfigurerad först när både adress och token finns", () => {
    assert.equal(readFilingConfig({}), null);
    assert.equal(readFilingConfig({ FILING_API_BASE_URL: "https://x.se" }), null);
    assert.equal(readFilingConfig({ FILING_API_TOKEN: "t" }), null);
    const config = readFilingConfig({ FILING_API_BASE_URL: "https://x.se/", FILING_API_TOKEN: "t" });
    assert.equal(config?.baseUrl, "https://x.se");
    // Aldrig produktion av misstag.
    assert.equal(config?.env, "test");
    assert.equal(
      readFilingConfig({ FILING_API_BASE_URL: "https://x.se", FILING_API_TOKEN: "t", FILING_ENV: "production" })?.env,
      "production"
    );
  });

  it("testmiljön väljer mocken, som inte rör nätet", () => {
    assert.equal(selectFilingProvider().name, "mock");
  });

  it("mocken avvisar en tom fil i stället för att kvittera den", async () => {
    const outcome = await new MockFilingProvider().submit({
      kind: "moms",
      authority: "skatteverket",
      label: "april–juni 2026",
      orgNumber: "556677-8899",
      files: [{ filename: "tom.xml", contentType: "text/xml", bytes: new Uint8Array() }],
      signature: { method: "bankid_mock", signedAt: new Date().toISOString(), signedByName: "Anna" },
      idempotencyKey: "inlamning-1",
    });
    assert.equal(outcome.kind, "rejected");
  });

  it("kontrollsumman är filens innehåll, inte dess namn", () => {
    const a = sha256Hex(new TextEncoder().encode("abc"));
    assert.equal(a, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
