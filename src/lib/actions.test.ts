process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { buildSeed } from "./seed";
import { emptyTestDb, labor } from "./invoices/test-db";
import { getBusinessActions, QUOTE_FOLLOW_UP_DAYS } from "./services/actions";
import { controlsForAction, FALLBACK_ISSUE_LABEL, issueForAction } from "./services/action-issue";
import { snoozeAttention } from "./services/attention-state";
import { createJob, setJobStatus } from "./services/jobs";
import { createQuote, markQuoteNotRelevant, quoteDefaults } from "./services/quotes";
import {
  createDeniedReductionInvoice,
  createInvoice,
  createNextInvoiceForJob,
  creditInvoice,
  issueInvoice,
  markInvoicePaid,
} from "./services/invoices";
import { createTaxReductionUnderlag, setTaxReductionDecision } from "./services/tax-reduction";
import { getJob, invoiceTotals } from "./services/data";
import { isoDaysFromNow } from "./format";
import { calendarFiscalYear, quartersOf, todayDate, vatDueDate } from "./accounting/dates";
import { generateVatReport, markVatReportDeclared } from "./accounting/vat";
import type { Invoice } from "./types";

function reset() {
  replaceDb(buildSeed());
}

/** Utfärdar och "levererar" en faktura – annars räknas den som leveransmisslyckad. */
function issueAndDeliver(inv: Invoice): Invoice {
  const issued = issueInvoice(inv.id);
  issued.sentAt = issued.issuedAt;
  return issued;
}

function approveQuote(opts: {
  jobId: string;
  title: string;
  paymentPlan: { label: string; percent: number }[];
  rot?: "rot";
}) {
  const job = getJob(opts.jobId)!;
  const defaults = quoteDefaults();
  const quote = createQuote({
    customerId: job.customerId,
    jobId: job.id,
    title: opts.title,
    intro: opts.title,
    lines: [labor({ unitPrice: 10_000 })],
    rot: opts.rot ? { type: "rot" } : null,
    paymentPlan: opts.paymentPlan,
    paymentTermsDays: defaults.paymentTermsDays,
    validUntil: defaults.validUntil,
    terms: defaults.terms,
  });
  quote.status = "godkand";
  return quote;
}

describe("åtgärdsmotorn: fakturor", () => {
  it("försenad faktura → åtgärd med påminnelse-CTA och djuplänk; betald försvinner", () => {
    replaceDb(emptyTestDb());
    const inv = issueAndDeliver(
      createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({ unitPrice: 2_000 })], rot: null })
    );
    inv.dueDate = isoDaysFromNow(-7);

    const late = getBusinessActions().attention.find((a) => a.id === `invoice-late-${inv.id}`);
    assert.ok(late, "försenad faktura ska ligga i uppmärksamhetslistan");
    assert.equal(late.priority, "urgent");
    assert.equal(late.category, "invoice");
    assert.match(late.title, /7 dagar sen/);
    assert.equal(late.href, `/ekonomi/fakturor/${inv.id}`);
    assert.deepEqual(late.cta, { type: "remindInvoice", label: "Skicka påminnelse", invoiceId: inv.id });

    markInvoicePaid(inv.id, { matchedBy: "manuell" });
    const after = getBusinessActions();
    assert.ok(!after.attention.some((a) => a.category === "invoice"));
    assert.ok(!after.watching.some((o) => o.category === "invoice"));
  });

  it("kreditfaktura med passerat förfallodatum syns aldrig", () => {
    replaceDb(emptyTestDb());
    const inv = issueAndDeliver(
      createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({ unitPrice: 2_000 })], rot: null })
    );
    const credit = creditInvoice(inv.id);
    credit.dueDate = isoDaysFromNow(-30);
    const actions = getBusinessActions();
    assert.ok(!actions.attention.some((a) => a.category === "invoice"));
    assert.ok(!actions.watching.some((o) => o.category === "invoice"));
  });

  it("skickad och förfaller snart → På gång, inte åtgärd", () => {
    replaceDb(emptyTestDb());
    const inv = issueAndDeliver(
      createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({ unitPrice: 2_000 })], rot: null })
    );
    inv.dueDate = isoDaysFromNow(7);
    const actions = getBusinessActions();
    assert.ok(!actions.attention.some((a) => a.category === "invoice"));
    const watching = actions.watching.find((o) => o.id === `invoice-open-${inv.id}`);
    assert.ok(watching);
    assert.match(watching.subtitle, /förfaller/);
  });

  it("skickad faktura med förfall långt fram → dold (inte kalenderdump)", () => {
    replaceDb(emptyTestDb());
    const inv = issueAndDeliver(
      createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({ unitPrice: 2_000 })], rot: null })
    );
    inv.dueDate = isoDaysFromNow(30);
    const actions = getBusinessActions();
    assert.ok(!actions.attention.some((a) => a.id === `invoice-late-${inv.id}`));
    assert.ok(!actions.watching.some((o) => o.id === `invoice-open-${inv.id}`));
  });

  it("utfärdad men aldrig levererad → URGENT ”kunde inte skickas” med Skicka igen", () => {
    replaceDb(emptyTestDb());
    const inv = issueInvoice(
      createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({ unitPrice: 2_000 })], rot: null }).id
    );
    assert.equal(inv.sentAt, undefined);
    const actions = getBusinessActions();
    const failed = actions.attention.find((a) => a.id === `invoice-delivery-${inv.id}`);
    assert.ok(failed, "leveransmisslyckad faktura ska vara en åtgärd");
    assert.equal(failed.priority, "urgent");
    assert.match(failed.title, /kunde inte skickas/);
    // Explicit sändspråk ("Skicka igen") + bekräftelse före omskicket.
    assert.deepEqual(failed.cta, { type: "retryInvoiceEmail", label: "Skicka igen", invoiceId: inv.id });
    assert.ok(failed.confirm, "omskick är e-post → bekräftelseinnehåll krävs");
    // Inte dubblerad som försenad/pågående.
    assert.ok(!actions.attention.some((a) => a.id === `invoice-late-${inv.id}`));
    assert.ok(!actions.watching.some((o) => o.id === `invoice-open-${inv.id}`));
    // Leveransfel rankas först av allt.
    assert.equal(actions.attention[0].id, `invoice-delivery-${inv.id}`);
  });
});

