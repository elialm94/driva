/**
 * Orderbekräftelser: matchning mot beställning, rad-för-rad-avstämning,
 * statusar och policyn för när bekräftat material blir JobWorkEntry.
 *
 * Matchningsordning (aldrig gissning):
 *   1. exakt Ferva-referens (FV-1001) i ämne/text/bilaga
 *   2. grossistens ordernummer som redan är kopplat till beställningen
 *   3. kundnummer + uppdrag + grossist (avsändardomän)
 *   4. annars: osäker → kandidater som användaren väljer bland
 *
 * Automatik bara vid hög säkerhet och exakt radmatchning; alla ekonomiskt
 * betydelsefulla avvikelser (antal, pris, rest, ersättning, saknad, tillagd,
 * total) blir "Avvikelse kräver kontroll" tills användaren godkänt dem.
 *
 * JobWorkEntry-policy (testad): en orderrad får EN materialrad på uppdraget
 * när den har bekräftat antal > 0 i en tillämpad/godkänd bekräftelse OCH ett
 * giltigt kundpris. Raden uppdateras vid nya bekräftelser om den inte är
 * fakturerad; fakturerade rader ändras aldrig automatiskt – avvikelsen visas.
 * Saknas kundpris skapas ingen rad (aldrig 0 kr) – "Ange kundpris" först.
 */
import { db, save } from "../store";
import { uid } from "../ids";
import { CONFIDENCE_THRESHOLDS } from "../autopilot";
import type {
  InboxItem,
  JobWorkEntry,
  PurchaseOrder,
  PurchaseOrderConfirmation,
  PurchaseOrderConfirmationLine,
  PurchaseOrderDeviationKind,
  PurchaseOrderLine,
  PurchaseOrderMatchMethod,
  PurchaseOrderSnapshotLine,
  PurchaseOrderStatus,
} from "../types";
import {
  parseConfirmationDeterministic,
  toConfirmationLine,
  type ParsedConfirmationLine,
} from "../wholesalers/confirmation-parse";
import { aiConfirmationCandidates } from "../wholesalers/confirmation-ai";
import { connectionLabel, DEVIATION_LABELS } from "../wholesalers/labels";
import { formatOre, oreToWholeKronor } from "../wholesalers/money";
import { lineCustomerPrice } from "../wholesalers/pricing";
import { normalizeIdentifier, normalizeText } from "../wholesalers/catalog-search";
import { datumLang } from "../format";
import { getJob, requireCustomer } from "./data";
import { logActivity } from "./activity";
import { detectExtra, getJobWorkEntry, isIssuedLinked } from "./job-work";
import {
  getPurchaseOrder,
  purchaseOrderLines,
  purchaseOrders,
  requireLine,
  requirePurchaseOrder,
} from "./purchase-orders";
import { getWholesalerConnection, requireWholesalerConnection, wholesalerConnections } from "./wholesalers";

/** Prisavvikelse under detta (per rad, ören) räknas som avrundning – ingen kontroll. */
const PRICE_TOLERANCE_ORE = 100;

/* --------------------------------- läsning --------------------------------- */

export function purchaseOrderConfirmations(): PurchaseOrderConfirmation[] {
  return db().purchaseOrderConfirmations ?? [];
}

export function confirmationsForOrder(orderId: string): PurchaseOrderConfirmation[] {
  return purchaseOrderConfirmations()
    .filter((c) => c.orderId === orderId)
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
}

export function getConfirmation(id: string): PurchaseOrderConfirmation | undefined {
  return purchaseOrderConfirmations().find((c) => c.id === id);
}

function requireConfirmation(id: string): PurchaseOrderConfirmation {
  const c = getConfirmation(id);
  if (!c) throw new Error("Bekräftelsen finns inte.");
  return c;
}

/** Bekräftelser som räknas (tillämpade automatiskt eller godkända av användaren). */
export function activeConfirmations(orderId: string): PurchaseOrderConfirmation[] {
  return confirmationsForOrder(orderId).filter((c) => c.status === "applied" || c.status === "approved");
}

export interface LineConfirmationState {
  line: PurchaseOrderLine;
  orderedQty: number;
  confirmedQty: number;
  backorderedQty: number;
  /** Senast bekräftat inköpspris per enhet (ören). */
  confirmedUnitCostOre?: number;
  latestConfirmationId?: string;
  latestReceivedAt?: string;
}

/**
 * Bekräftat läge per orderrad – summerat över tillämpade/godkända
 * bekräftelser. Med includePending räknas även bekräftelser som väntar på
 * kontroll (för sammanfattningen – aldrig för materialraderna).
 */
