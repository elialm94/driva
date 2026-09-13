import { db } from "../store";
import type { Invoice, Job, JobChange, JobWorkEntry, Quote } from "../types";
import { getJob, jobQuote, quoteAcceptance, invoiceTotals } from "./data";
import { invoicesForJobOrQuote } from "./job-economy";
import { jobChangesForJob } from "./job-changes";
import { actualEntries } from "./job-work";
import { jobSourceLabel } from "./jobs";
import { kr } from "../format";

/**
 * Uppdragstidslinjen: en läsbar historik av vad som hänt, härledd ur fakta
 * (offert, ändringar, arbete, foton, fakturor, betalningar, avslutsbeslut)
 * i stället för ur en logg. Nyast först. Ingen databasjargong i texterna.
 *
 * Kategorier = filtren i vyn: Kund (kommunikation med kunden), Arbete (det
 * som gjorts på plats), Ekonomi (fakturor, betalningar, beslut).
 */
export type { TimelineCategory, TimelineEntry, TimelineIcon } from "../job-timeline-types";
import type { TimelineCategory, TimelineEntry, TimelineIcon } from "../job-timeline-types";

/** Dagsposter läggs mitt på dagen (UTC) så att datumet blir rätt i Stockholm. */
function endOfDay(date: string): string {
  return `${date.slice(0, 10)}T12:00:00.000Z`;
}

function quoteEntries(job: Job, quote: Quote): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  const href = `/ekonomi/offerter/${quote.id}`;
  out.push({
    id: `quote-created-${quote.id}`,
    at: quote.createdAt,
    category: "kund",
    title: `Offert #${quote.number} skapades`,
    href,
    icon: "offert",
  });
  if (quote.sentAt) {
    out.push({ id: `quote-sent-${quote.id}`, at: quote.sentAt, category: "kund", title: `Offert #${quote.number} skickades till kunden`, href, icon: "offert" });
  }
  if (quote.viewedAt) {
    out.push({ id: `quote-viewed-${quote.id}`, at: quote.viewedAt, category: "kund", title: "Kunden öppnade offerten", href, icon: "kund", byCustomer: true });
  }
  if (quote.decidedAt && quote.status === "godkand") {
    const acc = quoteAcceptance(quote.id);
    out.push({
      id: `quote-approved-${quote.id}`,
      at: acc?.acceptedAt ?? quote.decidedAt,
      category: "kund",
      title: `Kunden godkände offert #${quote.number}`,
      detail: acc ? `Godkänd av ${acc.acceptedByName}` : undefined,
      href,
      icon: "kund",
      byCustomer: true,
    });
  } else if (quote.decidedAt && quote.status === "avbojd") {
    out.push({ id: `quote-declined-${quote.id}`, at: quote.decidedAt, category: "kund", title: `Kunden avböjde offert #${quote.number}`, href, icon: "kund", byCustomer: true });
  }
  return out;
}

function changeEntries(job: Job, change: JobChange): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  const href = `/uppdrag/${job.id}/andringar/${change.id}`;
  const name = `Ändring ${change.number}${change.version > 1 ? ` (version ${change.version})` : ""}`;
  out.push({ id: `change-created-${change.id}`, at: change.createdAt, category: "kund", title: `${name} skapades`, detail: change.title, href, icon: "andring" });
  if (change.sentAt) out.push({ id: `change-sent-${change.id}`, at: change.sentAt, category: "kund", title: `${name} skickades till kunden`, detail: change.title, href, icon: "andring" });
  if (change.viewedAt) out.push({ id: `change-viewed-${change.id}`, at: change.viewedAt, category: "kund", title: `Kunden öppnade ${name.toLowerCase()}`, href, icon: "kund", byCustomer: true });
  if (change.status === "godkand" && change.approval) {
    out.push({
      id: `change-approved-${change.id}`,
      at: change.approval.approvedAt,
      category: "kund",
      title: `Kunden godkände ${name.toLowerCase()}`,
      detail: `${change.title} · godkänd av ${change.approval.approvedByName}`,
      href,
      icon: "kund",
      byCustomer: true,
    });
  } else if (change.status === "avbojd" && change.decidedAt) {
    out.push({ id: `change-declined-${change.id}`, at: change.decidedAt, category: "kund", title: `Kunden avböjde ${name.toLowerCase()}`, detail: change.title, href, icon: "kund", byCustomer: true });
  }
  return out;
}

