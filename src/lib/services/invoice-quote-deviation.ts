import { db } from "../store";
import { uid } from "../ids";
import { docTotals, lineTotal, lineVat } from "../calc";
import type { DocLine, Invoice, Quote, QuoteVersion } from "../types";
import { currentVersion, getInvoice, getJob, getQuote, invoiceTotals, quoteAcceptance, quoteVersions } from "./data";
import { QUOTE_EXCESS_WARN_AMOUNT, QUOTE_EXCESS_WARN_PERCENT } from "../quote-excess";

export { QUOTE_EXCESS_WARN_AMOUNT, QUOTE_EXCESS_WARN_PERCENT };

export interface QuoteDeviationLine {
  description: string;
  amount: number;
}

export type QuoteBaselineKind = "delbetalning" | "resterande" | "offert";

/**
 * Jämförelse mellan en faktura och den offert kunden godkänt.
 *
 * Val: den här fakturans `toPay` mot motsvarande offertunderlag –
 * delbetalningens andel i betalningsplanen, annars resterande att fakturera
 * (offertens toPay minus övriga icke-krediterade fakturor), annars hela offerten.
 * Offert och QuoteVersion muteras aldrig.
 */
export interface QuoteDeviation {
  quoteId: string;
  quoteNumber: number;
  baselineKind: QuoteBaselineKind;
  baselineLabel: string;
  approvedAmount: number;
  invoicedAmount: number;
  delta: number;
  addedLines: QuoteDeviationLine[];
  rotChanged: boolean;
  largeExcess: boolean;
  tillaggHref: string;
}

export interface TillaggQuotePrefill {
  customerId: string;
  title: string;
  /** Ren text till offertens beskrivning – görs om till rik text i editorn. */
  description: string;
  lines: DocLine[];
  note: string;
  quoteNumber: number;
}

function lineInclVat(line: DocLine): number {
  return lineTotal(line) + lineVat(line);
}

function normalizeDesc(s: string): string {
  return s.trim().toLowerCase();
}

/** Samlingsrader från del-/slutfaktura – inte jämförbara med offertrader. */
function isBundleLine(line: DocLine): boolean {
  const d = normalizeDesc(line.description);
  return d.startsWith("delbetalning") || d.startsWith("slutfaktura");
}

function signedQuoteVersion(quote: Quote): QuoteVersion {
  const acceptance = quoteAcceptance(quote.id);
  if (acceptance) {
    const accepted = quoteVersions(quote.id).find((v) => v.id === acceptance.quoteVersionId);
    if (accepted) return accepted;
  }
  const locked = quoteVersions(quote.id).find((v) => v.lockedAt);
  return locked ?? currentVersion(quote);
}

function matchPaymentPlanPart(invoice: Invoice, version: QuoteVersion) {
  const plan = version.paymentPlan;
  if (plan.length === 0) return undefined;

  const desc = invoice.lines[0]?.description ?? "";
  const numbered = desc.match(/delbetalning\s+(\d+)\s+av\s+(\d+)/i);
  if (numbered) {
    const idx = Number(numbered[1]) - 1;
    if (plan[idx]) return plan[idx];
  }

  const parts = db()
    .invoices.filter((i) => i.quoteId === invoice.quoteId && i.type === "delbetalning" && i.status !== "krediterad")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const idx = parts.findIndex((i) => i.id === invoice.id);
  if (idx >= 0 && plan[idx]) return plan[idx];
  return undefined;
}

function relatedInvoices(invoice: Invoice, quote: Quote): Invoice[] {
  return db().invoices.filter(
    (i) =>
      i.id !== invoice.id &&
      i.status !== "krediterad" &&
      i.type !== "kredit" &&
      (i.quoteId === quote.id || (!!invoice.jobId && i.jobId === invoice.jobId))
  );
}

function expectedAmount(invoice: Invoice, quote: Quote, version: QuoteVersion): { amount: number; kind: QuoteBaselineKind; label: string } {
  const quoteTotals = docTotals(version.lines, version.rot);
  const quoteToPay = quoteTotals.toPay;

  if (invoice.type === "delbetalning") {
    const part = matchPaymentPlanPart(invoice, version);
    if (part) {
      const amount = Math.round((quoteTotals.total * part.percent) / 100);
      return {
        amount,
        kind: "delbetalning",
        label: `${part.percent} % · ${part.label.toLowerCase()}`,
      };
    }
  }

  const others = relatedInvoices(invoice, quote).reduce((s, i) => s + invoiceTotals(i).toPay, 0);
  if (others > 0) {
    return {
      amount: Math.max(0, quoteToPay - others),
      kind: "resterande",
      label: "resterande enligt offerten",
    };
  }

  return { amount: quoteToPay, kind: "offert", label: "hela den godkända offerten" };
}