describe("åtgärdsmotorn: offerter", () => {
  function sentQuote(opts: { daysAgo: number; validUntil?: string }) {
    const defaults = quoteDefaults();
    const quote = createQuote({
      customerId: "cust-1",
      title: "Altan",
      intro: "",
      lines: [labor({ unitPrice: 20_000 })],
      rot: null,
      paymentPlan: [],
      paymentTermsDays: defaults.paymentTermsDays,
      validUntil: opts.validUntil ?? defaults.validUntil,
      terms: defaults.terms,
    });
    quote.status = "skickad";
    quote.sentAt = isoDaysFromNow(-opts.daysAgo);
    return quote;
  }

  it("nyss skickad → På gång; efter tröskeln → Skicka påminnelse-åtgärd med bekräftelse", () => {
    replaceDb(emptyTestDb());
    const fresh = sentQuote({ daysAgo: 2 });
    let actions = getBusinessActions();
    assert.ok(actions.watching.some((o) => o.id === `quote-open-${fresh.id}`));
    assert.ok(!actions.attention.some((a) => a.category === "quote"));

    fresh.sentAt = isoDaysFromNow(-(QUOTE_FOLLOW_UP_DAYS + 1));
    actions = getBusinessActions();
    const wait = actions.attention.find((a) => a.id === `quote-wait-${fresh.id}`);
    assert.ok(wait, "offert över tröskeln ska bli en åtgärd");
    assert.match(wait.title, /har väntat i 8 dagar/);
    // Etiketten säger vad som händer (skickar e-post) – aldrig vaga "Följ upp".
    assert.deepEqual(wait.cta, { type: "followUpQuote", label: "Skicka påminnelse", quoteId: fresh.id });
    // Externa utskick kräver bekräftelseinnehåll från motorn.
    assert.ok(wait.confirm, "e-postutskick ska ha bekräftelsedialog");
    assert.equal(wait.confirm.confirmLabel, "Skicka påminnelse");
    assert.ok(!actions.watching.some((o) => o.id === `quote-open-${fresh.id}`));
  });

  it("utgången offert → åtgärd, aldrig både utgången och väntar", () => {
    replaceDb(emptyTestDb());
    const expired = sentQuote({ daysAgo: 40, validUntil: isoDaysFromNow(-2).slice(0, 10) });
    const actions = getBusinessActions();
    const item = actions.attention.find((a) => a.id === `quote-expired-${expired.id}`);
    assert.ok(item);
    assert.match(item.title, /har gått ut/);
    assert.ok(!actions.attention.some((a) => a.id === `quote-wait-${expired.id}`));
    assert.ok(!actions.watching.some((o) => o.category === "quote"));
  });

  it("utkast och godkända offerter ger inga globala åtgärder", () => {
    replaceDb(emptyTestDb());
    const defaults = quoteDefaults();
    const draft = createQuote({
      customerId: "cust-1",
      title: "Utkast",
      intro: "",
      lines: [labor()],
      rot: null,
      paymentPlan: [],
      paymentTermsDays: defaults.paymentTermsDays,
      validUntil: defaults.validUntil,
      terms: defaults.terms,
    });
    assert.equal(draft.status, "utkast");
    const actions = getBusinessActions();
    assert.ok(!actions.attention.some((a) => a.category === "quote"));
    assert.ok(!actions.watching.some((o) => o.category === "quote"));
  });
});

