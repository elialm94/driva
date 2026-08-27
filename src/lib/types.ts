/**
 * Domänmodell för Driva – AI-native business-in-a-box för svenska småföretag.
 * Alla belopp är i SEK (hela kronor om inget annat anges), datum är ISO-strängar.
 */

export type ID = string;

export type LineKind = "arbete" | "material" | "ovrigt";
/** V1: endast inhemsk svensk moms. Omvänd skattskyldighet, EU, export och byggmoms stöds inte. */
export type VatRate = 0 | 6 | 12 | 25;

/* ---------------------------------- Företag ---------------------------------- */

export interface CompanySettings {
  name: string;
  /** Bolagsform. Styr eget kapital-konton och skatt vid bokslut. Default "ab". */
  companyForm?: "ab" | "enskild";
  orgNumber: string;
  vatNumber: string;
  email: string;
  /**
   * Vart nya förfrågningar från hemsidan mejlas.
   * Tomt = samma som `email`. Ändras inte när den publika kontaktadressen ändras.
   */
  inquiryNotificationEmail?: string;
  phone: string;
  /** Företagets webbplats (URL). Inte densamma som Driva-hemsidan. */
  websiteUrl?: string;
  address: string;
  postalCode: string;
  city: string;
  /** Juridiskt säte. Om tomt används city på fakturan. */
  sate?: string;
  country?: string;
  bankgiro: string;
  plusgiro?: string;
  /** Fritt bankkontonummer, t.ex. clearing + konto. */
  bankAccount?: string;
  iban?: string;
  bic?: string;
  logoInitials: string;
  /** JPEG data-URL. Saknas = visa initialer. */
  logoDataUrl?: string;
  /** Preliminärskatt (F-skatt) som dras varje månad. */
  fSkattPerMonth: number;
  /** Reserv för arbetsgivaravgifter och personalskatt per månad. */
  payrollReservePerMonth: number;
  /** Standard betalningsvillkor i dagar. */
  paymentTermsDays: number;
  /** Standard dröjsmålsränta i procent per år (räntelagen: referensränta + 8 %-enheter). */
  lateInterestRate: number;
  /** Standard giltighetstid för nya offerter, i dagar. */
  quoteValidityDays: number;
  /** Vanlig momssats för nya dokumentrader. */
  defaultVatRate: VatRate;
}

/* ---------------------------------- Kunder ---------------------------------- */

export interface Customer {
  id: ID;
  kind: "privat" | "foretag";
  name: string;
  contactPerson?: string;
  orgNumber?: string;
  email: string;
  phone: string;
  address?: string;
  postalCode?: string;
  city?: string;
  /**
   * Personnummer för skattereduktion. Känsligt: maskas i vanliga vyer,
   * skickas inte till LLM, loggas inte i klartext.
   */
  personalIdentityNumber?: string;
  notes: string;
  createdAt: string;
}

/* -------------------------------- Förfrågningar ------------------------------ */

export type RequestSource = "hemsida" | "email" | "telefon" | "manuell" | "assistent";

export interface CustomerRequest {
  id: ID;
  customerId: ID;
  title: string;
  message: string;
  source: RequestSource;
  status: "ny" | "offert_skapad" | "besvarad" | "avslutad";
  quoteId?: ID;
  createdAt: string;
  /** Klientnyckel så att refresh/retry inte skapar dubletter. */
  idempotencyKey?: string;
  /** Avisering till företagaren – sparas före utskick, kan retrys utan ny förfrågan. */
  notification?: {
    status: "pending" | "sent" | "failed";
    sentAt?: string;
    lastError?: string;
    attempts: number;
  };
  /** AI-tolkning av förfrågan. */
  ai?: {
    workType?: string;
    desiredStart?: string;
    budget?: string;
    address?: string;
  };
}

/* ---------------------------------- Dokumentrader ---------------------------- */

export interface DocLine {
  id: ID;
  kind: LineKind;
  description: string;
  qty: number;
  unit: string;
  /** Pris per enhet, exkl. moms. */
  unitPrice: number;
  vatRate: VatRate;
}

export interface RotRut {
  type: "rot" | "rut";
}

