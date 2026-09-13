/**
 * Dokumentrader: kvitto/leverantörsfaktura → operativa materialrader.
 *
 * Bokföringsunderlaget (Expense/SupplierInvoice) skapas i de befintliga
 * tjänsterna. Den här modulen äger bara artikelraderna och länken till
 * JobWorkEntry. Fakturering går via closeout-allokeringen (work_entry).
 */
import { db, save } from "../store";
import { uid } from "../ids";
import type {
  DocumentLine,
  DocumentLineAllocation,
  DocumentLineDisposition,
  DocumentLineSource,
  DocumentLineStatus,
  DocumentLineValues,
  InboxItem,
  Job,
} from "../types";
import type { InboundParsedHint, InboundParsedLine } from "../inbox/inbound-mail";
import { allocationOverflow, validateDocumentLineMath } from "../document-line-math";
import { resolveMaterialCustomerPrice } from "../material-price";
import { addJobMaterial, jobWorkEntries } from "./job-work";
import { getJob, requireCustomer } from "./data";
import { logActivity } from "./activity";
import { jobByPurchaseRef } from "../ferva-reference";
import { extractAllFervaReferences } from "../wholesalers/confirmation-parse";

const LINE_REVIEW_THRESHOLD = 0.7;

export function documentLines(): DocumentLine[] {
  const data = db();
  data.documentLines ??= [];
  return data.documentLines;
}

export function linesForSource(source: DocumentLineSource, sourceDocumentId: string): DocumentLine[] {
  return documentLines()
    .filter((l) => l.source === source && l.sourceDocumentId === sourceDocumentId)
    .sort((a, b) => a.sourceIndex - b.sourceIndex);
}

export function linesForExpense(expenseId: string): DocumentLine[] {
  return documentLines().filter((l) => l.expenseId === expenseId);
}

export function linesForInboxItem(inboxItemId: string): DocumentLine[] {
  return documentLines().filter((l) => l.inboxItemId === inboxItemId);
}

export function getDocumentLine(id: string): DocumentLine | undefined {
  return documentLines().find((l) => l.id === id);
}

function requireLine(id: string): DocumentLine {
  const line = getDocumentLine(id);
  if (!line) throw new Error("Raden finns inte");
  return line;
}

export function expenseHasDocumentLines(expenseId: string): boolean {
  return linesForExpense(expenseId).length > 0;
}

function valuesFromParsed(line: InboundParsedLine): DocumentLineValues {
  const values: DocumentLineValues = {};
  if (line.articleNumber?.trim()) values.articleNumber = line.articleNumber.trim();
  if (line.name?.trim()) values.name = line.name.trim();
  if (typeof line.qty === "number" && Number.isFinite(line.qty)) values.qty = line.qty;
  if (line.unit?.trim()) values.unit = line.unit.trim();
  if (typeof line.unitPrice === "number" && Number.isFinite(line.unitPrice)) values.unitPrice = Math.round(line.unitPrice);
  if (typeof line.lineAmount === "number" && Number.isFinite(line.lineAmount)) values.lineAmount = Math.round(line.lineAmount);
  if (typeof line.discount === "number" && Number.isFinite(line.discount)) values.discount = Math.round(line.discount);
  if (typeof line.vatRate === "number" && Number.isFinite(line.vatRate)) values.vatRate = line.vatRate;
  if (typeof line.vatAmount === "number" && Number.isFinite(line.vatAmount)) values.vatAmount = Math.round(line.vatAmount);
  if (typeof line.page === "number" && Number.isFinite(line.page)) values.page = line.page;
  if (line.unreadable) values.unreadable = true;
  if (line.role) values.role = line.role;
  return values;
}

function lineNeedsReview(line: InboundParsedLine, mathOk: boolean): boolean {
  if (line.unreadable) return true;
  if (!mathOk) return true;
  const conf = line.fieldConfidence;
  if (!conf) return false;
  const keys = ["name", "qty", "lineAmount"] as const;
  return keys.some((k) => conf[k] != null && conf[k]! < LINE_REVIEW_THRESHOLD);
}

export interface UpsertDocumentLinesInput {
  source: DocumentLineSource;
  sourceDocumentId: string;
  inboxItemId?: string;
  receiptId?: string;
  expenseId?: string;
  supplierInvoiceId?: string;
  purchaseOrderId?: string;
  purchaseOrderConfirmationId?: string;
  parsed: InboundParsedHint;
  /** När flödet startades från ett uppdrag. */
  startedFromJobId?: string;
}

