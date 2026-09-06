/**
 * Materialbeställningar (varukorg → skickad order) på uppdrag.
 *
 * En varukorg = ett utkast (status draft) för exakt ett uppdrag och exakt en
 * grossistanslutning. Rader är PLANERADE inköp – de blir aldrig JobWorkEntry
 * (actual) förrän grossisten bekräftat dem (services/purchase-order-
 * confirmations.ts). Flera order och kompletteringsköp på samma uppdrag är
 * normalfallet.
 *
 * Utskicket: validera → kuvert → sendMail → först vid provider-succé fryses
 * snapshoten och statusen blir "sent". Providerfel lämnar ordern som utkast.
 */
import { db, save } from "../store";
import { uid } from "../ids";
import { isEmailFormat } from "../settings-validation";
import { currentActor } from "../collaboration/actor";
import type {
  PurchaseOrder,
  PurchaseOrderDelivery,
  PurchaseOrderLine,
  PurchaseOrderSentSnapshot,
  PurchaseOrderSnapshotLine,
  WholesalerConnection,
} from "../types";
import {
  mailFromWithDisplayName,
  sendMail,
  type MailMessage,
  type MailResult,
  type MailSendMeta,
} from "../mail";
import { isDemoBusiness, isDemoMode } from "../demo";
import { tenantContext } from "../storage/context";
import {
  expectedCostOre,
  purchaseOrderCsv,
  purchaseOrderHtml,
  purchaseOrderPdf,
  purchaseOrderSubject,
  purchaseOrderText,
  type PurchaseOrderMailInput,
} from "../email/purchase-order-mail";
import { userFacingSendError } from "../email/service";
import { connectionLabel, isDeliveryMode } from "../wholesalers/labels";
import { wholeKronorToOre } from "../wholesalers/money";
import { customerPriceForProduct, hasCustomerPrice, type CustomerPrice } from "../wholesalers/pricing";
import { neutralizeFormula } from "../wholesalers/table";
import { inboundMailAddress } from "../inbox/inbound-mail";
import { getJob, requireCustomer } from "./data";
import { logActivity } from "./activity";
import { catalogProductsByIds, requireWholesalerConnection } from "./wholesalers";

export const PURCHASE_ORDER_SEND_FAILED = "Beställningen kunde inte skickas. Inget har gått iväg till grossisten – försök igen.";
export const PURCHASE_ORDER_MAIL_NOT_CONFIGURED =
  "E-posttjänsten är inte konfigurerad, så beställningen har inte skickats. Den ligger kvar som utkast.";

const MAX_LINES_PER_ORDER = 200;
const MAX_QTY = 100_000;

/* --------------------------------- läsning --------------------------------- */

export function purchaseOrders(): PurchaseOrder[] {
  return db().purchaseOrders ?? [];
}

export function purchaseOrderLinesAll(): PurchaseOrderLine[] {
  return db().purchaseOrderLines ?? [];
}

export function getPurchaseOrder(id: string): PurchaseOrder | undefined {
  return purchaseOrders().find((o) => o.id === id);
}

export function requirePurchaseOrder(id: string): PurchaseOrder {
  const order = getPurchaseOrder(id);
  if (!order) throw new Error("Beställningen finns inte.");
  return order;
}

export function purchaseOrderLines(orderId: string): PurchaseOrderLine[] {
  return purchaseOrderLinesAll()
    .filter((l) => l.orderId === orderId)
    .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
}

