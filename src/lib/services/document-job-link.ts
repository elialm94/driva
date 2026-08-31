/**
 * Koppling offert/faktura ↔ uppdrag.
 *
 * Återanvänder quote.jobId, job.quoteId och invoice.jobId. Ingen parallell
 * relation. job_id är metadata – rader, moms, ROT och signerade snapshots
 * rörs inte.
 *
 * Livscykel:
 *   * Utkast: koppla, byt, koppla loss fritt.
 *   * Skickad/signerad offert och utfärdad faktura: bara FÄSTA en saknad
 *     koppling (NULL → uppdrag). Byte och losskoppling är förbjudna – den
 *     historiska kedjan skrivs inte om. Utfärdade fakturor har dessutom
 *     app.invoices_guard som fryser job_id utom just attach.
 */
import { db, save } from "../store";
import type { Invoice, Job, Quote } from "../types";
import type {
  DocumentLinkJobOption,
  DocumentLinkKind,
  DocumentLinkResult,
  DocumentLinkView,
} from "../document-job-link-model";
import { jobHref, quoteHref } from "../nav";
import { JOB_STATUS } from "../status-labels";
import { getInvoice, getJob, getQuote, requireCustomer } from "./data";
import { jobForQuote } from "./business-chain";
import { createJob } from "./jobs";
import { derivedJobStatus } from "./job-lifecycle";
import { logActivity } from "./activity";

export type { DocumentLinkKind, DocumentLinkResult, DocumentLinkView } from "../document-job-link-model";

export class DocumentJobLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentJobLinkError";
  }
}

function jobStatusLabel(job: Job): string {
  if (job.archivedAt) return JOB_STATUS.arkiverat.label;
  return JOB_STATUS[derivedJobStatus(job)].label;
}

function isQuoteDraft(quote: Quote): boolean {
  return quote.status === "utkast";
}

function isInvoiceDraft(invoice: Invoice): boolean {
  return invoice.status === "utkast" && !invoice.issuedAt;
}

export function assertJobBelongsToCustomer(jobId: string, customerId: string): Job {
  const job = getJob(jobId);
  if (!job) throw new DocumentJobLinkError("Uppdraget finns inte");
  if (job.customerId !== customerId) {
    throw new DocumentJobLinkError("Dokumentet kan bara kopplas till ett uppdrag för samma kund");
  }
  return job;
}

export function jobsForCustomerLink(customerId: string): DocumentLinkJobOption[] {
  return db()
    .jobs.filter((j) => j.customerId === customerId && !j.archivedAt)
    .sort((a, b) => {
      const rank = (s: Job["status"]) => (s === "pagar" ? 0 : s === "kommande" ? 1 : 2);
      return rank(a.status) - rank(b.status) || b.createdAt.localeCompare(a.createdAt);
    })
    .map((j) => ({ id: j.id, title: j.title, statusLabel: jobStatusLabel(j) }));
}

function linkedJobForQuote(quote: Quote): Job | undefined {
  return jobForQuote(quote);
}

function linkedJobForInvoice(invoice: Invoice): Job | undefined {
  return invoice.jobId ? getJob(invoice.jobId) : undefined;
}

function canMutateQuote(quote: Quote, currentlyLinked: boolean): { canLink: boolean; canChange: boolean; canUnlink: boolean } {
  if (isQuoteDraft(quote)) return { canLink: true, canChange: true, canUnlink: currentlyLinked };
  if (!currentlyLinked) return { canLink: true, canChange: false, canUnlink: false };
  return { canLink: false, canChange: false, canUnlink: false };
}

function canMutateInvoice(
  invoice: Invoice,
  currentlyLinked: boolean
): { canLink: boolean; canChange: boolean; canUnlink: boolean } {
  if (isInvoiceDraft(invoice)) return { canLink: true, canChange: true, canUnlink: currentlyLinked };
  if (!currentlyLinked) return { canLink: true, canChange: false, canUnlink: false };
  return { canLink: false, canChange: false, canUnlink: false };
}

export function documentLinkView(
  kind: DocumentLinkKind,
  documentId: string,
  from?: { href: string; label?: string }
): DocumentLinkView {
  if (kind === "quote") {
    const quote = getQuote(documentId);
    if (!quote) throw new DocumentJobLinkError("Offerten finns inte");
    const customer = requireCustomer(quote.customerId);
    const job = linkedJobForQuote(quote);
    const flags = canMutateQuote(quote, Boolean(job));
    return {
      kind,
      documentId,
      customerId: customer.id,
      customerName: customer.name,
      job: job
        ? {
            id: job.id,
            title: job.title,
            href: jobHref(job.id, from),
            statusLabel: jobStatusLabel(job),
          }
        : null,
      jobs: jobsForCustomerLink(customer.id),
      ...flags,
    };
  }

  const invoice = getInvoice(documentId);
  if (!invoice) throw new DocumentJobLinkError("Fakturan finns inte");
  const customer = requireCustomer(invoice.customerId);
  const job = linkedJobForInvoice(invoice);
  const quote = invoice.quoteId ? getQuote(invoice.quoteId) : undefined;
  const flags = canMutateInvoice(invoice, Boolean(job));
  return {
    kind,
    documentId,
    customerId: customer.id,
    customerName: customer.name,
    job: job
      ? {
          id: job.id,
          title: job.title,
          href: jobHref(job.id, from),
          statusLabel: jobStatusLabel(job),
        }
      : null,
    quote: quote ? { number: quote.number, href: quoteHref(quote.id, from) } : undefined,
    jobs: jobsForCustomerLink(customer.id),
    ...flags,
  };
}

