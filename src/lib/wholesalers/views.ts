/**
 * Serialiserbara vyer som skickas till klientkomponenterna (uppdragets
 * materialyta och beställningssidan). Klientsäker – bara typer och små
 * hjälpare.
 */
import type { PurchaseOrder, PurchaseOrderLine } from "../types";

export interface CartTotalsView {
  lineCount: number;
  expectedCostOre?: number;
  missingCostCount: number;
  customerTotalOre?: number;
  missingCustomerPriceCount: number;
}

export interface CartView {
  order: PurchaseOrder;
  lines: PurchaseOrderLine[];
  totals: CartTotalsView;
}

/** Vad materialytan behöver veta om en grossist för att söka och beställa. */
export interface WholesalerPickerConnection {
  id: string;
  label: string;
  hasPriceList: boolean;
  priceDate: string | null;
  stale: boolean;
  defaultDeliveryMode: "pickup" | "delivery";
}

export interface JobWholesalerContext {
  enabled: boolean;
  connections: WholesalerPickerConnection[];
  carts: CartView[];
  /** Demo: utskick simuleras och en demobekräftelse kommer tillbaka. */
  demo: boolean;
}

export function cartLineCount(cart: CartView | undefined): number {
  return cart?.lines.length ?? 0;
}
