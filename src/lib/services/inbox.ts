import { db, save } from "../store";
import { uid } from "../ids";
import { CONFIDENCE_THRESHOLDS, decideFromConfidence } from "../autopilot";
import {
  inboundMailAddress,
  inboundSlugFromTo,
  type InboundMailPayload,
} from "../inbox/inbound-mail";
import {
  amountIsCertain,
  classifyEconomicDocument,
  countsTowardInboxBadge,
  extractedFieldState,
  inboxDisplayStatus,
  inboxDocumentTitle,
  isInboxItemOpen,
  needsAmountReview,
  type ExtractedFieldState,
  type InboxDisplayStatus,
  type InboxStatusTone,
} from "../inbox/workflow";
import type {
  ExtractedField,
  InboxAttachment,
  InboxDocumentType,
  InboxExtraction,
  InboxItem,
  InboxItemSource,
  InboxItemStatus,
  SupplierInvoice,
} from "../types";
import { createExpenseFromKnownReceipt, merchantRuleKey } from "./expenses";
import { type PagedResult } from "./customers";
import { attachExtractedPaymentDetails, bookSupplierInvoice, receiveSupplierInvoice } from "./suppliers";
import { latestPaymentForInvoice, prepareSupplierPayment } from "./supplier-payments";
import { paymentDetailsInfo, type PaymentDetailsCause } from "./payment-details";

export type { PagedResult };

export const INBOX_PAGE_SIZE = 20;

export type InboxListFilter = "oppna" | "alla";

export interface InboxListRow {
  id: string;
  documentType: InboxDocumentType;
  fromLabel: string;
  documentLabel: string;
  dueDate?: string;
  createdAt: string;
  amount?: number;
  statusLabel: string;
  statusTone: InboxStatusTone;
}

export function inboxItems(): InboxItem[] {
  return db().inboxItems ?? [];
}

export function inboundAddressForBusiness(): string {
  const slug = db().settings.inboundMailSlug || "demo";
  return inboundMailAddress(slug);
}

function invoiceForItem(item: InboxItem) {
  if (!item.supplierInvoiceId) return undefined;
  return db().supplierInvoices.find((s) => s.id === item.supplierInvoiceId);
}

function paymentForItem(item: InboxItem) {
  return item.supplierInvoiceId ? latestPaymentForInvoice(item.supplierInvoiceId) : undefined;
}

/** Betalningsuppgifternas härledda orsak för postens faktura (om någon). */
function detailsCauseForItem(invoice?: SupplierInvoice): PaymentDetailsCause | undefined {
  if (!invoice || invoice.status === "betald") return undefined;
  return paymentDetailsInfo(invoice).cause;
}

export function countOpenInboxMail(): number {
  let n = 0;
  for (const item of inboxItems()) {
    if (isInboxItemOpen({ item, invoice: invoiceForItem(item), payment: paymentForItem(item) })) n += 1;
  }
  return n;
}

export function countInboxBadge(): number {
  let n = 0;
  for (const item of inboxItems()) {
    const invoice = invoiceForItem(item);
    if (
      countsTowardInboxBadge({
        item,
        invoice,
        payment: paymentForItem(item),
        detailsCause: detailsCauseForItem(invoice),
      })
    ) {
      n += 1;
    }
  }
  return n;
}

/** Nav-badge: nya + behöver granskas + väntar på betalningsgodkännande. */
export function countOpenInbox(): number {
  return countInboxBadge();
}