export function ordersForJob(jobId: string): PurchaseOrder[] {
  return purchaseOrders()
    .filter((o) => o.jobId === jobId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function draftCartsForJob(jobId: string): PurchaseOrder[] {
  return ordersForJob(jobId).filter((o) => o.status === "draft");
}

export function sentOrdersForJob(jobId: string): PurchaseOrder[] {
  return ordersForJob(jobId).filter((o) => o.status !== "draft" && o.status !== "cancelled");
}

/** Uppdraget har (eller har haft) grossistbeställningar – styr om sektionen visas. */
export function jobHasPurchaseOrders(jobId: string): boolean {
  return ordersForJob(jobId).length > 0;
}

export function isOrderLocked(order: PurchaseOrder): boolean {
  return order.status !== "draft";
}

/* ------------------------------- varukorgen -------------------------------- */

function requireJob(jobId: string) {
  const job = getJob(jobId);
  if (!job) throw new Error("Uppdraget finns inte.");
  return job;
}

function requireDraft(orderId: string): PurchaseOrder {
  const order = requirePurchaseOrder(orderId);
  if (order.status !== "draft") {
    throw new Error("Beställningen är redan skickad och kan inte ändras. Skapa en ny beställning.");
  }
  return order;
}

function ordererDefaults(): { name: string; email: string; phone: string } {
  const s = db().settings;
  const actor = currentActor();
  const genericNames = new Set(["", "Du", "Ägare", "Användare"]);
  const name = actor && !genericNames.has(actor.name.trim()) ? actor.name.trim() : s.name;
  const actorEmail = actor?.email?.trim() ?? "";
  const email = actorEmail && isEmailFormat(actorEmail) && !/@driva\.local$/i.test(actorEmail) ? actorEmail : s.email;
  return { name, email: email ?? "", phone: s.phone ?? "" };
}

function nextReference(): string {
  const data = db();
  let n = data.meta.purchaseOrderSequence ?? 1001;
  const taken = new Set(purchaseOrders().map((o) => o.reference));
  let ref = `FV-${n}`;
  while (taken.has(ref)) {
    n += 1;
    ref = `FV-${n}`;
  }
  data.meta = { ...data.meta, purchaseOrderSequence: n + 1 };
  return ref;
}

function defaultDelivery(connection: WholesalerConnection): PurchaseOrderDelivery {
  const delivery: PurchaseOrderDelivery = { mode: connection.defaultDeliveryMode };
  if (connection.defaultStore) delivery.store = connection.defaultStore;
  if (connection.defaultDeliveryAddress) delivery.address = connection.defaultDeliveryAddress;
  return delivery;
}

/**
 * Hämta eller skapa utkastet för (uppdrag, anslutning). Väljer användaren
 * artiklar från flera grossister får varje grossist sin egen varukorg – de
 * skickas som separata beställningar.
 */
export function ensureCart(jobId: string, connectionId: string): PurchaseOrder {
  requireJob(jobId);
  const connection = requireWholesalerConnection(connectionId);
  if (!connection.active) throw new Error(`${connectionLabel(connection)} är inaktiverad. Aktivera grossisten under Inställningar → Grossister.`);
  const existing = draftCartsForJob(jobId).find((o) => o.connectionId === connectionId);
  if (existing) return existing;
  const data = db();
  data.purchaseOrders ??= [];
  const now = new Date().toISOString();
  const orderer = ordererDefaults();
  const order: PurchaseOrder = {
    id: uid(),
    reference: nextReference(),
    jobId,
    connectionId,
    status: "draft",
    channel: "email",
    delivery: defaultDelivery(connection),
    ordererName: orderer.name,
    ordererEmail: orderer.email,
    ordererPhone: orderer.phone,
    ccSelf: connection.ccSelf,
    createdAt: now,
    updatedAt: now,
  };
  const actor = currentActor();
  if (actor?.userId) order.createdByUserId = actor.userId;
  data.purchaseOrders.push(order);
  save();
  return order;
}

function assertQty(raw: unknown): number {
  const qty = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(",", "."));
  if (!Number.isFinite(qty) || qty <= 0 || qty > MAX_QTY) throw new Error("Ange ett antal större än noll.");
  return Math.round(qty * 1000) / 1000;
}

/** Kundpris i hela kronor (appens modell) – null tar bort ett explicit pris. */
function assertCustomerPriceKr(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const kr = typeof raw === "number" ? raw : Number(String(raw).replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(kr) || kr < 0 || kr > 10_000_000) throw new Error("Ange kundpriset i hela kronor.");
  return Math.round(kr);
}

function touch(order: PurchaseOrder): void {
  order.updatedAt = new Date().toISOString();
}

function nextPosition(orderId: string): number {
  const lines = purchaseOrderLines(orderId);
  return lines.length === 0 ? 0 : Math.max(...lines.map((l) => l.position)) + 1;
}

function assertLineCapacity(orderId: string): void {
  if (purchaseOrderLines(orderId).length >= MAX_LINES_PER_ORDER) {
    throw new Error(`En beställning kan ha högst ${MAX_LINES_PER_ORDER} rader. Skicka den och skapa en ny.`);
  }
}

export async function addCatalogProductToCart(input: {
  jobId: string;
  connectionId: string;
  productId: string;
  qty: number;
}): Promise<{ order: PurchaseOrder; line: PurchaseOrderLine }> {
  const qty = assertQty(input.qty);
  const connection = requireWholesalerConnection(input.connectionId);
  const [product] = await catalogProductsByIds(connection.id, [input.productId]);
  if (!product) throw new Error("Artikeln finns inte i den aktiva prislistan. Sök igen.");
  const order = ensureCart(input.jobId, input.connectionId);
  const data = db();
  data.purchaseOrderLines ??= [];
  const existing = purchaseOrderLines(order.id).find((l) => l.productId === product.id);
  const now = new Date().toISOString();
  if (existing) {
    existing.qty = assertQty(existing.qty + qty);
    existing.updatedAt = now;
    touch(order);
    save();
    return { order, line: existing };
  }
  assertLineCapacity(order.id);
  const price: CustomerPrice = customerPriceForProduct(product, connection.customerPriceRule);
  const line: PurchaseOrderLine = {
    id: uid(),
    orderId: order.id,
    position: nextPosition(order.id),
    productId: product.id,
    articleNumber: product.articleNumber,
    name: product.name,
    ...(product.eNumber ? { eNumber: product.eNumber } : {}),
    ...(product.rskNumber ? { rskNumber: product.rskNumber } : {}),
    unit: product.unit,
    ...(product.packSize != null ? { packSize: product.packSize } : {}),
    qty,
    ...(product.netPriceOre != null ? { unitCostOre: product.netPriceOre } : {}),
    ...(price.ore != null ? { customerUnitPriceOre: price.ore } : {}),
    customerPriceSource: price.source,
    isFreeText: false,
    createdAt: now,
    updatedAt: now,
  };
  data.purchaseOrderLines.push(line);
  touch(order);
  save();
  return { order, line };
}

export function addFreeTextLineToCart(input: {
  jobId: string;
  connectionId: string;
  name: string;
  qty: number;
  unit?: string;
  articleNumber?: string;
  note?: string;
  customerUnitPriceKr?: number | null;
}): { order: PurchaseOrder; line: PurchaseOrderLine } {
  const name = neutralizeFormula(String(input.name ?? "").replace(/\s+/g, " ").trim()).slice(0, 200);
  if (!name) throw new Error("Beskriv artikeln.");
  const qty = assertQty(input.qty);
  const order = ensureCart(input.jobId, input.connectionId);
  assertLineCapacity(order.id);
  const data = db();
  data.purchaseOrderLines ??= [];
  const now = new Date().toISOString();
  const customerKr = assertCustomerPriceKr(input.customerUnitPriceKr);
  const articleNumber = neutralizeFormula(String(input.articleNumber ?? "").trim()).slice(0, 64);
  const note = neutralizeFormula(String(input.note ?? "").trim()).slice(0, 300);
  const line: PurchaseOrderLine = {
    id: uid(),
    orderId: order.id,
    position: nextPosition(order.id),
    ...(articleNumber ? { articleNumber } : {}),
    name,
    unit: (input.unit ?? "st").trim().slice(0, 16) || "st",
    qty,
    ...(customerKr != null ? { customerUnitPriceOre: wholeKronorToOre(customerKr) } : {}),
    customerPriceSource: customerKr != null ? "explicit" : "missing",
    ...(note ? { note } : {}),
    isFreeText: true,
    createdAt: now,
    updatedAt: now,
  };
  data.purchaseOrderLines.push(line);
  touch(order);
  save();
  return { order, line };
}

export interface CartLinePatch {
  qty?: number;
  note?: string;
  /** Hela kronor. null = ta bort det explicita priset (tillbaka till regeln). */
  customerUnitPriceKr?: number | null;
}

export function requireLine(lineId: string): PurchaseOrderLine {
  const line = purchaseOrderLinesAll().find((l) => l.id === lineId);
  if (!line) throw new Error("Raden finns inte.");
  return line;
}

export function updateCartLine(lineId: string, patch: CartLinePatch): PurchaseOrderLine {
  const line = requireLine(lineId);
  const order = requireDraft(line.orderId);
  if (patch.qty !== undefined) line.qty = assertQty(patch.qty);
  if (patch.note !== undefined) {
    const note = neutralizeFormula(String(patch.note).trim()).slice(0, 300);
    if (note) line.note = note;
    else delete line.note;
  }
  if (patch.customerUnitPriceKr !== undefined) applyCustomerPrice(line, patch.customerUnitPriceKr);
  line.updatedAt = new Date().toISOString();
  touch(order);
  save();
  return line;
}

/**
 * Explicit kundpris vinner alltid; null återgår till anslutningens regel
 * (utpris från fil / påslag / saknas).
 */
async function ruleCustomerPrice(line: PurchaseOrderLine, connection: WholesalerConnection): Promise<CustomerPrice> {
  if (!line.productId) return { source: "missing" };
  const [product] = await catalogProductsByIds(connection.id, [line.productId]);
  if (!product) return { source: "missing" };
  return customerPriceForProduct(product, connection.customerPriceRule);
}

function applyCustomerPrice(line: PurchaseOrderLine, kr: number | null): void {
  const value = assertCustomerPriceKr(kr);
  if (value == null) {
    delete line.customerUnitPriceOre;
    line.customerPriceSource = "missing";
    return;
  }
  line.customerUnitPriceOre = wholeKronorToOre(value);
  line.customerPriceSource = "explicit";
}

/** Ta bort explicit pris och räkna om från regeln (asynkront: katalogen). */
export async function resetLineCustomerPrice(lineId: string): Promise<PurchaseOrderLine> {
  const line = requireLine(lineId);
  const order = requirePurchaseOrder(line.orderId);
  const connection = requireWholesalerConnection(order.connectionId);
  const price = await ruleCustomerPrice(line, connection);
  if (price.ore != null) {
    line.customerUnitPriceOre = price.ore;
    line.customerPriceSource = price.source;
  } else {
    delete line.customerUnitPriceOre;
    line.customerPriceSource = "missing";
  }
  line.updatedAt = new Date().toISOString();
  touch(order);
  save();
  return line;
}

/**
 * Kundpris får sättas även på skickade rader ("Ange kundpris") – det ändrar
 * inte vad grossisten fick, bara vad kunden debiteras.
 */
export function setLineCustomerPrice(lineId: string, kr: number | null): PurchaseOrderLine {
  const line = requireLine(lineId);
  const order = requirePurchaseOrder(line.orderId);
  if (order.status === "cancelled") throw new Error("Beställningen är avbruten.");
  applyCustomerPrice(line, kr);
  line.updatedAt = new Date().toISOString();
  touch(order);
  save();
  return line;
}

export function removeCartLine(lineId: string): void {
  const data = db();
  const line = requireLine(lineId);
  const order = requireDraft(line.orderId);
  data.purchaseOrderLines = purchaseOrderLinesAll().filter((l) => l.id !== lineId);
  touch(order);
  save();
}

export interface CartDetailsPatch {
  delivery?: Partial<PurchaseOrderDelivery>;
  ordererName?: string;
  ordererEmail?: string;
  ordererPhone?: string;
  message?: string;
  ccSelf?: boolean;
}

export function updateCartDetails(orderId: string, patch: CartDetailsPatch): PurchaseOrder {
  const order = requireDraft(orderId);
  if (patch.delivery) {
    const d = patch.delivery;
    const next: PurchaseOrderDelivery = { mode: isDeliveryMode(d.mode) ? d.mode : order.delivery.mode };
    const store = d.store !== undefined ? String(d.store).trim().slice(0, 120) : order.delivery.store;
    const address = d.address !== undefined ? String(d.address).trim().slice(0, 200) : order.delivery.address;
    const date = d.requestedDate !== undefined ? String(d.requestedDate).trim().slice(0, 10) : order.delivery.requestedDate;
    if (store) next.store = store;
    if (address) next.address = address;
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Ange önskat datum som ett datum.");
      next.requestedDate = date;
    }
    order.delivery = next;
  }
  if (patch.ordererName !== undefined) order.ordererName = String(patch.ordererName).trim().slice(0, 80);
  if (patch.ordererEmail !== undefined) order.ordererEmail = String(patch.ordererEmail).trim().toLowerCase().slice(0, 120);
  if (patch.ordererPhone !== undefined) order.ordererPhone = String(patch.ordererPhone).trim().slice(0, 40);
  if (patch.message !== undefined) {
    const message = neutralizeFormula(String(patch.message).trim()).slice(0, 2000);
    if (message) order.message = message;
    else delete order.message;
  }
  if (patch.ccSelf !== undefined) order.ccSelf = patch.ccSelf === true;
  touch(order);
  save();
  return order;
}

