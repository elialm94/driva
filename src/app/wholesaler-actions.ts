"use server";

/**
 * Grossistbeställningar – server actions.
 *
 * Alla anrop går via withBusiness/withBusinessRead (tenantkontext + roll).
 * business_id kommer aldrig från klienten. Konfiguration (grossister,
 * prisfiler) kräver manage_wholesalers (ägare/admin); varukorg och utskick
 * kräver order_materials (ägare/admin/medlem). Utskicket körs utan retry –
 * det pratar med e-postleverantören och får aldrig köras om automatiskt.
 */
import { revalidatePath } from "next/cache";
import { withBusiness, withBusinessRead } from "@/lib/auth/session";
import { db } from "@/lib/store";
import { userFacingStorageError } from "@/lib/storage/sql-errors";
import type { WholesalerColumnMapping } from "@/lib/types";
import type { CartView } from "@/lib/wholesalers/views";
import { wholesalersEnabled } from "@/lib/features";
import {
  createWholesalerConnection,
  searchWholesalerProducts,
  setWholesalerConnectionActive,
  updateWholesalerConnection,
  type WholesalerSearchResult,
} from "@/lib/services/wholesalers";
import {
  addCatalogProductToCart,
  addFreeTextLineToCart,
  cancelOrder,
  cartTotals,
  discardCart,
  previewPurchaseOrderMail,
  purchaseOrderLines,
  removeCartLine,
  requirePurchaseOrder,
  sendPurchaseOrder,
  setLineCustomerPrice,
  setWholesalerOrderNumber,
  updateCartDetails,
  updateCartLine,
  type CartDetailsPatch,
  type CartLinePatch,
  type PurchaseOrderMailPreview,
} from "@/lib/services/purchase-orders";
import {
  addManualConfirmation,
  approveConfirmation,
  clearInboxOrderCandidates,
  dismissConfirmation,
  linkInboxItemToOrder,
  markOrderRejected,
  syncAfterCustomerPrice,
  type ManualConfirmationLineInput,
} from "@/lib/services/purchase-order-confirmations";
import { ingestEconomicDocument } from "@/lib/services/inbox";
import { demoConfirmationPayload, isWholesalerDemoContext } from "@/lib/wholesalers/demo";

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; error: string };
export type WholesalerActionResult<T = object> = Ok<T> | Fail;

const MANAGE = { capability: "manage_wholesalers" } as const;
const ORDER = { capability: "order_materials" } as const;
const ORDER_NO_RETRY = { capability: "order_materials", retry: false } as const;

function refreshAll() {
  revalidatePath("/", "layout");
}

function fail(err: unknown, fallback: string): Fail {
  return { ok: false, error: userFacingStorageError(err, fallback) };
}

function assertEnabled(): void {
  if (!wholesalersEnabled(db())) {
    throw new Error("Grossistbeställningar är avstängd. Aktivera funktionen under Inställningar → Funktioner.");
  }
}

/* -------------------------------- grossister ------------------------------- */

export async function saveWholesalerConnectionAction(
  input: unknown,
  id?: string,
): Promise<WholesalerActionResult<{ id: string }>> {
  try {
    return await withBusiness(() => {
      assertEnabled();
      const connection = id ? updateWholesalerConnection(id, input) : createWholesalerConnection(input);
      refreshAll();
      return { ok: true, id: connection.id } as const;
    }, MANAGE);
  } catch (e) {
    return fail(e, "Grossisten kunde inte sparas. Försök igen.");
  }
}

export async function setWholesalerConnectionActiveAction(id: string, active: boolean): Promise<WholesalerActionResult> {
  try {
    return await withBusiness(() => {
      assertEnabled();
      setWholesalerConnectionActive(id, active === true);
      refreshAll();
      return { ok: true } as const;
    }, MANAGE);
  } catch (e) {
    return fail(e, "Ändringen kunde inte sparas.");
  }
}

/* ----------------------------------- sök ----------------------------------- */

export async function searchWholesalerProductsAction(input: {
  connectionId: string;
  query: string;
  page?: number;
}): Promise<WholesalerActionResult<{ result: WholesalerSearchResult }>> {
  try {
    const result = await withBusinessRead(async () => {
      assertEnabled();
      return searchWholesalerProducts({
        connectionId: String(input.connectionId ?? ""),
        query: String(input.query ?? ""),
        page: typeof input.page === "number" ? input.page : 1,
      });
    });
    return { ok: true, result };
  } catch (e) {
    return fail(e, "Sökningen kunde inte genomföras.");
  }
}

/* -------------------------------- varukorg --------------------------------- */

function cartView(orderId: string): CartView {
  const order = requirePurchaseOrder(orderId);
  const lines = purchaseOrderLines(orderId);
  return { order, lines, totals: cartTotals(lines) };
}

export async function addCatalogProductToCartAction(input: {
  jobId: string;
  connectionId: string;
  productId: string;
  qty: number;
}): Promise<WholesalerActionResult<{ cart: CartView }>> {
  try {
    return await withBusiness(async () => {
      assertEnabled();
      const { order } = await addCatalogProductToCart({
        jobId: String(input.jobId),
        connectionId: String(input.connectionId),
        productId: String(input.productId),
        qty: Number(input.qty),
      });
      refreshAll();
      return { ok: true, cart: cartView(order.id) } as const;
    }, ORDER);
  } catch (e) {
    return fail(e, "Artikeln kunde inte läggas i varukorgen.");
  }
}

