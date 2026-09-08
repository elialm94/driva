import type { ExpenseKind, ExpensePaidBy, RepresentationKind, VehicleKind } from "../types";
import {
  VEHICLE_LABELS,
  mileageAllowance,
  mileageRatePerMil,
  perDiemAllowance,
  perDiemRatesFor,
} from "../accounting/allowances";
import { yearOf } from "../accounting/prisbasbelopp";
import { kr } from "../format";

/**
 * Utgifter som registreras för hand: ett köp eller privat utlägg, milersättning,
 * traktamente och representation. Modulen är ren (inga beroenden på lagret)
 * så att formulärets förhandsvisning och bokföringen räknar exakt lika –
 * "Så bokförs det" på skärmen ÄR konteringen som sparas.
 *
 * Reglerna i klartext:
 *   * Köp/utlägg: kostnad + ingående moms mot företagskontot (1930) eller,
 *     när ägaren betalat privat, mot skuld till ägaren (2893).
 *   * Milersättning: Skatteverkets schablon per mil och bilslag → 7331,
 *     skuld till ägaren. Ingen moms.
 *   * Traktamente: schablon per hel dag, halv dag och natt → 7321, skuld
 *     till ägaren. Ingen moms.
 *   * Representation: måltider är aldrig avdragsgilla (6072/7632) men momsen
 *     får lyftas till 36 kr per person (46 kr med alkohol); enklare förtäring
 *     är avdragsgill upp till 60 kr per person (6071/7631) och momsen lyfts
 *     på ett underlag om högst 300 kr per person.
 */

export const FORETAGSKONTO = 1930;
export const SKULD_TILL_AGARE = 2893;
export const INGAENDE_MOMS = 2641;
const OMVAND_MOMS_UT = 2614;
const OMVAND_MOMS_IN = 2647;
export const SKATTEFRI_BILERSATTNING = 7331;
export const SKATTEFRITT_TRAKTAMENTE = 7321;

export const REPRESENTATION_ACCOUNTS: Record<RepresentationKind, { deductible: number; nonDeductible: number }> = {
  kundmaltid: { deductible: 6071, nonDeductible: 6072 },
  kundfika: { deductible: 6071, nonDeductible: 6072 },
  personalmaltid: { deductible: 7631, nonDeductible: 7632 },
  personalfika: { deductible: 7631, nonDeductible: 7632 },
};

export const REPRESENTATION_LABELS: Record<RepresentationKind, { label: string; hint: string }> = {
  kundmaltid: { label: "Måltid med kund", hint: "Lunch, middag eller kvällsmat med kund eller leverantör" },
  kundfika: { label: "Fika med kund", hint: "Kaffe, bulle, smörgås – enklare förtäring som inte ersätter en måltid" },
  personalmaltid: { label: "Personalfest eller intern måltid", hint: "Julbord, sommarfest, måltid vid personalmöte" },
  personalfika: { label: "Fika för personalen", hint: "Enklare förtäring vid möten och i vardagen" },
};

/** Skatteverkets gränser för representation (oförändrade sedan 2017). */
export const REPRESENTATION_RULES = {
  /** Underlag per person som momsen får lyftas på, exkl. moms. */
  vatBasePerPerson: 300,
  /** Schablon för avdragsgill moms per person vid måltid: bara mat. */
  vatSchablonFood: 36,
  /** Schablon när måltiden innehåller alkohol. */
  vatSchablonAlcohol: 46,
  /** Enklare förtäring: avdragsgill kostnad per person, exkl. moms. */
  simpleRefreshmentPerPerson: 60,
} as const;

export function isMeal(kind: RepresentationKind): boolean {
  return kind === "kundmaltid" || kind === "personalmaltid";
}

export function settlementAccountFor(paidBy: ExpensePaidBy | undefined): number {
  return paidBy === "privat" ? SKULD_TILL_AGARE : FORETAGSKONTO;
}

/* ----------------------------- Representation ----------------------------- */

export interface RepresentationSplit {
  deductibleNet: number;
  nonDeductibleNet: number;
  deductibleVat: number;
  /** Moms som inte får lyftas – blir kostnad på det ej avdragsgilla kontot. */
  nonDeductibleVat: number;
  deductibleAccount: number;
  nonDeductibleAccount: number;
}

/**
 * Dela upp en representationsutgift i avdragsgill kostnad, ej avdragsgill
 * kostnad och moms som får lyftas. Hela kronor in, hela kronor ut – summan
 * av delarna är alltid exakt totalbeloppet.
 */