/** Släng en tom/oönskad varukorg (bara utkast). */
export function discardCart(orderId: string): void {
  const data = db();
  const order = requireDraft(orderId);
  data.purchaseOrderLines = purchaseOrderLinesAll().filter((l) => l.orderId !== order.id);
  data.purchaseOrders = purchaseOrders().filter((o) => o.id !== order.id);
  save();
}

/** Radera utkast när ett uppdrag hårdraderas (skickade order gör uppdraget arkiverbart i stället). */
export function discardDraftCartsForJob(jobId: string): void {
  const data = db();
  const drafts = draftCartsForJob(jobId).map((o) => o.id);
  if (drafts.length === 0) return;
  const set = new Set(drafts);
  data.purchaseOrderLines = purchaseOrderLinesAll().filter((l) => !set.has(l.orderId));
  data.purchaseOrders = purchaseOrders().filter((o) => !set.has(o.id));
}

export function cancelDraftOrder(orderId: string): PurchaseOrder {
  const order = requireDraft(orderId);
  order.status = "cancelled";
  order.cancelledAt = new Date().toISOString();
  touch(order);
  save();
  return order;
}

/**
 * Avbryt i Ferva. Skickade beställningar kan avbrytas så länge grossisten
 * inte bekräftat något – Ferva skickar ingen avbokning, användaren kontaktar
 * grossisten själv. Bekräftade order avbryts inte (historiken är låst).
 */
