process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { buildSeed } from "./seed";
import { createInvoice, issueInvoice, markInvoicePaid } from "./services/invoices";
import { getInvoice, getJob } from "./services/data";
import { setJobStatus } from "./services/jobs";
import { createTaxReductionUnderlag, taxReductionCaseForJob } from "./services/tax-reduction";
import {
  buildHusExportFile,
  husExportPreview,
  markHusFileDownloaded,
  patchHusExportFields,
} from "./services/hus-export";
import { labor } from "./invoices/test-db";
import { todayDate } from "./accounting/dates";
import { validateAgainstHusXsd } from "./__fixtures__/hus/xsd";
import type { DocLine } from "./types";

function reset() {
  replaceDb(buildSeed());
}

/** Betald ROT-faktura på Köksrenoveringen med underlag skapat. */
function paidRotJob(lines: DocLine[]) {
  const job = getJob("job-kok")!;
  job.housing = { dwellingType: "smahus", propertyDesignation: "Södermalm 12:34" };
  const inv = createInvoice({ customerId: "cust-anna", jobId: "job-kok", type: "faktura", lines, rot: { type: "rot" } });
  issueInvoice(inv.id);
  markInvoicePaid(inv.id, { matchedBy: "manuell" });
  setJobStatus("job-kok", "klart");
  createTaxReductionUnderlag({ jobId: "job-kok", invoiceId: inv.id });
  return getInvoice(inv.id)!;
}

function assertXsd(xml: string, t: { skip: (m?: string) => void }) {
  const res = validateAgainstHusXsd(xml);
  if (!res) return t.skip("xmllint saknas");
  assert.ok(res.ok, res.output);
}