describe("åtgärdsmotorn: uppdrag och fakturering", () => {
  it("förskott enligt betalplan är fakturerbart direkt – klart uppdrag ger slutfaktura", () => {
    replaceDb(emptyTestDb());
    const job = createJob({ customerId: "cust-1", title: "Kök", startDate: "2030-09-01" });
    approveQuote({
      jobId: job.id,
      title: "Kök",
      paymentPlan: [
        { label: "Förskott", percent: 30 },
        { label: "När arbetet är klart och godkänt", percent: 70 },
      ],
    });

    let actions = getBusinessActions();
    const first = actions.attention.find((a) => a.id === `job-invoice-${job.id}`);
    assert.ok(first, "förskott ska kunna faktureras före start");
    assert.match(first.title, /kan faktureras/);
    assert.match(first.subtitle, /30 % förskott/);
    assert.deepEqual(first.cta, { type: "createJobInvoice", label: "Skapa faktura", jobId: job.id });

    // Fakturera förskottet och gör klart uppdraget → slutfaktura för resten.
    issueAndDeliver(createNextInvoiceForJob(job.id));
    setJobStatus(job.id, "klart");
    actions = getBusinessActions();
    const final = actions.attention.find((a) => a.id === `job-final-${job.id}`);
    assert.ok(final, "klart uppdrag med kvar att fakturera ska ge slutfaktura-åtgärd");
    assert.match(final.title, /kvar att fakturera/);
    assert.deepEqual(final.cta, { type: "createJobInvoice", label: "Skapa slutfaktura", jobId: job.id });

    // Fullt fakturerat → inget kvar.
    issueAndDeliver(createNextInvoiceForJob(job.id));
    actions = getBusinessActions();
    assert.ok(!actions.attention.some((a) => a.category === "job"));
  });

  it("”vid arbetets start”-del är inte fakturerbar före start – uppdraget syns som På gång nära start", () => {
    replaceDb(emptyTestDb());
    const start = isoDaysFromNow(4).slice(0, 10);
    const job = createJob({ customerId: "cust-1", title: "Altan", startDate: start });
    approveQuote({
      jobId: job.id,
      title: "Altan",
      paymentPlan: [
        { label: "Vid arbetets start", percent: 50 },
        { label: "När arbetet är klart och godkänt", percent: 50 },
      ],
    });
    const actions = getBusinessActions();
    assert.ok(!actions.attention.some((a) => a.category === "job"), "inget att fakturera före start");
    const watching = actions.watching.find((u) => u.id === `job-start-${job.id}`);
    assert.ok(watching, "planerat uppdrag nära start ska ligga under På gång");
    assert.equal(watching.date, start);
  });

  it("uppdrag som startar om flera månader syns inte på Hem", () => {
    replaceDb(emptyTestDb());
    const job = createJob({ customerId: "cust-1", title: "Altan", startDate: "2030-06-01" });
    approveQuote({
      jobId: job.id,
      title: "Altan",
      paymentPlan: [
        { label: "Vid arbetets start", percent: 50 },
        { label: "När arbetet är klart och godkänt", percent: 50 },
      ],
    });
    const actions = getBusinessActions();
    assert.ok(!actions.watching.some((u) => u.id === `job-start-${job.id}`));
    assert.ok(!actions.attention.some((a) => a.category === "job"));
  });
});

