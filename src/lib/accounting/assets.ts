import { db, save } from "../store";
import { uid } from "../ids";
import type { Asset, Expense, FiscalYear } from "../types";
import { bokforingsdatum, clampToOpenDate, getFiscalYear } from "./fiscal";
import { postVerification } from "./engine";
import { logAudit } from "./audit";

/**
 * Inventarier och avskrivningar.
 *
 * Upptäckt: köp som ser ut att användas i flera år (belopp över ett halvt
 * prisbasbelopp) föreslås som inventarie – ANVÄNDAREN avgör, aldrig AI:n själv.
 * Avskrivning: deterministisk linjär avskrivning över nyttjandeperioden,
 * beräknad per månad, bokförd som bokslutsverifikation per räkenskapsår.
 */

/** Prisbasbelopp (2025: 58 800 kr). Gräns för direktavdrag: ett halvt prisbasbelopp. */
export const PRISBASBELOPP = 58_800;
export const INVENTARIE_GRANS = Math.round(PRISBASBELOPP / 2);

export const DEFAULT_USEFUL_LIFE_YEARS = 5;

/** Kategorier där ett stort köp sannolikt är en inventarie (inte förbrukning). */
const ASSET_LIKELY_CATEGORIES = new Set(["verktyg", "ovrigt", "programvara", "material"]);

/**
 * Ser köpet ut som en inventarie? Ren heuristik för att STÄLLA FRÅGAN –
 * beslutet fattas alltid av användaren.
 */
export function assetSuggestionForExpense(expense: Pick<Expense, "amount" | "vatAmount" | "category" | "supplier">): boolean {
  const net = expense.amount - expense.vatAmount;
  if (net < INVENTARIE_GRANS) return false;
  if (expense.category && !ASSET_LIKELY_CATEGORIES.has(expense.category)) return false;
  return true;
}

export function listAssets(): Asset[] {
  return [...db().assets].sort((a, b) => b.acquisitionDate.localeCompare(a.acquisitionDate));
}

export function getAsset(id: string): Asset | undefined {
  return db().assets.find((a) => a.id === id);
}

export interface RegisterAssetInput {
  name: string;
  acquisitionDate: string;
  /** Exkl. moms, hela kronor. */
  acquisitionValue: number;
  usefulLifeYears?: number;
  sourceExpenseId?: string;
  by: "anvandare" | "assistent";
}

/**
 * Registrera en inventarie från en obokförd utgift: bokför anskaffningen
 * (1220 + ingående moms mot företagskontot) och lägg upp tillgången i registret.
 */
export function registerAssetFromExpense(expenseId: string, opts: { name?: string; usefulLifeYears?: number; by: "anvandare" | "assistent" }): Asset {
  const data = db();
  const expense = data.expenses.find((e) => e.id === expenseId);
  if (!expense) throw new Error("Utgiften finns inte.");
  if (expense.status === "bokford") throw new Error("Utgiften är redan bokförd. Ångra bokningen först om den ska bli en inventarie.");

  const net = expense.amount - expense.vatAmount;
  const clamped = clampToOpenDate(expense.date);
  const name = opts.name?.trim() || `${expense.supplier} – ${expense.description ?? "inventarie"}`;

  const entries = [
    { account: 1220, debit: net },
    ...(expense.vatAmount > 0 ? [{ account: 2641, debit: expense.vatAmount }] : []),
    { account: 1930, credit: expense.amount },
  ];
  const ver = postVerification({
    date: clamped.date,
    description: `Inventarie: ${name}`,
    entries,
    source: { type: "utgift", id: expense.id },
    createdBy: opts.by,
    confidence: "hog",
    explanation: `Köpet på ${expense.amount} kr hos ${expense.supplier} registrerades som inventarie eftersom det används i flera år. Kostnaden fördelas över nyttjandeperioden genom avskrivningar i stället för att tas direkt.${clamped.adjusted ? ` Bokfört ${clamped.date} eftersom perioden för ${clamped.originalDate} är låst.` : ""}`,
  });

  const asset: Asset = {
    id: uid(),
    name,
    acquisitionDate: bokforingsdatum(expense.date),
    acquisitionValue: net,
    assetAccount: 1220,
    depreciationAccount: 7832,
    accumulatedDepreciationAccount: 1229,
    usefulLifeYears: opts.usefulLifeYears ?? DEFAULT_USEFUL_LIFE_YEARS,
    status: "aktiv",
    sourceExpenseId: expense.id,
    acquisitionVerificationId: ver.id,
    depreciations: [],
    createdAt: new Date().toISOString(),
  };
  data.assets.push(asset);

  expense.status = "bokford";
  expense.category = "inventarie";
  expense.verificationId = ver.id;
  expense.question = undefined;
  if (expense.bankTransactionId) {
    const tx = data.bankTransactions.find((t) => t.id === expense.bankTransactionId);
    if (tx) {
      tx.status = "bokford";
      tx.verificationId = ver.id;
    }
  }

  logAudit(opts.by, "inventarie_registrerad", `${name} registrerades som inventarie (${net} kr, ${asset.usefulLifeYears} års avskrivning).`, {
    targetType: "inventarie",
    targetId: asset.id,
  });
  save();
  return asset;
}

