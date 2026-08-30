import { db } from "../store";
import type { Invoice, Quote, SupplierInvoice, SupplierPayment } from "../types";
import { currentVersion, effectiveQuoteStatus, invoiceTotals, isOpenReceivable, isOverdue, daysOverdue, quoteTotals } from "./data";
import type { PagedResult } from "./customers";
import { categoryByKey } from "../bas";
import { dagarTill, datumKort } from "../format";
import { getBusinessActions, type BusinessAction } from "./actions";
import { indexActionsBySource, issueForAction } from "./action-issue";
import { paymentDetailsInfo } from "./payment-details";
import { invoicesReadyForPaymentFile, paymentFileBlockersForInvoice } from "./payment-files";
import {
  EXPENSE_STATUS,
  INVOICE_CREDIT_NOTE,
  INVOICE_STATUS,
  INVOICE_STATUS_FILTER,
  PAYMENT_DETAILS_CAUSE,
  QUOTE_STATUS,
  QUOTE_STATUS_FILTER,
  SUPPLIER_INVOICE_LIFECYCLE,
  TX_STATUS,
  invoiceOverdueLabel,
  supplierPaymentStatus,
} from "../status-labels";

/**
 * Läsmodeller för Ekonomi-registret: en genomläsning av lagret per flik,
 * sök + statusfilter + serversidig paginering. Skalar till tusentals rader –
 * bara sidans rader lämnar servern.
 */

export const ECONOMY_PAGE_SIZE = 50;

/** Samma toner som Badge i UI:t – hålls som data så läsmodellen är ren serverkod. */
export type StatusTone = "neutral" | "info" | "ok" | "warn" | "danger";

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function paginate<T>(items: T[], page: number, pageSize: number): PagedResult<T> {
  const size = Math.max(1, pageSize);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * size;
  return { rows: items.slice(start, start + size), page: current, pageSize: size, total, totalPages };
}

function customersById(): Map<string, string> {
  return new Map(db().customers.map((c) => [c.id, c.name]));
}

/**
 * "entitet:id" → åtgärdsmotorns rad, för konkreta registeretiketter
 * ("Matcha betalning", "Saknar kvitto", "Välj kategori" – aldrig ett generiskt
 * "Behöver åtgärd" när motorn vet mer). includeSnoozed: registret visar FAKTA
 * och påverkas aldrig av att uppmärksamhetsraden är snoozad.
 */
function attentionBySource(): Map<string, BusinessAction> {
  return indexActionsBySource(getBusinessActions(new Date(), { includeSnoozed: true }).attention);
}

/* ---------------------------------- Offerter ---------------------------------- */

export type QuoteStatusFilter = "alla" | "utkast" | "skickad" | "godkand" | "avbojd" | "utgangen";

export const QUOTE_STATUS_OPTIONS: [QuoteStatusFilter, string][] = [
  ["alla", "Alla"],
  ["utkast", QUOTE_STATUS_FILTER.utkast],
  ["skickad", QUOTE_STATUS_FILTER.skickad],
  ["godkand", QUOTE_STATUS_FILTER.godkand],
  ["avbojd", QUOTE_STATUS_FILTER.avbojd],
  ["utgangen", QUOTE_STATUS_FILTER.utgangen],
];

export interface QuoteTableRow {
  id: string;
  number: number;
  title: string;
  customerName: string;
  /** Skickad-datum om det finns, annars skapad. */
  date: string;
  amount: number;
  statusKey: Quote["status"];
  statusLabel: string;
  statusTone: StatusTone;
}

// Central vokabulär (status-labels.ts): samma ord som badge och filter.
const QUOTE_STATUS_META: Record<Quote["status"], { label: string; tone: StatusTone }> = QUOTE_STATUS;