describe("åtgärdsmotorn: ROT/RUT", () => {
  function paidRotJob() {
    reset();
    const job = getJob("job-kok")!;
    job.housing = { dwellingType: "smahus", propertyDesignation: "Södermalm 12:34" };
    const inv = createInvoice({
      customerId: "cust-anna",
      jobId: "job-kok",
      type: "faktura",
      lines: [labor({ unitPrice: 8_000 })],
      rot: { type: "rot" },
    });
    issueAndDeliver(inv);
    markInvoicePaid(inv.id, { matchedBy: "manuell" });
    setJobStatus("job-kok", "klart");
    return { job, inv };
  }

  it("kund betalat + arbete klart + uppgifter kompletta → ”redo att ansökas” med belopp", () => {
    const { inv } = paidRotJob();
    const deduction = invoiceTotals(db().invoices.find((i) => i.id === inv.id)!).deduction;
    assert.ok(deduction > 0);
    const item = getBusinessActions().attention.find((a) => a.id === "rot-ready-job-kok");
    assert.ok(item, "ROT ska vara redo att ansökas");
    assert.equal(item.category, "rot");
    assert.match(item.title, new RegExp(`ROT är redo att ansökas`));
    assert.equal(item.amount, deduction);
    assert.equal(item.href, "/uppdrag/job-kok");
  });

  it("inskickat underlag → På gång ”väntar på Skatteverket”, inte en åtgärd", () => {
    paidRotJob();
    createTaxReductionUnderlag({ jobId: "job-kok" });
    const actions = getBusinessActions();
    assert.ok(!actions.attention.some((a) => a.category === "rot"));
    const watching = actions.watching.find((o) => o.id === "rot-submitted-job-kok");
    assert.ok(watching);
    assert.match(watching.title, /väntar på Skatteverket/);
  });

  it("delvis godkänt → ”fakturera kunden”-åtgärd som försvinner när restfakturan skapats", () => {
    const { inv } = paidRotJob();
    createTaxReductionUnderlag({ jobId: "job-kok" });
    setTaxReductionDecision({ jobId: "job-kok", outcome: "delvis_godkant", deniedAmount: 1_000 });

    let actions = getBusinessActions();
    const denied = actions.attention.find((a) => a.id === "rot-denied-job-kok");
    assert.ok(denied, "delvis godkänt beslut ska bli en åtgärd");
    assert.match(denied.title, /Skatteverket godkände/);
    assert.equal(denied.amount, 1_000);

    createDeniedReductionInvoice(inv.id, 1_000);
    actions = getBusinessActions();
    assert.ok(!actions.attention.some((a) => a.id === "rot-denied-job-kok"), "restfaktura skapad → åtgärden borta");
  });

  it("obetald ROT-faktura → På gång ”väntar på kundens betalning”", () => {
    reset();
    const job = getJob("job-kok")!;
    job.housing = { dwellingType: "smahus", propertyDesignation: "Södermalm 12:34" };
    createInvoice({
      customerId: "cust-anna",
      jobId: "job-kok",
      type: "faktura",
      lines: [labor({ unitPrice: 8_000 })],
      rot: { type: "rot" },
    });
    issueAndDeliver(db().invoices[db().invoices.length - 1]);
    const watching = getBusinessActions().watching.find((o) => o.id === "rot-wait-pay-job-kok");
    assert.ok(watching);
    assert.match(watching.title, /väntar på kundens betalning/);
  });
});

