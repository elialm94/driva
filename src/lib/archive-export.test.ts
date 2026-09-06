process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { db, replaceDb } from "./store";
import { emptyTestDb } from "./invoices/test-db";
import { calendarFiscalYear } from "./accounting/dates";
import { postVerification } from "./accounting/engine";
import { runPayroll, saveEmployee } from "./accounting/payroll";
import { kr } from "./format";
import { buildFiscalYearArchive, archiveFilename } from "./archive/export";
import { retentionUntil, retentionPolicyText } from "./archive/retention";
import { buildZip } from "./archive/zip";

/**
 * Arkivet är påståendet "det här räcker om Skatteverket frågar om sju år".
 *
 * Testerna håller fast tre saker som gör påståendet sant: zip-filen går att
 * öppna av något annat än vår egen kod, underlagen ligger med och går att hitta
 * från verifikationen, och ett underlag som saknas redovisas som saknat i
 * stället för att döljas bakom en tom platshållarfil.
 */

const FY = 2026;

function reset() {
  replaceDb(emptyTestDb({ fiscalYears: [calendarFiscalYear(FY)] }));
  db().settings.name = "Testbolaget AB";
  db().settings.orgNumber = "556677-8899";
}

/** Läser en zip med central directory, alltså på samma väg som ett riktigt verktyg. */
function readZip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.ok(eocd >= 0, "hittade ingen end of central directory");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let n = 0; n < count; n++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, "trasig central directory-post");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");

    assert.equal(buf.readUInt32LE(localOffset), 0x04034b50, `trasigt lokalt huvud för ${name}`);
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(start, start + csize);
    const bytes = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    assert.equal(bytes.length, usize, `fel storlek på ${name}`);
    out.set(name, bytes);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const RECEIPT_BYTES = Buffer.from("%PDF-1.4 kvitto fran Beijer\n");

function bookExpenseWithReceipt() {
  const v = postVerification({
    date: `${FY}-03-14`,
    description: "Byggmaterial Beijer",
    entries: [
      { account: 4010, debit: 800, credit: 0 },
      { account: 2641, debit: 200, credit: 0 },
      { account: 1930, debit: 0, credit: 1000 },
    ],
    source: { type: "utgift", id: "exp-1" },
    createdBy: "anvandare",
  });
  db().expenses.push({
    id: "exp-1",
    supplier: "Beijer Bygg",
    date: `${FY}-03-14`,
    amount: 1000,
    vatAmount: 200,
    receiptId: "rec-1",
    status: "bokford",
    verificationId: v.id,
    createdAt: `${FY}-03-14T10:00:00.000Z`,
  });
  db().receipts.push({
    id: "rec-1",
    expenseId: "exp-1",
    filename: "beijer-kvitto.pdf",
    source: "uppladdning",
    uploadedAt: `${FY}-03-14T10:00:00.000Z`,
    contentType: "application/pdf",
    sizeBytes: RECEIPT_BYTES.length,
    contentBase64: RECEIPT_BYTES.toString("base64"),
    extracted: {
      supplier: "Beijer Bygg",
      date: `${FY}-03-14`,
      amount: 1000,
      vatAmount: 200,
      description: "Byggmaterial",
      category: "material",
      confidence: "hog",
    },
  });
  return v;
}

