import { db } from "../store";
import type {
  BankIDSignature,
  Customer,
  Invoice,
  Job,
  Quote,
  QuoteVersion,
} from "../types";
import { docTotals, type DocTotals } from "../calc";
import { dagarSedan, dagarTill } from "../format";

/* Små, väl använda uppslag och joins. */

/*
 * Kundindex: id → objekt. Kundobjekt muteras på plats (fälten uppdateras) men
 * id:t ändras aldrig, så mappen förblir korrekt; nya kunder läggs alltid till
 * med push → längdkontrollen invaliderar. Gör kunduppslag O(1) i stället för
 * O(kunder) – actionmotorn och listorna slår upp kunder per rad.
 */
const customerIndexCache = new WeakMap<object, { len: number; byId: Map<string, Customer> }>();

function customersById(): Map<string, Customer> {
  const customers = db().customers;
  let cached = customerIndexCache.get(customers);
  if (!cached || cached.len !== customers.length) {
    cached = { len: customers.length, byId: new Map(customers.map((c) => [c.id, c])) };
    customerIndexCache.set(customers, cached);
  }
  return cached.byId;
}

export function getCustomer(id: string): Customer | undefined {
  return customersById().get(id);
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

/** Offerten kopplad till ett uppdrag – via job.quoteId eller quote.jobId. */
export function jobQuote(job: Job): Quote | undefined {
  const data = db();
  if (job.quoteId) {
    const q = data.quotes.find((q) => q.id === job.quoteId);
    if (q) return q;
  }
  return data.quotes.find((q) => q.jobId === job.id);
}

export function getInvoice(id: string): Invoice | undefined {
  return db().invoices.find((i) => i.id === id);
}

export function getInvoiceByToken(token: string): Invoice | undefined {
  return db().invoices.find((i) => i.token === token);
}

export function invoiceTotals(inv: Invoice): DocTotals {
  if (inv.status !== "utkast" && inv.issuedSnapshot) {
    return docTotals(inv.issuedSnapshot.lines, inv.issuedSnapshot.rot);
  }
  return docTotals(inv.lines, inv.rot);
}

/**
 * Öppen kundfordran: utfärdad och inte fullbetald. Kreditfakturor är inte
 * fordringar – de får aldrig räknas som obetalda, bli försenade eller matchas
 * mot inbetalningar. "delbetald" är fortfarande en öppen fordran (restbeloppet).
 */
export function isOpenReceivable(inv: Invoice): boolean {
  return (inv.status === "skickad" || inv.status === "delbetald") && inv.type !== "kredit";
}

/**
 * Räknas mot fakturerat belopp (kvar att fakturera, fakturerat på uppdrag/offert).
 * Krediterade original och deras kreditfakturor tar ut varandra och utesluts båda.
 * Delkrediter hanteras via invoicedTotalContribution (negativt bidrag).
 */
export function countsTowardInvoiced(inv: Invoice): boolean {
  return inv.status !== "krediterad" && inv.type !== "kredit";
}

/* ------------------------- Betalningar och krediter ------------------------- */
/* EN härledning av betalt/krediterat/utestående – används av fakturasidor,   */
/* uppdragsekonomi, actionmotorn och matchningsmotorn. Aldrig egna varianter. */

/*
 * Prestanda: betalningar och kreditfakturor är append-only (rader läggs till,
 * ändras aldrig i efterhand – belopp/koppling är oföränderliga per rad).
 * Indexen nedan cachas per arrayinstans + längd: en ny laddning (ny array)
 * eller en push invaliderar automatiskt. Gör utestående-beräkningen O(1)
 * per faktura i stället för O(betalningar) – actionmotorn och listorna går
 * från kvadratiskt till linjärt vid stora dataset.
 */
const paidSumsCache = new WeakMap<object, { len: number; sums: Map<string, number> }>();
const creditsCache = new WeakMap<object, { len: number; byOriginal: Map<string, Invoice[]> }>();

function reversedPaymentIds(): Set<string> {
  const ids = new Set<string>();
  for (const v of db().verifications) {
    const src = v.source;
    if (src.type === "betalning" && v.correctedByVerificationId) ids.add(src.id);
  }
  return ids;
}

function paidSums(): Map<string, number> {
  const payments = db().payments;
  const vers = db().verifications;
  const reversed = reversedPaymentIds();
  const corrN = reversed.size;
  let cached = paidSumsCache.get(payments);
  // Rättelsestämpel på en betalningsverifikation ändrar inte payments.length –
  // cachen måste också se verifikationerna.
  const verLen = vers.length;
  if (!cached || cached.len !== payments.length + verLen * 1_000 + corrN) {
    const sums = new Map<string, number>();
    for (const p of payments) {
      if (reversed.has(p.id)) continue;
      sums.set(p.invoiceId, (sums.get(p.invoiceId) ?? 0) + p.amount);
    }
    cached = { len: payments.length + verLen * 1_000 + corrN, sums };
    paidSumsCache.set(payments, cached);
  }
  return cached.sums;
}

function creditsByOriginal(): Map<string, Invoice[]> {
  const invoices = db().invoices;
  let cached = creditsCache.get(invoices);
  if (!cached || cached.len !== invoices.length) {
    const byOriginal = new Map<string, Invoice[]>();
    for (const c of invoices) {
      if (c.type !== "kredit" || !c.creditsInvoiceId) continue;
      const list = byOriginal.get(c.creditsInvoiceId);
      if (list) list.push(c);
      else byOriginal.set(c.creditsInvoiceId, [c]);
    }
    cached = { len: invoices.length, byOriginal };
    creditsCache.set(invoices, cached);
  }
  return cached.byOriginal;
}

/** Summa registrerade inbetalningar för fakturan (faktiska bankbelopp). */
export function invoicePaidAmount(invoiceId: string): number {
  return paidSums().get(invoiceId) ?? 0;
}

/** Kreditfakturor som refererar fakturan. */
export function creditsOfInvoice(invoiceId: string): Invoice[] {
  return creditsByOriginal().get(invoiceId) ?? [];
}

/**
 * Summa krediterat att-betala mot fakturan (delkrediter). Fullkrediterade
 * original har status "krediterad" och är inga fordringar alls.
 */
export function invoiceCreditedAmount(invoiceId: string): number {
  return creditsOfInvoice(invoiceId).reduce((s, c) => s + invoiceTotals(c).toPay, 0);
}

/**
 * Utestående fordran i kronor: att-betala minus inbetalningar minus
 * delkrediter. 0 för allt som inte är en öppen fordran. Aldrig negativt –
 * överbetalningar bokas som skuld (2420) och syns som exception, inte här.
 */
export function invoiceOutstanding(inv: Invoice): number {
  if (!isOpenReceivable(inv)) return 0;
  const t = invoiceTotals(inv);
  return Math.max(0, t.toPay - invoicePaidAmount(inv.id) - invoiceCreditedAmount(inv.id));
}

/**
 * Fakturans bidrag till "fakturerat" (total inkl. moms) för uppdrag/offert:
 * original räknas positivt, delkrediter negativt, fullkrediterade par tar ut
 * varandra (båda 0). Utkast räknas med så att "kvar att fakturera" inte
 * föreslår dubbelfakturering medan ett utkast ligger öppet.
 */
export function invoicedTotalContribution(inv: Invoice): number {
  if (inv.status === "krediterad") return 0;
  if (inv.type === "kredit") {
    const original = inv.creditsInvoiceId ? getInvoice(inv.creditsInvoiceId) : undefined;
    // Fullkredit: originalet är "krediterad" och redan exkluderat – krediten också.
    if (!original || original.status === "krediterad") return 0;
    return -invoiceTotals(inv).total;
  }
  return invoiceTotals(inv).total;
}

export function isOverdue(inv: Invoice): boolean {
  return isOpenReceivable(inv) && dagarTill(inv.dueDate) < 0;
}

export function daysOverdue(inv: Invoice): number {
  return -dagarTill(inv.dueDate);
}

/**
 * Effektiv offertstatus: en skickad offert vars giltighetsdatum passerat är
 * utgången (kan inte signeras) – lagret sätter aldrig "utgangen" explicit.
 */
export function effectiveQuoteStatus(quote: Quote): Quote["status"] {
  if (quote.status === "skickad" && dagarTill(currentVersion(quote).validUntil) < 0) return "utgangen";
  return quote.status;
}

/** Status-etikett för offerter – speglar flödet Utkast → Skickad → Väntar på BankID → Godkänd/Avböjd. */
export function quoteStatusLabel(quote: Quote): string {
  switch (effectiveQuoteStatus(quote)) {
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
  const unpaid = b.invoices.reduce((s, i) => s + invoiceOutstanding(i), 0);
  return { openQuotes, activeJobs, unpaid };
}
