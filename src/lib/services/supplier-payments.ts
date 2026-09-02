import { db, save } from "../store";
import { uid } from "../ids";
import { kr, datumKort } from "../format";
import { entriesSupplierInvoicePaid } from "../bas";
import { postVerification } from "../accounting/engine";
import { logActivity } from "./activity";
import { logAudit } from "../accounting/audit";
import { getBankPaymentProvider, bankNotConnectedMessage } from "../banking/payment-provider";
import {
  hasRecipientAccount,
  isPaymentInFlight,
} from "../inbox/workflow";
import {
  paymentDetailsInfo,
  paymentMethodLabel,
  validatePaymentAccount,
  type PaymentDetailsCause,
  type SupplierVerifiedDetails,
} from "./payment-details";
import type {
  PaymentDetailsMethod,
  PaymentDetailsProvenance,
  SupplierInvoice,
  SupplierPayment,
  SupplierPaymentStatus,
} from "../types";

const ACTIVE_STATUSES: ReadonlySet<SupplierPaymentStatus> = new Set([
  "DRAFT",
  "READY",
  "PAYMENT_FILE_CREATED",
  "SUBMITTED_TO_BANK",
  "AWAITING_APPROVAL",
  "SCHEDULED",
]);

export function supplierPayments(): SupplierPayment[] {
  return db().supplierPayments ?? [];
}

export function paymentsForInvoice(invoiceId: string): SupplierPayment[] {
  return supplierPayments().filter((p) => p.supplierInvoiceId === invoiceId);
}