export function upsertDocumentLinesFromParsed(input: UpsertDocumentLinesInput): DocumentLine[] {
  const parsedLines = input.parsed.lines ?? [];
  const math = validateDocumentLineMath({
    lines: parsedLines,
    documentTotal: input.parsed.amount ?? 0,
  });
  const now = new Date().toISOString();
  const existing = linesForSource(input.source, input.sourceDocumentId);
  const out: DocumentLine[] = [];

  parsedLines.forEach((parsed, index) => {
    const raw = valuesFromParsed(parsed);
    const found = existing.find((l) => l.sourceIndex === index);
    const status: DocumentLineStatus = lineNeedsReview(parsed, math.ok) ? "needs_review" : "proposed";
    if (found) {
      if (found.status === "confirmed" || found.status === "rejected") {
        out.push(found);
        return;
      }
      found.raw = raw;
      found.mathOk = math.ok;
      found.status = status;
      found.updatedAt = now;
      if (input.expenseId) found.expenseId = input.expenseId;
      if (input.receiptId) found.receiptId = input.receiptId;
      if (input.supplierInvoiceId) found.supplierInvoiceId = input.supplierInvoiceId;
      out.push(found);
      return;
    }
    const line: DocumentLine = {
      id: uid(),
      source: input.source,
      sourceDocumentId: input.sourceDocumentId,
      sourceIndex: index,
      raw,
      qty: raw.qty,
      unit: raw.unit ?? "st",
      unitCost: raw.unitPrice,
      articleNumber: raw.articleNumber,
      disposition: suggestDisposition(input.source, raw),
      status,
      allocations: [],
      mathOk: math.ok,
      createdAt: now,
      updatedAt: now,
      ...(input.inboxItemId ? { inboxItemId: input.inboxItemId } : {}),
      ...(input.receiptId ? { receiptId: input.receiptId } : {}),
      ...(input.expenseId ? { expenseId: input.expenseId } : {}),
      ...(input.supplierInvoiceId ? { supplierInvoiceId: input.supplierInvoiceId } : {}),
      ...(input.purchaseOrderId ? { purchaseOrderId: input.purchaseOrderId } : {}),
      ...(input.purchaseOrderConfirmationId
        ? { purchaseOrderConfirmationId: input.purchaseOrderConfirmationId }
        : {}),
      ...(parsed.fieldConfidence ? { fieldConfidence: parsed.fieldConfidence } : {}),
    };
    documentLines().push(line);
    out.push(line);
  });

  if (input.startedFromJobId) {
    const job = getJob(input.startedFromJobId);
    if (job) {
      for (const line of out) {
        if (line.status === "confirmed" || line.allocations.length > 0) continue;
        if (line.disposition !== "customer") continue;
        if (line.raw.unreadable) continue;
        applySuggestedJob(line, job.id, line.qty ?? 1);
      }
    }
  }

  save();
  return out;
}

function suggestDisposition(source: DocumentLineSource, raw: DocumentLineValues): DocumentLineDisposition {
  if (raw.role && raw.role !== "article") return "company";
  if (source === "receipt" || source === "order_confirmation") return "customer";
  return "company";
}

function applySuggestedJob(line: DocumentLine, jobId: string, qty: number): void {
  const amount = Math.round((line.unitCost ?? 0) * qty);
  line.allocations = [
    {
      id: uid(),
      jobId,
      qty,
      amountExclVat: amount,
    },
  ];
}

export function suggestJobsForDocument(input: {
  inboxItem?: InboxItem;
  supplier?: string;
  date?: string;
  fervaRefs?: string[];
  startedFromJobId?: string;
}): Array<{ job: Job; reason: string; method: NonNullable<InboxItem["jobMatchMethod"]> }> {
  const data = db();
  const out: Array<{ job: Job; reason: string; method: NonNullable<InboxItem["jobMatchMethod"]> }> = [];
  const seen = new Set<string>();

  function add(job: Job | undefined, reason: string, method: NonNullable<InboxItem["jobMatchMethod"]>) {
    if (!job || seen.has(job.id) || job.archivedAt) return;
    seen.add(job.id);
    out.push({ job, reason, method });
  }

  if (input.startedFromJobId) {
    add(getJob(input.startedFromJobId), "Du startade från uppdraget", "started_from_job");
  }
  for (const ref of input.fervaRefs ?? []) {
    add(jobByPurchaseRef(ref), `Referens ${ref}`, "subject_ref");
  }
  if (input.inboxItem) {
    const refs = extractAllFervaReferences(input.inboxItem.subject, input.inboxItem.textBody);
    for (const ref of refs) add(jobByPurchaseRef(ref), `Referens ${ref}`, "document_ref");
  }
  if (input.supplier) {
    const key = input.supplier.trim().toLowerCase();
    const recent = data.expenses
      .filter((e) => e.jobId && e.supplier.trim().toLowerCase() === key)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (recent[0]?.jobId) add(getJob(recent[0].jobId), `Tidigare köp hos ${input.supplier}`, "supplier");
  }
  const active = data.jobs
    .filter((j) => !j.archivedAt && (j.status === "pagar" || j.status === "kommande"))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const job of active.slice(0, 3)) {
    add(job, "Nyligen aktivt uppdrag", "recent");
  }
  return out;
}

