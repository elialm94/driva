/**
 * Uppdragets grossistkontext för sidorenderingen: vad materialytan behöver
 * (aktiva grossister + varukorgar) och den kompakta sektionen
 * Materialbeställningar. Läses i tenantkontext (ensurePageBusiness).
 */
import { db } from "../store";
import { wholesalersEnabled } from "../features";
import type { PurchaseOrder } from "../types";
import type { CartView, JobWholesalerContext } from "../wholesalers/views";
import { connectionLabel, priceListIsStale } from "../wholesalers/labels";
import { isWholesalerDemoContext } from "../wholesalers/demo";
import { activeImportFor, activeWholesalerConnections, getWholesalerConnection } from "./wholesalers";
import { cartTotals, ordersForJob, purchaseOrderLines } from "./purchase-orders";
import { orderReview, type OrderReview } from "./purchase-order-confirmations";

export function cartViewFor(order: PurchaseOrder): CartView {
  const lines = purchaseOrderLines(order.id);
  return { order, lines, totals: cartTotals(lines) };
}

export function jobWholesalerContext(jobId: string): JobWholesalerContext {
  const enabled = wholesalersEnabled(db());
  if (!enabled) return { enabled: false, connections: [], carts: [], demo: false };
  const connections = activeWholesalerConnections().map((c) => {
    const active = activeImportFor(c);
    return {
      id: c.id,
      label: connectionLabel(c),
      hasPriceList: Boolean(active),
      priceDate: active?.priceDate ?? null,
      stale: active ? priceListIsStale(active.priceDate) : false,
      defaultDeliveryMode: c.defaultDeliveryMode,
    };
  });
  const carts = ordersForJob(jobId)
    .filter((o) => o.status === "draft")
    .map(cartViewFor);
  return { enabled: true, connections, carts, demo: isWholesalerDemoContext() };
}

export interface JobPurchaseOrderRow {
  order: PurchaseOrder;
  wholesalerName: string;
  lineCount: number;
  review: OrderReview;
}

/**
 * Sektionen Materialbeställningar visas bara när något finns att visa:
 * funktionen på + varukorg/order, eller historiska order (även avstängd).
 */
export function jobPurchaseOrderRows(jobId: string): JobPurchaseOrderRow[] {
  const orders = ordersForJob(jobId).filter((o) => o.status !== "cancelled" || confirmationsExist(o));
  return orders
    .slice()
    .sort((a, b) => (b.sentAt ?? b.createdAt).localeCompare(a.sentAt ?? a.createdAt))
    .map((order) => {
      const connection = getWholesalerConnection(order.connectionId);
      return {
        order,
        wholesalerName: connection ? connectionLabel(connection) : "Grossist",
        lineCount: purchaseOrderLines(order.id).length,
        review: orderReview(order.id),
      };
    });
}

function confirmationsExist(order: PurchaseOrder): boolean {
  return (db().purchaseOrderConfirmations ?? []).some((c) => c.orderId === order.id);
}