export function representationSplit(input: {
  kind: RepresentationKind;
  amount: number;
  vatAmount: number;
  persons: number;
  alcohol: boolean;
}): RepresentationSplit {
  const persons = Math.max(1, Math.floor(input.persons));
  const vat = Math.max(0, Math.min(input.vatAmount, input.amount));
  const net = input.amount - vat;
  const accounts = REPRESENTATION_ACCOUNTS[input.kind];

  let deductibleVat: number;
  if (isMeal(input.kind)) {
    const schablon = input.alcohol ? REPRESENTATION_RULES.vatSchablonAlcohol : REPRESENTATION_RULES.vatSchablonFood;
    deductibleVat = Math.min(vat, schablon * persons);
  } else {
    const base = Math.min(net, REPRESENTATION_RULES.vatBasePerPerson * persons);
    deductibleVat = net > 0 ? Math.min(vat, Math.round((vat * base) / net)) : 0;
  }

  const deductibleNet = isMeal(input.kind) ? 0 : Math.min(net, REPRESENTATION_RULES.simpleRefreshmentPerPerson * persons);

  return {
    deductibleNet,
    nonDeductibleNet: net - deductibleNet,
    deductibleVat,
    nonDeductibleVat: vat - deductibleVat,
    deductibleAccount: accounts.deductible,
    nonDeductibleAccount: accounts.nonDeductible,
  };
}

/* --------------------------------- Utkast --------------------------------- */

export interface ManualExpenseDraft {
  kind: ExpenseKind;
  date: string;
  paidBy: ExpensePaidBy;
  /** Köp och representation: vem man betalade. */
  supplier?: string;
  /** Totalbelopp inkl. moms, hela kronor (köp och representation). */
  amount?: number;
  vatAmount?: number;
  /** Utgiftskategori (köp). */
  category?: string;
  description?: string;
  jobId?: string;
  mileage?: { km: number; vehicle: VehicleKind; route?: string };
  perDiem?: { fullDays: number; halfDays: number; nights: number; destination?: string };
  representation?: { kind: RepresentationKind; persons: number; alcohol: boolean; participants?: string; purpose?: string };
}

export interface CategoryContext {
  key: string;
  label: string;
  account: number;
  vatFree?: boolean;
  reverseChargeRate?: number;
}

export interface PostingLine {
  account: number;
  debit: number;
  credit: number;
}

export interface ManualExpensePlan {
  kind: ExpenseKind;
  /** Beloppet som betalats eller ska betalas ut, hela kronor. */
  amount: number;
  /** Ingående moms som lyfts. */
  vatDeductible: number;
  /** Balanserad kontering – exakt det som bokförs. */
  lines: PostingLine[];
  settlementAccount: number;
  /** Kort rubrik i förhandsvisningen: "Milersättning 32 mil × 25 kr". */
  title: string;
  /** Motparten på utgiftsraden: leverantören, eller ersättningens namn när det inte finns någon. */
  supplier: string;
  /** Utgiftens beskrivning – verifikationen får "supplier – description". */
  description: string;
  /** Klarspråk på verifikationen – varför konteringen ser ut som den gör. */
  explanation: string;
  /** Regler och villkor användaren bör känna till. */
  notes: string[];
}

export type ManualExpensePlanResult = { ok: true; plan: ManualExpensePlan } | { ok: false; error: string };

const TEXT_MAX = 200;

function cleanText(value: string | undefined): string | undefined {
  const trimmed = value?.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, TEXT_MAX) : undefined;
}