export function lineReviewHeadline(sourceDocumentId: string, source: DocumentLineSource, jobTitle?: string): {
  found: string;
  question?: string;
} {
  const lines = linesForSource(source, sourceDocumentId);
  const first = lines[0];
  const item = first?.inboxItemId
    ? db().inboxItems.find((i) => i.id === first.inboxItemId)
    : undefined;
  const documentTotal = item?.parsedAmount ?? 0;
  const math = validateDocumentLineMath({
    lines: lines.map((l) => l.confirmed ?? l.raw),
    documentTotal,
  });
  const n = math.articleCount || lines.filter((l) => (l.raw.role ?? "article") === "article").length;
  const sum = documentTotal || lines.reduce((s, l) => s + (l.confirmed?.lineAmount ?? l.raw.lineAmount ?? 0), 0);
  const found =
    n === 1
      ? `Ferva hittade 1 vara för ${sum.toLocaleString("sv-SE")} kr`
      : `Ferva hittade ${n} varor för ${sum.toLocaleString("sv-SE")} kr`;
  return {
    found,
    ...(jobTitle ? { question: `Vilka användes på '${jobTitle}'?` } : {}),
  };
}

export function setLineDisposition(lineId: string, disposition: DocumentLineDisposition): DocumentLine {
  const line = requireLine(lineId);
  if (line.allocations.some((a) => a.jobWorkEntryId && workEntryLocked(a.jobWorkEntryId))) {
    throw new Error("Raden är redan fakturerad. Rätta via kreditfaktura.");
  }
  line.disposition = disposition;
  if (disposition !== "customer") {
    releaseUnbilledAllocations(line);
  }
  line.updatedAt = new Date().toISOString();
  save();
  return line;
}

function workEntryLocked(entryId: string): boolean {
  const entry = (db().jobWorkEntries ?? []).find((e) => e.id === entryId);
  if (!entry?.invoiceId) return false;
  const inv = db().invoices.find((i) => i.id === entry.invoiceId);
  return Boolean(inv && inv.status !== "utkast" && inv.status !== "krediterad" && inv.type !== "kredit");
}

function releaseUnbilledAllocations(line: DocumentLine): void {
  line.allocations = line.allocations.filter((a) => a.jobWorkEntryId && workEntryLocked(a.jobWorkEntryId));
}

export function setLineCustomerPrice(lineId: string, kronor: number | null): DocumentLine {
  const line = requireLine(lineId);
  if (kronor == null) {
    delete line.customerPrice;
    line.customerPriceSource = "missing";
    line.customerPriceExplanation = "Kundpris saknas.";
  } else {
    const n = Math.round(kronor);
    if (!Number.isFinite(n) || n < 0) throw new Error("Kundpriset måste vara minst 0 kr");
    line.customerPrice = n;
    line.customerPriceSource = "explicit";
    line.customerPriceExplanation = "Angivet av dig på den här raden.";
  }
  line.updatedAt = new Date().toISOString();
  save();
  return line;
}

export function rememberCustomerMarkup(customerId: string, percent: number): void {
  const customer = requireCustomer(customerId);
  if (!Number.isFinite(percent) || percent < 0 || percent > 200) {
    throw new Error("Påslaget måste vara mellan 0 och 200 procent.");
  }
  customer.materialPriceRule = { kind: "markup", percent: Math.round(percent * 100) / 100 };
  logActivity(`Samma påslag nästa gång för ${customer.name}: ${percent.toLocaleString("sv-SE")} %.`, {
    customerId: customer.id,
  });
  save();
}