export function lineStates(orderId: string, options: { includePending?: boolean } = {}): LineConfirmationState[] {
  const lines = purchaseOrderLines(orderId);
  const active = options.includePending
    ? confirmationsForOrder(orderId).filter((c) => c.status !== "dismissed")
    : activeConfirmations(orderId);
  return lines.map((line) => {
    let confirmed = 0;
    let backordered = 0;
    let cost: number | undefined;
    let latestId: string | undefined;
    let latestAt: string | undefined;
    for (const c of active) {
      for (const cl of c.lines) {
        if (cl.orderLineId !== line.id) continue;
        if (cl.backordered) {
          // Restnoterat antal är inte bekräftat för leverans än – det räknas
          // först när restordern bekräftas/levereras i en senare bekräftelse.
          const rest = cl.confirmedQty != null && cl.confirmedQty > 0 ? cl.confirmedQty : line.qty;
          backordered = Math.max(backordered, Math.min(rest, line.qty));
        } else if (cl.confirmedQty != null) {
          confirmed += cl.confirmedQty;
        }
        if (cl.unitCostOre != null) cost = cl.unitCostOre;
        latestId = c.id;
        latestAt = c.receivedAt;
      }
    }
    return {
      line,
      orderedQty: line.qty,
      confirmedQty: Math.round(confirmed * 1000) / 1000,
      backorderedQty: backordered,
      ...(cost != null ? { confirmedUnitCostOre: cost } : {}),
      ...(latestId ? { latestConfirmationId: latestId } : {}),
      ...(latestAt ? { latestReceivedAt: latestAt } : {}),
    };
  });
}

/* --------------------------------- matchning ------------------------------- */

function senderDomain(address: string): string {
  const angle = /<([^>]+)>/.exec(address);
  const addr = (angle ? angle[1] : address).trim().toLowerCase();
  const at = addr.lastIndexOf("@");
  return at >= 0 ? addr.slice(at + 1) : "";
}

function matchableOrders(): PurchaseOrder[] {
  return purchaseOrders().filter((o) => o.status !== "draft" && o.status !== "cancelled" && o.sentAt);
}

export interface OrderMatchResult {
  order?: PurchaseOrder;
  method?: PurchaseOrderMatchMethod;
  candidates: PurchaseOrder[];
}

/**
 * Hitta beställningen för ett inkommande mejl. Bara EN träff får kopplas
 * automatiskt; flera eller ingen ger kandidater för användaren.
 */
export function matchOrderForMail(input: {
  reference?: string;
  references: string[];
  orderNumber?: string;
  fromAddress: string;
  subject: string;
  text: string;
}): OrderMatchResult {
  const orders = matchableOrders();
  if (orders.length === 0) return { candidates: [] };

  // 1. Ferva-referens – exakt, unik per företag.
  const refs = input.reference ? [input.reference, ...input.references] : input.references;
  const byRef = orders.filter((o) => refs.some((r) => r.toUpperCase() === o.reference.toUpperCase()));
  if (byRef.length === 1) return { order: byRef[0], method: "reference", candidates: byRef };
  if (byRef.length > 1) return { candidates: byRef };

  // 2. Grossistens ordernummer som redan kopplats till ordern.
  if (input.orderNumber) {
    const wanted = input.orderNumber.replace(/[^a-z0-9]/gi, "").toUpperCase();
    const byNumber = orders.filter(
      (o) => o.wholesalerOrderNumber && o.wholesalerOrderNumber.replace(/[^a-z0-9]/gi, "").toUpperCase() === wanted,
    );
    if (byNumber.length === 1) return { order: byNumber[0], method: "order_number", candidates: byNumber };
  }

  // 3. Kundnummer + uppdrag + grossist (avsändarens domän = grossistens ordermejl).
  const domain = senderDomain(input.fromAddress);
  const hay = normalizeText(`${input.subject} ${input.text}`);
  const rawHay = `${input.subject}\n${input.text}`;
  const connectionsFromDomain = domain
    ? wholesalerConnections().filter((c) => senderDomain(c.orderEmail) === domain)
    : [];
  if (connectionsFromDomain.length > 0) {
    const domainOrders = orders.filter((o) => connectionsFromDomain.some((c) => c.id === o.connectionId));
    const byCustomerJob = domainOrders.filter((o) => {
      const connection = getWholesalerConnection(o.connectionId);
      const job = getJob(o.jobId);
      if (!connection || !job) return false;
      const customerNumber = connection.customerNumber.trim();
      const hasCustomer = customerNumber.length >= 3 && rawHay.includes(customerNumber);
      const title = normalizeText(job.title);
      const hasJob = title.length >= 4 && hay.includes(title);
      return hasCustomer && hasJob;
    });
    if (byCustomerJob.length === 1) return { order: byCustomerJob[0], method: "customer_job", candidates: byCustomerJob };
    if (byCustomerJob.length > 1) return { candidates: byCustomerJob };
    if (domainOrders.length > 0) return { candidates: domainOrders.slice(-10) };
  }

  // 4. Osäkert: de senaste skickade beställningarna som kandidater.
  return { candidates: orders.slice(-10) };
}

/* --------------------------------- avstämning ------------------------------ */

/**
 * Avvikelser som kräver en människa. Restnotering och ändrat leveransdatum
 * ändrar inte vad som beställts eller vad det kostar – de visas, men
 * bekräftelsen tillämpas (ordern blir Delvis bekräftad).
 */
function significant(kind: PurchaseOrderDeviationKind): boolean {
  return kind !== "delivery_date" && kind !== "backorder";
}

/**
 * Jämför bekräftelsens rader med det som skickades. Returnerar rader med
 * avvikelser + bekräftelsens samlade avvikelser.
 */
