import { db } from "../store";
import type { BankTransaction, Expense, Invoice, Quote, SupplierInvoice, SupplierPayment } from "../types";
import { receiptsWithAvailableFile } from "../receipts/receipt-source";
import {
  currentVersion,
  effectiveQuoteStatus,
  getCurrentVersion,
  getJob,
  getQuote,
  invoiceOutstanding,
  invoiceTotals,
  isOpenReceivable,
  isOverdue,
  daysOverdue,
  quoteTotals,
} from "./data";
import { paymentSuggestionForTransaction, suggestedBankBookings } from "./payment-matching";
import { alreadyBookedCandidates, bankCounterpartRuleFor, type AlreadyBookedOption, type BankKindSuggestionSource } from "./bank-booking";
import { bankKindByKey, directionOf, type BankDirection, type BankKindKey } from "../banking/bank-kinds";
import { bankReconciliation } from "../accounting/reconciliation";
import { supplierPayments } from "./supplier-payments";
import { invoiceListTitle, invoiceListTypeLabel } from "../invoices/display";
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
  QUOTE_STATUS,
  QUOTE_STATUS_FILTER,
  TX_STATUS,
  invoiceOverdueLabel,
} from "../status-labels";
import { compareEconomyRows, type EconomySortState, type EconomySortable } from "../economy-sort";

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
  isDraft: boolean;
}

// Central vokabulär (status-labels.ts): samma ord som badge och filter.
const QUOTE_STATUS_META: Record<Quote["status"], { label: string; tone: StatusTone }> = QUOTE_STATUS;

function quoteSortable(row: QuoteTableRow): EconomySortable {
  return {
    documentNumber: row.number,
    documentLabel: row.title || `#${row.number}`,
    customerName: row.customerName,
    date: row.date,
    amount: row.amount,
  };
}

export function listQuotesForTable(
  input: { q?: string; status?: QuoteStatusFilter; page?: number; pageSize?: number; sort?: EconomySortState | null } = {}
): PagedResult<QuoteTableRow> {
  const names = customersById();
  const q = normalize(input.q ?? "");
  const status = input.status ?? "alla";
  const sort = input.sort ?? null;

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
      isDraft: quote.status === "utkast",
    });
  }

  if (sort) {
    rows.sort((a, b) => compareEconomyRows(quoteSortable(a), quoteSortable(b), sort));
  } else {
    rows.sort((a, b) => b.date.localeCompare(a.date) || b.number - a.number);
  }
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
  /** Utfärdad: "#1042". Utkast: rubrik / första rad / "Faktura till {kund}". */
  label: string;
  /** "Delbetalning"/"Slutfaktura"/"Kredit" – tomt för vanlig faktura. */
  typeLabel: string;
  customerName: string;
  dueDate: string;
  amount: number;
  statusLabel: string;
  statusTone: StatusTone;
  isDraft: boolean;
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

function invoiceSortable(item: { row: InvoiceTableRow; number: number | null }): EconomySortable {
  return {
    documentNumber: item.number,
    documentLabel: item.row.label,
    customerName: item.row.customerName,
    date: item.row.dueDate,
    amount: item.row.amount,
  };
}

