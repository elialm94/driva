process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNTING_STATE,
  COLLABORATION_STATUS,
  EXPENSE_STATUS,
  INBOX_ITEM_STATUS,
  INVOICE_CREDIT_NOTE,
  INVOICE_STATUS,
  INVOICE_STATUS_FILTER,
  JOB_STATUS,
  PAYMENT_DETAILS_CAUSE,
  QUOTE_STATUS,
  QUOTE_STATUS_FILTER,
  QUOTE_TIMELINE,
  SUPPLIER_INVOICE_LIFECYCLE,
  SUPPORT_TICKET_STATUS,
  TAX_REDUCTION_STATUS,
  TX_STATUS,
  VAT_PERIOD_STATE,
  invoiceOverdueLabel,
  quoteWaitingLabel,
  signedWithBankIdBy,
  supplierPaymentStatus,
  type StatusLabel,
} from "./status-labels";

/**
 * Statusspråket är en produktyta: samma domäntillstånd = samma ord överallt,
 * BankID endast som metod i historik, inga engelska/tekniska statusord.
 */

function allStatusLabels(): string[] {
  const maps: Record<string, StatusLabel>[] = [
    QUOTE_STATUS,
    INVOICE_STATUS,
    JOB_STATUS,
    TX_STATUS,
    EXPENSE_STATUS,
    SUPPLIER_INVOICE_LIFECYCLE,
    PAYMENT_DETAILS_CAUSE,
    INBOX_ITEM_STATUS,
    ACCOUNTING_STATE,
    VAT_PERIOD_STATE,
    TAX_REDUCTION_STATUS,
    COLLABORATION_STATUS,
    SUPPORT_TICKET_STATUS,
  ];
  const labels = maps.flatMap((m) => Object.values(m).map((v) => v.label));
  labels.push(INVOICE_CREDIT_NOTE.label);
  labels.push(...Object.values(QUOTE_STATUS_FILTER), ...Object.values(INVOICE_STATUS_FILTER));
  return labels;
}

