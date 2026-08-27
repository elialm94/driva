process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb } from "./store";
import { buildSeed } from "./seed";
import { formatPersonnummer, isPersonnummerFormat, maskPersonnummer, normalizePersonnummer } from "./personnummer";
import { docTotals, ROT_ANDEL, RUT_ANDEL, AVDRAG_TAK } from "./calc";
import { createInvoice, issueInvoice, markInvoicePaid, sendInvoice, updateInvoice } from "./services/invoices";
import { setJobStatus } from "./services/jobs";
import {
  createTaxReductionUnderlag,
  detailsFromPrefill,
  resolveTaxReductionPrefill,
  taxReductionCaseForInvoice,
  taxReductionCaseForJob,
  taxReductionMissingFields,
} from "./services/tax-reduction";
import { formatWorkPeriodRange } from "./tax-reduction-gaps";
import { getInvoice, getJob, requireCustomer } from "./services/data";
import { createTaxReductionInvoiceDraft } from "./ai/domain";
import { snapshotTaxReductionTerms } from "./tax-reduction-terms";
import { labor } from "./invoices/test-db";

function reset() {
  replaceDb(buildSeed());
}

describe("personnummer", () => {
  it("formaterar 12 siffror som YYYYMMDD-NNNN", () => {
    assert.equal(formatPersonnummer("198505151234"), "19850515-1234");
    assert.equal(formatPersonnummer("19850515-1234"), "19850515-1234");
    assert.equal(normalizePersonnummer("198505151234"), "19850515-1234");
    assert.equal(isPersonnummerFormat("19850515-1234"), true);
  });

  it("maskar i vanliga vyer som 1985••••-1234", () => {
    assert.equal(maskPersonnummer("19850515-1234"), "1985••••-1234");
    assert.equal(maskPersonnummer("850515-1234"), "85••••-1234");
  });
});

describe("arbetsperiod", () => {
  it("formaterar samma månad som 12–19 augusti 2026", () => {
    assert.equal(formatWorkPeriodRange("2026-08-12", "2026-08-19"), "12–19 augusti 2026");
    assert.equal(formatWorkPeriodRange("2026-08-12", "2026-08-12"), "12 augusti 2026");
    assert.equal(formatWorkPeriodRange("2026-07-12", "2026-08-19"), "12 juli – 19 augusti 2026");
  });
});