describe("HUS-fil från ROT-ärende", () => {
  beforeEach(() => reset());

  it("finns inte förrän ansökningsunderlaget är skapat", () => {
    const job = getJob("job-kok")!;
    job.housing = { dwellingType: "smahus", propertyDesignation: "Södermalm 12:34" };
    const inv = createInvoice({
      customerId: "cust-anna",
      jobId: "job-kok",
      type: "faktura",
      lines: [labor({ qty: 40, unit: "tim", unitPrice: 600 })],
      rot: { type: "rot" },
    });
    issueInvoice(inv.id);
    markInvoicePaid(inv.id, { matchedBy: "manuell" });
    setJobStatus("job-kok", "klart");
    assert.equal(husExportPreview({ jobId: "job-kok" }), null);
    assert.throws(() => buildHusExportFile({ jobId: "job-kok" }), /Skapa ansökningsunderlag/);
  });

  it("betald ROT-faktura med timprisade rader ger en schema-giltig Begäran utan luckor", (t) => {
    const inv = paidRotJob([
      labor({ qty: 40, unit: "tim", unitPrice: 1_000 }),
      labor({ kind: "material", qty: 1, unit: "st", unitPrice: 15_200 }),
      labor({ kind: "resor", qty: 6, unit: "tim", unitPrice: 350 }),
    ]);
    const preview = husExportPreview({ jobId: "job-kok" })!;
    assert.ok(preview);
    assert.equal(preview.type, "rot");
    assert.equal(preview.category, "Bygg", "snickardefault");
    assert.equal(preview.categoryExplicit, false);
    assert.deepEqual(preview.blockers, []);
    assert.equal(preview.invoices.length, 1);
    const row = preview.invoices[0];
    assert.equal(row.derivedHours, 40);
    assert.equal(row.hours, 40);
    assert.equal(row.laborInclVat, 50_000);
    assert.equal(row.deduction, 15_000);
    assert.equal(row.paidLabor, 35_000, "kundens del av arbetet = arbete inkl. moms − avdrag");
    assert.equal(row.materialCost, 19_000);
    assert.equal(row.otherCost, 2_625);
    assert.equal(row.paymentDate, todayDate());
    assert.equal(preview.downloadHref, "/api/skatteverket/hus?jobb=job-kok");
    assert.equal(preview.fileName, `rot-begaran-koksrenovering-${todayDate()}.xml`, "ASCII-filnamn för Content-Disposition");

    const file = buildHusExportFile({ jobId: "job-kok" });
    assert.equal(file.type, "rot");
    assert.ok(file.xml.includes("<RotBegaran"));
    assert.ok(file.xml.includes("<Kopare>198505151234</Kopare>"));
    assert.ok(file.xml.includes(`<BetalningsDatum>${todayDate()}</BetalningsDatum>`));
    assert.ok(file.xml.includes("<PrisForArbete>50000</PrisForArbete>"));
    assert.ok(file.xml.includes("<BetaltBelopp>35000</BetaltBelopp>"));
    assert.ok(file.xml.includes("<BegartBelopp>15000</BegartBelopp>"));
    assert.ok(file.xml.includes(`<FakturaNr>${inv.number}</FakturaNr>`));
    assert.ok(file.xml.includes("<Ovrigkostnad>2625</Ovrigkostnad>"));
    assert.ok(file.xml.includes("<Fastighetsbeteckning>Södermalm 12:34</Fastighetsbeteckning>"));
    assert.ok(file.xml.includes("<Bygg>"));
    assert.ok(file.xml.includes("<AntalTimmar>40</AntalTimmar>"));
    assert.ok(file.xml.includes("<Materialkostnad>19000</Materialkostnad>"));
    assert.ok(!file.xml.includes("HushallBegaran"));
    assertXsd(file.xml, t);
  });

  it("fast pris blockerar tills timmar anges – timmar hittas aldrig på", (t) => {
    const inv = paidRotJob([labor({ qty: 1, unit: "st", unitPrice: 40_000 })]);
    const before = husExportPreview({ jobId: "job-kok" })!;
    assert.equal(before.invoices[0].derivedHours, null);
    assert.equal(before.invoices[0].hours, null);
    const blocker = before.blockers.find((b) => b.code === "timmar");
    assert.ok(blocker, "timmar-lucka");
    assert.equal(blocker.href, `#hus-timmar-${inv.id}`);
    assert.equal(blocker.invoiceId, inv.id);
    assert.throws(() => buildHusExportFile({ jobId: "job-kok" }), /Arbetade timmar saknas/);

    assert.throws(() => patchHusExportFields({ jobId: "job-kok", laborHoursByInvoice: { [inv.id]: 1000 } }), /0 och 999/);
    assert.throws(() => patchHusExportFields({ jobId: "job-kok", laborHoursByInvoice: { "inv-annan": 5 } }), /hör inte till/);

    patchHusExportFields({ jobId: "job-kok", laborHoursByInvoice: { [inv.id]: 38 } });
    const after = husExportPreview({ jobId: "job-kok" })!;
    assert.deepEqual(after.blockers, []);
    assert.equal(after.invoices[0].manualHours, 38);
    assert.equal(after.invoices[0].hours, 38);
    const file = buildHusExportFile({ jobId: "job-kok" });
    assert.ok(file.xml.includes("<AntalTimmar>38</AntalTimmar>"));
    assertXsd(file.xml, t);

    patchHusExportFields({ jobId: "job-kok", laborHoursByInvoice: { [inv.id]: null } });
    assert.ok(husExportPreview({ jobId: "job-kok" })!.blockers.some((b) => b.code === "timmar"));
  });

  it("saknat betalningsdatum blockerar med länk till fakturan", () => {
    const inv = paidRotJob([labor({ qty: 10, unit: "tim", unitPrice: 1_000 })]);
    const data = db();
    data.payments = data.payments.filter((p) => p.invoiceId !== inv.id);
    inv.paidAt = undefined;
    const preview = husExportPreview({ jobId: "job-kok" })!;
    const blocker = preview.blockers.find((b) => b.code === "betalningsdatum");
    assert.ok(blocker);
    assert.equal(blocker.href, `/ekonomi/fakturor/${inv.id}`);
    assert.throws(() => buildHusExportFile({ jobId: "job-kok" }), /Betalningsdatum saknas/);
  });

  it("arbetsområde kan väljas bland ROT-områdena, aldrig RUT-områden", () => {
    paidRotJob([labor({ qty: 10, unit: "tim", unitPrice: 1_000 })]);
    patchHusExportFields({ jobId: "job-kok", workCategory: "Vvs" });
    const preview = husExportPreview({ jobId: "job-kok" })!;
    assert.equal(preview.category, "Vvs");
    assert.equal(preview.categoryExplicit, true);
    assert.ok(buildHusExportFile({ jobId: "job-kok" }).xml.includes("<Vvs>"));
    assert.throws(() => patchHusExportFields({ jobId: "job-kok", workCategory: "Stadning" }), /finns inte för ROT/);
    patchHusExportFields({ jobId: "job-kok", workCategory: "" });
    assert.equal(husExportPreview({ jobId: "job-kok" })!.category, "Bygg");
  });

  it("nedladdning noteras men ändrar aldrig status eller beslut", () => {
    paidRotJob([labor({ qty: 10, unit: "tim", unitPrice: 1_000 })]);
    const file = buildHusExportFile({ jobId: "job-kok" });
    const app = markHusFileDownloaded({ jobId: "job-kok", fileName: file.fileName });
    assert.equal(app.status, "underlag_skapat");
    assert.equal(app.decision, undefined);
    assert.ok(app.hus?.fileDownloadedAt);
    assert.equal(husExportPreview({ jobId: "job-kok" })!.fileDownloadedAt, app.hus!.fileDownloadedAt);
    assert.equal(taxReductionCaseForJob(getJob("job-kok")!).phase, "underlag");
    const audit = db().auditTrail.filter((a) => a.action === "rot_fil_nedladdad");
    assert.equal(audit.length, 1);
    assert.ok(audit[0].details.includes(file.fileName));
    assert.ok(!audit[0].details.includes("198505151234"), "personnummer aldrig i loggen");
    assert.ok(db().activity[0].text.includes("Fil till Skatteverket"));
    assert.ok(!db().activity[0].text.includes("skickad"));
  });

  it("underlaget via fakturan pekar på samma ärende som uppdraget", () => {
    const inv = paidRotJob([labor({ qty: 10, unit: "tim", unitPrice: 1_000 })]);
    const viaInvoice = husExportPreview({ invoiceId: inv.id })!;
    const viaJob = husExportPreview({ jobId: "job-kok" })!;
    assert.equal(viaInvoice.jobId, "job-kok");
    assert.equal(viaInvoice.downloadHref, viaJob.downloadHref);
    assert.equal(buildHusExportFile({ invoiceId: inv.id }).xml, viaJob && buildHusExportFile({ jobId: "job-kok" }).xml);
  });
});

