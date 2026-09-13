process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb } from "./store";
import { emptyTestDb, labor, rotReadyCustomer, testWorkLocation } from "./invoices/test-db";
import { createInvoice, issueInvoice, markInvoicePaid, updateInvoice } from "./services/invoices";
import { getInvoice, getJob } from "./services/data";
import {
  createTaxReductionUnderlag,
  resolveTaxReductionPrefill,
  taxReductionCaseForInvoice,
} from "./services/tax-reduction";
import { currentMonthPeriod, deriveWorkPeriod, taxReductionMissingFields } from "./tax-reduction-gaps";
import { taxReductionCalcHintText } from "./tax-reduction-terms";
import { todayDate } from "./accounting/dates";
import type { Job } from "./types";

function testJob(over: Partial<Job> = {}): Job {
  return {
    id: over.id ?? "job-1",
    customerId: over.customerId ?? "cust-1",
    title: over.title ?? "Köksrenovering",
    description: over.description ?? "",
    status: over.status ?? "pagar",
    checklist: [],
    notes: "",
    createdAt: "2026-08-01T08:00:00.000Z",
    ...over,
  };
}

/**
 * Arbetsperioden finns inte i Skatteverkets husarbetsbegäran (se hus-begaran.ts
 * och docs/skatteverket/hus). Den härleds för visning och för underlaget, och
 * den får aldrig stämpla datum på ett uppdrag som medvetet saknar dem.
 */
describe("arbetsperiod: läsordningen", () => {
  it("fakturans egna värden vinner över uppdragets", () => {
    assert.deepEqual(
      deriveWorkPeriod({
        details: { workPeriodStart: "2026-08-12", workPeriodEnd: "2026-08-19" },
        job: { startDate: "2026-07-01", endDate: "2026-07-31" },
        today: "2026-09-13",
      }),
      { start: "2026-08-12", end: "2026-08-19", source: "invoice" }
    );
  });

  it("uppdragets start och slut används när fakturan saknar period", () => {
    assert.deepEqual(
      deriveWorkPeriod({ job: { startDate: "2026-07-01", endDate: "2026-07-31" }, today: "2026-09-13" }),
      { start: "2026-07-01", end: "2026-07-31", source: "job" }
    );
  });

  it("halva uppdragsdatum räknas som en dag, inte som halv månad", () => {
    assert.deepEqual(deriveWorkPeriod({ job: { startDate: "2026-07-01" }, today: "2026-09-13" }), {
      start: "2026-07-01",
      end: "2026-07-01",
      source: "job",
    });
  });

  it("uppdragets completedAt används när start och slut saknas", () => {
    assert.deepEqual(deriveWorkPeriod({ job: { completedAt: "2026-08-20" }, today: "2026-09-13" }), {
      start: "2026-08-20",
      end: "2026-08-20",
      source: "job",
    });
  });

  it("aktuell månad är sista utposten", () => {
    assert.deepEqual(deriveWorkPeriod({ today: "2026-09-13" }), {
      start: "2026-09-01",
      end: "2026-09-30",
      source: "derived",
    });
    assert.deepEqual(currentMonthPeriod("2026-02-13"), { start: "2026-02-01", end: "2026-02-28" });
    assert.deepEqual(currentMonthPeriod("2024-02-05"), { start: "2024-02-01", end: "2024-02-29" });
  });

  it("en härledd period på fakturan räknas inte som manuell utan härleds om", () => {
    const period = deriveWorkPeriod({
      details: { workPeriodStart: "2026-09-01", workPeriodEnd: "2026-09-30", workPeriodSource: "derived" },
      job: { startDate: "2026-07-01", endDate: "2026-07-31" },
      today: "2026-09-13",
    });
    assert.deepEqual(period, { start: "2026-07-01", end: "2026-07-31", source: "job" });
  });
});

describe("arbetsperiod: skrivs aldrig tillbaka till uppdraget", () => {
  beforeEach(() => {
    replaceDb(emptyTestDb({ customers: [rotReadyCustomer()], jobs: [testJob()] }));
  });

  it("uppdrag utan datum får inga datum av en härledd period", () => {
    const inv = createInvoice({
      customerId: "cust-1",
      jobId: "job-1",
      type: "faktura",
      lines: [labor()],
      rot: { type: "rot" },
      workLocationId: "loc-1",
    });
    const job = getJob("job-1")!;
    assert.equal(job.startDate, undefined, "uppdraget ska inte få ett påhittat startdatum");
    assert.equal(job.endDate, undefined, "uppdraget ska inte få ett påhittat slutdatum");
    assert.equal(inv.taxReductionDetails?.workPeriodSource, "derived");

    const month = currentMonthPeriod(todayDate());
    const prefill = resolveTaxReductionPrefill({
      customerId: "cust-1",
      jobId: "job-1",
      details: inv.taxReductionDetails,
    });
    assert.equal(prefill.workPeriodStart, month.start, "perioden visas ändå");
    assert.equal(prefill.workPeriodEnd, month.end);
    assert.equal(prefill.workPeriodSource, "derived");
  });

  it("manuellt angiven period sparas på fakturan och följer med till uppdraget", () => {
    const inv = createInvoice({
      customerId: "cust-1",
      jobId: "job-1",
      type: "faktura",
      lines: [labor()],
      rot: { type: "rot" },
      workLocationId: "loc-1",
    });
    updateInvoice(inv.id, {
      lines: inv.lines,
      rot: { type: "rot" },
      taxReductionDetails: { workPeriodStart: "2026-08-12", workPeriodEnd: "2026-08-19" },
    });
    const job = getJob("job-1")!;
    assert.equal(job.startDate, "2026-08-12");
    assert.equal(job.endDate, "2026-08-19");
    const stored = getInvoice(inv.id)!;
    assert.equal(stored.taxReductionDetails?.workPeriodStart, "2026-08-12");
    assert.equal(stored.taxReductionDetails?.workPeriodSource, "invoice");
  });

  it("en befintlig faktura med manuell period behåller den när uppdraget har andra datum", () => {
    const job = getJob("job-1")!;
    job.startDate = "2026-07-01";
    job.endDate = "2026-07-31";
    const inv = createInvoice({
      customerId: "cust-1",
      jobId: "job-1",
      type: "faktura",
      lines: [labor()],
      rot: { type: "rot" },
      workLocationId: "loc-1",
      taxReductionDetails: { workPeriodStart: "2026-08-12", workPeriodEnd: "2026-08-19" },
    });
    assert.equal(inv.taxReductionDetails?.workPeriodStart, "2026-08-12");
    assert.equal(inv.taxReductionDetails?.workPeriodEnd, "2026-08-19");
    assert.equal(inv.taxReductionDetails?.workPeriodSource, "invoice");
  });
});