export function setLineAllocations(
  lineId: string,
  allocations: Array<{ jobId: string; qty: number }>
): DocumentLine {
  const line = requireLine(lineId);
  const qty = line.confirmed?.qty ?? line.qty ?? line.raw.qty ?? 0;
  const amount = line.confirmed?.lineAmount ?? line.raw.lineAmount ?? Math.round((line.unitCost ?? 0) * qty);
  const next: DocumentLineAllocation[] = allocations.map((a) => {
    const existing = line.allocations.find((x) => x.jobId === a.jobId);
    if (existing?.jobWorkEntryId && workEntryLocked(existing.jobWorkEntryId)) {
      return existing;
    }
    const job = getJob(a.jobId);
    if (!job) throw new Error("Uppdraget finns inte");
    if (!(a.qty > 0)) throw new Error("Antalet måste vara större än noll");
    const share = qty > 0 ? a.qty / qty : 0;
    return {
      id: existing?.id ?? uid(),
      jobId: a.jobId,
      qty: a.qty,
      amountExclVat: Math.round(amount * share),
      ...(existing?.jobWorkEntryId ? { jobWorkEntryId: existing.jobWorkEntryId } : {}),
    };
  });
  const overflow = allocationOverflow({
    lineQty: qty,
    lineAmount: amount,
    allocations: next,
  });
  if (!overflow.qtyOk || !overflow.amountOk) {
    throw new Error("Allokeringarna får inte överstiga kvittots antal eller belopp.");
  }
  line.allocations = next;
  if (next.length > 0) line.disposition = "customer";
  line.updatedAt = new Date().toISOString();
  save();
  return line;
}

export function applyAllLinesToJob(source: DocumentLineSource, sourceDocumentId: string, jobId: string): DocumentLine[] {
  const job = getJob(jobId);
  if (!job) throw new Error("Uppdraget finns inte");
  const lines = linesForSource(source, sourceDocumentId);
  for (const line of lines) {
    if (line.raw.unreadable) continue;
    if ((line.raw.role ?? "article") !== "article") continue;
    setLineAllocations(line.id, [{ jobId, qty: line.confirmed?.qty ?? line.qty ?? line.raw.qty ?? 1 }]);
  }
  return linesForSource(source, sourceDocumentId);
}

export function markDocumentAsCompanyCost(source: DocumentLineSource, sourceDocumentId: string): void {
  for (const line of linesForSource(source, sourceDocumentId)) {
    setLineDisposition(line.id, "company");
  }
}

export function markDocumentAsPrivate(source: DocumentLineSource, sourceDocumentId: string): void {
  for (const line of linesForSource(source, sourceDocumentId)) {
    setLineDisposition(line.id, "private");
  }
}

export function resolveLineCustomerPrice(line: DocumentLine, jobId?: string): DocumentLine {
  const job = jobId ? getJob(jobId) : line.allocations[0] ? getJob(line.allocations[0].jobId) : undefined;
  const customer = job ? requireCustomer(job.customerId) : undefined;
  const price = resolveMaterialCustomerPrice({
    explicitKronor: line.customerPriceSource === "explicit" ? line.customerPrice : undefined,
    jobRule: job?.materialPriceRule,
    customerRule: customer?.materialPriceRule,
    unitCostOre: line.unitCost != null ? line.unitCost * 100 : undefined,
  });
  if (price.source === "explicit") return line;
  if (price.kronor != null) {
    line.customerPrice = price.kronor;
    line.customerPriceSource = price.source;
    line.customerPriceExplanation = price.explanation;
    if (price.rule) line.customerPriceRule = price.rule;
  } else {
    delete line.customerPrice;
    line.customerPriceSource = "missing";
    line.customerPriceExplanation = price.explanation;
  }
  return line;
}

/**
 * Bekräfta raderna och skapa material på uppdragen. Samma dokumentrad
 * skapar aldrig samma uppdragsmaterial två gånger.
 */
