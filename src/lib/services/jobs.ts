import { db, save } from "../store";
import { uid } from "../ids";
import { quoteDescriptionDoc } from "../quote-description";
import { richTextToPlain } from "../richtext";
import type { Job, JobSource, Quote, WorkLocation } from "../types";
import { currentVersion, getQuote, invoicePaidAmount, invoiceTotals, jobQuote, requireCustomer } from "./data";
import { logActivity } from "./activity";
import {
  addWorkLocation,
  applyWorkLocationToJob,
  defaultWorkLocation,
  getWorkLocation,
  type WorkLocationInput,
} from "./work-locations";
import { importQuotedBaseline, isIssuedLinked, jobWorkEntries } from "./job-work";
import { invoicesForJob } from "./job-economy";
import { discardInvoice } from "./invoices";
import type { JobCompleteWarning, JobRemovalPolicy } from "../job-ui-types";
export type { JobCompleteWarning, JobRemovalKind, JobRemovalPolicy } from "../job-ui-types";

export function createJobFromQuote(quote: Quote): Job {
  const data = db();
  const existing =
    (quote.jobId ? data.jobs.find((j) => j.id === quote.jobId) : undefined) ??
    data.jobs.find((j) => j.quoteId === quote.id);
  if (existing) {
    // Behåll ursprunglig godkänd offert som kommersiell bas. En tilläggsoffert
    // kopplas via quote.jobId och importeras som extra avtalade rader.
    if (!existing.quoteId) existing.quoteId = quote.id;
    quote.jobId = existing.id;
    importQuotedBaseline(existing, quote);
    save();
    return existing;
  }

  const version = currentVersion(quote);
  const customer = requireCustomer(quote.customerId);
  const location = defaultWorkLocation(customer);
  // Offertens kanoniska beskrivning som ren text (hanterar även äldre låsta
  // versioner där legacy-intro ligger kvar bredvid rik texten).
  const descriptionText = richTextToPlain(quoteDescriptionDoc(version)).trim();
  const job: Job = {
    id: uid(),
    customerId: quote.customerId,
    quoteId: quote.id,
    title: version.title,
    description: [descriptionText, `Enligt godkänd offert #${quote.number}.`]
      .filter(Boolean)
      .join("\n\n"),
    status: "kommande",
    address: customer.address ? `${customer.address}, ${customer.city ?? ""}`.replace(/, $/, "") : undefined,
    checklist: [],
    notes: "",
    createdAt: new Date().toISOString(),
  };
  if (location) applyWorkLocationToJob(job, location);
  if (descriptionText && !job.notes) {
    job.notes = `${new Date().toISOString()}\nFrån offert #${quote.number}: ${descriptionText}`;
  }
  data.jobs.push(job);
  quote.jobId = job.id;
  importQuotedBaseline(job, quote, false);
  save();
  return job;
}

/** Starta uppdrag från offert: skapar eller återanvänder jobbet och sätter Pågår. */
export function startJobFromQuote(quoteId: string): Job {
  const quote = getQuote(quoteId);
  if (!quote) throw new Error("Offerten finns inte");
  const job = createJobFromQuote(quote);
  if (job.status === "kommande") {
    setJobStatus(job.id, "pagar");
  }
  return job;
}

export const INCOMING_JOB_SOURCES: readonly JobSource[] = ["web_form", "email", "phone", "import"];

export function jobSourceLabel(source?: JobSource): string | undefined {
  switch (source) {
    case "web_form":
      return "Via webbformulär";
    case "email":
      return "Via e-post";
    case "phone":
      return "Via telefon";
    case "import":
      return "Via import";
    default:
      return undefined;
  }
}

export function jobHasLinkedQuote(job: Job): boolean {
  if (job.quoteId) return true;
  return db().quotes.some((q) => q.jobId === job.id);
}

/** Inkommande uppdrag utan offert – samma yta som Hem "Nytt uppdrag". */
export function isIncomingUnquotedJob(job: Job): boolean {
  const source = job.source ?? "manual";
  if (!INCOMING_JOB_SOURCES.includes(source)) return false;
  if (job.status === "klart") return false;
  if (job.archivedAt) return false;
  return !jobHasLinkedQuote(job);
}

