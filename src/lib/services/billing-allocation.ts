/**
 * Faktureringsallokering – den spårbara länken källrad → fakturarad.
 *
 * Generell modell (inte avslutsspecifik): offertrad, betalplansdel, rest
 * enligt offert, registrerad tid/material, godkänd ändringsrad, utgift/kvitto.
 * Samma modell bär senare vidarefakturering av material.
 *
 * Regler:
 *   * EN levande allokering (draft/invoiced) per källa. Tjänsten kontrollerar
 *     det här; databasen har ett unikt index (billing_allocations_live_source_uq)
 *     som fångar även samtidiga skrivningar.
 *   * Utkast reserverar källan (draft). Utfärdad faktura låser (invoiced).
 *     Kastat utkast tar bort allokeringen; helt krediterad faktura frisläpper
 *     den (released) så att källan kan faktureras igen – historiken finns kvar.
 *   * Äldre fakturor (före allokeringarna) spåras via radernas
 *     sourceKind/sourceId och JobWorkEntry.invoiceId. `sourceBillingState`
 *     slår ihop båda – ingen källa räknas som ofakturerad bara för att
 *     fakturan skapades innan tabellen fanns.
 */
import { db } from "../store";
import { uid } from "../ids";
import { lineTotal } from "../calc";
import type {
  BillingAllocation,
  BillingSourceRef,
  BillingSourceType,
  DocLine,
  Invoice,
} from "../types";

export class BillingConflictError extends Error {
  readonly sourceType: BillingSourceType;
  readonly sourceId: string;
  readonly invoiceId: string;
  constructor(ref: BillingSourceRef, invoiceId: string, message?: string) {
    super(message ?? "Raden är redan fakturerad eller ligger på ett annat fakturautkast.");
    this.name = "BillingConflictError";
    this.sourceType = ref.sourceType;
    this.sourceId = ref.sourceId;
    this.invoiceId = invoiceId;
  }
}

export function sourceKey(ref: BillingSourceRef): string {
  return `${ref.sourceType}:${ref.sourceId}`;
}

export function paymentPlanPartSourceId(quoteId: string, partIndex: number): string {
  return `${quoteId}:plan:${partIndex}`;
}

function allocations(): BillingAllocation[] {
  const data = db();
  data.billingAllocations ??= [];
  return data.billingAllocations;
}

export function allAllocations(): readonly BillingAllocation[] {
  return allocations();
}

export function isLiveAllocation(a: BillingAllocation): boolean {
  return a.status !== "released";
}

export function allocationsForInvoice(invoiceId: string): BillingAllocation[] {
  return allocations().filter((a) => a.invoiceId === invoiceId);
}

export function liveAllocationsForJob(jobId: string): BillingAllocation[] {
  return allocations().filter((a) => a.jobId === jobId && isLiveAllocation(a));
}

export function liveAllocationForSource(ref: BillingSourceRef): BillingAllocation | undefined {
  return allocations().find(
    (a) => isLiveAllocation(a) && a.sourceType === ref.sourceType && a.sourceId === ref.sourceId
  );
}

function isLiveInvoice(inv: Invoice | undefined): inv is Invoice {
  return Boolean(inv && inv.status !== "krediterad" && inv.type !== "kredit");
}

/**
 * Källreferens för en fakturarad utifrån dess proveniens. null för fria rader
 * och rader vars källa inte kan verifieras (t.ex. klumpsummor med nya id:n).
 */
export function billingSourceRefForLine(line: DocLine, invoice: Pick<Invoice, "quoteId">): BillingSourceRef | null {
  if (line.isHeading) return null;
  switch (line.sourceKind) {
    case "QUOTE_LINE": {
      if (!line.sourceId || !invoice.quoteId) return null;
      const version = quoteVersionLines(invoice.quoteId);
      if (!version.has(line.sourceId)) return null;
      return { sourceType: "quote_line", sourceId: line.sourceId };
    }
    case "PAYMENT_PLAN": {
      if (line.paymentPlanIndex == null || !invoice.quoteId) return null;
      return { sourceType: "payment_plan_part", sourceId: paymentPlanPartSourceId(invoice.quoteId, line.paymentPlanIndex) };
    }
    case "JOB_TIME_ENTRY":
    case "JOB_MATERIAL":
    case "JOB_OTHER": {
      if (!line.sourceId) return null;
      const exists = (db().jobWorkEntries ?? []).some((e) => e.id === line.sourceId && e.role === "actual");
      return exists ? { sourceType: "work_entry", sourceId: line.sourceId } : null;
    }
    case "CHANGE_LINE": {
      if (!line.sourceId) return null;
      const exists = (db().jobChanges ?? []).some((c) => c.lines.some((l) => l.id === line.sourceId));
      return exists ? { sourceType: "change_line", sourceId: line.sourceId } : null;
    }
    default:
      return null;
  }
}

