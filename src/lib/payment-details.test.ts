process.env.DRIVA_TEST = "1";

/**
 * Betalningsuppgifternas tillståndsmodell för leverantörsfakturor:
 *
 *   * fyra orsaker (EXTRACTION_UNCERTAIN, MISSING, återanvändbar historik,
 *     CHANGED) i stället för ett generiskt "saknar bankuppgifter"
 *   * betalningsvakter: utan VERIFIERAD destination aldrig READY/bank
 *   * åtgärdsmotorn: status ≠ åtgärd – Hem visar bara rader med riktig lösning
 *   * mejlförfrågan till leverantören med ärlig degradering utan provider
 *   * AI:n läser sanningen och kan aldrig hitta på betalningsuppgifter
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, resetDemoData } from "./store";
import { receiveSupplierInvoice } from "./services/suppliers";
import {
  confirmChangedPaymentDetails,
  latestPaymentForInvoice,
  prepareSupplierPayment,
  submitSupplierPayment,
  useVerifiedSupplierDetails,
  verifySupplierPaymentDetails,
} from "./services/supplier-payments";
import {
  paymentDetailsInfo,
  requestPaymentDetailsFromSupplier,
  verifiedDetailsForSupplier,
} from "./services/payment-details";
import { getBusinessActions, PAYMENT_DETAILS_GROUP_THRESHOLD } from "./services/actions";
import { countInboxBadge, getInboxView, ingestInboundMail } from "./services/inbox";
import { listExpensesForTable } from "./services/economy-list";
import { setTestBankPaymentProvider } from "./banking/payment-provider";
import { setMailTransportForTests, type MailMessage } from "./mail";
import { executeTool } from "./ai/tools";
import { confirmPendingAction } from "./services/assistant";
import { isoDaysFromNow } from "./format";

/** Faktura utan betalningsuppgifter, direkt via tjänsten (ingen mejlkontext). */
function receiveMissing(overrides: Partial<Parameters<typeof receiveSupplierInvoice>[0]> = {}) {
  return receiveSupplierInvoice({
    supplier: "Ny Leverantör AB",
    invoiceNumber: "NL-1",
    amount: 5000,
    vatAmount: 1000,
    description: "Test utan uppgifter",
    ...overrides,
  });
}