export function cancelOrder(orderId: string): PurchaseOrder {
  const order = getPurchaseOrder(orderId);
  if (!order) throw new Error("Beställningen finns inte.");
  if (order.status === "cancelled") return order;
  if (order.status !== "draft" && order.status !== "sent" && order.status !== "needs_review") {
    throw new Error("Beställningen har redan bekräftats av grossisten och kan inte avbrytas här.");
  }
  order.status = "cancelled";
  order.cancelledAt = new Date().toISOString();
  touch(order);
  save();
  return order;
}

/* --------------------------------- summering ------------------------------- */

export interface CartTotals {
  lineCount: number;
  /** Förväntad inköpskostnad – bara när alla rader har inköpspris. */
  expectedCostOre?: number;
  missingCostCount: number;
  /** Kundpris totalt – bara när alla rader har kundpris. */
  customerTotalOre?: number;
  missingCustomerPriceCount: number;
}

export function cartTotals(lines: PurchaseOrderLine[]): CartTotals {
  const missingCost = lines.filter((l) => l.unitCostOre == null).length;
  const missingCustomer = lines.filter((l) => !hasCustomerPrice(l)).length;
  const totals: CartTotals = {
    lineCount: lines.length,
    missingCostCount: missingCost,
    missingCustomerPriceCount: missingCustomer,
  };
  if (lines.length > 0 && missingCost === 0) {
    totals.expectedCostOre = lines.reduce((s, l) => s + Math.round(l.qty * (l.unitCostOre ?? 0)), 0);
  }
  if (lines.length > 0 && missingCustomer === 0) {
    totals.customerTotalOre = lines.reduce((s, l) => s + Math.round(l.qty * (l.customerUnitPriceOre ?? 0)), 0);
  }
  return totals;
}