function mailMatchesQuery(item: InboxItem, q: string): boolean {
  if (!q) return true;
  const invoice = invoiceForItem(item);
  const payment = paymentForItem(item);
  const amount = invoice?.amount ?? item.parsedAmount;
  const hay = [
    item.fromAddress,
    item.toAddress,
    item.subject,
    item.textBody,
    item.parsedSupplier,
    item.parsedInvoiceNumber,
    item.parsedOcr,
    item.parsedBankgiro,
    invoice?.supplier,
    invoice?.invoiceNumber,
    invoice?.ocr,
    invoice?.bankgiro,
    payment?.ocr,
    payment?.recipientAccount,
    amount != null ? String(amount) : "",
    amount != null ? amount.toLocaleString("sv-SE") : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function toMailRow(item: InboxItem): InboxListRow {
  const invoice = invoiceForItem(item);
  const payment = paymentForItem(item);
  const display = inboxDisplayStatus({ item, invoice, payment, detailsCause: detailsCauseForItem(invoice) });
  const amount = invoice?.amount ?? item.parsedAmount;
  const due = invoice?.dueDate ?? item.parsedDueDate;
  return {
    id: item.id,
    documentType: item.documentType,
    fromLabel: invoice?.supplier ?? item.parsedSupplier ?? item.fromAddress,
    documentLabel: inboxDocumentTitle(item, invoice),
    dueDate: due,
    createdAt: item.createdAt,
    amount,
    statusLabel: display.label,
    statusTone: display.tone,
  };
}

export function listInbox(input: {
  q?: string;
  filter?: InboxListFilter;
  page?: number;
  pageSize?: number;
} = {}): PagedResult<InboxListRow> {
  const q = (input.q ?? "").trim().toLowerCase();
  const filter = input.filter ?? "oppna";
  const pageSize = input.pageSize ?? INBOX_PAGE_SIZE;
  const page = Math.max(1, input.page ?? 1);

  const rows: InboxListRow[] = [];
  for (const item of inboxItems()) {
    const invoice = invoiceForItem(item);
    const payment = paymentForItem(item);
    if (filter === "oppna" && !isInboxItemOpen({ item, invoice, payment })) continue;
    if (!mailMatchesQuery(item, q)) continue;
    rows.push(toMailRow(item));
  }

  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.documentLabel.localeCompare(b.documentLabel, "sv"));
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    total,
    totalPages,
  };
}

export function getInboxMail(id: string): InboxItem | undefined {
  return inboxItems().find((item) => item.id === id);
}

export function getInboxView(id: string):
  | { kind: "mail"; item: InboxItem; display: InboxDisplayStatus }
  | undefined {
  const item = getInboxMail(id);
  if (item) {
    const invoice = invoiceForItem(item);
    return {
      kind: "mail",
      item,
      display: inboxDisplayStatus({
        item,
        invoice,
        payment: paymentForItem(item),
        detailsCause: detailsCauseForItem(invoice),
      }),
    };
  }
  return undefined;
}

export function inboundSlugMatches(to: string): boolean {
  const slug = inboundSlugFromTo(to);
  const expected = db().settings.inboundMailSlug;
  return Boolean(slug && expected && slug === expected);
}

export type IngestResult =
  | { ok: true; item: InboxItem; created: boolean; autoBooked: boolean }
  | { ok: false; error: string; status: number };

function applyParsedFields(item: InboxItem, parsed: NonNullable<InboundMailPayload["parsed"]>): void {
  if (typeof parsed.amount === "number" && Number.isInteger(parsed.amount) && parsed.amount >= 1) {
    item.parsedAmount = parsed.amount;
  }
  if (typeof parsed.vatAmount === "number" && Number.isInteger(parsed.vatAmount) && parsed.vatAmount >= 0) {
    item.parsedVatAmount = parsed.vatAmount;
  }
  if (parsed.supplier?.trim()) item.parsedSupplier = parsed.supplier.trim();
  if (parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) item.parsedDate = parsed.date;
  if (parsed.invoiceNumber?.trim()) item.parsedInvoiceNumber = parsed.invoiceNumber.trim();
  if (parsed.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(parsed.dueDate)) item.parsedDueDate = parsed.dueDate;
  if (parsed.ocr?.trim()) item.parsedOcr = parsed.ocr.trim();
  if (parsed.bankgiro?.trim()) item.parsedBankgiro = parsed.bankgiro.trim();
  if (typeof parsed.detailsConfidence === "number") item.parsedDetailsConfidence = parsed.detailsConfidence;
  if (typeof parsed.confidence === "number") item.confidence = parsed.confidence;
  item.extraction = extractionFromParsed(item, parsed);
}

const EXTRACTION_SOURCE_DOCUMENT = "dokument";
const EXTRACTION_SOURCE_REVIEWED = "kontrollerad av dig";

