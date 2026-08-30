process.env.DRIVA_TEST = "1";

/**
 * Integrationstester för de kritiska affärsflödena, hela vägen genom
 * domäntjänsterna (aldrig direkta store-mutationer där tjänster finns):
 *
 *   Webbformulär → Uppdrag → Offert → BankID → Faktura → Betalning → Bokföring
 *   ROT-faktura → nekat avdrag → restfaktura (omflytt 1513→1510, ingen ny moms)
 *   Delbetalningar ärver offertens momssats (inte alltid 25 %)
 *
 * Efter varje flöde kontrolleras de finansiella invarianterna:
 *   – varje verifikation balanserar, huvudboken är hel (ledgerIntegrity)
 *   – bankkontots saldo = huvudbokens 1930
 *   – kundens utestående = obetalda utfärdade fakturor
 *   – uppdragets kvar-att-fakturera stämmer med offerten
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb, labor } from "./invoices/test-db";
import { submitContactForm } from "./services/website";
import { updateCustomer } from "./services/customers";
import { createQuote, quoteDefaults, sendQuote } from "./services/quotes";
import { bankidProvider } from "./services/bankid";
import { currentVersion, customerSummary, getInvoice, getQuote, invoiceTotals, quoteTotals } from "./services/data";
import {
  createDeniedReductionInvoice,
  createInvoice,
  createNextInvoiceForJob,
  creditInvoice,
  issueInvoice,
} from "./services/invoices";
import { simulateIncomingPayment } from "./services/banking";
import { jobMoneySummary, remainingToInvoiceForJob } from "./services/attention";
import { accountBalance, ledgerIntegrity, saldobalans } from "./accounting/ledger";
import type { BankAccount, DocLine, Verification } from "./types";

function reset() {
  replaceDb(
    emptyTestDb({
      bankAccounts: [
        {
          id: "acc-1",
          provider: "mock",
          name: "Företagskonto",
          accountNumber: "1234-5678",
          balance: 0,
          connectedAt: new Date().toISOString(),
        } satisfies BankAccount,
      ],
    })
  );
}

/** Invarianter som ska hålla efter varje genomfört flöde. */
function assertBooksConsistent() {
  const integrity = ledgerIntegrity();
  assert.ok(integrity.balanced, `obalanserade verifikationer: ${integrity.unbalancedVerifications.join(", ")}`);
  for (const ver of db().verifications) {
    const debit = ver.entries.reduce((s, e) => s + e.debit, 0);
    const credit = ver.entries.reduce((s, e) => s + e.credit, 0);
    assert.equal(debit, credit, `verifikation ${ver.series}${ver.number} balanserar inte`);
  }
  const sb = saldobalans();
  assert.equal(sb.sumDebit, sb.sumCredit, "saldobalansen balanserar inte");
  const bankBook = db().bankAccounts.reduce((s, a) => s + a.balance, 0);
  assert.equal(bankBook, accountBalance(1930), "bankens saldo matchar inte huvudbokens 1930");
}

function approveQuoteViaBankID(quoteId: string) {
  const quote = getQuote(quoteId);
  assert.ok(quote);
  const order = bankidProvider.startSign({
    quoteId: quote.id,
    quoteVersionId: currentVersion(quote).id,
    method: "qr",
  });
  bankidProvider.advance(order.orderRef, "complete");
  return order;
}

