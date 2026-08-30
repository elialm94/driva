process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb } from "./store";
import { buildSeed } from "./seed";
import { formatPersonnummer, isPersonnummerFormat, maskPersonnummer, normalizePersonnummer } from "./personnummer";
import { docTotals, ROT_ANDEL, RUT_ANDEL, ROT_TAK, RUT_TAK } from "./calc";
import { createInvoice, issueInvoice, markInvoicePaid, sendInvoice, updateInvoice } from "./services/invoices";
import { createQuote, STANDARD_TERMS, quoteDefaults } from "./services/quotes";
import { currentVersion, getInvoice, getJob, requireCustomer } from "./services/data";
import { quoteVersionHash } from "./hash";
import {
  calculatedEligibleTaxReduction,
  rotWithAmounts,
  syncRotWithLines,
  taxReductionAmountCopyCorpus,
} from "./tax-reduction-amount";
import { snapshotTaxReductionTerms, taxReductionExceedsMaxError } from "./tax-reduction-terms";
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
import { createTaxReductionInvoiceDraft } from "./ai/domain";
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

  it("kund skapad med bara namn: ROT kräver exakt personnummer + fastighetsuppgift", () => {
    // Personnummer samlas inte in vid Ny kund (känsligt, behövs först här) –
    // ROT-flödet ska då fråga efter exakt det som saknas, inget mer.
    const missing = taxReductionMissingFields({
      type: "rot",
      personalIdentityNumber: undefined,
      details: {
        workPeriodStart: "2026-08-12",
        workPeriodEnd: "2026-08-19",
        housing: { dwellingType: "smahus" },
      },
      scope: "invoice",
    });
    assert.deepEqual(
      missing.map((m) => m.code),
      ["personnummer", "propertyDesignation"]
    );
    assert.deepEqual(
      missing.map((m) => m.label),
      ["Personnummer", "Fastighetsbeteckning"]
    );
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

  it("MATERIAL, TRAVEL och OTHER ingår aldrig i ROT-underlaget – 24 h + restid", () => {
    const t = docTotals(
      [
        labor({ kind: "arbete", type: "LABOR", qty: 24, unit: "tim", unitPrice: 650, vatRate: 0, description: "Snickeriarbete" }),
        labor({ kind: "resor", type: "TRAVEL", qty: 2, unit: "tim", unitPrice: 400, vatRate: 0, description: "Restid" }),
        labor({ kind: "material", type: "MATERIAL", qty: 1, unit: "st", unitPrice: 3_000, vatRate: 0, description: "Virke" }),
        labor({ kind: "ovrigt", type: "OTHER", qty: 1, unit: "st", unitPrice: 200, vatRate: 0, description: "Övrigt" }),
      ],
      { type: "rot" }
    );
    assert.equal(t.total, 16_400 + 3_000 + 200);
    assert.equal(t.laborInclVat, 15_600);
    assert.equal(t.deduction, 4_680);
  });

  it("RUT är 50 % med tak 75 000 – ROT 30 % med tak 50 000 (per person och år)", () => {
    const rut = docTotals([labor({ kind: "arbete", unitPrice: 200_000, qty: 1, vatRate: 25 })], { type: "rut" });
    assert.equal(rut.deduction, RUT_TAK);
    assert.equal(Math.round(rut.laborInclVat * RUT_ANDEL) > RUT_TAK, true);
    const rot = docTotals([labor({ kind: "arbete", unitPrice: 200_000, qty: 1, vatRate: 25 })], { type: "rot" });
    assert.equal(rot.deduction, ROT_TAK);
    assert.equal(Math.round(rot.laborInclVat * ROT_ANDEL) > ROT_TAK, true);
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

  it("sätter applied avdrag via tjänsten och påstår inte Skatteverkets saldo", () => {
    const result = createTaxReductionInvoiceDraft({
      customerId: "cust-anna",
      amountInclVat: 12_500,
      type: "rot",
      appliedTaxReduction: 2_000,
    });
    assert.equal(result.ok, true);
    const inv = getInvoice(result.forModel.invoiceId as string)!;
    assert.equal(inv.rot?.appliedTaxReduction, 2_000);
    assert.equal(inv.rot?.taxReductionManuallyAdjusted, true);
    assert.ok(inv.rot!.calculatedEligibleTaxReduction! >= 2_000);
    assert.ok(!/kvarvarande utrymme|kundens max|tillgängligt ROT-utrymme|kunden har .* kvar/i.test(result.text));
  });
});

describe("Manuellt sänkt ROT-avdrag", () => {
  beforeEach(() => reset());

  const work = () => labor({ unitPrice: 8_000 });

  it("applied följer calculated som standard", () => {
    const inv = createInvoice({
      customerId: "cust-anna",
      type: "faktura",
      lines: [work()],
      rot: { type: "rot" },
    });
    const t = docTotals(inv.lines, { type: "rot" });
    assert.equal(inv.rot?.calculatedEligibleTaxReduction, t.calculatedEligibleTaxReduction);
    assert.equal(inv.rot?.appliedTaxReduction, t.calculatedEligibleTaxReduction);
    assert.equal(inv.rot?.taxReductionManuallyAdjusted, false);
    assert.equal(docTotals(inv.lines, inv.rot).deduction, t.calculatedEligibleTaxReduction);
    assert.equal(docTotals(inv.lines, inv.rot).toPay, t.total - t.calculatedEligibleTaxReduction);
  });

  it("behåller applied när arbetskostnaden tillfälligt är 0", () => {
    const empty = [labor({ unitPrice: 0 })];
    const held = syncRotWithLines(
      { type: "rot", appliedTaxReduction: 15_000, taxReductionManuallyAdjusted: true },
      empty
    );
    assert.equal(held.rot.appliedTaxReduction, 15_000);
    assert.equal(held.clamped, false);
    const withLabor = syncRotWithLines(held.rot, [labor({ unitPrice: 80_000 })]);
    assert.equal(withLabor.rot.appliedTaxReduction, 15_000);
  });

  it("noll kronor i avdrag är tillåtet", () => {
    const inv = createInvoice({
      customerId: "cust-anna",
      type: "faktura",
      lines: [work()],
      rot: { type: "rot", appliedTaxReduction: 0, taxReductionManuallyAdjusted: true },
    });
    assert.equal(inv.rot?.appliedTaxReduction, 0);
    assert.equal(docTotals(inv.lines, inv.rot).toPay, docTotals(inv.lines, null).total);
  });

  it("kan inte överstiga max vid uppdatering", () => {
    const inv = createInvoice({
      customerId: "cust-anna",
      type: "faktura",
      lines: [work()],
      rot: { type: "rot" },
    });
    const max = inv.rot!.calculatedEligibleTaxReduction!;
    assert.throws(
      () =>
        updateInvoice(inv.id, {
          lines: inv.lines,
          rot: { type: "rot", appliedTaxReduction: max + 1, taxReductionManuallyAdjusted: true },
        }),
      (err: Error) => err.message === taxReductionExceedsMaxError(max, "faktura")
    );
  });

  it("klampar applied när raderna sänker max, behåller applied när max räcker", () => {
    const lines = [work()];
    const max = calculatedEligibleTaxReduction(lines, "rot");
    const lowered = Math.max(0, max - 1_000);
    const inv = createInvoice({
      customerId: "cust-anna",
      type: "faktura",
      lines,
      rot: { type: "rot", appliedTaxReduction: lowered, taxReductionManuallyAdjusted: true },
    });
    assert.equal(inv.rot?.appliedTaxReduction, lowered);

    const stillOk = [labor({ unitPrice: 20_000 })];
    const kept = updateInvoice(inv.id, {
      lines: stillOk,
      rot: { type: "rot", appliedTaxReduction: lowered, taxReductionManuallyAdjusted: true },
    });
    assert.equal(kept.rot?.appliedTaxReduction, lowered);

    const small = [labor({ unitPrice: 2_000 })];
    const smallMax = calculatedEligibleTaxReduction(small, "rot");
    assert.ok(smallMax < lowered);
    const clamped = rotWithAmounts(
      { type: "rot", appliedTaxReduction: lowered, taxReductionManuallyAdjusted: true },
      small,
      { mode: "clamp" }
    );
    assert.equal(clamped?.appliedTaxReduction, smallMax);
    assert.equal(clamped?.taxReductionManuallyAdjusted, true);
    const alreadyClamped = syncRotWithLines(clamped!, small);
    assert.equal(alreadyClamped.clamped, false);
    assert.equal(alreadyClamped.rot.appliedTaxReduction, smallMax);
  });

  it("faktura från offert ärver applied och klampar mot fakturans max", () => {
    const defaults = quoteDefaults();
    const quoteLines = [work()];
    const quoteMax = calculatedEligibleTaxReduction(quoteLines, "rot");
    const applied = Math.max(0, quoteMax - 500);
    const quote = createQuote({
      customerId: "cust-anna",
      title: "ROT-offert",
      intro: "Test",
      lines: quoteLines,
      rot: { type: "rot", appliedTaxReduction: applied, taxReductionManuallyAdjusted: true },
      paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
      paymentTermsDays: defaults.paymentTermsDays,
      validUntil: defaults.validUntil,
      terms: STANDARD_TERMS,
    });
    assert.equal(currentVersion(quote).rot?.appliedTaxReduction, applied);

    const same = createInvoice({
      customerId: "cust-anna",
      quoteId: quote.id,
      type: "faktura",
      lines: quoteLines.map((l) => ({ ...l, id: "inv-1" })),
      rot: { type: "rot" },
    });
    assert.equal(same.rot?.appliedTaxReduction, applied);

    const smallerLines = [labor({ unitPrice: 2_000 })];
    const invoiceMax = calculatedEligibleTaxReduction(smallerLines, "rot");
    assert.ok(invoiceMax < applied);
    const clamped = createInvoice({
      customerId: "cust-anna",
      quoteId: quote.id,
      type: "faktura",
      lines: smallerLines,
      rot: { type: "rot" },
    });
    assert.equal(clamped.rot?.appliedTaxReduction, invoiceMax);
  });

  it("ansökningsunderlag använder applied, inte teoretiskt max", () => {
    const job = getJob("job-kok")!;
    job.housing = { dwellingType: "smahus", propertyDesignation: "Södermalm 12:34" };
    const inv = createInvoice({
      customerId: "cust-anna",
      jobId: "job-kok",
      type: "faktura",
      lines: [work()],
      rot: { type: "rot", appliedTaxReduction: 1_200, taxReductionManuallyAdjusted: true },
    });
    issueInvoice(inv.id);
    markInvoicePaid(inv.id, { matchedBy: "manuell" });
    setJobStatus("job-kok", "klart");
    const app = createTaxReductionUnderlag({ jobId: "job-kok", invoiceId: inv.id });
    assert.ok(app.underlagSummary?.includes("1\u00a0200") || app.underlagSummary?.includes("1 200"));
    const max = calculatedEligibleTaxReduction(inv.lines, "rot");
    assert.ok(max > 1_200);
    assert.equal((app.underlagSummary ?? "").includes(String(max)), false);
  });

  it("äldre offerter utan applied-fält behåller samma hash", () => {
    const defaults = quoteDefaults();
    const q = createQuote({
      customerId: "cust-anna",
      title: "Hash-test",
      intro: "Test",
      lines: [work()],
      rot: { type: "rot" },
      paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
      paymentTermsDays: defaults.paymentTermsDays,
      validUntil: defaults.validUntil,
      terms: STANDARD_TERMS,
    });
    const v = currentVersion(q);
    const withoutField = quoteVersionHash({ ...v, rot: { type: "rot" } });
    const alsoWithout = quoteVersionHash({ ...v, rot: { type: "rot" } });
    assert.equal(withoutField, alsoWithout);
    const withApplied = quoteVersionHash({
      ...v,
      rot: { type: "rot", appliedTaxReduction: 1_000, taxReductionManuallyAdjusted: true },
    });
    assert.notEqual(withoutField, withApplied);
  });

  it("copy nämner aldrig kvarvarande utrymme eller kundens max", () => {
    const corpus = `${taxReductionAmountCopyCorpus("faktura")}\n${taxReductionAmountCopyCorpus("offert")}`;
    assert.equal(/kvarvarande utrymme/i.test(corpus), false);
    assert.equal(/kundens max/i.test(corpus), false);
    assert.equal(/tillgängligt ROT-utrymme/i.test(corpus), false);
    assert.equal(/kunden har \d/i.test(corpus), false);
    assert.match(corpus, /maximala avdrag som fakturan medger/);
    assert.match(corpus, /material, resor och övrigt ingår inte/);
  });
});