/** Hela månader tillgången ägts under räkenskapsåret (anskaffningsmånaden räknas). */
function monthsHeldInYear(asset: Asset, fy: FiscalYear): number {
  const acqMonth = Number(asset.acquisitionDate.slice(0, 7).replace("-", ""));
  const fyStart = Number(fy.startDate.slice(0, 7).replace("-", ""));
  const fyEnd = Number(fy.endDate.slice(0, 7).replace("-", ""));
  if (acqMonth > fyEnd) return 0;
  const startYm = Math.max(acqMonth, fyStart);
  const sy = Math.floor(startYm / 100);
  const sm = startYm % 100;
  const ey = Math.floor(fyEnd / 100);
  const em = fyEnd % 100;
  return (ey - sy) * 12 + (em - sm) + 1;
}

/** Ackumulerad avskrivning som redan bokförts för tillgången. */
export function accumulatedDepreciation(asset: Asset): number {
  return asset.depreciations.reduce((s, d) => s + d.amount, 0);
}

/**
 * Deterministisk linjär avskrivning för ett räkenskapsår:
 * anskaffningsvärde × (månader i året / total nyttjandeperiod i månader),
 * avrundat till hela kronor. Sista året tar resterande belopp så att
 * summan alltid blir exakt anskaffningsvärdet.
 */
export function depreciationForYear(asset: Asset, fy: FiscalYear): number {
  if (asset.status === "utrangerad") return 0;
  const alreadyForYear = asset.depreciations.find((d) => d.fiscalYearId === fy.id);
  if (alreadyForYear) return 0;
  const totalMonths = asset.usefulLifeYears * 12;
  const remaining = asset.acquisitionValue - accumulatedDepreciation(asset);
  if (remaining <= 0) return 0;
  const months = monthsHeldInYear(asset, fy);
  if (months <= 0) return 0;
  const raw = Math.round((asset.acquisitionValue * Math.min(months, totalMonths)) / totalMonths);
  return Math.min(raw, remaining);
}

/** Bokför årets avskrivning för en tillgång (bokslutsverifikation på årets sista dag). */
export function createDepreciationEntry(assetId: string, fiscalYearId: string, by: "anvandare" | "assistent" | "auto"): { asset: Asset; amount: number } {
  const asset = getAsset(assetId);
  if (!asset) throw new Error("Inventarien finns inte.");
  const fy = getFiscalYear(fiscalYearId);
  if (!fy) throw new Error("Räkenskapsåret finns inte.");
  if (fy.status === "stangt") throw new Error("Räkenskapsåret är stängt.");
  const amount = depreciationForYear(asset, fy);
  if (amount <= 0) return { asset, amount: 0 };

  const ver = postVerification(
    {
      date: fy.endDate,
      description: `Avskrivning ${fy.label}: ${asset.name}`,
      entries: [
        { account: asset.depreciationAccount, debit: amount },
        { account: asset.accumulatedDepreciationAccount, credit: amount },
      ],
      source: { type: "avskrivning", id: asset.id },
      createdBy: by,
      explanation: `${asset.name} skrivs av linjärt över ${asset.usefulLifeYears} år. Årets andel är ${amount} kr av anskaffningsvärdet ${asset.acquisitionValue} kr.`,
    },
    { bypassPeriodLock: true }
  );
  asset.depreciations.push({ fiscalYearId: fy.id, amount, verificationId: ver.id });
  if (accumulatedDepreciation(asset) >= asset.acquisitionValue) asset.status = "fullt_avskriven";
  logAudit(by === "auto" ? "system" : by, "avskrivning_bokford", `Avskrivning ${amount} kr bokfördes för ${asset.name} (${fy.label}).`, {
    targetType: "inventarie",
    targetId: asset.id,
  });
  save();
  return { asset, amount };
}

/** Tillgångar som saknar avskrivning för året. */
export function assetsNeedingDepreciation(fiscalYearId: string): { asset: Asset; amount: number }[] {
  const fy = getFiscalYear(fiscalYearId);
  if (!fy) return [];
  return db()
    .assets.filter((a) => a.status === "aktiv")
    .map((asset) => ({ asset, amount: depreciationForYear(asset, fy) }))
    .filter((x) => x.amount > 0);
}

/** Bokfört restvärde för en tillgång. */
export function bookValue(asset: Asset): number {
  return asset.acquisitionValue - accumulatedDepreciation(asset);
}