/** Faktura via mejlingest – ger inboxItemId + avsändare (mejlförfrågan möjlig). */
function ingestInvoice(input: {
  externalId: string;
  from: string;
  supplier: string;
  invoiceNumber: string;
  amount: number;
  bankgiro?: string;
  ocr?: string;
  detailsConfidence?: number;
}) {
  const result = ingestInboundMail({
    externalId: input.externalId,
    to: "demo@in.driva.se",
    from: input.from,
    subject: `Faktura ${input.invoiceNumber}`,
    text: "Leverantörsfaktura",
    parsed: {
      amount: input.amount,
      vatAmount: Math.round(input.amount / 5),
      supplier: input.supplier,
      invoiceNumber: input.invoiceNumber,
      dueDate: isoDaysFromNow(14).slice(0, 10),
      ocr: input.ocr,
      bankgiro: input.bankgiro,
      detailsConfidence: input.detailsConfidence,
      documentType: "leverantorsfaktura",
      confidence: 0.99,
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("ingest misslyckades");
  const invoice = db().supplierInvoices.find((s) => s.id === result.item.supplierInvoiceId);
  assert.ok(invoice, "fakturan skapades");
  return { item: result.item, invoice: invoice! };
}

beforeEach(() => {
  resetDemoData();
  setTestBankPaymentProvider(null);
  setMailTransportForTests(undefined);
});

describe("tillståndsmodellen och betalningsvakterna", () => {
  it("MISSING: ingen instruktion kan förberedas och inget kan skickas till bank", () => {
    const invoice = receiveMissing();
    assert.equal(paymentDetailsInfo(invoice).cause, "MISSING");
    assert.throws(() => prepareSupplierPayment({ supplierInvoiceId: invoice.id }), /saknas/);
    assert.equal(latestPaymentForInvoice(invoice.id), undefined);

    // Ekonomi-registret visar statusen i klartext.
    const rows = listExpensesForTable({ q: "Ny Leverantör" }).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].statusLabel, "Betalningsuppgifter saknas");
  });

  it("EXTRACTION_UNCERTAIN: osäker läsning blir kandidat – aldrig betalbar", () => {
    const { invoice } = ingestInvoice({
      externalId: "unc-1",
      from: "faktura@osaker.se",
      supplier: "Osäker AB",
      invoiceNumber: "OS-1",
      amount: 4000,
      bankgiro: "123-4567",
      ocr: "424242",
      detailsConfidence: 0.6,
    });
    const info = paymentDetailsInfo(invoice);
    assert.equal(info.cause, "EXTRACTION_UNCERTAIN");
    assert.equal(info.candidate?.account, "123-4567");
    // Kandidaten hamnar ALDRIG i betalfälten.
    assert.equal(invoice.recipientAccount, undefined);
    assert.equal(invoice.bankgiro, undefined);
    assert.throws(() => prepareSupplierPayment({ supplierInvoiceId: invoice.id }), /kontrollera/i);
    assert.equal(latestPaymentForInvoice(invoice.id), undefined);
  });

  it("mänsklig kontroll verifierar med proveniens och gör fakturan betalbar", () => {
    const { invoice } = ingestInvoice({
      externalId: "unc-2",
      from: "faktura@osaker.se",
      supplier: "Osäker AB",
      invoiceNumber: "OS-2",
      amount: 4000,
      bankgiro: "123-4567",
      detailsConfidence: 0.6,
    });
    verifySupplierPaymentDetails({
      supplierInvoiceId: invoice.id,
      method: "bankgiro",
      account: "123-4567",
      ocr: "424242",
    });
    const info = paymentDetailsInfo(invoice);
    assert.equal(info.cause, "VERIFIED");
    assert.equal(info.verified?.source, "document_confirmed");
    assert.equal(invoice.recipientAccount, "123-4567");
    // Nu går instruktionen att förbereda (skickas fortfarande aldrig automatiskt).
    assert.equal(latestPaymentForInvoice(invoice.id)?.status, "READY");
  });

  it("ogiltigt konto avvisas vid manuell komplettering", () => {
    const invoice = receiveMissing({ invoiceNumber: "NL-VAL" });
    assert.throws(
      () => verifySupplierPaymentDetails({ supplierInvoiceId: invoice.id, method: "bankgiro", account: "12" }),
      /Bankgiro/
    );
    assert.equal(paymentDetailsInfo(invoice).cause, "MISSING");
  });

  it("submit är spärrad tills destinationen är verifierad (defense in depth)", () => {
    const invoice = receiveMissing({ invoiceNumber: "NL-GUARD" });
    // Tvinga fram en instruktion bakvägen för att testa den centrala vakten.
    verifySupplierPaymentDetails({ supplierInvoiceId: invoice.id, method: "bankgiro", account: "123-4567" });
    const payment = latestPaymentForInvoice(invoice.id);
    assert.ok(payment);
    // Simulera att uppgifterna backar till MISSING efter att instruktionen skapats.
    invoice.paymentDetails = { state: "MISSING" };
    delete invoice.recipientAccount;
    delete invoice.bankgiro;
    const sent = submitSupplierPayment(payment!.id);
    assert.equal(sent.ok, false);
    if (!sent.ok) assert.match(sent.error, /saknas/);
  });
});

describe("verifierad leverantörshistorik och ändrade uppgifter", () => {
  function payInvoice(supplier: string, invoiceNumber: string, bankgiro: string) {
    const invoice = receiveSupplierInvoice({
      supplier,
      invoiceNumber,
      amount: 1000,
      vatAmount: 200,
      description: "Historik",
      bankgiro,
    });
    const payment = prepareSupplierPayment({ supplierInvoiceId: invoice.id });
    payment.status = "PAID";
    payment.paidAt = new Date().toISOString();
    return invoice;
  }

  it("genomförd betalning blir verifierad historik som kan återanvändas med proveniens", () => {
    payInvoice("Telia", "TEL-OLD", "991-2345");
    const next = receiveSupplierInvoice({
      supplier: "Telia",
      invoiceNumber: "TEL-NY",
      amount: 1295,
      vatAmount: 259,
      description: "Utan uppgifter",
    });
    const info = paymentDetailsInfo(next);
    assert.equal(info.cause, "MISSING");
    assert.equal(info.reusable, true);
    assert.equal(info.previous?.account, "991-2345");
    assert.equal(info.previous?.source, "paid_payment");

    const { invoice, details } = useVerifiedSupplierDetails(next.id);
    assert.equal(details.account, "991-2345");
    assert.equal(invoice.paymentDetails?.verified?.source, "supplier_history");
    assert.equal(paymentDetailsInfo(invoice).cause, "VERIFIED");
    assert.equal(latestPaymentForInvoice(invoice.id)?.status, "READY");
  });

  it("obekräftad dokumentläsning blir ALDRIG baslinje för återanvändning", () => {
    // Bokförd men aldrig betald/bekräftad → proveniens "document".
    receiveSupplierInvoice({
      supplier: "Grus & Co",
      invoiceNumber: "GC-1",
      amount: 700,
      vatAmount: 140,
      description: "Obekräftad",
      bankgiro: "555-6666",
    });
    assert.equal(verifiedDetailsForSupplier("Grus & Co"), undefined);
    const next = receiveSupplierInvoice({
      supplier: "Grus & Co",
      invoiceNumber: "GC-2",
      amount: 900,
      vatAmount: 180,
      description: "Utan uppgifter",
    });
    assert.equal(paymentDetailsInfo(next).reusable, false);
    assert.throws(() => useVerifiedSupplierDetails(next.id), /inga tidigare verifierade/);
  });

  it("CHANGED kräver explicit mänskligt godkännande – aldrig automatik, aldrig återanvändning", () => {
    payInvoice("Beijer Bygg", "BB-OLD2", "1111-2222");
    const next = receiveSupplierInvoice({
      supplier: "Beijer Bygg",
      invoiceNumber: "BB-NY2",
      amount: 800,
      vatAmount: 160,
      description: "Nytt konto",
      bankgiro: "9999-0000",
    });
    assert.equal(paymentDetailsInfo(next).cause, "CHANGED");
    // Gamla uppgifter får inte återanvändas rakt över en flaggad ändring.
    assert.throws(() => useVerifiedSupplierDetails(next.id), /kontrollera ändringen/i);

    const payment = prepareSupplierPayment({ supplierInvoiceId: next.id });
    assert.equal(payment.destinationChanged, true);
    assert.equal(payment.status, "DRAFT");
    const blocked = submitSupplierPayment(payment.id);
    assert.equal(blocked.ok, false);

    confirmChangedPaymentDetails(next.id);
    assert.equal(paymentDetailsInfo(next).cause, "VERIFIED");
    assert.equal(next.paymentDetails?.verified?.source, "document_confirmed");
    const after = latestPaymentForInvoice(next.id);
    assert.equal(after?.destinationChanged, false);
    assert.equal(after?.status, "READY");
  });
});

describe("åtgärdsmotorn: status ≠ åtgärd", () => {
  it("MISSING utan lösningsväg visas INTE på Hem – bara i registren", () => {
    const invoice = receiveMissing({ invoiceNumber: "NL-HEM" });
    const actions = getBusinessActions();
    assert.ok(!actions.attention.some((a) => a.id === `supplier-bank-${invoice.id}`));
    // Och aldrig ett generiskt "Öppna dokumentet" som låtsad åtgärd.
    for (const a of actions.attention) {
      if (!a.id.startsWith("supplier-")) continue;
      assert.notEqual(a.cta?.type === "link" && a.cta.label === "Öppna dokumentet", true, a.id);
    }
  });

  it("EXTRACTION_UNCERTAIN får en riktig Kontrollera-rad med kandidaten", () => {
    const { invoice } = ingestInvoice({
      externalId: "unc-hem",
      from: "faktura@osaker.se",
      supplier: "Osäker AB",
      invoiceNumber: "OS-HEM",
      amount: 4000,
      bankgiro: "123-4567",
      detailsConfidence: 0.6,
    });
    const row = getBusinessActions().attention.find((a) => a.id === `supplier-verify-${invoice.id}`);
    assert.ok(row, "kontrollera-raden finns");
    assert.equal(row!.cta?.type, "verifyPaymentDetails");
    if (row!.cta?.type === "verifyPaymentDetails") {
      assert.equal(row!.cta.candidateAccount, "123-4567");
    }
  });

  it("verifierad historik ger en Använd tidigare uppgifter-rad med bekräftelse", () => {
    const old = receiveSupplierInvoice({
      supplier: "Telia",
      invoiceNumber: "TEL-H1",
      amount: 1000,
      vatAmount: 200,
      description: "Historik",
      bankgiro: "991-2345",
    });
    const paid = prepareSupplierPayment({ supplierInvoiceId: old.id });
    paid.status = "PAID";
    paid.paidAt = new Date().toISOString();
    const next = receiveSupplierInvoice({
      supplier: "Telia",
      invoiceNumber: "TEL-H2",
      amount: 1295,
      vatAmount: 259,
      description: "Utan uppgifter",
    });
    const row = getBusinessActions().attention.find((a) => a.id === `supplier-reuse-${next.id}`);
    assert.ok(row);
    assert.equal(row!.cta?.type, "useVerifiedSupplierDetails");
    assert.ok(row!.confirm, "bekräftelseinnehåll från motorn");
    assert.match(row!.subtitle, /991-2345/);
  });

  it("CHANGED är en urgent-rad med explicit godkännandeflöde", () => {
    const old = receiveSupplierInvoice({
      supplier: "Beijer Bygg",
      invoiceNumber: "BB-H1",
      amount: 500,
      vatAmount: 100,
      description: "Historik",
      bankgiro: "1111-2222",
    });
    const paid = prepareSupplierPayment({ supplierInvoiceId: old.id });
    paid.status = "PAID";
    paid.paidAt = new Date().toISOString();
    const next = receiveSupplierInvoice({
      supplier: "Beijer Bygg",
      invoiceNumber: "BB-H2",
      amount: 800,
      vatAmount: 160,
      description: "Nytt konto",
      bankgiro: "9999-0000",
    });
    const row = getBusinessActions().attention.find((a) => a.id === `supplier-dest-${next.id}`);
    assert.ok(row);
    assert.equal(row!.priority, "urgent");
    assert.equal(row!.cta?.type, "confirmChangedSupplierDetails");
    assert.match(row!.subtitle, /1111-2222/);
    assert.match(row!.subtitle, /9999-0000/);
  });

  it("flera likadana rader grupperas till EN rad med fokuserad kö", () => {
    setMailTransportForTests(async () => {});
    for (let i = 0; i < PAYMENT_DETAILS_GROUP_THRESHOLD; i++) {
      ingestInvoice({
        externalId: `grp-${i}`,
        from: `faktura@grupp${i}.se`,
        supplier: `Gruppleverantör ${i} AB`,
        invoiceNumber: `GRP-${i}`,
        amount: 1000 + i,
        bankgiro: "123-4567",
        detailsConfidence: 0.5,
      });
    }
    const actions = getBusinessActions();
    const group = actions.attention.find((a) => a.id === "supplier-details-group");
    assert.ok(group, "gruppraden finns");
    // + 1: seedens sup-hyra-sep saknar uppgifter men har verifierad historik
    // (betald augustihyra) → återanvändningsrad som ingår i samma kö.
    const expected = PAYMENT_DETAILS_GROUP_THRESHOLD + 1;
    assert.match(group!.title, new RegExp(`^${expected} leverantörsfakturor`));
    assert.equal(group!.cta?.type, "paymentDetailsQueue");
    if (group!.cta?.type === "paymentDetailsQueue") {
      const items = group!.cta.items;
      assert.equal(items.length, expected);
      assert.equal(items.filter((i) => i.action.kind === "verify").length, PAYMENT_DETAILS_GROUP_THRESHOLD);
      assert.ok(items.some((i) => i.supplierInvoiceId === "sup-hyra-sep" && i.action.kind === "reuse"));
    }
    // Inga enskilda rader kvar bredvid gruppen.
    assert.ok(!actions.attention.some((a) => a.id.startsWith("supplier-verify-")));
    assert.ok(!actions.attention.some((a) => a.id.startsWith("supplier-reuse-")));
  });
});

describe("mejlförfrågan till leverantören", () => {
  it("utan e-postleverantör: ingen knapp, ingen Hem-rad, ärligt fel", async () => {
    const { invoice } = ingestInvoice({
      externalId: "req-none",
      from: "faktura@tystnad.se",
      supplier: "Tystnad AB",
      invoiceNumber: "TY-1",
      amount: 2000,
    });
    assert.equal(paymentDetailsInfo(invoice).cause, "MISSING");
    const actions = getBusinessActions();
    assert.ok(!actions.attention.some((a) => a.id === `supplier-bank-${invoice.id}`));
    const result = await requestPaymentDetailsFromSupplier(invoice.id);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /e-postleverantör/i);
  });

  it("med provider: Hem-rad med förfrågan, utskick → Väntar på leverantören, av aktiva listan", async () => {
    const sent: MailMessage[] = [];
    setMailTransportForTests(async (m) => {
      sent.push(m);
    });
    const { item, invoice } = ingestInvoice({
      externalId: "req-ok",
      from: "faktura@svarare.se",
      supplier: "Svarare AB",
      invoiceNumber: "SV-1",
      amount: 3000,
    });
    const row = getBusinessActions().attention.find((a) => a.id === `supplier-bank-${invoice.id}`);
    assert.ok(row, "förfrågansraden finns när mejl är möjligt");
    assert.equal(row!.cta?.type, "requestSupplierDetails");
    assert.ok(row!.confirm, "externt utskick kräver bekräftelseinnehåll");

    const badgeBefore = countInboxBadge();
    const result = await requestPaymentDetailsFromSupplier(invoice.id);
    assert.equal(result.ok, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "faktura@svarare.se");
    assert.match(sent[0].text, /SV-1/);

    assert.equal(paymentDetailsInfo(invoice).cause, "AWAITING_SUPPLIER");
    const after = getBusinessActions();
    assert.ok(!after.attention.some((a) => a.id.includes(invoice.id)), "borta från aktiva listan");
    assert.ok(after.watching.some((w) => w.id === `supplier-await-${invoice.id}`), "bevakas under På gång");
    assert.equal(getInboxView(item.id)?.display.label, "Väntar på leverantören");
    assert.ok(countInboxBadge() < badgeBefore, "badgen räknar inte väntan på extern part");

    // Idempotent: andra försöket skickar inget nytt mejl.
    const again = await requestPaymentDetailsFromSupplier(invoice.id);
    assert.equal(again.ok, true);
    if (again.ok) assert.equal(again.alreadyRequested, true);
    assert.equal(sent.length, 1);
  });

  it("leverantörens svar matchas tillbaka och kompletterar fakturan", async () => {
    setMailTransportForTests(async () => {});
    const { invoice } = ingestInvoice({
      externalId: "req-reply",
      from: "faktura@svarare.se",
      supplier: "Svarare AB",
      invoiceNumber: "SV-2",
      amount: 3000,
    });
    await requestPaymentDetailsFromSupplier(invoice.id);
    assert.equal(paymentDetailsInfo(invoice).cause, "AWAITING_SUPPLIER");

    // Svar utan komplett fakturadata men med säkra betalningsuppgifter.
    const reply = ingestInboundMail({
      externalId: "req-reply-2",
      to: "demo@in.driva.se",
      from: "faktura@svarare.se",
      subject: "Re: Betalningsuppgifter för faktura SV-2",
      text: "Hej! Bankgiro 777-8888, OCR 90909.",
      parsed: {
        supplier: "Svarare AB",
        invoiceNumber: "SV-2",
        bankgiro: "777-8888",
        ocr: "90909",
        documentType: "leverantorsfaktura",
        confidence: 0.99,
        detailsConfidence: 0.99,
      },
    });
    assert.equal(reply.ok, true);
    if (!reply.ok) return;
    assert.equal(reply.item.supplierInvoiceId, invoice.id);
    const info = paymentDetailsInfo(invoice);
    assert.equal(info.cause, "VERIFIED");
    assert.equal(invoice.recipientAccount, "777-8888");
    assert.equal(latestPaymentForInvoice(invoice.id)?.status, "READY");
  });
});

