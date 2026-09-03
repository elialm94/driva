import { db, save } from "../store";
import { uid } from "../ids";
import type { BankTransaction } from "../types";
import { getInvoice, invoiceOutstanding, isOpenReceivable, requireCustomer } from "./data";
import { entriesSupplierInvoicePaid } from "../bas";
import { kr } from "../format";
import { logActivity } from "./activity";
import { logAudit } from "../accounting/audit";
import { postVerification } from "../accounting/engine";
import { assertDemoMode } from "../demo";
import { connectedBankAccount } from "../banking/connection-state";
import { processIncomingTransaction } from "./payment-matching";
import { expectedTaxReductionPayouts } from "./tax-reduction";

/**
 * Open Banking-abstraktion.
 *
 * BankProvider (lib/banking/provider.ts) är gränssnittet mot leverantören:
 * startConnect · handleCallback · refresh · listAccounts · listTransactions ·
 * disconnect. LiveTinkProvider (Tink AIS) för riktiga företag med TINK_*-miljö,
 * MockBankProvider för demo. Riktiga flöden bär öre – beloppen avrundas till
 * hela kronor VID IMPORTGRÄNSEN (se README-ADR); matchningen tolererar
 * öresdiffar och bokar dem på 3740. Importen går alltid via
 * registerBankTransactions nedan – matchningsmotorn känner inte leverantören.
 *
 * Alla funktioner som HITTAR PÅ pengar (simulera inbetalning, betala
 * leverantörsfaktura utan riktig bank) är demo-gated (lib/demo.ts): i en
 * produktionsmiljö utan bankkoppling visas ett ärligt oconfigurerat läge.
 */

export type { BankProvider } from "../banking/provider";

/**
 * Registrera importerade banktransaktioner idempotent: transaktioner med ett
 * `externalId` som redan finns skapar ingen dubblett och körs inte om genom
 * matchningen. Motpart/beskrivning/referens skrivs ändå över från leverantören
 * så att en om-synk (Uppdatera) kan fylla kolumnerna utan ny koppling.
 */
export function registerBankTransactions(incoming: BankTransaction[]): { imported: number; skipped: number } {
  const data = db();
  const known = new Map<string, BankTransaction>();
  for (const existing of data.bankTransactions) {
    if (existing.externalId) known.set(`${existing.accountId}:${existing.externalId}`, existing);
  }
  let imported = 0;
  let skipped = 0;
  let labelsTouched = false;
  for (const tx of incoming) {
    const existing = tx.externalId ? known.get(`${tx.accountId}:${tx.externalId}`) : undefined;
    if (existing) {
      skipped++;
      if (refreshImportedBankLabels(existing, tx)) labelsTouched = true;
      continue;
    }
    if (!Number.isInteger(tx.amount)) {
      // Öre-gränsen: hela kronor i systemet – avrunda vid importen.
      tx.amount = Math.round(tx.amount);
    }
    data.bankTransactions.unshift(tx);
    if (tx.externalId) known.set(`${tx.accountId}:${tx.externalId}`, tx);
    imported++;
    save();
    processIncomingTransaction(tx.id);
  }
  if (imported > 0 || labelsTouched) save();
  return { imported, skipped };
}

/** Visningsfält från banken – aldrig belopp, status eller matchning. */
export function refreshImportedBankLabels(existing: BankTransaction, incoming: BankTransaction): boolean {
  let changed = false;
  if (incoming.counterpart !== existing.counterpart) {
    existing.counterpart = incoming.counterpart;
    changed = true;
  }
  if (incoming.description !== existing.description) {
    existing.description = incoming.description;
    changed = true;
  }
  if (incoming.reference && incoming.reference !== existing.reference) {
    existing.reference = incoming.reference;
    changed = true;
  }
  return changed;
}

/**
 * Matcha en inkommande banktransaktion mot obetalda kundfakturor.
 * Returnerar true endast när betalningen bokfördes automatiskt.
 */
export function matchIncomingTransaction(txId: string): boolean {
  const tx = db().bankTransactions.find((t) => t.id === txId);
  if (!tx || tx.amount <= 0 || tx.status === "bokford") return false;
  return processIncomingTransaction(txId).outcome === "booked";
}

/** Demo: simulera att kunden betalar en faktura – hela kedjan körs på riktigt. */
export function simulateIncomingPayment(invoiceId: string, opts: { amount?: number } = {}): void {
  assertDemoMode("Simulerad inbetalning");
  const data = db();
  const invoice = getInvoice(invoiceId);
  if (!invoice || !isOpenReceivable(invoice)) return;
  const account = connectedBankAccount();
  if (!account) throw new Error("Ingen bank är kopplad – det finns inget konto att simulera inbetalningen mot.");
  const customer = requireCustomer(invoice.customerId);
  const amount = opts.amount ?? invoiceOutstanding(invoice);
  if (!Number.isInteger(amount) || amount < 1) throw new Error("Beloppet måste vara minst 1 kr.");
  const tx: BankTransaction = {
    id: uid(),
    accountId: account.id,
    externalId: `demo-${uid()}`,
    date: new Date().toISOString(),
    amount,
    counterpart: customer.name,
    description: "Inbetalning bankgiro",
    reference: `OCR ${invoice.ocr}`,
    status: "ny",
  };
  data.bankTransactions.unshift(tx);
  account.balance += amount;
  save();
  processIncomingTransaction(tx.id);
}