/* --------------------------------- utskick --------------------------------- */

export function sendBlockers(order: PurchaseOrder): string[] {
  const blockers: string[] = [];
  const lines = purchaseOrderLines(order.id);
  const connection = requireWholesalerConnection(order.connectionId);
  const s = db().settings;
  if (lines.length === 0) blockers.push("Lägg till minst en artikel.");
  if (!connection.active) blockers.push(`${connectionLabel(connection)} är inaktiverad.`);
  if (!connection.orderEmail || !isEmailFormat(connection.orderEmail)) {
    blockers.push("Grossisten saknar ordermejl. Lägg till den under Inställningar → Grossister.");
  }
  if (!connection.customerNumber.trim()) blockers.push("Kundnummer hos grossisten saknas.");
  if (!s.name.trim()) blockers.push("Företagsnamn saknas under Inställningar → Företag.");
  if (!s.orgNumber.trim()) blockers.push("Organisationsnummer saknas under Inställningar → Företag.");
  if (!order.ordererName.trim()) blockers.push("Ange beställarens namn.");
  if (!order.ordererEmail.trim() || !isEmailFormat(order.ordererEmail)) blockers.push("Ange beställarens e-post.");
  if (!order.ordererPhone.trim()) blockers.push("Ange beställarens telefon.");
  if (order.delivery.mode === "pickup" && !order.delivery.store?.trim()) {
    blockers.push("Ange butik eller hämtningsplats.");
  }
  if (order.delivery.mode === "delivery" && !order.delivery.address?.trim()) {
    blockers.push("Ange leveransadress.");
  }
  if (lines.some((l) => !(l.qty > 0))) blockers.push("Alla rader behöver ett antal.");
  return blockers;
}

