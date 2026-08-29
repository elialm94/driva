process.env.DRIVA_TEST = "1";

/**
 * Betalningsmatchning, delbetalningar, krediteringar, ROT-utbetalningar och
 * periodlås – flödestester genom domäntjänsterna (aldrig direkta mutationer
 * där tjänster finns).
 *
 * Principer som testas:
 *   * Det FAKTISKA bankbeloppet bokförs alltid – aldrig fakturans belopp.
 *   * Öresdiff (≤ 1 kr) → 3740, fakturan bockas av.
 *   * Underbetalning → delbetald med kvarvarande fordran.
 *   * Överbetalning → aldrig automatik: människan bekräftar, överskottet
 *     blir skuld (2420) och en återbetalnings-exception.
 *   * En banktransaktion kan aldrig bokas två gånger (import + matchning).
 *   * ROT/RUT: Skatteverkets utbetalning bockar av 1513; delvis godkänd →
 *     restfaktura; dubbelregistrering är omöjlig.
 *   * Låst period avvisar bokföring; rättelser landar i öppen period.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb, labor } from "./invoices/test-db";
import { uid } from "./ids";
import type { BankAccount, BankTransaction } from "./types";
import {
  createDeniedReductionInvoice,
  createInvoice,
  creditInvoice,
  creditRefundDue,
  issueInvoice,
  registerCreditRefund,
  registerInvoicePayment,
} from "./services/invoices";
import { getInvoice, invoiceOutstanding, invoiceTotals } from "./services/data";
import { registerBankTransactions } from "./services/banking";
import {
  confirmPaymentMatch,
  confirmTaxReductionPayoutMatch,
  paymentSuggestionForTransaction,
  processIncomingTransaction,
} from "./services/payment-matching";
import {
  createTaxReductionUnderlag,
  expectedTaxReductionPayouts,
  patchTaxReductionFields,
  registerTaxReductionPayout,
} from "./services/tax-reduction";
import { updateCustomer } from "./services/customers";
import { accountBalance, ledgerIntegrity, saldobalans } from "./accounting/ledger";
import { postVerification, createCorrection, PostingError } from "./accounting/engine";
import { lockPeriod } from "./accounting/fiscal";
import { computeVatPosition } from "./accounting/vat";
import { ensureFiscalYearFor, quartersOf } from "./accounting/fiscal";
import { bokforingsdatum } from "./accounting/dates";

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

function assertBooksConsistent() {
  const integrity = ledgerIntegrity();
  assert.ok(integrity.balanced, `obalanserat: ${integrity.unbalancedVerifications.join(", ")}`);
  const sb = saldobalans();
  assert.equal(sb.sumDebit, sb.sumCredit, "saldobalansen balanserar inte");
}

/** Utfärdad standardfaktura: 10 000 arbete + 25 % moms = 12 500 att betala. */
function issuedInvoice(over: { unitPrice?: number; rot?: boolean } = {}) {
  const draft = createInvoice({
    customerId: "cust-1",
    type: "faktura",
    lines: [labor({ unitPrice: over.unitPrice ?? 10_000 })],
    rot: over.rot ? { type: "rot" } : null,
  });
  return issueInvoice(draft.id);
}

function incomingTx(over: Partial<BankTransaction> & { amount: number }): BankTransaction {
  return {
    id: uid(),
    accountId: "acc-1",
    externalId: `ext-${uid()}`,
    date: new Date().toISOString(),
    counterpart: "Anna Andersson",
    description: "Inbetalning bankgiro",
    status: "ny",
    ...over,
  };
}