export function reconcileConfirmation(input: {
  order: PurchaseOrder;
  snapshotLines: PurchaseOrderSnapshotLine[];
  parsed: ParsedConfirmationLine[];
  /** Redan bekräftade antal per rad (från tidigare bekräftelser). */
  previouslyConfirmed: Map<string, number>;
  deliveryDate?: string;
  totalOre?: number;
}): { lines: PurchaseOrderConfirmationLine[]; deviations: PurchaseOrderDeviationKind[] } {
  const deviations = new Set<PurchaseOrderDeviationKind>();
  const covered = new Set<string>();
  const lines: PurchaseOrderConfirmationLine[] = input.parsed.map((p) => {
    const base = toConfirmationLine(p, uid());
    const lineDeviations = new Set<PurchaseOrderDeviationKind>();
    const snap = p.orderLineId ? input.snapshotLines.find((s) => s.lineId === p.orderLineId) : undefined;
    if (!snap) {
      lineDeviations.add("added");
    } else {
      covered.add(snap.lineId);
      const before = input.previouslyConfirmed.get(snap.lineId) ?? 0;
      if (p.confirmedQty != null) {
        const cumulative = before + p.confirmedQty;
        // Restnoterad rad: antalet är det som väntar, inte ett ändrat antal –
        // bara mer än beställt är en avvikelse.
        if (p.backordered ? cumulative - snap.qty > 0.0005 : Math.abs(cumulative - snap.qty) > 0.0005) {
          lineDeviations.add("qty");
        }
      }
      if (p.backordered) lineDeviations.add("backorder");
      if (p.substituteArticleNumber) lineDeviations.add("substitute");
      if (p.unitCostOre != null && snap.unitCostOre != null && Math.abs(p.unitCostOre - snap.unitCostOre) >= PRICE_TOLERANCE_ORE) {
        lineDeviations.add("price");
      }
    }
    for (const d of lineDeviations) deviations.add(d);
    // Exakt radmatchning: raden pekar på ett skickat artikelnummer, antalet
    // stämmer och inget avviker. En sådan textrad är lika säker som en
    // tabellrad och får tillämpas automatiskt. AI-kandidater höjs aldrig.
    const exactMatch =
      snap != null &&
      p.source !== "ai" &&
      lineDeviations.size === 0 &&
      p.confirmedQty != null &&
      Boolean(snap.articleNumber) &&
      normalizeIdentifier(p.articleNumber) === normalizeIdentifier(snap.articleNumber);
    const confidence = exactMatch ? Math.max(base.confidence, CONFIDENCE_THRESHOLDS.AUTO) : base.confidence;
    return { ...base, confidence, deviations: [...lineDeviations] };
  });

  if (lines.length > 0) {
    for (const snap of input.snapshotLines) {
      const before = input.previouslyConfirmed.get(snap.lineId) ?? 0;
      if (!covered.has(snap.lineId) && before < snap.qty) deviations.add("missing");
    }
  }
  if (input.totalOre != null && lines.length > 0) {
    const allPriced = lines.every((l) => l.unitCostOre != null && l.confirmedQty != null);
    if (allPriced) {
      const sum = lines.reduce((s, l) => s + Math.round((l.confirmedQty ?? 0) * (l.unitCostOre ?? 0)), 0);
      if (Math.abs(sum - input.totalOre) > PRICE_TOLERANCE_ORE * Math.max(1, lines.length)) deviations.add("total");
    }
  }
  if (input.deliveryDate && input.order.delivery.requestedDate && input.deliveryDate !== input.order.delivery.requestedDate) {
    deviations.add("delivery_date");
  }
  return { lines, deviations: [...deviations] };
}

function confirmationNeedsReview(
  lines: PurchaseOrderConfirmationLine[],
  deviations: PurchaseOrderDeviationKind[],
): boolean {
  if (deviations.some(significant)) return true;
  // Osäkra läsningar (text/AI under AUTO-tröskeln) kräver alltid en människa.
  return lines.some((l) => l.confidence < CONFIDENCE_THRESHOLDS.AUTO);
}

/* -------------------------------- statusar --------------------------------- */

export function deriveOrderStatus(orderId: string): PurchaseOrderStatus {
  const order = requirePurchaseOrder(orderId);
  if (order.status === "draft" || order.status === "cancelled" || order.status === "rejected") return order.status;
  const all = confirmationsForOrder(orderId);
  if (all.some((c) => c.status === "needs_review")) return "needs_review";
  const states = lineStates(orderId);
  if (states.length === 0) return "sent";
  const full = states.every((s) => s.confirmedQty + 0.0005 >= s.orderedQty);
  const any = states.some((s) => s.confirmedQty > 0);
  if (full) return "confirmed";
  if (any) return "partially_confirmed";
  return "sent";
}

function applyDerivedStatus(orderId: string): void {
  const order = requirePurchaseOrder(orderId);
  const next = deriveOrderStatus(orderId);
  if (order.status !== next) {
    order.status = next;
    order.updatedAt = new Date().toISOString();
  }
}