export function listQuotesForTable(
  input: { q?: string; status?: QuoteStatusFilter; page?: number; pageSize?: number } = {}
): PagedResult<QuoteTableRow> {
  const names = customersById();
  const q = normalize(input.q ?? "");
  const status = input.status ?? "alla";

  const rows: QuoteTableRow[] = [];
  for (const quote of db().quotes) {
    const effective = effectiveQuoteStatus(quote);
    if (status !== "alla" && effective !== status) continue;
    const version = currentVersion(quote);
    const customerName = names.get(quote.customerId) ?? "";
    if (q) {
      const hay = `#${quote.number} ${quote.number} ${version.title} ${customerName}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    const meta = QUOTE_STATUS_META[effective];
    rows.push({
      id: quote.id,
      number: quote.number,
      title: version.title,
      customerName,
      date: quote.sentAt ?? quote.createdAt,
      amount: quoteTotals(quote).toPay,
      statusKey: effective,
      statusLabel: meta.label,
      statusTone: meta.tone,
    });
  }

  rows.sort((a, b) => b.date.localeCompare(a.date) || b.number - a.number);
  return paginate(rows, input.page ?? 1, input.pageSize ?? ECONOMY_PAGE_SIZE);
}

/* ---------------------------------- Fakturor ---------------------------------- */

export type InvoiceStatusFilter = "alla" | "utkast" | "obetald" | "forsenad" | "betald" | "kredit";

export const INVOICE_STATUS_OPTIONS: [InvoiceStatusFilter, string][] = [
  ["alla", "Alla"],
  ["utkast", INVOICE_STATUS_FILTER.utkast],
  ["obetald", INVOICE_STATUS_FILTER.obetald],
  ["forsenad", INVOICE_STATUS_FILTER.forfallen],
  ["betald", INVOICE_STATUS_FILTER.betald],
  ["kredit", INVOICE_STATUS_FILTER.kredit],
];

export interface InvoiceTableRow {
  id: string;
  /** "#1042" eller "Utkast". */
  label: string;
  /** "Delbetalning"/"Slutfaktura"/"Kredit" – tomt för vanlig faktura. */
  typeLabel: string;
  customerName: string;
  dueDate: string;
  amount: number;
  statusLabel: string;
  statusTone: StatusTone;
  /** Sant bara för status utkast – listan visar då redigera/kasta. */
  draft: boolean;
}

function invoiceStatusMeta(inv: Invoice): { label: string; tone: StatusTone } {
  // Speglar InvoiceStatusBadge: kredit är ingen fordran och kan aldrig vara förfallen.
  if (inv.type === "kredit") return INVOICE_CREDIT_NOTE;
  if (isOverdue(inv)) return invoiceOverdueLabel(daysOverdue(inv));
  return INVOICE_STATUS[inv.status];
}

function invoiceMatchesFilter(inv: Invoice, filter: InvoiceStatusFilter): boolean {
  switch (filter) {
    case "alla":
      return true;
    case "utkast":
      return inv.status === "utkast";
    case "obetald":
      return isOpenReceivable(inv);
    case "forsenad":
      return isOverdue(inv);
    case "betald":
      return inv.status === "betald" && inv.type !== "kredit";
    case "kredit":
      return inv.type === "kredit" || inv.status === "krediterad";
  }
}

const INVOICE_TYPE_LABEL: Record<Invoice["type"], string> = {
  faktura: "",
  delbetalning: "Delbetalning",
  slutfaktura: "Slutfaktura",
  kredit: "Kredit",
};

export function listInvoicesForTable(
  input: { q?: string; status?: InvoiceStatusFilter; page?: number; pageSize?: number } = {}
): PagedResult<InvoiceTableRow> {
  const names = customersById();
  const q = normalize(input.q ?? "");
  const status = input.status ?? "alla";

  const withSort: { row: InvoiceTableRow; draft: boolean; number: number; createdAt: string }[] = [];
  for (const inv of db().invoices) {
    if (!invoiceMatchesFilter(inv, status)) continue;
    const customerName = names.get(inv.customerId) ?? "";
    if (q) {
      const hay = `#${inv.number ?? ""} ${inv.number ?? ""} ${customerName} ${inv.ocr}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    const meta = invoiceStatusMeta(inv);
    withSort.push({
      draft: inv.status === "utkast",
      number: inv.number ?? 0,
      createdAt: inv.createdAt,
      row: {
        id: inv.id,
        label: inv.number == null ? "Utkast" : `#${inv.number}`,
        typeLabel: INVOICE_TYPE_LABEL[inv.type],
        customerName,
        dueDate: inv.dueDate,
        amount: invoiceTotals(inv).toPay,
        statusLabel: meta.label,
        statusTone: meta.tone,
        draft: inv.status === "utkast",
      },
    });
  }

  // Utkast överst (senaste först), sedan fallande fakturanummer – samma ordning som tidigare listan.
  withSort.sort((a, b) => {
    if (a.draft !== b.draft) return a.draft ? -1 : 1;
    if (a.draft) return b.createdAt.localeCompare(a.createdAt);
    return b.number - a.number;
  });

  return paginate(
    withSort.map((w) => w.row),
    input.page ?? 1,
    input.pageSize ?? ECONOMY_PAGE_SIZE
  );
}

/* ------------------------------ Utgifter & kvitton ---------------------------- */

export type ExpenseStatusFilter = "alla" | "atgard" | "redo" | "klar";

export const EXPENSE_STATUS_OPTIONS: [ExpenseStatusFilter, string][] = [
  ["alla", "Alla"],
  ["atgard", "Behöver åtgärd"],
  ["redo", "Redo att betala"],
  ["klar", "Klara"],
];

/** Vilken filterflik raden hör hemma under – aldrig ett generiskt "Behandlad". */
type ExpenseBucket = Exclude<ExpenseStatusFilter, "alla">;

export interface ExpenseTableRow {
  id: string;
  /** Kvittoköp eller leverantörsfaktura – båda är utgifter i registret. */
  kind: "utgift" | "leverantorsfaktura";
  date: string;
  supplier: string;
  /** Fakturanummer för leverantörsfakturor. */
  reference?: string;
  categoryLabel: string;
  amount: number;
  statusLabel: string;
  statusTone: StatusTone;
  /** Underlag: kvitto/bankkoppling finns. */
  hasReceipt: boolean;
}

/**
 * Leverantörsfakturans livscykelstatus för registret: bokföring och betalning
 * är SEPARATA spår och etiketten visar var i flödet fakturan faktiskt är
 * ("Bokförd · Redo att betala", "Bankfil skapad", "Betald · Avstämd" …).
 * Samma härledningar som betalningsspärrarna och åtgärdsmotorn.
 */
function supplierInvoiceLifecycle(
  s: SupplierInvoice,
  payment: SupplierPayment | undefined,
  attention: Map<string, BusinessAction>
): { label: string; tone: StatusTone; bucket: ExpenseBucket } {
  const booked = s.accountingStatus === "bokford" || Boolean(s.verificationId);

  if (s.status === "betald" || payment?.status === "PAID") {
    const reconciled = Boolean(s.bankTransactionId ?? payment?.bankTransactionId);
    return { label: reconciled ? "Betald · Avstämd" : "Betald", tone: "ok", bucket: "klar" };
  }
  if (payment?.status === "FAILED") {
    return { label: "Betalningen misslyckades", tone: "danger", bucket: "atgard" };
  }
  if (payment?.status === "SUBMITTED_TO_BANK" || payment?.status === "AWAITING_APPROVAL") {
    return { label: "Skickad till bank", tone: "info", bucket: "klar" };
  }
  if (payment?.status === "SCHEDULED") {
    return {
      label: `Bokförd · Betalas ${dagarTill(payment.scheduledDate) === 0 ? "idag" : datumKort(payment.scheduledDate)}`,
      tone: "info",
      bucket: "klar",
    };
  }
  if (payment?.status === "PAYMENT_FILE_CREATED") {
    return { label: "Bankfil skapad", tone: "info", bucket: "klar" };
  }

  // Betalningsuppgifternas orsak i klartext – samma härledning som
  // åtgärdsmotorn och betalningsspärrarna (payment-details.ts).
  const cause = paymentDetailsInfo(s).cause;
  if (cause === "CHANGED" || payment?.destinationChanged) {
    return { label: "Kontrollera bankuppgifter", tone: "danger", bucket: "atgard" };
  }
  if (booked && cause === "AWAITING_SUPPLIER") {
    return { label: "Väntar på leverantören", tone: "info", bucket: "klar" };
  }
  if (booked && cause === "EXTRACTION_UNCERTAIN") {
    return { label: "Kontrollera betalningsuppgifter", tone: "warn", bucket: "atgard" };
  }
  if (booked && cause === "MISSING") {
    return { label: "Betalningsuppgifter saknas", tone: "warn", bucket: "atgard" };
  }
  if (booked) {
    // Samma vakt som [Skapa bankfil]: tom hinderlista = redo att betala.
    if (paymentFileBlockersForInvoice(s.id).length === 0) {
      return { label: "Bokförd · Redo att betala", tone: "info", bucket: "redo" };
    }
    return { label: "Bokförd", tone: "info", bucket: "klar" };
  }
  const action = attention.get(`supplier:${s.id}`);
  if (action) return { label: issueForAction(action), tone: "warn", bucket: "atgard" };
  return { label: "Väntar på bokföring", tone: "warn", bucket: "atgard" };
}

export function listExpensesForTable(
  input: { q?: string; status?: ExpenseStatusFilter; page?: number; pageSize?: number } = {}
): PagedResult<ExpenseTableRow> {
  const q = normalize(input.q ?? "");
  const status = input.status ?? "alla";
  const rows: ExpenseTableRow[] = [];
  const attention = attentionBySource();

  for (const e of db().expenses) {
    const bucket: ExpenseBucket = e.status === "bokford" ? "klar" : "atgard";
    if (status !== "alla" && bucket !== status) continue;
    const categoryLabel = e.category ? categoryByKey(e.category).label : "—";
    if (q) {
      const hay = `${e.supplier} ${e.description ?? ""} ${categoryLabel}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    // Konkret åtgärdsetikett från motorn ("Kvitto saknas", "Välj kategori").
    const action = bucket === "atgard" ? attention.get(`expense:${e.id}`) : undefined;
    const meta: { label: string; tone: StatusTone } =
      e.status === "bokford"
        ? e.receiptId
          ? { label: "Kvitto · Bokfört", tone: "ok" }
          : EXPENSE_STATUS.bokford
        : action
          ? { label: issueForAction(action), tone: "warn" }
          : EXPENSE_STATUS[e.status];
    rows.push({
      id: e.id,
      kind: "utgift",
      date: e.date,
      supplier: e.supplier,
      categoryLabel,
      amount: e.amount,
      statusLabel: meta.label,
      statusTone: meta.tone,
      hasReceipt: Boolean(e.receiptId),
    });
  }

  for (const s of db().supplierInvoices) {
    const categoryLabel = categoryByKey(s.category).label;
    if (q) {
      const hay = `${s.supplier} ${s.description} ${categoryLabel} ${s.invoiceNumber}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    const payment = (db().supplierPayments ?? []).find((p) => p.supplierInvoiceId === s.id && p.status !== "CANCELLED");
    const lifecycle = supplierInvoiceLifecycle(s, payment, attention);
    if (status !== "alla" && lifecycle.bucket !== status) continue;
    rows.push({
      id: s.id,
      kind: "leverantorsfaktura",
      date: s.date,
      supplier: s.supplier,
      reference: s.invoiceNumber,
      categoryLabel,
      amount: s.amount,
      statusLabel: lifecycle.label,
      statusTone: lifecycle.tone,
      hasReceipt: true,
    });
  }

  rows.sort((a, b) => b.date.localeCompare(a.date));
  return paginate(rows, input.page ?? 1, input.pageSize ?? ECONOMY_PAGE_SIZE);
}

/**
 * Batchunderlag för [Skapa bankfil] på Ekonomi: fakturor som passerar exakt
 * samma vakter som filskaparen. En fil kan bära flera betalningar (krav 17).
 */
export interface ReadyToPayBatch {
  invoiceIds: string[];
  count: number;
  total: number;
  rows: { supplier: string; invoiceNumber: string; amount: number; dueDate: string }[];
}

export function readyToPayBatch(): ReadyToPayBatch {
  const ready = invoicesReadyForPaymentFile();
  return {
    invoiceIds: ready.map((s) => s.id),
    count: ready.length,
    total: ready.reduce((sum, s) => sum + s.amount, 0),
    rows: ready.map((s) => ({ supplier: s.supplier, invoiceNumber: s.invoiceNumber, amount: s.amount, dueDate: s.dueDate })),
  };
}

/* ---------------------------------- Bank -------------------------------------- */

export type BankStatusFilter = "alla" | "atgard" | "bokford";

export const BANK_STATUS_OPTIONS: [BankStatusFilter, string][] = [
  ["alla", "Alla"],
  ["atgard", "Behöver åtgärd"],
  ["bokford", "Bokförda"],
];

export interface BankTableRow {
  id: string;
  date: string;
  counterpart: string;
  description: string;
  reference?: string;
  amount: number;
  statusLabel: string;
  statusTone: StatusTone;
}

// Central vokabulär (status-labels.ts) + "matchad" som bara finns i registret.
const TX_STATUS_META: Record<string, { label: string; tone: StatusTone }> = {
  ...TX_STATUS,
  matchad: { label: "Matchad", tone: "info" },
};

export function listBankForTable(
  input: { q?: string; status?: BankStatusFilter; page?: number; pageSize?: number } = {}
): PagedResult<BankTableRow> {
  const q = normalize(input.q ?? "");
  const status = input.status ?? "alla";
  const rows: BankTableRow[] = [];
  const attention = attentionBySource();

  for (const tx of db().bankTransactions) {
    if (status === "bokford" && tx.status !== "bokford") continue;
    if (status === "atgard" && tx.status !== "behover_atgard" && tx.status !== "ny") continue;
    if (q) {
      const hay = `${tx.counterpart} ${tx.description} ${tx.reference ?? ""}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    // Motorn vet den konkreta åtgärden ("Matcha betalning" osv.) – visa den
    // i stället för generiska "Behöver åtgärd" när transaktionen har en rad.
    const action = tx.status === "behover_atgard" || tx.status === "ny" ? attention.get(`bank:${tx.id}`) : undefined;
    const meta = action ? { label: issueForAction(action), tone: "warn" as StatusTone } : TX_STATUS_META[tx.status];
    rows.push({
      id: tx.id,
      date: tx.date,
      counterpart: tx.counterpart,
      description: tx.description,
      reference: tx.reference,
      amount: tx.amount,
      statusLabel: meta.label,
      statusTone: meta.tone,
    });
  }

  rows.sort((a, b) => b.date.localeCompare(a.date));
  return paginate(rows, input.page ?? 1, input.pageSize ?? ECONOMY_PAGE_SIZE);
}