export function snapshotLines(lines: PurchaseOrderLine[]): PurchaseOrderSnapshotLine[] {
  return lines.map((l) => ({
    lineId: l.id,
    ...(l.articleNumber ? { articleNumber: l.articleNumber } : {}),
    name: l.name,
    ...(l.eNumber ? { eNumber: l.eNumber } : {}),
    ...(l.rskNumber ? { rskNumber: l.rskNumber } : {}),
    qty: l.qty,
    unit: l.unit,
    ...(l.packSize != null ? { packSize: l.packSize } : {}),
    ...(l.unitCostOre != null ? { unitCostOre: l.unitCostOre } : {}),
    ...(l.note ? { note: l.note } : {}),
  }));
}

export interface PurchaseOrderMailPreview {
  to: string;
  cc?: string;
  replyTo: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  attachments: { filename: string; contentType: string }[];
  blockers: string[];
}

function mailInputFor(order: PurchaseOrder, connection: WholesalerConnection): PurchaseOrderMailInput {
  const s = db().settings;
  const job = requireJob(order.jobId);
  const customer = requireCustomer(job.customerId);
  const lines = snapshotLines(purchaseOrderLines(order.id));
  const cost = expectedCostOre(lines);
  return {
    reference: order.reference,
    // Svar hamnar i företagets Ferva-inbox – samma slug som Inbox visar.
    replyTo: inboundMailAddress(s.inboundMailSlug || "demo"),
    companyName: s.name,
    orgNumber: s.orgNumber,
    wholesalerName: connectionLabel(connection),
    customerNumber: connection.customerNumber,
    orderer: { name: order.ordererName, email: order.ordererEmail, phone: order.ordererPhone },
    jobTitle: `${job.title} (${customer.name})`,
    delivery: order.delivery,
    ...(order.message ? { message: order.message } : {}),
    lines,
    ...(cost != null ? { expectedCostOre: cost } : {}),
  };
}

