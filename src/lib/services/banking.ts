import { db, save } from "../store";
import { uid } from "../ids";
import type { BankTransaction } from "../types";
import { getInvoice, invoiceTotals, requireCustomer } from "./data";
import { markInvoicePaid } from "./invoices";
import { entriesSupplierInvoicePaid } from "../bas";
import { kr } from "../format";
import { logActivity } from "./activity";

/**
 * Open Banking-abstraktion.
 *
 * BankProvider är gränssnittet mot en riktig leverantör (t.ex. Tink, GoCardless
 * eller Enable Banking): kontosaldo + transaktionsström. MockBankProvider
 * simulerar händelser så att matchningsmotorn kan demonstreras på riktigt.
 * Matchningsmotorn (`matchIncomingTransaction`) är densamma oavsett provider.
 */

export interface BankProvider {
  readonly name: string;
  /** I en riktig integration: hämta nya transaktioner sedan senaste synk. */
  sync(): BankTransaction[];
}

/** Matcha en inkommande banktransaktion mot obetalda kundfakturor. */
export function matchIncomingTransaction(txId: string): boolean {
  const data = db();
  const tx = data.bankTransactions.find((t) => t.id === txId);
  if (!tx || tx.amount <= 0 || tx.status === "bokford") return false;

  const open = data.invoices.filter((i) => i.status === "skickad");

  // 1. Säkrast: OCR-referens.
  let match = open.find((i) => tx.reference?.includes(i.ocr));
  // 2. Annars: exakt belopp (om entydigt).
  if (!match) {
    const byAmount = open.filter((i) => invoiceTotals(i).toPay === tx.amount);
    if (byAmount.length === 1) match = byAmount[0];
  }

  if (match) {
    markInvoicePaid(match.id, { bankTransactionId: tx.id, matchedBy: "auto" });
    return true;
  }

  tx.status = "behover_atgard";
  logActivity(`En inbetalning på ${kr(tx.amount)} från ${tx.counterpart} kunde inte matchas mot någon faktura.`);
  save();
  return false;
}

/** Demo: simulera att kunden betalar en faktura – hela kedjan körs på riktigt. */
export function simulateIncomingPayment(invoiceId: string): void {
  const data = db();
  const invoice = getInvoice(invoiceId);
  if (!invoice || invoice.status !== "skickad") return;
  const customer = requireCustomer(invoice.customerId);
  const t = invoiceTotals(invoice);
  const tx: BankTransaction = {
    id: uid(),
    accountId: data.bankAccounts[0].id,
    date: new Date().toISOString(),
    amount: t.toPay,
    counterpart: customer.name,
    description: "Inbetalning bankgiro",
    reference: `OCR ${invoice.ocr}`,
    status: "ny",
  };
  data.bankTransactions.unshift(tx);
  data.bankAccounts[0].balance += t.toPay;
  save();
  matchIncomingTransaction(tx.id);
}

/** Demo: betala en leverantörsfaktura från banken – matchas och bokförs. */
export function paySupplierInvoice(supplierInvoiceId: string): void {
  const data = db();
  const sup = data.supplierInvoices.find((s) => s.id === supplierInvoiceId);
  if (!sup || sup.status === "betald") return;
  const now = new Date().toISOString();
  const tx: BankTransaction = {
    id: uid(),
    accountId: data.bankAccounts[0].id,
    date: now,
    amount: -sup.amount,
    counterpart: sup.supplier,
    description: `Bankgiro ${sup.supplier.toUpperCase()}`,
    status: "bokford",
    matchedType: "leverantorsfaktura",
    matchedId: sup.id,
  };
  const ver = {
    id: uid(),
    series: "A" as const,
    number: data.sequences.verification++,
    date: now,
    description: `Betalning ${sup.supplier} ${sup.invoiceNumber}`,
    entries: entriesSupplierInvoicePaid(sup.amount),
    source: { type: "leverantorsfaktura" as const, id: sup.id },
    confidence: "hog" as const,
    createdBy: "auto" as const,
    createdAt: now,
  };
  tx.verificationId = ver.id;
  data.verifications.push(ver);
  data.bankTransactions.unshift(tx);
  data.bankAccounts[0].balance -= sup.amount;
  sup.status = "betald";
  sup.bankTransactionId = tx.id;
  sup.paymentVerificationId = ver.id;
  logActivity(`${sup.supplier} ${sup.invoiceNumber} betalades (${kr(sup.amount)}) och bokfördes.`);
  save();
}

/** Bankavstämning: allt utom det som behöver åtgärd är avstämt. */
export function reconciliationStatus() {
  const txs = db().bankTransactions;
  const needsAction = txs.filter((t) => t.status === "behover_atgard" || t.status === "ny").length;
  return { total: txs.length, needsAction, reconciled: txs.length - needsAction };
}