describe("status-labels: kanoniskt ordförråd", () => {
  it("ingen statusetikett innehåller BankID – metoden hör hemma i historiken", () => {
    for (const label of allStatusLabels()) {
      assert.ok(!/bankid/i.test(label), `"${label}" får inte nämna BankID som status`);
    }
  });

  it("inga engelska eller tekniska statusord läcker till UI:t", () => {
    const forbidden = /\b(pending|processing|failed|completed?|done|open|closed|sent|posted|reconciled|submitted|revoked|active|draft|paid|overdue)\b/i;
    for (const label of allStatusLabels()) {
      assert.ok(!forbidden.test(label), `"${label}" innehåller ett förbjudet statusord`);
    }
  });

  it("offert: skickad = Väntar på signering, godkänd = Signerad", () => {
    assert.equal(QUOTE_STATUS.skickad.label, "Väntar på signering");
    assert.equal(QUOTE_STATUS.godkand.label, "Signerad");
    assert.equal(QUOTE_STATUS_FILTER.skickad, "Väntar på signering");
  });

  it("öppnad offert visas som Öppnad · väntar på signering", () => {
    assert.equal(quoteWaitingLabel({ viewed: true }), "Öppnad · väntar på signering");
    assert.equal(quoteWaitingLabel(), "Väntar på signering");
  });

  it("BankID är metod i tidslinjen: Signerad med BankID av <namn>", () => {
    assert.equal(QUOTE_TIMELINE.signerad, "Signerad med BankID");
    assert.equal(signedWithBankIdBy("Sara Nilsson"), "Signerad med BankID av Sara Nilsson");
  });

  it("faktura: förfallen heter Förfallen och böjs per dag", () => {
    assert.equal(invoiceOverdueLabel().label, "Förfallen");
    assert.equal(invoiceOverdueLabel(1).label, "Förfallen 1 dag");
    assert.equal(invoiceOverdueLabel(7).label, "Förfallen 7 dagar");
    assert.equal(invoiceOverdueLabel(7).tone, "danger");
    assert.equal(INVOICE_STATUS_FILTER.forfallen, "Förfallna");
  });

  it("leverantörsfakturans livscykel använder de kanoniska etiketterna", () => {
    assert.equal(SUPPLIER_INVOICE_LIFECYCLE.BEHOVER_KONTROLL.label, "Behöver kontroll");
    assert.equal(SUPPLIER_INVOICE_LIFECYCLE.BOKFORD.label, "Bokförd");
    assert.equal(SUPPLIER_INVOICE_LIFECYCLE.REDO_ATT_BETALA.label, "Redo att betala");
    assert.equal(SUPPLIER_INVOICE_LIFECYCLE.BANKFIL_SKAPAD.label, "Bankfil skapad");
    assert.equal(SUPPLIER_INVOICE_LIFECYCLE.VANTAR_PA_BETALNING.label, "Väntar på betalning");
    assert.equal(SUPPLIER_INVOICE_LIFECYCLE.BETALD.label, "Betald");
    assert.equal(SUPPLIER_INVOICE_LIFECYCLE.AVSTAMD.label, "Avstämd");
  });

  it("betalningsinstruktion: READY/DRAFT = Redo att betala, SCHEDULED = Betalas <datum>", () => {
    assert.equal(supplierPaymentStatus("READY").label, "Redo att betala");
    assert.equal(supplierPaymentStatus("DRAFT").label, "Redo att betala");
    assert.equal(
      supplierPaymentStatus("SCHEDULED", { scheduledDate: "2026-09-03", formatDate: () => "3 sep" }).label,
      "Betalas 3 sep"
    );
    assert.equal(supplierPaymentStatus("SCHEDULED").label, "Betalning planerad");
    assert.equal(supplierPaymentStatus("FAILED").tone, "danger");
  });

  it("betalningsuppgifter: orsaken säger vad som behöver hända", () => {
    assert.equal(PAYMENT_DETAILS_CAUSE.MISSING.label, "Betalningsuppgifter saknas");
    assert.equal(PAYMENT_DETAILS_CAUSE.AWAITING_SUPPLIER.label, "Väntar på leverantören");
    assert.equal(PAYMENT_DETAILS_CAUSE.EXTRACTION_UNCERTAIN.label, "Kontrollera betalningsuppgifter");
  });

  it("samarbete och support använder klarspråksetiketterna", () => {
    assert.equal(COLLABORATION_STATUS.accepted.label, "Ansluten");
    assert.equal(COLLABORATION_STATUS.pending.label, "Inbjudan skickad");
    assert.equal(COLLABORATION_STATUS.revoked.label, "Åtkomst borttagen");
    assert.equal(SUPPORT_TICKET_STATUS.open.label, "Öppet");
    assert.equal(SUPPORT_TICKET_STATUS.in_progress.label, "Pågår");
    assert.equal(SUPPORT_TICKET_STATUS.waiting_on_customer.label, "Väntar på kunden");
    assert.equal(SUPPORT_TICKET_STATUS.resolved.label, "Löst");
  });

  it("färgsemantik: väntar = gul, försenat/fel = röd, klart = grön", () => {
    assert.equal(QUOTE_STATUS.skickad.tone, "warn");
    assert.equal(QUOTE_STATUS.godkand.tone, "ok");
    assert.equal(JOB_STATUS.pagar.tone, "info");
    assert.equal(JOB_STATUS.klart.tone, "ok");
    assert.equal(EXPENSE_STATUS.saknar_kvitto.tone, "warn");
    assert.equal(SUPPLIER_INVOICE_LIFECYCLE.BETALD.tone, "ok");
    assert.equal(PAYMENT_DETAILS_CAUSE.CHANGED.tone, "danger");
  });
});
