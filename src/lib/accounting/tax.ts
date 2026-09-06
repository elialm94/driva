import { db } from "../store";
import { kr, procent } from "../format";
import type { Asset, FiscalYear } from "../types";
import { resultatrapport, accountBalance } from "./ledger";
import { bokforingsdatum, fiscalYears } from "./fiscal";
import { previousDay } from "./dates";
import {
  BOLAGSSKATT_SATS,
  INK2_FIELD_LABEL,
  NON_DEDUCTIBLE_ACCOUNTS,
  SKATT_PA_ARETS_RESULTAT,
  TAX_FREE_INCOME_ACCOUNTS,
  depreciationLimits,
  schablonintakt,
  schablonranta,
  type DepreciationLimits,
  type Ink2Field,
} from "./ink2-model";
import { PERIODISERINGSFOND } from "./year-end-model";

/**
 * Skatteberäkning för aktiebolag: INK2 med de skattemässiga justeringar ett
 * litet bolag faktiskt har.
 *
 * Bokföringen och skattelagen svarar på olika frågor, så de ger olika resultat.
 * Skillnaden är inte ett fel att rätta utan avsiktliga skillnader som var och en
 * hör till en ruta på INK2S. Justeringarna här bär därför sin ruta med sig, och
 * de räknas fram ur bokföringen – aldrig ur en bedömning av vad en kostnad
 * "egentligen" var. Sådant som kräver en bedömning flaggas för manuell
 * granskning i stället: motorn gissar aldrig.
 *
 * Allt är UPPSKATTAT/PRELIMINÄRT tills en riktig deklaration lämnas –
 * produkten lämnar aldrig in något till Skatteverket.
 */

export { BOLAGSSKATT_SATS };

export interface TaxAdjustment {
  key: string;
  label: string;
  /** Positivt ökar det skattemässiga resultatet. */
  amount: number;
  explanation: string;
  /** Rutan på INK2S justeringen hör till. */
  field: Ink2Field;
}

/** En rad på INK2S, i blankettens ordning. */
export interface Ink2Row {
  field: Ink2Field;
  label: string;
  amount: number;
}

export interface TaxDepreciationCheck {
  limits: DepreciationLimits;
  /** Årets avskrivning enligt bokföringens plan. */
  bookedDepreciation: number;
  /** Bokförd förändring av överavskrivningar (8850). */
  bookedOverDepreciation: number;
  /**
   * Avdrag som finns kvar att ta men som bokföringen inte tagit. Ingen
   * justering – ett val bolaget kan göra genom att bokföra en överavskrivning.
   */
  unusedHeadroom: number;
}

export interface TaxCalculation {
  fiscalYearId: string;
  companyForm: "ab" | "enskild";
  /** Resultat före skatt enligt bokföringen. */
  redovisningsresultat: number;
  /** Årets resultat efter bokförd skatt – rutorna 4.1/4.2. */
  aretsResultat: number;
  adjustments: TaxAdjustment[];
  /** Efter justeringar, men före avdrag för tidigare års underskott. */
  resultatForeUnderskott: number;
  /** Underskott från tidigare år som utnyttjas i år (ruta 4.14a). */
  utnyttjatUnderskott: number;
  /** Underskott som finns kvar att spara till kommande år. */
  kvarvarandeUnderskott: number;
  /** Efter justeringar och underskottsavdrag. */
  skattemassigtResultat: number;
  /** Avrundat nedåt till helt tiotal (deklarationsregel). */
  beskattningsbartResultat: number;
  /** 20,6 % för AB. 0 om förlust. */
  beraknadSkatt: number;
  /** Redan bokförd skatt på 8910 (efter bokslut). */
  bokfordSkatt: number;
  /** Inventarieavskrivningarna: bokförd plan mot skattens tak. */
  depreciation?: TaxDepreciationCheck;
  /** Poster som inte stöds automatiskt och behöver granskas manuellt. */
  manualReviewNotes: string[];
}

/* ------------------------------- Hjälpare --------------------------------- */

/** Nettorörelse på ett konto under räkenskapsåret. Positivt = debet. */
function accountMovementInYear(account: number, fy: FiscalYear): number {
  let sum = 0;
  for (const v of db().verifications) {
    const d = bokforingsdatum(v.date);
    if (d < fy.startDate || d > fy.endDate) continue;
    for (const e of v.entries) {
      if (e.account === account) sum += e.debit - e.credit;
    }
  }
  return sum;
}

