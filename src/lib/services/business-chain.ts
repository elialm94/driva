/**
 * Offert → uppdrag → faktura som EN kedja.
 *
 * Relationer återanvänder befintliga FKs (quote.jobId, job.quoteId,
 * invoice.quoteId, invoice.jobId). Länkar uppfinns aldrig från
 * "samma kund + liknande belopp".
 *
 * Ekonomi: Avtalat = godkända offerter (inte uppdrag). Fakturerat =
 * fakturor. Ett uppdrag som ärver en offert räknas inte en gång till.
 */
import { db } from "../store";
import type { DocLine, Invoice, Job, JobWorkEntry, LineSourceKind, Quote } from "../types";
import type {
  ChainCta,
  CustomerActivityMember,
  CustomerChainCtas,
  InvoiceChainLink,
  QuoteChainState,
} from "../business-chain-model";
import {
  currentVersion,
  getJob,
  getQuote,
  invoiceTotals,
  jobQuote,
  quoteTotals,
} from "./data";
import { invoicesForJob, invoicesForJobOrQuote, jobMoney } from "./job-economy";
import { invoiceHref, jobHref, newInvoiceHref, newQuoteHref, quoteHref } from "../nav";
import { invoiceNumberLabel } from "../invoices/display";
import { QUOTE_STATUS } from "../status-labels";

export type { ChainCta, CustomerChainCtas, InvoiceChainLink, QuoteChainState } from "../business-chain-model";

export function jobForQuote(quote: Quote): Job | undefined {
  const data = db();
  if (quote.jobId) {
    const byId = data.jobs.find((j) => j.id === quote.jobId);
    if (byId) return byId;
  }
  return data.jobs.find((j) => j.quoteId === quote.id);
}

export function quoteForJob(job: Job): Quote | undefined {
  return jobQuote(job);
}

/** Kedja från en faktura – bara befintliga IDs, aldrig gissning. */
export function chainFromInvoice(invoice: Invoice): { quote?: Quote; job?: Job } {
  const data = db();
  const job = invoice.jobId ? data.jobs.find((j) => j.id === invoice.jobId) : undefined;
  const quote = invoice.quoteId
    ? data.quotes.find((q) => q.id === invoice.quoteId)
    : job
      ? jobQuote(job)
      : undefined;
  return { quote, job };
}

export function invoicesForQuote(quoteId: string): Invoice[] {
  return db().invoices.filter((i) => i.quoteId === quoteId);
}

export function liveInvoicesForQuote(quoteId: string): Invoice[] {
  return invoicesForQuote(quoteId).filter((i) => i.status !== "krediterad" && i.type !== "kredit");
}

export function billedSourceIds(quoteId?: string, jobId?: string): Set<string> {
  const ids = new Set<string>();
  const invoices = db().invoices.filter((i) => {
    if (i.status === "krediterad" || i.type === "kredit") return false;
    if (quoteId && i.quoteId === quoteId) return true;
    if (jobId && i.jobId === jobId) return true;
    return false;
  });
  for (const inv of invoices) {
    if (inv.paymentPlanIndex != null) ids.add(`plan:${inv.paymentPlanIndex}`);
    for (const line of inv.lines) {
      if (line.sourceId) ids.add(line.sourceId);
      if (line.sourceKind === "PAYMENT_PLAN" && line.paymentPlanIndex != null) {
        ids.add(`plan:${line.paymentPlanIndex}`);
      }
    }
  }
  return ids;
}

export function paymentPlanPartAlreadyInvoiced(quoteId: string, partIndex: number): boolean {
  for (const inv of liveInvoicesForQuote(quoteId)) {
    if (inv.paymentPlanIndex === partIndex) return true;
    if (inv.lines.some((l) => l.sourceKind === "PAYMENT_PLAN" && l.paymentPlanIndex === partIndex)) {
      return true;
    }
  }
  return false;
}

