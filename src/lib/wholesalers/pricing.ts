/**
 * Kundpris för en grossistartikel/orderrad – klientsäker, ren logik.
 *
 * Precedens (samma överallt: sök, varukorg, bekräftelse, uppdrag):
 *   1. användarens uttryckliga pris på raden
 *   2. utpris från prisfilen – bara om anslutningen valt det
 *   3. beräknat från användarens påslag på inköpspriset
 *   4. annars "Kundpris saknas" (raden blir aldrig fakturerbar till 0 kr)
 *
 * Kundpriser är alltid hela kronor (appens fakturamodell) – lagras som ören
 * som multipel av 100.
 */
import type {
  PurchaseOrderCustomerPriceSource,
  PurchaseOrderLine,
  WholesalerCustomerPriceRule,
  WholesalerProduct,
} from "../types";
import { customerPriceFromMarkupOre, wholeKronorToOre } from "./money";

export interface CustomerPrice {
  ore?: number;
  source: PurchaseOrderCustomerPriceSource;
}

export function customerPriceForProduct(
  product: Pick<WholesalerProduct, "netPriceOre" | "salesPriceOre">,
  rule: WholesalerCustomerPriceRule,
): CustomerPrice {
  if (rule.kind === "file_sales_price") {
    if (product.salesPriceOre != null) {
      return { ore: wholeKronorToOre(Math.round(product.salesPriceOre / 100)), source: "file" };
    }
    return { source: "missing" };
  }
  if (rule.kind === "markup") {
    if (product.netPriceOre != null) {
      return { ore: customerPriceFromMarkupOre(product.netPriceOre, rule.percent), source: "markup" };
    }
    return { source: "missing" };
  }
  return { source: "missing" };
}

/** Radens gällande kundpris (explicit vinner alltid). */
export function lineCustomerPrice(
  line: Pick<PurchaseOrderLine, "customerUnitPriceOre" | "customerPriceSource">,
): CustomerPrice {
  if (line.customerUnitPriceOre != null && line.customerPriceSource !== "missing") {
    return { ore: line.customerUnitPriceOre, source: line.customerPriceSource };
  }
  return { source: "missing" };
}

export function hasCustomerPrice(line: Pick<PurchaseOrderLine, "customerUnitPriceOre" | "customerPriceSource">): boolean {
  return lineCustomerPrice(line).ore != null;
}
