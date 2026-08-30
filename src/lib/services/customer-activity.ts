import { db } from "../store";
import type { Invoice, Job, Quote } from "../types";
import { countsTowardInvoiced, invoiceTotals, isOpenReceivable, quoteTotals } from "./data";
import { invoiceHref, quoteHref } from "../nav";
import { invoiceNumberLabel } from "../invoices/display";
import type { CustomerActivityRow, CustomerMoneyLine } from "../customer-activity-model";

export type { CustomerActivityKind, CustomerActivityRow, CustomerMoneyLine } from "../customer-activity-model";
export { ACTIVITY_FILTER_MIN } from "../customer-activity-model";

function eventTime(iso: string): string {
  return iso.length <= 10 ? `${iso}T12:00:00.000Z` : iso;
}

function quoteTitle(quote: Quote): string {
  const version = db().quoteVersions.find((v) => v.id === quote.currentVersionId);
  return version?.title ? `Offert #${quote.number} · ${version.title}` : `Offert #${quote.number}`;
}

function quoteStatusLabel(quote: Quote): string {
  switch (quote.status) {
    case "utkast":
      return "Utkast";
    case "skickad":
      return "Väntar på BankID";
    case "godkand":
      return "Godkänd";
    case "avbojd":
      return "Avböjd";
    case "utgangen":
      return "Utgången";
  }
}

function invoiceStatusLabel(invoice: Invoice): string {
  if (invoice.type === "kredit") return "Kreditfaktura";
  if (invoice.status === "utkast") return "Utkast";
  if (invoice.status === "betald") return "Betald";
  if (invoice.status === "krediterad") return "Krediterad";
  return "Skickad";
}

function jobStatusLabel(job: Job): string {
  if (job.status === "klart") return "Klart";
  if (job.status === "pagar") return "Pågår";
  return "Kommande";
}

/** Kronologisk kundaktivitet, nyast först. Byggs från objekten – inte från fritextloggen. */
export function customerActivityFeed(customerId: string): CustomerActivityRow[] {
  const data = db();
  const from = { href: `/kunder/${customerId}` };
  const rows: CustomerActivityRow[] = [];

  for (const q of data.quotes.filter((q) => q.customerId === customerId)) {
    rows.push({
      id: `offert-${q.id}`,
      at: eventTime(q.decidedAt ?? q.sentAt ?? q.createdAt),
      kind: "offert",
      title: quoteTitle(q),
      amount: quoteTotals(q).toPay || undefined,
      statusLabel: quoteStatusLabel(q),
      href: quoteHref(q.id, from),
    });
  }

  for (const inv of data.invoices.filter((i) => i.customerId === customerId)) {
    rows.push({
      id: `faktura-${inv.id}`,
      at: eventTime(inv.issuedAt ?? inv.sentAt ?? inv.createdAt),
      kind: "faktura",
      title: inv.number == null ? "Fakturautkast" : `Faktura ${invoiceNumberLabel(inv)}`,
      amount: invoiceTotals(inv).toPay || undefined,
      statusLabel: invoiceStatusLabel(inv),
      href: invoiceHref(inv.id, from),
    });
  }

  for (const job of data.jobs.filter((j) => j.customerId === customerId)) {
    const quote = job.quoteId ? data.quotes.find((q) => q.id === job.quoteId) : data.quotes.find((q) => q.jobId === job.id);
    const amount = quote ? quoteTotals(quote).toPay : 0;
    rows.push({
      id: `uppdrag-${job.id}`,
      at: eventTime(job.createdAt),
      kind: "uppdrag",
      title: job.title,
      amount: amount || undefined,
      statusLabel: jobStatusLabel(job),
      href: `/uppdrag/${job.id}`,
    });
  }

  const invoiceIds = new Set(data.invoices.filter((i) => i.customerId === customerId).map((i) => i.id));
  for (const p of data.payments) {
    if (!invoiceIds.has(p.invoiceId)) continue;
    const inv = data.invoices.find((i) => i.id === p.invoiceId);
    rows.push({
      id: `betalning-${p.id}`,
      at: eventTime(p.date),
      kind: "betalning",
      title: inv?.number != null ? `Betalning · Faktura #${inv.number}` : "Betalning",
      amount: p.amount,
      statusLabel: "Matchad",
      href: inv ? invoiceHref(inv.id, from) : `/kunder/${customerId}`,
    });
  }

  rows.sort((a, b) => b.at.localeCompare(a.at) || a.title.localeCompare(b.title, "sv"));
  return rows;
}

/**
 * Avtalat = godkända offerter. Fakturerat/obetalt använder samma regler som
 * `countsTowardInvoiced` / `isOpenReceivable` – ingen parallell formel.
 */
export function customerMoneyLine(customerId: string): CustomerMoneyLine | null {
  const data = db();
  const quotes = data.quotes.filter((q) => q.customerId === customerId);
  const invoices = data.invoices.filter((i) => i.customerId === customerId);
  if (quotes.length === 0 && invoices.length === 0) return null;

  const avtalat = quotes
    .filter((q) => q.status === "godkand")
    .reduce((s, q) => s + quoteTotals(q).toPay, 0);
  const fakturerat = invoices.filter(countsTowardInvoiced).reduce((s, i) => s + invoiceTotals(i).total, 0);
  const obetalt = invoices.filter(isOpenReceivable).reduce((s, i) => s + invoiceTotals(i).toPay, 0);
  if (avtalat === 0 && fakturerat === 0 && obetalt === 0) return null;
  return { avtalat, fakturerat, obetalt };
}
