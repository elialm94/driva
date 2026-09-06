/**
 * Svenska etiketter för grossistflödet – klientsäker (inga store-beroenden).
 */
import type {
  PurchaseOrderCustomerPriceSource,
  PurchaseOrderDeviationKind,
  WholesalerConnection,
  WholesalerCustomerPriceRule,
  WholesalerDeliveryMode,
  WholesalerKey,
} from "../types";

export const WHOLESALER_KEYS: WholesalerKey[] = ["ahlsell", "dahl", "sonepar", "solar", "lundagrossisten", "rexel", "other"];

export const WHOLESALER_NAMES: Record<WholesalerKey, string> = {
  ahlsell: "Ahlsell",
  dahl: "Dahl",
  sonepar: "Sonepar",
  solar: "Solar",
  lundagrossisten: "Lundagrossisten",
  rexel: "Rexel",
  other: "Annan grossist",
};

export function isWholesalerKey(value: unknown): value is WholesalerKey {
  return typeof value === "string" && (WHOLESALER_KEYS as string[]).includes(value);
}

/** Visningsnamn: eget namn om satt, annars grossistens. */
export function connectionLabel(c: Pick<WholesalerConnection, "wholesaler" | "displayName">): string {
  const own = c.displayName?.trim();
  if (own) return own;
  return WHOLESALER_NAMES[c.wholesaler] ?? "Grossist";
}

export const DELIVERY_MODE_LABELS: Record<WholesalerDeliveryMode, string> = {
  pickup: "Hämtning",
  delivery: "Leverans",
};

export function isDeliveryMode(value: unknown): value is WholesalerDeliveryMode {
  return value === "pickup" || value === "delivery";
}

export function customerPriceRuleLabel(rule: WholesalerCustomerPriceRule): string {
  switch (rule.kind) {
    case "file_sales_price":
      return "Utpris från prisfilen";
    case "markup":
      return `Inköpspris + ${rule.percent.toLocaleString("sv-SE")} % påslag`;
    case "later":
      return "Ange kundpris senare";
  }
}

export const CUSTOMER_PRICE_SOURCE_LABELS: Record<PurchaseOrderCustomerPriceSource, string> = {
  explicit: "Angivet av dig",
  file: "Utpris från prisfilen",
  markup: "Beräknat med påslag",
  missing: "Kundpris saknas",
};

export const DEVIATION_LABELS: Record<PurchaseOrderDeviationKind, string> = {
  qty: "Ändrat antal",
  price: "Ändrat pris",
  backorder: "Restnoterad",
  substitute: "Ersättningsartikel",
  missing: "Saknas i bekräftelsen",
  added: "Tillagd artikel",
  delivery_date: "Ändrat leveransdatum",
  total: "Totalen går inte ihop",
};

/** "Dina priser uppdaterades 4 september 2026" / "Prisfilen kan behöva uppdateras". */
export const PRICE_LIST_STALE_DAYS = 90;

export function priceListIsStale(priceDate: string, now = new Date()): boolean {
  const t = Date.parse(`${priceDate}T12:00:00Z`);
  if (Number.isNaN(t)) return false;
  return now.getTime() - t > PRICE_LIST_STALE_DAYS * 86_400_000;
}