function isLargeExcess(delta: number, approvedAmount: number): boolean {
  if (delta <= 0) return false;
  const percentLimit = approvedAmount > 0 ? Math.round((approvedAmount * QUOTE_EXCESS_WARN_PERCENT) / 100) : Number.POSITIVE_INFINITY;
  return delta >= QUOTE_EXCESS_WARN_AMOUNT || delta >= percentLimit;
}

function deltaAsLine(source: DocLine, deltaIncl: number): DocLine {
  const vatFactor = 1 + source.vatRate / 100;
  return {
    id: uid(),
    kind: source.kind,
    description: source.description,
    qty: 1,
    unit: "st",
    unitPrice: Math.round(deltaIncl / vatFactor),
    vatRate: source.vatRate,
  };
}

function lineDiffs(invoice: Invoice, version: QuoteVersion): { addedLines: QuoteDeviationLine[]; tillaggLines: DocLine[] } {
  const addedLines: QuoteDeviationLine[] = [];
  const tillaggLines: DocLine[] = [];
  const quoteLines = version.lines.filter((l) => !isBundleLine(l));
  const used = new Set<string>();

  for (const invLine of invoice.lines) {
    if (isBundleLine(invLine)) continue;
    const match = quoteLines.find(
      (q) => !used.has(q.id) && q.kind === invLine.kind && normalizeDesc(q.description) === normalizeDesc(invLine.description)
    );
    if (match) {
      used.add(match.id);
      const d = lineInclVat(invLine) - lineInclVat(match);
      if (d > 0) {
        addedLines.push({ description: invLine.description, amount: d });
        tillaggLines.push(deltaAsLine(invLine, d));
      }
    } else {
      const amount = lineInclVat(invLine);
      if (amount !== 0) {
        addedLines.push({ description: invLine.description, amount });
        tillaggLines.push({ ...invLine, id: uid() });
      }
    }
  }

  return { addedLines, tillaggLines };
}

function tillaggHrefFor(invoice: Invoice): string {
  const params = new URLSearchParams({ kund: invoice.customerId, tillaggFran: invoice.id });
  return `/ekonomi/offerter/ny?${params.toString()}`;
}

export function invoiceQuoteDeviation(invoice: Invoice): QuoteDeviation | null {
  if (!invoice.quoteId) return null;
  const quote = getQuote(invoice.quoteId);
  if (!quote) return null;

  const version = signedQuoteVersion(quote);
  const invoicedAmount = invoiceTotals(invoice).toPay;
  const expected = expectedAmount(invoice, quote, version);
  const delta = invoicedAmount - expected.amount;
  const { addedLines } = lineDiffs(invoice, version);
  const rotChanged = (invoice.rot?.type ?? null) !== (version.rot?.type ?? null);

  if (Math.abs(delta) <= 1 && addedLines.length === 0 && !rotChanged) return null;

  return {
    quoteId: quote.id,
    quoteNumber: quote.number,
    baselineKind: expected.kind,
    baselineLabel: expected.label,
    approvedAmount: expected.amount,
    invoicedAmount,
    delta,
    addedLines,
    rotChanged,
    largeExcess: isLargeExcess(delta, expected.amount),
    tillaggHref: tillaggHrefFor(invoice),
  };
}

export function tillaggQuoteFromInvoice(invoiceId: string): TillaggQuotePrefill | null {
  const invoice = getInvoice(invoiceId);
  if (!invoice?.quoteId) return null;
  const quote = getQuote(invoice.quoteId);
  if (!quote) return null;

  const version = signedQuoteVersion(quote);
  const job = invoice.jobId ? getJob(invoice.jobId) : quote.jobId ? getJob(quote.jobId) : undefined;
  const expected = expectedAmount(invoice, quote, version);
  const invoicedAmount = invoiceTotals(invoice).toPay;
  const delta = invoicedAmount - expected.amount;
  const { addedLines, tillaggLines } = lineDiffs(invoice, version);

  let lines = tillaggLines;
  if (lines.length === 0 && delta > 0) {
    lines = [
      {
        id: uid(),
        kind: "ovrigt",
        description: "Tillägg efter godkänd offert",
        qty: 1,
        unit: "st",
        unitPrice: Math.round(delta / 1.25),
        vatRate: 25,
      },
    ];
  }

  const titleBase = job?.title ?? version.title;
  const extrasNote =
    addedLines.length > 0
      ? addedLines.map((l) => l.description).join(", ")
      : "extra arbete och material som tillkommit under arbetet";

  return {
    customerId: invoice.customerId,
    title: `Tillägg – ${titleBase}`,
    description: `Tillägg till tidigare godkänd offert #${quote.number} (${titleBase}). Avser ${extrasNote}.`,
    lines,
    note: `Förifylld från avvikelsen mot offert #${quote.number}. Kunden behöver godkänna tillägget via offertlänken innan det blir en ny låst referens.`,
    quoteNumber: quote.number,
  };
}