function workEntries(job: Job, entries: JobWorkEntry[]): TimelineEntry[] {
  const byDay = new Map<string, JobWorkEntry[]>();
  for (const e of entries) {
    const day = e.date.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), e]);
  }
  const out: TimelineEntry[] = [];
  for (const [day, list] of byDay) {
    const hours = list.filter((e) => e.type === "labor").reduce((s, e) => s + e.qty, 0);
    const materials = list.filter((e) => e.type === "material");
    const others = list.filter((e) => e.type !== "labor" && e.type !== "material");
    const parts: string[] = [];
    if (hours > 0) parts.push(`${hours.toLocaleString("sv-SE")} tim arbete`);
    if (materials.length > 0) parts.push(materials.length === 1 ? "material" : `${materials.length} materialposter`);
    if (others.length > 0) parts.push(others.length === 1 ? "en övrig post" : `${others.length} övriga poster`);
    const descriptions = Array.from(new Set(list.map((e) => e.description.trim()).filter(Boolean)));
    out.push({
      id: `work-${job.id}-${day}`,
      at: endOfDay(day),
      category: "arbete",
      title: `Registrerat: ${parts.join(", ")}`,
      detail: descriptions.slice(0, 3).join(" · ") + (descriptions.length > 3 ? ` · +${descriptions.length - 3}` : ""),
      href: `/uppdrag/${job.id}#arbete`,
      icon: hours > 0 ? "tid" : "material",
      dayOnly: true,
    });
  }
  return out;
}

function photoEntries(job: Job): TimelineEntry[] {
  const byDay = new Map<string, number>();
  for (const p of job.photos ?? []) {
    const day = p.createdAt.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return Array.from(byDay, ([day, n]) => ({
    id: `photos-${job.id}-${day}`,
    at: endOfDay(day),
    category: "arbete" as const,
    title: n === 1 ? "Ett foto lades till" : `${n} foton lades till`,
    href: `/uppdrag/${job.id}#foton`,
    icon: "foto" as const,
    dayOnly: true,
  }));
}

function invoiceLabel(inv: Invoice): string {
  if (inv.type === "kredit") return inv.number != null ? `Kreditfaktura #${inv.number}` : "Kreditutkast";
  return inv.number != null ? `Faktura #${inv.number}` : "Fakturautkast";
}

function invoiceEntries(job: Job, invoices: Invoice[], draftEventInvoiceIds: Set<string>): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const inv of invoices) {
    const href = `/ekonomi/fakturor/${inv.id}`;
    const amount = kr(invoiceTotals(inv).toPay);
    const isCredit = inv.type === "kredit";
    if (!draftEventInvoiceIds.has(inv.id) && !isCredit) {
      out.push({
        id: `inv-created-${inv.id}`,
        at: inv.createdAt,
        category: "ekonomi",
        title: inv.number == null ? `Fakturautkast skapades (${amount})` : `${invoiceLabel(inv)} förbereddes`,
        href,
        icon: "faktura",
      });
    }
    if (inv.issuedAt) {
      out.push({
        id: `inv-issued-${inv.id}`,
        at: inv.issuedAt,
        category: "ekonomi",
        title: isCredit ? `${invoiceLabel(inv)} utfärdades (${amount})` : `${invoiceLabel(inv)} utfärdades (${amount})`,
        detail: inv.type === "delbetalning" ? "Delfaktura enligt betalplan" : inv.type === "slutfaktura" ? "Slutfaktura" : undefined,
        href,
        icon: isCredit ? "kredit" : "faktura",
      });
    }
    if (inv.sentAt && !isCredit) {
      out.push({ id: `inv-sent-${inv.id}`, at: inv.sentAt, category: "kund", title: `${invoiceLabel(inv)} skickades till kunden`, href, icon: "faktura" });
    }
    for (const p of db().payments.filter((p) => p.invoiceId === inv.id)) {
      out.push({
        id: `pay-${p.id}`,
        at: p.date.length > 10 ? p.date : endOfDay(p.date),
        category: "ekonomi",
        title: `Betalning mottagen: ${kr(p.amount)}`,
        detail: inv.number != null ? `Avser faktura #${inv.number}` : undefined,
        href,
        icon: "betalning",
        dayOnly: p.date.length <= 10,
      });
    }
  }
  return out;
}

