import { db, save } from "../store";
import { uid } from "../ids";
import type { Expense, ExpenseDetails, Receipt } from "../types";
import { EXPENSE_CATEGORIES, categoryByKey } from "../bas";
import { mileageRatePerMil, perDiemRatesFor } from "../accounting/allowances";
import { yearOf } from "../accounting/prisbasbelopp";
import { assetSuggestionForExpense } from "../accounting/assets";
import { accountBalance } from "../accounting/ledger";
import { todayDate } from "../accounting/dates";
import {
  SKULD_TILL_AGARE,
  planManualExpense,
  type CategoryContext,
  type ManualExpenseDraft,
  type ManualExpensePlan,
} from "../expenses/manual-expense";
import { askAssetQuestion, bookExpense } from "./expenses";
import { logActivity } from "./activity";
import { kr } from "../format";

/**
 * Utgifter som registreras för hand (Ekonomi → Ny utgift). Formuläret visar
 * konteringen ur expenses/manual-expense.ts; här sparas utgiften och bokförs
 * med exakt samma plan. Ett köp över inventariegränsen bokförs inte direkt –
 * användaren får frågan om inventarie eller kostnad, precis som för kvitton.
 */

export function categoryContext(key: string | undefined): CategoryContext | undefined {
  if (!key) return undefined;
  const cat = EXPENSE_CATEGORIES.find((c) => c.key === key);
  if (!cat) return undefined;
  return {
    key: cat.key,
    label: cat.label,
    account: cat.account,
    ...(cat.vatFree ? { vatFree: true } : {}),
    ...(cat.reverseChargeRate ? { reverseChargeRate: cat.reverseChargeRate } : {}),
  };
}

/** Utgiftskategorierna som val i formuläret (kvitton och köp – inte inventarier). */
export function manualExpenseCategories(): CategoryContext[] {
  return EXPENSE_CATEGORIES.map((c) => categoryContext(c.key)!).filter((c) => c.key !== "representation");
}

export interface ManualReceiptFile {
  id: string;
  filename: string;
  contentType?: string;
  sizeBytes?: number;
  storagePath?: string;
  contentBase64?: string;
}

export interface CreateManualExpenseResult {
  expense: Expense;
  plan: ManualExpensePlan;
  /** Satt när utgiften bokfördes direkt. */
  verificationId?: string;
  /** Köp över inventariegränsen: frågan ligger på Hem i stället för en bokning. */
  askedAssetQuestion: boolean;
}

function detailsFor(draft: ManualExpenseDraft): ExpenseDetails | undefined {
  switch (draft.kind) {
    case "milersattning": {
      const m = draft.mileage!;
      return {
        mileage: {
          km: m.km,
          vehicle: m.vehicle,
          ratePerMil: mileageRatePerMil(draft.date, m.vehicle),
          ...(m.route?.trim() ? { route: m.route.trim() } : {}),
        },
      };
    }
    case "traktamente": {
      const p = draft.perDiem!;
      return {
        perDiem: {
          fullDays: Math.floor(p.fullDays),
          halfDays: Math.floor(p.halfDays),
          nights: Math.floor(p.nights),
          ...(p.destination?.trim() ? { destination: p.destination.trim() } : {}),
          rates: perDiemRatesFor(yearOf(draft.date)),
        },
      };
    }
    case "representation": {
      const r = draft.representation!;
      return {
        representation: {
          kind: r.kind,
          persons: Math.floor(r.persons),
          alcohol: Boolean(r.alcohol),
          ...(r.participants?.trim() ? { participants: r.participants.trim() } : {}),
          ...(r.purpose?.trim() ? { purpose: r.purpose.trim() } : {}),
        },
      };
    }
    default:
      return undefined;
  }
}

/**
 * Spara och bokför en handregistrerad utgift. Kastar begripliga fel på
 * svenska (samma texter som formuläret visar). `receipt` är ett redan sparat
 * underlag – anroparen lagrar filen FÖRE mutationen så att ett misslyckat
 * filspar aldrig lämnar en utgift utan sitt kvitto.
 */
