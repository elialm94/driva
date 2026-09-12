import { db, save } from "../store";
import { publicToken } from "../ids";
import type { Invoice, Job, JobChange, JobCustomerShare, JobPhoto, Quote, QuoteVersion } from "../types";
import { docTotals } from "../calc";
import { kr } from "../format";
import {
  currentVersion,
  getJob,
  invoicePaidAmount,
  invoiceTotals,
  isOverdue,
  jobQuote,
  quoteAcceptance,
  requireCustomer,
} from "./data";
import { invoicesForJobOrQuote } from "./job-economy";
import { approvedJobChanges, jobChangeTotals } from "./job-changes";
import { actualEntries } from "./job-work";
import { paymentPlanAmounts } from "../payment-plan";
import { logCloseoutEvent } from "./closeout";
import { logAudit } from "../accounting/audit";

/**
 * Kundvyn och slutunderlaget.
 *
 * Kunden ser BARA det företaget uttryckligen delat. Allt är av tills
 * användaren slår på det. Samma säkra publika-token-arkitektur som offert-
 * och ändringslänkarna (jobs.share_token → app.resolve_public_token).
 *
 * Det som aldrig får nå kunden byggs inte ens in i vyn: inköpspriser,
 * täckning, interna anteckningar, bokföring, AI-förslag, grossistrabatter,
 * ej delade dokument. `customerShareView` är den enda vägen till kunddata och
 * returnerar bara fält som är säkra att visa.
 */

export type CustomerShareSettings = Pick<JobCustomerShare, "quote" | "changes" | "invoices" | "paymentStatus" | "closeoutSummary" | "photoIds">;

export const DEFAULT_SHARE: CustomerShareSettings = {
  quote: true,
  changes: true,
  invoices: true,
  paymentStatus: true,
  closeoutSummary: false,
  photoIds: [],
};

export function getJobByShareToken(token: string): Job | undefined {
  if (!token) return undefined;
  return db().jobs.find((j) => j.customerShare?.token === token);
}

export function isCustomerShareActive(job: Job): boolean {
  return Boolean(job.customerShare && !job.customerShare.disabledAt);
}

/** Slår på kundlänken (skapar token första gången). Skickar ingenting. */
export function enableCustomerShare(jobId: string, settings: Partial<CustomerShareSettings> = {}): JobCustomerShare {
  const job = getJob(jobId);
  if (!job) throw new Error("Uppdraget finns inte");
  const now = new Date().toISOString();
  const prev = job.customerShare;
  const photoIds = (settings.photoIds ?? prev?.photoIds ?? []).filter((id) => (job.photos ?? []).some((p) => p.id === id));
  job.customerShare = {
    token: prev?.token ?? publicToken(),
    sharedAt: prev && !prev.disabledAt ? prev.sharedAt : now,
    quote: settings.quote ?? prev?.quote ?? DEFAULT_SHARE.quote,
    changes: settings.changes ?? prev?.changes ?? DEFAULT_SHARE.changes,
    invoices: settings.invoices ?? prev?.invoices ?? DEFAULT_SHARE.invoices,
    paymentStatus: settings.paymentStatus ?? prev?.paymentStatus ?? DEFAULT_SHARE.paymentStatus,
    closeoutSummary: settings.closeoutSummary ?? prev?.closeoutSummary ?? DEFAULT_SHARE.closeoutSummary,
    photoIds,
  };
  const wasActive = Boolean(prev && !prev.disabledAt);
  if (!wasActive) {
    logCloseoutEvent(job.id, "kundvy_delad", "Kundens uppdragslänk aktiverades.");
  }
  if (job.customerShare.closeoutSummary && !prev?.closeoutSummary) {
    logCloseoutEvent(job.id, "slutunderlag_skapat", "Slutunderlaget delades på kundens uppdragslänk.");
  }
  save();
  return job.customerShare;
}

