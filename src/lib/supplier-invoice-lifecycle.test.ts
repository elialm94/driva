process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetDemoData } from "./store";
import { db } from "./store";
import { ingestInboundMail, listInbox, countOpenInbox } from "./services/inbox";
import { getBusinessActions } from "./services/actions";
import { receiveSupplierInvoice } from "./services/suppliers";
import {
  applySupplierPaymentProviderEvent,
  cancelSupplierPayment,
  latestPaymentForInvoice,
  markSupplierPaymentFailed,
  prepareSupplierPayment,
  submitSupplierPayment,
} from "./services/supplier-payments";
import { setTestBankPaymentProvider } from "./banking/payment-provider";
import { executeTool } from "./ai/tools";
import { confirmPendingAction } from "./services/assistant";
import { processIncomingTransaction } from "./services/payment-matching";
import { uid } from "./ids";
import { isoDaysFromNow } from "./format";

describe("inbox är ekonomiskt underlag, inte uppdrag från webbformulär", () => {
  beforeEach(() => {
    resetDemoData();
    setTestBankPaymentProvider(null);
  });

  it("listar inte webbuppdrag men de finns kvar på Hem", () => {
    const page = listInbox({ filter: "oppna" });
    assert.ok(!page.rows.some((r) => r.id === "req-karin" || r.id === "job-karin"));
    assert.ok(page.rows.some((r) => r.id === "inbox-mail-byggmax"));
    const actions = getBusinessActions();
    assert.ok(actions.attention.some((a) => a.id === "job-new-job-karin"));
  });
});