function isIsoDate(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function wholeKronor(value: number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function line(account: number, debit: number, credit: number): PostingLine {
  return { account, debit, credit };
}

function settlementText(paidBy: ExpensePaidBy, verb = "Betalningen"): string {
  return paidBy === "privat"
    ? "Du betalade privat, så bolaget har en skuld till dig (2893) tills pengarna förs över till dig."
    : `${verb} dras från företagskontot (1930).`;
}

function milText(km: number): string {
  const mil = km / 10;
  return `${new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 1 }).format(mil)} mil`;
}

function kmText(km: number): string {
  return `${new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 1 }).format(km)} km`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/* ---------------------------------- Plan ---------------------------------- */

/**
 * Räkna fram konteringen för ett utkast. Fel är användarvänlig svenska – det
 * är samma text formuläret visar vid fältet och servern svarar med.
 */
export function planManualExpense(draft: ManualExpenseDraft, ctx: { category?: CategoryContext } = {}): ManualExpensePlanResult {
  if (!isIsoDate(draft.date)) return { ok: false, error: "Välj ett datum." };
  switch (draft.kind) {
    case "kop":
      return planPurchase(draft, ctx.category);
    case "milersattning":
      return planMileage(draft);
    case "traktamente":
      return planPerDiem(draft);
    case "representation":
      return planRepresentation(draft);
    default:
      return { ok: false, error: "Okänd typ av utgift." };
  }
}

function planPurchase(draft: ManualExpenseDraft, category: CategoryContext | undefined): ManualExpensePlanResult {
  const supplier = cleanText(draft.supplier);
  if (!supplier) return { ok: false, error: "Skriv vem du köpte av." };
  if (!wholeKronor(draft.amount) || draft.amount < 1) return { ok: false, error: "Ange beloppet i hela kronor." };
  if (!category) return { ok: false, error: "Välj vad köpet gällde." };
  const amount = draft.amount;
  const vatAmount = wholeKronor(draft.vatAmount) ? draft.vatAmount : 0;
  if (vatAmount < 0 || vatAmount > amount) return { ok: false, error: "Momsen kan inte vara större än beloppet." };

  const settlement = settlementAccountFor(draft.paidBy);
  const lines: PostingLine[] = [];
  let vatDeductible = 0;
  let vatText: string;
  if (category.reverseChargeRate) {
    const vat = Math.round(amount * (category.reverseChargeRate / 100));
    lines.push(line(category.account, amount, 0), line(OMVAND_MOMS_IN, vat, 0), line(OMVAND_MOMS_UT, 0, vat));
    vatText = `Leverantören fakturerar utan moms eftersom du som byggföretag är betalningsskyldig. Momsen (${category.reverseChargeRate} %) bokförs både som utgående och ingående moms, så nettot mot Skatteverket blir noll men båda leden syns i deklarationen.`;
  } else if (category.vatFree) {
    lines.push(line(category.account, amount, 0));
    vatText = "Kategorin saknar avdragsgill moms, så hela beloppet bokförs som kostnad.";
  } else {
    vatDeductible = vatAmount;
    lines.push(line(category.account, amount - vatAmount, 0));
    if (vatAmount > 0) lines.push(line(INGAENDE_MOMS, vatAmount, 0));
    vatText = vatAmount > 0 ? `Momsen (${kr(vatAmount)}) lyfts som ingående moms.` : "Ingen moms angiven.";
  }
  lines.push(line(settlement, 0, amount));

  const what = cleanText(draft.description) ?? category.label.toLowerCase();
  const isUtlagg = draft.paidBy === "privat";
  return {
    ok: true,
    plan: {
      kind: "kop",
      amount,
      vatDeductible,
      lines,
      settlementAccount: settlement,
      title: `${isUtlagg ? "Utlägg" : "Köp"} ${kr(amount)} hos ${supplier}`,
      supplier,
      description: what,
      explanation: `Du registrerade köpet hos ${supplier} som ${category.label.toLowerCase()}. Kostnaden hamnar på konto ${category.account} (${category.label}). ${settlementText(draft.paidBy)} ${vatText}`,
      notes: isUtlagg
        ? ["Kvittot ska vara ställt till bolaget eller visa att köpet gjordes för bolagets räkning."]
        : [],
    },
  };
}

function planMileage(draft: ManualExpenseDraft): ManualExpensePlanResult {
  const m = draft.mileage;
  if (!m || !Number.isFinite(m.km) || m.km <= 0) return { ok: false, error: "Ange hur långt du körde, i kilometer." };
  if (m.km > 5_000) return { ok: false, error: "Sträckan verkar för lång för en resa – dela upp den." };
  if (!(m.vehicle in VEHICLE_LABELS)) return { ok: false, error: "Välj vilken bil du körde." };
  const rate = mileageRatePerMil(draft.date, m.vehicle);
  const amount = mileageAllowance({ date: draft.date, km: m.km, vehicle: m.vehicle });
  if (amount < 1) return { ok: false, error: "Sträckan är för kort för att ge någon ersättning." };
  const route = cleanText(m.route);
  const year = yearOf(draft.date);
  return {
    ok: true,
    plan: {
      kind: "milersattning",
      amount,
      vatDeductible: 0,
      lines: [line(SKATTEFRI_BILERSATTNING, amount, 0), line(SKULD_TILL_AGARE, 0, amount)],
      settlementAccount: SKULD_TILL_AGARE,
      title: `Milersättning ${milText(m.km)} × ${new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 2 }).format(rate)} kr`,
      supplier: "Milersättning",
      description: `${milText(m.km)} ${VEHICLE_LABELS[m.vehicle].toLowerCase()}${route ? ` – ${route}` : ""}`,
      explanation: `Du körde ${kmText(m.km)} i tjänsten med ${VEHICLE_LABELS[m.vehicle].toLowerCase()}${route ? ` (${route})` : ""}. Skatteverkets schablon för ${year} är ${new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 2 }).format(rate)} kr per mil, så ${kr(amount)} får betalas ut skattefritt utan arbetsgivaravgifter. Beloppet bokförs som skattefri bilersättning (7331) och som skuld till dig (2893) tills bolaget för över pengarna. Ingen moms.`,
      notes: [
        "Skriv körjournal: datum, sträcka, vart och varför. Skatteverket kan begära den.",
        "Utbetalningen redovisas med kryss på arbetsgivardeklarationen (ruta 051) den månad den betalas ut.",
      ],
    },
  };
}

function planPerDiem(draft: ManualExpenseDraft): ManualExpensePlanResult {
  const p = draft.perDiem;
  if (!p) return { ok: false, error: "Ange resans dagar." };
  const whole = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  const fullDays = whole(p.fullDays);
  const halfDays = whole(p.halfDays);
  const nights = whole(p.nights);
  if (fullDays + halfDays + nights === 0) return { ok: false, error: "Ange minst en hel dag, halv dag eller natt." };
  if (fullDays + halfDays > 90) return { ok: false, error: "Efter tre månader på samma ort sänks traktamentet – registrera resan i delar." };
  const destination = cleanText(p.destination);
  if (!destination) return { ok: false, error: "Skriv vart resan gick." };
  const rates = perDiemRatesFor(yearOf(draft.date));
  const amount = perDiemAllowance({ date: draft.date, fullDays, halfDays, nights });
  const parts = [
    fullDays ? `${plural(fullDays, "heldag", "heldagar")} à ${kr(rates.heldag)}` : "",
    halfDays ? `${plural(halfDays, "halvdag", "halvdagar")} à ${kr(rates.halvdag)}` : "",
    nights ? `${plural(nights, "natt", "nätter")} à ${kr(rates.natt)}` : "",
  ].filter(Boolean);
  return {
    ok: true,
    plan: {
      kind: "traktamente",
      amount,
      vatDeductible: 0,
      lines: [line(SKATTEFRITT_TRAKTAMENTE, amount, 0), line(SKULD_TILL_AGARE, 0, amount)],
      settlementAccount: SKULD_TILL_AGARE,
      title: `Traktamente ${destination} – ${kr(amount)}`,
      supplier: "Traktamente",
      description: `${destination}, ${[
        fullDays ? plural(fullDays, "heldag", "heldagar") : "",
        halfDays ? plural(halfDays, "halvdag", "halvdagar") : "",
        nights ? plural(nights, "natt", "nätter") : "",
      ]
        .filter(Boolean)
        .join(", ")}`,
      explanation: `Tjänsteresa till ${destination} med övernattning: ${parts.join(", ")} = ${kr(amount)} skattefritt enligt Skatteverkets schablon för ${yearOf(draft.date)}. Beloppet bokförs som skattefritt traktamente (7321) och som skuld till dig (2893) tills bolaget för över pengarna. Ingen moms.`,
      notes: [
        "Traktamente kräver övernattning och att resmålet ligger mer än 50 km från både bostaden och arbetsplatsen.",
        "Nattraktamente gäller bara nätter då bolaget inte betalat logi. Betalade bolaget frukost eller måltider ska schablonen reduceras.",
        "Utbetalningen redovisas med kryss på arbetsgivardeklarationen (ruta 050) den månad den betalas ut.",
      ],
    },
  };
}

function planRepresentation(draft: ManualExpenseDraft): ManualExpensePlanResult {
  const r = draft.representation;
  const supplier = cleanText(draft.supplier);
  if (!supplier) return { ok: false, error: "Skriv var ni var – restaurangen eller butiken." };
  if (!wholeKronor(draft.amount) || draft.amount < 1) return { ok: false, error: "Ange beloppet i hela kronor." };
  if (!r || !(r.kind in REPRESENTATION_ACCOUNTS)) return { ok: false, error: "Välj vilken sorts representation det var." };
  if (!Number.isFinite(r.persons) || r.persons < 1) return { ok: false, error: "Ange hur många personer som deltog." };
  const amount = draft.amount;
  const vatAmount = wholeKronor(draft.vatAmount) ? draft.vatAmount : 0;
  if (vatAmount < 0 || vatAmount > amount) return { ok: false, error: "Momsen kan inte vara större än beloppet." };
  const persons = Math.floor(r.persons);
  const split = representationSplit({ kind: r.kind, amount, vatAmount, persons, alcohol: r.alcohol });
  const settlement = settlementAccountFor(draft.paidBy);

  const lines: PostingLine[] = [];
  if (split.deductibleNet > 0) lines.push(line(split.deductibleAccount, split.deductibleNet, 0));
  const nonDeductibleCost = split.nonDeductibleNet + split.nonDeductibleVat;
  if (nonDeductibleCost > 0) lines.push(line(split.nonDeductibleAccount, nonDeductibleCost, 0));
  if (split.deductibleVat > 0) lines.push(line(INGAENDE_MOMS, split.deductibleVat, 0));
  lines.push(line(settlement, 0, amount));

  const label = REPRESENTATION_LABELS[r.kind].label;
  const participants = cleanText(r.participants);
  const purpose = cleanText(r.purpose);
  const who = r.kind.startsWith("kund") ? "kund" : "personal";
  const ruleText = isMeal(r.kind)
    ? `Kostnaden för måltider vid representation är inte avdragsgill (${split.nonDeductibleAccount}), men momsen får lyftas med högst ${r.alcohol ? REPRESENTATION_RULES.vatSchablonAlcohol : REPRESENTATION_RULES.vatSchablonFood} kr per person${r.alcohol ? " när alkohol ingår" : ""} – här ${kr(split.deductibleVat)}.${split.nonDeductibleVat > 0 ? ` Resten av momsen (${kr(split.nonDeductibleVat)}) blir kostnad.` : ""}`
    : `Enklare förtäring är avdragsgill upp till ${REPRESENTATION_RULES.simpleRefreshmentPerPerson} kr per person exkl. moms (${split.deductibleAccount}) – här ${kr(split.deductibleNet)}.${split.nonDeductibleNet > 0 ? ` Resten (${kr(split.nonDeductibleNet)}) bokförs som ej avdragsgill (${split.nonDeductibleAccount}).` : ""} Momsen lyfts på ett underlag om högst ${REPRESENTATION_RULES.vatBasePerPerson} kr per person${split.nonDeductibleVat > 0 ? `; ${kr(split.nonDeductibleVat)} av momsen blir kostnad` : ""}.`;

  return {
    ok: true,
    plan: {
      kind: "representation",
      amount,
      vatDeductible: split.deductibleVat,
      lines,
      settlementAccount: settlement,
      title: `${label} ${kr(amount)} · ${plural(persons, "person", "personer")}`,
      supplier,
      description: `${label.toLowerCase()}, ${plural(persons, "person", "personer")}${purpose ? `, ${purpose}` : ""}`,
      explanation: `${label} hos ${supplier} för ${plural(persons, "person", "personer")}${participants ? ` (${participants})` : ""}${purpose ? `, ${purpose}` : ""}. ${ruleText} ${settlementText(draft.paidBy)}`,
      notes: [
        `Anteckna vem som deltog och syftet – det krävs för ${who}representation.`,
        ...(isMeal(r.kind) && r.kind === "kundmaltid"
          ? ["Måltiden ska ha ett omedelbart samband med verksamheten, t.ex. en affärsförhandling."]
          : []),
      ],
    },
  };
}

/** Alla konton en manuell utgift kan beröra – sidan slår upp namnen åt klienten. */
export const MANUAL_EXPENSE_ACCOUNTS: readonly number[] = [
  FORETAGSKONTO,
  SKULD_TILL_AGARE,
  INGAENDE_MOMS,
  OMVAND_MOMS_UT,
  OMVAND_MOMS_IN,
  SKATTEFRI_BILERSATTNING,
  SKATTEFRITT_TRAKTAMENTE,
  6071,
  6072,
  7631,
  7632,
];

/** Sant när planen är i balans – förhandsvisningen ska aldrig kunna visa något motorn skulle vägra. */
export function planIsBalanced(plan: ManualExpensePlan): boolean {
  const debit = plan.lines.reduce((s, l) => s + l.debit, 0);
  const credit = plan.lines.reduce((s, l) => s + l.credit, 0);
  return debit > 0 && debit === credit;
}
