process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "../store";
import { emptyTestDb } from "../invoices/test-db";
import { postVerification } from "../accounting/engine";
import { vatReportForPeriod } from "../accounting/vat";
import { filingCaseDetail, filingCases, filingCaseHref, isFilingKind } from "./deklarationer";
import { FERVA_DOES_NOT_SEND, FILING_INSTRUCTIONS_VERSION, filingInstruction } from "./instructions";
import { FilingError } from "./errors";
import {
  filingSubmissionsFor,
  generateFilingSubmission,
  latestFilingSubmission,
  markFilingDownloaded,
  reportManualFilingSubmission,
} from "./submission";
import { buildZip, crc32 } from "./zip";
import type { AuditAction } from "../types";

/**
 * Deklarationer & inlämning: ärendena i tre grupper och den manuella
 * inlämningen som ett steg-för-steg-flöde med kvittens.
 *
 * Det som testas är löftena ytan ger: att ett ärende hamnar i rätt grupp,
 * att blockerarna är samma som knapparna på momssidan har, att "Jag har
 * lämnat in" inte går att trycka utan något att visa upp, att historiken
 * aldrig skrivs över och att instruktionerna säger rakt ut att Ferva inte
 * skickar filen.
 */

const YEAR = 2025;
const BANK = 1930;
const FORSALJNING = 3001;
const UTGAENDE_MOMS = 2611;