describe("åtgärdsmotorn: bokföring och bank", () => {
  it("kvitto saknas och bokföringsfråga → accounting-åtgärder med rätt CTA och ordning", () => {
    replaceDb(emptyTestDb());
    db().expenses.push(
      {
        id: "exp-receipt",
        supplier: "Bauhaus",
        date: isoDaysFromNow(-3),
        amount: 875,
        vatAmount: 175,
        status: "saknar_kvitto",
        createdAt: isoDaysFromNow(-3),
      },
      {
        id: "exp-question",
        supplier: "Grand Hôtel",
        date: isoDaysFromNow(-2),
        amount: 1_240,
        vatAmount: 133,
        status: "behover_svar",
        question: { text: "Vad gällde middagen?", options: ["Kundmöte", "Privat"] },
        createdAt: isoDaysFromNow(-2),
      }
    );
    const attention = getBusinessActions().attention;
    const question = attention.find((a) => a.id === "question-exp-question");
    const receipt = attention.find((a) => a.id === "receipt-exp-receipt");
    assert.ok(question && receipt);
    assert.equal(question.category, "accounting");
    assert.deepEqual(question.cta, { type: "answerQuestion", expenseId: "exp-question", options: ["Kundmöte", "Privat"] });
    assert.match(receipt.title, /Kvitto saknas/);
    assert.deepEqual(receipt.cta, { type: "uploadReceipt", label: "Lägg till kvitto", expenseId: "exp-receipt" });
    // Frågor är viktigare än saknade kvitton; kvitton ligger sist.
    assert.ok(attention.indexOf(question) < attention.indexOf(receipt));
    assert.equal(attention[attention.length - 1].id, "receipt-exp-receipt");
  });

  it("omatchad inbetalning → accounting-åtgärd mot bankfliken; täckt av utgift → ingen dubblett", () => {
    replaceDb(emptyTestDb());
    db().bankAccounts.push({
      id: "acc-1",
      provider: "mock",
      name: "Företagskonto",
      accountNumber: "1234-5678",
      balance: 2_500,
      connectedAt: new Date().toISOString(),
    });
    db().bankTransactions.push({
      id: "tx-1",
      accountId: "acc-1",
      date: isoDaysFromNow(-1),
      amount: 2_500,
      counterpart: "Okänd Betalare",
      description: "Inbetalning",
      status: "behover_atgard",
    });
    let attention = getBusinessActions().attention;
    const bank = attention.find((a) => a.id === "bank-tx-1");
    assert.ok(bank, "omatchad inbetalning ska vara en åtgärd");
    assert.equal(bank.category, "accounting");
    assert.match(bank.title, /kunde inte matchas/);
    // Djuplänk rakt till transaktionen – inte en generisk banklista.
    assert.equal(bank.href, "/ekonomi?flik=bank&atgard=bank-tx-1");
    // Omatchad inbetalning utan säkert förslag → "Matcha betalning"-CTA.
    assert.deepEqual(bank.cta, { type: "pickPaymentMatch", txId: "tx-1" });
    assert.ok(!attention.some((a) => a.id === "bank-unexplained"), "banksaldot förklaras av transaktionen");

    // Om transaktionen redan täcks av en öppen utgiftsfråga visas bara utgiften.
    db().expenses.push({
      id: "exp-tx",
      supplier: "Okänd Betalare",
      date: isoDaysFromNow(-1),
      amount: 2_500,
      vatAmount: 500,
      status: "behover_svar",
      question: { text: "Vad gällde köpet?", options: ["Material"] },
      bankTransactionId: "tx-1",
      createdAt: isoDaysFromNow(-1),
    });
    attention = getBusinessActions().attention;
    assert.ok(!attention.some((a) => a.id === "bank-tx-1"));
    assert.ok(attention.some((a) => a.id === "question-exp-tx"));
  });

  it("förfallen komplett faktura → Skicka till bank; förfaller om 6 dagar → bara Inbox", () => {
    replaceDb(emptyTestDb());
    db().supplierInvoices.push(
      {
        id: "sup-late",
        supplier: "Beijer Bygg",
        invoiceNumber: "F-1",
        date: isoDaysFromNow(-30),
        dueDate: isoDaysFromNow(-2),
        amount: 4_000,
        vatAmount: 800,
        description: "Material",
        category: "material",
        status: "obetald",
        accountingStatus: "bokford",
        bankgiro: "5123-4567",
        recipientAccount: "5123-4567",
        createdAt: isoDaysFromNow(-30),
      },
      {
        id: "sup-future",
        supplier: "Telia",
        invoiceNumber: "F-2",
        date: isoDaysFromNow(-5),
        dueDate: isoDaysFromNow(6),
        amount: 259,
        vatAmount: 52,
        description: "Mobil",
        category: "telefon",
        status: "obetald",
        accountingStatus: "bokford",
        bankgiro: "991-2345",
        recipientAccount: "991-2345",
        createdAt: isoDaysFromNow(-5),
      }
    );
    const actions = getBusinessActions();
    const late = actions.attention.find((a) => a.id === "supplier-sup-late");
    assert.ok(late);
    assert.equal(late.cta?.type, "paySupplier");
    if (late.cta?.type === "paySupplier") assert.equal(late.cta.label, "Skicka till bank");
    assert.ok(!actions.attention.some((a) => a.id === "supplier-sup-future"));
    assert.ok(!actions.watching.some((u) => u.id === "supplier-due-sup-future"));
  });
});