/* ------------------------- JobWorkEntry-policyn ---------------------------- */

export interface WorkEntrySyncResult {
  created: string[];
  updated: string[];
  /** Rader utan kundpris – ingen materialrad ännu ("Ange kundpris"). */
  missingCustomerPrice: string[];
  /** Fakturerade materialrader som skiljer sig från senaste bekräftelsen. */
  lockedInvoiced: string[];
}

function entryDescription(line: PurchaseOrderLine): string {
  return line.articleNumber ? `${line.name} (art.nr ${line.articleNumber})` : line.name;
}

/**
 * Skapa/uppdatera materialrader på uppdraget för bekräftade orderrader.
 * Idempotent: nyckeln är line.jobWorkEntryId – samma bekräftelse igen eller en
 * kompletterande delbekräftelse ger aldrig en dubblett.
 */
export function syncJobWorkEntriesForOrder(orderId: string): WorkEntrySyncResult {
  const order = requirePurchaseOrder(orderId);
  const result: WorkEntrySyncResult = { created: [], updated: [], missingCustomerPrice: [], lockedInvoiced: [] };
  if (order.status === "draft" || order.status === "cancelled") return result;
  const data = db();
  data.jobWorkEntries ??= [];
  const now = new Date().toISOString();
  const settingsVat = data.settings.defaultVatRate ?? 25;

  for (const state of lineStates(orderId)) {
    const { line } = state;
    if (state.confirmedQty <= 0) continue;
    const price = lineCustomerPrice(line);
    const existing = line.jobWorkEntryId ? getJobWorkEntry(line.jobWorkEntryId) : undefined;
    if (line.jobWorkEntryId && !existing) {
      // Användaren har tagit bort raden medvetet – återskapa den inte.
      continue;
    }
    if (price.ore == null) {
      result.missingCustomerPrice.push(line.id);
      continue;
    }
    const unitPrice = oreToWholeKronor(price.ore);
    const description = entryDescription(line);
    const provenance: JobWorkEntry["wholesaler"] = {
      connectionId: order.connectionId,
      purchaseOrderId: order.id,
      purchaseOrderLineId: line.id,
      ...(state.latestConfirmationId ? { confirmationId: state.latestConfirmationId } : {}),
      ...(line.articleNumber ? { articleNumber: line.articleNumber } : {}),
      ...(state.confirmedUnitCostOre != null || line.unitCostOre != null
        ? { unitCostOre: state.confirmedUnitCostOre ?? line.unitCostOre }
        : {}),
    };
    const date = (state.latestReceivedAt ?? now).slice(0, 10);

    if (existing) {
      if (isIssuedLinked(existing)) {
        const changed =
          Math.abs(existing.qty - state.confirmedQty) > 0.0005 ||
          existing.unitPrice !== unitPrice ||
          existing.description !== description;
        if (changed) result.lockedInvoiced.push(line.id);
        continue;
      }
      const changed =
        Math.abs(existing.qty - state.confirmedQty) > 0.0005 ||
        existing.unitPrice !== unitPrice ||
        existing.description !== description ||
        JSON.stringify(existing.wholesaler ?? null) !== JSON.stringify(provenance);
      if (changed) {
        existing.qty = state.confirmedQty;
        existing.unitPrice = unitPrice;
        existing.description = description;
        existing.unit = line.unit;
        existing.wholesaler = provenance;
        existing.updatedAt = now;
        result.updated.push(existing.id);
      }
      continue;
    }

    const entry: JobWorkEntry = {
      id: uid(),
      jobId: order.jobId,
      role: "actual",
      type: "material",
      description,
      date,
      qty: state.confirmedQty,
      unit: line.unit,
      unitPrice,
      vatRate: settingsVat,
      source: "wholesaler",
      isExtra: detectExtra(order.jobId, { type: "material", description }),
      wholesaler: provenance,
      createdAt: now,
      updatedAt: now,
    };
    data.jobWorkEntries.push(entry);
    line.jobWorkEntryId = entry.id;
    line.updatedAt = now;
    result.created.push(entry.id);
  }
  return result;
}

/* ------------------------------- registrera -------------------------------- */

export interface RecordConfirmationInput {
  order: PurchaseOrder;
  source: PurchaseOrderConfirmation["source"];
  matchMethod: PurchaseOrderMatchMethod;
  inboxItemId?: string;
  receivedAt?: string;
  parsedLines: ParsedConfirmationLine[];
  orderNumber?: string;
  deliveryDate?: string;
  totalOre?: number;
  message?: string;
  /** Manuellt inmatade uppgifter är redan kontrollerade av användaren. */
  reviewed?: boolean;
}

/**
 * Skapa bekräftelseposten, stäm av, uppdatera orderstatus och (vid
 * tillämpad/godkänd bekräftelse) materialraderna. Idempotent per inboxpost.
 */