/** Bostadstyp för ROT – bara ett fältset visas åt gången. */
export type DwellingType = "smahus" | "bostadsratt";

/** Fastighets-/bostadsuppgifter. Ägs av uppdraget och återanvänds på del-fakturor. */
export interface HousingDetails {
  dwellingType?: DwellingType;
  /** Fastighetsbeteckning – endast vid Fastighet/småhus. */
  propertyDesignation?: string;
  /** BRF organisationsnummer – endast vid Bostadsrätt. */
  brfOrgNumber?: string;
  /** Lägenhetsnummer – endast vid Bostadsrätt. */
  apartmentNumber?: string;
}

export type TaxReductionApplicationStatus =
  | "preliminar"
  | "redo_att_ansokas"
  | "underlag_skapat"
  | "godkant"
  | "delvis_godkant"
  | "nekat";

/** Manuellt ansökningssteg – ingen Skatteverket-API i V1. */
export interface TaxReductionApplication {
  status: TaxReductionApplicationStatus;
  underlagCreatedAt?: string;
  /** Sammanfattning för export. Innehåller inte personnummer i aktivitetsloggen. */
  underlagSummary?: string;
  decision?: {
    outcome: "godkant" | "delvis_godkant" | "nekat";
    decidedAt: string;
    deniedAmount?: number;
  };
}

/** ROT/RUT-uppgifter på fakturan. Personnummer ligger på kunden, inte här. */
export interface TaxReductionDetails {
  workAddress?: string;
  workPeriodStart?: string;
  workPeriodEnd?: string;
  housing?: HousingDetails;
}

/**
 * Immutabelt utdrag av ROT/RUT-villkor som kunden såg och (vid BankID) godkände.
 * Version + full text sparas så att senare ändringar av standardtexten inte
 * skriver över det signerade innehållet.
 */
export interface TaxReductionTermsSnapshot {
  version: string;
  type: "rot" | "rut";
  heading: string;
  body: string;
  text: string;
}

export interface PaymentPlanPart {
  label: string;
  percent: number;
}

/* ---------------------------------- Offerter --------------------------------- */

export type QuoteStatus = "utkast" | "skickad" | "godkand" | "avbojd" | "utgangen";

export interface QuoteVersion {
  id: ID;
  quoteId: ID;
  version: number;
  title: string;
  intro: string;
  lines: DocLine[];
  rot: RotRut | null;
  paymentPlan: PaymentPlanPart[];
  paymentTermsDays: number;
  /** Dröjsmålsränta i procent per år vid försenad betalning. */
  lateInterestRate?: number;
  validUntil: string;
  /** Användarens egna villkor. ROT/RUT-villkor ligger i taxReductionTerms, inte här. */
  terms: string;
  /**
   * Systemgenererade ROT/RUT-villkor. Sätts av offerttjänsten när rot är valt,
   * tas bort när rot slås av. Snapshoten låses med versionen vid BankID.
   */
  taxReductionTerms?: TaxReductionTermsSnapshot | null;
  /**
   * Företagsuppgifter när versionen skickades eller BankID-låstes.
   * Ingår inte i contentHash – ändra inte hash-payloaden.
   */
  sellerSnapshot?: InvoiceSellerSnapshot;
  createdAt: string;
  /** Sätts när versionen låses vid BankID-godkännande. Låsta versioner får aldrig ändras. */
  lockedAt?: string;
  /** SHA-256 av det låsta innehållet – gör dokumentet verifierbart i efterhand. */
  contentHash?: string;
}

export interface Quote {
  id: ID;
  number: number;
  customerId: ID;
  requestId?: ID;
  jobId?: ID;
  status: QuoteStatus;
  currentVersionId: ID;
  /** Publik token för kundlänken. */
  token: string;
  sentAt?: string;
  viewedAt?: string;
  decidedAt?: string;
  declineReason?: string;
  /** Tidpunkter då påminnelser/uppföljningar skickats. */
  followUps: string[];
  createdAt: string;
}

/* ---------------------------------- BankID ----------------------------------- */

export type BankIDEnvironment = "mock" | "production";