function closeoutEntries(job: Job): { entries: TimelineEntry[]; draftInvoiceIds: Set<string> } {
  const entries: TimelineEntry[] = [];
  const draftInvoiceIds = new Set<string>();
  for (const ev of job.closeout?.events ?? []) {
    const href = ev.entity?.type === "faktura" ? `/ekonomi/fakturor/${ev.entity.id}` : ev.entity?.type === "andring" ? `/uppdrag/${job.id}/andringar/${ev.entity.id}` : undefined;
    if (ev.kind === "fakturautkast_skapat" && ev.entity?.type === "faktura") draftInvoiceIds.add(ev.entity.id);
    const category: TimelineCategory =
      ev.kind === "kundvy_delad" || ev.kind === "kundvy_stangd" || ev.kind === "slutunderlag_skapat"
        ? "kund"
        : ev.kind === "avslutat" || ev.kind === "oppnat_igen" || ev.kind === "dagsrapport"
          ? "arbete"
          : "ekonomi";
    const icon: TimelineIcon =
      ev.kind === "avslutat" || ev.kind === "oppnat_igen"
        ? "flagga"
        : ev.kind === "dagsrapport"
          ? "rapport"
          : ev.kind === "kundvy_delad" || ev.kind === "kundvy_stangd" || ev.kind === "slutunderlag_skapat"
            ? "delning"
            : ev.kind === "fakturautkast_skapat"
              ? "faktura"
              : "beslut";
    entries.push({ id: `closeout-${ev.id}`, at: ev.at, category, title: ev.text, href, icon });
  }
  return { entries, draftInvoiceIds };
}

export function jobTimeline(jobId: string, now: Date = new Date()): TimelineEntry[] {
  const job = getJob(jobId);
  if (!job) return [];
  const quote = jobQuote(job);
  const out: TimelineEntry[] = [];

  const source = jobSourceLabel(job.source);
  out.push({
    id: `job-created-${job.id}`,
    at: job.createdAt,
    category: "kund",
    title: job.originalMessage?.trim() ? "Förfrågan kom in från kunden" : "Uppdraget skapades",
    detail: source,
    icon: job.originalMessage?.trim() ? "forfragan" : "start",
  });
  if (job.startDate && new Date(job.startDate).getTime() <= now.getTime()) {
    out.push({ id: `job-start-${job.id}`, at: job.startDate, category: "arbete", title: "Arbetet startade", icon: "start" });
  }
  // Legacy-avslut (utan flödet): completedAt utan händelse i closeout.
  if (job.completedAt && !(job.closeout?.events ?? []).some((e) => e.kind === "avslutat")) {
    out.push({ id: `job-completed-${job.id}`, at: job.completedAt, category: "arbete", title: "Uppdraget markerades som klart", icon: "flagga" });
  }

  if (quote) out.push(...quoteEntries(job, quote));
  for (const change of jobChangesForJob(job.id)) out.push(...changeEntries(job, change));
  out.push(...workEntries(job, actualEntries(job.id)));
  out.push(...photoEntries(job));
  const closeout = closeoutEntries(job);
  out.push(...closeout.entries);
  out.push(...invoiceEntries(job, invoicesForJobOrQuote(job.id, quote?.id), closeout.draftInvoiceIds));

  const nowMs = now.getTime();
  return out
    .filter((e) => new Date(e.at).getTime() <= nowMs + 24 * 3600 * 1000)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1));
}
