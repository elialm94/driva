import { db, save } from "../store";
import { kr } from "../format";
import { normalizeRecipientAccount } from "../inbox/workflow";
import { inboundMailAddress } from "../inbox/inbound-mail";
import { mailFromAddress, mailProviderAvailable, sendMail } from "../mail";
import { merchantRuleKey } from "./expenses";
import { logActivity } from "./activity";
import type {
  PaymentDetailsMethod,
  PaymentDetailsProvenance,
  SupplierInvoice,
  VerifiedPaymentDetails,
} from "../types";

/**
 * Betalningsuppgifternas tillståndsmodell för leverantörsfakturor.
 *
 * Lagrat på fakturan (SupplierInvoice.paymentDetails): VERIFIED (med
 * proveniens), EXTRACTION_UNCERTAIN (kandidat – aldrig betalbar), MISSING,
 * AWAITING_SUPPLIER (förfrågan skickad). HÄRLETT vid läsning: CHANGED
 * (dokumentets uppgifter skiljer sig från tidigare verifierade) och
 * "återanvändbara verifierade uppgifter finns hos leverantören".
 *
 * Grundregler:
 *   * En osäker kandidat hamnar ALDRIG i bankgiro/recipientAccount.
 *   * Verifierad = proveniens: högkonfident dokumentläsning ("document"),
 *     människa ("document_confirmed"/"manual") eller återanvänd historik
 *     ("supplier_history"). En gissning kan aldrig bli verifierad.
 *   * Ändrad destination godkänns aldrig automatiskt – kräver explicit
 *     mänsklig verifiering (confirmChangedPaymentDetails i supplier-payments).
 */

export type PaymentDetailsCause =
  | "VERIFIED"
  | "EXTRACTION_UNCERTAIN"
  | "MISSING"
  | "AWAITING_SUPPLIER"
  | "CHANGED";

/** Proveniens som räknas som mänskligt bekräftad – stark baslinje för återanvändning och ändringslarm. */
const HUMAN_CONFIRMED: ReadonlySet<PaymentDetailsProvenance> = new Set([
  "document_confirmed",
  "manual",
  "supplier_history",
]);

export function isHumanConfirmedProvenance(source: PaymentDetailsProvenance): boolean {
  return HUMAN_CONFIRMED.has(source);
}

/* ----------------------- Verifierad leverantörshistorik ---------------------- */

export interface SupplierVerifiedDetails {
  account: string;
  method: PaymentDetailsMethod;
  verifiedAt: string;
  /** Varifrån verifieringen kommer: genomförd bankbetalning eller mänskligt bekräftade uppgifter. */
  source: "paid_payment" | PaymentDetailsProvenance;
  /** Fakturan som bär verifieringen. */
  invoiceId?: string;
}

/** Gissa betalsätt ur kontoformatet (för legacy-data utan lagrad metod). */
export function guessPaymentMethod(account: string): PaymentDetailsMethod {
  const compact = account.replace(/[\s-]/g, "");
  if (/^[a-zA-Z]{2}\d{2}[a-zA-Z0-9]{10,30}$/.test(compact)) return "iban";
  // Plusgiro skrivs med kontrollsiffra efter bindestrecket: 1234567-8.
  if (/-\d$/.test(account.trim()) && /^\d{2,8}$/.test(compact)) return "plusgiro";
  return "bankgiro";
}

const METHOD_LABELS: Record<PaymentDetailsMethod, string> = {
  bankgiro: "Bankgiro",
  plusgiro: "Plusgiro",
  iban: "IBAN",
};

export function paymentMethodLabel(method: PaymentDetailsMethod): string {
  return METHOD_LABELS[method];
}

/** Klarspråk för proveniensen – visas i bekräftelser och register. */
export function provenanceLabel(source: SupplierVerifiedDetails["source"]): string {
  switch (source) {
    case "paid_payment":
      return "genomförd betalning";
    case "document":
      return "läst ur dokumentet";
    case "document_confirmed":
      return "dokument + din kontroll";
    case "manual":
      return "manuellt angivna";
    case "supplier_history":
      return "återanvänd verifierad uppgift";
  }
}

/**
 * Senast VERIFIERADE betalningsuppgifter för leverantören, härlett ur
 * proveniensbärande data – aldrig ur obekräftade extraktioner:
 *   1. Betalningar med status PAID (pengarna nådde kontot – starkaste beviset).
 *   2. Fakturor med mänskligt bekräftade uppgifter (document_confirmed,
 *      manual, supplier_history).
 * Högkonfident men obekräftad dokumentläsning ("document") räknas INTE –
 * den får inte bli baslinje för att godkänna framtida fakturor.
 */