describe("Golden path: webbformulär → uppdrag → offert → BankID → faktura → betalning", () => {
  beforeEach(() => reset());

  it("hela kedjan går igenom och böckerna stämmer i varje steg", async () => {
    // 1. Kunden skickar ett meddelande via publika hemsidan → uppdrag.
    const submitted = await submitContactForm({
      name: "Nya Kunden AB",
      email: "kontakt@nyakunden.se",
      phone: "070-111 22 33",
      message: "Vi behöver hjälp med en altan på 30 kvm.",
    });
    assert.ok(!("skipped" in submitted), "honeypot ska inte trigga för riktiga meddelanden");
    const incoming = submitted;
    assert.ok(incoming.created);
    const job = db().jobs.find((j) => j.id === incoming.jobId);
    assert.ok(job, "uppdraget sparades");
    assert.equal(job.customerId, incoming.customerId);
    assert.equal(job.source, "web_form");
    assert.equal(job.originalMessage, "Vi behöver hjälp med en altan på 30 kvm.");

    // Kunden från formuläret saknar adress – fakturering kräver den (spärr med
    // vägledning i UI). Företagaren kompletterar kundkortet.
    updateCustomer(incoming.customerId, {
      address: "Nybyggarvägen 1",
      postalCode: "123 45",
      city: "Stockholm",
    });

    // 2. Företagaren skapar och skickar en offert mot uppdraget.
    const defaults = quoteDefaults();
    const quote = createQuote({
      customerId: incoming.customerId,
      jobId: incoming.jobId,
      title: "Altanbygge",
      intro: "Enligt vårt samtal.",
      lines: [labor({ unitPrice: 40_000 })],
      rot: null,
      paymentPlan: [
        { label: "Vid start", percent: 40 },
        { label: "När arbetet är klart", percent: 60 },
      ],
      paymentTermsDays: defaults.paymentTermsDays,
      validUntil: defaults.validUntil,
      terms: "Standardvillkor",
    });
    sendQuote(quote.id);
    assert.equal(getQuote(quote.id)!.status, "skickad");

    // 3. Kunden godkänner med BankID (mock) – uppdraget skapas automatiskt.
    approveQuoteViaBankID(quote.id);
    const approved = getQuote(quote.id)!;
    assert.equal(approved.status, "godkand");
    assert.ok(currentVersion(approved).lockedAt, "versionen låstes vid signering");
    const approvedJob = db().jobs.find((j) => j.quoteId === quote.id);
    assert.ok(approvedJob, "uppdrag skapades av godkännandet");
    const total = quoteTotals(approved).total; // 40 000 + 25 % moms = 50 000
    assert.equal(total, 50_000);
    assert.equal(remainingToInvoiceForJob(approvedJob.id), total);

    // 4. Delbetalning 1 (40 %) → utfärda → kunden betalar (simulerad bankhändelse).
    const part1 = createNextInvoiceForJob(approvedJob.id);
    assert.equal(part1.type, "delbetalning");
    assert.equal(part1.number, null, "utkast har inget nummer");
    issueInvoice(part1.id);
    const issued1 = getInvoice(part1.id)!;
    assert.ok(issued1.number != null, "utfärdande gav löpnummer");
    assert.equal(invoiceTotals(issued1).total, 20_000);
    assertBooksConsistent();

    simulateIncomingPayment(part1.id);
    assert.equal(getInvoice(part1.id)!.status, "betald");
    assert.equal(db().payments.length, 1);
    assertBooksConsistent();

    // 5. Slutfaktura (resterande 60 %) → betala → allt klart.
    const final = createNextInvoiceForJob(approvedJob.id);
    assert.equal(final.type, "slutfaktura");
    issueInvoice(final.id);
    assert.equal(invoiceTotals(getInvoice(final.id)!).total, 30_000);
    simulateIncomingPayment(final.id);

    assert.equal(remainingToInvoiceForJob(approvedJob.id), 0);
    const money = jobMoneySummary(approvedJob.id);
    assert.equal(money.invoiced, total);
    assert.equal(money.paid, total);
    assert.equal(customerSummary(incoming.customerId).unpaid, 0);
    assertBooksConsistent();

    // Intäkten är bokförd exakt en gång: 3001 kredit 40 000.
    assert.equal(accountBalance(3001), -40_000);
    // Utgående moms 25 %: 10 000.
    assert.equal(accountBalance(2611), -10_000);
    // Banken har fått hela beloppet.
    assert.equal(accountBalance(1930), 50_000);
    // Kundfordran är nollad.
    assert.equal(accountBalance(1510), 0);
  });

  it("dubbelklick på BankID-slutförande skapar inte dubbla uppdrag eller signaturer", () => {
    const defaults = quoteDefaults();
    const quote = createQuote({
      customerId: "cust-1",
      title: "Test",
      intro: "",
      lines: [labor()],
      rot: null,
      paymentPlan: [],
      paymentTermsDays: defaults.paymentTermsDays,
      validUntil: defaults.validUntil,
      terms: "",
    });
    sendQuote(quote.id);
    const order = approveQuoteViaBankID(quote.id);
    bankidProvider.advance(order.orderRef, "complete"); // andra klicket
    assert.equal(db().signatures.filter((s) => s.quoteId === quote.id).length, 1);
    assert.equal(db().jobs.filter((j) => j.quoteId === quote.id).length, 1);
  });

  it("avböjd offert kan inte längre godkännas via BankID", () => {
    const defaults = quoteDefaults();
    const quote = createQuote({
      customerId: "cust-1",
      title: "Test",
      intro: "",
      lines: [labor()],
      rot: null,
      paymentPlan: [],
      paymentTermsDays: defaults.paymentTermsDays,
      validUntil: defaults.validUntil,
      terms: "",
    });
    sendQuote(quote.id);
    const order = bankidProvider.startSign({
      quoteId: quote.id,
      quoteVersionId: currentVersion(getQuote(quote.id)!).id,
      method: "qr",
    });
    // Kunden avböjer i ett annat fönster innan signeringen slutförs.
    getQuote(quote.id)!.status = "avbojd";
    const advanced = bankidProvider.advance(order.orderRef, "complete");
    assert.equal(advanced?.status, "failed", "ordern misslyckas i stället för att godkänna en avböjd offert");
    assert.equal(getQuote(quote.id)!.status, "avbojd");
    assert.equal(db().signatures.length, 0);
    assert.equal(db().jobs.length, 0);
  });
});

