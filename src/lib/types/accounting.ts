/**
 * Bokföring: kontoplan, verifikationer, räkenskapsår, moms, lön, tillgångar och bokslutsbilagor.
 *
 * Del av domänmodellen. Importera via barrelen `@/lib/types`.
 */

import type { ID } from "./common";

/* ---------------------------------- Bokföring -------------------------------- */

/** Kontotyp. Styr om kontot hör till balans- eller resultaträkningen. */
export type AccountType = "tillgang" | "eget_kapital" | "skuld" | "intakt" | "kostnad";

/** Post i balansräkningen enligt K2. */
export type BalanceSection =
  | "immateriella_anlaggningstillgangar"
  | "materiella_anlaggningstillgangar"
  | "finansiella_anlaggningstillgangar"
  | "varulager"
  | "kortfristiga_fordringar"
  | "kassa_och_bank"
  | "bundet_eget_kapital"
  | "fritt_eget_kapital"
  | "obeskattade_reserver"
  | "avsattningar"
  | "langfristiga_skulder"
  | "kortfristiga_skulder";

/** Post i resultaträkningen enligt K2 (kostnadsslagsindelad). */
export type ResultSection =
  | "nettoomsattning"
  | "ovriga_rorelseintakter"
  | "ravaror_och_fornodenheter"
  | "ovriga_externa_kostnader"
  | "personalkostnader"
  | "avskrivningar"
  | "ovriga_rorelsekostnader"
  | "finansiella_intakter"
  | "finansiella_kostnader"
  | "bokslutsdispositioner"
  | "skatt"
  | "arets_resultat";

export type AccountSection = BalanceSection | ResultSection;

/**
 * Företagets avvikelse från den levererade BAS-kontoplanen: ett eget konto,
 * ett omdöpt konto eller ett arkiverat konto. Bara avvikelser lagras –
 * standardplanen ligger i koden (accounting/chart.ts) och kopieras inte per
 * företag. Se `chartAccounts()` för det sammanslagna registret.
 */
export interface ChartAccountRecord {
  id: ID;
  number: number;
  name: string;
  type: AccountType;
  section: AccountSection;
  /** Sant när kontot inte finns i standardplanen. */
  custom: boolean;
  /** Avstängt för nya konteringar. Befintlig bokföring påverkas aldrig. */
  archived?: boolean;
  createdAt: string;
}

export interface VerificationEntry {
  account: number;
  accountName: string;
  debit: number;
  credit: number;
  /** Momskod (t.ex. "MP1", "I"). Härleds annars centralt från kontot. */
  vatCode?: string;
  /** Radbeskrivning/dimension, t.ex. koppling till uppdrag. */
  note?: string;
}

export type VerificationSource =
  | { type: "kundfaktura"; id: ID }
  | { type: "betalning"; id: ID }
  | { type: "utgift"; id: ID }
  | { type: "leverantorsfaktura"; id: ID }
  | { type: "banktransaktion"; id: ID }
  | { type: "rattelse"; id: ID }
  | { type: "avskrivning"; id: ID }
  | { type: "periodisering"; id: ID }
  | { type: "moms"; id: ID }
  | { type: "skattekonto"; id: ID }
  | { type: "lon"; id: ID }
  | { type: "bokslut"; id: ID }
  | { type: "ingaende_balans"; id: ID }
  /** Importerad från SIE-fil (id = dataimportens id). Behåller filens serie och nummer. */
  | { type: "sie_import"; id: ID }
  | { type: "manuell" };

/**
 * Verifikation = bokförd affärshändelse. Bokförda verifikationer är
 * oföränderliga: rättelser görs alltid som ny rättelseverifikation
 * (se accounting/engine.ts), aldrig genom att ändra eller ta bort.
 */
/**
 * Bilagan på verifikationen: fakturan, kvittot eller avtalet som verifikationen
 * vilar på. Bokföringslagen kräver att underlaget bevaras och går att koppla
 * till verifikationen, så en granskare ska kunna öppna det från raden.
 * Lagras som kvitton (se receipts/receipt-file.ts): bucket när fillagring finns,
 * annars inline.
 */