/**
 * Per-fält-proveniens: vad Driva läst, med konfidens per fält.
 * fieldConfidence från tolken vinner; annars gäller dokumentkonfidensen
 * (och detaljkonfidensen för bankgiro/OCR).
 */
function extractionFromParsed(
  item: InboxItem,
  parsed: NonNullable<InboundMailPayload["parsed"]>
): InboxExtraction | undefined {
  const base = parsed.confidence ?? 0;
  const details = parsed.detailsConfidence ?? base;
  const fc = parsed.fieldConfidence ?? {};
  const field = <T,>(value: T | undefined, confidence: number): { value: T; confidence: number; source: string } | undefined =>
    value === undefined ? undefined : { value, confidence, source: EXTRACTION_SOURCE_DOCUMENT };

  const extraction: InboxExtraction = {
    ...(item.parsedSupplier ? { supplier: field(item.parsedSupplier, fc.supplier ?? base)! } : {}),
    ...(item.parsedInvoiceNumber
      ? { invoiceNumber: field(item.parsedInvoiceNumber, fc.invoiceNumber ?? base)! }
      : {}),
    ...(item.parsedDate ? { invoiceDate: field(item.parsedDate, fc.date ?? base)! } : {}),
    ...(item.parsedDueDate ? { dueDate: field(item.parsedDueDate, fc.dueDate ?? base)! } : {}),
    ...(item.parsedAmount !== undefined ? { amount: field(item.parsedAmount, fc.amount ?? base)! } : {}),
    ...(item.parsedVatAmount !== undefined
      ? { vatAmount: field(item.parsedVatAmount, fc.vatAmount ?? base)! }
      : {}),
    ...(item.parsedOcr ? { ocr: field(item.parsedOcr, fc.ocr ?? details)! } : {}),
    ...(item.parsedBankgiro ? { bankgiro: field(item.parsedBankgiro, fc.bankgiro ?? details)! } : {}),
  };
  return Object.keys(extraction).length > 0 ? extraction : undefined;
}

/**
 * Proveniens för dokumentets betalningsuppgifter: bara läsningar över
 * AUTO-tröskeln blir betalbara ("document"); allt annat blir en kandidat
 * som människan kontrollerar ("document_uncertain"). Aldrig gissningar.
 */
function detailsProvenanceForItem(item: InboxItem): "document" | "document_uncertain" | undefined {
  if (!item.parsedBankgiro?.trim()) return undefined;
  const base = item.confidence ?? 0;
  const details = Math.min(base, item.parsedDetailsConfidence ?? base);
  return decideFromConfidence(details) === "AUTO_EXECUTE" ? "document" : "document_uncertain";
}

/**
 * Nytt dokument/svar som inte är en komplett faktura men innehåller
 * betalningsuppgifter: matcha tillbaka mot en faktura som väntar på uppgifter
 * (MISSING/AWAITING_SUPPLIER/EXTRACTION_UNCERTAIN). Matchning i fallande
 * säkerhet: fakturanummer → avsändaren vi bad om komplettering → entydig
 * leverantör. Ingen träff = posten ligger kvar för manuell granskning.
 */
function tryCompleteAwaitingDetails(item: InboxItem): boolean {
  const account = item.parsedBankgiro?.trim();
  if (!account) return false;

  const waiting = db().supplierInvoices.filter((s) => {
    if (s.status === "betald") return false;
    const cause = paymentDetailsInfo(s).cause;
    return cause === "MISSING" || cause === "AWAITING_SUPPLIER" || cause === "EXTRACTION_UNCERTAIN";
  });
  if (waiting.length === 0) return false;

  let target: SupplierInvoice | undefined;
  if (item.parsedInvoiceNumber?.trim()) {
    const number = item.parsedInvoiceNumber.trim().toLowerCase();
    target = waiting.find((s) => s.invoiceNumber.trim().toLowerCase() === number);
  }
  if (!target) {
    const from = item.fromAddress.trim().toLowerCase();
    const byRequest = waiting.filter((s) => s.paymentDetails?.request?.to?.trim().toLowerCase() === from);
    if (byRequest.length === 1) target = byRequest[0];
  }
  if (!target && item.parsedSupplier?.trim()) {
    const key = merchantRuleKey(item.parsedSupplier);
    const bySupplier = waiting.filter((s) => key && merchantRuleKey(s.supplier) === key);
    if (bySupplier.length === 1) target = bySupplier[0];
  }
  if (!target) return false;

  const attached = attachExtractedPaymentDetails(target.id, {
    account,
    ocr: item.parsedOcr,
    provenance: detailsProvenanceForItem(item) ?? "document_uncertain",
    by: "assistent",
  });
  if (!attached) return false;
  item.supplierInvoiceId = target.id;
  if (item.status === "ny") {
    item.status = "behandlad";
    item.processedAt = new Date().toISOString();
  }
  return true;
}