export function recordConfirmation(input: RecordConfirmationInput): PurchaseOrderConfirmation {
  const { order } = input;
  if (order.status === "draft") throw new Error("Beställningen är inte skickad.");
  const data = db();
  data.purchaseOrderConfirmations ??= [];
  if (input.inboxItemId) {
    const existing = data.purchaseOrderConfirmations.find((c) => c.inboxItemId === input.inboxItemId);
    if (existing) return existing;
  }
  const snapshotLines = order.sentSnapshot?.lines ?? [];
  const previouslyConfirmed = new Map<string, number>();
  for (const s of lineStates(order.id)) previouslyConfirmed.set(s.line.id, s.confirmedQty);
  const { lines, deviations } = reconcileConfirmation({
    order,
    snapshotLines,
    parsed: input.parsedLines,
    previouslyConfirmed,
    deliveryDate: input.deliveryDate,
    totalOre: input.totalOre,
  });
  const now = new Date().toISOString();
  const needsReview = !input.reviewed && confirmationNeedsReview(lines, deviations);
  const confirmation: PurchaseOrderConfirmation = {
    id: uid(),
    orderId: order.id,
    ...(input.inboxItemId ? { inboxItemId: input.inboxItemId } : {}),
    source: input.source,
    matchMethod: input.matchMethod,
    status: input.reviewed ? "approved" : needsReview ? "needs_review" : "applied",
    receivedAt: input.receivedAt ?? now,
    ...(input.orderNumber ? { wholesalerOrderNumber: input.orderNumber } : {}),
    ...(input.deliveryDate ? { deliveryDate: input.deliveryDate } : {}),
    ...(input.totalOre != null ? { totalOre: input.totalOre } : {}),
    ...(input.message ? { message: input.message.slice(0, 2000) } : {}),
    lines,
    deviations,
    ...(input.reviewed ? { reviewedAt: now } : {}),
    createdAt: now,
  };
  data.purchaseOrderConfirmations.push(confirmation);
  if (input.orderNumber && !order.wholesalerOrderNumber) order.wholesalerOrderNumber = input.orderNumber;
  order.updatedAt = now;
  applyDerivedStatus(order.id);
  if (confirmation.status !== "needs_review") syncJobWorkEntriesForOrder(order.id);

  const connection = getWholesalerConnection(order.connectionId);
  const job = getJob(order.jobId);
  const who = connection ? connectionLabel(connection) : "Grossisten";
  logActivity(
    confirmation.status === "needs_review"
      ? `${who} bekräftade ${order.reference} med avvikelser som behöver kontrolleras.`
      : `${who} bekräftade beställning ${order.reference}.`,
    job ? { customerId: job.customerId, entity: { type: "jobb", id: job.id } } : {},
  );
  save();
  return confirmation;
}

/** "Godkänn ändringarna": bekräftelsen räknas, materialraderna skapas/uppdateras. */
export function approveConfirmation(confirmationId: string): PurchaseOrderConfirmation {
  const confirmation = requireConfirmation(confirmationId);
  const order = requirePurchaseOrder(confirmation.orderId);
  if (confirmation.status === "dismissed") throw new Error("Bekräftelsen är bortsedd. Välj den igen om den ska räknas.");
  const now = new Date().toISOString();
  confirmation.status = "approved";
  confirmation.reviewedAt = now;
  if (confirmation.wholesalerOrderNumber && !order.wholesalerOrderNumber) {
    order.wholesalerOrderNumber = confirmation.wholesalerOrderNumber;
  }
  order.deviationsAcceptedAt = now;
  order.updatedAt = now;
  applyDerivedStatus(order.id);
  syncJobWorkEntriesForOrder(order.id);
  save();
  return confirmation;
}

/** Bortse från en bekräftelse (t.ex. dubblett) – historiken finns kvar. */
export function dismissConfirmation(confirmationId: string): PurchaseOrderConfirmation {
  const confirmation = requireConfirmation(confirmationId);
  const order = requirePurchaseOrder(confirmation.orderId);
  confirmation.status = "dismissed";
  confirmation.reviewedAt = new Date().toISOString();
  order.updatedAt = confirmation.reviewedAt;
  applyDerivedStatus(order.id);
  syncJobWorkEntriesForOrder(order.id);
  save();
  return confirmation;
}

/** Användaren markerar att grossisten avvisat beställningen. */
export function markOrderRejected(orderId: string): PurchaseOrder {
  const order = requirePurchaseOrder(orderId);
  if (order.status === "draft") throw new Error("Beställningen är inte skickad.");
  order.status = "rejected";
  order.updatedAt = new Date().toISOString();
  save();
  return order;
}

/** Efter "Ange kundpris": skapa materialraden som saknades. */
export function syncAfterCustomerPrice(lineId: string): WorkEntrySyncResult {
  const line = requireLine(lineId);
  const result = syncJobWorkEntriesForOrder(line.orderId);
  save();
  return result;
}

/* -------------------------------- inbox-vägen ------------------------------ */

function attachmentsForParse(item: InboxItem) {
  return item.attachments.map((a) => ({
    filename: a.filename,
    contentType: a.contentType,
    ...(a.contentBase64 ? { contentBase64: a.contentBase64 } : {}),
  }));
}

export type InboxConfirmationOutcome =
  | { kind: "matched"; confirmationId: string; orderId: string; needsAiFallback: boolean }
  | { kind: "uncertain"; candidateIds: string[] }
  | { kind: "none" };