describe("leverantörsfaktura: tolka → bokför → förbered betalning", () => {
  beforeEach(() => {
    resetDemoData();
    setTestBankPaymentProvider(null);
  });

  it("högkonfident faktura bokförs och förbereder betalning utan att skicka", () => {
    const beforePay = (db().supplierPayments ?? []).length;
    const result = ingestInboundMail({
      externalId: "inv-beijer-new",
      to: "demo@in.driva.se",
      from: "faktura@beijerbygg.se",
      subject: "Faktura BB-999",
      text: "Ny leverantörsfaktura",
      parsed: {
        amount: 2500,
        vatAmount: 500,
        supplier: "Beijer Bygg",
        invoiceNumber: "BB-999",
        dueDate: isoDaysFromNow(14).slice(0, 10),
        ocr: "9990001",
        bankgiro: "5123-4567",
        documentType: "leverantorsfaktura",
        confidence: 0.99,
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.autoBooked, true);
    assert.ok(result.item.supplierInvoiceId);
    const invoice = db().supplierInvoices.find((s) => s.id === result.item.supplierInvoiceId);
    assert.ok(invoice);
    assert.equal(invoice?.accountingStatus, "bokford");
    assert.equal(invoice?.status, "obetald");
    const payment = latestPaymentForInvoice(invoice!.id);
    assert.ok(payment);
    assert.equal(payment?.status, "READY");
    assert.equal((db().supplierPayments ?? []).length, beforePay + 1);
  });

  it("kvitto skapar inte utbetalning", () => {
    const payBefore = (db().supplierPayments ?? []).length;
    const result = ingestInboundMail({
      externalId: "kvitto-bauhaus-2",
      to: "demo@in.driva.se",
      from: "kvitto@bauhaus.se",
      subject: "Kvitto Bauhaus",
      text: "Tack för köpet.",
      parsed: { amount: 1240, vatAmount: 248, supplier: "Bauhaus", confidence: 0.99, documentType: "kvitto" },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.item.expenseId);
    assert.equal(result.item.supplierInvoiceId, undefined);
    assert.equal((db().supplierPayments ?? []).length, payBefore);
  });
});

describe("betalning kräver bekräftelse och är idempotent", () => {
  beforeEach(() => {
    resetDemoData();
    setTestBankPaymentProvider(null);
  });

  it("submit utan bankkoppling är ärligt och markerar inte betald", async () => {
    const invoice = receiveSupplierInvoice({
      supplier: "Beijer Bygg",
      invoiceNumber: "BB-TEST-1",
      amount: 1000,
      vatAmount: 200,
      description: "Test",
      bankgiro: "5123-4567",
      ocr: "1000001",
    });
    const payment = prepareSupplierPayment({ supplierInvoiceId: invoice.id });
    const first = submitSupplierPayment(payment.id);
    assert.equal(first.ok, false);
    if (!first.ok) assert.match(first.error, /Bank ej ansluten/);
    assert.equal(latestPaymentForInvoice(invoice.id)?.status, "READY");
    assert.equal(db().supplierInvoices.find((s) => s.id === invoice.id)?.status, "obetald");

    const second = submitSupplierPayment(payment.id);
    assert.equal(second.ok, false);
    assert.equal((db().supplierPayments ?? []).filter((p) => p.supplierInvoiceId === invoice.id && p.status !== "CANCELLED").length, 1);
  });

  it("AI kan inte skicka utan bekräftelse", async () => {
    const invoice = receiveSupplierInvoice({
      supplier: "Beijer Bygg",
      invoiceNumber: "BB-TEST-2",
      amount: 2000,
      vatAmount: 400,
      description: "Test",
      bankgiro: "5123-4567",
    });
    const payment = prepareSupplierPayment({ supplierInvoiceId: invoice.id });
    const tool = await executeTool("submit_supplier_payment", { paymentId: payment.id }, { origin: "ai" });
    assert.equal(tool.requiresConfirmation, true);
    assert.equal(latestPaymentForInvoice(invoice.id)?.status, "READY");
    assert.ok(db().pendingActions.some((a) => a.type === "skicka_leverantorsbetalning"));
    const pending = db().pendingActions.find((a) => a.type === "skicka_leverantorsbetalning");
    assert.ok(pending);
    await confirmPendingAction(pending!.id);
    assert.equal(latestPaymentForInvoice(invoice.id)?.status, "READY");
    assert.equal(db().supplierInvoices.find((s) => s.id === invoice.id)?.status, "obetald");
  });

  it("dubbel submit med ansluten provider skapar inte två betalningar", () => {
    setTestBankPaymentProvider({
      name: "test",
      connected: true,
      submitPayment: (instruction) => ({
        ok: true,
        providerPaymentId: `prov-${instruction.idempotencyKey}`,
        status: "SUBMITTED_TO_BANK",
      }),
    });
    const invoice = receiveSupplierInvoice({
      supplier: "Beijer Bygg",
      invoiceNumber: "BB-TEST-3",
      amount: 3000,
      vatAmount: 600,
      description: "Test",
      bankgiro: "5123-4567",
    });
    const payment = prepareSupplierPayment({ supplierInvoiceId: invoice.id });
    const a = submitSupplierPayment(payment.id);
    const b = submitSupplierPayment(payment.id);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    if (a.ok && b.ok) {
      assert.equal(a.payment.id, b.payment.id);
      assert.equal(b.alreadySubmitted, true);
    }
    assert.equal((db().supplierPayments ?? []).filter((p) => p.supplierInvoiceId === invoice.id).length, 1);
    assert.equal(latestPaymentForInvoice(invoice.id)?.status, "SUBMITTED_TO_BANK");
    assert.equal(db().supplierInvoices.find((s) => s.id === invoice.id)?.status, "obetald");
  });
});

describe("bedrägeri, misslyckande och avstämning", () => {
  beforeEach(() => {
    resetDemoData();
    setTestBankPaymentProvider({
      name: "test",
      connected: true,
      submitPayment: (instruction) => ({
        ok: true,
        providerPaymentId: `prov-${instruction.idempotencyKey}`,
        status: "SUBMITTED_TO_BANK",
      }),
    });
  });

  it("ändrat bankgiro flaggas och skickas inte automatiskt", () => {
    const first = receiveSupplierInvoice({
      supplier: "Beijer Bygg",
      invoiceNumber: "BB-OLD",
      amount: 500,
      vatAmount: 100,
      description: "Gammal",
      bankgiro: "1111-2222",
    });
    const paid = prepareSupplierPayment({ supplierInvoiceId: first.id });
    paid.status = "PAID";
    paid.paidAt = new Date().toISOString();
    const second = receiveSupplierInvoice({
      supplier: "Beijer Bygg",
      invoiceNumber: "BB-NEW",
      amount: 800,
      vatAmount: 160,
      description: "Ny",
      bankgiro: "9999-0000",
    });
    const prepared = prepareSupplierPayment({ supplierInvoiceId: second.id });
    assert.equal(prepared.destinationChanged, true);
    const sent = submitSupplierPayment(prepared.id);
    assert.equal(sent.ok, false);
    if (!sent.ok) assert.match(sent.error, /ändrats/);
    const actions = getBusinessActions();
    assert.ok(actions.attention.some((a) => a.id === `supplier-dest-${second.id}`));
  });

  it("misslyckad betalning skapar uppmärksamhet", () => {
    const invoice = receiveSupplierInvoice({
      supplier: "Beijer Bygg",
      invoiceNumber: "BB-FAIL",
      amount: 900,
      vatAmount: 180,
      description: "Fail",
      bankgiro: "5123-4567",
    });
    const payment = prepareSupplierPayment({ supplierInvoiceId: invoice.id });
    submitSupplierPayment(payment.id);
    markSupplierPaymentFailed(payment.id, "Täckning saknas");
    const actions = getBusinessActions();
    const row = actions.attention.find((a) => a.id === `supplier-fail-${invoice.id}`);
    assert.ok(row);
    assert.match(row!.title, /misslyckades/);
    // Nytt försök = ny bankfil (V1 utan bankintegration), aldrig "skicka igen".
    assert.equal(row!.cta?.type, "createPaymentFile");
  });

  it("avstämning markerar betald och bokför betalningshändelsen", () => {
    const invoice = receiveSupplierInvoice({
      supplier: "Beijer Bygg",
      invoiceNumber: "BB-REC",
      amount: 1500,
      vatAmount: 300,
      description: "Reconcile",
      bankgiro: "5123-4567",
      ocr: "1500001",
    });
    const payment = prepareSupplierPayment({ supplierInvoiceId: invoice.id });
    const submitted = submitSupplierPayment(payment.id);
    assert.equal(submitted.ok, true);
    const account = db().bankAccounts[0];
    const txId = uid();
    db().bankTransactions.unshift({
      id: txId,
      accountId: account.id,
      date: new Date().toISOString(),
      amount: -1500,
      counterpart: "Beijer Bygg",
      description: "Bankgiro 5123-4567",
      reference: "1500001",
      status: "ny",
    });
    const versBefore = db().verifications.length;
    const outcome = processIncomingTransaction(txId);
    assert.equal(outcome.outcome, "booked");
    assert.equal(latestPaymentForInvoice(invoice.id)?.status, "PAID");
    assert.equal(db().supplierInvoices.find((s) => s.id === invoice.id)?.status, "betald");
    assert.equal(db().verifications.length, versBefore + 1);
  });
});

describe("övrigt", () => {
  beforeEach(() => {
    resetDemoData();
    setTestBankPaymentProvider(null);
  });

  it("avbryt kräver separat väg och provider-osäkerhet blir inte betald", () => {
    const invoice = receiveSupplierInvoice({
      supplier: "Telia",
      invoiceNumber: "TEL-X",
      amount: 400,
      vatAmount: 80,
      description: "Tel",
      bankgiro: "991-2345",
    });
    const payment = prepareSupplierPayment({ supplierInvoiceId: invoice.id });
    cancelSupplierPayment(payment.id);
    assert.equal(latestPaymentForInvoice(invoice.id)?.status, "CANCELLED");
    assert.throws(() =>
      applySupplierPaymentProviderEvent({ paymentId: payment.id, status: "PAID" })
    );
  });

  it("badge räknar inte hela historiken", () => {
    const badge = countOpenInbox();
    const alla = listInbox({ filter: "alla" });
    assert.ok(alla.total >= badge);
  });
});