describe("arbetsperiod: ingen lucka och ingen spärr", () => {
  it("taxReductionMissingFields nämner aldrig arbetsperiod", () => {
    for (const scope of ["invoice", "application"] as const) {
      const missing = taxReductionMissingFields({
        type: "rot",
        personalIdentityNumber: "19850515-1234",
        details: {
          workAddress: "Folkungagatan 1, Stockholm",
          housing: { dwellingType: "smahus", propertyDesignation: "Eken 1:23" },
        },
        scope,
      });
      assert.deepEqual(missing, [], `scope ${scope} ska vara utan luckor`);
    }
  });

  it("RUT räknar varken arbetsperiod eller fastighetsbeteckning", () => {
    const missing = taxReductionMissingFields({
      type: "rut",
      personalIdentityNumber: "19850515-1234",
      details: {},
      scope: "invoice",
    });
    assert.deepEqual(missing, []);
  });

  it("underlag kan skapas utan att någon arbetsperiod fyllts i", () => {
    replaceDb(emptyTestDb({ customers: [rotReadyCustomer()] }));
    const inv = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor({ unitPrice: 10_000 })],
      rot: { type: "rot" },
      workLocationId: "loc-1",
    });
    issueInvoice(inv.id);
    markInvoicePaid(inv.id, { matchedBy: "manuell" });
    const cse = taxReductionCaseForInvoice(getInvoice(inv.id)!);
    assert.deepEqual(cse.missing, []);
    assert.equal(cse.phase, "ready");
    const app = createTaxReductionUnderlag({ invoiceId: inv.id });
    assert.equal(app.status, "underlag_skapat");
    assert.match(app.underlagSummary ?? "", /Arbetsperiod:/, "underlaget visar den härledda perioden");
  });
});

describe("bostad prefillas från kundens tidigare ROT-faktura", () => {
  /** Kundens sparade bostad saknar beteckning - det gör seedens loc-anna-hem också. */
  function customerWithBareLocation(propertyType: "smahus" | "bostadsratt") {
    return rotReadyCustomer({
      workLocations: [testWorkLocation({ propertyType, propertyDesignation: undefined })],
    });
  }

  it("fastighetsbeteckningen återanvänds när kundens bostad saknar den", () => {
    replaceDb(emptyTestDb({ customers: [customerWithBareLocation("smahus")] }));
    const first = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: { type: "rot" },
      workLocationId: "loc-1",
      taxReductionDetails: { housing: { dwellingType: "smahus", propertyDesignation: "Eken 1:23" } },
    });
    issueInvoice(first.id);

    const prefill = resolveTaxReductionPrefill({ customerId: "cust-1" });
    assert.equal(prefill.housing.dwellingType, "smahus");
    assert.equal(prefill.housing.propertyDesignation, "Eken 1:23");
    assert.deepEqual(
      taxReductionMissingFields({
        type: "rot",
        personalIdentityNumber: prefill.personalIdentityNumber,
        details: { workAddress: prefill.workAddress, housing: prefill.housing },
        scope: "invoice",
      }),
      [],
      "andra fakturan till samma kund har inga luckor"
    );
  });

  it("bostadsrätt återanvänds med BRF och lägenhetsnummer", () => {
    replaceDb(emptyTestDb({ customers: [customerWithBareLocation("bostadsratt")] }));
    const first = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: { type: "rot" },
      workLocationId: "loc-1",
      taxReductionDetails: {
        housing: { dwellingType: "bostadsratt", brfOrgNumber: "556677-8899", apartmentNumber: "1102" },
      },
    });
    issueInvoice(first.id);

    const prefill = resolveTaxReductionPrefill({ customerId: "cust-1" });
    assert.equal(prefill.housing.dwellingType, "bostadsratt");
    assert.equal(prefill.housing.brfOrgNumber, "556677-8899");
    assert.equal(prefill.housing.apartmentNumber, "1102");
  });
});

describe("betalningsdagen nämns en gång", () => {
  it("copyn förklarar betalningsdagen utan att säga samma sak två gånger", () => {
    const text = taxReductionCalcHintText("rot", 15_600);
    assert.match(text, /Vilken procentsats som gäller avgörs av den dag kunden betalar fakturan, inte av fakturadatumet\./);
    assert.equal(/Satsen avgörs av den dag kunden betalar\./.test(text), false);
    assert.equal(text.match(/betalar/g)?.length, 1, "en mening om betalningsdagen, inte två");
  });
});
