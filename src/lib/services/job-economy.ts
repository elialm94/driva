import { db } from "../store";
import type { Invoice, Quote } from "../types";
import { docTotals } from "../calc";
import {
  countsTowardInvoiced,
  invoiceCreditedAmount,
  invoicePaidAmount,
  invoiceTotals,
  invoicedTotalContribution,
} from "./data";

/**
 * Uppdragsekonomi – EN definition som uppdragslistan, uppdragssidan,
 * actionmotorn och assistenten delar. Frontend räknar aldrig själv.
 *
 *   * invoiced  = fakturerat (total inkl. moms). Utkast räknas med så att
 *     "kvar att fakturera" inte föreslår dubbelfakturering; delkrediter dras
 *     av, fullkrediterade par tar ut varandra (invoicedTotalContribution).
 *   * remaining = godkänd offert − invoiced, aldrig negativ. Invariant:
 *     remaining ≥ 0 och remaining + invoiced ≥ offertsumman.
 *   * unpaid    = utestående fordran på utfärdade fakturor: att-betala minus
 *     faktiska inbetalningar minus delkrediter. Utkast är INTE en fordran.
 *   * paid      = faktiskt inbetalda kronor (payments), inte fakturabelopp.
 */
export interface JobMoney {
  quote?: Quote;
  /** Kundens pris enligt offerten (att betala, efter ROT/RUT). */
  quoteAmount: number;
  /** Fakturerat inkl. moms (utkast inräknade, krediter avdragna). */
  invoiced: number;
  /**
   * Utfärdat fakturerat (utkast räknas inte). Används i sammanfattningen
   * "Fakturerat" – utkast reservar kvar-att-fakturera men syns inte här.
   */
  invoicedIssued: number;
  /** Kvar att fakturera enligt godkänd offert. Aldrig negativt. */
  remaining: number;
  /** Utestående fordran (skickade/delbetalda fakturor). */
  unpaid: number;
  /** Faktiskt inbetalt. */
  paid: number;
  /**
   * Registrerat men inte fakturerat (actuals utan utfärdad/utkast-faktura).
   * Inte samma sak som remaining (kvar enligt offert).
   */
  registeredUninvoiced: number;
  /** Allt registrerat arbete/material inkl. moms (fakturerat + ofakturerat). */
  registered: number;
  invoices: Invoice[];
}

/*
 * Fakturagruppering per uppdrag/offert. `jobId`/`quoteId` sätts när fakturan
 * skapas och ändras aldrig, och fakturor läggs alltid till med push – cachen
 * (arrayinstans + längd) invalideras därför automatiskt av nya rader och nya
 * laddningar. Status-/betalfält läses live från objekten, så grupperingen är
 * säker att cacha även när status ändras.
 */
interface InvoiceGroups {
  len: number;
  byJob: Map<string, Invoice[]>;
  byQuote: Map<string, Invoice[]>;
}
const groupsCache = new WeakMap<object, InvoiceGroups>();

function invoiceGroups(): InvoiceGroups {
  const invoices = db().invoices;
  let cached = groupsCache.get(invoices);
  if (!cached || cached.len !== invoices.length) {
    const byJob = new Map<string, Invoice[]>();
    const byQuote = new Map<string, Invoice[]>();
    for (const inv of invoices) {
      if (inv.jobId) {
        const list = byJob.get(inv.jobId);
        if (list) list.push(inv);
        else byJob.set(inv.jobId, [inv]);
      }
      if (inv.quoteId) {
        const list = byQuote.get(inv.quoteId);
        if (list) list.push(inv);
        else byQuote.set(inv.quoteId, [inv]);
      }
    }
    cached = { len: invoices.length, byJob, byQuote };
    groupsCache.set(invoices, cached);
  }
  return cached;
}

/** Alla fakturor som hör till ett uppdrag (O(1)-uppslag, cachad gruppering). */
export function invoicesForJob(jobId: string): Invoice[] {
  return invoiceGroups().byJob.get(jobId) ?? [];
}