export function latestPaymentForInvoice(invoiceId: string): SupplierPayment | undefined {
  return paymentsForInvoice(invoiceId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

export function paidAmountForInvoice(invoiceId: string): number {
  return paymentsForInvoice(invoiceId)
    .filter((p) => p.status === "PAID")
    .reduce((sum, p) => sum + p.amount, 0);
}

export function remainingAmountForInvoice(invoice: SupplierInvoice): number {
  return Math.max(0, invoice.amount - paidAmountForInvoice(invoice.id));
}

export function activePaymentForInvoice(invoiceId: string): SupplierPayment | undefined {
  return paymentsForInvoice(invoiceId).find((p) => ACTIVE_STATUSES.has(p.status));
}

export function paymentIdempotencyKey(invoiceId: string, amount: number, scheduledDate: string): string {
  return `suppay:${invoiceId}:${amount}:${scheduledDate.slice(0, 10)}`;
}

export function getSupplierInvoice(id: string): SupplierInvoice | undefined {
  return db().supplierInvoices.find((s) => s.id === id);
}

/**
 * Klarspråk för varför en faktura inte kan betalas – EN källa för
 * betalningsvakterna, UI:t och AI:n ("Varför kan inte fakturan betalas?").
 */
export function paymentDetailsBlockedReason(cause: PaymentDetailsCause, supplier: string): string | null {
  switch (cause) {
    case "MISSING":
      return "Betalningsuppgifter saknas på fakturan.";
    case "EXTRACTION_UNCERTAIN":
      return "Betalningsuppgifterna kunde inte läsas säkert från fakturan – kontrollera och godkänn dem först.";
    case "AWAITING_SUPPLIER":
      return `Väntar på betalningsuppgifter från ${supplier}.`;
    case "CHANGED":
      return `${supplier} visar nya betalningsuppgifter jämfört med tidigare verifierad betalning – kontrollera dem innan betalning.`;
    case "VERIFIED":
      return null;
  }
}

export interface PrepareSupplierPaymentInput {
  supplierInvoiceId: string;
  scheduledDate?: string;
  amount?: number;
}

/**
 * Skapar eller uppdaterar en betalningsinstruktion. Skickar ALDRIG till bank.
 * Idempotent: samma faktura + belopp + datum återanvänder raden.
 */
export function prepareSupplierPayment(input: PrepareSupplierPaymentInput): SupplierPayment {
  const invoice = getSupplierInvoice(input.supplierInvoiceId);
  if (!invoice) throw new Error("Leverantörsfakturan finns inte.");
  if (invoice.accountingStatus !== "bokford") {
    throw new Error("Fakturan måste bokföras innan en betalning kan förberedas.");
  }
  if (invoice.status === "betald" && remainingAmountForInvoice(invoice) <= 0) {
    const existing = latestPaymentForInvoice(invoice.id);
    if (existing) return existing;
    throw new Error("Fakturan är redan betald.");
  }

  const remaining = remainingAmountForInvoice(invoice);
  const amount = input.amount ?? remaining;
  if (!Number.isInteger(amount) || amount < 1) throw new Error("Beloppet måste vara minst 1 kr.");
  if (amount > remaining) throw new Error(`Beloppet överstiger kvarvarande ${kr(remaining)}.`);

  const scheduledDate = (input.scheduledDate ?? invoice.dueDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
    throw new Error("Betaldatum måste vara YYYY-MM-DD.");
  }

  // Betalningsvakt: utan VERIFIERAD destination skapas aldrig en instruktion.
  // Osäkra kandidater ligger i paymentDetails.candidate – aldrig här. Ändrade
  // uppgifter (CHANGED) får en spärrad DRAFT tills människan godkänt ändringen.
  const details = paymentDetailsInfo(invoice);
  const blocked = paymentDetailsBlockedReason(details.cause, invoice.supplier);
  if (blocked && details.cause !== "CHANGED") {
    throw new Error(`${blocked} Betalningen kan inte förberedas.`);
  }
  const recipientAccount = (details.account ?? "").trim();
  if (!recipientAccount) {
    throw new Error("Betalningsuppgifter saknas på fakturan. Betalningen kan inte förberedas.");
  }
  const destinationChanged = details.cause === "CHANGED";

  const key = paymentIdempotencyKey(invoice.id, amount, scheduledDate);
  const data = db();
  data.supplierPayments ??= [];

  const existing =
    data.supplierPayments.find((p) => p.idempotencyKey === key) ??
    data.supplierPayments.find((p) => p.supplierInvoiceId === invoice.id && ACTIVE_STATUSES.has(p.status));

  if (existing) {
    // En instruktion med aktiv bankfil muteras aldrig här – ändrade belopp/
    // datum skulle tyst glida ifrån den redan genererade filen.
    if (existing.status === "PAYMENT_FILE_CREATED") return existing;
    if (isPaymentInFlight(existing.status) || existing.status === "PAID") return existing;
    if (existing.status === "FAILED") {
      existing.status = destinationChanged ? "DRAFT" : "READY";
      existing.failureReason = undefined;
      existing.amount = amount;
      existing.scheduledDate = scheduledDate;
      existing.idempotencyKey = key;
      existing.recipientAccount = recipientAccount;
      existing.destinationChanged = destinationChanged;
      existing.updatedAt = new Date().toISOString();
      save();
      return existing;
    }
    existing.amount = amount;
    existing.scheduledDate = scheduledDate;
    existing.dueDate = invoice.dueDate;
    existing.ocr = invoice.ocr;
    existing.recipientAccount = recipientAccount;
    existing.recipientName = invoice.supplier;
    existing.idempotencyKey = key;
    existing.destinationChanged = destinationChanged;
    existing.status = destinationChanged ? "DRAFT" : "READY";
    existing.updatedAt = new Date().toISOString();
    save();
    return existing;
  }

  const now = new Date().toISOString();
  const payment: SupplierPayment = {
    id: `spay-${uid()}`,
    supplierInvoiceId: invoice.id,
    amount,
    currency: "SEK",
    dueDate: invoice.dueDate,
    scheduledDate,
    ocr: invoice.ocr,
    recipientAccount,
    recipientName: invoice.supplier,
    idempotencyKey: key,
    status: destinationChanged ? "DRAFT" : "READY",
    destinationChanged,
    createdAt: now,
    updatedAt: now,
  };
  data.supplierPayments.push(payment);
  save();
  return payment;
}

export type SubmitSupplierPaymentResult =
  | { ok: true; payment: SupplierPayment; alreadySubmitted: boolean }
  | { ok: false; error: string; payment?: SupplierPayment };

/**
 * Skickar instruktionen till bankprovidern. Kräver att anroparen redan har
 * fått ett mänskligt godkännande – AI-verktyget får inte anropa den här.
 */
export function submitSupplierPayment(paymentId: string, scheduledDate?: string): SubmitSupplierPaymentResult {
  const data = db();
  data.supplierPayments ??= [];
  const payment = data.supplierPayments.find((p) => p.id === paymentId);
  if (!payment) return { ok: false, error: "Betalningen finns inte." };

  if (payment.status === "PAID") return { ok: true, payment, alreadySubmitted: true };
  if (isPaymentInFlight(payment.status)) return { ok: true, payment, alreadySubmitted: true };

  if (payment.status === "CANCELLED") {
    return { ok: false, error: "Betalningen är avbruten.", payment };
  }
  if (payment.status === "PAYMENT_FILE_CREATED") {
    return {
      ok: false,
      error: "En bankfil är redan skapad för betalningen. Ladda upp filen i din internetbank – Driva skickar inget själv.",
      payment,
    };
  }

  const invoice = getSupplierInvoice(payment.supplierInvoiceId);
  if (!invoice) return { ok: false, error: "Leverantörsfakturan finns inte.", payment };
  if (invoice.status === "betald" && remainingAmountForInvoice(invoice) <= 0) {
    return { ok: true, payment, alreadySubmitted: true };
  }

  if (scheduledDate && /^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
    payment.scheduledDate = scheduledDate;
    payment.idempotencyKey = paymentIdempotencyKey(invoice.id, payment.amount, scheduledDate);
  }

  if (payment.destinationChanged) {
    return {
      ok: false,
      error: `Bankgirot till ${invoice.supplier} har ändrats jämfört med tidigare betalning. Kontrollera mottagaren innan du skickar.`,
      payment,
    };
  }
  // Central vakt (defense in depth): utan VERIFIERAD destination går inget
  // till bank – oavsett hur/när instruktionen skapades.
  const details = paymentDetailsInfo(invoice);
  if (details.cause !== "VERIFIED") {
    const blocked =
      details.cause === "CHANGED"
        ? `Bankgirot till ${invoice.supplier} har ändrats jämfört med tidigare betalning. Kontrollera mottagaren innan du skickar.`
        : `${paymentDetailsBlockedReason(details.cause, invoice.supplier)} Betalningen kan inte skickas.`;
    return { ok: false, error: blocked, payment };
  }
  if (!hasRecipientAccount(invoice, payment)) {
    return { ok: false, error: "Bankgiro eller konto saknas.", payment };
  }

  const provider = getBankPaymentProvider();
  const result = provider.submitPayment({
    amount: payment.amount,
    currency: payment.currency,
    scheduledDate: payment.scheduledDate,
    ocr: payment.ocr,
    reference: payment.reference ?? payment.ocr,
    recipientAccount: payment.recipientAccount,
    recipientName: payment.recipientName,
    idempotencyKey: payment.idempotencyKey,
  });

  if (!result.ok) {
    if (result.code === "DUPLICATE" && payment.providerPaymentId) {
      return { ok: true, payment, alreadySubmitted: true };
    }
    return { ok: false, error: result.error || bankNotConnectedMessage(), payment };
  }

  const now = new Date().toISOString();
  payment.providerPaymentId = result.providerPaymentId;
  payment.status = result.status;
  payment.submittedAt = payment.submittedAt ?? now;
  payment.updatedAt = now;
  syncInboxAfterPayment(invoice, payment);
  logActivity(`Betalning till ${invoice.supplier} (${kr(payment.amount)}) skickades till banken. Betalas ${payment.scheduledDate.slice(0, 10)}.`);
  save();
  return { ok: true, payment, alreadySubmitted: false };
}

export function cancelSupplierPayment(paymentId: string): SupplierPayment {
  const payment = supplierPayments().find((p) => p.id === paymentId);
  if (!payment) throw new Error("Betalningen finns inte.");
  if (payment.status === "PAID") throw new Error("En genomförd betalning kan inte avbrytas.");
  if (payment.status === "CANCELLED") return payment;
  // Avbryts en betalning med aktiv bankfil makuleras filen: den får inte
  // laddas ned och användas efteråt som om instruktionen fortfarande gällde.
  // Övriga betalningar i samma fil släpps tillbaka till READY så att en ny,
  // korrekt fil kan skapas för dem.
  if (payment.paymentFileId) {
    const file = (db().paymentFiles ?? []).find((f) => f.id === payment.paymentFileId);
    if (file && file.status === "CREATED") {
      file.status = "CANCELLED";
      for (const sibling of supplierPayments()) {
        if (sibling.id === payment.id || sibling.paymentFileId !== file.id) continue;
        if (sibling.status === "PAYMENT_FILE_CREATED") {
          sibling.status = "READY";
          sibling.updatedAt = new Date().toISOString();
        }
        sibling.paymentFileId = undefined;
      }
    }
    payment.paymentFileId = undefined;
  }
  payment.status = "CANCELLED";
  payment.updatedAt = new Date().toISOString();
  save();
  return payment;
}

/** Webhook-gräns: providern rapporterar status. Osäkerhet → review, aldrig tyst PAID. */
export function applySupplierPaymentProviderEvent(input: {
  providerPaymentId?: string;
  paymentId?: string;
  status: "AWAITING_APPROVAL" | "SCHEDULED" | "FAILED" | "PAID";
  failureReason?: string;
  bankTransactionId?: string;
}): SupplierPayment {
  const payment = supplierPayments().find(
    (p) => (input.paymentId && p.id === input.paymentId) || (input.providerPaymentId && p.providerPaymentId === input.providerPaymentId)
  );
  if (!payment) throw new Error("Betalningen finns inte hos providern.");

  if (input.status === "PAID") {
    throw new Error("Betald-status sätts bara när banktransaktionen matchas – inte från ett ensamt providerbesked.");
  }
  if (input.status === "FAILED") {
    markSupplierPaymentFailed(payment.id, input.failureReason ?? "Banken avvisade betalningen.");
    return payment;
  }
  payment.status = input.status;
  payment.updatedAt = new Date().toISOString();
  save();
  return payment;
}

export function markSupplierPaymentFailed(paymentId: string, reason: string): SupplierPayment {
  const payment = supplierPayments().find((p) => p.id === paymentId);
  if (!payment) throw new Error("Betalningen finns inte.");
  if (payment.status === "PAID") return payment;
  payment.status = "FAILED";
  payment.failureReason = reason;
  payment.updatedAt = new Date().toISOString();
  const invoice = getSupplierInvoice(payment.supplierInvoiceId);
  if (invoice) syncInboxAfterPayment(invoice, payment);
  logActivity(`Betalningen till ${payment.recipientName} (${kr(payment.amount)}) misslyckades. ${reason}`);
  save();
  return payment;
}

export function bookSupplierPaymentFromBank(input: {
  payment: SupplierPayment;
  bankTransactionId: string;
  matchReason: string;
}): void {
  const data = db();
  const payment = data.supplierPayments.find((p) => p.id === input.payment.id);
  const invoice = getSupplierInvoice(input.payment.supplierInvoiceId);
  if (!payment || !invoice) return;
  if (payment.status === "PAID" && invoice.paymentVerificationId) return;

  const tx = data.bankTransactions.find((t) => t.id === input.bankTransactionId);
  if (!tx) throw new Error("Banktransaktionen finns inte.");
  if (tx.status === "bokford" && invoice.paymentVerificationId) return;

  const now = new Date().toISOString();
  const ver = postVerification({
    date: tx.date.slice(0, 10),
    description: `Betalning ${invoice.supplier} ${invoice.invoiceNumber}`,
    entries: entriesSupplierInvoicePaid(payment.amount),
    source: { type: "leverantorsfaktura", id: invoice.id },
    confidence: "hog",
    createdBy: "auto",
    explanation: `${input.matchReason} Betalningen drogs från företagskontot och leverantörsskulden till ${invoice.supplier} bockades av. Kostnaden och momsen bokfördes redan när fakturan togs emot.`,
  });

  tx.status = "bokford";
  tx.matchedType = "leverantorsfaktura";
  tx.matchedId = invoice.id;
  tx.verificationId = ver.id;

  payment.status = "PAID";
  payment.bankTransactionId = tx.id;
  payment.paidAt = now;
  payment.updatedAt = now;

  const remaining = remainingAmountForInvoice(invoice);
  if (remaining <= 0) {
    invoice.status = "betald";
    invoice.bankTransactionId = tx.id;
    invoice.paymentVerificationId = ver.id;
  }
  syncInboxAfterPayment(invoice, payment);
  logAudit("system", "banktransaktion_bokford", `Leverantörsbetalning ${kr(payment.amount)} till ${invoice.supplier} bokfördes.`, {
    targetType: "leverantorsfaktura",
    targetId: invoice.id,
  });
  logActivity(`${invoice.supplier} ${invoice.invoiceNumber} markerades som betald (${kr(payment.amount)}) och bokfördes.`);
  save();
}

/* ------------------- Verifiering av betalningsuppgifter ---------------------- */

/** Uppdatera/skapa instruktionen efter att destinationen verifierats. */
function syncPaymentAfterVerification(invoice: SupplierInvoice): void {
  if (invoice.accountingStatus !== "bokford" || invoice.status === "betald") return;
  try {
    prepareSupplierPayment({ supplierInvoiceId: invoice.id });
  } catch {
    // T.ex. redan betald eller låst – verifieringen är ändå sparad.
  }
}

export interface VerifyPaymentDetailsInput {
  supplierInvoiceId: string;
  method: PaymentDetailsMethod;
  account: string;
  ocr?: string;
}

/**
 * Människan kontrollerar/anger betalningsuppgifter → VERIFIED med proveniens.
 * source blir "document_confirmed" när en dokumentläsning granskats
 * (EXTRACTION_UNCERTAIN/CHANGED), annars "manual". Anropas endast från
 * mänskligt bekräftade flöden – AI:n har inget verktyg som når hit med
 * egna sifferförslag (den kan aldrig hitta på betalningsuppgifter).
 */
export function verifySupplierPaymentDetails(input: VerifyPaymentDetailsInput): SupplierInvoice {
  const invoice = getSupplierInvoice(input.supplierInvoiceId);
  if (!invoice) throw new Error("Leverantörsfakturan finns inte.");
  if (invoice.status === "betald") throw new Error("Fakturan är redan betald.");
  const account = input.account.trim();
  const problem = validatePaymentAccount(input.method, account);
  if (problem) throw new Error(problem);
  const active = activePaymentForInvoice(invoice.id);
  if (active && isPaymentInFlight(active.status)) {
    throw new Error("Betalningen är redan skickad till banken – uppgifterna kan inte ändras nu.");
  }
  if (active?.status === "PAYMENT_FILE_CREATED") {
    throw new Error(
      "En bankfil är redan skapad med de nuvarande uppgifterna. Avbryt betalningen eller skapa en ny bankfil efter ändringen."
    );
  }

  const before = paymentDetailsInfo(invoice);
  const source: PaymentDetailsProvenance =
    before.cause === "EXTRACTION_UNCERTAIN" || before.cause === "CHANGED" ? "document_confirmed" : "manual";
  const ocr = input.ocr?.trim();
  const now = new Date().toISOString();

  invoice.recipientAccount = account;
  if (input.method === "bankgiro") invoice.bankgiro = account;
  else delete invoice.bankgiro;
  if (ocr) invoice.ocr = ocr;
  invoice.paymentDetails = {
    state: "VERIFIED",
    verified: {
      method: input.method,
      account,
      ...(ocr || invoice.ocr ? { ocr: ocr ?? invoice.ocr } : {}),
      source,
      verifiedAt: now,
      verifiedBy: "anvandare",
    },
  };
  syncPaymentAfterVerification(invoice);
  logActivity(
    `Betalningsuppgifter för ${invoice.supplier} ${invoice.invoiceNumber} verifierades (${paymentMethodLabel(input.method)} ${account}).`
  );
  save();
  return invoice;
}

/**
 * Återanvänd tidigare VERIFIERADE leverantörsuppgifter på denna faktura.
 * Kräver mänsklig bekräftelse i anropande lager (dialog/AI-confirm) – och
 * det finns inget att återanvända om leverantören saknar verifierad historik,
 * så uppgifter kan aldrig hittas på. OCR återanvänds ALDRIG från en annan
 * faktura – den är fakturaspecifik.
 */
export function applyVerifiedSupplierDetails(invoiceId: string): {
  invoice: SupplierInvoice;
  details: SupplierVerifiedDetails;
} {
  const invoice = getSupplierInvoice(invoiceId);
  if (!invoice) throw new Error("Leverantörsfakturan finns inte.");
  if (invoice.status === "betald") throw new Error("Fakturan är redan betald.");
  const info = paymentDetailsInfo(invoice);
  if (info.cause === "VERIFIED") throw new Error("Fakturan har redan verifierade betalningsuppgifter.");
  if (info.cause === "CHANGED") {
    throw new Error(
      "Fakturan visar nya betalningsuppgifter – kontrollera ändringen i stället för att återanvända gamla uppgifter."
    );
  }
  const previous = info.previous;
  if (!previous) {
    throw new Error(`Det finns inga tidigare verifierade betalningsuppgifter för ${invoice.supplier}.`);
  }

  const now = new Date().toISOString();
  invoice.recipientAccount = previous.account;
  if (previous.method === "bankgiro") invoice.bankgiro = previous.account;
  else delete invoice.bankgiro;
  invoice.paymentDetails = {
    state: "VERIFIED",
    verified: {
      method: previous.method,
      account: previous.account,
      ...(invoice.ocr ? { ocr: invoice.ocr } : {}),
      source: "supplier_history",
      verifiedAt: now,
      verifiedBy: "anvandare",
      ...(previous.invoiceId ? { reusedFromInvoiceId: previous.invoiceId } : {}),
    },
  };
  syncPaymentAfterVerification(invoice);
  logActivity(
    `Tidigare verifierade betalningsuppgifter (${previous.account}) återanvändes för ${invoice.supplier} ${invoice.invoiceNumber} efter bekräftelse.`
  );
  save();
  return { invoice, details: previous };
}

/**
 * Explicit mänsklig verifiering av ÄNDRADE uppgifter: godkänner dokumentets
 * nya destination (proveniens document_confirmed) och släpper instruktionen
 * ur DRAFT-spärren. Godkänns ALDRIG automatiskt och har inget AI-verktyg.
 */
export function confirmChangedPaymentDetails(invoiceId: string): SupplierInvoice {
  const invoice = getSupplierInvoice(invoiceId);
  if (!invoice) throw new Error("Leverantörsfakturan finns inte.");
  const info = paymentDetailsInfo(invoice);
  if (info.cause !== "CHANGED" || !info.verified) {
    throw new Error("Fakturans betalningsuppgifter är inte flaggade som ändrade.");
  }
  const now = new Date().toISOString();
  invoice.paymentDetails = {
    state: "VERIFIED",
    verified: { ...info.verified, source: "document_confirmed", verifiedAt: now, verifiedBy: "anvandare" },
  };
  const active = activePaymentForInvoice(invoice.id);
  if (active && !isPaymentInFlight(active.status) && active.status !== "PAID") {
    active.destinationChanged = false;
    if (active.status === "DRAFT") active.status = "READY";
    active.updatedAt = now;
  } else if (!active) {
    syncPaymentAfterVerification(invoice);
  }
  logActivity(
    `Nya betalningsuppgifter för ${invoice.supplier} godkändes efter kontroll (tidigare ${info.previous?.account ?? "okänt"}, nu ${info.account}).`
  );
  save();
  return invoice;
}

export function supplierPaymentConfirmRows(payment: SupplierPayment, invoice: SupplierInvoice): { label: string; value: string }[] {
  return [
    { label: "Leverantör", value: invoice.supplier },
    { label: "Belopp", value: kr(payment.amount) },
    { label: "Förfaller", value: datumKort(invoice.dueDate) },
    { label: "Betalas", value: datumKort(payment.scheduledDate) },
    { label: "OCR", value: payment.ocr ?? invoice.ocr ?? "—" },
    { label: "Bankgiro", value: payment.recipientAccount },
  ];
}

function syncInboxAfterPayment(invoice: SupplierInvoice, payment: SupplierPayment): void {
  if (!invoice.inboxItemId) return;
  const item = (db().inboxItems ?? []).find((i) => i.id === invoice.inboxItemId);
  if (!item) return;
  if (payment.status === "PAID") {
    item.status = "bokford";
    item.processedAt = item.processedAt ?? new Date().toISOString();
  } else if (payment.status === "FAILED") {
    item.status = "ny";
  } else if ((isPaymentInFlight(payment.status) || payment.status === "PAYMENT_FILE_CREATED") && item.status === "ny") {
    item.status = "behandlad";
    item.processedAt = item.processedAt ?? new Date().toISOString();
  }
}