function reset(year = YEAR) {
  replaceDb(emptyTestDb());
  const data = db();
  data.settings.name = "Snickare Svensson AB";
  data.settings.orgNumber = "556677-8899";
  data.settings.email = "hej@snickaresvensson.se";
  data.settings.phone = "08-123 45 67";
  data.settings.address = "Storgatan 1";
  data.settings.postalCode = "123 45";
  data.settings.city = "Stockholm";
  data.fiscalYears = [
    {
      id: `fy-${year}`,
      label: String(year),
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
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

function auditActions(): AuditAction[] {
  return db().auditTrail.map((e) => e.action);
}

const REPORTER = { reportedByName: "Anna Andersson", reportedByUserId: "user-1", by: "anvandare" as const };

/* --------------------------------- Listan ---------------------------------- */

describe("ärendena i tre grupper", () => {
  beforeEach(() => reset());

  it("en avslutad momsperiod med aktivitet behöver göras; den pågående är kommande", () => {
    sale(`${YEAR}-05-14`, 40_000);
    sale(`${YEAR}-08-02`, 10_000);
    const cases = filingCases(`${YEAR}-08-15`);
    const k2 = cases.behover_goras.find((c) => c.id === `moms-${YEAR}-K2`);
    assert.ok(k2, "april–juni ska ligga under Behöver göras");
    assert.equal(k2.type, "moms");
    assert.equal(k2.authorityName, "Skatteverket");
    assert.ok(k2.dueDate && k2.dueDate > `${YEAR}-06-30`);
    assert.equal(k2.amount, 10_000);
    assert.equal(k2.href, filingCaseHref("moms", `${YEAR}-K2`));
    assert.equal(k2.href, `/bokforing/deklarationer/moms/${YEAR}-K2`);

    const k3 = cases.kommande.find((c) => c.id === `moms-${YEAR}-K3`);
    assert.ok(k3, "juli–september pågår och är kommande");
    assert.match(k3.status, /pågår/);
    assert.equal(cases.today, `${YEAR}-08-15`);
  });

  it("en avslutad period utan momsaktivitet tynger inte listan", () => {
    const cases = filingCases(`${YEAR}-08-15`);
    assert.equal(cases.behover_goras.filter((c) => c.type === "moms").length, 0);
  });

  it("blockerarna är momssidans egna vakter: perioderna deklareras i ordning", () => {
    sale(`${YEAR}-02-10`, 5_000);
    sale(`${YEAR}-05-14`, 40_000);
    const cases = filingCases(`${YEAR}-08-15`);
    const k2 = cases.behover_goras.find((c) => c.id === `moms-${YEAR}-K2`)!;
    assert.ok(
      k2.blockers.some((b) => b.includes("inte deklarerad")),
      "K2 ska blockeras av att K1 inte är deklarerad"
    );
    const k1 = cases.behover_goras.find((c) => c.id === `moms-${YEAR}-K1`)!;
    assert.deepEqual(
      k1.blockers.filter((b) => b.includes("inte deklarerad")),
      [],
      "K1 har ingen tidigare period som blockerar"
    );
  });

  it("årsavslutet (INK2 och årsredovisning) dyker upp för ett aktiebolag när året är slut", () => {
    sale(`${YEAR}-05-14`, 40_000);
    const cases = filingCases(`${YEAR + 1}-03-01`);
    const ink2 = cases.all.find((c) => c.type === "ink2");
    const ar = cases.all.find((c) => c.type === "arsredovisning");
    assert.ok(ink2, "INK2 saknas");
    assert.ok(ar, "årsredovisningen saknas");
    assert.equal(ink2.authorityName, "Skatteverket");
    assert.equal(ar.authorityName, "Bolagsverket");
    assert.ok(ar.blockers.length > 0, "årsredovisningen är inte klar och ska ha blockerare");
    for (const c of [ink2, ar]) {
      assert.ok(c.responsible.submit.includes("ägaren") || c.responsible.submit.includes("Ägaren"));
    }
  });

  it("varje ärende bär vem som får förbereda och vem som får lämna in", () => {
    sale(`${YEAR}-05-14`, 40_000);
    for (const c of filingCases(`${YEAR}-08-15`).all) {
      assert.ok(c.responsible.prepare.length > 0);
      assert.ok(c.responsible.submit.length > 0);
      assert.ok(c.status.length > 0);
    }
  });
});

/* -------------------------------- Ärendet ---------------------------------- */

describe("ärendets sida", () => {
  beforeEach(() => reset());

  it("bygger filen med kontrollsumma och nedladdningsadress", () => {
    sale(`${YEAR}-05-14`, 40_000);
    const detail = filingCaseDetail("moms", `${YEAR}-K2`, `${YEAR}-08-15`);
    assert.ok(detail);
    assert.equal(detail.files.length, 1);
    assert.match(detail.files[0].sha256, /^[0-9a-f]{64}$/);
    assert.match(detail.files[0].href, /^\/api\/bokforing\/deklaration\?typ=moms/);
    assert.equal(detail.packageHref, undefined, "en fil behöver inget paket");
    assert.equal(detail.instruction.type, "moms");
    assert.equal(detail.instructionsVersion, FILING_INSTRUCTIONS_VERSION);
    // JSON-lagret är demo: mock-leverantören finns, tydligt märkt som demo.
    assert.equal(detail.machine.available, true);
    assert.equal(detail.machine.demo, true);
    assert.equal(detail.downloadedCurrent, false);
    assert.equal(detail.canReport, true);
  });

  it("INK2 är två filer och får ett paket", () => {
    sale(`${YEAR}-05-14`, 40_000);
    const detail = filingCaseDetail("ink2", `fy-${YEAR}`, `${YEAR + 1}-03-01`);
    assert.ok(detail);
    assert.equal(detail.files.length, 2);
    assert.match(detail.packageHref ?? "", /fil=paket/);
  });

  it("blockerare stänger 'Jag har lämnat in' men inte sidan", () => {
    sale(`${YEAR}-02-10`, 5_000);
    sale(`${YEAR}-05-14`, 40_000);
    const detail = filingCaseDetail("moms", `${YEAR}-K2`, `${YEAR}-08-15`);
    assert.ok(detail);
    assert.ok(detail.case.blockers.length > 0);
    assert.equal(detail.canReport, false);
    assert.equal(detail.files.length, 1, "filen går ändå att hämta och granska");
  });

  it("en okänd typ känns igen som sådan", () => {
    assert.equal(isFilingKind("moms"), true);
    assert.equal(isFilingKind("hus"), false);
    assert.equal(isFilingKind("nonsens"), false);
  });

  it("att hämta filen antecknas på inlämningsraden", () => {
    sale(`${YEAR}-05-14`, 40_000);
    const s = markFilingDownloaded({ kind: "moms", subjectId: `${YEAR}-K2`, by: "anvandare" });
    assert.equal(s.status, "genererad");
    assert.ok(s.downloadedAt);
    assert.ok(auditActions().includes("inlamning_nedladdad"));
    const detail = filingCaseDetail("moms", `${YEAR}-K2`, `${YEAR}-08-15`)!;
    assert.equal(detail.downloadedCurrent, true);
    assert.match(detail.case.status, /hämtades/);
  });
});

/* ----------------------------- Jag har lämnat in ---------------------------- */

describe("den manuella inlämningen", () => {
  beforeEach(() => reset());

  it("kräver referensnummer eller kvittensfil", () => {
    sale(`${YEAR}-05-14`, 40_000);
    assert.throws(
      () => reportManualFilingSubmission({ kind: "moms", subjectId: `${YEAR}-K2`, ...REPORTER, syncDomainStatus: false }),
      (e: unknown) => e instanceof FilingError && /referens/i.test(e.message)
    );
    assert.equal(latestFilingSubmission("moms", `${YEAR}-K2`), undefined, "inget skrivs innan kravet är uppfyllt");
  });

  it("avvisar orimligt långa referenser", () => {
    sale(`${YEAR}-05-14`, 40_000);
    assert.throws(
      () =>
        reportManualFilingSubmission({
          kind: "moms",
          subjectId: `${YEAR}-K2`,
          reference: "x".repeat(81),
          ...REPORTER,
          syncDomainStatus: false,
        }),
      FilingError
    );
  });

  it("blir kvitterad med provider manuell, kvittens och spårbar handling", () => {
    sale(`${YEAR}-05-14`, 40_000);
    const s = reportManualFilingSubmission({
      kind: "moms",
      subjectId: `${YEAR}-K2`,
      reference: "SKV-123456",
      note: "Lämnad via e-tjänsten",
      ...REPORTER,
      syncDomainStatus: false,
    });
    assert.equal(s.provider, "manuell");
    assert.equal(s.status, "kvitterad");
    assert.ok(s.submittedAt);
    assert.equal(s.manualReceipt?.reference, "SKV-123456");
    assert.equal(s.manualReceipt?.reportedByName, "Anna Andersson");
    assert.equal(s.manualReceipt?.reportedByUserId, "user-1");
    assert.equal(s.receipt?.receiptId, "SKV-123456");
    assert.match(s.receipt?.message ?? "", /Ferva har inte skickat filen/);
    assert.ok(auditActions().includes("inlamning_rapporterad"));
    const audit = db().auditTrail.find((e) => e.action === "inlamning_rapporterad")!;
    assert.match(audit.details, /SKV-123456/);
    assert.match(audit.details, /Kontrollsumma/);
  });

  it("räcker med en kvittensfil när referensen saknas", () => {
    sale(`${YEAR}-05-14`, 40_000);
    const s = reportManualFilingSubmission({
      kind: "moms",
      subjectId: `${YEAR}-K2`,
      file: { filename: "kvittens.pdf", contentType: "application/pdf", sizeBytes: 1234, storagePath: "b/s/kvittens.pdf" },
      ...REPORTER,
      syncDomainStatus: false,
    });
    assert.equal(s.status, "kvitterad");
    assert.match(s.receipt?.receiptId ?? "", /kvittens\.pdf/);
    assert.equal(s.manualReceipt?.file?.storagePath, "b/s/kvittens.pdf");
  });

  it("ändrat underlag efter hämtningen stoppar rapporten och bygger om filen", () => {
    sale(`${YEAR}-05-14`, 40_000);
    const before = markFilingDownloaded({ kind: "moms", subjectId: `${YEAR}-K2`, by: "anvandare" });
    const oldSha = before.files[0].sha256;
    sale(`${YEAR}-06-20`, 8_000);
    assert.throws(
      () =>
        reportManualFilingSubmission({
          kind: "moms",
          subjectId: `${YEAR}-K2`,
          reference: "SKV-1",
          ...REPORTER,
          syncDomainStatus: false,
        }),
      (e: unknown) => e instanceof FilingError && /ändrats/.test(e.message)
    );
    const after = latestFilingSubmission("moms", `${YEAR}-K2`)!;
    assert.equal(after.id, before.id);
    assert.equal(after.status, "genererad");
    assert.notEqual(after.files[0].sha256, oldSha);
    assert.equal(after.downloadedAt, undefined, "den nya filen är inte hämtad");
  });

  it("en rättelse blir en ny rad – historiken skrivs aldrig över", () => {
    sale(`${YEAR}-05-14`, 40_000);
    const first = reportManualFilingSubmission({
      kind: "moms",
      subjectId: `${YEAR}-K2`,
      reference: "SKV-1",
      ...REPORTER,
      syncDomainStatus: false,
    });
    const second = generateFilingSubmission({ kind: "moms", subjectId: `${YEAR}-K2`, by: "anvandare" });
    assert.notEqual(second.id, first.id);
    const corrected = reportManualFilingSubmission({
      kind: "moms",
      subjectId: `${YEAR}-K2`,
      reference: "SKV-2",
      ...REPORTER,
      syncDomainStatus: false,
    });
    assert.equal(corrected.id, second.id);
    const rows = filingSubmissionsFor("moms", `${YEAR}-K2`);
    assert.equal(rows.length, 2);
    assert.equal(rows.find((r) => r.id === first.id)?.manualReceipt?.reference, "SKV-1");
    assert.equal(rows.find((r) => r.id === corrected.id)?.manualReceipt?.reference, "SKV-2");
  });

  it("momsdeklarationen speglas i momsrapporten: perioden markeras deklarerad", () => {
    sale(`${YEAR}-05-14`, 40_000);
    reportManualFilingSubmission({ kind: "moms", subjectId: `${YEAR}-K2`, reference: "SKV-9", ...REPORTER });
    const report = vatReportForPeriod(`${YEAR}-K2`);
    assert.ok(report, "momsrapporten ska ha skapats");
    assert.equal(report.status, "deklarerad");
    const cases = filingCases(`${YEAR}-08-15`);
    const k2 = cases.inlamnat.find((c) => c.id === `moms-${YEAR}-K2`);
    assert.ok(k2, "ärendet ska ligga under Inlämnat");
    assert.match(k2.status, /för hand/);
  });

  it("en kvitterad rad kan inte rapporteras en gång till", () => {
    sale(`${YEAR}-05-14`, 40_000);
    reportManualFilingSubmission({ kind: "moms", subjectId: `${YEAR}-K2`, reference: "SKV-1", ...REPORTER, syncDomainStatus: false });
    // Ingen öppen rad finns; en ny rad byggs, vilket är den avsedda vägen för rättelser.
    const again = reportManualFilingSubmission({
      kind: "moms",
      subjectId: `${YEAR}-K2`,
      reference: "SKV-2",
      ...REPORTER,
      syncDomainStatus: false,
    });
    assert.equal(filingSubmissionsFor("moms", `${YEAR}-K2`).length, 2);
    assert.equal(again.manualReceipt?.reference, "SKV-2");
  });
});

/* ------------------------------ Instruktioner ------------------------------ */

describe("instruktionerna", () => {
  it("pekar på myndigheternas e-tjänster över https och är versionerade", () => {
    for (const type of ["moms", "agi", "ink2", "arsredovisning", "hus"] as const) {
      const i = filingInstruction(type);
      assert.equal(i.type, type);
      assert.match(i.serviceUrl, /^https:\/\/(www\.)?(skatteverket|bolagsverket)\.se\//);
      assert.ok(i.steps.length >= 3, `${type} behöver riktiga steg`);
      assert.ok(i.receiptHint.length > 0);
    }
    assert.match(FILING_INSTRUCTIONS_VERSION, /^\d{4}\.\d{2}\.\d+$/);
    assert.match(FERVA_DOES_NOT_SEND, /skickar inte filen/);
  });

  it("årsredovisningen erbjuder pappersvägen eftersom den digitala kräver ansluten programvara", () => {
    const i = filingInstruction("arsredovisning");
    assert.ok(i.alternative, "pappersalternativet saknas");
    assert.ok(i.alternative.steps.some((s) => /Sundsvall/.test(s)));
  });
});

/* ---------------------------------- Zip ------------------------------------ */

describe("paketet", () => {
  it("crc32 stämmer mot referensvärdet", () => {
    assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
    assert.equal(crc32(new Uint8Array(0)), 0);
  });

  it("bygger en zip med lokala huvuden, centralkatalog och slutpost", () => {
    const now = new Date("2026-03-01T10:00:00Z");
    const zip = buildZip(
      [
        { filename: "a.sru", bytes: new TextEncoder().encode("#DATABESKRIVNING_START") },
        { filename: "b.sru", bytes: new TextEncoder().encode("#MEDIELEV_START") },
      ],
      now
    );
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    assert.equal(view.getUint32(0, true), 0x04034b50, "lokalt filhuvud");
    assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50, "slutposten ligger sist");
    assert.equal(view.getUint16(zip.length - 22 + 10, true), 2, "två poster i centralkatalogen");
    const text = new TextDecoder("latin1").decode(zip);
    assert.ok(text.includes("a.sru") && text.includes("b.sru"));
    assert.ok(text.includes("#DATABESKRIVNING_START"), "lagras okomprimerat");
  });
});