/** Räkenskapsår som avslutats före det här året, äldst först. */
function yearsBefore(fy: FiscalYear): FiscalYear[] {
  return fiscalYears()
    .filter((y) => y.endDate < fy.startDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/* ------------------------ Skattemässiga avskrivningar --------------------- */

/** Avskrivningar bokförda på inventarien i räkenskapsår som slutat före `fy`. */
function depreciationBefore(asset: Asset, fy: FiscalYear): number {
  const earlier = new Set(yearsBefore(fy).map((y) => y.id));
  return asset.depreciations.filter((d) => earlier.has(d.fiscalYearId)).reduce((s, d) => s + d.amount, 0);
}

/**
 * Bokföringens avskrivningsplan mot skattens tak.
 *
 * Planen periodiserar per månad över nyttjandetiden; skattereglerna räknar på
 * hela året och på hela beståndet. Talen är alltså sällan lika, och det är
 * meningen. Det som spelar roll är åt vilket håll de skiljer sig:
 *
 *   plan > taket  → för mycket avskrivet skattemässigt, läggs tillbaka (4.9)
 *   plan < taket  → outnyttjat avdrag som bolaget FÅR ta genom överavskrivning
 */
export function taxDepreciation(fy: FiscalYear): TaxDepreciationCheck | undefined {
  const assets = db().assets.filter((a) => a.status !== "utrangerad");
  if (assets.length === 0) return undefined;

  const heldAtYearEnd = assets.filter((a) => bokforingsdatum(a.acquisitionDate) <= fy.endDate);
  const openingBookValue = heldAtYearEnd
    .filter((a) => bokforingsdatum(a.acquisitionDate) < fy.startDate)
    .reduce((s, a) => s + a.acquisitionValue - depreciationBefore(a, fy), 0);

  /*
   * Anskaffningsåren räknas bakåt från det här räkenskapsåret. Fem platser,
   * för kompletteringsregeln bryr sig inte om något äldre än det – då får
   * inventarien vara helt avskriven.
   */
  const years = [fy, ...yearsBefore(fy).reverse()];
  const acquisitionsByYearsBack = [0, 1, 2, 3, 4].map((back) => {
    const year = years[back];
    if (!year) return 0;
    return heldAtYearEnd
      .filter((a) => {
        const d = bokforingsdatum(a.acquisitionDate);
        return d >= year.startDate && d <= year.endDate;
      })
      .reduce((s, a) => s + a.acquisitionValue, 0);
  });

  const limits = depreciationLimits({ openingBookValue, acquisitionsByYearsBack });
  const bookedDepreciation = assets
    .flatMap((a) => a.depreciations)
    .filter((d) => d.fiscalYearId === fy.id)
    .reduce((s, d) => s + d.amount, 0);
  const bookedOverDepreciation = accountMovementInYear(8850, fy);
  const totalBooked = bookedDepreciation + bookedOverDepreciation;

  return {
    limits,
    bookedDepreciation,
    bookedOverDepreciation,
    unusedHeadroom: Math.max(0, limits.maxDepreciation - totalBooked),
  };
}

/* ------------------------------ Justeringarna ----------------------------- */

interface AdjustmentResult {
  redovisningsresultat: number;
  aretsResultat: number;
  bokfordSkatt: number;
  adjustments: TaxAdjustment[];
  depreciation?: TaxDepreciationCheck;
  notes: string[];
}

/**
 * Justeringarna utom tidigare års underskott. Skilt för sig eftersom
 * underskottsavdraget kräver att tidigare år räknats färdigt – och de räknas
 * med samma funktion.
 */
function adjustmentsExcludingDeficit(fy: FiscalYear): AdjustmentResult {
  const rapport = resultatrapport({ from: fy.startDate, to: fy.endDate });
  const bokfordSkatt = accountMovementInYear(SKATT_PA_ARETS_RESULTAT, fy);
  const adjustments: TaxAdjustment[] = [];
  const notes: string[] = [];

  // Bokförda kostnader som inte får dras av (4.3c).
  for (const rule of NON_DEDUCTIBLE_ACCOUNTS) {
    const sum = accountMovementInYear(rule.account, fy);
    if (sum > 0) {
      adjustments.push({
        key: `konto-${rule.account}`,
        label: rule.label,
        amount: sum,
        explanation: rule.explanation,
        field: rule.field,
      });
    }
  }

  // Bokförda intäkter som inte ska beskattas (4.5c).
  for (const rule of TAX_FREE_INCOME_ACCOUNTS) {
    const sum = -accountMovementInYear(rule.account, fy);
    if (sum > 0) {
      adjustments.push({
        key: `konto-${rule.account}`,
        label: rule.label,
        amount: -sum,
        explanation: rule.explanation,
        field: rule.field,
      });
    }
  }

  /*
   * Schablonintäkt på periodiseringsfonder (4.6a): en ränta på uppskjuten
   * skatt. Underlaget är fonderna vid årets INGÅNG, så årets egen avsättning
   * räntebeläggs först nästa år.
   *
   * Ingående balans går före det räknade saldot: ett bolag som flyttat in i
   * Driva med en fond har ingen bokföring bakåt att räkna den ur.
   */
  const openingFund = fy.openingBalances[String(PERIODISERINGSFOND)];
  const fundsAtStart = -(openingFund ?? accountBalance(PERIODISERINGSFOND, previousDay(fy.startDate)));
  if (fundsAtStart > 0) {
    const taxYear = Number(fy.endDate.slice(0, 4));
    const rate = schablonranta(taxYear);
    if (rate === undefined) {
      notes.push(
        `Statslåneräntan för beskattningsår ${taxYear} finns inte i Driva ännu, så schablonintäkten på periodiseringsfonderna (${kr(fundsAtStart)}) är inte beräknad. Den ska tas upp i ruta 4.6a.`
      );
    } else {
      adjustments.push({
        key: "schablonintakt-periodiseringsfond",
        label: "Schablonintäkt på periodiseringsfonder",
        amount: schablonintakt(fundsAtStart, rate),
        explanation: `${kr(fundsAtStart)} i periodiseringsfond vid årets ingång × ${procent(rate)} (statslåneräntan den 30 november ${taxYear - 1}, lägst 0,5 %). Räntan på att ha skjutit upp skatten. Den bokförs inte – den finns bara i deklarationen.`,
        field: "4.6a",
      });
    }
  }

  /*
   * Inventarieavskrivningar (4.9). Bara den riktning som är ett fel läggs
   * tillbaka: har bokföringen skrivit av mer än skattereglerna tillåter är
   * överskjutande del inte avdragsgill i år.
   */
  const depreciation = taxDepreciation(fy);
  if (depreciation) {
    const booked = depreciation.bookedDepreciation + depreciation.bookedOverDepreciation;
    const excess = booked - depreciation.limits.maxDepreciation;
    if (excess > 0) {
      adjustments.push({
        key: "avskrivning-over-tak",
        label: "Avskrivning över skattemässigt tak",
        amount: excess,
        explanation: `Bokföringen har skrivit av ${kr(booked)} på inventarierna. Skattemässigt får högst ${kr(depreciation.limits.maxDepreciation)} dras av i år, så ${kr(excess)} läggs tillbaka. Avdraget är inte förlorat – det kommer senare år, när planen hunnit ikapp.`,
        field: "4.9",
      });
    }
  }

  return {
    redovisningsresultat: rapport.resultatForeSkatt,
    aretsResultat: rapport.resultat,
    bokfordSkatt,
    adjustments,
    depreciation,
    notes,
  };
}

/**
 * Underskott från tidigare år som får dras av i år (4.14a).
 *
 * Ett skattemässigt underskott rullar framåt utan tidsgräns. Beloppet går inte
 * att läsa ur bokföringen – eget kapital bär redovisningens förlust, inte
 * skattens – så det räknas fram genom att gå igenom de avslutade åren i tur och
 * ordning. Varje år äter så mycket av det sparade underskottet som årets vinst
 * räcker till, och lägger till sitt eget om det gick med förlust.
 */
function deficitCarriedInto(fy: FiscalYear): number {
  let deficit = 0;
  for (const year of yearsBefore(fy)) {
    const result = adjustmentsExcludingDeficit(year);
    const beforeDeficit =
      result.redovisningsresultat + result.adjustments.reduce((s, a) => s + a.amount, 0);
    const after = beforeDeficit - deficit;
    deficit = after < 0 ? -after : 0;
  }
  return deficit;
}

export function computeTaxCalculation(fy: FiscalYear): TaxCalculation {
  const companyForm = db().settings.companyForm ?? "ab";
  const base = adjustmentsExcludingDeficit(fy);
  const manualReviewNotes = [...base.notes];

  const resultatForeUnderskott =
    base.redovisningsresultat + base.adjustments.reduce((s, a) => s + a.amount, 0);

  /*
   * Underskottsavdrag gäller bolagets egen näringsverksamhet. Enskild firma
   * beskattas hos ägaren och har andra regler, så där räknas inget fram.
   */
  const carriedIn = companyForm === "ab" ? deficitCarriedInto(fy) : 0;
  const utnyttjatUnderskott = resultatForeUnderskott > 0 ? Math.min(carriedIn, resultatForeUnderskott) : 0;
  const skattemassigtResultat = resultatForeUnderskott - utnyttjatUnderskott;
  const kvarvarandeUnderskott =
    carriedIn - utnyttjatUnderskott + (skattemassigtResultat < 0 ? -skattemassigtResultat : 0);

  if (companyForm === "enskild") {
    manualReviewNotes.push(
      "Enskild firma beskattas hos ägaren (NE-bilagan). Egenavgifter och räntefördelning stöds inte automatiskt ännu."
    );
  }
  if (skattemassigtResultat < 0) {
    manualReviewNotes.push(
      `Året går med skattemässig förlust. Underskottet på ${kr(-skattemassigtResultat)} sparas till kommande år utan tidsgräns – vid ägarförändringar kan rätten begränsas, och det behöver granskas manuellt.`
    );
  }
  if (base.depreciation && base.depreciation.unusedHeadroom > 0) {
    manualReviewNotes.push(
      `Inventarierna får skrivas av med ytterligare ${kr(base.depreciation.unusedHeadroom)} skattemässigt i år. Det kräver en bokförd överavskrivning – bokföringen och avdraget måste vara lika stora vid räkenskapsenlig avskrivning. Driva bokför den inte av sig själv, för det är ett val om bolaget vill skjuta upp skatt.`
    );
  }

  const beskattningsbartResultat =
    skattemassigtResultat > 0 ? Math.floor(skattemassigtResultat / 10) * 10 : skattemassigtResultat;
  const beraknadSkatt =
    companyForm === "ab" && beskattningsbartResultat > 0
      ? Math.floor(beskattningsbartResultat * BOLAGSSKATT_SATS)
      : 0;

  return {
    fiscalYearId: fy.id,
    companyForm,
    redovisningsresultat: base.redovisningsresultat,
    aretsResultat: base.aretsResultat,
    adjustments: base.adjustments,
    resultatForeUnderskott,
    utnyttjatUnderskott,
    kvarvarandeUnderskott,
    skattemassigtResultat,
    beskattningsbartResultat,
    beraknadSkatt,
    bokfordSkatt: base.bokfordSkatt,
    ...(base.depreciation ? { depreciation: base.depreciation } : {}),
    manualReviewNotes,
  };
}

/**
 * INK2S rad för rad, i blankettens ordning.
 *
 * Blanketten börjar i årets resultat EFTER skatt (4.1/4.2) och lägger tillbaka
 * skatten (4.3a). Driva räknar internt från resultatet före skatt, vilket är
 * samma tal – men den som ska fylla i blanketten behöver den ordningen, och
 * bara en av dem kan vara källan. Här är det blankettens.
 */
export function ink2Rows(calc: TaxCalculation): Ink2Row[] {
  const rows: Ink2Row[] = [];
  const push = (field: Ink2Field, amount: number, label = INK2_FIELD_LABEL[field]) => {
    if (amount !== 0) rows.push({ field, label, amount });
  };

  if (calc.aretsResultat >= 0) push("4.1", calc.aretsResultat);
  else push("4.2", -calc.aretsResultat);

  push("4.3a", calc.bokfordSkatt);

  // Justeringar med samma ruta summeras – blanketten har ett fält per ruta.
  const byField = new Map<Ink2Field, number>();
  for (const a of calc.adjustments) byField.set(a.field, (byField.get(a.field) ?? 0) + a.amount);
  for (const [field, amount] of byField) push(field, amount);

  push("4.14a", -calc.utnyttjatUnderskott);

  if (calc.skattemassigtResultat >= 0) push("4.15", calc.skattemassigtResultat);
  else push("4.16", -calc.skattemassigtResultat);

  return rows;
}
