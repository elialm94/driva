process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb } from "./store";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import { docTotals, ROT_ANDEL } from "./calc";
import {
  classifyEconomicLineType,
  economicLineTypeFromKind,
  isTaxReductionEligible,
  lineKindFromType,
  lineTypeOf,
  shouldSuggestTravelType,
  syncDocLineClassification,
} from "./economic-line-type";
import { createQuote } from "./services/quotes";
import { createJobFromQuote } from "./services/jobs";
import { createInvoice, createInvoiceFromJobActuals, updateInvoice } from "./services/invoices";
import { currentVersion } from "./services/data";
import { entryToDocLine, plannedEntries, registerJobTime } from "./services/job-work";
import { classifiedLine } from "./ai/domain";
import type { DocLine } from "./types";

function reset() {
  replaceDb(emptyTestDb({ customers: [testCustomer({ id: "cust-1", personalIdentityNumber: "19850515-1234" })] }));
}

function approvedQuote(lines: DocLine[]) {
  const quote = createQuote({
    customerId: "cust-1",
    title: "Altan",
    intro: "Test",
    lines,
    rot: { type: "rot" },
    paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
    paymentTermsDays: 30,
    validUntil: "2030-01-01",
    terms: "",
  });
  quote.status = "godkand";
  quote.decidedAt = "2026-08-01T10:00:00.000Z";
  return quote;
}

describe("§23 isTaxReductionEligible – bara LABOR", () => {
  it("LABOR är grundande för både ROT och RUT", () => {
    assert.equal(isTaxReductionEligible("LABOR", "rot"), true);
    assert.equal(isTaxReductionEligible("LABOR", "rut"), true);
  });

  it("MATERIAL, TRAVEL och OTHER är aldrig grundande", () => {
    for (const type of ["MATERIAL", "TRAVEL", "OTHER"] as const) {
      assert.equal(isTaxReductionEligible(type, "rot"), false, type);
      assert.equal(isTaxReductionEligible(type, "rut"), false, type);
    }
  });

  it("mappar lagrade kind-värden till kanonisk typ utan att gissa", () => {
    assert.equal(economicLineTypeFromKind("arbete"), "LABOR");
    assert.equal(economicLineTypeFromKind("material"), "MATERIAL");
    assert.equal(economicLineTypeFromKind("resor"), "TRAVEL");
    assert.equal(economicLineTypeFromKind("ovrigt"), "OTHER");
    assert.equal(lineKindFromType("TRAVEL"), "resor");
    assert.equal(lineTypeOf({ kind: "arbete" }), "LABOR");
    assert.equal(lineTypeOf({ kind: "ovrigt", type: "TRAVEL" }), "TRAVEL");
  });
});

describe("§24 ROT-underlag: 24 h arbete + 2 h restid", () => {
  it("total 16 400, ROT-underlag 15 600, ROT 4 680", () => {
    const lines: DocLine[] = [
      labor({
        kind: "arbete",
        type: "LABOR",
        description: "Snickeriarbete",
        qty: 24,
        unit: "tim",
        unitPrice: 650,
        vatRate: 0,
      }),
      labor({
        kind: "resor",
        type: "TRAVEL",
        description: "Restid",
        qty: 2,
        unit: "tim",
        unitPrice: 400,
        vatRate: 0,
      }),
    ];
    const t = docTotals(lines, { type: "rot" });
    assert.equal(t.total, 16_400);
    assert.equal(t.laborInclVat, 15_600);
    assert.equal(t.deduction, 4_680);
    assert.equal(t.deduction, Math.round(15_600 * ROT_ANDEL));
    assert.equal(t.toPay, 16_400 - 4_680);
  });

  it("restid med 25 % moms räknas inte in i underlaget", () => {
    const lines: DocLine[] = [
      labor({ kind: "arbete", type: "LABOR", description: "Arbete", qty: 24, unit: "tim", unitPrice: 650, vatRate: 25 }),
      labor({ kind: "resor", type: "TRAVEL", description: "Restid", qty: 2, unit: "tim", unitPrice: 400, vatRate: 25 }),
    ];
    const t = docTotals(lines, { type: "rot" });
    const laborIncl = Math.round(24 * 650 * 1.25);
    const travelIncl = Math.round(2 * 400 * 1.25);
    assert.equal(t.total, laborIncl + travelIncl);
    assert.equal(t.laborInclVat, laborIncl);
    assert.equal(t.deduction, Math.round(laborIncl * ROT_ANDEL));
  });
});