export function isJobArchived(job: Pick<Job, "archivedAt">): boolean {
  return Boolean(job.archivedAt);
}

export function titleFromIncomingMessage(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  if (!compact) return "Nytt uppdrag via webbformuläret";
  return compact.length > 60 ? `${compact.slice(0, 57).trimEnd()}…` : compact;
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

/** Hitta inkommande uppdrag utan offert att koppla till en ny offert. */
export function findMatchingUnquotedJob(customerId: string, hint?: string): Job | undefined {
  const open = db().jobs.filter((j) => j.customerId === customerId && isIncomingUnquotedJob(j));
  if (open.length === 0) return undefined;
  if (open.length === 1) return open[0];
  const q = normalizeSearch(hint ?? "");
  if (!q) return undefined;
  const tokens = q.split(/\s+/).filter((t) => t.length >= 3);
  const scored = open
    .map((j) => {
      const hay = `${j.title} ${j.description} ${j.originalMessage ?? ""}`.toLowerCase();
      const hits = tokens.filter((t) => hay.includes(t)).length;
      const titleHit = hay.includes(q) ? 2 : 0;
      return { j, score: hits + titleHit };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.j.createdAt.localeCompare(a.j.createdAt));
  if (scored.length === 0) return undefined;
  if (scored.length > 1 && scored[0].score === scored[1].score) return undefined;
  return scored[0].j;
}

function activityForCreatedJob(job: Job, customerName: string): string {
  switch (job.source) {
    case "web_form":
      return `Nytt uppdrag via webbformuläret från ${customerName}: ${job.title}.`;
    case "email":
      return `Nytt uppdrag via e-post från ${customerName}: ${job.title}.`;
    case "phone":
      return `Nytt uppdrag via telefon från ${customerName}: ${job.title}.`;
    case "import":
      return `Nytt uppdrag via import från ${customerName}: ${job.title}.`;
    default:
      return `Uppdraget ${job.title} skapades för ${customerName}.`;
  }
}

export function createJob(input: {
  customerId: string;
  title: string;
  description?: string;
  startDate?: string;
  workLocationId?: string;
  newWorkLocation?: WorkLocationInput;
  source?: JobSource;
  originalMessage?: string;
  idempotencyKey?: string;
}): Job {
  const data = db();
  const customer = requireCustomer(input.customerId);
  let location: WorkLocation | undefined;
  if (input.newWorkLocation) {
    location = addWorkLocation(customer.id, { ...input.newWorkLocation, asDefault: false });
  } else if (input.workLocationId) {
    location = getWorkLocation(customer, input.workLocationId);
  } else {
    const locs = customer.workLocations ?? [];
    if (locs.length === 1) location = locs[0];
    else if (locs.length > 1) location = defaultWorkLocation(customer);
  }
  const job: Job = {
    id: uid(),
    customerId: input.customerId,
    title: input.title,
    description: input.description ?? "",
    status: "kommande",
    startDate: input.startDate,
    address: customer.address ? `${customer.address}, ${customer.city ?? ""}`.replace(/, $/, "") : undefined,
    checklist: [],
    notes: "",
    createdAt: new Date().toISOString(),
    source: input.source ?? "manual",
  };
  if (input.originalMessage?.trim()) job.originalMessage = input.originalMessage.trim();
  if (input.idempotencyKey) job.idempotencyKey = input.idempotencyKey;
  if (location) applyWorkLocationToJob(job, location);
  data.jobs.push(job);
  logActivity(activityForCreatedJob(job, customer.name), {
    customerId: customer.id,
    entity: { type: "jobb", id: job.id },
  });
  save();
  return job;
}

export function setJobStatus(jobId: string, status: Job["status"]): Job {
  const job = db().jobs.find((j) => j.id === jobId);
  if (!job) throw new Error("Uppdraget finns inte");
  const customer = requireCustomer(job.customerId);
  job.status = status;
  if (status === "klart") {
    job.completedAt = new Date().toISOString();
    logActivity(`Uppdraget ${job.title} hos ${customer.name} markerades som klart.`, {
      customerId: customer.id,
      entity: { type: "jobb", id: jobId },
    });
  } else if (status === "pagar") {
    if (!job.startDate) job.startDate = new Date().toISOString();
    logActivity(`Uppdraget ${job.title} hos ${customer.name} startades.`, {
      customerId: customer.id,
      entity: { type: "jobb", id: jobId },
    });
  }
  save();
  return job;
}

export function toggleChecklistItem(jobId: string, itemId: string): void {
  const job = db().jobs.find((j) => j.id === jobId);
  if (!job) return;
  const item = job.checklist.find((c) => c.id === itemId);
  if (item) {
    item.done = !item.done;
    save();
  }
}

export function addChecklistItem(jobId: string, text: string): void {
  const job = db().jobs.find((j) => j.id === jobId);
  if (!job || !text.trim()) return;
  job.checklist.push({ id: uid(), text: text.trim(), done: false });
  save();
}

export function updateJobNotes(jobId: string, notes: string): void {
  const job = db().jobs.find((j) => j.id === jobId);
  if (!job) return;
  job.notes = notes;
  save();
}

export interface JobNoteEntry {
  at?: string;
  text: string;
}

const NOTE_SEP = "\n\n---\n";

export function parseJobNotes(notes: string): JobNoteEntry[] {
  if (!notes.trim()) return [];
  return notes
    .split(NOTE_SEP)
    .map((part) => {
      const m = part.match(/^(\d{4}-\d{2}-\d{2}T[^\n]*)\n([\s\S]*)$/);
      if (m) return { at: m[1], text: m[2].trim() };
      return { text: part.trim() };
    })
    .filter((n) => n.text);
}

export function appendJobNote(jobId: string, text: string): void {
  const job = db().jobs.find((j) => j.id === jobId);
  if (!job) return;
  const trimmed = text.trim();
  if (!trimmed) return;
  const entry = `${new Date().toISOString()}\n${trimmed}`;
  job.notes = job.notes.trim() ? `${job.notes.trim()}${NOTE_SEP}${entry}` : entry;
  save();
}

export function updateJob(
  jobId: string,
  input: {
    title?: string;
    description?: string;
    address?: string;
    startDate?: string;
    endDate?: string;
    housing?: Job["housing"];
  }
): Job {
  const job = db().jobs.find((j) => j.id === jobId);
  if (!job) throw new Error("Uppdraget finns inte");
  const customer = requireCustomer(job.customerId);
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) throw new Error("Uppdraget behöver en titel");
    job.title = title;
  }
  if (input.description !== undefined) job.description = input.description;
  if (input.address !== undefined) job.address = input.address.trim() || undefined;
  if (input.startDate !== undefined) job.startDate = input.startDate || undefined;
  if (input.endDate !== undefined) job.endDate = input.endDate || undefined;
  if (input.housing !== undefined) job.housing = input.housing;
  logActivity(`Uppdraget ${job.title} hos ${customer.name} uppdaterades.`, {
    customerId: customer.id,
    entity: { type: "jobb", id: job.id },
  });
  save();
  return job;
}