/** Pausar länken: sidan svarar "inte tillgänglig". Inställningarna finns kvar. */
export function disableCustomerShare(jobId: string): void {
  const job = getJob(jobId);
  if (!job?.customerShare || job.customerShare.disabledAt) return;
  job.customerShare.disabledAt = new Date().toISOString();
  logCloseoutEvent(job.id, "kundvy_stangd", "Kundens uppdragslänk stängdes.");
  logAudit("anvandare", "uppdrag_kundvy_stangd", `Kundlänken för uppdraget “${job.title}” stängdes.`, { targetType: "uppdrag", targetId: job.id });
  save();
}

/* ------------------------------- kundens vy -------------------------------- */

export interface SharedInvoice {
  id: string;
  token: string;
  number: number | null;
  type: Invoice["type"];
  issuedAt?: string;
  dueDate: string;
  amount: number;
  paid: number;
  /** Kundvänlig status utan intern jargong. */
  status: "betald" | "delbetald" | "att_betala" | "forfallen" | "kredit";
  label: string;
}

export interface SharedPaymentStatus {
  invoiced: number;
  paid: number;
  remaining: number;
  overdue: boolean;
  /** Kommande delar i betalplanen som inte fakturerats än (belopp). */
  upcoming: { label: string; amount: number }[];
}

export interface CustomerShareView {
  token: string;
  job: { id: string; title: string; description: string; address?: string; status: Job["status"]; completedAt?: string };
  customerName: string;
  quote?: { id: string; token: string; number: number; total: number; toPay: number; approvedAt?: string; approvedBy?: string; rot?: "rot" | "rut"; version: QuoteVersion };
  changes: { id: string; token: string; number: number; version: number; title: string; description: string; toPay: number; approvedAt: string; approvedBy: string }[];
  photos: JobPhoto[];
  invoices: SharedInvoice[];
  paymentStatus?: SharedPaymentStatus;
  closeoutSummary: boolean;
  /** Utfört arbete på beskrivningsnivå: timmar och datumintervall, aldrig priser eller inköp. */
  work?: { hours: number; firstDate?: string; lastDate?: string; descriptions: string[] };
}

function sharedInvoice(inv: Invoice): SharedInvoice {
  const amount = invoiceTotals(inv).toPay;
  const paid = invoicePaidAmount(inv.id);
  let status: SharedInvoice["status"];
  if (inv.type === "kredit") status = "kredit";
  else if (inv.status === "betald" || inv.status === "krediterad") status = "betald";
  else if (isOverdue(inv)) status = "forfallen";
  else if (inv.status === "delbetald") status = "delbetald";
  else status = "att_betala";
  const label =
    status === "kredit"
      ? "Kreditfaktura"
      : status === "betald"
        ? "Betald"
        : status === "forfallen"
          ? "Förfallen"
          : status === "delbetald"
            ? `Delvis betald (${kr(paid)} av ${kr(amount)})`
            : "Att betala";
  return {
    id: inv.id,
    token: inv.token,
    number: inv.number,
    type: inv.type,
    ...(inv.issuedAt ? { issuedAt: inv.issuedAt } : {}),
    dueDate: inv.dueDate,
    amount,
    paid,
    status,
    label,
  };
}

function paymentStatusFor(job: Job, quote: Quote | undefined, version: QuoteVersion | undefined, invoices: Invoice[]): SharedPaymentStatus {
  const receivables = invoices.filter((i) => i.type !== "kredit");
  const credits = invoices.filter((i) => i.type === "kredit");
  const invoiced = receivables.reduce((s, i) => s + invoiceTotals(i).toPay, 0) - credits.reduce((s, i) => s + invoiceTotals(i).toPay, 0);
  const paid = receivables.reduce((s, i) => s + invoicePaidAmount(i.id), 0);
  const remaining = Math.max(0, invoiced - paid);
  const upcoming: SharedPaymentStatus["upcoming"] = [];
  if (quote && version && version.paymentPlan.length > 0) {
    const amounts = paymentPlanAmounts(version.paymentPlan, docTotals(version.lines, version.rot).toPay);
    // En del räknas som fakturerad om en faktura pekar på den, eller om det
    // fakturerade beloppet redan täcker delarna fram till och med den
    // (äldre fakturor utan planindex).
    let cumulative = 0;
    version.paymentPlan.forEach((part, index) => {
      cumulative += amounts[index] ?? 0;
      const explicit = receivables.some((i) => i.paymentPlanIndex === index || (i.type === "slutfaktura" && index === version.paymentPlan.length - 1));
      const covered = explicit || invoiced >= cumulative;
      if (!covered) upcoming.push({ label: part.label, amount: amounts[index] ?? 0 });
    });
  }
  return { invoiced, paid, remaining, overdue: receivables.some(isOverdue), upcoming };
}