describe("§25 klassning överlever Offert → Uppdrag → Faktura", () => {
  beforeEach(() => reset());

  it("kopierar LABOR/MATERIAL/TRAVEL/OTHER oförändrat i kedjan", () => {
    const quoteLines: DocLine[] = [
      labor({ id: "q-arb", kind: "arbete", type: "LABOR", description: "Snickeriarbete", qty: 24, unit: "tim", unitPrice: 650 }),
      labor({ id: "q-res", kind: "resor", type: "TRAVEL", description: "Restid", qty: 2, unit: "tim", unitPrice: 400 }),
      labor({ id: "q-mat", kind: "material", type: "MATERIAL", description: "Virke", qty: 1, unit: "st", unitPrice: 2000 }),
      labor({ id: "q-ovr", kind: "ovrigt", type: "OTHER", description: "Servicebil", qty: 1, unit: "st", unitPrice: 500 }),
    ];
    const quote = approvedQuote(quoteLines);
    const stored = currentVersion(quote).lines;
    assert.deepEqual(
      stored.map((l) => [l.kind, l.type]),
      [
        ["arbete", "LABOR"],
        ["resor", "TRAVEL"],
        ["material", "MATERIAL"],
        ["ovrigt", "OTHER"],
      ]
    );

    const job = createJobFromQuote(quote);
    const planned = plannedEntries(job.id);
    assert.deepEqual(
      planned.map((e) => e.type).sort(),
      ["labor", "material", "other", "travel"]
    );
    const fromJob = planned.map(entryToDocLine);
    assert.ok(fromJob.some((l) => l.kind === "resor" && l.type === "TRAVEL"));
    assert.ok(fromJob.some((l) => l.kind === "arbete" && l.type === "LABOR"));

    const invoice = createInvoice({
      customerId: "cust-1",
      jobId: job.id,
      quoteId: quote.id,
      type: "faktura",
      lines: stored.map((l) => ({ ...l, id: `inv-${l.id}` })),
      rot: { type: "rot" },
    });
    assert.deepEqual(
      invoice.lines.map((l) => [l.kind, l.type]),
      stored.map((l) => [l.kind, l.type])
    );
    const t = docTotals(invoice.lines, invoice.rot);
    const laborIncl = invoice.lines
      .filter((l) => l.type === "LABOR")
      .reduce((s, l) => s + Math.round(l.qty * l.unitPrice * (1 + l.vatRate / 100)), 0);
    assert.equal(t.laborInclVat, laborIncl);
    assert.ok(t.laborInclVat < t.total);
  });

  it("Quote → Faktura utan uppdrag behåller Resor", () => {
    const quote = approvedQuote([
      labor({ kind: "arbete", type: "LABOR", description: "Arbete", qty: 10, unit: "tim", unitPrice: 600 }),
      labor({ kind: "resor", type: "TRAVEL", description: "Framkörning", qty: 1, unit: "tim", unitPrice: 400 }),
    ]);
    const invoice = createInvoice({
      customerId: "cust-1",
      quoteId: quote.id,
      type: "faktura",
      lines: currentVersion(quote).lines.map((l) => ({ ...l, id: `i-${l.id}` })),
      rot: { type: "rot" },
    });
    const travel = invoice.lines.find((l) => l.description === "Framkörning");
    assert.equal(travel?.kind, "resor");
    assert.equal(travel?.type, "TRAVEL");
  });
});