describe("HUS-fil från RUT-ärende", () => {
  beforeEach(() => reset());

  function paidRutInvoice() {
    const inv = createInvoice({
      customerId: "cust-anna",
      type: "faktura",
      lines: [labor({ qty: 4, unit: "tim", unitPrice: 500 })],
      rot: { type: "rut" },
      taxReductionDetails: { workPeriodStart: "2026-08-10", workPeriodEnd: "2026-08-10" },
    });
    issueInvoice(inv.id);
    markInvoicePaid(inv.id, { matchedBy: "manuell" });
    createTaxReductionUnderlag({ invoiceId: inv.id });
    return getInvoice(inv.id)!;
  }

  it("RUT kräver valt arbetsområde och hamnar i HushallBegaran utan bostad", (t) => {
    const inv = paidRutInvoice();
    const before = husExportPreview({ invoiceId: inv.id })!;
    assert.equal(before.type, "rut");
    assert.equal(before.category, null, "ingen default för RUT");
    assert.ok(before.blockers.some((b) => b.code === "kategori"));
    assert.equal(before.downloadHref, `/api/skatteverket/hus?faktura=${inv.id}`);
    assert.throws(() => buildHusExportFile({ invoiceId: inv.id }), /arbetsområde/i);

    assert.throws(() => patchHusExportFields({ invoiceId: inv.id, workCategory: "Bygg" }), /finns inte för RUT/);
    patchHusExportFields({ invoiceId: inv.id, workCategory: "Stadning" });
    const after = husExportPreview({ invoiceId: inv.id })!;
    assert.deepEqual(after.blockers, []);

    const file = buildHusExportFile({ invoiceId: inv.id });
    assert.equal(file.type, "rut");
    assert.match(file.fileName, /^rut-begaran-faktura-\d+-/);
    assert.ok(file.xml.includes("<HushallBegaran"));
    assert.ok(!file.xml.includes("RotBegaran"));
    assert.ok(!file.xml.includes("Fastighetsbeteckning"));
    assert.ok(file.xml.includes("<PrisForArbete>2500</PrisForArbete>"));
    assert.ok(file.xml.includes("<BegartBelopp>1250</BegartBelopp>"));
    assert.ok(file.xml.includes("<BetaltBelopp>1250</BetaltBelopp>"));
    assert.ok(file.xml.includes("<Stadning>"));
    assert.ok(file.xml.includes("<AntalTimmar>4</AntalTimmar>"));
    assertXsd(file.xml, t);
  });
});