/**
 * Bygger kundens vy från delningsinställningarna. Saknas länk eller är den
 * stängd returneras undefined – sidan svarar då "inte tillgänglig".
 */
export function customerShareView(job: Job): CustomerShareView | undefined {
  const share = job.customerShare;
  if (!share || share.disabledAt) return undefined;
  const customer = requireCustomer(job.customerId);
  const quote = jobQuote(job);
  const approved = quote?.status === "godkand" ? quote : undefined;
  const version = approved ? currentVersion(approved) : undefined;
  const acceptance = approved ? quoteAcceptance(approved.id) : undefined;
  const issued = invoicesForJobOrQuote(job.id, quote?.id).filter((i) => i.status !== "utkast");

  const view: CustomerShareView = {
    token: share.token,
    job: {
      id: job.id,
      title: job.title,
      description: job.description,
      ...(job.address ? { address: job.address } : {}),
      status: job.status,
      ...(job.completedAt ? { completedAt: job.completedAt } : {}),
    },
    customerName: customer.name,
    changes: [],
    photos: (job.photos ?? []).filter((p) => share.photoIds.includes(p.id)),
    invoices: [],
    closeoutSummary: share.closeoutSummary,
  };

  if (share.quote && approved && version) {
    const t = docTotals(version.lines, version.rot);
    view.quote = {
      id: approved.id,
      token: approved.token,
      number: approved.number,
      total: t.total,
      toPay: t.toPay,
      ...(acceptance ? { approvedAt: acceptance.acceptedAt, approvedBy: acceptance.acceptedByName } : {}),
      ...(version.rot ? { rot: version.rot.type } : {}),
      version,
    };
  }
  if (share.changes) {
    view.changes = approvedJobChanges(job.id)
      .filter((c): c is JobChange & { approval: NonNullable<JobChange["approval"]> } => Boolean(c.approval))
      .map((c) => ({
        id: c.id,
        token: c.token,
        number: c.number,
        version: c.version,
        title: c.title,
        description: c.description,
        toPay: jobChangeTotals(c).toPay,
        approvedAt: c.approval.approvedAt,
        approvedBy: c.approval.approvedByName,
      }));
  }
  if (share.invoices) view.invoices = issued.map(sharedInvoice);
  if (share.paymentStatus) view.paymentStatus = paymentStatusFor(job, approved, version, issued);
  if (share.closeoutSummary) {
    const actuals = actualEntries(job.id);
    const labor = actuals.filter((e) => e.type === "labor");
    const dates = actuals.map((e) => e.date).sort();
    view.work = {
      hours: labor.reduce((s, e) => s + e.qty, 0),
      ...(dates[0] ? { firstDate: dates[0] } : {}),
      ...(dates.length ? { lastDate: dates[dates.length - 1] } : {}),
      descriptions: Array.from(new Set(labor.map((e) => e.description.trim()).filter(Boolean))),
    };
  }
  return view;
}

/**
 * Ägarens variant av slutunderlaget: allt som kan ingå, oavsett vad som
 * delats. Används i förhandsgranskningen där användaren väljer vad som delas.
 */
export function ownerCloseoutSummaryView(job: Job): CustomerShareView {
  const share = job.customerShare;
  const temp: Job = {
    ...job,
    customerShare: {
      token: share?.token ?? "",
      sharedAt: share?.sharedAt ?? job.createdAt,
      quote: true,
      changes: true,
      invoices: true,
      paymentStatus: true,
      closeoutSummary: true,
      photoIds: share?.photoIds ?? [],
    },
  };
  const view = customerShareView(temp);
  if (!view) throw new Error("Slutunderlaget kunde inte byggas");
  return view;
}
