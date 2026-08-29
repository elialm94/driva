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
import { processIncomingTransaction } from "./payment-matching";
import { expectedTaxReductionPayouts } from "./tax-reduction";

/**
 * Open Banking-abstraktion.
 *
 * BankProvider är gränssnittet mot en riktig leverantör (t.ex. Tink, GoCardless
 * eller Enable Banking): kontosaldo + transaktionsström. Riktiga flöden bär
 * öre – beloppen avrundas till hela kronor VID IMPORTGRÄNSEN (se README-ADR);
 * matchningen tolererar öresdiffar och bokar dem på 3740.
 *
 * Alla funktioner som HITTAR PÅ pengar (simulera inbetalning, betala
 * leverantörsfaktura utan riktig bank) är demo-gated (lib/demo.ts): i en
 * produktionsmiljö utan bankkoppling visas ett ärligt oconfigurerat läge.
 */

export interface BankProvider {
  readonly name: string;
  /** I en riktig integration: hämta nya transaktioner sedan senaste synk. */
  sync(): BankTransaction[];
}

/**
 * Registrera importerade banktransaktioner idempotent: transaktioner med ett
 * `externalId` som redan finns hoppar över (databasen har dessutom ett unikt
 * index). Nya inbetalningar körs genom matchningsmotorn.
 */
export function registerBankTransactions(incoming: BankTransaction[]): { imported: number; skipped: number } {
  const data = db();
  const known = new Set(
    data.bankTransactions.filter((t) => t.externalId).map((t) => `${t.accountId}:${t.externalId}`)
  );
  let imported = 0;
  let skipped = 0;
  for (const tx of incoming) {
    if (tx.externalId && known.has(`${tx.accountId}:${tx.externalId}`)) {
      skipped++;
      continue;
    }
    if (!Number.isInteger(tx.amount)) {
      // Öre-gränsen: hela kronor i systemet – avrunda vid importen.
      tx.amount = Math.round(tx.amount);
    }
    data.bankTransactions.unshift(tx);
    if (tx.externalId) known.add(`${tx.accountId}:${tx.externalId}`);
    imported++;
    save();
    processIncomingTransaction(tx.id);
  }
  if (imported > 0) save();
  return { imported, skipped };
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
  const account = data.bankAccounts[0];
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
  const account = data.bankAccounts[0];
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
  const account = data.bankAccounts[0];
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
  sup.bankTransactionId = tx.id;
  sup.paymentVerificationId = ver.id;
  logAudit("system", "banktransaktion_bokford", `Leverantörsbetalning ${kr(sup.amount)} till ${sup.supplier} bokfördes.`, {
    targetType: "leverantorsfaktura",
    targetId: sup.id,
  });
  logActivity(`${sup.supplier} ${sup.invoiceNumber} betalades (${kr(sup.amount)}) och bokfördes.`);
  save();
}