describe("Betalningsmatchning: faktiskt belopp, öresdiff, del- och överbetalning", () => {
  beforeEach(() => reset());

  it("exakt OCR + exakt belopp bokförs automatiskt med faktiskt belopp", () => {
    const inv = issuedInvoice();
    const toPay = invoiceTotals(inv).toPay;
    const result = registerBankTransactions([
      incomingTx({ amount: toPay, reference: `OCR ${inv.ocr}` }),
    ]);
    assert.equal(result.imported, 1);

    const after = getInvoice(inv.id)!;
    assert.equal(after.status, "betald");
    assert.equal(accountBalance(1930), toPay);
    assert.equal(accountBalance(1510), 0);
    const tx = db().bankTransactions[0];
    assert.equal(tx.status, "bokford");
    assert.equal(tx.matchedType, "faktura");
    assert.ok(tx.verificationId, "banktransaktionen pekar på sin verifikation");
    assert.equal(db().payments[0].amount, toPay);
    assertBooksConsistent();
  });

  it("1 kr under: fakturan bockas av och differensen bokförs på 3740", () => {
    const inv = issuedInvoice();
    const toPay = invoiceTotals(inv).toPay;
    registerBankTransactions([incomingTx({ amount: toPay - 1, reference: `OCR ${inv.ocr}` })]);

    assert.equal(getInvoice(inv.id)!.status, "betald");
    assert.equal(accountBalance(1930), toPay - 1, "banken fick det faktiska beloppet");
    assert.equal(accountBalance(1510), 0, "fordran är avbockad");
    assert.equal(accountBalance(3740), 1, "öresdiffen bokfördes som kostnad på 3740");
    assert.equal(db().payments[0].amount, toPay - 1, "betalningsraden bär bankbeloppet");
    assertBooksConsistent();
  });

  it("underbetalning: delbetald med kvarvarande fordran, resten stänger fakturan", () => {
    const inv = issuedInvoice();
    const toPay = invoiceTotals(inv).toPay; // 12 500
    registerBankTransactions([incomingTx({ amount: 5_000, reference: `OCR ${inv.ocr}` })]);

    const mid = getInvoice(inv.id)!;
    assert.equal(mid.status, "delbetald");
    assert.equal(invoiceOutstanding(mid), toPay - 5_000);
    assert.equal(accountBalance(1930), 5_000);
    assert.equal(accountBalance(1510), toPay - 5_000);

    // Påminnelse-/förfallologik ser delbetalda som öppna fordringar; slutbetalningen stänger.
    registerBankTransactions([incomingTx({ amount: toPay - 5_000, reference: `OCR ${inv.ocr}` })]);
    const after = getInvoice(inv.id)!;
    assert.equal(after.status, "betald");
    assert.ok(after.paidAt, "paidAt sätts när sista kronan kommer in");
    assert.equal(invoiceOutstanding(after), 0);
    assert.equal(accountBalance(1510), 0);
    assert.equal(accountBalance(1930), toPay);
    assert.equal(db().payments.length, 2, "båda delbetalningarna finns kvar som rader");
    assertBooksConsistent();
  });

  it("överbetalning bokförs ALDRIG automatiskt – bekräftelsen bokar överskottet som skuld", () => {
    const inv = issuedInvoice();
    const toPay = invoiceTotals(inv).toPay;
    registerBankTransactions([incomingTx({ amount: toPay + 500, reference: `OCR ${inv.ocr}` })]);

    // Autopiloten stannade: transaktionen väntar med ett härlett förslag.
    const tx = db().bankTransactions[0];
    assert.equal(tx.status, "behover_atgard");
    assert.equal(getInvoice(inv.id)!.status, "skickad", "ingenting bokfördes bakom ryggen");
    const suggestion = paymentSuggestionForTransaction(tx);
    assert.equal(suggestion.kind, "overpayment");
    assert.equal(suggestion.outcome, "REQUIRES_USER");

    // Människan bekräftar: faktiskt belopp bokförs, överskottet blir skuld på 2420.
    confirmPaymentMatch(tx.id, inv.id);
    const after = getInvoice(inv.id)!;
    assert.equal(after.status, "betald");
    assert.equal(after.overpaymentCredit, 500);
    assert.equal(accountBalance(1930), toPay + 500);
    assert.equal(accountBalance(2420), -500, "överskottet är en skuld till kunden");
    assert.equal(accountBalance(1510), 0);

    // Återbetalningen nollar skulden – och kan bara registreras EN gång.
    assert.equal(creditRefundDue(after), 500);
    registerCreditRefund(inv.id);
    assert.equal(accountBalance(2420), 0);
    assert.equal(accountBalance(1930), toPay);
    assert.throws(() => registerCreditRefund(inv.id), /redan registrerad/);
    assertBooksConsistent();
  });

  it("okänd inbetalning parkeras som 'behöver åtgärd' utan bokföring", () => {
    issuedInvoice();
    registerBankTransactions([
      incomingTx({ amount: 777, counterpart: "Okänd AB", reference: "utan referens" }),
    ]);
    const tx = db().bankTransactions[0];
    assert.equal(tx.status, "behover_atgard");
    assert.equal(accountBalance(1930), 0, "ingenting bokfördes");
    assert.equal(paymentSuggestionForTransaction(tx).kind, "none");
  });

  it("dubbelbetalning: OCR mot redan betald faktura flaggas – bokförs aldrig", () => {
    const inv = issuedInvoice();
    const toPay = invoiceTotals(inv).toPay;
    registerBankTransactions([incomingTx({ amount: toPay, reference: `OCR ${inv.ocr}` })]);
    assert.equal(getInvoice(inv.id)!.status, "betald");

    registerBankTransactions([incomingTx({ amount: toPay, reference: `OCR ${inv.ocr}` })]);
    const dup = db().bankTransactions.find((t) => t.status === "behover_atgard")!;
    assert.ok(dup, "andra inbetalningen parkerades");
    const suggestion = paymentSuggestionForTransaction(dup);
    assert.equal(suggestion.kind, "duplicate");
    assert.equal(suggestion.outcome, "REQUIRES_USER");
    assert.equal(accountBalance(1930), toPay, "bara den första bokfördes");
    assertBooksConsistent();
  });
});

