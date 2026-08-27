import { db } from "../store";
import type {
  BankIDSignature,
  Customer,
  CustomerRequest,
  Invoice,
  Job,
  Quote,
  QuoteVersion,
} from "../types";
import { docTotals, type DocTotals } from "../calc";
import { dagarSedan, dagarTill } from "../format";

/* Små, väl använda uppslag och joins. */

export function getCustomer(id: string): Customer | undefined {
  return db().customers.find((c) => c.id === id);
}

export function requireCustomer(id: string): Customer {
  const c = getCustomer(id);
  if (!c) throw new Error(`Kunden ${id} finns inte`);
  return c;
}

export function getQuote(id: string): Quote | undefined {
  return db().quotes.find((q) => q.id === id);
}

export function getQuoteByToken(token: string): Quote | undefined {
  return db().quotes.find((q) => q.token === token);
}

export function currentVersion(quote: Quote): QuoteVersion {
  const v = db().quoteVersions.find((v) => v.id === quote.currentVersionId);
  if (!v) throw new Error(`Offertversion saknas för ${quote.id}`);
  return v;
}

export function quoteVersions(quoteId: string): QuoteVersion[] {
  return db()
    .quoteVersions.filter((v) => v.quoteId === quoteId)
    .sort((a, b) => b.version - a.version);
}

export function quoteTotals(quote: Quote): DocTotals {
  const v = currentVersion(quote);
  return docTotals(v.lines, v.rot);
}

export function quoteSignature(quoteId: string): BankIDSignature | undefined {
  return db().signatures.find((s) => s.quoteId === quoteId);
}

export function getJob(id: string): Job | undefined {
  return db().jobs.find((j) => j.id === id);
}

export function getInvoice(id: string): Invoice | undefined {
  return db().invoices.find((i) => i.id === id);
}

export function getInvoiceByToken(token: string): Invoice | undefined {
  return db().invoices.find((i) => i.token === token);
}

export function invoiceTotals(inv: Invoice): DocTotals {
  return docTotals(inv.lines, inv.rot);
}

export function isOverdue(inv: Invoice): boolean {
  return inv.status === "skickad" && dagarTill(inv.dueDate) < 0;
}

export function daysOverdue(inv: Invoice): number {
  return -dagarTill(inv.dueDate);
}

export function getRequest(id: string): CustomerRequest | undefined {
  return db().requests.find((r) => r.id === id);
}

/** Status-etikett för offerter – speglar flödet Utkast → Skickad → Väntar på BankID → Godkänd/Avböjd. */
export function quoteStatusLabel(quote: Quote): string {
  switch (quote.status) {
    case "utkast":
      return "Utkast";
    case "skickad":
      return "Väntar på BankID";
    case "godkand":
      return "Godkänd med BankID";
    case "avbojd":
      return "Avböjd";
    case "utgangen":
      return "Utgången";
  }
}

export function quoteWaitingDays(quote: Quote): number {
  return quote.sentAt ? dagarSedan(quote.sentAt) : 0;
}

/** Allt som hör till en kund, för kundsidan. */
export function customerBundle(customerId: string) {
  const data = db();
  return {
    requests: data.requests
      .filter((r) => r.customerId === customerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    quotes: data.quotes
      .filter((q) => q.customerId === customerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    jobs: data.jobs
      .filter((j) => j.customerId === customerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    invoices: data.invoices
      .filter((i) => i.customerId === customerId)
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate)),
    activity: data.activity
      .filter((a) => a.customerId === customerId)
      .sort((a, b) => b.at.localeCompare(a.at)),
  };
}

/** Summerad bild per kund till kundlistan. */
export function customerSummary(customerId: string) {
  const b = customerBundle(customerId);
  const openQuotes = b.quotes.filter((q) => q.status === "skickad").length;
  const activeJobs = b.jobs.filter((j) => j.status !== "klart").length;
  const unpaid = b.invoices
    .filter((i) => i.status === "skickad")
    .reduce((s, i) => s + invoiceTotals(i).toPay, 0);
  const newRequests = b.requests.filter((r) => r.status === "ny").length;
  return { openQuotes, activeJobs, unpaid, newRequests };
}
