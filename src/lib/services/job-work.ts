/**
 * Registrerat arbete på uppdrag – skilt från offert (avtalat) och faktura
 * (debiterat). Offertrader kopieras hit som planned-baseline när en godkänd
 * offert kopplas; actuals skapas bara när någon registrerar tid/material.
 */
import { db, save } from "../store";
import { uid } from "../ids";
import { lineTotal, lineVat } from "../calc";
import { QUOTE_EXCESS_WARN_AMOUNT, QUOTE_EXCESS_WARN_PERCENT } from "../quote-excess";
import type {
  DocLine,
  Job,
  JobPricingKind,
  JobWorkEntry,
  JobWorkEntrySource,
  JobWorkEntryType,
  LineKind,
  Quote,
  VatRate,
} from "../types";
import type {
  JobInvoiceChoice,
  JobInvoiceOption,
  JobInvoiceOptionBasis,
  JobWorkComparison,
} from "../job-ui-types";
export type {
  JobInvoiceChoice,
  JobInvoiceOption,
  JobInvoiceOptionBasis,
  JobWorkComparison,
} from "../job-ui-types";
import { lineKindFromType, syncDocLineClassification } from "../economic-line-type";
import { resolvedHourlyRate } from "../line-defaults";
import { currentVersion, getInvoice, getJob, jobQuote, requireCustomer } from "./data";
import { logActivity } from "./activity";
import { nextPaymentPlanPartForJob, remainingToInvoiceForJob } from "./attention";
import { newQuoteHref } from "../nav";
import { hydrateQuotedBaselines, lineKindToWorkType, syncQuotedBaselineFromVersion } from "./job-work-baseline";

export { hydrateQuotedBaselines, lineKindToWorkType, syncQuotedBaselineFromVersion };

export type JobWorkInvoiceStatus = "uninvoiced" | "draft" | "invoiced";

export interface JobTimeInput {
  description?: string;
  date?: string;
  hours: number;
  unitPrice?: number;
  vatRate?: VatRate;
  quotedLineItemId?: string;
  source?: JobWorkEntrySource;
}

export interface JobMaterialInput {
  description: string;
  date?: string;
  qty: number;
  unit?: string;
  unitPrice: number;
  vatRate?: VatRate;
  quotedLineItemId?: string;
  source?: JobWorkEntrySource;
}