/** Fakturor som hör till uppdraget ELLER dess offert (delbetalningsplaner). */
export function invoicesForJobOrQuote(jobId: string, quoteId?: string): Invoice[] {
  const byJob = invoicesForJob(jobId);
  if (!quoteId) return byJob;
  const byQuote = invoiceGroups().byQuote.get(quoteId) ?? [];
  if (byQuote.length === 0) return byJob;
  const seen = new Set(byJob.map((i) => i.id));
  return [...byJob, ...byQuote.filter((i) => !seen.has(i.id))];
}

function actualsInclVat(jobId: string, onlyUninvoiced: boolean, invoices: Invoice[]): number {
  const live = new Set(
    invoices.filter((i) => i.status !== "krediterad" && i.type !== "kredit").map((i) => i.id)
  );
  let sum = 0;
  for (const e of db().jobWorkEntries ?? []) {
    if (e.jobId !== jobId || e.role !== "actual") continue;
    if (onlyUninvoiced && e.invoiceId && live.has(e.invoiceId)) continue;
    sum += Math.round(e.qty * e.unitPrice * (1 + e.vatRate / 100));
  }
  return sum;
}

function moneyFor(jobId: string, quote: Quote | undefined, invoices: Invoice[]): JobMoney {
  const data = db();
  const version = quote ? data.quoteVersions.find((v) => v.id === quote.currentVersionId) : undefined;
  const quoteTotals = version ? docTotals(version.lines, version.rot) : undefined;

  let invoiced = 0;
  let invoicedIssued = 0;
  let unpaid = 0;
  let paid = 0;
  for (const inv of invoices) {
    const contribution = invoicedTotalContribution(inv);
    invoiced += contribution;
    if (inv.status !== "utkast") invoicedIssued += contribution;
    if (inv.type === "kredit") continue;
    paid += invoicePaidAmount(inv.id);
    if (inv.status === "skickad" || inv.status === "delbetald") {
      unpaid += Math.max(0, invoiceTotals(inv).toPay - invoicePaidAmount(inv.id) - invoiceCreditedAmount(inv.id));
    }
  }

  const remaining =
    quote?.status === "godkand" && quoteTotals ? Math.max(0, quoteTotals.total - invoiced) : 0;

  return {
    quote,
    quoteAmount: quoteTotals?.toPay ?? 0,
    invoiced,
    invoicedIssued,
    remaining,
    unpaid,
    paid,
    registeredUninvoiced: actualsInclVat(jobId, true, invoices),
    registered: actualsInclVat(jobId, false, invoices),
    // Samma lista som tidigare jobMoneySummary: original som räknas – inte
    // kreditfakturor eller fullkrediterade par.
    invoices: invoices.filter(countsTowardInvoiced),
  };
}

/** Ekonomi för ETT uppdrag. */
export function jobMoney(jobId: string): JobMoney {
  const data = db();
  const job = data.jobs.find((j) => j.id === jobId);
  const quote = job
    ? data.quotes.find((q) => q.id === job.quoteId) ?? data.quotes.find((q) => q.jobId === job.id)
    : undefined;
  return moneyFor(jobId, quote, invoicesForJob(jobId));
}

/** Ekonomi för ALLA uppdrag i en genomläsning (listor – ingen N+1). */
export function jobMoneyForAll(): Map<string, JobMoney> {
  const data = db();
  const quoteById = new Map(data.quotes.map((q) => [q.id, q]));
  const quoteByJobId = new Map<string, Quote>();
  for (const q of data.quotes) {
    if (q.jobId) quoteByJobId.set(q.jobId, q);
  }
  const out = new Map<string, JobMoney>();
  for (const job of data.jobs) {
    const quote = (job.quoteId ? quoteById.get(job.quoteId) : undefined) ?? quoteByJobId.get(job.id);
    out.set(job.id, moneyFor(job.id, quote, invoicesForJob(job.id)));
  }
  return out;
}