export function createManualExpense(
  draft: ManualExpenseDraft,
  opts: { by?: "anvandare" | "assistent"; receipt?: ManualReceiptFile } = {}
): CreateManualExpenseResult {
  const data = db();
  const by = opts.by ?? "anvandare";
  if (draft.date > todayDate()) throw new Error("Datumet kan inte ligga i framtiden.");
  const category = draft.kind === "kop" ? categoryContext(draft.category) : undefined;
  if (draft.kind === "kop" && !category) throw new Error("Välj vad köpet gällde.");
  const planned = planManualExpense(draft, { category });
  if (!planned.ok) throw new Error(planned.error);
  const plan = planned.plan;

  const jobId = draft.jobId?.trim() || undefined;
  if (jobId && !data.jobs.some((j) => j.id === jobId)) throw new Error("Uppdraget finns inte längre.");

  // Schablonersättningar är alltid en skuld till den som ska få dem.
  const paidBy = draft.kind === "milersattning" || draft.kind === "traktamente" ? "privat" : draft.paidBy;
  const categoryKey = draft.kind === "kop" ? category!.key : draft.kind;
  const now = new Date().toISOString();
  const expense: Expense = {
    id: uid(),
    supplier: plan.supplier,
    date: draft.date,
    amount: plan.amount,
    vatAmount: draft.kind === "kop" || draft.kind === "representation" ? (draft.vatAmount ?? 0) : 0,
    category: categoryKey,
    description: plan.description,
    ...(jobId ? { jobId } : {}),
    status: "saknar_kvitto",
    createdAt: now,
    paidBy,
    kind: draft.kind,
    ...(detailsFor(draft) ? { details: detailsFor(draft) } : {}),
  };
  data.expenses.push(expense);

  if (opts.receipt) {
    const receipt: Receipt = {
      id: opts.receipt.id,
      expenseId: expense.id,
      filename: opts.receipt.filename,
      source: "uppladdning",
      uploadedAt: now,
      ...(opts.receipt.contentType ? { contentType: opts.receipt.contentType } : {}),
      ...(opts.receipt.sizeBytes != null ? { sizeBytes: opts.receipt.sizeBytes } : {}),
      ...(opts.receipt.storagePath ? { storagePath: opts.receipt.storagePath } : {}),
      ...(opts.receipt.contentBase64 ? { contentBase64: opts.receipt.contentBase64 } : {}),
      extracted: {
        supplier: expense.supplier,
        date: expense.date,
        amount: expense.amount,
        vatAmount: expense.vatAmount,
        description: expense.description ?? "",
        category: categoryKey,
        confidence: "hog",
      },
    };
    data.receipts.push(receipt);
    expense.receiptId = receipt.id;
  }

  // Ett köp som ser ut att användas i flera år → frågan ställs, precis som för kvitton.
  if (draft.kind === "kop" && assetSuggestionForExpense(expense)) {
    askAssetQuestion(expense);
    logActivity(
      `${expense.supplier} (${kr(expense.amount)}) registrerades – köpet ser ut som en inventarie, så Driva frågar hur det ska bokföras.`,
      { entity: { type: "utgift", id: expense.id } }
    );
    save();
    return { expense, plan, askedAssetQuestion: true };
  }

  const ver = bookExpense(expense, categoryKey, "hog", by);
  const label = draft.kind === "kop" ? categoryByKey(categoryKey).label.toLowerCase() : plan.title.toLowerCase();
  logActivity(
    paidBy === "privat"
      ? `${plan.title} bokfördes som skuld till dig – ${kr(plan.amount)} att föra över från företagskontot.`
      : `${plan.supplier} (${kr(plan.amount)}) registrerades och bokfördes som ${label}.`,
    { entity: { type: "utgift", id: expense.id } }
  );
  save();
  return { expense, plan, verificationId: ver.id, askedAssetQuestion: false };
}

/* ------------------------------ Skuld till ägaren ------------------------------ */

export interface OwnerLiabilitySummary {
  /** Vad bolaget är skyldigt ägaren just nu (kreditsaldo på 2893), hela kronor. */
  balance: number;
  /** Bokförda privata utlägg och ersättningar som ännu inte förts över. */
  openExpenses: Expense[];
}

/**
 * Bolagets skuld till ägaren: privata utlägg, milersättning och traktamente
 * som bokförts men inte betalats ut. Saldot på 2893 är sanningen – de enskilda
 * utgifterna är förklaringen till det.
 */
export function ownerLiability(toDate: string = todayDate()): OwnerLiabilitySummary {
  const balance = Math.max(0, -accountBalance(SKULD_TILL_AGARE, toDate));
  const openExpenses = balance > 0
    ? db()
        .expenses.filter((e) => e.paidBy === "privat" && e.status === "bokford" && e.date <= toDate)
        .sort((a, b) => b.date.localeCompare(a.date))
    : [];
  return { balance, openExpenses };
}