describe("arkivexport", () => {
  beforeEach(reset);

  it("packar bokföringen, rapporterna och underlagen i en läsbar zip", async () => {
    bookExpenseWithReceipt();
    const fy = db().fiscalYears[0];

    const archive = await buildFiscalYearArchive(fy.id, new Date(`${FY}-12-31T09:00:00.000Z`));
    const files = readZip(archive.bytes);

    assert.ok(files.has("bokforing/bokforing.se"));
    assert.ok(files.has("bokforing/verifikationer.csv"));
    assert.ok(files.has("bokforing/huvudbok.csv"));
    assert.ok(files.has("bokforing/saldobalans.csv"));
    assert.ok(files.has("bokforing/resultatrakning.csv"));
    assert.ok(files.has("bokforing/balansrakning.csv"));
    assert.ok(files.has("underlag/register.csv"));
    assert.ok(files.has("underlag/kundfakturor.csv"));

    // SIE-filen är den enda filen som inte är UTF-8: standarden vill PC8.
    const sie = files.get("bokforing/bokforing.se")!;
    assert.match(sie.toString("latin1"), /#FLAGGA/);

    const kvitto = [...files.entries()].find(([p]) => p.endsWith("beijer-kvitto.pdf"));
    assert.ok(kvitto, "kvittot följde inte med i arkivet");
    assert.equal(kvitto[1].toString("utf8"), RECEIPT_BYTES.toString("utf8"));
    assert.match(kvitto[0], /^underlag\/A1 2026-03-14 Byggmaterial Beijer\//);

    assert.equal(archive.summary.verifications, 1);
    assert.equal(archive.summary.documents, 1);
    assert.equal(archive.summary.missing, 0);
  });

  it("skriver arkiveringstiden i klartext i läsmig-filen", async () => {
    bookExpenseWithReceipt();
    const fy = db().fiscalYears[0];

    const archive = await buildFiscalYearArchive(fy.id);
    const readme = readZip(archive.bytes).get("LÄSMIG.txt")!.toString("utf8");

    assert.match(readme, /Testbolaget AB/);
    assert.match(readme, /556677-8899/);
    assert.ok(readme.includes(retentionPolicyText(fy)));
    assert.ok(readme.includes(retentionUntil(fy)));
    assert.equal(retentionUntil(fy), "2033-12-31");
    assert.equal(archive.summary.retentionUntil, "2033-12-31");
  });

  it("redovisar saknade underlag i registret i stället för att lägga in en tom fil", async () => {
    postVerification({
      date: `${FY}-04-02`,
      description: "Kontorsmaterial utan kvitto",
      entries: [
        { account: 6110, debit: 250, credit: 0 },
        { account: 1930, debit: 0, credit: 250 },
      ],
      source: { type: "utgift", id: "exp-saknar" },
      createdBy: "anvandare",
    });
    const fy = db().fiscalYears[0];

    const archive = await buildFiscalYearArchive(fy.id);
    const files = readZip(archive.bytes);
    const register = files.get("underlag/register.csv")!.toString("utf8");

    assert.equal(archive.summary.documents, 0);
    assert.equal(archive.summary.missing, 1);
    assert.match(register, /Kvittot saknas/);
    assert.equal([...files.keys()].filter((p) => p.startsWith("underlag/A1 ")).length, 0);
    const row = archive.rows[0];
    assert.equal(row.path, undefined);
    assert.match(row.source, /Kvitto\/utgift/);
  });

  it("bifogar verifikationens egen bilaga när den finns", async () => {
    const bytes = Buffer.from("avtal med kunden");
    postVerification({
      date: `${FY}-05-20`,
      description: "Manuell omföring",
      entries: [
        { account: 1930, debit: 500, credit: 0 },
        { account: 1910, debit: 0, credit: 500 },
      ],
      source: { type: "manuell" },
      series: "M",
      createdBy: "anvandare",
      attachment: {
        filename: "avtal.txt",
        contentType: "text/plain",
        sizeBytes: bytes.length,
        contentBase64: bytes.toString("base64"),
      },
    });
    const fy = db().fiscalYears[0];

    const archive = await buildFiscalYearArchive(fy.id);
    const files = readZip(archive.bytes);
    const avtal = [...files.entries()].find(([p]) => p.endsWith("avtal.txt"));

    assert.ok(avtal, "bilagan följde inte med");
    assert.equal(avtal[1].toString("utf8"), "avtal med kunden");
    assert.match(avtal[0], /^underlag\/M1 /);
    assert.equal(archive.summary.documents, 1);
    assert.equal(archive.summary.missing, 0);
  });

  it("skriver kundfakturorna som eget register, eftersom fakturan är vårt dokument", async () => {
    postVerification({
      date: `${FY}-02-10`,
      description: "Faktura 1 Kund AB",
      entries: [
        { account: 1510, debit: 1250, credit: 0 },
        { account: 3001, debit: 0, credit: 1000 },
        { account: 2611, debit: 0, credit: 250 },
      ],
      source: { type: "kundfaktura", id: "inv-1" },
      createdBy: "anvandare",
    });
    const fy = db().fiscalYears[0];

    const archive = await buildFiscalYearArchive(fy.id);
    const register = readZip(archive.bytes).get("underlag/register.csv")!.toString("utf8");

    assert.match(register, /underlag\/kundfakturor\.csv/);
    assert.equal(archive.summary.missing, 1);
  });

  it("skriver lönespecifikationen ur den bokförda lönekörningen", async () => {
    saveEmployee(
      {
        name: "Anna Ägare",
        personnummer: "19850515-1234",
        role: "foretagsledare",
        monthlySalary: 40_000,
        taxBasis: { kind: "procent", percent: 30 },
        startDate: `${FY}-01-01`,
      },
      "anvandare"
    );
    const run = runPayroll({ month: `${FY}-01` }, "anvandare");
    const fy = db().fiscalYears[0];

    const archive = await buildFiscalYearArchive(fy.id);
    const files = readZip(archive.bytes);
    const [path, bytes] = [...files.entries()].find(([p]) => p.endsWith(".txt") && p.startsWith("underlag/"))!;
    const text = bytes.toString("utf8");

    assert.match(path, /lonespecifikation-2026-01\.txt$/);
    assert.match(text, /LÖNESPECIFIKATION – januari 2026/);
    assert.match(text, /Anna Ägare/);
    // Specifikationen får aldrig visa andra tal än de bokförda.
    assert.ok(text.includes(kr(run.gross)), "bruttolönen står inte i specifikationen");
    assert.ok(text.includes(kr(run.net)), "nettolönen står inte i specifikationen");
    assert.ok(text.includes(kr(run.employerContribution)));
    // Personnummer maskas även i arkivet – namnet identifierar den anställde.
    assert.ok(!text.includes("19850515-1234"));
    assert.equal(archive.summary.documents, 1);
  });

  it("namnger arkivet med året först", () => {
    assert.equal(
      archiveFilename({ label: "2026" }, new Date("2026-09-05T00:00:00.000Z")),
      "driva-arkiv-2026-20260905.zip"
    );
  });

  it("zippar utan att komprimera redan komprimerade filer", () => {
    const pdf = Buffer.from("%PDF-1.7 " + "x".repeat(2000));
    const text = Buffer.from("rad\n".repeat(500));
    const files = readZip(buildZip([
      { path: "a.pdf", bytes: pdf },
      { path: "b.csv", bytes: text },
    ]));

    assert.equal(files.get("a.pdf")!.toString("utf8"), pdf.toString("utf8"));
    assert.equal(files.get("b.csv")!.toString("utf8"), text.toString("utf8"));
  });
});