export function completeJob(jobId: string): Job {
  return setJobStatus(jobId, "klart");
}

/** Återställer bara arbetsstatus. Fakturor, offerter, betalningar och böcker rörs inte. */
export function reopenJob(jobId: string): Job {
  const job = db().jobs.find((j) => j.id === jobId);
  if (!job) throw new Error("Uppdraget finns inte");
  if (job.status !== "klart" && !job.completedAt) {
    throw new Error("Uppdraget är inte markerat som klart");
  }
  const customer = requireCustomer(job.customerId);
  job.status = job.startDate ? "pagar" : "kommande";
  job.completedAt = undefined;
  logActivity("Uppdrag återöppnades.", {
    customerId: customer.id,
    entity: { type: "jobb", id: jobId },
  });
  save();
  return job;
}

export function jobCompleteWarning(
  jobId: string,
  input: { remaining: number; registeredUninvoiced: number; unresolvedActionCount?: number }
): JobCompleteWarning {
  const drafts = invoicesForJob(jobId).filter((i) => i.status === "utkast" && i.type !== "kredit");
  const openDraftAmount = drafts.reduce((s, i) => s + invoiceTotals(i).toPay, 0);
  const unresolvedActionCount = input.unresolvedActionCount ?? 0;
  const shouldWarn =
    input.remaining > 0 ||
    input.registeredUninvoiced > 0 ||
    drafts.length > 0 ||
    unresolvedActionCount > 0;
  return {
    remaining: input.remaining,
    registeredUninvoiced: input.registeredUninvoiced,
    openDraftCount: drafts.length,
    openDraftAmount,
    unresolvedActionCount,
    shouldWarn,
  };
}

