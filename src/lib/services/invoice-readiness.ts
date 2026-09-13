/**
 * Redo att fakturera: samlar det som faktiskt kan gå med, och bara
 * blockerare som kräver användaren. Ofärdigt material stannar på uppdraget.
 *
 * Vidarefakturering går via closeout-allokeringen (work_entry). Den här
 * modulen skapar inga egna allokeringar.
 */
import { db } from "../store";
import { getJob } from "./data";
import { actualEntries, isIssuedLinked, uninvoicedActuals, workEntryInvoiceStatus } from "./job-work";
import { linesForSource, documentLines } from "./document-lines";
import { materialPriceWarnings } from "../material-price";
import { priceListIsStale } from "../wholesalers/labels";

export type InvoiceReadinessBlockerKind =
  | "missing_customer_price"
  | "uncertain_line"
  | "price_deviation";

export interface InvoiceReadinessItem {
  kind: InvoiceReadinessBlockerKind | "unfinished_material" | "stale_price_list" | "low_margin";
  text: string;
  blocks: boolean;
}

export interface InvoiceReadiness {
  ready: boolean;
  canInvoiceWithoutUnfinished: boolean;
  blockers: InvoiceReadinessItem[];
  warnings: InvoiceReadinessItem[];
  uninvoicedCount: number;
  unfinishedLineCount: number;
}

export function invoiceReadiness(jobId: string): InvoiceReadiness {
  const job = getJob(jobId);
  if (!job) {
    return {
      ready: false,
      canInvoiceWithoutUnfinished: false,
      blockers: [{ kind: "uncertain_line", text: "Uppdraget finns inte", blocks: true }],
      warnings: [],
      uninvoicedCount: 0,
      unfinishedLineCount: 0,
    };
  }
  const blockers: InvoiceReadinessItem[] = [];
  const warnings: InvoiceReadinessItem[] = [];
  const uninvoiced = uninvoicedActuals(jobId);
  const lines = documentLines().filter((l) => l.allocations.some((a) => a.jobId === jobId));

  for (const line of lines) {
    if (line.disposition !== "customer") continue;
    if (line.status === "confirmed" || line.status === "rejected") continue;
    if (line.raw.unreadable || line.status === "needs_review" || !line.mathOk) {
      blockers.push({
        kind: "uncertain_line",
        text: `Kontrollera raden${line.raw.name ? ` ${line.raw.name}` : ""}`,
        blocks: true,
      });
      continue;
    }
    if (line.customerPriceSource === "missing" || line.customerPrice == null) {
      blockers.push({
        kind: "missing_customer_price",
        text: "Kundpris saknas",
        blocks: true,
      });
    }
  }

  for (const entry of actualEntries(jobId)) {
    if (entry.type !== "material" || !entry.wholesaler) continue;
    const expected = entry.wholesaler.expectedUnitCostOre;
    const actual = entry.wholesaler.unitCostOre;
    if (expected != null && actual != null && Math.abs(expected - actual) > 100) {
      const item: InvoiceReadinessItem = {
        kind: "price_deviation",
        text: "Priset skiljer sig från beställningen",
        blocks: !isIssuedLinked(entry),
      };
      if (item.blocks) blockers.push(item);
      else warnings.push({ ...item, blocks: false });
    }
  }

  const unfinished = lines.filter(
    (l) => l.disposition === "customer" && l.status !== "confirmed" && l.status !== "rejected",
  );
  if (unfinished.length > 0) {
    warnings.push({
      kind: "unfinished_material",
      text:
        unfinished.length === 1
          ? "Ett material är inte klart och ligger kvar på uppdraget"
          : `${unfinished.length} material är inte klara och ligger kvar på uppdraget`,
      blocks: false,
    });
  }

  const data = db();
  for (const conn of data.wholesalerConnections ?? []) {
    const active = (data.wholesalerPriceImports ?? []).find(
      (i) => i.id === conn.activeImportId && i.status === "active",
    );
    if (active && priceListIsStale(active.priceDate)) {
      warnings.push({
        kind: "stale_price_list",
        text: "Priserna kan vara gamla",
        blocks: false,
      });
      break;
    }
  }

  const low = data.settings.lowMaterialMarginPercent;
  for (const entry of uninvoiced.filter((e) => e.type === "material")) {
    const line = entry.documentLineId
      ? documentLines().find((l) => l.id === entry.documentLineId)
      : undefined;
    const cost = line?.unitCost ?? (entry.wholesaler?.unitCostOre != null ? Math.round(entry.wholesaler.unitCostOre / 100) : undefined);
    const warns = materialPriceWarnings({
      customerPriceKronor: entry.unitPrice,
      unitCostKronor: cost,
      lowMarginPercent: low,
    });
    for (const w of warns) {
      if (w.kind === "low_margin" || w.kind === "negative_margin") {
        warnings.push({ kind: "low_margin", text: w.text, blocks: false });
      }
    }
  }

  const uniqueBlockers = dedupe(blockers);
  const uniqueWarnings = dedupe(warnings);
  return {
    ready: uniqueBlockers.length === 0 && uninvoiced.length > 0,
    canInvoiceWithoutUnfinished: uninvoiced.length > 0,
    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
    uninvoicedCount: uninvoiced.length,
    unfinishedLineCount: unfinished.length,
  };
}

function dedupe(items: InvoiceReadinessItem[]): InvoiceReadinessItem[] {
  const seen = new Set<string>();
  const out: InvoiceReadinessItem[] = [];
  for (const item of items) {
    const key = `${item.kind}:${item.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Material med saknat kundpris får inte bli 0 kr på fakturan. */
export function billableWorkEntryIds(jobId: string, entryIds?: string[]): string[] {
  const available = uninvoicedActuals(jobId);
  const selected = entryIds?.length ? available.filter((e) => entryIds.includes(e.id)) : available;
  return selected
    .filter((e) => {
      if (e.type !== "material" || e.unitPrice > 0) return true;
      if (!e.documentLineId) return true;
      const line = documentLines().find((l) => l.id === e.documentLineId);
      return line != null && line.customerPriceSource !== "missing" && line.customerPrice != null;
    })
    .map((e) => e.id);
}

export function workEntryInvoiceStatuses(jobId: string) {
  return actualEntries(jobId).map((e) => ({ id: e.id, status: workEntryInvoiceStatus(e) }));
}

/** Exporterad så tester kan räkna källor utan att gå via UI. */
export function linesForJobDocument(source: "receipt" | "supplier_invoice", sourceDocumentId: string) {
  return linesForSource(source, sourceDocumentId);
}
