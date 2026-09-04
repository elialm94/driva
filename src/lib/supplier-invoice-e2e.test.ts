process.env.DRIVA_TEST = "1";

/**
 * End-to-end-fall A–G för leverantörsfakturaflödet (krav 41):
 *
 *   A. Kvitto: tolka → matcha banktransaktion → bokför → ingen utbetalning.
 *   B. Leverantörsfaktura: tolka → bokför → REDO ATT BETALA → pain.001 →
 *      giltig XML → PAYMENT_FILE_CREATED (fil ≠ betald).
 *   C. Osäkert belopp: uppmärksamhet → kontrollera → godkänn → pipelinen körs
 *      om → bokförd → redo.
 *   D. Saknade betalningsuppgifter → ingen fil (exakt fel).
 *   E. Ändrad destination → blockerad tills mänsklig verifiering.
 *   F. Dubblettfaktura + dubbelbetalning → blockeras.
 *   G. Banktransaktion kommer senare → PAID → betalningen bokförs → avstämd.
 *
 * Testerna går genom SAMMA tjänstelager som UI:t och AI:n – ingen parallell
 * väg. Demodata (Södermalms Snickeri) är utgångspunkt precis som i appen.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, resetDemoData } from "./store";
import { ingestInboundMail, extractionReviewForItem, approveInboxExtraction } from "./services/inbox";
import { getBusinessActions } from "./services/actions";
import { receiveSupplierInvoice } from "./services/suppliers";
import {
  confirmChangedPaymentDetails,
  latestPaymentForInvoice,
  prepareSupplierPayment,
} from "./services/supplier-payments";
import {
  createPaymentFile,
  getPaymentFile,
  activePaymentFileForInvoice,
  paymentFileBlockers,
  paymentFileBlockersForInvoice,
  regeneratePaymentFile,
  invoicesReadyForPaymentFile,
} from "./services/payment-files";
import { processIncomingTransaction } from "./services/payment-matching";
import { setTestBankPaymentProvider } from "./banking/payment-provider";
import { needsAmountReview, amountIsCertain } from "./inbox/workflow";
import { paymentDetailsInfo } from "./services/payment-details";
import { uid } from "./ids";
import { isoDaysFromNow } from "./format";
import type { Verification } from "./types";

/* --------------------------------- Hjälpare --------------------------------- */

/** Bokföringsinvariant (krav 32): varje verifikation balanserar exakt. */
function assertAllVerificationsBalance(): void {
  for (const ver of db().verifications) {
    const debit = ver.entries.reduce((s, e) => s + e.debit, 0);
    const credit = ver.entries.reduce((s, e) => s + e.credit, 0);
    assert.equal(debit, credit, `Verifikation ${ver.id} balanserar inte (${debit} ≠ ${credit})`);
  }
}

function verification(id: string | undefined): Verification {
  const ver = db().verifications.find((v) => v.id === id);
  assert.ok(ver, `Verifikationen ${id} finns inte`);
  return ver!;
}

function entryAmount(ver: Verification, account: number, side: "debit" | "credit"): number {
  return ver.entries.filter((e) => e.account === account).reduce((s, e) => s + e[side], 0);
}

function pushCardPurchase(input: { counterpart: string; amount: number; reference?: string; description?: string }): string {
  const account = db().bankAccounts[0];
  assert.ok(account, "Demodata saknar bankkonto");
  const id = uid();
  db().bankTransactions.unshift({
    id,
    accountId: account.id,
    externalId: `e2e-${id}`,
    date: new Date().toISOString(),
    amount: -input.amount,
    counterpart: input.counterpart,
    description: input.description ?? `Kortköp ${input.counterpart.toUpperCase()}`,
    ...(input.reference ? { reference: input.reference } : {}),
    status: "ny",
  });
  return id;
}

