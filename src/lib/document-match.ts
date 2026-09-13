/**
 * Dokumentmatchning: Beställning → orderbekräftelse → leverantörsfaktura/kvitto.
 *
 * Exakt och säkert matchade dokument länkas automatiskt. Vid osäkerhet
 * får användaren frågan. Tenant löses aldrig här – anroparen är redan
 * inne i rätt företag.
 *
 * Signaler i prioritetsordning: 1 Ferva-referens, 2 grossistens ordernummer,
 * 3 kundnummer, 4 artikelnummer + antal, 5 leverantör, 6 datum, 7 totalbelopp,
 * 8 uppdrag, 9 avsändardomän.
 */
import type { PurchaseOrder, PurchaseOrderLine } from "./types";
import { normalizeFervaRef } from "./ferva-reference";
import { normalizeIdentifier, normalizeText } from "./wholesalers/catalog-search";

export type DocumentMatchKind = "exact" | "uncertain" | "none";

export interface DocumentMatchSignal {
  name:
    | "ferva_ref"
    | "order_number"
    | "customer_number"
    | "articles"
    | "supplier"
    | "date"
    | "amount"
    | "job"
    | "sender_domain";
  weight: number;
}

export interface DocumentMatchCandidate {
  purchaseOrderId: string;
  reference: string;
  jobId: string;
  score: number;
  signals: DocumentMatchSignal[];
}

export interface DocumentMatchResult {
  kind: DocumentMatchKind;
  /** Automatisk länk bara när kind === "exact". */
  purchaseOrderId?: string;
  jobId?: string;
  reference?: string;
  question?: string;
  candidates: DocumentMatchCandidate[];
}

export interface DocumentMatchInput {
  fervaRef?: string;
  wholesalerOrderNumber?: string;
  customerNumber?: string;
  supplier?: string;
  date?: string;
  amountKronor?: number;
  jobId?: string;
  senderDomain?: string;
  articles?: Array<{ articleNumber?: string; qty?: number }>;
  orders: Array<
    PurchaseOrder & {
      lines: PurchaseOrderLine[];
      connectionCustomerNumber?: string;
      wholesalerName?: string;
      senderDomains?: string[];
      expectedCostKronor?: number;
    }
  >;
}

const EXACT_THRESHOLD = 80;
const UNCERTAIN_THRESHOLD = 35;

function daysApart(a: string | undefined, b: string | undefined): number | undefined {
  if (!a || !b) return undefined;
  const da = Date.parse(`${a.slice(0, 10)}T12:00:00Z`);
  const db = Date.parse(`${b.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(da) || Number.isNaN(db)) return undefined;
  return Math.abs(da - db) / 86_400_000;
}

function articleOverlap(
  found: Array<{ articleNumber?: string; qty?: number }>,
  lines: PurchaseOrderLine[]
): number {
  if (found.length === 0 || lines.length === 0) return 0;
  let hits = 0;
  for (const a of found) {
    const key = normalizeIdentifier(a.articleNumber);
    if (!key) continue;
    const line = lines.find((l) => normalizeIdentifier(l.articleNumber) === key);
    if (!line) continue;
    if (a.qty == null || Math.abs(a.qty - line.qty) < 1e-6) hits += 1;
  }
  return hits;
}

export function matchPurchaseDocuments(input: DocumentMatchInput): DocumentMatchResult {
  const ref = normalizeFervaRef(input.fervaRef);
  const candidates: DocumentMatchCandidate[] = [];

  for (const order of input.orders) {
    if (order.status === "draft" || order.status === "cancelled") continue;
    const signals: DocumentMatchSignal[] = [];
    let score = 0;

    if (ref && order.reference === ref) {
      signals.push({ name: "ferva_ref", weight: 100 });
      score += 100;
    }
    if (
      input.wholesalerOrderNumber &&
      order.wholesalerOrderNumber &&
      normalizeIdentifier(input.wholesalerOrderNumber) === normalizeIdentifier(order.wholesalerOrderNumber)
    ) {
      signals.push({ name: "order_number", weight: 80 });
      score += 80;
    }
    if (
      input.customerNumber &&
      order.connectionCustomerNumber &&
      normalizeIdentifier(input.customerNumber) === normalizeIdentifier(order.connectionCustomerNumber)
    ) {
      signals.push({ name: "customer_number", weight: 25 });
      score += 25;
    }
    const overlap = articleOverlap(input.articles ?? [], order.lines);
    if (overlap > 0) {
      const weight = Math.min(40, overlap * 15);
      signals.push({ name: "articles", weight });
      score += weight;
    }
    if (input.supplier && order.wholesalerName) {
      const a = normalizeText(input.supplier);
      const b = normalizeText(order.wholesalerName);
      if (a && b && (a.includes(b) || b.includes(a))) {
        signals.push({ name: "supplier", weight: 20 });
        score += 20;
      }
    }
    const days = daysApart(input.date, order.sentAt?.slice(0, 10));
    if (days != null && days <= 14) {
      const weight = days <= 3 ? 15 : 8;
      signals.push({ name: "date", weight });
      score += weight;
    }
    if (input.amountKronor != null && order.expectedCostKronor != null) {
      const delta = Math.abs(input.amountKronor - order.expectedCostKronor);
      if (delta <= 1) {
        signals.push({ name: "amount", weight: 20 });
        score += 20;
      } else if (delta / Math.max(order.expectedCostKronor, 1) <= 0.05) {
        signals.push({ name: "amount", weight: 8 });
        score += 8;
      }
    }
    if (input.jobId && order.jobId === input.jobId) {
      signals.push({ name: "job", weight: 15 });
      score += 15;
    }
    if (input.senderDomain && order.senderDomains?.some((d) => d === input.senderDomain)) {
      signals.push({ name: "sender_domain", weight: 10 });
      score += 10;
    }

    if (score > 0) {
      candidates.push({
        purchaseOrderId: order.id,
        reference: order.reference,
        jobId: order.jobId,
        score,
        signals,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.reference.localeCompare(b.reference, "sv"));
  const top = candidates[0];
  const second = candidates[1];

  if (top && top.score >= EXACT_THRESHOLD && (!second || top.score - second.score >= 20)) {
    const hasSafe = top.signals.some((s) => s.name === "ferva_ref" || s.name === "order_number");
    if (hasSafe) {
      return {
        kind: "exact",
        purchaseOrderId: top.purchaseOrderId,
        jobId: top.jobId,
        reference: top.reference,
        candidates,
      };
    }
  }
  if (top && top.score >= UNCERTAIN_THRESHOLD) {
    return {
      kind: "uncertain",
      purchaseOrderId: top.purchaseOrderId,
      jobId: top.jobId,
      reference: top.reference,
      question: `Fakturan verkar höra ihop med ${top.reference}`,
      candidates,
    };
  }
  return { kind: "none", candidates };
}

export function senderDomainOf(address: string | undefined): string | undefined {
  if (!address) return undefined;
  const at = address.lastIndexOf("@");
  if (at < 0) return undefined;
  const domain = address.slice(at + 1).replace(/>$/, "").trim().toLowerCase();
  return domain || undefined;
}