export function nextPaymentPlanPartForQuote(quoteId: string): {
  index: number;
  percent: number;
  label: string;
  amount: number;
  isLast: boolean;
} | null {
  const quote = getQuote(quoteId);
  if (!quote || quote.status !== "godkand") return null;
  const version = currentVersion(quote);
  const plan = version.paymentPlan;
  if (plan.length === 0) return null;
  const totals = quoteTotals(quote);
  const live = liveInvoicesForQuote(quoteId);
  const used = new Set(live.map((i) => i.paymentPlanIndex).filter((n): n is number => n != null));
  for (const inv of live) {
    for (const line of inv.lines) {
      if (line.paymentPlanIndex != null) used.add(line.paymentPlanIndex);
    }
  }
  // Äldre fakturor utan index: räkna i skapandeordning (samma som tidigare).
  if (used.size === 0 && live.length > 0) {
    for (let i = 0; i < live.length && i < plan.length; i++) used.add(i);
  }
  let index = 0;
  while (index < plan.length && used.has(index)) index++;
  if (index >= plan.length) return null;
  const invoiced = live.reduce((s, i) => s + invoiceTotals(i).total, 0);
  const remaining = Math.max(0, totals.total - invoiced);
  if (remaining <= 0) return null;
  const part = plan[index];
  const isLast = index === plan.length - 1;
  const fromPlan = Math.round((totals.total * part.percent) / 100);
  return { index, percent: part.percent, label: part.label, amount: isLast ? remaining : fromPlan, isLast };
}

export function lineWithQuoteProvenance(line: DocLine, quote: Quote, originalLineId?: string): DocLine {
  return {
    ...line,
    sourceKind: line.sourceKind ?? "QUOTE_LINE",
    sourceId: line.sourceId ?? originalLineId ?? line.id,
    sourceQuoteNumber: line.sourceQuoteNumber ?? quote.number,
  };
}

export function lineWithWorkProvenance(line: DocLine, entry: JobWorkEntry, quoteNumber?: number): DocLine {
  const sourceKind: LineSourceKind =
    entry.type === "labor" ? "JOB_TIME_ENTRY" : entry.type === "material" ? "JOB_MATERIAL" : "JOB_OTHER";
  return {
    ...line,
    sourceKind,
    sourceId: entry.id,
    sourceQuoteNumber: quoteNumber,
  };
}

export function lineWithPaymentPlanProvenance(
  line: DocLine,
  quote: Quote,
  partIndex: number
): DocLine {
  return {
    ...line,
    sourceKind: "PAYMENT_PLAN",
    sourceId: `${quote.id}:plan:${partIndex}`,
    sourceQuoteNumber: quote.number,
    paymentPlanIndex: partIndex,
  };
}

export function baselineProvenanceLabel(quoteNumber: number): string {
  return `Från offert #${quoteNumber}`;
}

export function isOpenJob(job: Job): boolean {
  return !job.archivedAt && job.status !== "klart";
}

export function quoteChainState(
  quote: Quote,
  from?: { href: string; label: string }
): QuoteChainState {
  const job = jobForQuote(quote);
  const origin = from ?? { href: quoteHref(quote.id), label: `Offert #${quote.number}` };
  const waitingLabel = quote.status === "skickad" ? QUOTE_STATUS.skickad.label : null;

  const startJob: ChainCta = {
    kind: "starta_uppdrag",
    label: "Starta uppdrag",
    quoteId: quote.id,
    jobId: job?.id,
    href: job ? jobHref(job.id, origin) : undefined,
  };
  const createInvoice: ChainCta = {
    kind: "skapa_faktura",
    label: "Skapa faktura",
    quoteId: quote.id,
    jobId: job?.id,
  };

  const nextPart = quote.status === "godkand" ? nextPaymentPlanPartForQuote(quote.id) : null;
  const fakturera: ChainCta | null = nextPart
    ? { ...createInvoice, label: "Fakturera", jobId: job?.id }
    : null;

  if (quote.status === "godkand") {
    if (!job) {
      return {
        quoteId: quote.id,
        quoteNumber: quote.number,
        status: quote.status,
        waitingLabel: null,
        primary: { ...startJob, primary: true },
        secondary: fakturera ? [fakturera] : [],
        overflow: [],
      };
    }
    // Kopplat uppdrag syns i Kopplat till – ingen Starta/Öppna i åtgärdsfältet.
    return {
      quoteId: quote.id,
      quoteNumber: quote.number,
      status: quote.status,
      jobId: job.id,
      jobTitle: job.title,
      waitingLabel: null,
      primary: fakturera ? { ...fakturera, primary: true } : null,
      secondary: [],
      overflow: [],
    };
  }

  if (quote.status === "skickad") {
    return {
      quoteId: quote.id,
      quoteNumber: quote.number,
      status: quote.status,
      jobId: job?.id,
      jobTitle: job?.title,
      waitingLabel,
      primary: null,
      secondary: [],
      overflow: [],
    };
  }

  return {
    quoteId: quote.id,
    quoteNumber: quote.number,
    status: quote.status,
    jobId: job?.id,
    jobTitle: job?.title,
    waitingLabel,
    primary: null,
    secondary: [],
    overflow: [],
  };
}