/**
 * Inboxpost → bekräftelse (deterministiskt). Osäker matchning kopplas aldrig:
 * posten får kandidater och användaren väljer. Kallas från inboxpipelinen.
 */
export function processInboxOrderConfirmation(item: InboxItem): InboxConfirmationOutcome {
  const text = item.textBody ?? "";
  const pre = parseConfirmationDeterministic({
    subject: item.subject,
    text,
    html: item.htmlBody,
    attachments: attachmentsForParse(item),
    snapshotLines: [],
  });
  const match = matchOrderForMail({
    reference: pre.reference,
    references: pre.references,
    orderNumber: pre.orderNumber,
    fromAddress: item.fromAddress,
    subject: item.subject,
    text,
  });
  if (!match.order || !match.method) {
    const candidateIds = match.candidates.map((o) => o.id);
    if (candidateIds.length > 0) item.purchaseOrderCandidateIds = candidateIds;
    return candidateIds.length > 0 ? { kind: "uncertain", candidateIds } : { kind: "none" };
  }
  const confirmation = attachInboxItemToOrder(item, match.order, match.method);
  return {
    kind: "matched",
    confirmationId: confirmation.id,
    orderId: match.order.id,
    needsAiFallback: confirmation.lines.length === 0 && (text.trim().length > 0 || Boolean(item.htmlBody)),
  };
}

function attachInboxItemToOrder(
  item: InboxItem,
  order: PurchaseOrder,
  method: PurchaseOrderMatchMethod,
): PurchaseOrderConfirmation {
  const parsed = parseConfirmationDeterministic({
    subject: item.subject,
    text: item.textBody ?? "",
    html: item.htmlBody,
    attachments: attachmentsForParse(item),
    snapshotLines: order.sentSnapshot?.lines ?? [],
  });
  const confirmation = recordConfirmation({
    order,
    source: item.source === "uppladdning" ? "manual" : "email",
    matchMethod: method,
    inboxItemId: item.id,
    receivedAt: item.createdAt,
    parsedLines: parsed.lines,
    orderNumber: parsed.orderNumber,
    deliveryDate: parsed.deliveryDate,
    totalOre: parsed.totalOre,
    message: parsed.message,
  });
  item.purchaseOrderId = order.id;
  item.purchaseOrderConfirmationId = confirmation.id;
  delete item.purchaseOrderCandidateIds;
  if (item.status === "ny") {
    item.status = "behandlad";
    item.processedAt = new Date().toISOString();
  }
  return confirmation;
}

/** Användaren väljer beställning för en osäkert matchad inboxpost. */
export function linkInboxItemToOrder(itemId: string, orderId: string): PurchaseOrderConfirmation {
  const item = (db().inboxItems ?? []).find((i) => i.id === itemId);
  if (!item) throw new Error("Posten finns inte i inboxen.");
  if (item.purchaseOrderConfirmationId) {
    const existing = getConfirmation(item.purchaseOrderConfirmationId);
    if (existing) return existing;
  }
  const order = requirePurchaseOrder(orderId);
  if (order.status === "draft") throw new Error("Beställningen är inte skickad än.");
  item.documentType = "orderbekraftelse";
  const confirmation = attachInboxItemToOrder(item, order, "manual");
  save();
  return confirmation;
}

/** Inboxposten är inte en orderbekräftelse trots allt – släpp kandidaterna. */
export function clearInboxOrderCandidates(itemId: string): void {
  const item = (db().inboxItems ?? []).find((i) => i.id === itemId);
  if (!item) throw new Error("Posten finns inte i inboxen.");
  delete item.purchaseOrderCandidateIds;
  if (item.documentType === "orderbekraftelse") item.documentType = "ekonomiskt_dokument";
  save();
}

/**
 * AI-fallback för en matchad bekräftelse utan strukturerade rader. Async
 * (LLM), körs efter den synkrona pipelinen. Resultatet är alltid
 * "kontrollera" (konfidens under AUTO). Ingenting skickas eller bokförs.
 */
export async function enrichConfirmationWithAi(confirmationId: string): Promise<boolean> {
  const confirmation = getConfirmation(confirmationId);
  if (!confirmation || confirmation.lines.length > 0 || !confirmation.inboxItemId) return false;
  const item = (db().inboxItems ?? []).find((i) => i.id === confirmation.inboxItemId);
  const order = getPurchaseOrder(confirmation.orderId);
  if (!item || !order) return false;
  const text = item.textBody?.trim() ? item.textBody : item.htmlBody ? item.htmlBody.replace(/<[^>]+>/g, " ") : "";
  if (!text.trim()) return false;
  const ai = await aiConfirmationCandidates({
    subject: item.subject,
    text,
    snapshotLines: order.sentSnapshot?.lines ?? [],
  });
  if (!ai || ai.lines.length === 0) return false;
  const previouslyConfirmed = new Map<string, number>();
  for (const s of lineStates(order.id)) previouslyConfirmed.set(s.line.id, s.confirmedQty);
  const { lines, deviations } = reconcileConfirmation({
    order,
    snapshotLines: order.sentSnapshot?.lines ?? [],
    parsed: ai.lines,
    previouslyConfirmed,
    deliveryDate: ai.deliveryDate ?? confirmation.deliveryDate,
    totalOre: ai.totalOre ?? confirmation.totalOre,
  });
  confirmation.lines = lines;
  confirmation.deviations = deviations;
  confirmation.status = "needs_review";
  if (ai.orderNumber && !confirmation.wholesalerOrderNumber) confirmation.wholesalerOrderNumber = ai.orderNumber;
  if (ai.deliveryDate && !confirmation.deliveryDate) confirmation.deliveryDate = ai.deliveryDate;
  if (ai.totalOre != null && confirmation.totalOre == null) confirmation.totalOre = ai.totalOre;
  order.updatedAt = new Date().toISOString();
  applyDerivedStatus(order.id);
  save();
  return true;
}