export interface JobWorkEntryPatch {
  description?: string;
  date?: string;
  qty?: number;
  unit?: string;
  unitPrice?: number;
  vatRate?: VatRate;
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function defaultVat(): VatRate {
  return db().settings.defaultVatRate ?? 25;
}

function normalizeDesc(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function workTypeToLineKind(type: JobWorkEntryType): LineKind {
  if (type === "labor") return lineKindFromType("LABOR");
  if (type === "material") return lineKindFromType("MATERIAL");
  if (type === "travel") return lineKindFromType("TRAVEL");
  return lineKindFromType("OTHER");
}

export function entryInclVat(entry: Pick<JobWorkEntry, "qty" | "unitPrice" | "vatRate">): number {
  const line: DocLine = {
    id: "tmp",
    kind: "ovrigt",
    description: "",
    qty: entry.qty,
    unit: "st",
    unitPrice: entry.unitPrice,
    vatRate: entry.vatRate,
  };
  return lineTotal(line) + lineVat(line);
}

export function entryExclVat(entry: Pick<JobWorkEntry, "qty" | "unitPrice">): number {
  return Math.round(entry.qty * entry.unitPrice);
}

function requireJob(jobId: string): Job {
  const job = getJob(jobId);
  if (!job) throw new Error("Uppdraget finns inte");
  return job;
}

export function jobWorkEntries(jobId: string): JobWorkEntry[] {
  return (db().jobWorkEntries ?? []).filter((e) => e.jobId === jobId);
}

export function plannedEntries(jobId: string): JobWorkEntry[] {
  return jobWorkEntries(jobId).filter((e) => e.role === "planned");
}

export function actualEntries(jobId: string): JobWorkEntry[] {
  return jobWorkEntries(jobId).filter((e) => e.role === "actual");
}

export function workEntryInvoiceStatus(entry: JobWorkEntry): JobWorkInvoiceStatus {
  if (!entry.invoiceId) return "uninvoiced";
  const invoice = getInvoice(entry.invoiceId);
  if (!invoice || invoice.status === "krediterad" || invoice.type === "kredit") return "uninvoiced";
  if (invoice.status === "utkast") return "draft";
  return "invoiced";
}

export function isIssuedLinked(entry: JobWorkEntry): boolean {
  return workEntryInvoiceStatus(entry) === "invoiced";
}

export function uninvoicedActuals(jobId: string): JobWorkEntry[] {
  return actualEntries(jobId).filter((e) => workEntryInvoiceStatus(e) === "uninvoiced");
}

export function quotedLaborPrefill(jobId: string): {
  description: string;
  unitPrice: number;
  vatRate: VatRate;
  quotedLineItemId?: string;
  unit: string;
} | null {
  const planned = plannedEntries(jobId).find((e) => e.type === "labor");
  if (planned) {
    return {
      description: planned.description,
      unitPrice: planned.unitPrice,
      vatRate: planned.vatRate,
      quotedLineItemId: planned.quotedLineItemId,
      unit: planned.unit || "tim",
    };
  }
  const job = getJob(jobId);
  const quote = job ? jobQuote(job) : undefined;
  if (!quote) return null;
  const labor = currentVersion(quote).lines.find((l) => l.kind === "arbete");
  if (!labor) return null;
  return {
    description: labor.description,
    unitPrice: labor.unitPrice,
    vatRate: labor.vatRate,
    quotedLineItemId: labor.id,
    unit: labor.unit || "tim",
  };
}

function matchesPlannedScope(entry: Pick<JobWorkEntry, "type" | "description" | "quotedLineItemId">, planned: JobWorkEntry[]): boolean {
  if (entry.quotedLineItemId && planned.some((p) => p.quotedLineItemId === entry.quotedLineItemId)) return true;
  const norm = normalizeDesc(entry.description);
  if (!norm) return false;
  return planned.some((p) => p.type === entry.type && normalizeDesc(p.description) === norm);
}

export function detectExtra(
  jobId: string,
  draft: Pick<JobWorkEntry, "type" | "description" | "quotedLineItemId">
): boolean {
  const planned = plannedEntries(jobId);
  if (planned.length === 0) return false;
  return !matchesPlannedScope(draft, planned);
}

function assertPositiveQty(qty: number): number {
  if (!Number.isFinite(qty) || qty <= 0) throw new Error("Ange en mängd större än noll");
  return qty;
}

function assertMoney(n: number): number {
  const v = Math.round(n);
  if (!Number.isFinite(v) || v < 0) throw new Error("Priset måste vara minst 0 kr");
  return v;
}

function persistEntry(entry: JobWorkEntry): JobWorkEntry {
  const data = db();
  data.jobWorkEntries ??= [];
  data.jobWorkEntries.push(entry);
  const customer = requireCustomer(requireJob(entry.jobId).customerId);
  const verb = entry.type === "labor" ? "tid" : entry.type === "material" ? "material" : "post";
  logActivity(`Registrerade ${verb} på uppdraget hos ${customer.name}.`, {
    customerId: customer.id,
    entity: { type: "jobb", id: entry.jobId },
  });
  save();
  return entry;
}

export function registerJobTime(jobId: string, input: JobTimeInput): JobWorkEntry {
  requireJob(jobId);
  const hours = assertPositiveQty(input.hours);
  const prefill = quotedLaborPrefill(jobId);
  const description = (input.description ?? prefill?.description ?? "Arbete").trim();
  if (!description) throw new Error("Beskriv vad du gjorde");
  const quotedLineItemId = input.quotedLineItemId ?? prefill?.quotedLineItemId;
  const entry: JobWorkEntry = {
    id: uid(),
    jobId,
    role: "actual",
    type: "labor",
    description,
    date: (input.date || todayISO()).slice(0, 10),
    qty: hours,
    unit: prefill?.unit || "tim",
    unitPrice: assertMoney(input.unitPrice ?? prefill?.unitPrice ?? resolvedHourlyRate(db().settings.defaultHourlyRate) ?? 0),
    vatRate: input.vatRate ?? prefill?.vatRate ?? defaultVat(),
    source: input.source ?? "manual",
    quotedLineItemId,
    isExtra: detectExtra(jobId, { type: "labor", description, quotedLineItemId }),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return persistEntry(entry);
}

export function addJobMaterial(jobId: string, input: JobMaterialInput): JobWorkEntry {
  requireJob(jobId);
  const description = input.description.trim();
  if (!description) throw new Error("Ange en beskrivning");
  const quotedLineItemId = input.quotedLineItemId;
  const entry: JobWorkEntry = {
    id: uid(),
    jobId,
    role: "actual",
    type: "material",
    description,
    date: (input.date || todayISO()).slice(0, 10),
    qty: assertPositiveQty(input.qty),
    unit: (input.unit || "st").trim() || "st",
    unitPrice: assertMoney(input.unitPrice),
    vatRate: input.vatRate ?? defaultVat(),
    source: input.source ?? "manual",
    quotedLineItemId,
    isExtra: detectExtra(jobId, { type: "material", description, quotedLineItemId }),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return persistEntry(entry);
}

export function addJobWorkEntry(
  jobId: string,
  input: {
    type: JobWorkEntryType;
    description: string;
    date?: string;
    qty: number;
    unit?: string;
    unitPrice: number;
    vatRate?: VatRate;
    source?: JobWorkEntrySource;
    quotedLineItemId?: string;
  }
): JobWorkEntry {
  if (input.type === "labor") {
    return registerJobTime(jobId, {
      description: input.description,
      date: input.date,
      hours: input.qty,
      unitPrice: input.unitPrice,
      vatRate: input.vatRate,
      quotedLineItemId: input.quotedLineItemId,
      source: input.source,
    });
  }
  if (input.type === "material") {
    return addJobMaterial(jobId, {
      description: input.description,
      date: input.date,
      qty: input.qty,
      unit: input.unit,
      unitPrice: input.unitPrice,
      vatRate: input.vatRate,
      quotedLineItemId: input.quotedLineItemId,
      source: input.source,
    });
  }
  requireJob(jobId);
  const description = input.description.trim();
  if (!description) throw new Error("Ange en beskrivning");
  const quotedLineItemId = input.quotedLineItemId;
  const entry: JobWorkEntry = {
    id: uid(),
    jobId,
    role: "actual",
    type: "other",
    description,
    date: (input.date || todayISO()).slice(0, 10),
    qty: assertPositiveQty(input.qty),
    unit: (input.unit || "st").trim() || "st",
    unitPrice: assertMoney(input.unitPrice),
    vatRate: input.vatRate ?? defaultVat(),
    source: input.source ?? "manual",
    quotedLineItemId,
    isExtra: detectExtra(jobId, { type: "other", description, quotedLineItemId }),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return persistEntry(entry);
}

export function getJobWorkEntry(entryId: string): JobWorkEntry | undefined {
  return (db().jobWorkEntries ?? []).find((e) => e.id === entryId);
}

export function updateJobWorkEntry(entryId: string, patch: JobWorkEntryPatch): JobWorkEntry {
  const entry = getJobWorkEntry(entryId);
  if (!entry) throw new Error("Posten finns inte");
  if (entry.role === "planned") throw new Error("Avtalade rader ändras inte här – de kommer från offerten");
  if (isIssuedLinked(entry)) {
    throw new Error("Posten är fakturerad. Rätta via kreditfaktura, inte genom att ändra registreringen.");
  }
  if (patch.description !== undefined) {
    const description = patch.description.trim();
    if (!description) throw new Error("Ange en beskrivning");
    entry.description = description;
  }
  if (patch.date !== undefined) entry.date = patch.date.slice(0, 10);
  if (patch.qty !== undefined) entry.qty = assertPositiveQty(patch.qty);
  if (patch.unit !== undefined) entry.unit = patch.unit.trim() || entry.unit;
  if (patch.unitPrice !== undefined) entry.unitPrice = assertMoney(patch.unitPrice);
  if (patch.vatRate !== undefined) entry.vatRate = patch.vatRate;
  entry.isExtra = detectExtra(entry.jobId, entry);
  entry.updatedAt = new Date().toISOString();
  save();
  return entry;
}

export function deleteJobWorkEntry(entryId: string): void {
  const data = db();
  data.jobWorkEntries ??= [];
  const entry = data.jobWorkEntries.find((e) => e.id === entryId);
  if (!entry) return;
  if (entry.role === "planned") throw new Error("Avtalade rader tas inte bort – de kommer från offerten");
  if (isIssuedLinked(entry)) {
    throw new Error("Posten är fakturerad. Rätta via kreditfaktura.");
  }
  data.jobWorkEntries = data.jobWorkEntries.filter((e) => e.id !== entryId);
  save();
}

export function entryToDocLine(entry: JobWorkEntry, quoteNumber?: number): DocLine {
  const sourceKind =
    entry.type === "labor" ? "JOB_TIME_ENTRY" : entry.type === "material" ? "JOB_MATERIAL" : "JOB_OTHER";
  return syncDocLineClassification({
    id: uid(),
    kind: workTypeToLineKind(entry.type),
    description: entry.description,
    qty: entry.qty,
    unit: entry.unit,
    unitPrice: entry.unitPrice,
    vatRate: entry.vatRate,
    sourceKind,
    sourceId: entry.id,
    sourceQuoteNumber: quoteNumber,
  });
}

export function associateEntriesWithInvoice(entryIds: string[], invoiceId: string): void {
  const now = new Date().toISOString();
  for (const id of entryIds) {
    const entry = getJobWorkEntry(id);
    if (!entry || entry.role !== "actual") continue;
    if (isIssuedLinked(entry)) continue;
    entry.invoiceId = invoiceId;
    entry.updatedAt = now;
  }
  save();
}

export function unlinkJobWorkEntriesFromInvoice(invoiceId: string): void {
  const now = new Date().toISOString();
  let changed = false;
  for (const entry of db().jobWorkEntries ?? []) {
    if (entry.invoiceId !== invoiceId) continue;
    if (isIssuedLinked(entry)) continue;
    entry.invoiceId = undefined;
    entry.updatedAt = now;
    changed = true;
  }
  if (changed) save();
}

/** Importera avtalad baseline från godkänd offert. Rör aldrig actuals. */
export function importQuotedBaseline(job: Job, quote: Quote, persist = true): boolean {
  if (quote.status !== "godkand") return false;
  const data = db();
  const version = data.quoteVersions.find((v) => v.id === quote.currentVersionId);
  if (!version) return false;
  const changed = syncQuotedBaselineFromVersion(data, job.id, version, quote);
  if (changed && persist) save();
  return changed;
}

export function inferJobPricingKind(jobId: string): JobPricingKind {
  const job = getJob(jobId);
  const quote = job ? jobQuote(job) : undefined;
  const extras = actualEntries(jobId).filter((e) => e.isExtra);
  if (!quote || quote.status !== "godkand") return "lopande";
  if (extras.length > 0) return "hybrid";
  return "fast_pris";
}

export function jobWorkComparison(jobId: string): JobWorkComparison {
  const planned = plannedEntries(jobId);
  const actuals = actualEntries(jobId);
  const laborHoursQuoted = planned.filter((e) => e.type === "labor").reduce((s, e) => s + e.qty, 0);
  const laborHoursRegistered = actuals.filter((e) => e.type === "labor").reduce((s, e) => s + e.qty, 0);
  const laborHoursDelta = laborHoursRegistered - laborHoursQuoted;
  const materialQuotedExcl = planned.filter((e) => e.type === "material").reduce((s, e) => s + entryExclVat(e), 0);
  const materialRegisteredExcl = actuals.filter((e) => e.type === "material").reduce((s, e) => s + entryExclVat(e), 0);
  const quotedExcl = planned.reduce((s, e) => s + entryExclVat(e), 0);
  const registeredExcl = actuals.reduce((s, e) => s + entryExclVat(e), 0);
  const extrasCount = actuals.filter((e) => e.isExtra).length;
  let overageLabel: string | null = null;
  if (laborHoursQuoted > 0 && laborHoursDelta > 0.001) {
    const hours = Number(laborHoursDelta.toFixed(2));
    overageLabel = `+${hours.toLocaleString("sv-SE")} timmar jämfört med offert`;
  } else if (quotedExcl > 0 && registeredExcl > quotedExcl) {
    overageLabel = `+${registeredExcl - quotedExcl} kr jämfört med offert`;
  }
  const quote = jobQuote(requireJob(jobId));
  return {
    hasQuote: planned.length > 0,
    quoteNumber: quote?.number,
    laborHoursQuoted,
    laborHoursRegistered,
    laborHoursDelta,
    materialQuotedExcl,
    materialRegisteredExcl,
    quotedExcl,
    registeredExcl,
    deltaExcl: registeredExcl - quotedExcl,
    extrasCount,
    overageLabel,
  };
}

export function registeredUninvoicedAmount(jobId: string): number {
  return uninvoicedActuals(jobId).reduce((s, e) => s + entryInclVat(e), 0);
}

export function quotePrefillFromJob(jobId: string): {
  title: string;
  intro: string;
  lines: DocLine[];
} | null {
  const job = getJob(jobId);
  if (!job) return null;
  const planned = plannedEntries(jobId);
  const source = planned.length > 0 ? planned : actualEntries(jobId);
  return {
    title: job.title,
    intro: job.description.trim(),
    lines: source.map((e) => entryToDocLine(e)),
  };
}

function quoteInvoicePreviewAmount(jobId: string): number {
  const next = nextPaymentPlanPartForJob(jobId);
  if (next) return next.amount;
  return remainingToInvoiceForJob(jobId);
}

function actualsHint(entries: JobWorkEntry[]): string {
  const hours = entries.filter((e) => e.type === "labor").reduce((s, e) => s + e.qty, 0);
  const materials = entries.filter((e) => e.type === "material").length;
  const parts: string[] = [];
  if (hours > 0) parts.push(hoursLabel(hours));
  if (materials > 0) parts.push(materials === 1 ? "1 material" : `${materials} material`);
  if (parts.length === 0) {
    return entries.length === 1 ? "1 ofakturerad post" : `${entries.length} ofakturerade poster`;
  }
  return parts.join(" + ");
}

export function jobInvoiceChoice(jobId: string): JobInvoiceChoice {
  const job = requireJob(jobId);
  const quote = jobQuote(job);
  const pricingKind = inferJobPricingKind(jobId);
  const extras = uninvoicedActuals(jobId).filter((e) => e.isExtra);
  const uninvoiced = uninvoicedActuals(jobId);
  const actualsAmount = uninvoiced.reduce((s, e) => s + entryInclVat(e), 0);
  const extrasAmount = extras.reduce((s, e) => s + entryInclVat(e), 0);
  const quoteAmount = quote?.status === "godkand" ? quoteInvoicePreviewAmount(jobId) : 0;
  const nextPart = quote?.status === "godkand" ? nextPaymentPlanPartForJob(jobId) : null;
  const tillaggHref = newQuoteHref({
    kund: job.customerId,
    job: job.id,
    from: { href: `/uppdrag/${job.id}`, label: job.title },
  });

  const options: JobInvoiceOption[] = [];
  if (quote?.status === "godkand" && quoteAmount > 0) {
    const partHint =
      nextPart && !nextPart.isLast
        ? `${nextPart.percent} % ${nextPart.label.toLowerCase()} · Utgår från offert #${quote.number}`
        : `Utgår från offert #${quote.number}`;
    options.push({
      basis: "quote",
      title: "Enligt offert",
      hint: partHint,
      amount: quoteAmount,
    });
  }
  if (uninvoiced.length > 0) {
    options.push({
      basis: "actuals",
      title: "Ofakturerat arbete & material",
      hint: actualsHint(uninvoiced),
      amount: actualsAmount,
      extrasAmount: extrasAmount > 0 ? extrasAmount : undefined,
    });
  }
  options.push({
    basis: "empty",
    title: "Välj själv",
    hint: "Kund och uppdrag ifyllt. Du fyller i raderna.",
    amount: 0,
  });

  const recommendedBasis: JobInvoiceOptionBasis | null =
    pricingKind === "lopande" && options.some((o) => o.basis === "actuals") ? "actuals" : null;
  if (recommendedBasis) {
    const rec = options.find((o) => o.basis === recommendedBasis);
    if (rec) rec.recommended = true;
  }

  let warning: JobInvoiceChoice["warning"];
  const remainingQuote = quote?.status === "godkand" ? quoteAmount : 0;
  if (quote?.status === "godkand" && remainingQuote > 0 && actualsAmount > remainingQuote) {
    const excess = actualsAmount - remainingQuote;
    const pct = (excess / remainingQuote) * 100;
    if (excess >= QUOTE_EXCESS_WARN_AMOUNT || pct >= QUOTE_EXCESS_WARN_PERCENT) {
      warning = { excess, tillaggHref };
    }
  }

  const unapprovedQuoteNotice =
    quote && quote.status !== "godkand"
      ? quote.status === "skickad"
        ? "Offerten är skickad men inte godkänd. En faktura från registrerat arbete eller en tom faktura är inte samma sak som att kunden godkänt offerten."
        : quote.status === "utkast"
          ? "Det finns ett offertutkast. Du kan ändå skapa faktura – den utgår inte från offerten förrän den är godkänd."
          : "Offerten är inte godkänd. Fakturera registrerat arbete eller skapa en tom faktura."
      : undefined;

  const reasonable = options.filter((o) => o.basis !== "empty");
  const autoBasis: JobInvoiceOptionBasis | null =
    reasonable.length === 1 ? reasonable[0].basis : reasonable.length === 0 ? "empty" : null;

  return { pricingKind, options, recommendedBasis, warning, tillaggHref, unapprovedQuoteNotice, autoBasis };
}

export function hoursLabel(n: number): string {
  const rounded = Number(n.toFixed(2));
  return `${rounded.toLocaleString("sv-SE")} tim`;
}
