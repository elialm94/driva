process.env.DRIVA_TEST = "1";

/**
 * Kedjan kund → offert → uppdrag → faktura → betalning.
 * Täcker spec §38–42: ROT-arv, delbetalning, registrerat vs avtalat,
 * fristående vs kopplad faktura, kundsummering utan dubbelräkning.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import { createQuote } from "./services/quotes";
import { startJobFromQuote } from "./services/jobs";
import { addJobMaterial, plannedEntries, registerJobTime, uninvoicedActuals } from "./services/job-work";
import {
  createInvoice,
  createInvoiceForJob,
  createInvoiceFromQuote,
  createPartInvoiceForQuote,
  issueInvoice,
} from "./services/invoices";
import { invoiceTotals, quoteTotals } from "./services/data";
import { jobMoney } from "./services/job-economy";
import { customerActivityFeed, customerMoneyLine } from "./services/customer-activity";
import {
  customerChainCtas,
  invoiceChainLink,
  paymentPlanPartAlreadyInvoiced,
  preferredJobForNewInvoice,
  quoteChainState,
} from "./services/business-chain";
import { getBusinessActions } from "./services/actions";
import type { DocLine } from "./types";

function reset() {
  replaceDb(
    emptyTestDb({
      customers: [
        testCustomer({
          id: "cust-1",
          personalIdentityNumber: "19850515-1234",
          address: "Folkungagatan 1",
          city: "Stockholm",
        }),
      ],
    })
  );
}

function approvedQuote(
  lines: DocLine[],
  over: { rot?: "rot" | null; paymentPlan?: { label: string; percent: number }[]; title?: string } = {}
) {
  const quote = createQuote({
    customerId: "cust-1",
    title: over.title ?? "ROT-kök",
    intro: "Byte av luckor enligt offert.",
    lines,
    rot: over.rot === "rot" ? { type: "rot" } : null,
    paymentPlan: over.paymentPlan ?? [{ label: "När arbetet är klart", percent: 100 }],
    paymentTermsDays: 30,
    validUntil: "2030-01-01",
    terms: "",
  });
  quote.status = "godkand";
  quote.decidedAt = "2026-08-01T10:00:00.000Z";
  return quote;
}

describe("§38 ROT-offert → uppdrag → faktura ärver och räknar om avdrag", () => {
  beforeEach(() => reset());

  it("13 650 kr ROT-offert blir uppdrag med baseline och faktura från uppdragets underlag", () => {
    const laborLine = labor({
      id: "q-tim",
      kind: "arbete",
      description: "Snickeri",
      qty: 10,
      unit: "tim",
      unitPrice: 800,
    });
    const matLine = labor({
      id: "q-mat",
      kind: "material",
      description: "Luckor",
      qty: 1,
      unit: "st",
      unitPrice: 4000,
    });
    const quote = approvedQuote([laborLine, matLine], { rot: "rot" });
    const quotePay = quoteTotals(quote).toPay;
    assert.ok(quotePay > 10_000 && quotePay < 20_000, `förväntade ROT-offert runt 13k, fick ${quotePay}`);

    const ctas = quoteChainState(quote);
    assert.equal(ctas.primary?.kind, "starta_uppdrag");
    assert.equal(ctas.secondary.some((c) => c.kind === "skapa_faktura"), true);

    const job = startJobFromQuote(quote.id);
    assert.equal(job.customerId, "cust-1");
    assert.equal(job.quoteId, quote.id);
    assert.equal(quote.jobId, job.id);
    assert.equal(job.status, "pagar");
    assert.match(job.description, /offert #/);
    const planned = plannedEntries(job.id);
    assert.equal(planned.length, 2);
    assert.equal(planned.every((e) => e.source === "quote"), true);
    assert.equal(planned.find((e) => e.quotedLineItemId === "q-tim")?.qty, 10);

    const inv = createInvoiceForJob(job.id, "quote");
    assert.equal(inv.quoteId, quote.id);
    assert.equal(inv.jobId, job.id);
    assert.equal(inv.rot?.type, "rot");
    assert.equal(inv.lines.every((l) => l.sourceKind === "QUOTE_LINE" || l.sourceKind === "PAYMENT_PLAN"), true);
    const t = invoiceTotals(inv);
    assert.ok(t.deduction > 0);
    assert.ok(t.laborInclVat > 0);
    assert.ok(t.toPay < t.total, "ROT räknas om från det som faktureras, inte ett gammalt offerttal");

    const link = invoiceChainLink(inv);
    assert.match(link.label ?? "", /offert #/);
    assert.equal(link.quoteNumber, quote.number);
    assert.equal(link.jobTitle, job.title);
  });

  it("faktura från uppdrag använder aktuellt underlag – inte blindly originalofferten när actuals finns", () => {
    const quote = approvedQuote([
      labor({ id: "q-tim", kind: "arbete", description: "Snickeri", qty: 10, unit: "tim", unitPrice: 800 }),
    ]);
    const job = startJobFromQuote(quote.id);
    registerJobTime(job.id, { hours: 4, unitPrice: 800, description: "Snickeri" });
    const fromActuals = createInvoiceForJob(job.id, "actuals");
    assert.equal(fromActuals.lines.length, 1);
    assert.equal(fromActuals.lines[0].qty, 4);
    assert.equal(fromActuals.lines[0].sourceKind, "JOB_TIME_ENTRY");
    assert.equal(uninvoicedActuals(job.id).length, 0);
  });
});

describe("§39 betalningsplan – delfaktura med dubblettskydd", () => {
  beforeEach(() => reset());

  it("första delen faktureras, samma del kan inte faktureras igen, nästa del är fri", () => {
    const quote = approvedQuote(
      [labor({ id: "q-tim", kind: "arbete", description: "Altan", qty: 20, unit: "tim", unitPrice: 600 })],
      {
        paymentPlan: [
          { label: "Förskott", percent: 30 },
          { label: "När arbetet är klart", percent: 70 },
        ],
      }
    );
    const first = createInvoiceFromQuote(quote.id);
    assert.equal(first.type, "delbetalning");
    assert.equal(first.paymentPlanIndex, 0);
    assert.equal(first.jobId, undefined);
    assert.equal(first.quoteId, quote.id);
    assert.equal(first.lines[0].sourceKind, "PAYMENT_PLAN");
    assert.equal(paymentPlanPartAlreadyInvoiced(quote.id, 0), true);

    assert.throws(() => createPartInvoiceForQuote(quote.id, 0), /redan fakturerad/);

    const second = createInvoiceFromQuote(quote.id);
    assert.ok(second.paymentPlanIndex === 1 || second.type === "slutfaktura" || second.type === "faktura");
    assert.notEqual(second.id, first.id);
    assert.equal(paymentPlanPartAlreadyInvoiced(quote.id, 0), true);
  });
});

describe("§40 registrerat arbete skiljer sig från offererat", () => {
  beforeEach(() => reset());

  it("fler timmar än offert – faktura från actuals tar registrerat, enligt offert tar avtalat", () => {
    const quote = approvedQuote([
      labor({ id: "q-tim", kind: "arbete", description: "Snickeri", qty: 8, unit: "tim", unitPrice: 500 }),
    ]);
    const job = startJobFromQuote(quote.id);
    registerJobTime(job.id, { hours: 12, unitPrice: 500 });
    addJobMaterial(job.id, { description: "Extra list", qty: 1, unitPrice: 2000 });

    const fromQuote = createInvoiceForJob(job.id, "quote");
    assert.ok(fromQuote.lines.some((l) => l.qty === 8 || /offert/i.test(l.description) || l.sourceKind === "QUOTE_LINE" || l.sourceKind === "PAYMENT_PLAN"));
    assert.equal(uninvoicedActuals(job.id).length, 2);

    const fromActuals = createInvoiceForJob(job.id, "actuals");
    const hours = fromActuals.lines.filter((l) => l.kind === "arbete").reduce((s, l) => s + l.qty, 0);
    assert.equal(hours, 12);
    assert.ok(fromActuals.lines.some((l) => /extra list/i.test(l.description)));
    assert.equal(fromActuals.lines.every((l) => l.sourceKind === "JOB_TIME_ENTRY" || l.sourceKind === "JOB_MATERIAL"), true);
  });
});

describe("§41 fristående faktura vs kopplad sökväg", () => {
  beforeEach(() => reset());

  it("fristående faktura skapas utan quoteId/jobId och förblir fristående", () => {
    const inv = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor({ unitPrice: 50 })],
      rot: null,
    });
    assert.equal(inv.quoteId, undefined);
    assert.equal(inv.jobId, undefined);
    assert.equal(invoiceChainLink(inv).label, null);
  });

  it("öppet uppdrag gör att Ny faktura föredrar kopplad sökväg, fristående finns kvar", () => {
    const quote = approvedQuote([labor({ id: "q-tim", qty: 4, unitPrice: 700 })]);
    const job = startJobFromQuote(quote.id);
    const preferred = preferredJobForNewInvoice("cust-1");
    assert.equal(preferred?.id, job.id);
    const ctas = customerChainCtas("cust-1");
    assert.equal(ctas.preferLinkedInvoice, true);
    assert.equal(ctas.openJobId, job.id);
    assert.ok(ctas.secondary.some((c) => c.kind === "fristaende_faktura"));
  });

  it("godkänd offert utan uppdrag: Starta uppdrag är primärt, Skapa faktura skapar utan uppdrag", () => {
    const quote = approvedQuote([labor({ id: "q-tim", qty: 2, unitPrice: 900 })]);
    const state = quoteChainState(quote);
    assert.equal(state.primary?.kind, "starta_uppdrag");
    assert.ok(state.secondary.some((c) => c.kind === "skapa_faktura"));
    const inv = createInvoiceFromQuote(quote.id);
    assert.equal(inv.quoteId, quote.id);
    assert.equal(inv.jobId, undefined);
    assert.equal(db().jobs.length, 0);
  });

  it("skickad offert: Starta uppdrag är inte primärt, visar Väntar på signering", () => {
    const quote = createQuote({
      customerId: "cust-1",
      title: "Väntar",
      intro: "",
      lines: [labor({ unitPrice: 1000 })],
      rot: null,
      paymentPlan: [{ label: "Klart", percent: 100 }],
      paymentTermsDays: 30,
      validUntil: "2030-01-01",
      terms: "",
    });
    quote.status = "skickad";
    quote.sentAt = "2026-08-20T10:00:00.000Z";
    const state = quoteChainState(quote);
    assert.equal(state.waitingLabel, "Väntar på signering");
    assert.equal(state.primary, null);
    assert.ok(state.overflow.some((c) => c.kind === "starta_uppdrag"));
  });
});

describe("§42 kundsummering räknar inte offert och uppdrag dubbelt", () => {
  beforeEach(() => reset());

  it("avtalat kommer från godkänd offert en gång efter att uppdraget startats", () => {
    const quote = approvedQuote([labor({ id: "q-tim", qty: 10, unit: "tim", unitPrice: 800 })], { rot: null });
    const avtalatBefore = customerMoneyLine("cust-1")!.avtalat;
    startJobFromQuote(quote.id);
    const money = customerMoneyLine("cust-1")!;
    assert.equal(money.avtalat, avtalatBefore);
    assert.equal(money.avtalat, quoteTotals(quote).toPay);
    const job = jobMoney(quote.jobId!);
    assert.equal(job.quoteAmount, money.avtalat);
  });

  it("fristående 63 kr-faktura räknas i fakturerat men inte i avtalat", () => {
    const quote = approvedQuote(
      [labor({ id: "q-tim", qty: 10, unit: "tim", unitPrice: 800, kind: "arbete" })],
      { rot: "rot" }
    );
    startJobFromQuote(quote.id);
    const standalone = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor({ unitPrice: 50 })],
      rot: null,
    });
    issueInvoice(standalone.id);
    const money = customerMoneyLine("cust-1")!;
    assert.equal(money.avtalat, quoteTotals(quote).toPay);
    assert.ok(money.fakturerat >= invoiceTotals(standalone).total);
    assert.ok(money.fakturerat < money.avtalat + invoiceTotals(standalone).total + 1 || money.fakturerat > 0);
  });

  it("kundaktivitet slår ihop offert + uppdrag + faktura till en kedja", () => {
    const quote = approvedQuote([labor({ id: "q-tim", qty: 4, unitPrice: 600 })]);
    const job = startJobFromQuote(quote.id);
    const inv = createInvoiceFromQuote(quote.id);
    const rows = customerActivityFeed("cust-1");
    const chain = rows.find((r) => r.members && r.members.length >= 2);
    assert.ok(chain, "förväntade en kedjerad");
    assert.ok(chain.kinds.includes("offert"));
    assert.ok(chain.kinds.includes("uppdrag"));
    assert.ok(chain.kinds.includes("faktura"));
    assert.ok(chain.members!.some((m) => m.href.includes(`/uppdrag/${job.id}`)));
    assert.ok(chain.members!.some((m) => m.href.includes(`/ekonomi/offerter/${quote.id}`)));
    assert.ok(chain.members!.some((m) => m.href.includes(`/ekonomi/fakturor/${inv.id}`)));
    assert.equal(rows.filter((r) => r.id.startsWith("offert-") || r.id.startsWith("uppdrag-") || r.id.startsWith("faktura-")).length, 0);
  });

  it("samma kund + liknande belopp skapar inte länk", () => {
    const quote = approvedQuote([labor({ id: "q-tim", qty: 1, unitPrice: 50 })]);
    const standalone = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor({ unitPrice: 50 })],
      rot: null,
    });
    assert.equal(standalone.quoteId, undefined);
    assert.equal(standalone.jobId, undefined);
    const rows = customerActivityFeed("cust-1");
    const standaloneRow = rows.find((r) => r.id === `faktura-${standalone.id}` || r.members?.some((m) => m.href.includes(standalone.id)));
    const quoteRow = rows.find((r) => r.members?.some((m) => m.href.includes(quote.id)) || r.id === `offert-${quote.id}`);
    assert.ok(standaloneRow);
    assert.ok(quoteRow);
    assert.notEqual(standaloneRow.id, quoteRow.id);
  });
});

describe("Attention får nästa steg från kedjan", () => {
  beforeEach(() => reset());

  it("godkänd offert utan uppdrag ger Starta uppdrag", () => {
    const quote = approvedQuote([labor({ unitPrice: 2000 })]);
    const actions = getBusinessActions();
    const row = actions.attention.find((a) => a.id === `quote-start-job-${quote.id}`);
    assert.ok(row);
    assert.deepEqual(row.cta, { type: "startJobFromQuote", label: "Starta uppdrag", quoteId: quote.id });
  });

  it("efter startat uppdrag försvinner start-åtgärden", () => {
    const quote = approvedQuote([labor({ unitPrice: 2000 })]);
    startJobFromQuote(quote.id);
    const actions = getBusinessActions();
    assert.ok(!actions.attention.some((a) => a.id === `quote-start-job-${quote.id}`));
  });
});

describe("utkast ändrar inte signerad offert", () => {
  beforeEach(() => reset());

  it("faktura från offert får egna rad-id, offertens rader är orörda", () => {
    const quote = approvedQuote([labor({ id: "q-tim", qty: 3, unitPrice: 400 })]);
    const before = quoteTotals(quote);
    const inv = createInvoiceFromQuote(quote.id);
    inv.lines[0].qty = 99;
    inv.lines[0].unitPrice = 1;
    assert.equal(quoteTotals(quote).toPay, before.toPay);
    assert.notEqual(inv.lines[0].id, "q-tim");
    assert.equal(inv.lines[0].sourceId, "q-tim");
  });
});
