/**
 * Kundpris för material – hierarki som gäller kvitto, leverantörsfaktura
 * och grossist. Aldrig 0 kr av misstag när priset saknas.
 *
 * Prioritet: 1 explicit radpris, 2 uppdragsregel, 3 kundregel,
 * 4 grossistanslutningens standard, 5 utpris från prisfil om regeln säger det,
 * 6 saknat kundpris.
 */
import type {
  MaterialCustomerPriceSource,
  WholesalerCustomerPriceRule,
} from "./types";
import { customerPriceFromMarkupOre, wholeKronorToOre } from "./wholesalers/money";

export const DEFAULT_LOW_MATERIAL_MARGIN_PERCENT = 15;

export interface MaterialPriceInput {
  explicitKronor?: number;
  jobRule?: WholesalerCustomerPriceRule;
  customerRule?: WholesalerCustomerPriceRule;
  connectionRule?: WholesalerCustomerPriceRule;
  /** Inköpspris per enhet i ören. */
  unitCostOre?: number;
  /** Utpris från prisfilen i ören. */
  salesPriceOre?: number;
}

export interface MaterialPriceResult {
  kronor?: number;
  ore?: number;
  source: MaterialCustomerPriceSource;
  rule?: WholesalerCustomerPriceRule;
  explanation: string;
}

function applyRule(
  rule: WholesalerCustomerPriceRule,
  source: MaterialCustomerPriceSource,
  input: Pick<MaterialPriceInput, "unitCostOre" | "salesPriceOre">,
  label: string
): MaterialPriceResult | undefined {
  if (rule.kind === "later") {
    return {
      source: "missing",
      rule,
      explanation: `${label}: ange kundpris senare.`,
    };
  }
  if (rule.kind === "file_sales_price") {
    if (input.salesPriceOre != null) {
      const kronor = Math.round(input.salesPriceOre / 100);
      return {
        kronor,
        ore: wholeKronorToOre(kronor),
        source: source === "connection" ? "file" : source,
        rule,
        explanation: `Utpris från prisfilen (${label}).`,
      };
    }
    return { source: "missing", rule, explanation: `${label} använder utpris, men prisfilen saknar det.` };
  }
  if (rule.kind === "markup") {
    if (input.unitCostOre != null) {
      const ore = customerPriceFromMarkupOre(input.unitCostOre, rule.percent);
      const kronor = Math.round(ore / 100);
      return {
        kronor,
        ore: wholeKronorToOre(kronor),
        source: source === "connection" ? "markup" : source,
        rule,
        explanation: `Beräknat från ${label.toLowerCase()} ${rule.percent.toLocaleString("sv-SE")} %.`,
      };
    }
    return { source: "missing", rule, explanation: `${label} använder påslag, men inköpspris saknas.` };
  }
  return undefined;
}

export function resolveMaterialCustomerPrice(input: MaterialPriceInput): MaterialPriceResult {
  if (input.explicitKronor != null && Number.isFinite(input.explicitKronor)) {
    const kronor = Math.round(input.explicitKronor);
    if (kronor >= 0) {
      return {
        kronor,
        ore: wholeKronorToOre(kronor),
        source: "explicit",
        explanation: "Angivet av dig på den här raden.",
      };
    }
  }
  if (input.jobRule) {
    const r = applyRule(input.jobRule, "job", input, "Uppdragets regel");
    if (r && r.source !== "missing") return r;
    if (r && input.jobRule.kind === "later") return r;
  }
  if (input.customerRule) {
    const r = applyRule(input.customerRule, "customer", input, "Kundens standardpåslag");
    if (r && r.source !== "missing") return r;
    if (r && input.customerRule.kind === "later") return r;
  }
  if (input.connectionRule) {
    const r = applyRule(input.connectionRule, "connection", input, "Grossistens standardregel");
    if (r) return r;
  }
  return { source: "missing", explanation: "Kundpris saknas." };
}

export function materialMargin(input: {
  unitCostKronor?: number;
  customerPriceKronor?: number;
}): { kronor: number; percent: number } | undefined {
  if (input.unitCostKronor == null || input.customerPriceKronor == null) return undefined;
  if (input.customerPriceKronor <= 0) return undefined;
  const kronor = input.customerPriceKronor - input.unitCostKronor;
  return { kronor, percent: Math.round((kronor / input.customerPriceKronor) * 100) };
}

export type MaterialPriceWarningKind =
  | "negative_margin"
  | "low_margin"
  | "missing_customer_price"
  | "missing_cost"
  | "stale_price_list"
  | "price_deviation";

export interface MaterialPriceWarning {
  kind: MaterialPriceWarningKind;
  text: string;
  /** Saknat kundpris får inte bli 0 kr på fakturan. Övriga varnar bara. */
  blocksInvoiceLine: boolean;
}

export function materialPriceWarnings(input: {
  customerPriceKronor?: number;
  unitCostKronor?: number;
  expectedCostKronor?: number;
  stalePriceList?: boolean;
  lowMarginPercent?: number;
}): MaterialPriceWarning[] {
  const out: MaterialPriceWarning[] = [];
  const low = input.lowMarginPercent ?? DEFAULT_LOW_MATERIAL_MARGIN_PERCENT;
  if (input.customerPriceKronor == null) {
    out.push({
      kind: "missing_customer_price",
      text: "Kundpris saknas",
      blocksInvoiceLine: true,
    });
  }
  if (input.unitCostKronor == null) {
    out.push({
      kind: "missing_cost",
      text: "Inköpspris saknas",
      blocksInvoiceLine: false,
    });
  }
  const margin = materialMargin({
    unitCostKronor: input.unitCostKronor,
    customerPriceKronor: input.customerPriceKronor,
  });
  if (margin && margin.kronor < 0) {
    out.push({
      kind: "negative_margin",
      text: "Negativ materialmarginal",
      blocksInvoiceLine: false,
    });
  } else if (margin && margin.percent < low) {
    out.push({
      kind: "low_margin",
      text: `Låg materialmarginal (${margin.percent} %)`,
      blocksInvoiceLine: false,
    });
  }
  if (input.stalePriceList) {
    out.push({
      kind: "stale_price_list",
      text: "Priserna kan vara gamla",
      blocksInvoiceLine: false,
    });
  }
  if (
    input.unitCostKronor != null &&
    input.expectedCostKronor != null &&
    Math.abs(input.unitCostKronor - input.expectedCostKronor) > 1
  ) {
    out.push({
      kind: "price_deviation",
      text: "Priset skiljer sig från beställningen",
      blocksInvoiceLine: false,
    });
  }
  return out;
}