describe("Nekat ROT-avdrag: restfaktura är omflytt av fordran, inte ny försäljning", () => {
  beforeEach(() => reset());

  function issuedRotInvoice() {
    const draft = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor({ unitPrice: 10_000 })], // 12 500 inkl moms
      rot: { type: "rot" },
    });
    return issueInvoice(draft.id);
  }

  it("ursprungsfakturan bokför hela intäkten och momsen; avdraget ligger på 1513", () => {
    const invoice = issuedRotInvoice();
    const t = invoiceTotals(invoice);
    assert.equal(t.total, 12_500);
    assert.equal(t.deduction, 3_750); // 30 % av 12 500
    assert.equal(t.toPay, 8_750);
    assert.equal(accountBalance(3001), -10_000);
    assert.equal(accountBalance(2611), -2_500);
    assert.equal(accountBalance(1510), 8_750);
    assert.equal(accountBalance(1513), 3_750);
    assertBooksConsistent();
  });

  it("restfakturan flyttar fordran 1513→1510 utan ny intäkt eller moms", () => {
    const invoice = issuedRotInvoice();
    const revenueBefore = accountBalance(3001);
    const vatBefore = accountBalance(2611);

    const remainder = createDeniedReductionInvoice(invoice.id, 1_000);
    assert.equal(remainder.deniedReductionOf, invoice.id);
    assert.equal(remainder.lines[0].vatRate, 0, "restbeloppet momsas inte igen");
    assert.equal(invoiceTotals(remainder).toPay, 1_000);

    issueInvoice(remainder.id);
    assert.equal(accountBalance(3001), revenueBefore, "ingen ny intäkt");
    assert.equal(accountBalance(2611), vatBefore, "ingen ny utgående moms");
    assert.equal(accountBalance(1513), 3_750 - 1_000, "Skatteverksfordran minskade med det nekade beloppet");
    assert.equal(accountBalance(1510), 8_750 + 1_000, "kundfordran ökade med det nekade beloppet");
    assertBooksConsistent();

    // Verifikationen innehåller inga försäljnings- eller momskonton.
    const ver = db().verifications.find(
      (v: Verification) => v.source?.type === "kundfaktura" && v.source.id === remainder.id
    );
    assert.ok(ver);
    assert.ok(ver.entries.every((e) => e.account === 1510 || e.account === 1513));
  });

  it("kreditering av restfakturan flyttar tillbaka fordran till Skatteverket", () => {
    const invoice = issuedRotInvoice();
    const remainder = createDeniedReductionInvoice(invoice.id, 1_000);
    issueInvoice(remainder.id);
    creditInvoice(remainder.id);
    assert.equal(accountBalance(1513), 3_750, "fordran tillbaka på Skatteverkskontot");
    assert.equal(accountBalance(1510), 8_750, "kundfordran återställd");
    assert.equal(accountBalance(3001), -10_000, "intäkten orörd");
    assertBooksConsistent();
  });

  it("betald restfaktura ger pengar på banken mot kundfordran", () => {
    const invoice = issuedRotInvoice();
    const remainder = createDeniedReductionInvoice(invoice.id, 1_000);
    issueInvoice(remainder.id);
    simulateIncomingPayment(remainder.id);
    assert.equal(getInvoice(remainder.id)!.status, "betald");
    assert.equal(accountBalance(1930), 1_000);
    assert.equal(accountBalance(1510), 8_750);
    assertBooksConsistent();
  });
});