export interface BankIDSignature {
  id: ID;
  quoteId: ID;
  quoteVersionId: ID;
  orderRef: string;
  signerName: string;
  signerPersonalNumberMasked: string;
  signedAt: string;
  environment: BankIDEnvironment;
  evidence: {
    contentHash: string;
    note: string;
  };
}

export type BankIDHint =
  | "outstandingTransaction"
  | "userSign"
  | "userCancel"
  | "expiredTransaction"
  | "startFailed"
  | "complete";

export interface BankIDOrder {
  orderRef: string;
  quoteId: ID;
  quoteVersionId: ID;
  status: "pending" | "complete" | "failed";
  hintCode: BankIDHint;
  method: "same_device" | "qr";
  createdAt: string;
  updatedAt: string;
}

/* ---------------------------------- Uppdrag (Job) ------------------------------------- */

export type JobStatus = "kommande" | "pagar" | "klart";

export interface ChecklistItem {
  id: ID;
  text: string;
  done: boolean;
}

export interface Job {
  id: ID;
  customerId: ID;
  quoteId?: ID;
  title: string;
  description: string;
  status: JobStatus;
  startDate?: string;
  endDate?: string;
  address?: string;
  checklist: ChecklistItem[];
  notes: string;
  createdAt: string;
  completedAt?: string;
  /** Bostadsuppgifter för ROT. Prefillas på fakturor från uppdraget. */
  housing?: HousingDetails;
  /** ROT/RUT-ansökan för uppdraget (delas av alla fakturor på jobbet). */
  taxReductionApplication?: TaxReductionApplication;
}

/* ---------------------------------- Fakturor --------------------------------- */

export type InvoiceStatus = "utkast" | "skickad" | "betald" | "krediterad";
export type InvoiceType = "faktura" | "delbetalning" | "slutfaktura" | "kredit";

/** Säljaren vid utfärdandet – fryses så att senare ändringar i företagsuppgifter inte ändrar gamla fakturor. */
export interface InvoiceSellerSnapshot {
  name: string;
  orgNumber: string;
  vatNumber: string;
  address: string;
  postalCode: string;
  city: string;
  sate: string;
  country?: string;
  email: string;
  phone: string;
  websiteUrl?: string;
  bankgiro: string;
  plusgiro?: string;
  bankAccount?: string;
  iban?: string;
  bic?: string;
  logoInitials: string;
  logoDataUrl?: string;
}

/** Köparen vid utfärdandet. */
export interface InvoiceBuyerSnapshot {
  name: string;
  kind: Customer["kind"];
  orgNumber?: string;
  address: string;
  postalCode: string;
  city: string;
  country: string;
  email: string;
  phone: string;
}

export interface InvoiceVatRow {
  rate: number;
  base: number;
  vat: number;
}

/** Juridisk kopia av utfärdad faktura. InvoiceDocument för skickad+ renderar härifrån, inte live-data. */
export interface InvoiceIssuedSnapshot {
  issuedAt: string;
  number: number;
  ocr: string;
  issueDate: string;
  dueDate: string;
  paymentTermsDays: number;
  lateInterestRate?: number;
  currency: "SEK";
  serviceDate?: string;
  seller: InvoiceSellerSnapshot;
  buyer: InvoiceBuyerSnapshot;
  lines: DocLine[];
  rot: RotRut | null;
  taxReductionTerms?: TaxReductionTermsSnapshot | null;
  taxReductionDetails?: TaxReductionDetails | null;
  totals: {
    subtotal: number;
    vat: number;
    total: number;
    laborInclVat: number;
    deduction: number;
    toPay: number;
  };
  vatBreakdown: InvoiceVatRow[];
  creditsInvoiceId?: ID;
  creditsInvoiceNumber?: number;
}