function assertCanAttach(kind: DocumentLinkKind, linked: boolean, isDraft: boolean): void {
  if (isDraft) return;
  if (linked) {
    throw new DocumentJobLinkError(
      kind === "quote"
        ? "Kopplingen på en skickad offert kan inte ändras"
        : "Kopplingen på en utfärdad faktura kan inte ändras"
    );
  }
}

function assertCanUnlink(kind: DocumentLinkKind, isDraft: boolean): void {
  if (isDraft) return;
  throw new DocumentJobLinkError(
    kind === "quote"
      ? "Kopplingen på en skickad offert kan inte tas bort"
      : "Kopplingen på en utfärdad faktura kan inte tas bort"
  );
}

function linkQuoteToJob(quote: Quote, job: Job): void {
  const already = linkedJobForQuote(quote);
  assertCanAttach("quote", Boolean(already), isQuoteDraft(quote));
  quote.jobId = job.id;
  if (!job.quoteId) job.quoteId = quote.id;
  const customer = requireCustomer(quote.customerId);
  logActivity(`Offert #${quote.number} kopplades till uppdraget ${job.title}.`, {
    customerId: customer.id,
    entity: { type: "offert", id: quote.id },
  });
}

function linkInvoiceToJob(invoice: Invoice, job: Job): void {
  const already = linkedJobForInvoice(invoice);
  assertCanAttach("invoice", Boolean(already), isInvoiceDraft(invoice));
  invoice.jobId = job.id;
  const customer = requireCustomer(invoice.customerId);
  const label = invoice.number != null ? `Faktura #${invoice.number}` : "Fakturautkastet";
  logActivity(`${label} kopplades till uppdraget ${job.title}.`, {
    customerId: customer.id,
    entity: { type: "faktura", id: invoice.id },
  });
}

export function linkDocumentToJob(
  kind: DocumentLinkKind,
  documentId: string,
  jobId: string
): { jobId: string; jobTitle: string; statusLabel: string } {
  if (kind === "quote") {
    const quote = getQuote(documentId);
    if (!quote) throw new DocumentJobLinkError("Offerten finns inte");
    const job = assertJobBelongsToCustomer(jobId, quote.customerId);
    linkQuoteToJob(quote, job);
    save();
    return { jobId: job.id, jobTitle: job.title, statusLabel: jobStatusLabel(job) };
  }

  const invoice = getInvoice(documentId);
  if (!invoice) throw new DocumentJobLinkError("Fakturan finns inte");
  const job = assertJobBelongsToCustomer(jobId, invoice.customerId);
  linkInvoiceToJob(invoice, job);
  save();
  return { jobId: job.id, jobTitle: job.title, statusLabel: jobStatusLabel(job) };
}

export function unlinkDocumentFromJob(kind: DocumentLinkKind, documentId: string): void {
  if (kind === "quote") {
    const quote = getQuote(documentId);
    if (!quote) throw new DocumentJobLinkError("Offerten finns inte");
    assertCanUnlink("quote", isQuoteDraft(quote));
    const job = linkedJobForQuote(quote);
    quote.jobId = undefined;
    if (job?.quoteId === quote.id) job.quoteId = undefined;
    const customer = requireCustomer(quote.customerId);
    logActivity(
      job
        ? `Kopplingen mellan offert #${quote.number} och uppdraget ${job.title} togs bort.`
        : `Kopplingen på offert #${quote.number} togs bort.`,
      { customerId: customer.id, entity: { type: "offert", id: quote.id } }
    );
    save();
    return;
  }

  const invoice = getInvoice(documentId);
  if (!invoice) throw new DocumentJobLinkError("Fakturan finns inte");
  assertCanUnlink("invoice", isInvoiceDraft(invoice));
  const job = linkedJobForInvoice(invoice);
  invoice.jobId = undefined;
  const customer = requireCustomer(invoice.customerId);
  const label = invoice.number != null ? `Faktura #${invoice.number}` : "Fakturautkastet";
  logActivity(
    job ? `${label} kopplades loss från uppdraget ${job.title}.` : `${label} kopplades loss.`,
    { customerId: customer.id, entity: { type: "faktura", id: invoice.id } }
  );
  save();
}

export function createJobAndLinkDocument(
  kind: DocumentLinkKind,
  documentId: string,
  title: string
): { jobId: string; jobTitle: string; statusLabel: string } {
  const trimmed = title.trim();
  if (!trimmed) throw new DocumentJobLinkError("Uppdraget behöver en titel");

  const customerId =
    kind === "quote" ? getQuote(documentId)?.customerId : getInvoice(documentId)?.customerId;
  if (!customerId) {
    throw new DocumentJobLinkError(kind === "quote" ? "Offerten finns inte" : "Fakturan finns inte");
  }

  const job = createJob({ customerId, title: trimmed });
  return linkDocumentToJob(kind, documentId, job.id);
}

export function tryDocumentLink(
  fn: () => { jobId: string; jobTitle: string; statusLabel: string }
): DocumentLinkResult {
  try {
    const result = fn();
    return { ok: true, ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Kunde inte uppdatera kopplingen";
    return { ok: false, error: message };
  }
}

export function tryDocumentUnlink(fn: () => void): { ok: true } | { ok: false; error: string } {
  try {
    fn();
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Kunde inte ta bort kopplingen";
    return { ok: false, error: message };
  }
}