describe("Delbetalningar ärver offertens momssats", () => {
  beforeEach(() => reset());

  function approvedQuoteWithPlan(lines: DocLine[]) {
    const defaults = quoteDefaults();
    const quote = createQuote({
      customerId: "cust-1",
      title: "Blandat arbete",
      intro: "",
      lines,
      rot: null,
      paymentPlan: [
        { label: "Vid start", percent: 50 },
        { label: "Klart", percent: 50 },
      ],
      paymentTermsDays: defaults.paymentTermsDays,
      validUntil: defaults.validUntil,
      terms: "",
    });
    sendQuote(quote.id);
    approveQuoteViaBankID(quote.id);
    const job = db().jobs.find((j) => j.quoteId === quote.id)!;
    return { quote: getQuote(quote.id)!, job };
  }

  it("offert med 12 % moms ger delbetalning med 12 % moms", () => {
    const { job } = approvedQuoteWithPlan([labor({ unitPrice: 10_000, vatRate: 12 })]);
    const part = createNextInvoiceForJob(job.id);
    assert.equal(part.lines.length, 1);
    assert.equal(part.lines[0].vatRate, 12);
    // 11 200 total → del 50 % = 5 600 inkl → 5 000 exkl.
    assert.equal(invoiceTotals(part).total, 5_600);
    issueInvoice(part.id);
    assert.equal(accountBalance(2621), -600, "utgående moms 12 % – inte 25 %");
    assertBooksConsistent();
  });

  it("offert med blandade momssatser delar upp delbetalningen per sats", () => {
    const { job } = approvedQuoteWithPlan([
      labor({ unitPrice: 10_000, vatRate: 25 }),
      labor({ unitPrice: 10_000, vatRate: 12 }),
    ]);
    const part = createNextInvoiceForJob(job.id);
    assert.equal(part.lines.length, 2);
    const rates = part.lines.map((l) => l.vatRate).sort((a, b) => a - b);
    assert.deepEqual(rates, [12, 25]);
    issueInvoice(part.id);
    assertBooksConsistent();
    // Summan ligger nära 50 % av totalen (± avrundning per rad).
    const t = invoiceTotals(getInvoice(part.id)!);
    assert.ok(Math.abs(t.total - 11_850) <= 2, `del ≈ hälften av 23 700, fick ${t.total}`);
  });
});