export async function addFreeTextLineAction(input: {
  jobId: string;
  connectionId: string;
  name: string;
  qty: number;
  unit?: string;
  articleNumber?: string;
  note?: string;
  customerUnitPriceKr?: number | null;
}): Promise<WholesalerActionResult<{ cart: CartView }>> {
  try {
    return await withBusiness(() => {
      assertEnabled();
      const { order } = addFreeTextLineToCart({
        jobId: String(input.jobId),
        connectionId: String(input.connectionId),
        name: String(input.name ?? ""),
        qty: Number(input.qty),
        unit: input.unit,
        articleNumber: input.articleNumber,
        note: input.note,
        customerUnitPriceKr: input.customerUnitPriceKr,
      });
      refreshAll();
      return { ok: true, cart: cartView(order.id) } as const;
    }, ORDER);
  } catch (e) {
    return fail(e, "Raden kunde inte läggas till.");
  }
}

export async function updateCartLineAction(lineId: string, patch: CartLinePatch): Promise<WholesalerActionResult<{ cart: CartView }>> {
  try {
    return await withBusiness(() => {
      assertEnabled();
      const line = updateCartLine(String(lineId), patch ?? {});
      refreshAll();
      return { ok: true, cart: cartView(line.orderId) } as const;
    }, ORDER);
  } catch (e) {
    return fail(e, "Raden kunde inte ändras.");
  }
}

export async function removeCartLineAction(lineId: string): Promise<WholesalerActionResult<{ cart: CartView | null }>> {
  try {
    return await withBusiness(() => {
      assertEnabled();
      const orderId = (db().purchaseOrderLines ?? []).find((l) => l.id === lineId)?.orderId;
      removeCartLine(String(lineId));
      refreshAll();
      return { ok: true, cart: orderId ? cartView(orderId) : null } as const;
    }, ORDER);
  } catch (e) {
    return fail(e, "Raden kunde inte tas bort.");
  }
}

export async function updateCartDetailsAction(orderId: string, patch: CartDetailsPatch): Promise<WholesalerActionResult<{ cart: CartView }>> {
  try {
    return await withBusiness(() => {
      assertEnabled();
      updateCartDetails(String(orderId), patch ?? {});
      refreshAll();
      return { ok: true, cart: cartView(orderId) } as const;
    }, ORDER);
  } catch (e) {
    return fail(e, "Uppgifterna kunde inte sparas.");
  }
}

export async function discardCartAction(orderId: string): Promise<WholesalerActionResult> {
  try {
    return await withBusiness(() => {
      assertEnabled();
      discardCart(String(orderId));
      refreshAll();
      return { ok: true } as const;
    }, ORDER);
  } catch (e) {
    return fail(e, "Varukorgen kunde inte tas bort.");
  }
}

/* --------------------------------- utskick --------------------------------- */

export async function previewPurchaseOrderMailAction(
  orderId: string,
): Promise<WholesalerActionResult<{ preview: PurchaseOrderMailPreview }>> {
  try {
    const preview = await withBusinessRead(() => {
      assertEnabled();
      return previewPurchaseOrderMail(String(orderId));
    });
    return { ok: true, preview };
  } catch (e) {
    return fail(e, "Förhandsgranskningen kunde inte skapas.");
  }
}

export type SendPurchaseOrderActionResult =
  | { ok: true; reference: string; simulated: boolean; alreadySent: boolean; demoConfirmation: boolean }
  | { ok: false; error: string; blockers?: string[] };

/**
 * Skicka beställningen. Idempotent via sendKey (dubbelklick/retry). I demon
 * följs det simulerade utskicket av en deterministisk demobekräftelse i
 * inboxen – i en egen commit efter utskicket.
 */
export async function sendPurchaseOrderAction(orderId: string, sendKey: string): Promise<SendPurchaseOrderActionResult> {
  let outcome;
  try {
    outcome = await withBusiness(async () => {
      assertEnabled();
      return sendPurchaseOrder(String(orderId), String(sendKey));
    }, ORDER_NO_RETRY);
  } catch (e) {
    return fail(e, "Beställningen kunde inte skickas. Försök igen.");
  }
  if (!outcome.ok) return { ok: false, error: outcome.error, ...(outcome.blockers ? { blockers: outcome.blockers } : {}) };

  let demoConfirmation = false;
  if (outcome.simulated && !outcome.alreadySent) {
    try {
      demoConfirmation = await withBusiness(() => {
        if (!isWholesalerDemoContext()) return false;
        const order = requirePurchaseOrder(String(orderId));
        const result = ingestEconomicDocument(demoConfirmationPayload(order), { source: "email", kind: "mail" });
        return result.ok;
      }, ORDER_NO_RETRY);
    } catch {
      // Demobekräftelsen är en bonus – utskicket är redan sparat.
      demoConfirmation = false;
    }
  }
  refreshAll();
  return {
    ok: true,
    reference: outcome.order.reference,
    simulated: outcome.simulated,
    alreadySent: outcome.alreadySent,
    demoConfirmation,
  };
}