export function confirmDocumentLines(
  lineIds: string[],
  opts: { skipUnreadable?: boolean } = {}
): { confirmed: DocumentLine[]; skipped: DocumentLine[] } {
  const confirmed: DocumentLine[] = [];
  const skipped: DocumentLine[] = [];
  const now = new Date().toISOString();

  for (const id of lineIds) {
    const line = requireLine(id);
    if (line.raw.unreadable && !opts.skipUnreadable) {
      line.status = "needs_review";
      skipped.push(line);
      continue;
    }
    if (line.disposition === "ignored") {
      line.status = "rejected";
      line.confirmedAt = now;
      line.updatedAt = now;
      confirmed.push(line);
      continue;
    }
    if (line.disposition !== "customer") {
      line.status = "confirmed";
      line.confirmedAt = now;
      line.updatedAt = now;
      releaseUnbilledAllocations(line);
      confirmed.push(line);
      continue;
    }
    if (!line.allocations.length) {
      line.status = "needs_review";
      skipped.push(line);
      continue;
    }
    for (const alloc of line.allocations) {
      resolveLineCustomerPrice(line, alloc.jobId);
      if (line.customerPrice == null) {
        line.status = "needs_review";
        skipped.push(line);
        continue;
      }
      if (alloc.jobWorkEntryId) {
        const existing = jobWorkEntries(alloc.jobId).find((e) => e.id === alloc.jobWorkEntryId);
        if (existing) continue;
      }
      const duplicate = jobWorkEntries(alloc.jobId).find(
        (e) => e.documentLineId === line.id && e.documentLineAllocationId === alloc.id
      );
      if (duplicate) {
        alloc.jobWorkEntryId = duplicate.id;
        continue;
      }
      const name = (line.confirmed?.name ?? line.raw.name ?? "Material").trim();
      const entry = addJobMaterial(alloc.jobId, {
        description: name,
        qty: alloc.qty,
        unit: line.confirmed?.unit ?? line.unit ?? line.raw.unit ?? "st",
        unitPrice: line.customerPrice,
        date: now.slice(0, 10),
        source: "import",
        expenseId: line.expenseId,
        documentLineId: line.id,
        documentLineAllocationId: alloc.id,
      });
      alloc.jobWorkEntryId = entry.id;
    }
    if (line.status !== "needs_review") {
      line.status = "confirmed";
      line.confirmedAt = now;
      line.updatedAt = now;
      line.confirmed = {
        ...line.raw,
        ...(line.confirmed ?? {}),
        name: line.confirmed?.name ?? line.raw.name,
        qty: line.confirmed?.qty ?? line.qty ?? line.raw.qty,
      };
      confirmed.push(line);
    }
  }
  save();
  return { confirmed, skipped };
}

export function documentLineMathFor(source: DocumentLineSource, sourceDocumentId: string, documentTotal: number) {
  const lines = linesForSource(source, sourceDocumentId);
  return validateDocumentLineMath({
    lines: lines.map((l) => l.confirmed ?? l.raw),
    documentTotal,
  });
}

/**
 * Faktiskt inköpspris från kvitto/faktura. Ändrar inte skickad snapshot
 * och aldrig redan fakturerade kundpriser. Skapar inte nya materialrader.
 */
export function applyActualCostFromDocument(
  orderId: string,
  parsedLines: InboundParsedLine[]
): { updated: number; deviations: number } {
  const data = db();
  const orderLines = (data.purchaseOrderLines ?? []).filter((l) => l.orderId === orderId);
  let updated = 0;
  let deviations = 0;
  const now = new Date().toISOString();
  for (const parsed of parsedLines) {
    const key = (parsed.articleNumber ?? "").trim().toLowerCase();
    if (!key) continue;
    const line = orderLines.find((l) => (l.articleNumber ?? "").trim().toLowerCase() === key);
    if (!line?.jobWorkEntryId) continue;
    const entry = data.jobWorkEntries?.find((e) => e.id === line.jobWorkEntryId);
    if (!entry?.wholesaler) continue;
    const unitCostOre =
      parsed.unitPrice != null
        ? Math.round(parsed.unitPrice * 100)
        : parsed.lineAmount != null && parsed.qty
          ? Math.round((parsed.lineAmount * 100) / parsed.qty)
          : undefined;
    if (unitCostOre == null) continue;
    const expected = entry.wholesaler.expectedUnitCostOre ?? entry.wholesaler.unitCostOre ?? line.unitCostOre;
    entry.wholesaler = {
      ...entry.wholesaler,
      ...(expected != null ? { expectedUnitCostOre: expected } : {}),
      unitCostOre,
    };
    entry.updatedAt = now;
    updated += 1;
    if (expected != null && Math.abs(expected - unitCostOre) > 100) deviations += 1;
  }
  if (updated > 0) save();
  return { updated, deviations };
}

export function jobsForDocumentReview(): Array<Pick<Job, "id" | "title">> {
  return db()
    .jobs.filter((j) => !j.archivedAt)
    .map((j) => ({ id: j.id, title: j.title }))
    .sort((a, b) => a.title.localeCompare(b.title, "sv"));
}

export function documentLineSourceFromInboxType(
  documentType: InboxItem["documentType"]
): DocumentLineSource {
  if (documentType === "kvitto") return "receipt";
  if (documentType === "orderbekraftelse") return "order_confirmation";
  return "supplier_invoice";
}