function quoteVersionLines(quoteId: string): Set<string> {
  const data = db();
  const quote = data.quotes.find((q) => q.id === quoteId);
  if (!quote) return new Set();
  const version = data.quoteVersions.find((v) => v.id === quote.currentVersionId);
  return new Set((version?.lines ?? []).map((l) => l.id));
}

export type SourceBillingStatus = "unbilled" | "draft" | "invoiced";

export interface SourceBillingState {
  status: SourceBillingStatus;
  invoiceId?: string;
  invoiceNumber?: number | null;
  allocationId?: string;
}

/**
 * Är källan fakturerad, reserverad av ett utkast eller fri? Slår ihop
 * allokeringar med äldre proveniens (fakturarader utan allokering och
 * JobWorkEntry.invoiceId) så att inget räknas dubbelt.
 */
export function sourceBillingState(ref: BillingSourceRef): SourceBillingState {
  const data = db();
  const live = liveAllocationForSource(ref);
  if (live) {
    const inv = data.invoices.find((i) => i.id === live.invoiceId);
    if (isLiveInvoice(inv)) {
      return {
        status: inv.status === "utkast" ? "draft" : "invoiced",
        invoiceId: inv.id,
        invoiceNumber: inv.number,
        allocationId: live.id,
      };
    }
  }
  // Äldre spår: registrerad post med invoiceId.
  if (ref.sourceType === "work_entry") {
    const entry = (data.jobWorkEntries ?? []).find((e) => e.id === ref.sourceId);
    if (entry?.invoiceId) {
      const inv = data.invoices.find((i) => i.id === entry.invoiceId);
      if (isLiveInvoice(inv)) {
        return { status: inv.status === "utkast" ? "draft" : "invoiced", invoiceId: inv.id, invoiceNumber: inv.number };
      }
    }
  }
  // Äldre spår: fakturarader med samma proveniens.
  for (const inv of data.invoices) {
    if (!isLiveInvoice(inv)) continue;
    if (ref.sourceType === "payment_plan_part") {
      const [quoteId, , idx] = ref.sourceId.split(":");
      const index = Number(idx);
      if (inv.quoteId !== quoteId) continue;
      const hit =
        inv.paymentPlanIndex === index ||
        inv.lines.some((l) => l.sourceKind === "PAYMENT_PLAN" && l.paymentPlanIndex === index);
      if (hit) return { status: inv.status === "utkast" ? "draft" : "invoiced", invoiceId: inv.id, invoiceNumber: inv.number };
      continue;
    }
    if (inv.lines.some((l) => l.sourceId === ref.sourceId && l.sourceKind && l.sourceKind !== "MANUAL")) {
      return { status: inv.status === "utkast" ? "draft" : "invoiced", invoiceId: inv.id, invoiceNumber: inv.number };
    }
  }
  return { status: "unbilled" };
}

export function isSourceBilled(ref: BillingSourceRef): boolean {
  return sourceBillingState(ref).status !== "unbilled";
}

export interface AllocationInput {
  ref: BillingSourceRef;
  lineId: string;
  amountExclVat: number;
  qty?: number;
}

/**
 * Registrera allokeringar för en faktura. strict = kasta vid konflikt (ny
 * fakturering av redan fakturerad källa). Icke-strikt hoppar över konflikter
 * – används för äldre flöden som har sina egna kontroller.
 */