function runDocumentPipeline(item: InboxItem): { autoBooked: boolean } {
  let autoBooked = false;
  const conf = item.confidence ?? 0;
  // Mänskligt godkända uppgifter (reviewedAt) väger som säker läsning.
  const auto = item.reviewedAt != null || decideFromConfidence(conf) === "AUTO_EXECUTE";

  if (item.documentType === "kvitto") {
    if (auto && amountIsCertain(item) && item.parsedAmount != null && item.parsedVatAmount != null && item.parsedSupplier) {
      const { expense, autoBooked: booked } = createExpenseFromKnownReceipt({
        supplier: item.parsedSupplier,
        amount: item.parsedAmount,
        vatAmount: item.parsedVatAmount,
        date: item.parsedDate ?? item.createdAt.slice(0, 10),
        description: item.subject,
        filename: item.attachments[0]?.filename,
        source: item.source === "uppladdning" ? "uppladdning" : "email",
      });
      item.expenseId = expense.id;
      autoBooked = booked;
      if (booked) {
        item.status = "bokford";
        item.processedAt = new Date().toISOString();
      }
    }
    return { autoBooked };
  }

  const completeInvoice =
    item.parsedAmount != null &&
    item.parsedVatAmount != null &&
    Boolean(item.parsedSupplier) &&
    Boolean(item.parsedInvoiceNumber);

  if (!completeInvoice) {
    // Ofullständigt dokument med betalningsuppgifter kan vara leverantörens
    // komplettering – matcha tillbaka mot fakturor som väntar på uppgifter.
    tryCompleteAwaitingDetails(item);
    return { autoBooked };
  }

  // Osäkert belopp: skapa INGEN faktura på en siffra som kan vara felläst.
  // Dokumentet stannar som "ny" tills en människa kontrollerat mot PDF:en
  // (Kontrollera belopp) – därefter körs pipelinen om med godkända värden.
  if (!amountIsCertain(item)) {
    return { autoBooked };
  }

  const invoice = receiveSupplierInvoice({
    supplier: item.parsedSupplier!,
    invoiceNumber: item.parsedInvoiceNumber!,
    amount: item.parsedAmount!,
    vatAmount: item.parsedVatAmount!,
    date: item.parsedDate ?? item.createdAt.slice(0, 10),
    dueDate: item.parsedDueDate,
    description: item.subject || `Faktura ${item.parsedInvoiceNumber}`,
    ocr: item.parsedOcr,
    bankgiro: item.parsedBankgiro,
    detailsProvenance: detailsProvenanceForItem(item),
    inboxItemId: item.id,
    book: auto,
    by: auto ? "assistent" : "anvandare",
  });
  item.supplierInvoiceId = invoice.id;
  item.status = invoice.accountingStatus === "bokford" ? "bokford" : "behandlad";
  item.processedAt = new Date().toISOString();
  autoBooked = invoice.accountingStatus === "bokford";
  if (autoBooked && (invoice.bankgiro || invoice.recipientAccount)) {
    try {
      prepareSupplierPayment({ supplierInvoiceId: invoice.id });
    } catch {
      /* saknade bankuppgifter – fakturan är ändå bokförd */
    }
  }
  return { autoBooked };
}

/**
 * Idempotent ingest. Andra post med samma external_id är no-op.
 * Autopilot bokar bara vid konfidens ≥ AUTO och kända belopp – aldrig gissade.
 * Betalning skickas ALDRIG här.
 */