export function buildPurchaseOrderMessage(order: PurchaseOrder): {
  message: MailMessage;
  input: PurchaseOrderMailInput;
  connection: WholesalerConnection;
} {
  const connection = requireWholesalerConnection(order.connectionId);
  const input = mailInputFor(order, connection);
  const subject = purchaseOrderSubject({
    reference: order.reference,
    companyName: input.companyName,
    customerNumber: input.customerNumber,
  });
  const cc = order.ccSelf && isEmailFormat(order.ordererEmail) ? [order.ordererEmail] : [];
  const message: MailMessage = {
    to: connection.orderEmail,
    from: mailFromWithDisplayName(`${input.companyName} via Ferva`),
    replyTo: input.replyTo,
    cc,
    subject,
    text: purchaseOrderText(input),
    html: purchaseOrderHtml(input),
    attachments: [
      {
        filename: `bestallning-${order.reference}.pdf`,
        content: purchaseOrderPdf(input),
        contentType: "application/pdf",
      },
      {
        filename: `bestallning-${order.reference}.csv`,
        content: Buffer.from(purchaseOrderCsv(input), "utf8"),
        contentType: "text/csv",
      },
    ],
  };
  return { message, input, connection };
}

export function previewPurchaseOrderMail(orderId: string): PurchaseOrderMailPreview {
  const order = requirePurchaseOrder(orderId);
  const blockers = order.status === "draft" ? sendBlockers(order) : [];
  const { message } = buildPurchaseOrderMessage(order);
  return {
    to: message.to,
    ...(message.cc && message.cc.length > 0 ? { cc: message.cc.join(", ") } : {}),
    replyTo: message.replyTo ?? "",
    from: message.from,
    subject: message.subject,
    text: message.text,
    html: message.html,
    attachments: (message.attachments ?? []).map((a) => ({ filename: a.filename, contentType: a.contentType ?? "" })),
    blockers,
  };
}

export type SendPurchaseOrderOutcome =
  | { ok: true; order: PurchaseOrder; mode: MailResult["mode"]; alreadySent: boolean; simulated: boolean }
  | { ok: false; error: string; blockers?: string[] };

const sendLocks = new Map<string, Promise<SendPurchaseOrderOutcome>>();

/* Enkel takt per företag: högst så här många utskick per fönster. */
const SEND_WINDOW_MS = 10 * 60_000;
const SEND_MAX_PER_WINDOW = 30;
const sendWindows = new Map<string, number[]>();

export function rateLimitOrderSend(key: string, now = Date.now()): boolean {
  const hits = (sendWindows.get(key) ?? []).filter((t) => now - t < SEND_WINDOW_MS);
  if (hits.length >= SEND_MAX_PER_WINDOW) {
    sendWindows.set(key, hits);
    return false;
  }
  hits.push(now);
  sendWindows.set(key, hits);
  return true;
}

export function __resetOrderSendRateLimitForTests(): void {
  sendWindows.clear();
}

/**
 * Skicka beställningen. Idempotent: samma sendKey på en redan skickad order
 * returnerar det befintliga utfallet utan nytt mejl; parallella anrop delar
 * ett lås per order.
 */
export async function sendPurchaseOrder(orderId: string, sendKey: string): Promise<SendPurchaseOrderOutcome> {
  const existing = sendLocks.get(orderId);
  if (existing) return existing;
  const pending = sendPurchaseOrderOnce(orderId, sendKey).finally(() => sendLocks.delete(orderId));
  sendLocks.set(orderId, pending);
  return pending;
}