export function allocateSources(
  invoice: Pick<Invoice, "id" | "jobId">,
  inputs: AllocationInput[],
  opts: { strict?: boolean; now?: string } = {}
): BillingAllocation[] {
  const list = allocations();
  const now = opts.now ?? new Date().toISOString();
  const created: BillingAllocation[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    if (input.ref.sourceType === "manual") continue;
    const key = sourceKey(input.ref);
    if (seen.has(key)) {
      if (opts.strict) throw new BillingConflictError(input.ref, invoice.id, "Samma rad kan inte faktureras två gånger på en faktura.");
      continue;
    }
    seen.add(key);
    const existing = liveAllocationForSource(input.ref);
    if (existing && existing.invoiceId !== invoice.id) {
      if (opts.strict) throw new BillingConflictError(input.ref, existing.invoiceId);
      continue;
    }
    if (existing && existing.invoiceId === invoice.id) {
      existing.invoiceLineId = input.lineId;
      existing.amountExclVat = input.amountExclVat;
      if (input.qty != null) existing.qty = input.qty;
      continue;
    }
    if (opts.strict) {
      const legacy = sourceBillingState(input.ref);
      if (legacy.status !== "unbilled" && legacy.invoiceId !== invoice.id) {
        throw new BillingConflictError(input.ref, legacy.invoiceId ?? "");
      }
    }
    const allocation: BillingAllocation = {
      id: uid(),
      ...(invoice.jobId ? { jobId: invoice.jobId } : {}),
      sourceType: input.ref.sourceType,
      sourceId: input.ref.sourceId,
      invoiceId: invoice.id,
      invoiceLineId: input.lineId,
      ...(input.qty != null ? { qty: input.qty } : {}),
      amountExclVat: Math.round(input.amountExclVat),
      status: "draft",
      createdAt: now,
    };
    list.push(allocation);
    created.push(allocation);
  }
  return created;
}

/** Härled allokeringar ur fakturans rader (proveniens). Frisläpp borttagna rader. */
export function syncAllocationsWithLines(invoice: Invoice, opts: { strict?: boolean } = {}): void {
  const now = new Date().toISOString();
  const lineIds = new Set(invoice.lines.map((l) => l.id));
  for (const a of allocationsForInvoice(invoice.id)) {
    if (a.status === "draft" && !lineIds.has(a.invoiceLineId)) {
      a.status = "released";
      a.releasedAt = now;
      a.releaseReason = "rad_borttagen";
    }
  }
  const inputs: AllocationInput[] = [];
  for (const line of invoice.lines) {
    const ref = billingSourceRefForLine(line, invoice);
    if (!ref) continue;
    inputs.push({ ref, lineId: line.id, amountExclVat: lineTotal(line), qty: line.qty });
  }
  allocateSources(invoice, inputs, { strict: opts.strict, now });
}

/** Utfärdande: utkastets allokeringar låses. */
export function markAllocationsInvoiced(invoiceId: string, at: string): void {
  for (const a of allocationsForInvoice(invoiceId)) {
    if (a.status === "draft") {
      a.status = "invoiced";
      a.invoicedAt = at;
    }
  }
}

/** Kastat utkast: allokeringarna tas bort helt (utkast har ingen historik att bevara). */
export function dropDraftAllocations(invoiceId: string): void {
  const data = db();
  data.billingAllocations = allocations().filter((a) => !(a.invoiceId === invoiceId && a.status === "draft"));
}

/** Helt krediterad faktura: källorna blir fria igen, historiken finns kvar. */
export function releaseAllocationsForInvoice(
  invoiceId: string,
  reason: NonNullable<BillingAllocation["releaseReason"]>,
  at = new Date().toISOString()
): void {
  for (const a of allocationsForInvoice(invoiceId)) {
    if (a.status === "released") continue;
    a.status = "released";
    a.releasedAt = at;
    a.releaseReason = reason;
  }
}

/** Levande allokeringar per källa för ett uppdrag (för listor – en genomläsning). */
export function liveAllocationMapForJob(jobId: string): Map<string, BillingAllocation> {
  const out = new Map<string, BillingAllocation>();
  for (const a of liveAllocationsForJob(jobId)) out.set(sourceKey(a), a);
  return out;
}