describe("Idempotens: import och matchning kan aldrig dubbelboka", () => {
  beforeEach(() => reset());

  it("samma externalId importeras bara en gång", () => {
    const inv = issuedInvoice();
    const toPay = invoiceTotals(inv).toPay;
    const tx = incomingTx({ amount: toPay, externalId: "bank-abc-1", reference: `OCR ${inv.ocr}` });
    const first = registerBankTransactions([tx]);
    const second = registerBankTransactions([
      incomingTx({ amount: toPay, externalId: "bank-abc-1", reference: `OCR ${inv.ocr}` }),
    ]);
    assert.deepEqual({ i: first.imported, s: first.skipped }, { i: 1, s: 0 });
    assert.deepEqual({ i: second.imported, s: second.skipped }, { i: 0, s: 1 });
    assert.equal(db().bankTransactions.length, 1);
    assert.equal(db().payments.length, 1);
  });

  it("en bokförd transaktion kan inte processas eller bekräftas igen", () => {
    const inv = issuedInvoice();
    const toPay = invoiceTotals(inv).toPay;
    registerBankTransactions([incomingTx({ amount: toPay, reference: `OCR ${inv.ocr}` })]);
    const tx = db().bankTransactions[0];
    assert.equal(tx.status, "bokford");

    assert.equal(processIncomingTransaction(tx.id).outcome, "skipped");
    assert.throws(() => confirmPaymentMatch(tx.id, inv.id), /redan bokförd/);
    assert.equal(db().payments.length, 1, "fortfarande exakt en betalning");
  });

  it("öre avrundas vid importgränsen – bokföringen ser bara hela kronor", () => {
    const inv = issuedInvoice();
    const toPay = invoiceTotals(inv).toPay;
    registerBankTransactions([
      incomingTx({ amount: toPay + 0.4, reference: `OCR ${inv.ocr}` }),
    ]);
    assert.equal(db().bankTransactions[0].amount, toPay, "beloppet avrundades till hela kronor");
    assert.equal(getInvoice(inv.id)!.status, "betald");
    assert.equal(accountBalance(1930), toPay);
  });
});

describe("Krediteringar: hel, delvis och av betald faktura", () => {
  beforeEach(() => reset());

  it("hel kredit av obetald faktura återför intäkt, moms och fordran", () => {
    const inv = issuedInvoice();
    creditInvoice(inv.id);
    assert.equal(getInvoice(inv.id)!.status, "krediterad");
    assert.equal(invoiceOutstanding(getInvoice(inv.id)!), 0);
    assert.equal(accountBalance(3001), 0, "intäkten återförd");
    assert.equal(accountBalance(2611), 0, "utgående moms återförd");
    assert.equal(accountBalance(1510), 0, "fordran nollad");
    const credit = db().invoices.find((i) => i.type === "kredit")!;
    assert.equal(credit.creditsInvoiceId, inv.id, "krediten pekar på originalet");
    assert.ok(credit.number != null && credit.number !== inv.number, "krediten har eget nummer");
    assertBooksConsistent();
  });

  it("delkredit minskar utestående; originalet förblir öppet", () => {
    const inv = issuedInvoice(); // 12 500
    creditInvoice(inv.id, "anvandare", { amountInclVat: 2_500 });
    const after = getInvoice(inv.id)!;
    assert.equal(after.status, "skickad");
    assert.equal(invoiceOutstanding(after), 10_000);
    assert.equal(accountBalance(1510), 10_000);
    // Momsen justerades proportionellt: 2 500 inkl 25 % = 500 moms tillbaka.
    assert.equal(accountBalance(2611), -(2_500 - 500));
    assertBooksConsistent();
  });

  it("kredit av betald faktura skapar återbetalningsskyldighet som bokförs 1510→1930", () => {
    const inv = issuedInvoice();
    const toPay = invoiceTotals(inv).toPay;
    registerInvoicePayment(inv.id, { matchedBy: "manuell" });
    creditInvoice(inv.id);

    const after = getInvoice(inv.id)!;
    assert.equal(after.status, "krediterad");
    assert.equal(creditRefundDue(after), toPay, "hela det inbetalda ska tillbaka");
    assert.equal(accountBalance(1510), -toPay, "skulden till kunden syns som negativ fordran");

    registerCreditRefund(inv.id);
    assert.equal(accountBalance(1510), 0);
    assert.equal(accountBalance(1930), 0, "pengarna gick tillbaka från banken");
    assert.ok(getInvoice(inv.id)!.refund, "återbetalningen är spårad på fakturan");
    assertBooksConsistent();
  });

  it("kredit av delbetald faktura: det inbetalda utöver kvarvarande fordran ska tillbaka", () => {
    const inv = issuedInvoice(); // 12 500
    registerInvoicePayment(inv.id, { amount: 5_000, matchedBy: "manuell" });
    assert.equal(getInvoice(inv.id)!.status, "delbetald");
    creditInvoice(inv.id); // hel kredit av resterande

    const after = getInvoice(inv.id)!;
    assert.equal(after.status, "krediterad");
    assert.equal(creditRefundDue(after), 5_000, "det inbetalda ska tillbaka");
    registerCreditRefund(inv.id);
    assert.equal(accountBalance(1510), 0);
    assert.equal(accountBalance(1930), 0);
    assertBooksConsistent();
  });
});