/* ------------------------------ manuell bekräftelse ------------------------ */

export interface ManualConfirmationLineInput {
  orderLineId: string;
  confirmedQty: number;
  unitCostKr?: number | null;
  backordered?: boolean;
  backorderDate?: string;
}

/** Användaren skriver in bekräftelsen själv (telefon/annan kanal). Redan kontrollerad. */
export function addManualConfirmation(input: {
  orderId: string;
  orderNumber?: string;
  deliveryDate?: string;
  lines: ManualConfirmationLineInput[];
  message?: string;
}): PurchaseOrderConfirmation {
  const order = requirePurchaseOrder(input.orderId);
  const snapshot = order.sentSnapshot?.lines ?? [];
  const parsed: ParsedConfirmationLine[] = [];
  for (const l of input.lines) {
    const snap = snapshot.find((s) => s.lineId === l.orderLineId);
    if (!snap) throw new Error("Raden finns inte på beställningen.");
    const qty = Number(l.confirmedQty);
    if (!Number.isFinite(qty) || qty < 0) throw new Error("Ange bekräftat antal.");
    const costKr = l.unitCostKr == null || l.unitCostKr === undefined ? null : Number(l.unitCostKr);
    if (costKr != null && (!Number.isFinite(costKr) || costKr < 0)) throw new Error("Ange inköpspriset i kronor.");
    parsed.push({
      orderLineId: snap.lineId,
      ...(snap.articleNumber ? { articleNumber: snap.articleNumber } : {}),
      name: snap.name,
      confirmedQty: qty,
      unit: snap.unit,
      ...(costKr != null ? { unitCostOre: Math.round(costKr * 100) } : {}),
      backordered: l.backordered === true,
      ...(l.backorderDate && /^\d{4}-\d{2}-\d{2}$/.test(l.backorderDate) ? { backorderDate: l.backorderDate } : {}),
      confidence: 1,
      source: "structured",
    });
  }
  if (parsed.length === 0) throw new Error("Ange minst en rad.");
  const deliveryDate = input.deliveryDate && /^\d{4}-\d{2}-\d{2}$/.test(input.deliveryDate) ? input.deliveryDate : undefined;
  return recordConfirmation({
    order,
    source: "manual",
    matchMethod: "manual",
    parsedLines: parsed,
    orderNumber: input.orderNumber?.trim().slice(0, 60) || undefined,
    deliveryDate,
    message: input.message?.trim().slice(0, 2000) || undefined,
    reviewed: true,
  });
}

/* --------------------------------- UI-summering ---------------------------- */

export interface OrderReview {
  headline: string;
  bullets: string[];
  needsReview: boolean;
  pendingConfirmationIds: string[];
  /** Orderrader utan kundpris med bekräftat antal – "Ange kundpris". */
  missingCustomerPriceLineIds: string[];
  /** Fakturerade materialrader där bekräftelsen skiljer sig. */
  lockedInvoicedLineIds: string[];
  deliveryDate?: string;
  /** Verklig inköpskostnad (bekräftad) i ören, när den kan beräknas. */
  confirmedCostOre?: number;
  expectedCostOre?: number;
}