export function ingestEconomicDocument(
  payload: InboundMailPayload,
  opts: { source?: InboxItemSource; kind?: InboxItem["kind"] } = {}
): IngestResult {
  const data = db();
  const items = data.inboxItems ?? (data.inboxItems = []);
  const existing = payload.externalId ? items.find((i) => i.externalId === payload.externalId) : undefined;
  if (existing) {
    return { ok: true, item: existing, created: false, autoBooked: false };
  }

  const parsed = payload.parsed;
  const attachments: InboxAttachment[] = (payload.attachments ?? []).map((a) => ({
    id: uid(),
    filename: a.filename,
    contentType: a.contentType,
    size: a.size ?? 0,
    storageKey: `inbox/${payload.externalId}/${a.filename}`,
  }));

  const documentType = classifyEconomicDocument({
    subject: payload.subject,
    text: payload.text,
    invoiceNumber: parsed?.invoiceNumber,
    dueDate: parsed?.dueDate,
    ocr: parsed?.ocr,
    bankgiro: parsed?.bankgiro,
    documentType: parsed?.documentType,
  });

  const item: InboxItem = {
    id: `inbox-${uid()}`,
    kind: opts.kind ?? "mail",
    status: "ny",
    documentType,
    source: opts.source ?? "email",
    externalId: payload.externalId,
    fromAddress: payload.from,
    toAddress: payload.to,
    subject: payload.subject,
    textBody: payload.text,
    ...(payload.html ? { htmlBody: payload.html } : {}),
    attachments,
    createdAt: new Date().toISOString(),
  };
  if (parsed) applyParsedFields(item, parsed);
  items.push(item);

  const { autoBooked } = runDocumentPipeline(item);
  save();
  return { ok: true, item, created: true, autoBooked };
}

export function ingestInboundMail(payload: InboundMailPayload): IngestResult {
  if (!inboundSlugMatches(payload.to)) {
    return { ok: false, error: "Okänd inkommande adress", status: 404 };
  }
  return ingestEconomicDocument(payload, { source: "email", kind: "mail" });
}

export function ingestUploadedDocument(input: {
  filename: string;
  contentType?: string;
  text?: string;
  parsed?: InboundMailPayload["parsed"];
}): IngestResult {
  const address = inboundAddressForBusiness();
  return ingestEconomicDocument(
    {
      externalId: `upload-${uid()}`,
      to: address,
      from: "uppladdning",
      subject: input.filename || "Uppladdat dokument",
      text: input.text ?? "",
      attachments: [
        {
          filename: input.filename || "dokument.pdf",
          contentType: input.contentType || "application/pdf",
        },
      ],
      parsed: input.parsed,
    },
    { source: "uppladdning", kind: "uppladdning" }
  );
}

/* --------------------- Kontrollera & godkänn tolkningen --------------------- */

export type ExtractionFieldKey =
  | "supplier"
  | "invoiceNumber"
  | "invoiceDate"
  | "dueDate"
  | "amount"
  | "vatAmount"
  | "ocr"
  | "bankgiro";

export const EXTRACTION_FIELD_LABELS: Record<ExtractionFieldKey, string> = {
  supplier: "Leverantör",
  invoiceNumber: "Fakturanummer",
  invoiceDate: "Fakturadatum",
  dueDate: "Förfallodatum",
  amount: "Belopp (inkl. moms)",
  vatAmount: "Moms",
  ocr: "OCR/referens",
  bankgiro: "Bankgiro",
};

export interface ExtractionReviewField {
  key: ExtractionFieldKey;
  label: string;
  /** Belopp som tal i kronor, övriga som text. null = Driva läste inget. */
  value: string | number | null;
  confidence: number;
  /** "saker" eller "kontrollera" – aldrig råa decimaler i UI:t. */
  state: ExtractedFieldState;
}

export interface ExtractionReview {
  itemId: string;
  documentType: InboxDocumentType;
  fields: ExtractionReviewField[];
  /** Kan uppgifterna godkännas här? */
  editable: boolean;
  blockedReason?: string;
}