export interface Invoice {
  id: ID;
  /** Löpnummer. null på nya utkast – tilldelas atomärt vid issueInvoice. Äldre utkast kan redan ha nummer. */
  number: number | null;
  customerId: ID;
  jobId?: ID;
  quoteId?: ID;
  type: InvoiceType;
  status: InvoiceStatus;
  lines: DocLine[];
  rot: RotRut | null;
  /** Kopia av ROT/RUT-villkor vid utkast/utfärdande. Fryses i issuedSnapshot. */
  taxReductionTerms?: TaxReductionTermsSnapshot | null;
  /** Adress, period och bostad. Personnummer ligger på kunden. */
  taxReductionDetails?: TaxReductionDetails | null;
  /** Ansökan för fristående faktura (utan uppdrag). */
  taxReductionApplication?: TaxReductionApplication;
  issueDate: string;
  dueDate: string;
  paymentTermsDays: number;
  /** Utförandedatum/leveransdatum. Visas på dokumentet om det skiljer sig från fakturadatum. */
  serviceDate?: string;
  /** Dröjsmålsränta i procent per år vid försenad betalning. */
  lateInterestRate?: number;
  /** När fakturan blev juridiskt utfärdad (nummer + snapshot). */
  issuedAt?: string;
  /** Första e-postleveransen (i demon: mock-logg). Misslyckad leverans rullar inte tillbaka numret. */
  sentAt?: string;
  /** Senaste leveransförsöket (skicka igen). */
  lastSentAt?: string;
  paidAt?: string;
  reminders: string[];
  token: string;
  ocr: string;
  creditsInvoiceId?: ID;
  issuedSnapshot?: InvoiceIssuedSnapshot;
  createdBy?: "anvandare" | "assistent";
  createdAt: string;
}

export interface Payment {
  id: ID;
  invoiceId: ID;
  bankTransactionId?: ID;
  amount: number;
  date: string;
  matchedBy: "auto" | "manuell";
}

/* ---------------------------------- Bank ------------------------------------- */

export interface BankAccount {
  id: ID;
  provider: "mock" | "tink";
  name: string;
  accountNumber: string;
  balance: number;
  connectedAt: string;
}

export type TxStatus = "ny" | "matchad" | "bokford" | "behover_atgard";

export interface BankTransaction {
  id: ID;
  accountId: ID;
  date: string;
  /** Positivt = inbetalning, negativt = utbetalning. */
  amount: number;
  counterpart: string;
  description: string;
  reference?: string;
  status: TxStatus;
  matchedType?: "faktura" | "utgift" | "leverantorsfaktura" | "skatt" | "ovrigt";
  matchedId?: ID;
  verificationId?: ID;
}

/* ---------------------------------- Utgifter --------------------------------- */

export type ExpenseStatus = "saknar_kvitto" | "behover_svar" | "bokford";

export interface Expense {
  id: ID;
  supplier: string;
  date: string;
  /** Totalbelopp inkl. moms. */
  amount: number;
  vatAmount: number;
  category?: string;
  description?: string;
  jobId?: ID;
  receiptId?: ID;
  bankTransactionId?: ID;
  status: ExpenseStatus;
  question?: { text: string; options: string[] };
  verificationId?: ID;
  createdAt: string;
}

export interface Receipt {
  id: ID;
  expenseId?: ID;
  filename: string;
  source: "foto" | "uppladdning" | "email";
  uploadedAt: string;
  /** AI-extraherade fält (mockad OCR i demo). */
  extracted: {
    supplier: string;
    date: string;
    amount: number;
    vatAmount: number;
    description: string;
    category: string;
    confidence: "hog" | "medel" | "lag";
  };
}

export interface SupplierInvoice {
  id: ID;
  supplier: string;
  invoiceNumber: string;
  date: string;
  dueDate: string;
  amount: number;
  vatAmount: number;
  description: string;
  category: string;
  status: "obetald" | "betald";
  bankTransactionId?: ID;
  /** Verifikation när fakturan togs emot (kostnad + leverantörsskuld). */
  verificationId?: ID;
  /** Verifikation när fakturan betalades. */
  paymentVerificationId?: ID;
  createdAt: string;
}

/* ---------------------------------- Bokföring -------------------------------- */

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
  | { type: "bokslut"; id: ID }
  | { type: "ingaende_balans"; id: ID }
  | { type: "manuell" };

/**
 * Verifikation = bokförd affärshändelse. Bokförda verifikationer är
 * oföränderliga: rättelser görs alltid som ny rättelseverifikation
 * (se accounting/engine.ts), aldrig genom att ändra eller ta bort.
 */
