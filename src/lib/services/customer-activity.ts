import { db } from "../store";
import { countsTowardInvoiced, invoiceTotals, isOpenReceivable, quoteTotals } from "./data";
import { invoiceHref, jobHref, quoteHref } from "../nav";
import { invoiceNumberLabel } from "../invoices/display";
import type { CustomerActivityKind, CustomerActivityRow, CustomerMoneyLine } from "../customer-activity-model";
import { customerActivityClusters, customerActivityMembers } from "./business-chain";

export type { CustomerActivityKind, CustomerActivityRow, CustomerMoneyLine } from "../customer-activity-model";
export { ACTIVITY_FILTER_MIN } from "../customer-activity-model";

function eventTime(iso: string): string {
  return iso.length <= 10 ? `${iso}T12:00:00.000Z` : iso;
}

function quoteTitle(number: number, title?: string): string {
  return title ? `Offert #${number} · ${title}` : `Offert #${number}`;
}

/**
 * Kronologisk kundaktivitet, nyast först.
 * Relaterade objekt (samma quoteId/jobId) blir EN kedja – inte tre lösa rader.
 * Fristående fakturor utan länk förblir egna rader. Länkar gissas aldrig.
 */
export function customerActivityFeed(customerId: string): CustomerActivityRow[] {
  const data = db();
  const from = { href: `/kunder/${customerId}`, label: "Kund" };
  const rows: CustomerActivityRow[] = [];

  for (const cluster of customerActivityClusters(customerId)) {
    const members = customerActivityMembers(cluster, customerId);
    const linked = Boolean(cluster.quote || cluster.job) && (cluster.invoices.length > 0 || Boolean(cluster.quote && cluster.job));
    const standaloneInvoice = !cluster.quote && !cluster.job && cluster.invoices.length === 1;
    const onlyQuote = cluster.quote && !cluster.job && cluster.invoices.length === 0;
    const onlyJob = cluster.job && !cluster.quote && cluster.invoices.length === 0;

    if (linked || (cluster.quote && cluster.job) || cluster.invoices.length > 1) {
      const quote = cluster.quote;
      const job = cluster.job;
      const version = quote ? data.quoteVersions.find((v) => v.id === quote.currentVersionId) : undefined;
      const title = job
        ? quote
          ? `${job.title} · Offert #${quote.number}`
          : job.title
        : quote
          ? quoteTitle(quote.number, version?.title)
          : members[0]?.title ?? "Kedja";
      const latestInv = [...cluster.invoices].sort((a, b) =>
        eventTime(b.issuedAt ?? b.sentAt ?? b.createdAt).localeCompare(eventTime(a.issuedAt ?? a.sentAt ?? a.createdAt))
      )[0];
      const at = eventTime(
        latestInv?.issuedAt ??
          latestInv?.sentAt ??
          latestInv?.createdAt ??
          job?.createdAt ??
          quote?.decidedAt ??
          quote?.sentAt ??
          quote?.createdAt ??
          cluster.payments[0]?.date ??
          new Date().toISOString()
      );
      const statusParts = members
        .filter((m) => m.kind !== "betalning")
        .map((m) => m.statusLabel);
      const href = job
        ? jobHref(job.id, from)
        : quote
          ? quoteHref(quote.id, from)
          : latestInv
            ? invoiceHref(latestInv.id, from)
            : `/kunder/${customerId}`;
      const amount = quote
        ? quoteTotals(quote).toPay || undefined
        : latestInv
          ? invoiceTotals(latestInv).toPay || undefined
          : undefined;
      const kinds = [...new Set(members.map((m) => m.kind))];
      rows.push({
        id: `kedja-${job?.id ?? quote?.id ?? latestInv?.id ?? members[0]?.title}`,
        at,
        kind: job ? "uppdrag" : quote ? "offert" : "faktura",
        kinds,
        title,
        subtitle: members.map((m) => m.title).join(" · "),
        amount,
        statusLabel: statusParts.join(" · ") || members[0]?.statusLabel || "",
        href,
        members,
      });
      continue;
    }

    if (onlyQuote && cluster.quote) {
      const q = cluster.quote;
      const version = data.quoteVersions.find((v) => v.id === q.currentVersionId);
      rows.push({
        id: `offert-${q.id}`,
        at: eventTime(q.decidedAt ?? q.sentAt ?? q.createdAt),
        kind: "offert",
        kinds: ["offert"],
        title: quoteTitle(q.number, version?.title),
        amount: quoteTotals(q).toPay || undefined,
        statusLabel: members[0]?.statusLabel ?? "",
        href: quoteHref(q.id, from),
        members,
      });
      continue;
    }

    if (onlyJob && cluster.job) {
      const job = cluster.job;
      rows.push({
        id: `uppdrag-${job.id}`,
        at: eventTime(job.createdAt),
        kind: "uppdrag",
        kinds: ["uppdrag"],
        title: job.title,
        statusLabel: members[0]?.statusLabel ?? "",
        href: jobHref(job.id, from),
        members,
      });
      continue;
    }

    if (standaloneInvoice) {
      const inv = cluster.invoices[0];
      const pay = cluster.payments[0];
      const kinds: CustomerActivityKind[] = ["faktura"];
      if (pay) kinds.push("betalning");
      rows.push({
        id: `faktura-${inv.id}`,
        at: eventTime(inv.issuedAt ?? inv.sentAt ?? inv.createdAt),
        kind: "faktura",
        kinds,
        title: inv.number == null ? "Fakturautkast" : `Faktura ${invoiceNumberLabel(inv)}`,
        amount: invoiceTotals(inv).toPay || undefined,
        statusLabel: members.find((m) => m.kind === "faktura")?.statusLabel ?? "",
        href: invoiceHref(inv.id, from),
        members,
      });
    }
  }

  rows.sort((a, b) => b.at.localeCompare(a.at) || a.title.localeCompare(b.title, "sv"));
  return rows;
}

/**
 * Avtalat = godkända offerter (inte uppdrag – samma affär räknas en gång).
 * Fakturerat/obetalt = fakturor. Fristående fakturor ingår i fakturerat, inte avtalat.
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
