import { db } from "../store";
import type { FiscalYear } from "../types";
import { resultatrapport } from "./ledger";
import { bokforingsdatum } from "./fiscal";

/**
 * Skatteberäkning för aktiebolag (INK2-arkitektur).
 *
 * Skiljer på redovisningsresultat (bokföringen) och skattemässigt resultat:
 * ett enkelt, deterministiskt justeringsregelverk lägger tillbaka ej
 * avdragsgilla kostnader. Sådant som inte stöds automatiskt flaggas
 * "behöver granskas manuellt" – motorn gissar aldrig.
 *
 * Allt är UPPSKATTAT/PRELIMINÄRT tills en riktig deklaration lämnas –
 * produkten lämnar aldrig in något till Skatteverket.
 */

export const BOLAGSSKATT_SATS = 0.206; // 20,6 % (2021–)

export interface TaxAdjustment {
  key: string;
  label: string;
  /** Positivt ökar det skattemässiga resultatet. */
  amount: number;
  explanation: string;
}

export interface TaxCalculation {
  fiscalYearId: string;
  companyForm: "ab" | "enskild";
  /** Resultat före skatt enligt bokföringen. */
  redovisningsresultat: number;
  adjustments: TaxAdjustment[];
  /** Efter justeringar. */
  skattemassigtResultat: number;
  /** Avrundat nedåt till helt tiotal (deklarationsregel). */
  beskattningsbartResultat: number;
  /** 20,6 % för AB. 0 om förlust. */
  beraknadSkatt: number;
  /** Redan bokförd skatt på 8910 (efter bokslut). */
  bokfordSkatt: number;
  /** Poster som inte stöds automatiskt och behöver granskas manuellt. */
  manualReviewNotes: string[];
}

/** Konton vars kostnader inte är skattemässigt avdragsgilla (enkel V1-regelbas). */
const NON_DEDUCTIBLE_ACCOUNTS: { account: number; label: string; explanation: string }[] = [
  {
    account: 6072,
    label: "Representation (ej avdragsgill)",
    explanation:
      "Kostnader för extern representation (t.ex. restaurangbesök med kunder) är inte avdragsgilla vid inkomstbeskattningen och läggs tillbaka till resultatet.",
  },
];

export function computeTaxCalculation(fy: FiscalYear): TaxCalculation {
  const companyForm = db().settings.companyForm ?? "ab";
  const rapport = resultatrapport({ from: fy.startDate, to: fy.endDate });
  const redovisningsresultat = rapport.resultatForeSkatt;

  const adjustments: TaxAdjustment[] = [];
  const manualReviewNotes: string[] = [];

  // Ej avdragsgilla kostnader: summera kontonas nettokostnad för året.
  for (const rule of NON_DEDUCTIBLE_ACCOUNTS) {
    let sum = 0;
    for (const v of db().verifications) {
      const d = bokforingsdatum(v.date);
      if (d < fy.startDate || d > fy.endDate) continue;
      for (const e of v.entries) {
        if (e.account === rule.account) sum += e.debit - e.credit;
      }
    }
    if (sum > 0) {
      adjustments.push({ key: `konto-${rule.account}`, label: rule.label, amount: sum, explanation: rule.explanation });
    }
  }

  // Skattemässiga avskrivningar: V1 använder samma plan som bokföringen
  // (linjärt ≤ 5 år ryms inom räkenskapsenlig avskrivning, 20 %-regeln).
  const assets = db().assets.filter((a) => a.status !== "utrangerad");
  if (assets.some((a) => a.usefulLifeYears > 5)) {
    manualReviewNotes.push(
      "Någon inventarie skrivs av på längre tid än 5 år. Skillnaden mellan bokförd och skattemässig avskrivning behöver granskas manuellt."
    );
  }

  if (companyForm === "enskild") {
    manualReviewNotes.push(
      "Enskild firma beskattas hos ägaren (NE-bilagan). Egenavgifter och räntefördelning stöds inte automatiskt ännu."
    );
  }

  const skattemassigtResultat = redovisningsresultat + adjustments.reduce((s, a) => s + a.amount, 0);
  const beskattningsbartResultat = skattemassigtResultat > 0 ? Math.floor(skattemassigtResultat / 10) * 10 : skattemassigtResultat;
  const beraknadSkatt = companyForm === "ab" && beskattningsbartResultat > 0 ? Math.floor(beskattningsbartResultat * BOLAGSSKATT_SATS) : 0;

  if (skattemassigtResultat < 0) {
    manualReviewNotes.push(
      "Året går med förlust. Underskottet får normalt sparas till kommande år, men hanteringen behöver granskas manuellt."
    );
  }

  // Redan bokförd skatt (8910) för året.
  let bokfordSkatt = 0;
  for (const v of db().verifications) {
    const d = bokforingsdatum(v.date);
    if (d < fy.startDate || d > fy.endDate) continue;
    for (const e of v.entries) {
      if (e.account === 8910) bokfordSkatt += e.debit - e.credit;
    }
  }

  return {
    fiscalYearId: fy.id,
    companyForm,
    redovisningsresultat,
    adjustments,
    skattemassigtResultat,
    beskattningsbartResultat,
    beraknadSkatt,
    bokfordSkatt,
    manualReviewNotes,
  };
}