describe("ROT-cykeln: kundbetalning → ansökan → Skatteverkets utbetalning", () => {
  beforeEach(() => {
    reset();
    updateCustomer("cust-1", { personalIdentityNumber: "19850515-1234" });
  });

  function readyRotInvoice() {
    const inv = issuedInvoice({ rot: true }); // 12 500 total, 3 750 avdrag, 8 750 att betala
    registerBankTransactions([
      incomingTx({ amount: invoiceTotals(inv).toPay, reference: `OCR ${inv.ocr}` }),
    ]);
    assert.equal(getInvoice(inv.id)!.status, "betald");
    patchTaxReductionFields({
      invoiceId: inv.id,
      dwellingType: "smahus",
      propertyDesignation: "Eken 1:23",
      workAddress: "Folkungagatan 1, Stockholm",
      workPeriodStart: "2026-08-01",
      workPeriodEnd: "2026-08-15",
    });
    return getInvoice(inv.id)!;
  }

  it("full utbetalning: 1513 bockas av, ansökan godkänd, ingen ny intäkt", () => {
    const inv = readyRotInvoice();
    createTaxReductionUnderlag({ invoiceId: inv.id });
    const expected = expectedTaxReductionPayouts();
    assert.equal(expected.length, 1);
    assert.equal(expected[0].expectedAmount, 3_750);

    const revenueBefore = accountBalance(3001);
    registerBankTransactions([
      incomingTx({ amount: 3_750, counterpart: "Skatteverket", description: "Utbetalning ROT" }),
    ]);

    assert.equal(accountBalance(1513), 0, "Skatteverksfordran avbockad");
    assert.equal(accountBalance(1930), 8_750 + 3_750);
    assert.equal(accountBalance(3001), revenueBefore, "ingen dubbel intäkt");
    const app = getInvoice(inv.id)!.taxReductionApplication!;
    assert.equal(app.status, "godkant");
    assert.ok(app.payout, "utbetalningen är spårad");
    const skvTx = db().bankTransactions.find((t) => t.counterpart === "Skatteverket")!;
    assert.equal(skvTx.status, "bokford");
    assert.equal(skvTx.matchedType, "skattereduktion");
    assertBooksConsistent();
  });

  it("delvis utbetalning: aldrig automatik – bekräftelse ger delvis godkänt + restfaktura", () => {
    const inv = readyRotInvoice();
    createTaxReductionUnderlag({ invoiceId: inv.id });

    registerBankTransactions([
      incomingTx({ amount: 3_000, counterpart: "Skatteverket", description: "Utbetalning ROT" }),
    ]);
    const tx = db().bankTransactions.find((t) => t.counterpart === "Skatteverket")!;
    assert.equal(tx.status, "behover_atgard", "delvis utbetalning bokförs inte automatiskt");
    const suggestion = paymentSuggestionForTransaction(tx);
    assert.equal(suggestion.kind, "tax_reduction_payout");
    assert.equal(suggestion.outcome, "SUGGEST");

    confirmTaxReductionPayoutMatch(tx.id);
    const app = getInvoice(inv.id)!.taxReductionApplication!;
    assert.equal(app.status, "delvis_godkant");
    assert.equal(app.decision?.deniedAmount, 750);
    assert.equal(accountBalance(1513), 750, "den nekade delen står kvar som fordran");

    // Restfakturan flyttar den nekade delen till kundfordran – utan ny intäkt/moms.
    const remainder = createDeniedReductionInvoice(inv.id, 750);
    issueInvoice(remainder.id);
    assert.equal(accountBalance(1513), 0);
    assert.equal(accountBalance(1510), 750);
    assertBooksConsistent();
  });

  it("utbetalning kan aldrig registreras två gånger, och aldrig över fordran", () => {
    const inv = readyRotInvoice();
    createTaxReductionUnderlag({ invoiceId: inv.id });
    registerTaxReductionPayout({ invoiceId: inv.id, amount: 3_750 });
    assert.throws(() => registerTaxReductionPayout({ invoiceId: inv.id, amount: 3_750 }), /redan registrerad/);

    const inv2 = (() => {
      reset();
      updateCustomer("cust-1", { personalIdentityNumber: "19850515-1234" });
      return readyRotInvoice();
    })();
    createTaxReductionUnderlag({ invoiceId: inv2.id });
    assert.throws(() => registerTaxReductionPayout({ invoiceId: inv2.id, amount: 4_000 }), /överstiger fordran/);
  });

  it("underlag kan inte skapas före kundbetalning – och är idempotent efteråt", () => {
    const inv = issuedInvoice({ rot: true });
    patchTaxReductionFields({
      invoiceId: inv.id,
      dwellingType: "smahus",
      propertyDesignation: "Eken 1:23",
      workAddress: "Folkungagatan 1, Stockholm",
      workPeriodStart: "2026-08-01",
      workPeriodEnd: "2026-08-15",
    });
    assert.throws(() => createTaxReductionUnderlag({ invoiceId: inv.id }), /kan inte ansökas ännu/);

    registerBankTransactions([
      incomingTx({ amount: invoiceTotals(inv).toPay, reference: `OCR ${inv.ocr}` }),
    ]);
    const first = createTaxReductionUnderlag({ invoiceId: inv.id });
    const second = createTaxReductionUnderlag({ invoiceId: inv.id });
    assert.equal(first.underlagCreatedAt, second.underlagCreatedAt, "dubbelklick återanvänder samma underlag");
    assert.equal(db().auditTrail.filter((a) => a.action === "rot_underlag_skapat").length, 1);
  });
});

