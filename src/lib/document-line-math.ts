/**
 * Deterministisk kontroll av artikelrader mot dokumentets totalsumma.
 * AI:n får läsa rader; den här modulen avgör om summan går ihop.
 *
 * En avvikelse blockerar automatisk bekräftelse. Hela kvittot kan ändå
 * bokföras – raduppdelningen är operativ, inte bokföringsunderlaget.
 */
import type { DocumentLineRole, DocumentLineValues } from "./types";

export const LINE_TOTAL_TOLERANCE_KR = 1;

export interface LineMathInput {
  lines: Array<
    Pick<DocumentLineValues, "lineAmount" | "qty" | "unitPrice" | "discount" | "unreadable" | "role">
  >;
  documentTotal: number;
}

export interface LineMathResult {
  ok: boolean;
  lineSum: number;
  documentTotal: number;
  delta: number;
  unreadableCount: number;
  articleCount: number;
  hasReturn: boolean;
  extras: { freight: number; deposit: number; rounding: number; fee: number };
  /** Svensk text till granskningsvyn. */
  message: string;
}

function roleOf(line: Pick<DocumentLineValues, "role">): DocumentLineRole {
  return line.role ?? "article";
}

function lineAmountOf(
  line: Pick<DocumentLineValues, "lineAmount" | "qty" | "unitPrice" | "discount" | "unreadable">
): number | undefined {
  if (line.unreadable) return undefined;
  if (typeof line.lineAmount === "number" && Number.isFinite(line.lineAmount)) {
    return Math.round(line.lineAmount);
  }
  if (typeof line.qty === "number" && typeof line.unitPrice === "number") {
    const raw = line.qty * line.unitPrice - (line.discount ?? 0);
    if (!Number.isFinite(raw)) return undefined;
    return Math.round(raw);
  }
  return undefined;
}

export function sumDocumentLines(lines: LineMathInput["lines"]): {
  sum: number;
  unreadableCount: number;
  articleCount: number;
  extras: LineMathResult["extras"];
  hasReturn: boolean;
} {
  let sum = 0;
  let unreadableCount = 0;
  let articleCount = 0;
  const extras = { freight: 0, deposit: 0, rounding: 0, fee: 0 };
  let hasReturn = false;
  for (const line of lines) {
    if (line.unreadable) {
      unreadableCount += 1;
      continue;
    }
    const amount = lineAmountOf(line);
    if (amount === undefined) {
      unreadableCount += 1;
      continue;
    }
    const role = roleOf(line);
    if (role === "return" || amount < 0) hasReturn = true;
    if (role === "freight") extras.freight += amount;
    else if (role === "deposit") extras.deposit += amount;
    else if (role === "rounding") extras.rounding += amount;
    else if (role === "fee") extras.fee += amount;
    else articleCount += 1;
    sum += amount;
  }
  return { sum, unreadableCount, articleCount, extras, hasReturn };
}

export function validateDocumentLineMath(input: LineMathInput): LineMathResult {
  const { sum, unreadableCount, articleCount, extras, hasReturn } = sumDocumentLines(input.lines);
  const documentTotal = Math.round(input.documentTotal);
  const delta = sum - documentTotal;
  const ok = unreadableCount === 0 && Math.abs(delta) <= LINE_TOTAL_TOLERANCE_KR;
  let message: string;
  if (unreadableCount > 0 && Math.abs(delta) > LINE_TOTAL_TOLERANCE_KR) {
    message = `${unreadableCount === 1 ? "En rad" : `${unreadableCount} rader`} gick inte att läsa, och radsumman skiljer ${Math.abs(delta).toLocaleString("sv-SE")} kr från kvittots total.`;
  } else if (unreadableCount > 0) {
    message = `${unreadableCount === 1 ? "En rad" : `${unreadableCount} rader`} gick inte att läsa. Kontrollera mot kvittot.`;
  } else if (!ok) {
    message = `Raderna summerar till ${sum.toLocaleString("sv-SE")} kr, kvittot säger ${documentTotal.toLocaleString("sv-SE")} kr.`;
  } else if (articleCount === 0 && input.lines.length === 0) {
    message = "Inga artikelrader lästes. Hela kvittot kan ändå bokföras.";
  } else {
    message =
      articleCount === 1
        ? "Ferva hittade 1 vara och summan stämmer."
        : `Ferva hittade ${articleCount} varor och summan stämmer.`;
  }
  return {
    ok,
    lineSum: sum,
    documentTotal,
    delta,
    unreadableCount,
    articleCount,
    hasReturn,
    extras,
    message,
  };
}

/** Allokeringar får inte överstiga radens antal eller belopp. */
export function allocationOverflow(input: {
  lineQty: number;
  lineAmount: number;
  allocations: Array<{ qty: number; amountExclVat: number }>;
}): { qtyOk: boolean; amountOk: boolean } {
  const qty = input.allocations.reduce((s, a) => s + a.qty, 0);
  const amount = input.allocations.reduce((s, a) => s + a.amountExclVat, 0);
  const qtyTol = 1e-6;
  return {
    qtyOk: qty <= input.lineQty + qtyTol,
    amountOk: amount <= input.lineAmount + LINE_TOTAL_TOLERANCE_KR,
  };
}