export function verifiedDetailsForSupplier(
  supplier: string,
  opts: { excludeInvoiceId?: string } = {}
): SupplierVerifiedDetails | undefined {
  const key = merchantRuleKey(supplier);
  if (!key) return undefined;
  const data = db();
  const invoices = data.supplierInvoices.filter((s) => merchantRuleKey(s.supplier) === key);
  const byId = new Map(invoices.map((s) => [s.id, s]));
  const hits: SupplierVerifiedDetails[] = [];

  for (const p of data.supplierPayments ?? []) {
    if (p.status !== "PAID" || !p.recipientAccount) continue;
    const inv = byId.get(p.supplierInvoiceId);
    if (!inv || inv.id === opts.excludeInvoiceId) continue;
    hits.push({
      account: p.recipientAccount,
      method: guessPaymentMethod(p.recipientAccount),
      verifiedAt: p.paidAt ?? p.updatedAt,
      source: "paid_payment",
      invoiceId: inv.id,
    });
  }

  for (const inv of invoices) {
    if (inv.id === opts.excludeInvoiceId) continue;
    const v = inv.paymentDetails?.verified;
    if (!v || !HUMAN_CONFIRMED.has(v.source)) continue;
    hits.push({ account: v.account, method: v.method, verifiedAt: v.verifiedAt, source: v.source, invoiceId: inv.id });
  }

  hits.sort((a, b) => b.verifiedAt.localeCompare(a.verifiedAt));
  return hits[0];
}

/* ------------------------------ Tillståndsläsning ---------------------------- */

export interface PaymentDetailsInfo {
  cause: PaymentDetailsCause;
  /** Arbetsdestinationen – finns endast för VERIFIED/CHANGED. */
  account?: string;
  verified?: VerifiedPaymentDetails;
  candidate?: { account?: string; ocr?: string };
  request?: { to: string; sentAt: string };
  /** Senast verifierade uppgifter hos samma leverantör (andra fakturor). */
  previous?: SupplierVerifiedDetails;
  /** MISSING/EXTRACTION_UNCERTAIN + verifierad historik ⇒ återanvändning kan föreslås. */
  reusable: boolean;
}

/**
 * EN härledning av betalningsuppgifternas tillstånd – åtgärdsmotorn, Inbox,
 * Ekonomi, AI:n och betalningsvakterna läser alla härifrån.
 */
export function paymentDetailsInfo(invoice: SupplierInvoice): PaymentDetailsInfo {
  const stored = invoice.paymentDetails;
  const previous = verifiedDetailsForSupplier(invoice.supplier, { excludeInvoiceId: invoice.id });

  if (stored?.state === "AWAITING_SUPPLIER") {
    return {
      cause: "AWAITING_SUPPLIER",
      ...(stored.candidate ? { candidate: stored.candidate } : {}),
      ...(stored.request ? { request: stored.request } : {}),
      ...(previous ? { previous } : {}),
      reusable: Boolean(previous),
    };
  }
  if (stored?.state === "EXTRACTION_UNCERTAIN") {
    return {
      cause: "EXTRACTION_UNCERTAIN",
      ...(stored.candidate ? { candidate: stored.candidate } : {}),
      ...(previous ? { previous } : {}),
      reusable: Boolean(previous),
    };
  }

  const account = (invoice.recipientAccount ?? invoice.bankgiro ?? "").trim();
  if (normalizeRecipientAccount(account).length < 4) {
    return { cause: "MISSING", ...(previous ? { previous } : {}), reusable: Boolean(previous) };
  }

  // Konto finns. Proveniens ur lagringen, eller legacy-syntes för data från
  // före tillståndsmodellen (samma tillit som högkonfident dokumentläsning).
  const verified: VerifiedPaymentDetails = stored?.verified ?? {
    method: guessPaymentMethod(account),
    account,
    ...(invoice.ocr ? { ocr: invoice.ocr } : {}),
    source: "document",
    verifiedAt: invoice.createdAt,
    verifiedBy: "system",
  };

  if (
    !HUMAN_CONFIRMED.has(verified.source) &&
    previous &&
    normalizeRecipientAccount(previous.account) !== normalizeRecipientAccount(account)
  ) {
    return { cause: "CHANGED", account, verified, previous, reusable: false };
  }
  return { cause: "VERIFIED", account, verified, ...(previous ? { previous } : {}), reusable: false };
}

/* --------------------------------- Validering -------------------------------- */