export interface VerificationAttachment {
  filename: string;
  contentType: string;
  sizeBytes: number;
  /** Sökväg i privata bucketen `receipts`. */
  storagePath?: string;
  /** Inline base64 (JSON-läge/demo, eller utan fillagring). Aldrig båda satta. */
  contentBase64?: string;
}

export interface Verification {
  id: ID;
  /** Verifikationsserie, se accounting/series.ts. Automatiken bokför i A, manuella verifikat i M. */
  series: string;
  number: number;
  /** Bokföringsdatum (styr period, momsperiod och räkenskapsår). */
  date: string;
  /**
   * Handelsdatum: när affärshändelsen faktiskt inträffade, när det avviker från
   * bokföringsdatumet. Styr ingenting i bokföringen – det är en uppgift om
   * händelsen, inte om perioden.
   */
  transactionDate?: string;
  description: string;
  entries: VerificationEntry[];
  /** Underlaget bakom verifikationen. */
  attachment?: VerificationAttachment;
  source: VerificationSource;
  confidence: "hog" | "medel" | "lag";
  createdBy: "auto" | "anvandare" | "assistent";
  /** V1 bokförs verifikationer direkt (inga utkast). Fältet finns för arkitekturen. */
  status: "bokford";
  /** När verifikationen bokfördes (låstes). */
  postedAt: string;
  /** Räkenskapsår verifikationen hör till. */
  fiscalYearId?: ID;
  /** Denna verifikation rättar en tidigare. */
  correctsVerificationId?: ID;
  /** Denna verifikation har rättats av en senare. */
  correctedByVerificationId?: ID;
  /** Klarspråksförklaring: varför bokfördes det så här? */
  explanation?: string;
  createdAt: string;
}

/* ------------------------- Räkenskapsår och perioder ------------------------- */

export interface FiscalYear {
  id: ID;
  /** T.ex. "2026". */
  label: string;
  /** YYYY-MM-DD (inklusive). */
  startDate: string;
  /** YYYY-MM-DD (inklusive). */
  endDate: string;
  status: "oppet" | "stangt";
  /**
   * Ingående balanser per konto (kontonummer som nyckel).
   * Positivt = debetsaldo, negativt = kreditsaldo. Summan är alltid 0.
   */
  openingBalances: Record<string, number>;
  /** Varifrån IB kommer. */
  openingSource: "migrering" | "foregaende_ar" | "manuell";
  closedAt?: string;
  /** Bokslutsverifikationer som skapades när året stängdes. */
  closingVerificationIds?: ID[];
  /** Varje gång året öppnats igen efter ett bokslut. Raderas aldrig. */
  reopenings?: FiscalYearReopening[];
}

/**
 * En återöppning av ett stängt räkenskapsår. Bokslutet är inte permanent – ett
 * fel som upptäcks efteråt ska gå att rätta – men varje återöppning är en
 * ingripande händelse och lämnar därför ett spår som inte går att sudda ut.
 */
export interface FiscalYearReopening {
  at: string;
  by: "anvandare" | "assistent" | "system";
  /** Varför året öppnades. Krävs. */
  reason: string;
  /** Bokslutsverifikationerna som återfördes, i den ordning de bokfördes. */
  reversedVerificationIds: ID[];
  /** Återföringarna som bokfördes vid återöppningen. */
  reversalVerificationIds: ID[];
  /**
   * Periodlåset som gällde innan året öppnades. Låset måste flyttas bakåt för
   * att året ska gå att rätta, och återställs hit när året stängs igen – annars
   * skulle senare deklarerade perioder ligga olåsta efteråt.
   */
  previousLockedThrough?: string;
}

/* ----------------------------------- Moms ------------------------------------ */

export interface VatBox {
  /** Deklarationsruta, t.ex. "05", "10", "48", "49". */
  code: string;
  label: string;
  amount: number;
}