/** Relevanta fält per dokumenttyp – kvitton har varken OCR eller förfallodatum. */
function reviewFieldKeys(documentType: InboxDocumentType): ExtractionFieldKey[] {
  if (documentType === "kvitto") return ["supplier", "invoiceDate", "amount", "vatAmount"];
  return ["supplier", "invoiceNumber", "invoiceDate", "dueDate", "amount", "vatAmount", "ocr", "bankgiro"];
}

function reviewField(item: InboxItem, key: ExtractionFieldKey): ExtractionReviewField {
  const extracted: ExtractedField<string> | ExtractedField<number> | undefined = item.extraction?.[key];
  const fallback: string | number | undefined = {
    supplier: item.parsedSupplier,
    invoiceNumber: item.parsedInvoiceNumber,
    invoiceDate: item.parsedDate,
    dueDate: item.parsedDueDate,
    amount: item.parsedAmount,
    vatAmount: item.parsedVatAmount,
    ocr: item.parsedOcr,
    bankgiro: item.parsedBankgiro,
  }[key];
  const value = extracted?.value ?? fallback ?? null;
  const confidence = item.reviewedAt ? 1 : extracted?.confidence ?? (value != null ? item.confidence ?? 0 : 0);
  const state: ExtractedFieldState =
    value == null ? "kontrollera" : extractedFieldState({ value, confidence }) ?? "kontrollera";
  return { key, label: EXTRACTION_FIELD_LABELS[key], value, confidence, state };
}

/**
 * Underlag för Kontrollera-vyn (PDF till vänster, Drivas läsning till höger)
 * och AI-verktyget review_document_extraction. Samma sanning för båda.
 */
export function extractionReviewForItem(id: string): ExtractionReview {
  const item = getInboxMail(id);
  if (!item) throw new Error("Posten finns inte i inboxen.");
  const fields = reviewFieldKeys(item.documentType).map((key) => reviewField(item, key));
  if (item.expenseId || item.supplierInvoiceId) {
    return {
      itemId: item.id,
      documentType: item.documentType,
      fields,
      editable: false,
      blockedReason: item.supplierInvoiceId
        ? "Dokumentet är redan kopplat till en leverantörsfaktura – ändra uppgifterna där."
        : "Dokumentet är redan kopplat till en utgift – ändra uppgifterna där.",
    };
  }
  return { itemId: item.id, documentType: item.documentType, fields, editable: true };
}

export interface ApproveExtractionInput {
  itemId: string;
  /** Rätta dokumenttypen om Driva klassificerat fel – typen styr livscykeln. */
  documentType?: "kvitto" | "leverantorsfaktura";
  supplier?: string;
  invoiceNumber?: string;
  /** Fakturadatum/kvittodatum YYYY-MM-DD. */
  date?: string;
  dueDate?: string;
  /** Totalbelopp inkl. moms i hela kronor. */
  amount?: number;
  /** Moms i hela kronor (0 om moms saknas). */
  vatAmount?: number;
  ocr?: string;
  bankgiro?: string;
  by?: "anvandare" | "assistent";
}