describe("åtgärdsmotorn: moms", () => {
  /** Kvartalet som innehåller dagens datum + dess deklarationsdatum. */
  function currentQuarter() {
    const today = todayDate();
    const year = Number(today.slice(0, 4));
    const period = quartersOf(calendarFiscalYear(year)).find((p) => p.start <= today && today <= p.end)!;
    return { period, due: vatDueDate(period) };
  }

  function isoAt(date: string): Date {
    return new Date(`${date}T10:00:00Z`);
  }

  function shiftDays(date: string, days: number): string {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  it("pågående period → Kommande; nära deadline → åtgärd; mycket nära → urgent; deklarerad → borta", () => {
    replaceDb(emptyTestDb());
    // En utfärdad faktura idag ger utgående moms i innevarande kvartal.
    issueAndDeliver(
      createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({ unitPrice: 10_000 })], rot: null })
    );
    const { period, due } = currentQuarter();

    // Mitt i perioden (deadline flera månader bort): dold – inte kalenderdump.
    let actions = getBusinessActions(isoAt(todayDate()));
    assert.ok(!actions.attention.some((a) => a.category === "vat"));
    const midDueDays = Math.round(
      (Date.parse(`${due}T12:00:00Z`) - Date.parse(`${todayDate()}T12:00:00Z`)) / 86_400_000
    );
    if (midDueDays > 45) {
      assert.ok(!actions.watching.some((u) => u.id === `vat-${period.key}`), "moms långt bort ska inte synas");
    }

    // 20 dagar före deklarationsdatum: På gång, inte åtgärd.
    actions = getBusinessActions(isoAt(shiftDays(due, -20)));
    assert.ok(!actions.attention.some((a) => a.category === "vat"));
    const watching = actions.watching.find((u) => u.id === `vat-${period.key}`);
    assert.ok(watching, "moms inom 45 dagar ska synas under På gång");
    assert.equal(watching.date, due);

    // 10 dagar före: åtgärd, men inte urgent.
    actions = getBusinessActions(isoAt(shiftDays(due, -10)));
    let vat = actions.attention.find((a) => a.category === "vat");
    assert.ok(vat, "moms inom 14 dagar ska vara en åtgärd");
    assert.equal(vat.priority, "action");
    assert.match(vat.title, /Moms ska deklareras/);
    assert.equal(vat.href, "/bokforing/moms");
    assert.ok(!actions.watching.some((u) => u.id === `vat-${period.key}`), "inte både åtgärd och På gång");

    // 1 dag före: urgent.
    actions = getBusinessActions(isoAt(shiftDays(due, -1)));
    vat = actions.attention.find((a) => a.category === "vat");
    assert.ok(vat);
    assert.equal(vat.priority, "urgent");

    // Efter deadline: urgent med ”skulle ha deklarerats”.
    actions = getBusinessActions(isoAt(shiftDays(due, 5)));
    vat = actions.attention.find((a) => a.category === "vat");
    assert.ok(vat);
    assert.equal(vat.priority, "urgent");
    assert.match(vat.title, /skulle ha deklarerats/);

    // H4-vakt: perioden pågår fortfarande (riktig kalendertid) – deklaration
    // ska avvisas på servern så att en pågående period aldrig kan låsas.
    const report = generateVatReport(period.key);
    assert.throws(() => markVatReportDeclared(report.id, "anvandare"), /pågår fortfarande/);

    // Deklarerad (simulerat – som efter periodens slut): försvinner helt.
    report.status = "deklarerad";
    report.declaredAt = new Date().toISOString();
    actions = getBusinessActions(isoAt(shiftDays(due, 5)));
    assert.ok(!actions.attention.some((a) => a.category === "vat"));
    assert.ok(!actions.watching.some((u) => u.id === `vat-${period.key}`));
  });

  it("utan momsaktivitet finns ingen momsrad", () => {
    replaceDb(emptyTestDb());
    const actions = getBusinessActions();
    assert.ok(!actions.attention.some((a) => a.category === "vat"));
    assert.ok(!actions.watching.some((u) => u.category === "vat"));
  });
});

describe("åtgärdsmotorn: helhet", () => {
  it("tomt företag → noll åtgärder, noll på gång", () => {
    replaceDb(emptyTestDb());
    const actions = getBusinessActions();
    assert.deepEqual(actions.attention, []);
    assert.deepEqual(actions.watching, []);
  });

  it("demodata: prioritetsordning håller och alla åtgärder har djuplänk + unika id:n", () => {
    reset();
    const actions = getBusinessActions();
    assert.ok(actions.attention.length > 0);

    // Passerad momsdeadline (lagkrav, förseningsavgifter) allra först – före
    // försenade kundfakturor. (Ingen leveransmisslyckad faktura i demodata.)
    assert.ok(actions.attention[0].id.startsWith("vat-"));
    assert.match(actions.attention[0].title, /skulle ha deklarerats/);
    assert.ok(actions.attention[1].id.startsWith("invoice-late-"));

    // Urgent ligger alltid före vanliga åtgärder.
    const firstAction = actions.attention.findIndex((a) => a.priority === "action");
    if (firstAction >= 0) {
      assert.ok(
        actions.attention.slice(firstAction).every((a) => a.priority === "action"),
        "urgent får inte komma efter en vanlig åtgärd"
      );
    }

    const idx = (prefix: string) => actions.attention.findIndex((a) => a.id.startsWith(prefix));
    const question = idx("question-");
    const newJob = idx("job-new-");
    const receipt = idx("receipt-");
    assert.ok(question >= 0 && newJob >= 0 && receipt >= 0);
    assert.ok(question < newJob && newJob < receipt);

    // Alla djuplänkar pekar någonstans och id:n är unika.
    for (const a of actions.attention) assert.ok(a.href.startsWith("/"), `${a.id} saknar djuplänk`);
    const ids = new Set(actions.attention.map((a) => a.id));
    assert.equal(ids.size, actions.attention.length);

    // På gång: skickade offerter väntar på BankID.
    assert.ok(actions.watching.some((o) => o.category === "quote" && /BankID/.test(o.subtitle)));

    // På gång är sorterad kronologiskt och aldrig dubblerad mot Attention.
    const dates = actions.watching.map((u) => u.date);
    assert.deepEqual(dates, [...dates].sort());
    const attentionIds = new Set(actions.attention.map((a) => a.id));
    assert.ok(actions.watching.every((w) => !attentionIds.has(w.id)));
    for (const w of actions.watching) assert.ok(w.href.startsWith("/"), `${w.id} saknar djuplänk`);
  });
});