export interface VatReport {
  id: ID;
  fiscalYearId: ID;
  /** YYYY-MM-DD. */
  periodStart: string;
  periodEnd: string;
  /** T.ex. "april–juni 2026". */
  label: string;
  status: "utkast" | "deklarerad";
  boxes: VatBox[];
  utgaende: number;
  ingaende: number;
  /** Positivt = att betala, negativt = att få tillbaka. */
  attBetala: number;
  generatedAt: string;
  declaredAt?: string;
  /** Omföringsverifikation till 2650 när rapporten markerats deklarerad. */
  settleVerificationId?: ID;
}

/* ------------------------------------ Lön ------------------------------------ */

export type EmployeeRole = "foretagsledare" | "tjansteman";

/**
 * Grunden för skatteavdraget på lönen. `tabell` bär beloppet som slagits upp i
 * Skatteverkets skattetabell tillsammans med lönen uppslaget gjordes för, så att
 * det går att se när uppslaget inte längre gäller. Se accounting/payroll-model.ts.
 */
export type TaxBasis =
  | { kind: "tabell"; table: number; monthlyDeduction: number; salaryAtLookup: number }
  | { kind: "procent"; percent: number };

/**
 * Anställd. V1 är en anställd: ägaren med fast månadslön. Personnummret är
 * känsligt och den enda källan för födelsedatumet som styr arbetsgivaravgiften.
 */
export interface Employee {
  id: ID;
  name: string;
  /** YYYYMMDD-NNNN. Maska i vanliga vyer (maskPersonnummer). */
  personnummer: string;
  email?: string;
  role: EmployeeRole;
  /** Fast månadslön, hela kronor. */
  monthlySalary: number;
  taxBasis: TaxBasis;
  /** Anställningens första dag, YYYY-MM-DD. */
  startDate: string;
  /** Sista anställningsdag, YYYY-MM-DD. */
  endDate?: string;
  status: "anstalld" | "avslutad";
  createdAt: string;
}

/**
 * En bokförd lönekörning för en månad. Beloppen är frysta här: verifikationen är
 * oföränderlig, och lönespecifikationen och arbetsgivardeklarationen ska visa
 * exakt det som bokfördes.
 */
export interface PayrollRun {
  id: ID;
  employeeId: ID;
  /** Lönemånad, YYYY-MM. */
  month: string;
  /** Utbetalningsdag, YYYY-MM-DD. Bokföringsdatum för lönen. */
  payDate: string;
  gross: number;
  /** Avdragen preliminärskatt. */
  tax: number;
  net: number;
  employerContribution: number;
  /** Satsen som tillämpades, i procent – historiken ska stå kvar när lagen ändras. */
  contributionPercent: number;
  /** Skattegrunden vid körningen, sparad så att specifikationen kan visa den. */
  taxBasis: TaxBasis;
  salaryAccount: number;
  verificationId: ID;
  createdBy: "anvandare" | "assistent";
  createdAt: string;
}

/** En individuppgift i arbetsgivardeklarationen. */
export interface EmployerDeclarationRow {
  employeeId: ID;
  name: string;
  personnummer: string;
  gross: number;
  tax: number;
  employerContribution: number;
  /**
   * Specifikationsnummer (fältkod 570) i AGI-filen. Måste vara samma nummer
   * för samma anställd om en lämnad månad rättas – annars läser Skatteverket
   * rättelsen som en extra individuppgift i stället för en ersättning. Numret
   * fryses här när deklarationen skapas.
   */
  specifikationsnummer?: number;
}

/**
 * Arbetsgivardeklaration (AGI) för en månad. Samma statusmaskin som
 * momsrapporten: utkast som genereras ur bokföringen, sedan deklarerad med
 * frysta siffror, audit och periodlås.
 */
export interface EmployerDeclaration {
  id: ID;
  /** Redovisningsmånad, YYYY-MM. */
  month: string;
  /** T.ex. "mars 2026". */
  label: string;
  status: "utkast" | "deklarerad";
  rows: EmployerDeclarationRow[];
  gross: number;
  tax: number;
  employerContribution: number;
  /** Summan att betala till skattekontot: avgifter + avdragen skatt. */
  attBetala: number;
  /** Förfallodag för deklaration och betalning, YYYY-MM-DD. */
  dueDate: string;
  generatedAt: string;
  declaredAt?: string;
  /** Verifikationen som förde avgifter och personalskatt till skattekontot. */
  taxAccountVerificationId?: ID;
}