/**
 * Demo: simulera Skatteverkets ROT/RUT-utbetalning för ett ärende.
 * Utan belopp betalas hela den väntade summan; ett lägre belopp demonstrerar
 * delvis godkännande (restfakturaflödet).
 */
export function simulateTaxReductionPayout(input: { jobId?: string; invoiceId?: string; amount?: number }): void {
  assertDemoMode("Simulerad ROT/RUT-utbetalning");
  const data = db();
  const account = connectedBankAccount();
  if (!account) throw new Error("Ingen bank är kopplad – det finns inget konto att simulera utbetalningen mot.");
  const payout = expectedTaxReductionPayouts().find(
    (p) => (input.jobId && p.jobId === input.jobId) || (input.invoiceId && p.invoiceId === input.invoiceId)
  );
  if (!payout) throw new Error("Ingen ROT/RUT-ansökan väntar på utbetalning för det här ärendet.");
  const amount = input.amount ?? payout.expectedAmount;
  if (!Number.isInteger(amount) || amount < 1) throw new Error("Beloppet måste vara minst 1 kr.");
  const tx: BankTransaction = {
    id: uid(),
    accountId: account.id,
    externalId: `demo-${uid()}`,
    date: new Date().toISOString(),
    amount,
    counterpart: "Skatteverket",
    description: `Utbetalning ${payout.type.toUpperCase()}`,
    reference: payout.label,
    status: "ny",
  };
  data.bankTransactions.unshift(tx);
  account.balance += amount;
  save();
  processIncomingTransaction(tx.id);
}

/** Demo: betala en leverantörsfaktura från banken – matchas och bokförs. */
export function paySupplierInvoice(supplierInvoiceId: string): void {
  assertDemoMode("Leverantörsbetalning utan bankkoppling");
  const data = db();
  const sup = data.supplierInvoices.find((s) => s.id === supplierInvoiceId);
  if (!sup || sup.status === "betald") return;
  const account = connectedBankAccount();
  if (!account) throw new Error("Ingen bank är kopplad – det finns inget konto att betala från.");
  const now = new Date().toISOString();
  const tx: BankTransaction = {
    id: uid(),
    accountId: account.id,
    externalId: `demo-${uid()}`,
    date: now,
    amount: -sup.amount,
    counterpart: sup.supplier,
    description: `Bankgiro ${sup.supplier.toUpperCase()}`,
    status: "bokford",
    matchedType: "leverantorsfaktura",
    matchedId: sup.id,
  };
  const ver = postVerification({
    date: now,
    description: `Betalning ${sup.supplier} ${sup.invoiceNumber}`,
    entries: entriesSupplierInvoicePaid(sup.amount),
    source: { type: "leverantorsfaktura", id: sup.id },
    confidence: "hog",
    createdBy: "auto",
    explanation: `Betalningen drogs från företagskontot och leverantörsskulden till ${sup.supplier} bockades av. Kostnaden och momsen bokfördes redan när fakturan togs emot.`,
  });
  tx.verificationId = ver.id;
  data.bankTransactions.unshift(tx);
  account.balance -= sup.amount;
  sup.status = "betald";
  sup.accountingStatus = sup.accountingStatus ?? "bokford";
  sup.bankTransactionId = tx.id;
  sup.paymentVerificationId = ver.id;
  data.supplierPayments ??= [];
  const existingPay = data.supplierPayments.find((p) => p.supplierInvoiceId === sup.id && p.status !== "CANCELLED");
  const nowPay = new Date().toISOString();
  if (existingPay) {
    existingPay.status = "PAID";
    existingPay.bankTransactionId = tx.id;
    existingPay.paidAt = nowPay;
    existingPay.updatedAt = nowPay;
  } else {
    data.supplierPayments.push({
      id: `spay-${uid()}`,
      supplierInvoiceId: sup.id,
      amount: sup.amount,
      currency: "SEK",
      dueDate: sup.dueDate,
      scheduledDate: now.slice(0, 10),
      ocr: sup.ocr,
      recipientAccount: sup.recipientAccount ?? sup.bankgiro ?? "",
      recipientName: sup.supplier,
      idempotencyKey: `suppay:${sup.id}:${sup.amount}:demo`,
      status: "PAID",
      bankTransactionId: tx.id,
      createdAt: nowPay,
      updatedAt: nowPay,
      paidAt: nowPay,
    });
  }
  logAudit("system", "banktransaktion_bokford", `Leverantörsbetalning ${kr(sup.amount)} till ${sup.supplier} bokfördes.`, {
    targetType: "leverantorsfaktura",
    targetId: sup.id,
  });
  logActivity(`${sup.supplier} ${sup.invoiceNumber} betalades (${kr(sup.amount)}) och bokfördes.`);
  save();
}