describe("Periodlås och momsavstämning", () => {
  beforeEach(() => reset());

  it("bokföring i låst period avvisas; rättelser landar i öppen period", () => {
    const inv = issuedInvoice();
    const issuedVer = db().verifications.find((v) => v.source.type === "kundfaktura" && v.source.id === inv.id)!;

    lockPeriod(bokforingsdatum(new Date().toISOString()), "anvandare");

    assert.throws(
      () =>
        postVerification({
          date: new Date().toISOString(),
          description: "Försök i låst period",
          entries: [
            { account: 1930, debit: 100 },
            { account: 3001, credit: 100 },
          ],
          source: { type: "manuell" },
          createdBy: "anvandare",
        }),
      PostingError
    );

    // Rättelsen vägras inte – den bokförs på första öppna dag.
    const result = createCorrection({
      verificationId: issuedVer.id,
      reason: "Test av rättelse i låst period",
      by: "anvandare",
    });
    const lock = db().accounting.lockedThrough!;
    assert.ok(bokforingsdatum(result.reversal.date) > lock, "återföringen ligger i öppen period");
    assert.equal(result.reversal.correctsVerificationId, issuedVer.id);
    assertBooksConsistent();
  });

  it("blandade momssatser hamnar på rätt konton och momspositionen stämmer", () => {
    const draft = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [
        labor({ unitPrice: 10_000, vatRate: 25 }),
        labor({ unitPrice: 10_000, vatRate: 12 }),
        labor({ unitPrice: 10_000, vatRate: 6 }),
      ],
      rot: null,
    });
    issueInvoice(draft.id);

    assert.equal(accountBalance(2611), -2_500);
    assert.equal(accountBalance(2621), -1_200);
    assert.equal(accountBalance(2631), -600);

    const fy = ensureFiscalYearFor(bokforingsdatum(new Date().toISOString()));
    const today = bokforingsdatum(new Date().toISOString());
    const period = quartersOf(fy).find((p) => p.start <= today && today <= p.end)!;
    const pos = computeVatPosition(period);
    assert.equal(pos.utgaende, 4_300, "momspositionen läses ur huvudboken");
    assert.equal(pos.ingaende, 0);
    assert.equal(pos.attBetala, 4_300);
    assertBooksConsistent();
  });
});