async function sendPurchaseOrderOnce(orderId: string, sendKey: string): Promise<SendPurchaseOrderOutcome> {
  const key = String(sendKey ?? "").trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) return { ok: false, error: "Ogiltig utskicksnyckel. Ladda om sidan och försök igen." };
  const order = requirePurchaseOrder(orderId);
  if (order.status !== "draft") {
    if (order.sentAt && (order.sendKey === key || !order.sendKey)) {
      return {
        ok: true,
        order,
        mode: order.lastEmail ? "live" : "demo",
        alreadySent: true,
        simulated: order.sentSnapshot?.transport === "simulated",
      };
    }
    return { ok: false, error: "Beställningen är redan skickad." };
  }
  const blockers = sendBlockers(order);
  if (blockers.length > 0) return { ok: false, error: blockers[0], blockers };

  const businessKey = tenantContext()?.businessId ?? "local";
  if (!rateLimitOrderSend(businessKey)) {
    return { ok: false, error: "Många beställningar skickades nyss. Vänta en liten stund och försök igen." };
  }

  const { message, input, connection } = buildPurchaseOrderMessage(order);
  order.lastSendAttemptAt = new Date().toISOString();
  save();

  const meta: MailSendMeta = {
    kind: "purchase_order",
    documentId: order.id,
    businessId: tenantContext()?.businessId,
  };
  const result = await sendMail(message, meta);
  if (!result.ok) {
    return { ok: false, error: userFacingSendError(result, PURCHASE_ORDER_SEND_FAILED) };
  }

  // Mockläge (ingen e-posttjänst) är bara ärligt i demo-/utvecklingsmiljö –
  // ett riktigt företag i produktion får aldrig en "skickad" order utan leverans.
  const simulated = result.mode === "demo" || result.mode === "mock";
  if (result.mode === "mock" && !isDemoMode() && !isDemoBusiness()) {
    return { ok: false, error: PURCHASE_ORDER_MAIL_NOT_CONFIGURED };
  }

  const sentAt = new Date().toISOString();
  const snapshot: PurchaseOrderSentSnapshot = {
    sentAt,
    channel: "email",
    transport: simulated ? "simulated" : "live",
    to: message.to,
    ...(message.cc && message.cc.length > 0 ? { cc: message.cc.join(", ") } : {}),
    replyTo: message.replyTo ?? input.replyTo,
    subject: message.subject,
    companyName: input.companyName,
    orgNumber: input.orgNumber,
    wholesalerName: input.wholesalerName,
    customerNumber: input.customerNumber,
    orderer: input.orderer,
    jobTitle: input.jobTitle,
    delivery: input.delivery,
    ...(input.message ? { message: input.message } : {}),
    lines: input.lines,
    ...(input.expectedCostOre != null ? { expectedCostOre: input.expectedCostOre } : {}),
    textBody: message.text,
  };
  order.status = "sent";
  order.sentAt = sentAt;
  order.sentSnapshot = snapshot;
  order.sendKey = key;
  if (result.messageId) {
    order.lastEmail = { provider: "resend", messageId: result.messageId, sentTo: message.to };
  }
  touch(order);
  const job = requireJob(order.jobId);
  const customer = requireCustomer(job.customerId);
  logActivity(
    simulated
      ? `Beställning ${order.reference} till ${connectionLabel(connection)} simulerades (demo) för ${job.title}.`
      : `Skickade beställning ${order.reference} till ${connectionLabel(connection)} för ${job.title}.`,
    { customerId: customer.id, entity: { type: "jobb", id: job.id } },
  );
  save();
  return { ok: true, order, mode: result.mode, alreadySent: false, simulated };
}

/** Sätt grossistens ordernummer manuellt (t.ex. från telefonsamtal). */
export function setWholesalerOrderNumber(orderId: string, value: string): PurchaseOrder {
  const order = requirePurchaseOrder(orderId);
  if (order.status === "draft") throw new Error("Skicka beställningen först.");
  const clean = String(value ?? "").trim().slice(0, 60);
  if (clean) order.wholesalerOrderNumber = clean;
  else delete order.wholesalerOrderNumber;
  touch(order);
  save();
  return order;
}