export function customerChainCtas(
  customerId: string,
  from?: { href: string; label: string }
): CustomerChainCtas {
  const origin = from ?? { href: `/kunder/${customerId}`, label: "Kund" };
  const data = db();
  const quotes = data.quotes.filter((q) => q.customerId === customerId);
  const jobs = data.jobs.filter((j) => j.customerId === customerId && !j.archivedAt);
  const approvedWithoutJob = quotes
    .filter((q) => q.status === "godkand" && !jobForQuote(q))
    .sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt));
  const approvedQuote = approvedWithoutJob[0];
  const openJobs = jobs.filter(isOpenJob);
  const billableJob = openJobs.find((j) => {
    const money = jobMoney(j.id);
    return money.remaining > 0 || money.registeredUninvoiced > 0;
  }) ?? openJobs[0];

  const secondary: ChainCta[] = [];
  let primary: ChainCta | null = null;

  if (approvedQuote) {
    primary = {
      kind: "starta_uppdrag",
      label: "Starta uppdrag",
      quoteId: approvedQuote.id,
      primary: true,
    };
    secondary.push({
      kind: "skapa_faktura",
      label: "Skapa faktura",
      quoteId: approvedQuote.id,
    });
  } else if (billableJob) {
    const money = jobMoney(billableJob.id);
    const next = nextPaymentPlanPartForQuote(billableJob.quoteId ?? "");
    const label =
      next && !next.isLast && money.remaining > 0 ? "Skapa delfaktura" : "Skapa faktura";
    primary = {
      kind: next && !next.isLast ? "skapa_delfaktura" : "skapa_faktura",
      label,
      jobId: billableJob.id,
      href: jobHref(billableJob.id, origin),
      primary: true,
    };
  }

  if (billableJob) {
    secondary.push({
      kind: "fristaende_faktura",
      label: "Fristående faktura",
      href: newInvoiceHref({ kund: customerId, fristaende: true, from: origin }),
    });
  } else if (!approvedQuote) {
    secondary.push({
      kind: "fristaende_faktura",
      label: "Ny faktura",
      href: newInvoiceHref({ kund: customerId, from: origin }),
    });
  }

  if (!approvedQuote) {
    secondary.push({
      kind: "skapa_offert",
      label: "Ny offert",
      href: newQuoteHref({ kund: customerId, from: origin }),
    });
  }

  return {
    approvedQuoteId: approvedQuote?.id,
    approvedQuoteNumber: approvedQuote?.number,
    openJobId: billableJob?.id,
    openJobTitle: billableJob?.title,
    preferLinkedInvoice: Boolean(billableJob),
    primary,
    secondary,
  };
}

export function invoiceChainLink(
  invoice: Invoice,
  from?: { href: string; label: string }
): InvoiceChainLink {
  const { quote, job } = chainFromInvoice(invoice);
  if (!quote && !job) {
    return { label: null };
  }
  const parts: string[] = [];
  if (quote) parts.push(`offert #${quote.number}`);
  if (job) parts.push(job.title);
  return {
    quoteId: quote?.id,
    quoteNumber: quote?.number,
    quoteHref: quote ? quoteHref(quote.id, from) : undefined,
    jobId: job?.id,
    jobTitle: job?.title,
    jobHref: job ? jobHref(job.id, from) : undefined,
    label: `Kopplat till ${parts.join(" · ")}`,
  };
}

function quoteStatusLabel(quote: Quote): string {
  return QUOTE_STATUS[quote.status].label;
}

function invoiceStatusLabel(invoice: Invoice): string {
  if (invoice.type === "kredit") return "Kreditfaktura";
  if (invoice.status === "utkast") return "Utkast";
  if (invoice.status === "betald") return "Betald";
  if (invoice.status === "krediterad") return "Krediterad";
  if (invoice.status === "delbetald") return "Delbetald";
  return "Skickad";
}

function jobStatusLabel(job: Job): string {
  if (job.status === "klart") return "Klart";
  if (job.status === "pagar") return "Pågår";
  return "Kommande";
}

function eventTime(iso: string): string {
  return iso.length <= 10 ? `${iso}T12:00:00.000Z` : iso;
}

interface ChainCluster {
  quote?: Quote;
  job?: Job;
  invoices: Invoice[];
  payments: { id: string; invoiceId: string; amount: number; date: string }[];
}