export interface ApproveExtractionResult {
  item: InboxItem;
  autoBooked: boolean;
  expenseId?: string;
  invoiceId?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "Godkänn uppgifter": persistera de kontrollerade/rättade värdena på
 * dokumentet och kör om dokumentpipelinen. Dokumenttypen styr livscykeln –
 * kvitto → utgift (aldrig utbetalning), leverantörsfaktura → bokförs och
 * förbereder betalning. Människans godkännande väger som säker läsning.
 */
export function approveInboxExtraction(input: ApproveExtractionInput): ApproveExtractionResult {
  const item = getInboxMail(input.itemId);
  if (!item) throw new Error("Posten finns inte i inboxen.");
  if (item.expenseId) {
    throw new Error("Dokumentet är redan kopplat till en utgift – uppgifterna ändras där i stället.");
  }
  if (item.supplierInvoiceId) {
    throw new Error("Dokumentet är redan kopplat till en leverantörsfaktura – uppgifterna ändras där i stället.");
  }

  const documentType = input.documentType ?? item.documentType;
  if (documentType !== "kvitto" && documentType !== "leverantorsfaktura") {
    throw new Error("Välj om dokumentet är ett kvitto eller en leverantörsfaktura.");
  }

  const supplier = (input.supplier ?? item.parsedSupplier ?? "").trim();
  if (!supplier) throw new Error("Ange leverantör – Driva gissar aldrig.");
  const amount = input.amount ?? item.parsedAmount;
  if (amount == null || !Number.isInteger(amount) || amount < 1) {
    throw new Error("Ange totalbeloppet i hela kronor (kontrollera mot dokumentet).");
  }
  const vatAmount = input.vatAmount ?? item.parsedVatAmount;
  if (vatAmount == null || !Number.isInteger(vatAmount) || vatAmount < 0 || vatAmount > amount) {
    throw new Error("Ange momsbeloppet i hela kronor (0 om moms saknas).");
  }
  if (documentType === "leverantorsfaktura" && vatAmount >= amount) {
    throw new Error("Momsbeloppet måste vara mindre än totalbeloppet.");
  }
  const invoiceNumber = (input.invoiceNumber ?? item.parsedInvoiceNumber ?? "").trim();
  if (documentType === "leverantorsfaktura" && !invoiceNumber) {
    throw new Error("Ange fakturanumret från dokumentet.");
  }
  const date = (input.date ?? item.parsedDate ?? "").slice(0, 10);
  if (date && !DATE_RE.test(date)) throw new Error("Fakturadatum måste vara YYYY-MM-DD.");
  const dueDate = (input.dueDate ?? item.parsedDueDate ?? "").slice(0, 10);
  if (dueDate && !DATE_RE.test(dueDate)) throw new Error("Förfallodatum måste vara YYYY-MM-DD.");
  const ocr = (input.ocr ?? item.parsedOcr ?? "").trim();
  if (ocr && !/^\d{2,25}$/.test(ocr.replace(/\s/g, ""))) {
    throw new Error("OCR-numret innehåller annat än siffror – kontrollera mot dokumentet.");
  }
  const bankgiro = (input.bankgiro ?? item.parsedBankgiro ?? "").trim();
  if (bankgiro && !/^\d{7,8}$/.test(bankgiro.replace(/[\s-]/g, ""))) {
    throw new Error("Bankgiro har 7–8 siffror (t.ex. 123-4567).");
  }

  // Persistera godkända värden. Människans kontroll = full konfidens.
  const now = new Date().toISOString();
  item.documentType = documentType;
  item.parsedSupplier = supplier;
  item.parsedAmount = amount;
  item.parsedVatAmount = vatAmount;
  if (invoiceNumber) item.parsedInvoiceNumber = invoiceNumber;
  if (date) item.parsedDate = date;
  if (dueDate) item.parsedDueDate = dueDate;
  if (ocr) item.parsedOcr = ocr;
  else delete item.parsedOcr;
  if (bankgiro) item.parsedBankgiro = bankgiro;
  else delete item.parsedBankgiro;
  item.confidence = 1;
  item.parsedDetailsConfidence = 1;
  item.reviewedAt = now;

  const reviewed = <T,>(value: T): ExtractedField<T> => ({
    value,
    confidence: 1,
    source: EXTRACTION_SOURCE_REVIEWED,
  });
  item.extraction = {
    supplier: reviewed(supplier),
    amount: reviewed(amount),
    vatAmount: reviewed(vatAmount),
    ...(invoiceNumber ? { invoiceNumber: reviewed(invoiceNumber) } : {}),
    ...(date ? { invoiceDate: reviewed(date) } : {}),
    ...(dueDate ? { dueDate: reviewed(dueDate) } : {}),
    ...(ocr ? { ocr: reviewed(ocr) } : {}),
    ...(bankgiro ? { bankgiro: reviewed(bankgiro) } : {}),
  };

  // Kör om pipelinen med godkända värden – dokumenttypen styr livscykeln.
  const { autoBooked } = runDocumentPipeline(item);
  save();
  return {
    item,
    autoBooked,
    ...(item.expenseId ? { expenseId: item.expenseId } : {}),
    ...(item.supplierInvoiceId ? { invoiceId: item.supplierInvoiceId } : {}),
  };
}

export function markInboxMailProcessed(id: string): InboxItem {
  const item = getInboxMail(id);
  if (!item) throw new Error("Posten finns inte i inboxen.");
  if (item.status === "ny") {
    item.status = "behandlad";
    item.processedAt = new Date().toISOString();
    save();
  }
  return item;
}

export function createExpenseFromInboxItem(id: string): { expenseId: string; autoBooked: boolean } {
  const item = getInboxMail(id);
  if (!item) throw new Error("Posten finns inte i inboxen.");
  if (item.expenseId) return { expenseId: item.expenseId, autoBooked: false };
  if (item.parsedAmount == null || item.parsedVatAmount == null || !item.parsedSupplier) {
    throw new Error("Belopp eller leverantör saknas – Driva gissar inte belopp.");
  }
  const { expense, autoBooked } = createExpenseFromKnownReceipt({
    supplier: item.parsedSupplier,
    amount: item.parsedAmount,
    vatAmount: item.parsedVatAmount,
    date: item.parsedDate ?? item.createdAt.slice(0, 10),
    description: item.subject,
    filename: item.attachments[0]?.filename,
    source: item.source === "uppladdning" ? "uppladdning" : "email",
  });
  item.expenseId = expense.id;
  item.status = autoBooked ? "bokford" : "behandlad";
  item.processedAt = new Date().toISOString();
  save();
  return { expenseId: expense.id, autoBooked };
}

export function createSupplierInvoiceFromInboxItem(id: string): { invoiceId: string; autoBooked: boolean } {
  const item = getInboxMail(id);
  if (!item) throw new Error("Posten finns inte i inboxen.");
  if (item.supplierInvoiceId) {
    const existing = db().supplierInvoices.find((s) => s.id === item.supplierInvoiceId);
    return { invoiceId: item.supplierInvoiceId, autoBooked: existing?.accountingStatus === "bokford" };
  }
  if (item.parsedAmount == null || item.parsedVatAmount == null || !item.parsedSupplier || !item.parsedInvoiceNumber) {
    throw new Error("Leverantör, fakturanummer eller belopp saknas – Driva gissar inte.");
  }
  const invoice = receiveSupplierInvoice({
    supplier: item.parsedSupplier,
    invoiceNumber: item.parsedInvoiceNumber,
    amount: item.parsedAmount,
    vatAmount: item.parsedVatAmount,
    date: item.parsedDate ?? item.createdAt.slice(0, 10),
    dueDate: item.parsedDueDate,
    description: item.subject || `Faktura ${item.parsedInvoiceNumber}`,
    ocr: item.parsedOcr,
    bankgiro: item.parsedBankgiro,
    detailsProvenance: detailsProvenanceForItem(item),
    inboxItemId: item.id,
    book: true,
  });
  item.supplierInvoiceId = invoice.id;
  item.status = "bokford";
  item.processedAt = new Date().toISOString();
  if (invoice.bankgiro || invoice.recipientAccount) {
    try {
      prepareSupplierPayment({ supplierInvoiceId: invoice.id });
    } catch {
      /* */
    }
  }
  save();
  return { invoiceId: invoice.id, autoBooked: true };
}

export function bookSupplierInvoiceFromInboxItem(id: string): { invoiceId: string } {
  const item = getInboxMail(id);
  if (!item) throw new Error("Posten finns inte i inboxen.");
  if (!item.supplierInvoiceId) {
    return { invoiceId: createSupplierInvoiceFromInboxItem(id).invoiceId };
  }
  const invoice = bookSupplierInvoice(item.supplierInvoiceId);
  item.status = "bokford";
  item.processedAt = new Date().toISOString();
  save();
  return { invoiceId: invoice.id };
}

export function attachInboxItemToExpense(id: string, expenseId: string): InboxItem {
  const item = getInboxMail(id);
  if (!item) throw new Error("Posten finns inte i inboxen.");
  const expense = db().expenses.find((e) => e.id === expenseId);
  if (!expense) throw new Error("Utgiften finns inte.");
  item.expenseId = expenseId;
  if (item.status === "ny") {
    item.status = "behandlad";
    item.processedAt = new Date().toISOString();
  }
  save();
  return item;
}

export { CONFIDENCE_THRESHOLDS };
export type { InboxItemStatus, InboxDisplayStatus };