describe("ROT/RUT fält och prefill", () => {
  beforeEach(() => reset());

  it("Ingen har inga saknade ROT-fält", () => {
    const prefill = resolveTaxReductionPrefill({ customerId: "cust-anna", jobId: "job-kok" });
    assert.equal(prefill.workAddress.includes("Folkungagatan"), true);
    assert.equal(prefill.personalIdentityNumberMasked, "1985••••-1234");
    assert.ok(!prefill.personalIdentityNumberMasked.includes("0515"));
  });

  it("ROT kräver fastighetsbeteckning för småhus, RUT gör det inte", () => {
    const details = detailsFromPrefill(resolveTaxReductionPrefill({ customerId: "cust-anna", jobId: "job-kok" }));
    const rotMissing = taxReductionMissingFields({
      type: "rot",
      personalIdentityNumber: "19850515-1234",
      details,
    });
    const rutMissing = taxReductionMissingFields({
      type: "rut",
      personalIdentityNumber: "19850515-1234",
      details,
    });
    assert.ok(rotMissing.some((m) => m.code === "propertyDesignation"));
    assert.ok(!rutMissing.some((m) => m.code === "propertyDesignation"));
    assert.ok(!rutMissing.some((m) => m.code === "dwellingType"));
    assert.equal(rutMissing.length, 0);
    assert.deepEqual(rotMissing.map((m) => m.code), ["propertyDesignation"]);
    assert.ok(!rotMissing.some((m) => m.code === "workAddress"));
    assert.ok(!rotMissing.some((m) => m.code === "workPeriod"));
  });

  it("Ny faktura frågar inte efter adress – det tas vid ansökan om det saknas helt", () => {
    const invoiceMissing = taxReductionMissingFields({
      type: "rot",
      personalIdentityNumber: "19850515-1234",
      details: {
        workPeriodStart: "2026-08-12",
        workPeriodEnd: "2026-08-19",
        housing: { dwellingType: "smahus", propertyDesignation: "Södermalm 12:34" },
      },
      scope: "invoice",
    });
    assert.equal(invoiceMissing.length, 0);
    const applicationMissing = taxReductionMissingFields({
      type: "rot",
      personalIdentityNumber: "19850515-1234",
      details: {
        workPeriodStart: "2026-08-12",
        housing: { dwellingType: "smahus", propertyDesignation: "Södermalm 12:34" },
      },
      scope: "application",
    });
    assert.ok(applicationMissing.some((m) => m.code === "workAddress"));
  });

  it("bostadstyp bostadsrätt kräver BRF+lgh, inte fastighetsbeteckning", () => {
    const missing = taxReductionMissingFields({
      type: "rot",
      personalIdentityNumber: "19850515-1234",
      details: {
        workAddress: "Gatan 1",
        workPeriodStart: "2026-01-01",
        housing: { dwellingType: "bostadsratt" },
      },
    });
    const codes = missing.map((m) => m.code);
    assert.ok(codes.includes("brfOrgNumber"));
    assert.ok(codes.includes("apartmentNumber"));
    assert.ok(!codes.includes("propertyDesignation"));
  });

  it("prefill från uppdrag återanvänds på ny faktura", () => {
    const inv = createInvoice({
      customerId: "cust-anna",
      jobId: "job-kok",
      type: "faktura",
      lines: [labor({ unitPrice: 8000 })],
      rot: { type: "rot" },
    });
    assert.equal(inv.taxReductionDetails?.workAddress?.includes("Folkungagatan"), true);
    assert.equal(inv.taxReductionDetails?.housing?.dwellingType, "smahus");
    assert.equal(requireCustomer("cust-anna").personalIdentityNumber, "19850515-1234");
    assert.equal(inv.taxReductionTerms?.text, snapshotTaxReductionTerms("rot").text);
    assert.equal(inv.serviceDate?.slice(0, 10), (getJob("job-kok")!.endDate || "").slice(0, 10));
  });

  it("fastighetsbeteckning sparas på uppdraget och räcker på nästa faktura", () => {
    createInvoice({
      customerId: "cust-anna",
      jobId: "job-kok",
      type: "faktura",
      lines: [labor({ unitPrice: 8000 })],
      rot: { type: "rot" },
      taxReductionDetails: {
        housing: { dwellingType: "smahus", propertyDesignation: "Södermalm 12:34" },
      },
    });
    assert.equal(getJob("job-kok")!.housing?.propertyDesignation, "Södermalm 12:34");
    const inv2 = createInvoice({
      customerId: "cust-anna",
      jobId: "job-kok",
      type: "faktura",
      lines: [labor({ unitPrice: 2000 })],
      rot: { type: "rot" },
    });
    assert.equal(inv2.taxReductionDetails?.housing?.propertyDesignation, "Södermalm 12:34");
    const missing = taxReductionMissingFields({
      type: "rot",
      personalIdentityNumber: requireCustomer("cust-anna").personalIdentityNumber,
      details: inv2.taxReductionDetails,
      scope: "invoice",
    });
    assert.deepEqual(
      missing.map((m) => m.code),
      []
    );
  });

  it("byte till bostadsrätt lagrar inte fastighetsbeteckning på fakturan", () => {
    const inv = createInvoice({
      customerId: "cust-anna",
      jobId: "job-kok",
      type: "faktura",
      lines: [labor({ unitPrice: 8000 })],
      rot: { type: "rot" },
      taxReductionDetails: {
        housing: { dwellingType: "bostadsratt", brfOrgNumber: "769612-3456", apartmentNumber: "1201" },
      },
    });
    assert.equal(inv.taxReductionDetails?.housing?.dwellingType, "bostadsratt");
    assert.equal(inv.taxReductionDetails?.housing?.propertyDesignation, undefined);
    assert.equal(getJob("job-kok")!.housing?.dwellingType, "bostadsratt");
    assert.equal(getJob("job-kok")!.housing?.propertyDesignation, undefined);
  });
});