/* ------------------------------ efter utskick ------------------------------ */

export async function setLineCustomerPriceAction(lineId: string, kr: number | null): Promise<WholesalerActionResult> {
  try {
    return await withBusiness(() => {
      assertEnabled();
      setLineCustomerPrice(String(lineId), kr);
      syncAfterCustomerPrice(String(lineId));
      refreshAll();
      return { ok: true } as const;
    }, ORDER);
  } catch (e) {
    return fail(e, "Kundpriset kunde inte sparas.");
  }
}

export async function setWholesalerOrderNumberAction(orderId: string, value: string): Promise<WholesalerActionResult> {
  try {
    return await withBusiness(() => {
      assertEnabled();
      setWholesalerOrderNumber(String(orderId), String(value ?? ""));
      refreshAll();
      return { ok: true } as const;
    }, ORDER);
  } catch (e) {
    return fail(e, "Ordernumret kunde inte sparas.");
  }
}

export async function approveConfirmationAction(confirmationId: string): Promise<WholesalerActionResult> {
  try {
    return await withBusiness(() => {
      assertEnabled();
      approveConfirmation(String(confirmationId));
      refreshAll();
      return { ok: true } as const;
    }, ORDER);
  } catch (e) {
    return fail(e, "Ändringarna kunde inte godkännas.");
  }
}

export async function dismissConfirmationAction(confirmationId: string): Promise<WholesalerActionResult> {
  try {
    return await withBusiness(() => {
      assertEnabled();
      dismissConfirmation(String(confirmationId));
      refreshAll();
      return { ok: true } as const;
    }, ORDER);
  } catch (e) {
    return fail(e, "Bekräftelsen kunde inte hanteras.");
  }
}

export async function cancelPurchaseOrderAction(orderId: string): Promise<WholesalerActionResult> {
  try {
    return await withBusiness(() => {
      assertEnabled();
      cancelOrder(String(orderId));
      refreshAll();
      return { ok: true } as const;
    }, ORDER);
  } catch (e) {
    return fail(e, "Beställningen kunde inte avbrytas.");
  }
}

export async function setPurchaseOrderLineCustomerPriceAction(lineId: string, kr: number | null): Promise<WholesalerActionResult> {
  return setLineCustomerPriceAction(lineId, kr);
}

export async function linkConfirmationToOrderAction(itemId: string, orderId: string): Promise<WholesalerActionResult<{ orderId: string }>> {
  return linkInboxItemToOrderAction(itemId, orderId);
}

export async function markOrderRejectedAction(orderId: string): Promise<WholesalerActionResult> {
  try {
    return await withBusiness(() => {
      assertEnabled();
      markOrderRejected(String(orderId));
      refreshAll();
      return { ok: true } as const;
    }, ORDER);
  } catch (e) {
    return fail(e, "Statusen kunde inte ändras.");
  }
}

export async function addManualConfirmationAction(input: {
  orderId: string;
  orderNumber?: string;
  deliveryDate?: string;
  lines: ManualConfirmationLineInput[];
  message?: string;
}): Promise<WholesalerActionResult> {
  try {
    return await withBusiness(() => {
      assertEnabled();
      addManualConfirmation({
        orderId: String(input.orderId),
        orderNumber: input.orderNumber,
        deliveryDate: input.deliveryDate,
        lines: Array.isArray(input.lines) ? input.lines : [],
        message: input.message,
      });
      refreshAll();
      return { ok: true } as const;
    }, ORDER);
  } catch (e) {
    return fail(e, "Bekräftelsen kunde inte sparas.");
  }
}

/* ---------------------------------- inbox ---------------------------------- */

export async function linkInboxItemToOrderAction(itemId: string, orderId: string): Promise<WholesalerActionResult<{ orderId: string }>> {
  try {
    return await withBusiness(() => {
      assertEnabled();
      const confirmation = linkInboxItemToOrder(String(itemId), String(orderId));
      refreshAll();
      return { ok: true, orderId: confirmation.orderId } as const;
    }, ORDER);
  } catch (e) {
    return fail(e, "Bekräftelsen kunde inte kopplas.");
  }
}

export async function clearInboxOrderCandidatesAction(itemId: string): Promise<WholesalerActionResult> {
  try {
    return await withBusiness(() => {
      clearInboxOrderCandidates(String(itemId));
      refreshAll();
      return { ok: true } as const;
    }, ORDER);
  } catch (e) {
    return fail(e, "Posten kunde inte ändras.");
  }
}

/** Sparad kolumnmappning för en anslutning (förhandsgranskningen läser den). */
export async function rememberedMappingAction(connectionId: string): Promise<WholesalerColumnMapping | null> {
  try {
    return await withBusinessRead(() => {
      const c = (db().wholesalerConnections ?? []).find((x) => x.id === connectionId);
      return c?.columnMapping ?? null;
    });
  } catch {
    return null;
  }
}