export function listInvoicesForTable(
  input: { q?: string; status?: InvoiceStatusFilter; page?: number; pageSize?: number; sort?: EconomySortState | null } = {}
): PagedResult<InvoiceTableRow> {
  const names = customersById();
  const q = normalize(input.q ?? "");
  const status = input.status ?? "alla";
  const sort = input.sort ?? null;

  const withSort: { row: InvoiceTableRow; draft: boolean; number: number | null; createdAt: string }[] = [];
  for (const inv of db().invoices) {
    if (!invoiceMatchesFilter(inv, status)) continue;
    const customerName = names.get(inv.customerId) ?? "";
    const quote = inv.quoteId ? getQuote(inv.quoteId) : undefined;
    const quoteTitle = quote ? getCurrentVersion(quote)?.title : undefined;
    const jobTitle = inv.jobId ? getJob(inv.jobId)?.title : undefined;
    const label = invoiceListTitle(inv, { customerName, quoteTitle, jobTitle });
    if (q) {
      const lineHay = inv.lines.map((line) => line.description).join(" ");
      const hay =
        `#${inv.number ?? ""} ${inv.number ?? ""} ${customerName} ${inv.ocr} ${label} ${quoteTitle ?? ""} ${jobTitle ?? ""} ${lineHay}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    const meta = invoiceStatusMeta(inv);
    withSort.push({
      draft: inv.status === "utkast",
      number: inv.number,
      createdAt: inv.createdAt,
      row: {
        id: inv.id,
        label,
        typeLabel: invoiceListTypeLabel(inv.type),
        customerName,
        dueDate: inv.dueDate,
        amount: invoiceTotals(inv).toPay,
        statusLabel: meta.label,
        statusTone: meta.tone,
        isDraft: inv.status === "utkast",
      },
    });
  }

  if (sort) {
    withSort.sort((a, b) => compareEconomyRows(invoiceSortable(a), invoiceSortable(b), sort));
  } else {
    // Utkast överst (senaste först), sedan fallande fakturanummer – samma ordning som tidigare listan.
    withSort.sort((a, b) => {
      if (a.draft !== b.draft) return a.draft ? -1 : 1;
      if (a.draft) return b.createdAt.localeCompare(a.createdAt);
      return (b.number ?? 0) - (a.number ?? 0);
    });
  }

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

/**
 * Åtgärden som går att göra direkt på raden i registret – samma domänvägar
 * som Hem använder (Lägg till kvitto, svara på frågan). Registret är för att
 * hitta, men en djuplänk (?atgard=…) ska landa på något som går att slutföra.
 */
export type ExpenseInlineAction =
  | { kind: "receipt"; expenseId: string }
  | { kind: "question"; expenseId: string; text: string; options: string[] };

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
  /** Kvittofilen är sparad och kan öppnas via /api/kvitto/<receiptId>. */
  receiptId?: string;
  inlineAction?: ExpenseInlineAction;
}

function expenseInlineAction(e: Expense): ExpenseInlineAction | undefined {
  if (e.status === "saknar_kvitto") return { kind: "receipt", expenseId: e.id };
  if (e.status === "behover_svar" && e.question) {
    return { kind: "question", expenseId: e.id, text: e.question.text, options: e.question.options };
  }
  return undefined;
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

function expenseSortable(row: ExpenseTableRow): EconomySortable {
  return {
    documentNumber: null,
    documentLabel: row.reference ?? row.supplier,
    customerName: row.supplier,
    date: row.date,
    amount: row.amount,
  };
}

export function listExpensesForTable(
  input: { q?: string; status?: ExpenseStatusFilter; page?: number; pageSize?: number; sort?: EconomySortState | null } = {}
): PagedResult<ExpenseTableRow> {
  const q = normalize(input.q ?? "");
  const status = input.status ?? "alla";
  const rows: ExpenseTableRow[] = [];
  const attention = attentionBySource();

  const receiptsWithFile = receiptsWithAvailableFile(db().receipts);

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
    const receiptFile = e.receiptId ? receiptsWithFile.get(e.receiptId) : undefined;
    const meta: { label: string; tone: StatusTone } =
      e.status === "bokford"
        ? e.receiptId
          ? receiptFile
            ? { label: "Kvitto · Bokfört", tone: "ok" }
            : { label: "Bokfört · kvittouppgifter utan fil", tone: "ok" }
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
      ...(receiptFile ? { receiptId: receiptFile.id } : {}),
      ...(bucket === "atgard" ? { inlineAction: expenseInlineAction(e) } : {}),
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

  const sort = input.sort ?? null;
  if (sort) {
    rows.sort((a, b) => compareEconomyRows(expenseSortable(a), expenseSortable(b), sort));
  } else {
    rows.sort((a, b) => b.date.localeCompare(a.date));
  }
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

/**
 * Vad som går att göra med en obokad transaktion direkt i bankvyn. Härleds ur
 * matchningsmotorns förslag (lagras aldrig) och kopplade utgifter – exakt
 * samma domänvägar som Hem-raderna, så bankvyn är en åtgärdsyta och inte bara
 * en lista.
 */
export type BankRowAction =
  | {
      kind: "confirm_match";
      label: string;
      reason: string;
      invoiceId: string;
      invoiceNumber: number | null;
      customerName: string;
      /** outstanding − belopp: > 0 delbetalning, < 0 överbetalning. */
      diff: number;
    }
  | { kind: "confirm_rot_payout"; label: string; reason: string }
  | { kind: "confirm_refund"; label: string; reason: string; invoiceId: string; invoiceNumber: number | null }
  | { kind: "confirm_supplier_payment"; label: string; reason: string; supplierPaymentId: string; supplier: string }
  | {
      /** Motorn vet vad det är (regel, redan bokfört belopp eller mönster) – ett klick bokför. */
      kind: "book_kind";
      label: string;
      reason: string;
      bankKind: BankKindKey;
      kindLabel: string;
      source: BankKindSuggestionSource;
      verificationId?: string;
      verificationLabel?: string;
    }
  | { kind: "pick_invoice"; reason: string }
  | { kind: "receipt"; expenseId: string; reason: string }
  | { kind: "question"; expenseId: string; text: string; options: string[] }
  | {
      /** Ingen säker gissning – användaren väljer typ i väljaren (eller följer länken, t.ex. till Lön). */
      kind: "categorize";
      reason: string;
      href?: string;
      hrefLabel?: string;
    };

/**
 * Underlag för "Vad är det här?"-väljaren på en obokad rad: riktningen avgör
 * vilka typer som visas, redan bokförda belopp kan kopplas, och en befintlig
 * regel visas så den går att glömma.
 */
export interface BankKindPickerData {
  counterpart: string;
  direction: BankDirection;
  alreadyBooked: AlreadyBookedOption[];
  rule?: { kind: BankKindKey; label: string; count: number };
}

export interface BankTableRow {
  id: string;
  date: string;
  counterpart: string;
  description: string;
  reference?: string;
  /** Beskrivning och referens, tom när de inte tillför något utöver motparten. */
  secondary: string;
  amount: number;
  statusLabel: string;
  statusTone: StatusTone;
  /** Finns bara på obokade rader. */
  action?: BankRowAction;
  /** Finns bara på obokade rader – alltid, så ingen rad saknar en utväg. */
  picker?: BankKindPickerData;
}

/** Öppen kundfordran som en inbetalning kan matchas mot för hand. */
export interface OpenReceivableOption {
  invoiceId: string;
  invoiceNumber: number | null;
  customerName: string;
  outstanding: number;
  dueDate: string;
}

/** Fakturor som väntar på betalning – underlag för "Matcha mot faktura". */
export function openReceivablesForMatching(): OpenReceivableOption[] {
  const names = customersById();
  return db()
    .invoices.filter(isOpenReceivable)
    .map((inv) => ({
      invoiceId: inv.id,
      invoiceNumber: inv.number,
      customerName: names.get(inv.customerId) ?? "Okänd kund",
      outstanding: invoiceOutstanding(inv),
      dueDate: inv.dueDate,
    }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

function bankRowAction(tx: BankTransaction): BankRowAction | undefined {
  if (tx.status === "bokford") return undefined;
  const expense = db().expenses.find((e) => e.bankTransactionId === tx.id && e.status !== "bokford");
  if (expense?.status === "saknar_kvitto") {
    return { kind: "receipt", expenseId: expense.id, reason: "Kortköp som väntar på kvitto" };
  }
  if (expense?.status === "behover_svar" && expense.question) {
    return { kind: "question", expenseId: expense.id, text: expense.question.text, options: expense.question.options };
  }
  const suggestion = paymentSuggestionForTransaction(tx);
  switch (suggestion.kind) {
    case "match":
      return {
        kind: "confirm_match",
        label: "Boka betalningen",
        reason: suggestion.reason,
        invoiceId: suggestion.invoiceId!,
        invoiceNumber: suggestion.invoiceNumber ?? null,
        customerName: suggestion.customerName ?? "",
        diff: suggestion.diff ?? 0,
      };
    case "overpayment":
      return {
        kind: "confirm_match",
        label: "Boka och hantera överskottet",
        reason: suggestion.reason,
        invoiceId: suggestion.invoiceId!,
        invoiceNumber: suggestion.invoiceNumber ?? null,
        customerName: suggestion.customerName ?? "",
        diff: suggestion.diff ?? 0,
      };
    case "tax_reduction_payout":
      return suggestion.payout
        ? { kind: "confirm_rot_payout", label: "Boka utbetalningen", reason: suggestion.reason }
        : { kind: "pick_invoice", reason: suggestion.reason };
    case "credit_refund":
      return {
        kind: "confirm_refund",
        label: "Boka återbetalningen",
        reason: suggestion.reason,
        invoiceId: suggestion.invoiceId!,
        invoiceNumber: suggestion.invoiceNumber ?? null,
      };
    case "duplicate":
      return { kind: "pick_invoice", reason: suggestion.reason };
    case "supplier_payment": {
      const payment = suggestion.supplierPaymentId
        ? supplierPayments().find((p) => p.id === suggestion.supplierPaymentId)
        : undefined;
      if (!payment) return { kind: "categorize", reason: suggestion.reason };
      return {
        kind: "confirm_supplier_payment",
        label: "Boka betalningen",
        reason: suggestion.reason,
        supplierPaymentId: payment.id,
        supplier: payment.recipientName,
      };
    }
    case "bank_kind": {
      const def = suggestion.bankKind ? bankKindByKey(suggestion.bankKind) : undefined;
      if (!def) return { kind: "categorize", reason: suggestion.reason };
      // Lön utan körd lönekörning, "redan bokförd" utan träff: människan väljer.
      if (suggestion.outcome === "REQUIRES_USER" || def.href || def.key === "kundbetalning" || def.key === "kortkop") {
        return {
          kind: "categorize",
          reason: suggestion.reason,
          ...(def.href ? { href: def.href, hrefLabel: def.key === "lon" ? "Öppna Lön" : "Bokför manuellt" } : {}),
        };
      }
      return {
        kind: "book_kind",
        label: def.key === "redan_bokford" ? `Koppla till ${suggestion.verificationLabel ?? "verifikationen"}` : `Bokför som ${def.label.toLowerCase()}`,
        reason: suggestion.reason,
        bankKind: def.key,
        kindLabel: def.label,
        source: suggestion.bankKindSource ?? "monster",
        ...(suggestion.verificationId
          ? { verificationId: suggestion.verificationId, verificationLabel: suggestion.verificationLabel }
          : {}),
      };
    }
    default:
      return tx.amount > 0 ? { kind: "pick_invoice", reason: suggestion.reason } : { kind: "categorize", reason: suggestion.reason };
  }
}

function bankKindPicker(tx: BankTransaction): BankKindPickerData {
  const rule = bankCounterpartRuleFor(tx.counterpart);
  const ruleDef = rule ? bankKindByKey(rule.kind) : undefined;
  return {
    counterpart: tx.counterpart.trim() || "Okänd motpart",
    direction: directionOf(tx.amount),
    alreadyBooked: alreadyBookedCandidates(tx),
    ...(rule && ruleDef ? { rule: { kind: ruleDef.key, label: ruleDef.label, count: rule.count } } : {}),
  };
}

/* ------------------------------ Bankinkorgen ---------------------------------- */

export interface BankInboxSuggestedRow {
  txId: string;
  date: string;
  counterpart: string;
  amount: number;
  label: string;
}

export interface BankInboxSummary {
  /** Obokade transaktioner (ny + behöver åtgärd). */
  open: number;
  /** Varav kortköp som väntar på kvitto eller kategorisvar (löses via kvittot). */
  awaitingReceipt: number;
  /** Förslag som går att bekräfta med ett klick – underlag för "Bokför alla föreslagna". */
  suggested: BankInboxSuggestedRow[];
  /** Summa obokade in- respektive utbetalningar. */
  openIn: number;
  openOut: number;
  reconciliation: {
    ok: boolean;
    unexplained: number;
    reconciledThrough?: string;
    bankBalance: number;
    ledgerBalance: number;
  };
}

/**
 * Bankvyns huvud: hur mycket som väntar, vad som kan bokföras direkt och om
 * banken stämmer mot bokföringen. Härleds varje gång – lagras aldrig.
 */
export function bankInboxSummary(): BankInboxSummary {
  const data = db();
  let open = 0;
  let awaitingReceipt = 0;
  let openIn = 0;
  let openOut = 0;
  for (const tx of data.bankTransactions) {
    if (tx.status === "bokford") continue;
    open++;
    if (tx.amount > 0) openIn += tx.amount;
    else openOut += -tx.amount;
    if (data.expenses.some((e) => e.bankTransactionId === tx.id && e.status !== "bokford")) awaitingReceipt++;
  }
  const recon = bankReconciliation();
  return {
    open,
    awaitingReceipt,
    suggested: suggestedBankBookings().map((s) => ({
      txId: s.txId,
      date: s.date,
      counterpart: s.counterpart,
      amount: s.amount,
      label: s.label,
    })),
    openIn,
    openOut,
    reconciliation: {
      ok: recon.ok,
      unexplained: recon.unexplained,
      reconciledThrough: recon.reconciledThrough,
      bankBalance: recon.bankBalance,
      ledgerBalance: recon.ledgerBalance,
    },
  };
}

/** Antal obokade transaktioner – styr standardfiltret i bankvyn. */
export function openBankTransactionCount(): number {
  return db().bankTransactions.filter((t) => t.status !== "bokford").length;
}

/** Beskrivning och referens – hoppar över tomma så kolumnen inte upprepar motparten. */
export function bankRowSecondaryText(row: Pick<BankTableRow, "description" | "reference">): string {
  return [row.description, row.reference].map((part) => part?.trim()).filter(Boolean).join(" · ");
}

// Central vokabulär (status-labels.ts) + "matchad" som bara finns i registret.
const TX_STATUS_META: Record<string, { label: string; tone: StatusTone }> = {
  ...TX_STATUS,
  matchad: { label: "Matchad", tone: "info" },
};

/**
 * Statusetiketten säger vad som väntar – aldrig ett generiskt "Behöver åtgärd"
 * när raden vet mer: "Förslag: Bankavgift", "Kvitto saknas", "Välj typ".
 */
function bankRowStatus(
  tx: BankTransaction,
  rowAction: BankRowAction | undefined,
  action: BusinessAction | undefined
): { label: string; tone: StatusTone } {
  switch (rowAction?.kind) {
    case "book_kind":
      return { label: `Förslag: ${rowAction.kindLabel}`, tone: "info" };
    case "confirm_supplier_payment":
      return { label: "Förslag: Leverantörsbetalning", tone: "info" };
    case "receipt":
      return { label: "Kvitto saknas", tone: "warn" };
    case "question":
      return { label: "Välj kategori", tone: "warn" };
    case "categorize":
      return { label: "Välj typ", tone: "warn" };
    default:
      break;
  }
  // Motorn vet den konkreta åtgärden ("Matcha betalning" osv.) – visa den
  // i stället för generiska "Behöver åtgärd" när transaktionen har en rad.
  if (action) return { label: issueForAction(action), tone: "warn" };
  return TX_STATUS_META[tx.status];
}

function bankSortable(row: BankTableRow): EconomySortable {
  return {
    documentNumber: null,
    documentLabel: row.reference ?? row.counterpart,
    customerName: row.counterpart,
    date: row.date,
    amount: row.amount,
  };
}

export function listBankForTable(
  input: { q?: string; status?: BankStatusFilter; page?: number; pageSize?: number; sort?: EconomySortState | null } = {}
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
    const unbooked = tx.status === "behover_atgard" || tx.status === "ny";
    const action = unbooked ? attention.get(`bank:${tx.id}`) : undefined;
    const rowAction = unbooked ? bankRowAction(tx) : undefined;
    const meta = bankRowStatus(tx, rowAction, action);
    rows.push({
      id: tx.id,
      date: tx.date,
      counterpart: tx.counterpart,
      description: tx.description,
      reference: tx.reference,
      secondary: bankRowSecondaryText(tx),
      amount: tx.amount,
      statusLabel: meta.label,
      statusTone: meta.tone,
      ...(rowAction ? { action: rowAction } : {}),
      ...(unbooked ? { picker: bankKindPicker(tx) } : {}),
    });
  }

  const sort = input.sort ?? null;
  if (sort) {
    rows.sort((a, b) => compareEconomyRows(bankSortable(a), bankSortable(b), sort));
  } else {
    rows.sort((a, b) => b.date.localeCompare(a.date));
  }
  return paginate(rows, input.page ?? 1, input.pageSize ?? ECONOMY_PAGE_SIZE);
}