/* -------------------------------- Inventarier -------------------------------- */

export interface AssetDepreciation {
  fiscalYearId: ID;
  amount: number;
  verificationId: ID;
}

export interface Asset {
  id: ID;
  name: string;
  /** YYYY-MM-DD. */
  acquisitionDate: string;
  /** Anskaffningsvärde exkl. moms, hela kronor. */
  acquisitionValue: number;
  assetAccount: number;
  depreciationAccount: number;
  accumulatedDepreciationAccount: number;
  usefulLifeYears: number;
  status: "aktiv" | "fullt_avskriven" | "utrangerad";
  sourceExpenseId?: ID;
  acquisitionVerificationId?: ID;
  depreciations: AssetDepreciation[];
  createdAt: string;
}

/* ------------------------------ Periodiseringar ------------------------------ */

export type AccrualKind =
  | "forutbetald_kostnad"
  | "upplupen_kostnad"
  | "forutbetald_intakt"
  | "upplupen_intakt";

export interface Accrual {
  id: ID;
  kind: AccrualKind;
  description: string;
  /** Belopp exkl. moms som flyttas över bokslutet. */
  amount: number;
  /** Kostnads-/intäktskontot som justeras. */
  counterAccount: number;
  /** Interimskonto (1710/1790/2970/2990). */
  balanceAccount: number;
  /** Perioden underlaget avser (YYYY-MM-DD). */
  fromDate: string;
  toDate: string;
  /** Räkenskapsåret där bokslutsposten bokförs. */
  fiscalYearId: ID;
  status: "planerad" | "bokford" | "aterford";
  sourceType?: "utgift" | "leverantorsfaktura" | "kundfaktura";
  sourceId?: ID;
  bookVerificationId?: ID;
  reverseVerificationId?: ID;
  createdAt: string;
}

/* ------------------------------ Bokslutsbilagor ------------------------------ */

/**
 * En bokslutsbilaga är specifikationen bakom ett balanskonto: vad saldot
 * BESTÅR av, inte bara vad det är. Revisorn och Skatteverket frågar efter
 * bilagan, inte efter kontot.
 *
 * Tre bilagor kräver uppgifter som inte finns i bokföringen och därför måste
 * anges: sparade semesterdagar, bedömningen av vilka kundfordringar som är
 * osäkra, och hur stor avsättning till periodiseringsfond bolaget vill göra.
 */
export type YearEndScheduleKind =
  | "semesterloneskuld"
  | "kundfordringar_nedskrivning"
  | "periodiseringsfond";

/** En rad i specifikationen. Raderna summerar till bilagans utgående belopp. */
export interface YearEndScheduleLine {
  label: string;
  amount: number;
  /** Hur raden räknats fram, i klartext. */
  note?: string;
}

/** Uppgifter som inte går att härleda ur bokföringen utan måste anges. */
export interface YearEndScheduleInputs {
  /** Semesterlöneskuld: sparade betalda semesterdagar vid årets slut. */
  savedVacationDays?: number;
  /** Nedskrivning: kundfakturor som bedöms som osäkra. */
  doubtfulInvoiceIds?: ID[];
  /** Periodiseringsfond: årets avsättning. */
  fundAllocation?: number;
  /** Periodiseringsfond: återföringar, per det år fonden avsattes. */
  fundReversals?: { year: number; amount: number }[];
}

export interface YearEndSchedule {
  id: ID;
  kind: YearEndScheduleKind;
  fiscalYearId: ID;
  /** Vad bilagan kommer fram till att kontot ska visa vid årets slut. */
  closingAmount: number;
  /** Specifikationen bakom beloppet. */
  lines: YearEndScheduleLine[];
  inputs: YearEndScheduleInputs;
  status: "utkast" | "bokford";
  /** Verifikationerna bilagan gett upphov till (justering och ev. avgifter). */
  verificationIds: ID[];
  createdBy: "anvandare" | "assistent";
  createdAt: string;
  bookedAt?: string;
}