describe("ROT-beräkning och villkor", () => {
  it("räknar bara arbete, inte material, och är inte en rabatt-formel", () => {
    const t = docTotals(
      [
        labor({ kind: "arbete", unitPrice: 10_000, qty: 1, vatRate: 25 }),
        labor({ kind: "material", unitPrice: 4_000, qty: 1, vatRate: 25, description: "Luckor" }),
      ],
      { type: "rot" }
    );
    assert.equal(t.laborInclVat, 12_500);
    assert.equal(t.deduction, Math.round(12_500 * ROT_ANDEL));
    assert.equal(t.toPay, t.total - t.deduction);
    assert.equal(t.deduction < t.total, true);
  });

  it("RUT är 50 % och taket är 50 000", () => {
    const t = docTotals([labor({ kind: "arbete", unitPrice: 200_000, qty: 1, vatRate: 25 })], { type: "rut" });
    assert.equal(t.deduction, AVDRAG_TAK);
    assert.equal(Math.round(t.laborInclVat * RUT_ANDEL) > AVDRAG_TAK, true);
  });
});

describe("validering och ansökan", () => {
  beforeEach(() => reset());

  it("ROT-faktura utan BankID-signerad offert kan skickas och har villkor", () => {
    const inv = createInvoice({
      customerId: "cust-anna",
      type: "faktura",
      lines: [labor({ unitPrice: 8_000 })],
      rot: { type: "rot" },
    });
    assert.ok(inv.taxReductionTerms);
    const sent = sendInvoice(inv.id);
    assert.equal(sent.status, "skickad");
    assert.ok(sent.number != null);
  });

  it("saknad fastighetsbeteckning blockerar underlag, inte utkast", () => {
    const inv = createInvoice({
      customerId: "cust-anna",
      jobId: "job-kok",
      type: "faktura",
      lines: [labor({ unitPrice: 8_000 })],
      rot: { type: "rot" },
    });
    const cse = taxReductionCaseForInvoice(inv);
    assert.equal(cse.phase, "preliminar");
    assert.ok(cse.missing.some((m) => m.code === "propertyDesignation"));
    issueInvoice(inv.id);
    markInvoicePaid(inv.id, { matchedBy: "manuell" });
    setJobStatus("job-kok", "klart");
    const ready = taxReductionCaseForInvoice(getInvoice(inv.id)!);
    assert.equal(ready.phase, "missing_fields");
    assert.throws(() => createTaxReductionUnderlag({ invoiceId: inv.id }), /saknas|Fastighetsbeteckning/i);
  });

  it("ROT redo att ansökas när kunden betalat, arbetet är klart och uppgifter finns", () => {
    const job = getJob("job-kok")!;
    job.housing = { dwellingType: "smahus", propertyDesignation: "Södermalm 12:34" };
    const inv = createInvoice({
      customerId: "cust-anna",
      jobId: "job-kok",
      type: "faktura",
      lines: [labor({ unitPrice: 8_000 })],
      rot: { type: "rot" },
    });
    issueInvoice(inv.id);
    markInvoicePaid(inv.id, { matchedBy: "manuell" });
    setJobStatus("job-kok", "klart");
    const cse = taxReductionCaseForJob(getJob("job-kok")!);
    assert.equal(cse.phase, "ready");
    assert.equal(cse.nextStep, "ROT redo att ansökas");
    const app = createTaxReductionUnderlag({ jobId: "job-kok", invoiceId: inv.id });
    assert.equal(app.status, "underlag_skapat");
    assert.ok(app.underlagSummary?.includes("Södermalm 12:34"));
    assert.ok(app.underlagSummary?.includes("19850515-1234"));
  });
});

describe("AI ROT-faktura", () => {
  beforeEach(() => reset());

  it("hittar Köksrenovering, återanvänder uppgifter och hittar inte på fastighetsbeteckning", () => {
    const result = createTaxReductionInvoiceDraft({
      customerId: "cust-anna",
      titleHint: "köksrenovering",
      type: "rot",
    });
    assert.equal(result.ok, true);
    const invoiceId = result.forModel.invoiceId as string;
    const inv = getInvoice(invoiceId)!;
    assert.equal(inv.rot?.type, "rot");
    assert.equal(inv.jobId, "job-kok");
    assert.equal(inv.taxReductionDetails?.workAddress?.includes("Folkungagatan"), true);
    const missing = result.forModel.missingFields as string[];
    assert.ok(missing.includes("propertyDesignation"));
    assert.equal(missing.length, 1);
    assert.equal(typeof result.forModel.personalIdentityNumber, "undefined");
    assert.equal(result.forModel.personalIdentityNumberMasked, "1985••••-1234");
    assert.match(result.text, /fastighetsbeteckning/i);
    assert.ok(!/adress|arbetsperiod|personnummer/i.test(result.text.split("Jag hittar")[1] ?? ""));
  });
});