describe("AI: sanning och aldrig påhittade uppgifter", () => {
  it("förklarar ärligt varför en faktura inte kan betalas", async () => {
    const invoice = receiveMissing({ supplier: "Beijer Bygg", invoiceNumber: "BB-AI" });
    const result = await executeTool("get_supplier_invoice", { invoiceId: invoice.id }, { origin: "ai" });
    assert.equal(result.ok, true);
    const model = result.forModel as { paymentDetails?: { state: string; blockedReason: string | null } };
    assert.equal(model.paymentDetails?.state, "MISSING");
    assert.match(model.paymentDetails?.blockedReason ?? "", /Betalningsuppgifter saknas/);
  });

  it("återanvändning kräver verifierad historik + mänsklig bekräftelse", async () => {
    // Utan historik: verktyget vägrar – AI:n kan inte ange konto själv
    // (parametern finns inte; uppgifterna hämtas alltid ur domänen).
    const orphan = receiveMissing({ supplier: "Okänd AB", invoiceNumber: "OK-1" });
    const denied = await executeTool("use_verified_supplier_details", { invoiceId: orphan.id }, { origin: "ai" });
    assert.equal(denied.ok, false);

    // Med historik: bekräftelsekort – inget händer före godkännandet.
    const old = receiveSupplierInvoice({
      supplier: "Telia",
      invoiceNumber: "TEL-AI1",
      amount: 1000,
      vatAmount: 200,
      description: "Historik",
      bankgiro: "991-2345",
    });
    const paid = prepareSupplierPayment({ supplierInvoiceId: old.id });
    paid.status = "PAID";
    paid.paidAt = new Date().toISOString();
    const next = receiveSupplierInvoice({
      supplier: "Telia",
      invoiceNumber: "TEL-AI2",
      amount: 1295,
      vatAmount: 259,
      description: "Utan uppgifter",
    });
    const tool = await executeTool("use_verified_supplier_details", { invoiceId: next.id }, { origin: "ai" });
    assert.equal(tool.ok, true);
    assert.equal(tool.requiresConfirmation, true);
    assert.equal(paymentDetailsInfo(next).cause, "MISSING", "inget ändras före bekräftelsen");

    const pending = db().pendingActions.find((a) => a.type === "anvand_leverantorsuppgifter");
    assert.ok(pending);
    await confirmPendingAction(pending!.id);
    assert.equal(paymentDetailsInfo(next).cause, "VERIFIED");
    assert.equal(next.paymentDetails?.verified?.source, "supplier_history");
  });

  it("vägrar återanvända över en flaggad ändring", async () => {
    const old = receiveSupplierInvoice({
      supplier: "Beijer Bygg",
      invoiceNumber: "BB-AI2",
      amount: 500,
      vatAmount: 100,
      description: "Historik",
      bankgiro: "1111-2222",
    });
    const paid = prepareSupplierPayment({ supplierInvoiceId: old.id });
    paid.status = "PAID";
    paid.paidAt = new Date().toISOString();
    const next = receiveSupplierInvoice({
      supplier: "Beijer Bygg",
      invoiceNumber: "BB-AI3",
      amount: 800,
      vatAmount: 160,
      description: "Nytt konto",
      bankgiro: "9999-0000",
    });
    const tool = await executeTool("use_verified_supplier_details", { invoiceId: next.id }, { origin: "ai" });
    assert.equal(tool.ok, false);
  });
});