export function validatePaymentAccount(method: PaymentDetailsMethod, account: string): string | null {
  const compact = normalizeRecipientAccount(account);
  if (!compact) return "Ange ett kontonummer.";
  if (method === "bankgiro" && !/^\d{7,8}$/.test(compact)) {
    return "Bankgiro har 7–8 siffror (t.ex. 123-4567).";
  }
  if (method === "plusgiro" && !/^\d{2,8}$/.test(compact)) {
    return "Plusgiro har 2–8 siffror (t.ex. 12 34 56-7).";
  }
  if (method === "iban" && !/^[a-z]{2}\d{2}[a-z0-9]{10,30}$/.test(compact)) {
    return "Ange ett giltigt IBAN (t.ex. SE12 3000 0000 0301 2345 6789).";
  }
  return null;
}

/* --------------------- Be leverantören om betalningsuppgifter ---------------- */

export interface SupplierDetailsRequestInfo {
  possible: boolean;
  to?: string;
  /** Ärlig degradering: varför knappen inte erbjuds. */
  reason?: string;
  subject?: string;
  message?: string;
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Kan Driva be leverantören om uppgifterna? Kräver användbar avsändaradress
 * från det inkommande mejlet OCH en konfigurerad e-postleverantör. Utan det:
 * erbjud aldrig knappen (ärlig degradering – aldrig fejkade utskick).
 */
export function supplierDetailsRequestInfo(invoice: SupplierInvoice): SupplierDetailsRequestInfo {
  const item = invoice.inboxItemId
    ? (db().inboxItems ?? []).find((i) => i.id === invoice.inboxItemId)
    : undefined;
  const from = item?.fromAddress?.trim() ?? "";
  const to = item && item.kind === "mail" && looksLikeEmail(from) ? from : undefined;
  if (!to) return { possible: false, reason: "Ingen avsändaradress – dokumentet kom inte via e-post." };
  if (!mailProviderAvailable()) {
    return { possible: false, to, reason: "Ingen e-postleverantör är konfigurerad." };
  }
  const subject = `Betalningsuppgifter för faktura ${invoice.invoiceNumber}`;
  const message = [
    "Hej!",
    "",
    `Vi saknar betalningsuppgifter för faktura ${invoice.invoiceNumber} på ${kr(invoice.amount)}. Kan ni komplettera med bankgiro/plusgiro och OCR- eller referensnummer?`,
    "",
    "Svara gärna direkt på det här mejlet.",
    "",
    "Vänliga hälsningar",
    db().settings.name,
  ].join("\n");
  return { possible: true, to, subject, message };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export type RequestSupplierDetailsResult =
  | { ok: true; to: string; alreadyRequested: boolean }
  | { ok: false; error: string };

/**
 * Skickar förfrågan till leverantören (externt mejl – anroparen har redan
 * visat förhandsvisning + fått explicit bekräftelse). Efter lyckat utskick:
 * state AWAITING_SUPPLIER → raden lämnar aktiva uppmärksamhetslistan och
 * registret visar "Väntar på leverantören". Misslyckat utskick ändrar inget.
 */
export async function requestPaymentDetailsFromSupplier(
  invoiceId: string
): Promise<RequestSupplierDetailsResult> {
  const invoice = db().supplierInvoices.find((s) => s.id === invoiceId);
  if (!invoice) return { ok: false, error: "Leverantörsfakturan finns inte." };
  const info = paymentDetailsInfo(invoice);
  if (info.cause === "AWAITING_SUPPLIER") {
    return { ok: true, to: info.request?.to ?? "", alreadyRequested: true };
  }
  if (info.cause !== "MISSING") {
    return { ok: false, error: "Fakturan saknar inte betalningsuppgifter – ingen förfrågan behövs." };
  }
  const req = supplierDetailsRequestInfo(invoice);
  if (!req.possible || !req.to || !req.subject || !req.message) {
    return { ok: false, error: req.reason ?? "Förfrågan kan inte skickas." };
  }

  const from = mailFromAddress() ?? "Driva <noreply@localhost>";
  const replyTo = inboundMailAddress(db().settings.inboundMailSlug || "demo");
  const result = await sendMail({
    to: req.to,
    from,
    replyTo,
    subject: req.subject,
    text: req.message,
    html: req.message
      .split("\n\n")
      .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
      .join(""),
  });
  if (!result.ok) return { ok: false, error: result.error };

  invoice.paymentDetails = {
    state: "AWAITING_SUPPLIER",
    ...(invoice.paymentDetails?.candidate ? { candidate: invoice.paymentDetails.candidate } : {}),
    request: { to: req.to, sentAt: new Date().toISOString() },
  };
  logActivity(
    `Bad ${invoice.supplier} om betalningsuppgifter för faktura ${invoice.invoiceNumber} (${kr(invoice.amount)}). Väntar på leverantören.`
  );
  save();
  return { ok: true, to: req.to, alreadyRequested: false };
}