export interface Verification {
  id: ID;
  /** Verifikationsserie. V1 använder "A"; arkitekturen tillåter fler. */
  series: string;
  number: number;
  /** Bokföringsdatum (styr period, momsperiod och räkenskapsår). */
  date: string;
  description: string;
  entries: VerificationEntry[];
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

/* --------------------------------- Audit trail -------------------------------- */

export type AuditAction =
  | "verifikation_bokford"
  | "verifikation_rattad"
  | "period_last"
  | "momsrapport_genererad"
  | "momsrapport_deklarerad"
  | "rakenskapsar_skapat"
  | "rakenskapsar_stangt"
  | "inventarie_registrerad"
  | "avskrivning_bokford"
  | "periodisering_planerad"
  | "periodisering_bokford"
  | "arsredovisning_genererad"
  | "arsredovisning_status"
  | "bokforing_angrad";

export interface AuditEvent {
  id: ID;
  at: string;
  actor: "anvandare" | "assistent" | "system";
  action: AuditAction;
  targetType?: string;
  targetId?: ID;
  details: string;
}

/* ------------------------------- Årsredovisning ------------------------------- */

export interface ReportRow {
  label: string;
  amount: number;
  /** Summeringsrad. */
  bold?: boolean;
  /** Notreferens. */
  note?: number;
}

export interface AnnualReportContent {
  companyName: string;
  orgNumber: string;
  fiscalLabel: string;
  periodStart: string;
  periodEnd: string;
  forvaltningsberattelse: {
    verksamhet: string;
    vasentligaHandelser: string;
    flerarsoversikt: { label: string; nettoomsattning: number; resultatEfterFinansiella: number; soliditetProcent: number }[];
    resultatdisposition: { tillForfogande: number; balanserasINyRakning: number };
  };
  resultatrakning: ReportRow[];
  balansrakningTillgangar: ReportRow[];
  balansrakningEgetKapitalSkulder: ReportRow[];
  noter: { title: string; body: string }[];
}

export interface AnnualReport {
  id: ID;
  fiscalYearId: ID;
  /** Ingen riktig inlämning sker – "inlamnad_markerad" är en manuell markering med audit trail. */
  status: "genererad" | "granskad" | "signerad" | "inlamnad_markerad";
  content: AnnualReportContent;
  generatedAt: string;
  reviewedAt?: string;
  signedAt?: string;
  markedFiledAt?: string;
}

/* ---------------------------------- Aktivitet -------------------------------- */

export interface ActivityEvent {
  id: ID;
  at: string;
  text: string;
  customerId?: ID;
  createdBy?: "anvandare" | "assistent";
  entity?: {
    type: "offert" | "faktura" | "jobb" | "forfragan" | "utgift" | "verifikation" | "hemsida" | "doman";
    id: ID;
  };
}

/* ---------------------------------- Hemsida ---------------------------------- */

export type WebsiteTheme = "tra" | "studio" | "ren" | "el" | "konsult";

export interface WebsiteSectionItem {
  title: string;
  text: string;
  /** Data-URL eller relativ sökväg. Valfri – kortet fungerar utan bild. */
  image?: string;
}

export interface WebsiteSection {
  id: ID;
  type: "hero" | "tjanster" | "om" | "galleri" | "kontakt";
  heading: string;
  body: string;
  /** Valfri bild (data-URL). Hero och om oss: saknas = endast text, ingen platshållare. */
  image?: string;
  /** Tjänster-kort. Arrayordning = visningsordning. */
  items?: WebsiteSectionItem[];
  /** false = dold på sajten. Saknas eller true = synlig. Innehållet sparas. */
  visible?: boolean;
}

/** Standardtext för primärknappen i sidhuvud och startsektion. */
export const DEFAULT_PRIMARY_CTA_LABEL = "Begär offert";
export const PRIMARY_CTA_LABEL_MAX = 40;

export interface Website {
  id: ID;
  slug: string;
  businessName: string;
  tagline: string;
  city?: string;
  status: "utkast" | "publicerad";
  theme: WebsiteTheme;
  /** Arrayordning = visningsordning på sajten. */
  sections: WebsiteSection[];
  /** Gemensam primärknapp i sidhuvud och startsektion. Saknas = DEFAULT_PRIMARY_CTA_LABEL. */
  primaryCta?: { label: string };
  publishedAt?: string;
  createdAt: string;
  submissions: number;
}

/* ---------------------------------- Domän ---------------------------------- */

/** V1: endast .se. Fler TLD:er kan läggas till utan att byta modell. */
export type DomainTld = "se";

export type DomainStatus =
  | "checking"
  | "available"
  | "purchasing"
  | "registering"
  | "registered"
  | "configuring"
  | "verifying"
  | "active"
  | "failed"
  | "expired";

export type DomainSource = "purchased" | "existing";

export type DomainBillingStatus = "pending" | "paid" | "failed" | "renewal_failed";

export type DomainSslStatus = "pending" | "active" | "failed";

export type DomainVerificationStatus = "pending" | "verified" | "failed";

export type DomainErrorCategory =
  | "profile_incomplete"
  | "unavailable"
  | "payment_failed"
  | "registrar_failed"
  | "hosting_failed"
  | "dns_pending"
  | "ssl_pending"
  | "validation"
  | "conflict";

export type DomainRegistrarProviderId = "openprovider" | "mock";

export interface DomainBilling {
  customerPrice: number;
  purchasePrice: number;
  currency: "SEK";
  purchasedAt?: string;
  renewsAt?: string;
  autoRenew: boolean;
  status: DomainBillingStatus;
  chargeId?: string;
  idempotencyKey: string;
}

export type DomainProvisioningStep =
  | "profile"
  | "availability"
  | "billing"
  | "registrant"
  | "register"
  | "nameservers"
  | "hosting"
  | "dns"
  | "ssl"
  | "done";

export interface DomainProvisioning {
  step: DomainProvisioningStep;
  billed: boolean;
  registered: boolean;
  registrantCreated: boolean;
  nameserversConfigured: boolean;
  hostingAttached: boolean;
  dnsVerified: boolean;
  sslReady: boolean;
  /** Antal poll-tick, används av mock för att simulera väntan. */
  ticks: number;
  lastError?: { category: DomainErrorCategory; message: string; at: string };
}

export interface Domain {
  id: ID;
  /** En-tenant i V1: alltid aktuellt företag. Fältet finns för att blockera cross-tenant takeover. */
  businessId: ID;
  websiteId?: ID;
  hostname: string;
  tld: DomainTld;
  source: DomainSource;
  registrarProvider: DomainRegistrarProviderId;
  registrarDomainId?: string;
  registrarRegistrantId?: string;
  status: DomainStatus;
  isPrimary: boolean;
  registeredAt?: string;
  expiresAt?: string;
  autoRenew: boolean;
  verificationStatus: DomainVerificationStatus;
  sslStatus: DomainSslStatus;
  billing: DomainBilling;
  provisioning: DomainProvisioning;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export type DomainAuditAction =
  | "domain_searched"
  | "domain_purchase_started"
  | "domain_paid"
  | "domain_payment_failed"
  | "domain_registrant_created"
  | "domain_registered"
  | "domain_register_failed"
  | "domain_nameservers_set"
  | "domain_hosting_attached"
  | "domain_hosting_failed"
  | "domain_dns_verified"
  | "domain_ssl_active"
  | "domain_active"
  | "domain_failed"
  | "domain_retry"
  | "domain_autorenew_changed"
  | "domain_renewal_failed"
  | "domain_existing_started"
  | "domain_existing_verified";

export interface DomainAuditEvent {
  id: ID;
  at: string;
  actor: "anvandare" | "assistent" | "system";
  action: DomainAuditAction;
  domainId?: ID;
  hostname?: string;
  details: string;
}

/* ---------------------------------- Assistent -------------------------------- */

export type AssistantCard =
  | { kind: "links"; links: { label: string; href: string }[] }
  | {
      kind: "list";
      title?: string;
      rows: { label: string; value?: string; href?: string }[];
      links?: { label: string; href: string }[];
    }
  | {
      kind: "confirm";
      actionId: ID;
      summary: string;
      rows?: { label: string; value?: string }[];
      confirmLabel: string;
      state: "vantar" | "utford" | "avbruten";
      resultText?: string;
    }
  | {
      kind: "entity";
      entity: "kund" | "uppdrag" | "offert" | "faktura";
      title: string;
      subtitle?: string;
      href: string;
      openLabel: string;
    }
  | {
      kind: "create_customer";
      actionId: ID;
      suggestedName: string;
      state: "vantar" | "utford" | "avbruten";
      resultText?: string;
    };

export interface AssistantMessage {
  id: ID;
  role: "user" | "assistant";
  at: string;
  text: string;
  card?: AssistantCard;
}

/** Vad assistenten ska fortsätta med efter att en saknad kund skapats. */
export type ResumeAfterCustomer =
  | { kind: "create_quote"; title?: string; amountInclVat?: number; rot?: "rot" | "rut" | null }
  | { kind: "create_job"; title: string; startDate?: string; description?: string }
  | {
      kind: "create_invoice";
      title?: string;
      amountInclVat?: number;
      jobId?: ID;
      taxReduction?: "rot" | "rut" | null;
    };

export type PendingAssistantAction =
  | { id: ID; type: "paminn_forsenade"; invoiceIds: ID[] }
  | { id: ID; type: "folj_upp_offerter"; quoteIds: ID[] }
  | { id: ID; type: "bokfor_utgift"; expenseId: ID; category: string; jobId?: ID }
  | { id: ID; type: "generera_hemsida"; description: string }
  | { id: ID; type: "skicka_offert"; quoteId: ID }
  | { id: ID; type: "skicka_faktura"; invoiceId: ID }
  | { id: ID; type: "publicera_hemsida" }
  | { id: ID; type: "skapa_kund"; name: string; resume?: ResumeAfterCustomer }
  | { id: ID; type: "uppdatera_foretag"; patch: Record<string, string | number | null> }
  | { id: ID; type: "kor_bokslut_automatik"; fiscalYearId: ID }
  | { id: ID; type: "slutfor_bokslut"; fiscalYearId: ID }
  | { id: ID; type: "angra_utgift"; expenseId: ID }
  | { id: ID; type: "markera_moms_deklarerad"; reportId: ID }
  | { id: ID; type: "skapa_tillaggsoffert"; customerId: ID; jobId: ID; title: string; amountInclVat: number }
  | { id: ID; type: "kop_doman"; hostname: string };

/** Internt verktygsaudit – visas inte i chatten. */
export interface AssistantAuditEntry {
  id: ID;
  at: string;
  tool: string;
  params: unknown;
  success: boolean;
  ms: number;
  error?: string;
}

/* ---------------------------------- Databas ---------------------------------- */

export interface DB {
  settings: CompanySettings;
  sequences: { quote: number; invoice: number; verification: number };
  customers: Customer[];
  requests: CustomerRequest[];
  quotes: Quote[];
  quoteVersions: QuoteVersion[];
  signatures: BankIDSignature[];
  bankidOrders: BankIDOrder[];
  jobs: Job[];
  invoices: Invoice[];
  payments: Payment[];
  bankAccounts: BankAccount[];
  bankTransactions: BankTransaction[];
  expenses: Expense[];
  receipts: Receipt[];
  supplierInvoices: SupplierInvoice[];
  verifications: Verification[];
  /** Räkenskapsår. Skapas automatiskt (kalenderår) av bokföringsmotorn. */
  fiscalYears: FiscalYear[];
  /** Bokföringsinställningar. lockedThrough: bokföringen är låst t.o.m. detta datum (YYYY-MM-DD). */
  accounting: { lockedThrough?: string };
  vatReports: VatReport[];
  assets: Asset[];
  accruals: Accrual[];
  auditTrail: AuditEvent[];
  annualReports: AnnualReport[];
  activity: ActivityEvent[];
  website: Website | null;
  domains: Domain[];
  domainAudit: DomainAuditEvent[];
  assistantMessages: AssistantMessage[];
  pendingActions: PendingAssistantAction[];
  assistantAudit: AssistantAuditEntry[];
  meta: { seededAt: string };
}