describe("§26 historik, AI och omräkning", () => {
  beforeEach(() => reset());

  it("historisk OTHER med restid i texten förblir OTHER – ingen tyst omskrivning", () => {
    const historical = { kind: "ovrigt" as const, description: "Restid och milersättning" };
    assert.equal(lineTypeOf(historical), "OTHER");
    assert.equal(shouldSuggestTravelType(historical), false);
    const kept = syncDocLineClassification(historical);
    assert.equal(kept.kind, "ovrigt");
    assert.equal(kept.type, "OTHER");
  });

  it("AI/kommando klassar restid, mil, virke och snickeriarbete", () => {
    assert.equal(classifyEconomicLineType("Restid tur och retur"), "TRAVEL");
    assert.equal(classifyEconomicLineType("Milersättning 8 mil"), "TRAVEL");
    assert.equal(classifyEconomicLineType("Framkörning"), "TRAVEL");
    assert.equal(classifyEconomicLineType("Tryckimpregnerat virke"), "MATERIAL");
    assert.equal(classifyEconomicLineType("Snickeriarbete kök"), "LABOR");
    assert.equal(classifiedLine("Restid 2 timmar", 1000).type, "TRAVEL");
    assert.equal(classifiedLine("Virke till altanen", 2000).type, "MATERIAL");
    assert.equal(classifiedLine("Snickeriarbete", 5000).type, "LABOR");
  });

  it("förslag när ROT är aktivt och en arbetsrad ser ut som restid – ingen tyst omskrivning", () => {
    const line = labor({ kind: "arbete", type: "LABOR", description: "Restid Stockholm–Uppsala" });
    assert.equal(shouldSuggestTravelType(line), true);
    assert.equal(lineTypeOf(line), "LABOR");
  });

  it("live omräkning när typ, antal eller pris ändras", () => {
    const inv = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [
        labor({ id: "a", kind: "arbete", type: "LABOR", qty: 24, unit: "tim", unitPrice: 650, vatRate: 0 }),
        labor({ id: "r", kind: "arbete", type: "LABOR", description: "Restid", qty: 2, unit: "tim", unitPrice: 400, vatRate: 0 }),
      ],
      rot: { type: "rot" },
    });
    assert.equal(docTotals(inv.lines, inv.rot).laborInclVat, 16_400);

    const retyped = updateInvoice(inv.id, {
      lines: inv.lines.map((l) =>
        l.id === "r" ? syncDocLineClassification({ ...l, kind: "resor", type: "TRAVEL" }) : l
      ),
      rot: { type: "rot" },
    });
    assert.equal(docTotals(retyped.lines, retyped.rot).laborInclVat, 15_600);
    assert.equal(docTotals(retyped.lines, retyped.rot).deduction, 4_680);

    const fewerHours = updateInvoice(retyped.id, {
      lines: retyped.lines.map((l) => (l.id === "a" ? { ...l, qty: 10 } : l)),
      rot: { type: "rot" },
    });
    assert.equal(docTotals(fewerHours.lines, fewerHours.rot).laborInclVat, 6_500);
  });

  it("actuals från uppdrag behåller travel när de faktureras", () => {
    const quote = approvedQuote([
      labor({ id: "q-arb", kind: "arbete", type: "LABOR", description: "Arbete", qty: 8, unit: "tim", unitPrice: 600 }),
      labor({ id: "q-res", kind: "resor", type: "TRAVEL", description: "Restid", qty: 2, unit: "tim", unitPrice: 400 }),
    ]);
    const job = createJobFromQuote(quote);
    registerJobTime(job.id, { hours: 8, description: "Arbete", unitPrice: 600 });
    const invoice = createInvoiceFromJobActuals(job.id);
    assert.ok(invoice.lines.every((l) => l.kind === "arbete"));
    const fromPlanned = plannedEntries(job.id).find((e) => e.type === "travel");
    assert.equal(fromPlanned?.description, "Restid");
    const asLine = entryToDocLine(fromPlanned!);
    assert.equal(asLine.type, "TRAVEL");
    assert.equal(asLine.kind, "resor");
  });
});