describe("åtgärdsmotorn: rankning, snooze och kontrolldeklaration", () => {
  function currentQuarter() {
    const today = todayDate();
    const year = Number(today.slice(0, 4));
    const period = quartersOf(calendarFiscalYear(year)).find((p) => p.start <= today && today <= p.end)!;
    return { period, due: vatDueDate(period) };
  }

  function isoAt(date: string): Date {
    return new Date(`${date}T10:00:00Z`);
  }

  function shiftDays(date: string, days: number): string {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  it("försenad momsdeklaration rankas över försenade kundfakturor", () => {
    replaceDb(emptyTestDb());
    const inv = issueAndDeliver(
      createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({ unitPrice: 10_000 })], rot: null })
    );
    inv.dueDate = isoDaysFromNow(-7); // verkligt försenad (isOverdue räknar mot idag)
    const { due } = currentQuarter();

    // Efter deklarationsdatumet: momsen är FÖRSENAD – inte bara "urgent snart".
    const attention = getBusinessActions(isoAt(shiftDays(due, 5))).attention;
    const vatIdx = attention.findIndex((a) => a.category === "vat");
    const lateIdx = attention.findIndex((a) => a.id === `invoice-late-${inv.id}`);
    assert.ok(vatIdx >= 0, "försenad moms ska vara en åtgärd");
    assert.ok(lateIdx >= 0, "försenad faktura ska vara en åtgärd");
    assert.match(attention[vatIdx].title, /skulle ha deklarerats/);
    assert.ok(vatIdx < lateIdx, "passerad momsdeadline ska ligga över försenad kundfaktura");

    // Före deadline (bara nära): fakturan vinner fortfarande.
    const before = getBusinessActions(isoAt(shiftDays(due, -1))).attention;
    const vatBefore = before.findIndex((a) => a.category === "vat");
    const lateBefore = before.findIndex((a) => a.id === `invoice-late-${inv.id}`);
    assert.ok(vatBefore >= 0 && lateBefore >= 0);
    assert.ok(lateBefore < vatBefore, "kommande moms ska inte gå om försenade fakturor");
  });

  it("snoozad rad döljs ur listan och räknaren; återvänder när tiden passerat om saken kvarstår", () => {
    replaceDb(emptyTestDb());
    const inv = issueAndDeliver(
      createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({ unitPrice: 2_000 })], rot: null })
    );
    inv.dueDate = isoDaysFromNow(-7);
    const actionId = `invoice-late-${inv.id}`;
    const now = new Date();

    assert.ok(getBusinessActions(now).attention.some((a) => a.id === actionId));
    const countBefore = getBusinessActions(now).attention.length;

    snoozeAttention(actionId, "imorgon", now);
    const after = getBusinessActions(now).attention;
    assert.ok(!after.some((a) => a.id === actionId), "snoozad rad ska vara dold");
    assert.equal(after.length, countBefore - 1, "räknaren (listlängden) ska minska");
    // Domänstatus är orörd – fakturan är fortfarande försenad.
    assert.ok(db().invoices.some((i) => i.id === inv.id && i.status === "skickad"));

    // Registret ser fortfarande raden (includeSnoozed) – snooze döljer uppmärksamhet, aldrig fakta.
    assert.ok(getBusinessActions(now, { includeSnoozed: true }).attention.some((a) => a.id === actionId));

    // Efter tidpunkten: raden är automatiskt tillbaka (saken kvarstår).
    const later = new Date(now.getTime() + 3 * 86_400_000);
    assert.ok(getBusinessActions(later).attention.some((a) => a.id === actionId));

    // Betald under snoozen → borta av rätt skäl när snoozen löper ut.
    markInvoicePaid(inv.id, { matchedBy: "manuell" });
    assert.ok(!getBusinessActions(later).attention.some((a) => a.id === actionId));
  });

  it("inkommande uppdrag utan offert syns på Hem och försvinner när offert kopplas", () => {
    replaceDb(emptyTestDb());
    const job = createJob({
      customerId: "cust-1",
      title: "Måla staket",
      description: "Hej, kan ni måla vårt staket?",
      source: "web_form",
      originalMessage: "Hej, kan ni måla vårt staket?",
    });
    assert.ok(getBusinessActions().attention.some((a) => a.id === `job-new-${job.id}`));

    const defaults = quoteDefaults();
    createQuote({
      customerId: "cust-1",
      jobId: job.id,
      title: job.title,
      intro: job.description,
      lines: [labor({ unitPrice: 8000 })],
      rot: null,
      paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
      paymentTermsDays: defaults.paymentTermsDays,
      validUntil: defaults.validUntil,
      terms: defaults.terms,
    });
    assert.ok(!getBusinessActions().attention.some((a) => a.id === `job-new-${job.id}`));
    assert.ok(db().jobs.some((j) => j.id === job.id), "uppdraget ligger kvar");
  });

  it("Inte aktuell är en domänövergång: offerten blir avböjd med skäl och lämnar listan", () => {
    replaceDb(emptyTestDb());
    const defaults = quoteDefaults();
    const quote = createQuote({
      customerId: "cust-1",
      title: "Altan",
      intro: "",
      lines: [labor({ unitPrice: 20_000 })],
      rot: null,
      paymentPlan: [],
      paymentTermsDays: defaults.paymentTermsDays,
      validUntil: defaults.validUntil,
      terms: defaults.terms,
    });
    quote.status = "skickad";
    quote.sentAt = isoDaysFromNow(-(QUOTE_FOLLOW_UP_DAYS + 1));
    assert.ok(getBusinessActions().attention.some((a) => a.id === `quote-wait-${quote.id}`));

    markQuoteNotRelevant(quote.id);
    assert.equal(quote.status, "avbojd");
    assert.equal(quote.declineReason, "Inte längre aktuell");
    assert.ok(quote.decidedAt);
    assert.ok(!getBusinessActions().attention.some((a) => a.category === "quote"));

    // Bara skickade offerter kan markeras – dubbelkörning avvisas begripligt.
    assert.throws(() => markQuoteNotRelevant(quote.id), /Bara skickade offerter/);
  });

  it("kontrolldeklarationen: finansiella sanningar kan aldrig avfärdas permanent", () => {
    const overdue = controlsForAction({ id: "invoice-late-inv-1" });
    assert.equal(overdue.canDismiss, false, "förfallen fordran får aldrig döljas för alltid");
    assert.equal(overdue.canSnooze, true);
    assert.equal(overdue.requiresConfirmation, true, "påminnelse är e-post → bekräftelse");

    assert.equal(controlsForAction({ id: "receipt-exp-1" }).canDismiss, false, "saknat kvitto: ingen dölj-flagga");
    assert.equal(controlsForAction({ id: "bank-unexplained" }).canSnooze, false, "bankdifferens ska aldrig tystas");

    const newJob = controlsForAction({ id: "job-new-job-1" });
    assert.equal(newJob.canDismiss, false);
    assert.equal(newJob.dismissBehavior, "none");
    const quote = controlsForAction({ id: "quote-wait-q-1" });
    assert.equal(quote.dismissBehavior, "MARK_NOT_RELEVANT");
    assert.equal(quote.dismissLabel, "Inte aktuell");
    const reminder = controlsForAction({ id: "reminder-rem-1" });
    assert.equal(reminder.dismissBehavior, "DISMISS_REMINDER");
    assert.equal(reminder.dismissLabel, "Ta bort");
  });

  it("demodata: varje rad har känd typ, konkret etikett och bekräftelse där deklarationen kräver det", () => {
    reset();
    const attention = getBusinessActions().attention;
    assert.ok(attention.length > 0);
    for (const a of attention) {
      const controls = controlsForAction(a);
      assert.notEqual(controls.kind, "unknown", `${a.id} saknar typ i kontrolldeklarationen`);
      assert.notEqual(issueForAction(a), FALLBACK_ISSUE_LABEL, `${a.id} har bara en generisk etikett`);
      if (controls.requiresConfirmation) {
        assert.ok(a.confirm, `${a.id} skickar externt/bokför pengar men saknar bekräftelseinnehåll`);
      }
      // Vaga verb är bannlysta i primärknappen när motorn vet mer.
      if (a.cta && "label" in a.cta) {
        assert.doesNotMatch(a.cta.label, /^(Hantera|Följ upp|Åtgärda)$/, `${a.id} har vag CTA-etikett`);
      }
    }
  });
});