function jobHasApprovedQuote(job: Job): boolean {
  const linked = jobQuote(job);
  if (linked?.status === "godkand") return true;
  return db().quotes.some((q) => q.jobId === job.id && q.status === "godkand");
}

function jobHasIssuedInvoice(jobId: string): boolean {
  return invoicesForJob(jobId).some((i) => i.status !== "utkast" && i.type !== "kredit");
}

function jobHasPayments(jobId: string): boolean {
  const ids = new Set(invoicesForJob(jobId).map((i) => i.id));
  if (ids.size === 0) return false;
  return db().payments.some((p) => ids.has(p.invoiceId) && invoicePaidAmount(p.invoiceId) > 0);
}

function jobHasAccountingRefs(jobId: string): boolean {
  const invoiceIds = new Set(invoicesForJob(jobId).map((i) => i.id));
  const paymentIds = new Set(db().payments.filter((p) => invoiceIds.has(p.invoiceId)).map((p) => p.id));
  return db().verifications.some((v) => {
    const src = v.source;
    if (src.type === "kundfaktura" && invoiceIds.has(src.id)) return true;
    if (src.type === "betalning" && paymentIds.has(src.id)) return true;
    return false;
  });
}

function jobHasInvoicedWork(jobId: string): boolean {
  return jobWorkEntries(jobId).some((e) => e.role === "actual" && isIssuedLinked(e));
}

export function jobRemovalPolicy(jobId: string): JobRemovalPolicy {
  const job = db().jobs.find((j) => j.id === jobId);
  if (!job) throw new Error("Uppdraget finns inte");
  const reasons: string[] = [];
  if (jobHasApprovedQuote(job)) reasons.push("Godkänd offert");
  if (jobHasIssuedInvoice(jobId)) reasons.push("Utfärdad faktura");
  if (jobHasPayments(jobId)) reasons.push("Betalningar");
  if (jobHasAccountingRefs(jobId)) reasons.push("Bokföring");
  if (jobHasInvoicedWork(jobId)) reasons.push("Fakturerat arbete");
  return { kind: reasons.length === 0 ? "delete" : "archive", reasons };
}

function archiveJob(job: Job): { kind: "archived"; jobId: string } {
  const customer = requireCustomer(job.customerId);
  job.archivedAt = new Date().toISOString();
  logActivity(`Uppdraget ${job.title} hos ${customer.name} arkiverades.`, {
    customerId: customer.id,
    entity: { type: "jobb", id: job.id },
  });
  save();
  return { kind: "archived", jobId: job.id };
}

function hardDeleteJob(job: Job): { kind: "deleted"; jobId: string } {
  const data = db();
  const customer = requireCustomer(job.customerId);
  const drafts = invoicesForJob(job.id).filter((i) => i.status === "utkast");
  for (const inv of drafts) {
    discardInvoice(inv.id);
  }
  data.jobWorkEntries = (data.jobWorkEntries ?? []).filter((e) => e.jobId !== job.id);
  for (const quote of data.quotes) {
    if (quote.jobId === job.id) quote.jobId = undefined;
  }
  data.jobs = data.jobs.filter((j) => j.id !== job.id);
  logActivity(`Uppdraget ${job.title} hos ${customer.name} togs bort.`, {
    customerId: customer.id,
    entity: { type: "jobb", id: job.id },
  });
  save();
  return { kind: "deleted", jobId: job.id };
}

/**
 * Hård radering bara om uppdraget är tomt (ingen godkänd offert, utfärdad
 * faktura, betalning, bokföring eller fakturerat arbete). Annars arkiv.
 * Utfärdade fakturor, signerade offerter och verifikationer raderas aldrig.
 */
export function deleteOrArchiveJob(jobId: string): { kind: "deleted" | "archived"; jobId: string } {
  const job = db().jobs.find((j) => j.id === jobId);
  if (!job) throw new Error("Uppdraget finns inte");
  const policy = jobRemovalPolicy(jobId);
  return policy.kind === "delete" ? hardDeleteJob(job) : archiveJob(job);
}