function clusterKeyForQuote(quote: Quote): string {
  return jobForQuote(quote)?.id ? `job:${jobForQuote(quote)!.id}` : `quote:${quote.id}`;
}

function clusterKeyForJob(job: Job): string {
  return `job:${job.id}`;
}

function clusterKeyForInvoice(invoice: Invoice): string | null {
  if (invoice.jobId) return `job:${invoice.jobId}`;
  if (invoice.quoteId) {
    const quote = getQuote(invoice.quoteId);
    if (quote) return clusterKeyForQuote(quote);
    return `quote:${invoice.quoteId}`;
  }
  return null;
}

/**
 * Grupperar kundens objekt i kedjor utifrån sparade IDs.
 * Fristående fakturor (utan quoteId/jobId) blir egna rader.
 */
export function customerActivityClusters(customerId: string): ChainCluster[] {
  const data = db();
  const quotes = data.quotes.filter((q) => q.customerId === customerId);
  const jobs = data.jobs.filter((j) => j.customerId === customerId);
  const invoices = data.invoices.filter((i) => i.customerId === customerId);
  const invoiceIds = new Set(invoices.map((i) => i.id));
  const payments = data.payments.filter((p) => invoiceIds.has(p.invoiceId));

  const clusters = new Map<string, ChainCluster>();

  function cluster(key: string): ChainCluster {
    let c = clusters.get(key);
    if (!c) {
      c = { invoices: [], payments: [] };
      clusters.set(key, c);
    }
    return c;
  }

  for (const job of jobs) {
    const c = cluster(clusterKeyForJob(job));
    c.job = job;
    const quote = jobQuote(job);
    if (quote) c.quote = quote;
  }
  for (const quote of quotes) {
    const key = clusterKeyForQuote(quote);
    const c = cluster(key);
    c.quote = quote;
    const job = jobForQuote(quote);
    if (job) c.job = job;
  }
  for (const inv of invoices) {
    const key = clusterKeyForInvoice(inv) ?? `invoice:${inv.id}`;
    const c = cluster(key);
    c.invoices.push(inv);
    if (!c.quote && inv.quoteId) c.quote = getQuote(inv.quoteId);
    if (!c.job && inv.jobId) c.job = getJob(inv.jobId);
  }
  for (const p of payments) {
    const inv = invoices.find((i) => i.id === p.invoiceId);
    const key = inv ? clusterKeyForInvoice(inv) ?? `invoice:${inv.id}` : `payment:${p.id}`;
    cluster(key).payments.push(p);
  }

  return [...clusters.values()];
}

export function customerActivityMembers(
  cluster: ChainCluster,
  customerId: string
): CustomerActivityMember[] {
  const from = { href: `/kunder/${customerId}`, label: "Kund" };
  const members: CustomerActivityMember[] = [];
  if (cluster.quote) {
    members.push({
      kind: "offert",
      title: `Offert #${cluster.quote.number}`,
      href: quoteHref(cluster.quote.id, from),
      statusLabel: quoteStatusLabel(cluster.quote),
    });
  }
  if (cluster.job) {
    members.push({
      kind: "uppdrag",
      title: cluster.job.title,
      href: jobHref(cluster.job.id, from),
      statusLabel: jobStatusLabel(cluster.job),
    });
  }
  for (const inv of cluster.invoices) {
    members.push({
      kind: "faktura",
      title: inv.number == null ? "Fakturautkast" : `Faktura ${invoiceNumberLabel(inv)}`,
      href: invoiceHref(inv.id, from),
      statusLabel: invoiceStatusLabel(inv),
    });
  }
  for (const p of cluster.payments) {
    const inv = cluster.invoices.find((i) => i.id === p.invoiceId);
    members.push({
      kind: "betalning",
      title: inv?.number != null ? `Betalning · Faktura #${inv.number}` : "Betalning",
      href: inv ? invoiceHref(inv.id, from) : `/kunder/${customerId}`,
      statusLabel: "Matchad",
    });
  }
  return members;
}

export function preferredJobForNewInvoice(customerId: string): Job | undefined {
  const jobs = db().jobs.filter((j) => j.customerId === customerId && isOpenJob(j));
  if (jobs.length === 0) return undefined;
  const withWork = jobs.filter((j) => {
    const money = jobMoney(j.id);
    return money.remaining > 0 || money.registeredUninvoiced > 0 || Boolean(j.quoteId);
  });
  const pool = withWork.length > 0 ? withWork : jobs;
  if (pool.length !== 1) return undefined;
  return pool[0];
}

export { invoicesForJob, invoicesForJobOrQuote };