/** "Dahl har bekräftat 9 av 10 artiklar" + bara avvikelser som kräver uppmärksamhet. */
export function orderReview(orderId: string): OrderReview {
  const order = requirePurchaseOrder(orderId);
  const connection = requireWholesalerConnection(order.connectionId);
  const who = connectionLabel(connection);
  // Sammanfattningen visar även vad en bekräftelse som väntar på kontroll säger.
  const states = lineStates(orderId, { includePending: true });
  const confirmations = confirmationsForOrder(orderId);
  const pending = confirmations.filter((c) => c.status === "needs_review");
  const considered = confirmations.filter((c) => c.status !== "dismissed");
  const bullets: string[] = [];

  const confirmedLines = states.filter((s) => s.confirmedQty + 0.0005 >= s.orderedQty).length;
  const anyConfirmation = considered.length > 0;
  let headline: string;
  if (order.status === "draft") headline = "Utkast – inte skickad";
  else if (order.status === "cancelled") headline = "Beställningen är avbruten";
  else if (order.status === "rejected") headline = `${who} har avvisat beställningen`;
  else if (!anyConfirmation) headline = `Skickad till ${who} – inväntar bekräftelse`;
  else if (confirmedLines === states.length && states.length > 0) headline = `${who} har bekräftat alla ${states.length} artiklar`;
  else headline = `${who} har bekräftat ${confirmedLines} av ${states.length} artiklar`;

  const deviationKinds = new Set<PurchaseOrderDeviationKind>();
  for (const c of considered) for (const d of c.deviations) deviationKinds.add(d);

  const backordered = states.filter((s) => s.backorderedQty > 0).length;
  if (backordered > 0) bullets.push(backordered === 1 ? "1 artikel är restnoterad" : `${backordered} artiklar är restnoterade`);

  // Prisjämförelsen görs på de rader där både förväntat och bekräftat pris
  // är kända – en restnoterad rad utan pris döljer inte en prishöjning på övriga.
  let expected = 0;
  let actual = 0;
  let priced = 0;
  for (const s of states) {
    if (s.confirmedQty <= 0) continue;
    if (s.line.unitCostOre == null || s.confirmedUnitCostOre == null) continue;
    priced += 1;
    expected += Math.round(s.confirmedQty * s.line.unitCostOre);
    actual += Math.round(s.confirmedQty * s.confirmedUnitCostOre);
  }
  if (priced > 0 && Math.abs(actual - expected) >= PRICE_TOLERANCE_ORE) {
    const diff = actual - expected;
    bullets.push(
      diff > 0
        ? `Inköpspriset är ${formatOre(diff)} högre än förväntat`
        : `Inköpspriset är ${formatOre(-diff)} lägre än förväntat`,
    );
  }
  for (const kind of ["substitute", "missing", "added", "total"] as PurchaseOrderDeviationKind[]) {
    if (deviationKinds.has(kind)) bullets.push(DEVIATION_LABELS[kind]);
  }
  const deliveryDate = [...considered].reverse().find((c) => c.deliveryDate)?.deliveryDate;
  if (deliveryDate) {
    bullets.push(`${order.delivery.mode === "pickup" ? "Hämtklart" : "Leverans"}: ${datumLang(deliveryDate)}`);
  }

  const sync = order.status === "draft" || order.status === "cancelled"
    ? { missingCustomerPrice: [], lockedInvoiced: [] }
    : previewWorkEntrySync(orderId);
  if (sync.missingCustomerPrice.length > 0) {
    bullets.push(
      sync.missingCustomerPrice.length === 1
        ? "1 artikel saknar kundpris och ingår inte i fakturaunderlaget"
        : `${sync.missingCustomerPrice.length} artiklar saknar kundpris och ingår inte i fakturaunderlaget`,
    );
  }
  if (sync.lockedInvoiced.length > 0) {
    bullets.push("Redan fakturerat material skiljer sig från bekräftelsen – kontrollera raderna");
  }

  // Verklig inköpskostnad bara när alla bekräftade rader har ett bekräftat pris.
  const confirmedRows = states.filter((s) => s.confirmedQty > 0);
  const fullyPriced = confirmedRows.length > 0 && confirmedRows.every((s) => s.confirmedUnitCostOre != null);
  const confirmedCost = fullyPriced
    ? confirmedRows.reduce((sum, s) => sum + Math.round(s.confirmedQty * (s.confirmedUnitCostOre ?? 0)), 0)
    : undefined;
  const expectedCost = order.sentSnapshot?.expectedCostOre;
  return {
    headline,
    bullets,
    needsReview: pending.length > 0,
    pendingConfirmationIds: pending.map((c) => c.id),
    missingCustomerPriceLineIds: sync.missingCustomerPrice,
    lockedInvoicedLineIds: sync.lockedInvoiced,
    ...(deliveryDate ? { deliveryDate } : {}),
    ...(confirmedCost != null ? { confirmedCostOre: confirmedCost } : {}),
    ...(expectedCost != null ? { expectedCostOre: expectedCost } : {}),
  };
}

/** Samma policy som synken men utan skrivning – för sammanfattningen. */
function previewWorkEntrySync(orderId: string): { missingCustomerPrice: string[]; lockedInvoiced: string[] } {
  const missing: string[] = [];
  const locked: string[] = [];
  for (const state of lineStates(orderId)) {
    if (state.confirmedQty <= 0) continue;
    const price = lineCustomerPrice(state.line);
    const existing = state.line.jobWorkEntryId ? getJobWorkEntry(state.line.jobWorkEntryId) : undefined;
    if (state.line.jobWorkEntryId && !existing) continue;
    if (price.ore == null) {
      missing.push(state.line.id);
      continue;
    }
    if (existing && isIssuedLinked(existing)) {
      const unitPrice = oreToWholeKronor(price.ore);
      if (Math.abs(existing.qty - state.confirmedQty) > 0.0005 || existing.unitPrice !== unitPrice) locked.push(state.line.id);
    }
  }
  return { missingCustomerPrice: missing, lockedInvoiced: locked };
}

/** Kundens namn på uppdraget – för aktivitetsloggen. */
export function orderCustomerName(order: PurchaseOrder): string | undefined {
  const job = getJob(order.jobId);
  return job ? requireCustomer(job.customerId).name : undefined;
}