/** Fall B-liknande faktura: tolkad säkert med kompletta betalningsuppgifter. */
function ingestReadyInvoice(over: Partial<{
  supplier: string;
  invoiceNumber: string;
  amount: number;
  vatAmount: number;
  ocr: string;
  bankgiro: string;
}> = {}) {
  const supplier = over.supplier ?? "XL-Bygg";
  const invoiceNumber = over.invoiceNumber ?? "XL-2201";
  const result = ingestInboundMail({
    externalId: `e2e-${invoiceNumber}`,
    to: "demo@in.ferva.se",
    from: "faktura@example.se",
    subject: `Faktura ${invoiceNumber}`,
    text: "Leverantörsfaktura, se bilaga.",
    attachments: [{ filename: `faktura-${invoiceNumber}.pdf`, contentType: "application/pdf" }],
    parsed: {
      documentType: "leverantorsfaktura",
      supplier,
      invoiceNumber,
      amount: over.amount ?? 18_500,
      vatAmount: over.vatAmount ?? 3_700,
      date: new Date().toISOString().slice(0, 10),
      dueDate: isoDaysFromNow(10).slice(0, 10),
      ocr: over.ocr ?? "220110",
      bankgiro: over.bankgiro ?? "5566-7788",
      confidence: 0.98,
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("ingest misslyckades");
  const invoiceId = result.item.supplierInvoiceId;
  assert.ok(invoiceId, "Fakturan skapades inte");
  return { item: result.item, invoiceId: invoiceId! };
}

/* ---------------------------------- Fall A ---------------------------------- */

describe("Fall A – kvitto: tolka → matcha banktransaktion → bokför, ingen betalning", () => {
  beforeEach(() => {
    resetDemoData();
    setTestBankPaymentProvider(null);
  });

  it("kvittot matchas mot kortköpet, bokförs och skapar aldrig utbetalning", () => {
    const txId = pushCardPurchase({ counterpart: "Clas Ohlson", amount: 645 });
    const paymentsBefore = (db().supplierPayments ?? []).length;
    const filesBefore = (db().paymentFiles ?? []).length;

    const result = ingestInboundMail({
      externalId: "e2e-a-kvitto",
      to: "demo@in.ferva.se",
      from: "kvitto@clasohlson.se",
      subject: "Kvitto Clas Ohlson",
      text: "Tack för ditt köp!",
      attachments: [{ filename: "kvitto-clas-ohlson.pdf", contentType: "application/pdf" }],
      parsed: {
        documentType: "kvitto",
        supplier: "Clas Ohlson",
        amount: 645,
        vatAmount: 129,
        date: new Date().toISOString().slice(0, 10),
        confidence: 0.99,
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // Bokfört via kvittoflödet – aldrig som leverantörsfaktura.
    assert.equal(result.autoBooked, true);
    assert.equal(result.item.status, "bokford");
    assert.ok(result.item.expenseId);
    assert.equal(result.item.supplierInvoiceId, undefined);

    // Matchad mot kortköpet: transaktionen är avstämd, inte längre öppen.
    const expense = db().expenses.find((e) => e.id === result.item.expenseId)!;
    assert.equal(expense.bankTransactionId, txId);
    assert.equal(expense.status, "bokford");
    const tx = db().bankTransactions.find((t) => t.id === txId)!;
    assert.equal(tx.status, "bokford");
    assert.equal(tx.matchedType, "utgift");
    assert.equal(tx.verificationId, expense.verificationId);

    // Konteringen: verktyg 5410 + ingående moms 2641 mot bank 1930 – aldrig 2440.
    const ver = verification(expense.verificationId);
    assert.equal(entryAmount(ver, 5410, "debit"), 645 - 129);
    assert.equal(entryAmount(ver, 2641, "debit"), 129);
    assert.equal(entryAmount(ver, 1930, "credit"), 645);
    assert.equal(entryAmount(ver, 2440, "credit"), 0);

    // Ingen betalningsexport är möjlig för kvitton.
    assert.equal((db().supplierPayments ?? []).length, paymentsBefore);
    assert.equal((db().paymentFiles ?? []).length, filesBefore);
    assert.ok(!invoicesReadyForPaymentFile().some((s) => s.supplier === "Clas Ohlson"));
    assertAllVerificationsBalance();
  });
});

/* ---------------------------------- Fall B ---------------------------------- */

describe("Fall B – leverantörsfaktura: tolka → bokför → redo → pain.001 → BETALFIL SKAPAD", () => {
  beforeEach(() => {
    resetDemoData();
    setTestBankPaymentProvider(null);
  });

  it("hela kedjan från mejl till nedladdningsbar bankfil", () => {
    const { item, invoiceId } = ingestReadyInvoice();

    // Bokförd direkt (säker läsning + känd leverantör) – FÖRE betalningen.
    const invoice = db().supplierInvoices.find((s) => s.id === invoiceId)!;
    assert.equal(invoice.accountingStatus, "bokford");
    assert.equal(invoice.status, "obetald");
    assert.equal(item.status, "bokford");

    // Kontering: material 4010 + ingående moms 2641 mot leverantörsskulder 2440.
    const ver = verification(invoice.verificationId);
    assert.equal(entryAmount(ver, 4010, "debit"), 18_500 - 3_700);
    assert.equal(entryAmount(ver, 2641, "debit"), 3_700);
    assert.equal(entryAmount(ver, 2440, "credit"), 18_500);

    // REDO ATT BETALA: instruktion förberedd, inga hinder.
    const payment = latestPaymentForInvoice(invoiceId)!;
    assert.equal(payment.status, "READY");
    assert.deepEqual(paymentFileBlockersForInvoice(invoiceId), []);

    // Skapa bankfilen.
    const created = createPaymentFile({ supplierInvoiceIds: [invoiceId] });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    // pain.001.001.03 – strukturella kärnkrav (fullständiga XML-tester i pain001.test.ts).
    const xml = created.file.xml;
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.ok(xml.includes('xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"'));
    assert.ok(xml.includes("<CstmrCdtTrfInitn>"));
    assert.ok(xml.includes('<InstdAmt Ccy="SEK">18500.00</InstdAmt>'), "SEK-belopp med 2 decimaler");
    assert.ok(xml.includes("<Prtry>BGNR</Prtry>"), "Bankgiro som BGNR-schema");
    assert.ok(xml.includes("<Cd>SCOR</Cd>") && xml.includes("<Ref>220110</Ref>"), "OCR som SCOR-referens");
    assert.ok(xml.includes(db().settings.payerIban!.replace(/\s/g, "").toUpperCase()), "Företagets betalkonto som debitor");

    // Filnamn: driva-betalningar-ÅÅÅÅ-MM-DD.xml.
    assert.match(created.file.filename, /^driva-betalningar-\d{4}-\d{2}-\d{2}(-\d+)?\.xml$/);

    // Status: PAYMENT_FILE_CREATED – och fil ≠ betald (krav 19/37).
    assert.equal(latestPaymentForInvoice(invoiceId)?.status, "PAYMENT_FILE_CREATED");
    assert.equal(latestPaymentForInvoice(invoiceId)?.paymentFileId, created.file.id);
    assert.equal(db().supplierInvoices.find((s) => s.id === invoiceId)?.status, "obetald");
    assert.equal(created.file.status, "CREATED");
    assertAllVerificationsBalance();
  });

  it("bär flera betalningar i samma fil (multi-payment, krav 17)", () => {
    const a = ingestReadyInvoice({ supplier: "XL-Bygg", invoiceNumber: "XL-3301", amount: 4_000, vatAmount: 800, ocr: "330111", bankgiro: "5566-7788" });
    const b = ingestReadyInvoice({ supplier: "Jula", invoiceNumber: "JU-9001", amount: 1_500, vatAmount: 300, ocr: "900122", bankgiro: "5432-1987" });
    const created = createPaymentFile({ supplierInvoiceIds: [a.invoiceId, b.invoiceId] });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.file.paymentIds.length, 2);
    assert.equal(created.file.totalAmount, 5_500);
    assert.ok(created.file.xml.includes("<NbOfTxs>2</NbOfTxs>"));
    assert.equal(latestPaymentForInvoice(a.invoiceId)?.status, "PAYMENT_FILE_CREATED");
    assert.equal(latestPaymentForInvoice(b.invoiceId)?.status, "PAYMENT_FILE_CREATED");
  });
});

/* ---------------------------------- Fall C ---------------------------------- */

describe("Fall C – osäkert belopp: uppmärksamhet → kontrollera → godkänn → bokförd → redo", () => {
  beforeEach(() => {
    resetDemoData();
    setTestBankPaymentProvider(null);
  });

  it("demofallet Byggmax: rätta beloppet mot PDF:en och godkänn", () => {
    // Utgångsläget: beloppet lästes osäkert – ingen faktura får skapas på en gissning.
    const item = (db().inboxItems ?? []).find((i) => i.id === "inbox-mail-byggmax")!;
    assert.ok(item, "Demodata saknar Byggmax-fakturan");
    assert.equal(item.status, "ny");
    assert.equal(item.supplierInvoiceId, undefined);
    assert.equal(amountIsCertain(item), false);
    assert.equal(needsAmountReview(item), true);

    // Hem visar den konkreta blockern med Kontrollera-CTA (krav 29).
    const before = getBusinessActions();
    const row = before.attention.find((a) => a.id === "inbox-mail-inbox-mail-byggmax");
    assert.ok(row, "Uppmärksamhetsraden saknas");
    assert.match(row!.title, /Kontrollera belopp/);
    assert.equal(row!.cta?.type, "link");
    if (row!.cta?.type === "link") {
      assert.equal(row!.cta.href, "/inbox/inbox-mail-byggmax/kontrollera");
    }

    // Kontrollera-vyn: beloppet flaggat, säkra fält är säkra (krav 3).
    const review = extractionReviewForItem("inbox-mail-byggmax");
    assert.equal(review.editable, true);
    const state = (key: string) => review.fields.find((f) => f.key === key)?.state;
    assert.equal(state("amount"), "kontrollera");
    assert.equal(state("vatAmount"), "kontrollera");
    assert.equal(state("supplier"), "saker");
    assert.equal(state("bankgiro"), "saker");

    // Människan rättar mot PDF:en (rätt totalbelopp 2 340 kr) och godkänner.
    const approved = approveInboxExtraction({
      itemId: "inbox-mail-byggmax",
      amount: 2_340,
      vatAmount: 468,
    });

    // Pipelinen kördes om: bokförd, betalning förberedd, uppgifter bekräftade.
    assert.equal(approved.autoBooked, true);
    assert.ok(approved.invoiceId);
    const invoice = db().supplierInvoices.find((s) => s.id === approved.invoiceId)!;
    assert.equal(invoice.amount, 2_340);
    assert.equal(invoice.vatAmount, 468);
    assert.equal(invoice.accountingStatus, "bokford");
    assert.equal(invoice.paymentDetails?.verified?.source, "document_confirmed");
    assert.equal(latestPaymentForInvoice(invoice.id)?.status, "READY");
    assert.deepEqual(paymentFileBlockersForInvoice(invoice.id), []);

    // Godkända värden persisterade med full konfidens.
    assert.ok(approved.item.reviewedAt);
    assert.equal(approved.item.extraction?.amount?.confidence, 1);

    // Blockern försvann från Hem när den löstes (krav 29).
    const after = getBusinessActions();
    assert.ok(!after.attention.some((a) => a.id === "inbox-mail-inbox-mail-byggmax"));
    assertAllVerificationsBalance();
  });

  it("godkänn utan belopp avvisas – Driva gissar aldrig", () => {
    assert.throws(
      () => approveInboxExtraction({ itemId: "inbox-mail-byggmax", amount: 0, vatAmount: 0 }),
      /totalbeloppet/
    );
  });
});

/* ---------------------------------- Fall D ---------------------------------- */

describe("Fall D – saknade betalningsuppgifter: ingen fil, exakt fel", () => {
  beforeEach(() => {
    resetDemoData();
    setTestBankPaymentProvider(null);
  });

  it("bokförd faktura utan uppgifter kan inte hamna i bankfil", () => {
    const result = ingestInboundMail({
      externalId: "e2e-d-utan-uppgifter",
      to: "demo@in.ferva.se",
      from: "faktura@kakelgrossisten.se",
      subject: "Faktura KG-501",
      text: "Faktura utan betalningsuppgifter i mejlet.",
      parsed: {
        documentType: "leverantorsfaktura",
        supplier: "Kakelgrossisten AB",
        invoiceNumber: "KG-501",
        amount: 6_250,
        vatAmount: 1_250,
        dueDate: isoDaysFromNow(20).slice(0, 10),
        confidence: 0.99,
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const invoiceId = result.item.supplierInvoiceId!;
    const invoice = db().supplierInvoices.find((s) => s.id === invoiceId)!;

    // Bokförd (bokföring och betalning är separata) men INTE redo att betala.
    assert.equal(invoice.accountingStatus, "bokford");
    assert.equal(paymentDetailsInfo(invoice).cause, "MISSING");
    assert.equal(latestPaymentForInvoice(invoiceId), undefined);

    const blockers = paymentFileBlockersForInvoice(invoiceId);
    assert.deepEqual(blockers, ["Kakelgrossisten AB saknar verifierade betalningsuppgifter."]);

    const attempt = createPaymentFile({ supplierInvoiceIds: [invoiceId] });
    assert.equal(attempt.ok, false);
    if (!attempt.ok) {
      assert.ok(attempt.problems.includes("Kakelgrossisten AB saknar verifierade betalningsuppgifter."));
    }
    assert.equal((db().paymentFiles ?? []).filter((f) => f.supplierInvoiceIds.includes(invoiceId)).length, 0);
  });

  it("saknat företagskonto ger exakt fel – aldrig ett XML-fel", () => {
    const { invoiceId } = ingestReadyInvoice({ invoiceNumber: "XL-4401", ocr: "440155" });
    const savedIban = db().settings.payerIban;
    db().settings.payerIban = undefined;
    try {
      const problems = paymentFileBlockers([invoiceId]);
      assert.ok(problems.some((p) => p.startsWith("Företagets betalkonto saknas.")));
      const attempt = createPaymentFile({ supplierInvoiceIds: [invoiceId] });
      assert.equal(attempt.ok, false);
    } finally {
      db().settings.payerIban = savedIban;
    }
  });
});

/* ---------------------------------- Fall E ---------------------------------- */

describe("Fall E – ändrad destination: blockerad tills mänsklig verifiering", () => {
  beforeEach(() => {
    resetDemoData();
    setTestBankPaymentProvider(null);
  });

  it("nytt bankgiro flaggas, blockerar bankfil och släpps efter kontroll", () => {
    // Historik: en TIDIGARE BETALD faktura etablerar leverantörens verifierade uppgifter.
    const first = receiveSupplierInvoice({
      supplier: "Elektrofirman AB",
      invoiceNumber: "EL-100",
      amount: 2_000,
      vatAmount: 400,
      description: "Elarbete",
      bankgiro: "1111-2222",
    });
    const paid = prepareSupplierPayment({ supplierInvoiceId: first.id });
    paid.status = "PAID";
    paid.paidAt = new Date().toISOString();

    // Ny faktura med ANNAT bankgiro – högkonfident läsning räcker inte.
    const second = receiveSupplierInvoice({
      supplier: "Elektrofirman AB",
      invoiceNumber: "EL-200",
      amount: 3_000,
      vatAmount: 600,
      description: "Elarbete etapp 2",
      bankgiro: "9999-0000",
    });
    assert.equal(paymentDetailsInfo(second).cause, "CHANGED");
    const prepared = prepareSupplierPayment({ supplierInvoiceId: second.id });
    assert.equal(prepared.destinationChanged, true);
    assert.equal(prepared.status, "DRAFT");

    // Bankfilen blockeras med exakt orsak.
    const blockers = paymentFileBlockersForInvoice(second.id);
    assert.ok(
      blockers.some((b) => b.includes("nya betalningsuppgifter")),
      `Förväntade ändrings-blocker, fick: ${blockers.join(" | ")}`
    );
    const attempt = createPaymentFile({ supplierInvoiceIds: [second.id] });
    assert.equal(attempt.ok, false);

    // Uppmärksamhetsraden finns (egen högprioriterad rad för ändrad destination).
    const actions = getBusinessActions();
    assert.ok(actions.attention.some((a) => a.id === `supplier-dest-${second.id}`));

    // Människan kontrollerar och godkänner de nya uppgifterna → redo.
    confirmChangedPaymentDetails(second.id);
    assert.equal(paymentDetailsInfo(db().supplierInvoices.find((s) => s.id === second.id)!).cause, "VERIFIED");
    assert.deepEqual(paymentFileBlockersForInvoice(second.id), []);
    const created = createPaymentFile({ supplierInvoiceIds: [second.id] });
    assert.equal(created.ok, true);
  });
});

/* ---------------------------------- Fall F ---------------------------------- */

describe("Fall F – dubbletter: samma faktura eller dubbel betalning blockeras", () => {
  beforeEach(() => {
    resetDemoData();
    setTestBankPaymentProvider(null);
  });

  it("samma leverantör + fakturanummer skapar aldrig en andra faktura", () => {
    const { invoiceId } = ingestReadyInvoice({ invoiceNumber: "XL-5501", ocr: "550166" });
    const invoicesBefore = db().supplierInvoices.length;
    const paymentsBefore = (db().supplierPayments ?? []).length;

    const again = ingestInboundMail({
      externalId: "e2e-f-dubblett",
      to: "demo@in.ferva.se",
      from: "faktura@example.se",
      subject: "Faktura XL-5501 (påminnelse)",
      text: "Samma faktura igen.",
      parsed: {
        documentType: "leverantorsfaktura",
        supplier: "XL-Bygg",
        invoiceNumber: "XL-5501",
        amount: 18_500,
        vatAmount: 3_700,
        ocr: "550166",
        bankgiro: "5566-7788",
        confidence: 0.98,
      },
    });
    assert.equal(again.ok, true);
    if (!again.ok) return;
    // Pekar på SAMMA faktura – ingen ny skapades, ingen ny instruktion.
    assert.equal(again.item.supplierInvoiceId, invoiceId);
    assert.equal(db().supplierInvoices.length, invoicesBefore);
    assert.equal((db().supplierPayments ?? []).length, paymentsBefore);
  });

  it("en faktura kan aldrig ingå i två aktiva bankfiler", () => {
    const { invoiceId } = ingestReadyInvoice({ invoiceNumber: "XL-6601", ocr: "660177" });
    const first = createPaymentFile({ supplierInvoiceIds: [invoiceId] });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const second = createPaymentFile({ supplierInvoiceIds: [invoiceId] });
    assert.equal(second.ok, false);
    if (!second.ok) {
      assert.ok(second.problems.some((p) => p.includes("ingår redan i en aktiv bankfil")));
    }
    assert.equal(
      (db().paymentFiles ?? []).filter((f) => f.status === "CREATED" && f.supplierInvoiceIds.includes(invoiceId)).length,
      1
    );
  });

  it("regenerering ersätter filen – aldrig parallella aktiva filer (krav 34)", () => {
    const { invoiceId } = ingestReadyInvoice({ invoiceNumber: "XL-7701", ocr: "770188" });
    const first = createPaymentFile({ supplierInvoiceIds: [invoiceId] });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const regen = regeneratePaymentFile(first.file.id);
    assert.equal(regen.ok, true);
    if (!regen.ok) return;

    const old = getPaymentFile(first.file.id)!;
    assert.equal(old.status, "REPLACED");
    assert.equal(old.replacedByFileId, regen.file.id);
    assert.equal(regen.file.status, "CREATED");
    assert.equal(activePaymentFileForInvoice(invoiceId)?.id, regen.file.id);
    assert.equal(latestPaymentForInvoice(invoiceId)?.paymentFileId, regen.file.id);
    assert.equal(
      (db().paymentFiles ?? []).filter((f) => f.status === "CREATED" && f.supplierInvoiceIds.includes(invoiceId)).length,
      1
    );
  });
});

/* ---------------------------------- Fall G ---------------------------------- */

describe("Fall G – banktransaktionen kommer: PAID → betalningen bokförs → avstämd", () => {
  beforeEach(() => {
    resetDemoData();
    setTestBankPaymentProvider(null);
  });

  it("utgående transaktion matchar bankfilens betalning och stämmer av allt", () => {
    const { invoiceId } = ingestReadyInvoice({ invoiceNumber: "XL-8801", ocr: "880199" });
    const created = createPaymentFile({ supplierInvoiceIds: [invoiceId] });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(latestPaymentForInvoice(invoiceId)?.status, "PAYMENT_FILE_CREATED");

    // Användaren laddade upp filen i internetbanken; dagar senare syns uttaget.
    const txId = pushCardPurchase({
      counterpart: "XL-Bygg",
      amount: 18_500,
      reference: "880199",
      description: "Betalning BG 5566-7788",
    });
    const versBefore = db().verifications.length;
    const outcome = processIncomingTransaction(txId);
    assert.equal(outcome.outcome, "booked");

    // PAID + betalningshändelsen bokförd: 2440 mot 1930 (krav 21/32).
    const payment = latestPaymentForInvoice(invoiceId)!;
    assert.equal(payment.status, "PAID");
    assert.equal(payment.bankTransactionId, txId);
    const invoice = db().supplierInvoices.find((s) => s.id === invoiceId)!;
    assert.equal(invoice.status, "betald");
    assert.ok(invoice.paymentVerificationId);
    assert.equal(db().verifications.length, versBefore + 1);
    const payVer = verification(invoice.paymentVerificationId);
    assert.equal(entryAmount(payVer, 2440, "debit"), 18_500);
    assert.equal(entryAmount(payVer, 1930, "credit"), 18_500);

    // Avstämd (krav 22): transaktionen är bokförd, inte längre olöst.
    const tx = db().bankTransactions.find((t) => t.id === txId)!;
    assert.equal(tx.status, "bokford");
    assert.equal(tx.matchedType, "leverantorsfaktura");
    assert.equal(tx.matchedId, invoiceId);

    // Bokförd ✓ Betald ✓ Avstämd ✓ – och inga nya hinder någonstans.
    assert.equal(invoice.accountingStatus, "bokford");
    assertAllVerificationsBalance();
  });
});
