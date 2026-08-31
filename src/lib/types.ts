/**
 * Domänmodell för Driva – AI-native business-in-a-box för svenska småföretag.
 * Alla belopp är i SEK (hela kronor om inget annat anges), datum är ISO-strängar.
 */

import type { RichTextDoc } from "./richtext";
import type { EconomicLineType, LineKind } from "./economic-line-type";

export type { EconomicLineType, LineKind } from "./economic-line-type";

export type ID = string;
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
   * Vart nya uppdrag från hemsidans formulär mejlas.
   * Tomt = samma som `email`. Ändras inte när den publika kontaktadressen ändras.
   */
  websiteNotificationEmail?: string;
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
  /**
   * Stabil lokal-del för inkommande leverantörsmejl (`slug@in.driva.se`).
   * Tenantuppslag sker på den här sluggen – aldrig på From-headern.
   */
  inboundMailSlug?: string;
  /**
   * Företagets BETALKONTO för utgående leverantörsbetalningar (pain.001-
   * debitor). Skilt från bankgiro/iban ovan som är MOTTAGARUPPGIFTER på
   * kundfakturor. Endast fälten som betalfilsprofilen kräver.
   */
  payerBankName?: string;
  /** Debiteringskontots IBAN (kontrollsiffervaliderat vid sparande). */
  payerIban?: string;
  /** Debiteringsbankens BIC, t.ex. ESSESESS. */
  payerBic?: string;
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
   * Personnummer för skattereduktion. Hör till den privata kunden – inte till
   * offert, faktura, uppdrag eller bostad. Känsligt: maskas i vanliga vyer
   * (`1985••••-1234`), skickas inte till LLM, läggs inte i URL eller
   * analytics, och loggas inte i klartext. Serveractions som läser/skriver
   * värdet validerar input och returnerar maskat värde om det inte är en
   * dedikerad "Visa"-åtgärd.
   *
   * JSON-lagret (`src/lib/store.ts`) sparar fältet i klartext. Kryptering i
   * vila kräver en riktig databas – vi hittar inte på krypto här.
   */
  personalIdentityNumber?: string;
  /** Arbetsplatser/bostäder. En privat kund kan ha hem + fritidshus. */
  workLocations?: WorkLocation[];
  /** Standardadress för nytt uppdrag / ROT-prefill när flera bostäder finns. */
  defaultWorkLocationId?: ID;
  notes: string;
  createdAt: string;
}

/** Bostad där arbete utförs. ROT-uppgifter (beteckning/BRF) bor här, personnummer på kunden. */
export interface WorkLocation {
  id: ID;
  label: string;
  address: string;
  postalCode: string;
  city: string;
  placeId?: string;
  propertyType: DwellingType;
  propertyDesignation?: string;
  brfOrgNumber?: string;
  apartmentNumber?: string;
}

/* ---------------------------------- Dokumentrader ---------------------------- */

/**
 * Varifrån en fakturarad kommer. Sätts när information rör sig framåt i
 * kedjan (offert → uppdrag → faktura). Utkast kan redigeras utan att
 * källan (signerad offert) ändras.
 */
export type LineSourceKind =
  | "QUOTE_LINE"
  | "JOB_TIME_ENTRY"
  | "JOB_MATERIAL"
  | "JOB_OTHER"
  | "PAYMENT_PLAN"
  | "MANUAL";

export interface DocLine {
  id: ID;
  /** Lagrad typ (arbete/material/resor/ovrigt). */
  kind: LineKind;
  /**
   * Kanonisk typ (LABOR/MATERIAL/TRAVEL/OTHER). Samma klassning som `kind`.
   * Kedjan Offert → Uppdrag → Faktura kopierar fältet oförändrat.
   */
  type?: EconomicLineType;
  description: string;
  qty: number;
  unit: string;
  /** Pris per enhet, exkl. moms. */
  unitPrice: number;
  vatRate: VatRate;
  sourceKind?: LineSourceKind;
  /** Offertrad-id, uppdragspost-id eller motsvarande. */
  sourceId?: ID;
  sourceQuoteNumber?: number;
  paymentPlanIndex?: number;
}

export interface RotRut {
  type: "rot" | "rut";
  /**
   * Maximalt avdrag utifrån denna offert/faktura (arbetskostnad + ROT/RUT-regler).
   * Inte kundens saldo hos Skatteverket.
   */
  calculatedEligibleTaxReduction?: number;
  /** Avdraget som används på dokumentet. Standard: samma som calculated. */
  appliedTaxReduction?: number;
  /** true när användaren sänkt avdraget manuellt. */
  taxReductionManuallyAdjusted?: boolean;
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
  /**
   * Skatteverkets utbetalning: bokas 1930 mot 1513 när pengarna kommer.
   * Sätts EN gång per ansökan (idempotensvakt – en ansökan kan aldrig få
   * dubbla utbetalningsbokningar).
   */
  payout?: {
    amount: number;
    at: string;
    verificationId: ID;
    bankTransactionId?: ID;
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
   * Beskrivning – rik text (strikt vitlistad delmängd, se lib/richtext).
   * Saneras vid varje servergräns. Ligger på versionen → BankID-låsning fryser
   * den, och den ingår villkorligt i contentHash (endast när den finns).
   */
  richText?: RichTextDoc;
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
  jobId?: ID;
  /**
   * Bostad som ROT/RUT på den här offerten gäller. Måste vara explicit
   * sparad här – kundens fastigheter räcker inte vid utskick.
   * Samma relation som Job.workLocationId, så kedjan offert → uppdrag →
   * faktura kan ärva fältet utan ny modell.
   */
  workLocationId?: ID;
  status: QuoteStatus;
  currentVersionId: ID;
  /** Publik token för kundlänken. */
  token: string;
  sentAt?: string;
  viewedAt?: string;
  decidedAt?: string;
  declineReason?: string;
  /** Senaste lyckade e-postleveransen. Sätts bara efter provider-succé. */
  lastEmail?: DocumentEmailDelivery;
  lastSendAttemptAt?: string;
  /** Tidpunkter då påminnelser/uppföljningar skickats. */
  followUps: string[];
  createdAt: string;
}

/** Senaste lyckade utskicket via e-postleverantören. */
export interface DocumentEmailDelivery {
  provider: "resend";
  messageId: string;
  sentTo: string;
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
/** Varifrån uppdraget kom. Källa för analys – inte en egen entitet. */
export type JobSource = "manual" | "web_form" | "email" | "import" | "phone" | "other";

export interface JobNotification {
  status: "pending" | "sent" | "failed";
  sentAt?: string;
  lastError?: string;
  attempts: number;
}

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
  /** Kundens bostad där jobbet görs. ROT-beteckning/BRF hämtas härifrån; personnummer från kunden. */
  workLocationId?: ID;
  checklist: ChecklistItem[];
  notes: string;
  createdAt: string;
  completedAt?: string;
  /** Bostadsuppgifter för ROT. Prefillas på fakturor från uppdraget. */
  housing?: HousingDetails;
  /** ROT/RUT-ansökan för uppdraget (delas av alla fakturor på jobbet). */
  taxReductionApplication?: TaxReductionApplication;
  /** Ursprung: manuellt, webbformulär, e-post, import, telefon. Default manual. */
  source?: JobSource;
  /** Inkommande meddelande som det skickades – behålls om beskrivningen redigeras. */
  originalMessage?: string;
  /** Klientnyckel så att refresh/retry på webbformuläret inte skapar dubletter. */
  idempotencyKey?: string;
  /** Avisering till företagaren vid webbformulär – kan retrys utan nytt uppdrag. */
  notification?: JobNotification;
  /**
   * Arkiverat (mjuk borttagning). Döljs från Aktiva/Planerade. Fakturor,
   * offerter och bokföring rörs inte.
   */
  archivedAt?: string;
}

/**
 * Registrerat arbete/material på ett uppdrag – inte offertrader och inte
 * fakturarader. Offertrad = avtalat. Work entry (actual) = utfört.
 * Fakturarad = det som faktureras (eget liv, skapas från offert eller actuals).
 */
export type JobWorkEntryType = "labor" | "material" | "travel" | "other";
export type JobWorkEntryRole = "planned" | "actual";
export type JobWorkEntrySource = "manual" | "quote" | "ai" | "import";

export interface JobWorkEntry {
  id: ID;
  jobId: ID;
  /** planned = avtalad offertbaseline. actual = registrerat arbete/material. */
  role: JobWorkEntryRole;
  type: JobWorkEntryType;
  description: string;
  /** Utförandedatum (YYYY-MM-DD). */
  date: string;
  qty: number;
  unit: string;
  /** Pris per enhet, exkl. moms, hela kronor. */
  unitPrice: number;
  vatRate: VatRate;
  source: JobWorkEntrySource;
  /** Offertrad som baseline/matchning – muterar aldrig offerten. */
  quotedLineItemId?: ID;
  /** true när posten inte ingår i ursprunglig offert. */
  isExtra: boolean;
  /** Kopplad faktura (utkast eller utfärdad). Saknas = ej fakturerad. */
  invoiceId?: ID;
  createdAt: string;
  updatedAt: string;
}

/** Hur uppdraget faktureras – härlett, inte en användarväljare. */
export type JobPricingKind = "fast_pris" | "lopande" | "hybrid";

/* ---------------------------------- Fakturor --------------------------------- */

/**
 * Fakturastatus. "delbetald" = utfärdad fordran där inbetalningar täcker en
 * del av att-betala. Förfallen härleds (isOverdue) och lagras aldrig.
 */
export type InvoiceStatus = "utkast" | "skickad" | "delbetald" | "betald" | "krediterad";
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
  /** "Er referens" på dokumentet. */
  contactPerson?: string;
  /**
   * Personnummer för den som får skattereduktionen – fryses ENDAST när
   * fakturan har ROT/RUT (känsligt: lagras inte på vanliga fakturor).
   * Historiska dokument renderar härifrån, aldrig via live-uppslag på kunden.
   */
  personalIdentityNumber?: string;
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
  /** Frusen kopia av beskrivningen vid utfärdandet. */
  richText?: RichTextDoc;
  taxReductionTerms?: TaxReductionTermsSnapshot | null;
  taxReductionDetails?: TaxReductionDetails | null;
  totals: {
    subtotal: number;
    vat: number;
    total: number;
    laborInclVat: number;
    /** Använt (applied) avdrag – det kunden ser och det som ansöks. */
    deduction: number;
    toPay: number;
    /** Internt max utifrån dokumentets rader. Saknas på äldre snapshots. */
    calculatedEligibleTaxReduction?: number;
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
  /**
   * Bostad som ROT/RUT på den här fakturan gäller. Explicit sparad relation
   * (samma fält som offert/uppdrag). Ärvs från offerten när den finns.
   */
  workLocationId?: ID;
  type: InvoiceType;
  status: InvoiceStatus;
  lines: DocLine[];
  rot: RotRut | null;
  /**
   * Beskrivning – rik text (strikt vitlistad delmängd, se lib/richtext).
   * Saneras vid varje servergräns. Fryses i issuedSnapshot vid utfärdandet –
   * utfärdade fakturor renderar alltid den frusna kopian.
   */
  richText?: RichTextDoc;
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
  /** Första lyckade e-postleveransen. Sätts bara efter provider-succé. */
  sentAt?: string;
  /** Senaste leveransförsöket (skicka igen). */
  lastSentAt?: string;
  lastEmail?: DocumentEmailDelivery;
  lastSendAttemptAt?: string;
  paidAt?: string;
  reminders: string[];
  token: string;
  ocr: string;
  creditsInvoiceId?: ID;
  /**
   * Restfaktura för nekat ROT/RUT-avdrag: pekar på ursprungsfakturan.
   * Bokförs som omflytt av fordran (1513 → 1510) – aldrig ny intäkt eller moms,
   * eftersom hela intäkten och momsen redovisades när ursprungsfakturan utfärdades.
   */
  deniedReductionOf?: ID;
  issuedSnapshot?: InvoiceIssuedSnapshot;
  /**
   * Återbetalning till kund – sätts EN gång när utbetalningen bokförs
   * (kreditering av betald faktura eller överbetalning). Exceptionen
   * "återbetala X kr" härleds ur betalningar/krediter tills fältet är satt.
   */
  refund?: { amount: number; at: string; verificationId: ID; bankTransactionId?: ID };
  /**
   * Överbetalning bokförd som skuld till kunden (2420), ej återbetald.
   * Styr vilket konto en återbetalning ska nollställa (2420 vs negativ 1510).
   */
  overpaymentCredit?: number;
  /**
   * Vilket steg i offertens betalningsplan den här fakturan täcker.
   * Används för att inte fakturera samma del två gånger.
   */
  paymentPlanIndex?: number;
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

/**
 * Banktransaktionens livscykel: ny → bokford (matchad + verifikation) eller
 * behover_atgard (ingen säker matchning – väntar på människa). Matchnings-
 * förslag härleds vid läsning (services/payment-matching.ts) och lagras inte.
 */
export type TxStatus = "ny" | "bokford" | "behover_atgard";

export interface BankTransaction {
  id: ID;
  accountId: ID;
  /**
   * Leverantörens transaktions-id. Gör återimport idempotent: samma id kan
   * aldrig skapa en dubblett (unikt index i DB + domänvakt vid import).
   */
  externalId?: string;
  date: string;
  /** Positivt = inbetalning, negativt = utbetalning. Hela kronor (öre avrundas vid importgränsen – se README-ADR). */
  amount: number;
  counterpart: string;
  description: string;
  reference?: string;
  status: TxStatus;
  matchedType?: "faktura" | "utgift" | "leverantorsfaktura" | "skatt" | "skattereduktion" | "aterbetalning" | "ovrigt";
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

export type AccountingStatus = "obokford" | "bokford";

/**
 * Leverantörsbetalningens livscykel. Bokförd ≠ bankfil skapad ≠ betald.
 * UI visar svenska etiketter – aldrig dessa enum-namn.
 *
 * V1-flödet är filbaserat: READY → PAYMENT_FILE_CREATED (pain.001 genererad
 * och nedladdad – användaren laddar upp den i internetbanken själv) → PAID
 * (först när banktransaktionen matchats). En skapad/nedladdad fil betyder
 * ALDRIG "skickad till bank" eller "betald". SUBMITTED_TO_BANK/AWAITING_
 * APPROVAL/SCHEDULED är reserverade för en framtida direktintegration
 * (BankPaymentProvider.submitPayment) och sätts aldrig av filflödet.
 */
export type SupplierPaymentStatus =
  | "DRAFT"
  | "READY"
  | "PAYMENT_FILE_CREATED"
  | "SUBMITTED_TO_BANK"
  | "AWAITING_APPROVAL"
  | "SCHEDULED"
  | "PAID"
  | "FAILED"
  | "CANCELLED";

/* --------------------- Betalningsuppgifter (leverantör) ---------------------- */

export type PaymentDetailsMethod = "bankgiro" | "plusgiro" | "iban";

/**
 * Proveniens för verifierade betalningsuppgifter – lagras alltid ihop med
 * uppgifterna. En LLM-gissning kan aldrig bli verifierad: "document" sätts
 * endast vid högkonfident extraktion ur dokumentet, övriga kräver människa.
 */
export type PaymentDetailsProvenance =
  | "document" // högkonfident läsning ur dokumentet (autopiloten, ≥ AUTO-tröskeln)
  | "document_confirmed" // dokument + mänsklig kontroll (Kontrollera/Godkänn-flödet)
  | "manual" // människa angav uppgifterna själv
  | "supplier_history"; // återanvänt från tidigare verifierade uppgifter + bekräftelse

export interface VerifiedPaymentDetails {
  method: PaymentDetailsMethod;
  account: string;
  ocr?: string;
  source: PaymentDetailsProvenance;
  verifiedAt: string;
  verifiedBy: "anvandare" | "assistent" | "system";
  /** Faktura vars verifierade uppgifter återanvändes (source = supplier_history). */
  reusedFromInvoiceId?: ID;
}

/**
 * Lagrat tillstånd för fakturans betalningsuppgifter. "Ändrade uppgifter" och
 * "verifierade uppgifter finns hos leverantören" HÄRLEDS vid läsning
 * (services/payment-details.ts) och lagras aldrig. Saknat fält på äldre data
 * härleds: konto finns = VERIFIED (legacy), annars MISSING.
 */
export type StoredPaymentDetailsState =
  | "VERIFIED"
  | "EXTRACTION_UNCERTAIN"
  | "MISSING"
  | "AWAITING_SUPPLIER";

export interface SupplierInvoicePaymentDetails {
  state: StoredPaymentDetailsState;
  /** Verifierad destination med proveniens – endast när state = VERIFIED. */
  verified?: VerifiedPaymentDetails;
  /** Osäker kandidat ur dokumentet – används ALDRIG för betalning utan bekräftelse. */
  candidate?: { account?: string; ocr?: string };
  /** Begäran om komplettering skickad till leverantören (state = AWAITING_SUPPLIER). */
  request?: { to: string; sentAt: string };
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
  /**
   * Betalningsutfall på fakturan (kompatibilitet): betald endast när
   * pengarna faktiskt kommit tillbaka från banken. Inte samma sak som bokförd.
   */
  status: "obetald" | "betald";
  /** Bokföring av mottagen faktura – separat från betalning. */
  accountingStatus: AccountingStatus;
  ocr?: string;
  bankgiro?: string;
  recipientAccount?: string;
  /**
   * Betalningsuppgifternas tillstånd + proveniens. En faktura utan VERIFIED
   * destination kan aldrig bli redo att betalas eller skickas till bank
   * (vakter i supplier-payments.ts). Osäkra kandidater hamnar i
   * paymentDetails.candidate – aldrig i bankgiro/recipientAccount.
   */
  paymentDetails?: SupplierInvoicePaymentDetails;
  inboxItemId?: ID;
  bankTransactionId?: ID;
  /** Verifikation när fakturan togs emot (kostnad + leverantörsskuld). */
  verificationId?: ID;
  /** Verifikation när fakturan betalades. */
  paymentVerificationId?: ID;
  createdAt: string;
}

/** Utbetalningsinstruktion mot banken – en aktiv (icke-avslutad) per faktura. */
export interface SupplierPayment {
  id: ID;
  supplierInvoiceId: ID;
  amount: number;
  currency: "SEK";
  dueDate: string;
  /** Önskat betaldatum. Default = förfallodatum. */
  scheduledDate: string;
  ocr?: string;
  reference?: string;
  recipientAccount: string;
  recipientName: string;
  providerPaymentId?: string;
  idempotencyKey: string;
  status: SupplierPaymentStatus;
  failureReason?: string;
  /** Mottagarkonto skiljer sig från tidigare verifierad betalning till samma leverantör. */
  destinationChanged?: boolean;
  bankTransactionId?: ID;
  /**
   * Aktiv bankfil (pain.001) som instruktionen ingår i. Dubbelbetalnings-
   * skydd: en instruktion kan bara ingå i EN aktiv fil – regenerering
   * ersätter (status REPLACED på gamla filen), skapar aldrig en parallell.
   */
  paymentFileId?: ID;
  createdAt: string;
  submittedAt?: string;
  updatedAt: string;
  paidAt?: string;
}

/* ------------------------------ Betalfiler ----------------------------------- */

/** Exportformat för betalfiler. V1: ISO 20022 pain.001.001.03. */
export type PaymentExportFormat = "ISO20022_PAIN001";

/**
 * Genererad betalfil (pain.001). Filen är en INSTRUKTION som användaren
 * laddar upp i internetbanken – skapad fil ≠ skickad till bank ≠ betald.
 * XML:en lagras som den genererades så att "Hämta bankfil igen" alltid ger
 * exakt samma fil. REPLACED = ersatt av en ny version (aldrig två aktiva
 * filer för samma betalning).
 */
export interface PaymentFile {
  id: ID;
  /** T.ex. driva-betalningar-2026-08-30.xml. */
  filename: string;
  /** pain.001 GrpHdr/MsgId – max 35 tecken. */
  messageId: string;
  format: PaymentExportFormat;
  /** Instruktioner som ingår – en fil kan bära flera betalningar. */
  paymentIds: ID[];
  supplierInvoiceIds: ID[];
  /** Summa i hela kronor (SEK). */
  totalAmount: number;
  currency: "SEK";
  /** Genererad XML (UTF-8) – lagras för deterministisk återhämtning. */
  xml: string;
  status: "CREATED" | "REPLACED" | "CANCELLED";
  replacedByFileId?: ID;
  createdAt: string;
  createdBy: "anvandare" | "assistent";
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
  | "bokforing_angrad"
  // Affärshändelser (autopiloten): kritiska pengaflöden auditloggas alltid,
  // i samma transaktion som själva händelsen.
  | "faktura_utfardad"
  | "faktura_skickad"
  | "faktura_krediterad"
  | "betalning_matchad"
  | "utgift_bokford"
  | "banktransaktion_bokford"
  | "rot_underlag_skapat"
  | "rot_beslut"
  | "rot_utbetalning_mottagen"
  | "taxreduktion_uppgift_andrad"
  | "samarbete_bjuden"
  | "samarbete_accepterad"
  | "samarbete_aterkallad"
  | "samarbete_skrivning"
  | "kundunderlag_begart"
  | "kundunderlag_lost";

export type BusinessRole = "owner" | "admin" | "member" | "accounting_consultant" | "auditor";
export type CollaborationRole = "accounting_consultant" | "auditor";

export interface AuditEvent {
  id: ID;
  at: string;
  actor: "anvandare" | "assistent" | "system";
  /** Verifierad användare när skrivningen gjordes av en människa (ägare/konsult/revisor). */
  actorUserId?: string;
  actorRole?: BusinessRole;
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
    type: "offert" | "faktura" | "jobb" | "utgift" | "verifikation" | "hemsida" | "doman";
    id: ID;
  };
}

/* ---------------------------------- Hemsida ---------------------------------- */

/**
 * Äldre palettfält från AI-generatorn (branschpaletter). Ersatt av
 * `WebsiteDesign` (tema + accentfärg) men behålls i lagringen så att äldre
 * sajter kan härledas till rätt utseende utan datamigrering.
 */
export type WebsiteTheme = "tra" | "studio" | "ren" | "el" | "konsult";

/**
 * Utseende = tema + accentfärg. Temat äger typografi, layout, ytor och hur
 * accenten används; accenten är den ENDA fria färgvariabeln (kuraterad lista,
 * aldrig fri färgväljare). Definitionerna bor i `src/lib/website-design.ts`.
 */
export type WebsiteThemeId = "klassisk" | "modern" | "robust" | "minimal";

export type WebsiteAccentId = "gron" | "bla" | "tegel" | "sand" | "svart";

export interface WebsiteDesign {
  themeId: WebsiteThemeId;
  accent: WebsiteAccentId;
}

/**
 * Sektionstyper i hemsidesbyggaren. `om` är äldre namn för en textsektion
 * (Om oss) och behandlas som `text` – nya sajter skapas med `text`.
 */
export type WebsiteSectionType =
  | "hero"
  | "text"
  | "om"
  | "tjanster"
  | "galleri"
  | "instagram"
  | "omdomen"
  | "kontaktuppgifter"
  | "cta"
  | "kontakt";

/** Vart en CTA-sektion ska leda. Inga fria URL:er – bara kontaktvägar. */
export type WebsiteCtaDestination = "kontakt" | "phone" | "email";

export type WebsiteImagePosition = "left" | "right";

export interface WebsiteSectionItem {
  title: string;
  text: string;
  /** Data-URL eller relativ sökväg. Valfri – kortet fungerar utan bild. */
  image?: string;
  /**
   * Betyg 1–5. Används av omdömen. Redo för Google Reviews senare
   * (`source` skiljer manuella från importerade).
   */
  rating?: number;
  /** Omdömen: t.ex. stad. */
  location?: string;
  /** Ursprung. Saknas eller "manual" = inskrivet i Driva. */
  source?: "manual" | "google";
}

export interface WebsiteInstagramPost {
  id: string;
  permalink: string;
  mediaUrl: string;
  thumbnailUrl?: string;
  caption?: string;
}

/**
 * Instagram-sektionens publika data + ev. anslutning.
 * Access token lagras här (samma JSON som sektionerna) men STRIPPAS innan
 * objektet skickas till klienten. Aldrig skrapning – bara Meta Graph API.
 */
export interface WebsiteInstagram {
  handle: string;
  /** Antal inlägg att visa. Default 6. */
  limit?: number;
  connected?: boolean;
  userId?: string;
  accessToken?: string;
  tokenExpiresAt?: string;
  posts?: WebsiteInstagramPost[];
  postsFetchedAt?: string;
}

export interface WebsiteCta {
  destination: WebsiteCtaDestination;
  /** Knapptext. Saknas = standard per destination. */
  label?: string;
}

export interface WebsiteSection {
  id: ID;
  type: WebsiteSectionType;
  heading: string;
  body: string;
  /** Valfri bild (data-URL). Hero och text: saknas = endast text, ingen platshållare. */
  image?: string;
  /** Bildens sida i textsektioner. Saknas = höger. */
  imagePosition?: WebsiteImagePosition;
  /** Tjänster, omdömen. Arrayordning = visningsordning. */
  items?: WebsiteSectionItem[];
  instagram?: WebsiteInstagram;
  cta?: WebsiteCta;
  /** Öppettider – bara kontaktuppgifter. */
  hours?: string;
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
  /**
   * Publicerat utseende (tema + accent). Saknas på äldre sajter – då härleds
   * det från det äldre `theme`-fältet (alla äldre sajter blir Klassisk, med
   * en accent som ligger nära den gamla palettens färg).
   */
  design?: WebsiteDesign;
  /**
   * Utkast till utseende: uppdaterar förhandsvisningen direkt men den
   * publicerade sajten först vid "Publicera ändringar" (samma utkast →
   * publicera-modell som sajten i övrigt). Tas bort vid publicering.
   */
  draftDesign?: WebsiteDesign;
  /** Arrayordning = visningsordning på sajten. */
  sections: WebsiteSection[];
  /** Gemensam primärknapp i sidhuvud och startsektion. Saknas = DEFAULT_PRIMARY_CTA_LABEL. */
  primaryCta?: { label: string };
  /**
   * Valfritt tillägg till den automatiska integritetspolicyn. Företagsnamn,
   * org.nr, adress och kontakt hämtas alltid live från företagsuppgifterna.
   */
  privacyPolicySupplement?: string;
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
  | { kind: "create_quote"; title?: string; amountInclVat?: number; rot?: "rot" | "rut" | null; appliedTaxReduction?: number }
  | { kind: "create_job"; title: string; startDate?: string; description?: string }
  | {
      kind: "create_invoice";
      title?: string;
      amountInclVat?: number;
      jobId?: ID;
      taxReduction?: "rot" | "rut" | null;
      appliedTaxReduction?: number;
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
  | {
      id: ID;
      type: "ratta_bokforing";
      verificationId: ID;
      intent: { kind: "konto"; category: string; reason?: string } | { kind: "omatcha"; reason?: string };
    }
  | { id: ID; type: "markera_moms_deklarerad"; reportId: ID }
  | { id: ID; type: "skapa_tillaggsoffert"; customerId: ID; jobId: ID; title: string; amountInclVat: number }
  | { id: ID; type: "kop_doman"; hostname: string }
  | { id: ID; type: "skicka_leverantorsbetalning"; paymentId: ID }
  | { id: ID; type: "avbryt_leverantorsbetalning"; paymentId: ID }
  | { id: ID; type: "anvand_leverantorsuppgifter"; supplierInvoiceId: ID }
  /** Skapa pain.001-bankfil för fakturorna – utförs först efter bekräftelse. */
  | { id: ID; type: "skapa_bankfil"; supplierInvoiceIds: ID[] }
  | { id: ID; type: "ta_bort_uppdrag"; jobId: ID };

/* --------------------------------- Påminnelser -------------------------------- */

export type ReminderStatus = "PENDING" | "COMPLETED" | "DISMISSED";

export type ReminderRelatedType = "customer" | "quote" | "invoice" | "job";

/**
 * Persisterad påminnelse skapad ur naturligt språk (eller manuellt).
 * "Förfallen" är HÄRLETT ur dueAt/status – aldrig lagrat. Borttagning är
 * mjuk (DISMISSED) så historiken bevaras.
 */
export interface Reminder {
  id: ID;
  /** Skaparen (auth.users.id). null i JSON-läget utan inloggning. */
  userId: string | null;
  title: string;
  description?: string;
  /**
   * Absolut tidpunkt (ISO, UTC-instant) när en dag är känd. Saknas helt för
   * odaterade påminnelser – det är giltigt, inte försenat. Lokal semantik via
   * timezone + hasExplicitTime (datum utan klockslag ≠ midnatt).
   */
  dueAt?: string;
  /** IANA-tidszon, t.ex. Europe/Stockholm – styr all användarvänd formatering. */
  timezone: string;
  /** Angav användaren klockslag/dagsdel? Styr visning och när den dyker upp i uppmärksamhet. */
  hasExplicitTime: boolean;
  status: ReminderStatus;
  source: "assistant" | "user";
  relatedEntityType?: ReminderRelatedType;
  relatedEntityId?: ID;
  createdAt: string;
  completedAt?: string;
  /** Uppskjuten till (ISO) – döljs ur uppmärksamhet tills dess. */
  snoozedUntil?: string;
  /** Reserverad för framtida återkommande påminnelser – ingen implementation ännu. */
  recurrenceRule?: string;
}

/* --------------------------- Uppmärksamhetstillstånd -------------------------- */

/**
 * Snooze/avfärdan för en rad i "Behöver din uppmärksamhet". Ren presentations-
 * policy: domänstatus ändras ALDRIG här – en snoozad faktura är fortfarande
 * försenad, den döljs bara ur uppmärksamhetslistan (och räknaren) tills
 * snoozedUntil passerats. Därefter syns den automatiskt igen OM åtgärds-
 * motorn fortfarande härleder den; är saken löst under tiden är den borta.
 *
 * userId: per användare när inloggning finns (auth.users.id); null i
 * JSON-/demoläget utan inloggning → gäller hela företaget. En rad per
 * (företag, actionId, användare) – tjänstelagret upserttar.
 */
export interface AttentionState {
  id: ID;
  /** Den som snoozade (auth.users.id). null i JSON-läget → företagsgemensam. */
  userId: string | null;
  /** Åtgärdsmotorns stabila rad-id, t.ex. "invoice-late-<id>". */
  actionId: string;
  /** Dold ur uppmärksamhet till denna tidpunkt (ISO). */
  snoozedUntil?: string;
  /** Endast för dismissBehavior HIDE (rena info-rader) – aldrig domänstatus. */
  dismissedAt?: string;
  dismissalReason?: string;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------ Samarbete --------------------------------- */

export type CollaborationInviteStatus = "pending" | "accepted" | "revoked" | "expired";

export interface CollaborationInvitation {
  id: ID;
  businessId: ID;
  email: string;
  role: CollaborationRole;
  invitedByUserId: ID;
  invitedByName: string;
  /** SHA-256 av engångstoken – klartext lagras aldrig. */
  tokenHash: string;
  expiresAt: string;
  acceptedAt?: string;
  acceptedByUserId?: ID;
  revokedAt?: string;
  revokedByUserId?: ID;
  status: CollaborationInviteStatus;
  createdAt: string;
}

/**
 * Begäran från redovisningskonsult till ägaren (samma åtgärdsmotor).
 * När underlaget kommer in löses både Hem-raden och konsultkön.
 */
export type ClientInformationKind = "receipt" | "clarification" | "other";

export interface ClientInformationRequest {
  id: ID;
  kind: ClientInformationKind;
  /** Stabil åtgärdsid: `client-request-<id>`. */
  title: string;
  /** T.ex. "Anna behöver kvittot från Bauhaus, 875 kr." */
  message: string;
  expenseId?: ID;
  supplierInvoiceId?: ID;
  requestedByUserId: ID;
  requestedByName: string;
  requestedByRole: CollaborationRole;
  createdAt: string;
  resolvedAt?: string;
  resolvedByUserId?: ID;
}

/* ---------------------------------- Inbox --------------------------------- */

export type InboxItemKind = "mail" | "uppladdning";
export type InboxItemStatus = "ny" | "behandlad" | "bokford";
export type InboxDocumentType = "leverantorsfaktura" | "kvitto" | "ekonomiskt_dokument";
export type InboxItemSource = "email" | "uppladdning" | "vidarebefordrad";

/**
 * Privat bilaga – hämtas alltid via den auktoriserade routen
 * /api/inbox/bilaga/…, aldrig som publik URL.
 */
export interface InboxAttachment {
  id: ID;
  filename: string;
  contentType: string;
  size: number;
  storageKey: string;
  /**
   * Små dokument (≤ ~1,5 MB, pdf/bild) lagras inline så att båda
   * lagringslägena kan servera innehållet. Demobilagor (storageKey "demo/…")
   * genereras i stället deterministiskt och lagrar aldrig bytes.
   */
  contentBase64?: string;
}

/**
 * Ett extraherat fält: värde + konfidens + källa. UI:t visar mänskliga
 * tillstånd ("Säker"/"Kontrollera"), aldrig decimaler. Efter mänsklig
 * kontroll sätts konfidensen till 1 och källan till "kontrollerad".
 */
export interface ExtractedField<T = string> {
  value: T;
  /** 0–1. ≥ AUTO-tröskeln = "Säker", annars "Kontrollera". */
  confidence: number;
  /** Var värdet lästes, t.ex. "sida 1" eller "kontrollerad". */
  source?: string;
}

/**
 * Per-fält-extraktion för ett inkommande dokument. Arbetsvärdena (det
 * pipelinen använder) bor i InboxItem.parsed* – här bor proveniensen:
 * konfidens och källa per fält, inklusive OSÄKRA kandidater som inte
 * flyttats till parsed* (t.ex. ett belopp Driva inte vågar lita på).
 */
export interface InboxExtraction {
  supplier?: ExtractedField;
  invoiceNumber?: ExtractedField;
  invoiceDate?: ExtractedField;
  dueDate?: ExtractedField;
  /** Totalbelopp inkl. moms, hela kronor. */
  amount?: ExtractedField<number>;
  vatAmount?: ExtractedField<number>;
  /** Belopp exkl. moms där dokumentet anger det. */
  netAmount?: ExtractedField<number>;
  currency?: ExtractedField;
  ocr?: ExtractedField;
  bankgiro?: ExtractedField;
  plusgiro?: ExtractedField;
  iban?: ExtractedField;
  bic?: ExtractedField;
}

/**
 * Inkommande ekonomiskt underlag (leverantörsfaktura, kvitto, vidarebefordran,
 * manuell uppladdning). Webbformulär skapar uppdrag, inte inboxposter.
 * Ingen hård radering – statusmaskin (ny → behandlad/bokford).
 */
export interface InboxItem {
  id: ID;
  kind: InboxItemKind;
  status: InboxItemStatus;
  documentType: InboxDocumentType;
  source?: InboxItemSource;
  /** Leverantörens meddelande-id – unique per företag när det finns. */
  externalId?: string;
  fromAddress: string;
  toAddress: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  attachments: InboxAttachment[];
  /** Tolkat belopp i hela kronor – saknas = inte gissat. */
  parsedAmount?: number;
  parsedVatAmount?: number;
  parsedSupplier?: string;
  parsedDate?: string;
  parsedInvoiceNumber?: string;
  parsedDueDate?: string;
  parsedOcr?: string;
  parsedBankgiro?: string;
  /**
   * 0–1: konfidens specifikt för betalningsuppgifterna (bankgiro/OCR).
   * Saknas = samma som dokumentets confidence. Under AUTO-tröskeln blir
   * uppgifterna en kandidat (EXTRACTION_UNCERTAIN) – aldrig betalbara.
   */
  parsedDetailsConfidence?: number;
  /** 0–1. Autopilot bokar bara vid ≥ 0,98 och känt belopp. */
  confidence?: number;
  /**
   * Per-fält-extraktion (värde + konfidens + källa). parsed*-fälten är
   * arbetsvärdena; extraction bär proveniensen och osäkra kandidater som
   * människan kontrollerar i Kontrollera-vyn.
   */
  extraction?: InboxExtraction;
  /** När en människa granskade och godkände de extraherade uppgifterna. */
  reviewedAt?: string;
  expenseId?: ID;
  supplierInvoiceId?: ID;
  createdAt: string;
  processedAt?: string;
}

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
  quotes: Quote[];
  quoteVersions: QuoteVersion[];
  signatures: BankIDSignature[];
  bankidOrders: BankIDOrder[];
  jobs: Job[];
  /** Registrerat/avtalat arbete på uppdrag – skilt från offert- och fakturarader. */
  jobWorkEntries: JobWorkEntry[];
  invoices: Invoice[];
  payments: Payment[];
  bankAccounts: BankAccount[];
  bankTransactions: BankTransaction[];
  expenses: Expense[];
  receipts: Receipt[];
  supplierInvoices: SupplierInvoice[];
  supplierPayments: SupplierPayment[];
  /** Genererade bankfiler (pain.001). Äldre JSON-filer saknar fältet – guardera med ?? []. */
  paymentFiles: PaymentFile[];
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
  reminders: Reminder[];
  /** Snooze/avfärdan för uppmärksamhetsrader – presentationspolicy, aldrig domänstatus. */
  attentionStates: AttentionState[];
  /** Inkommande leverantörsmejl. Äldre JSON-filer saknar fältet – guardera med ?? []. */
  inboxItems: InboxItem[];
  /** Inbjudningar till redovisningskonsult/revisor för DETTA företag. */
  collaborationInvitations?: CollaborationInvitation[];
  /** Konsultens begäran om underlag – matar samma åtgärdsmotor som Hem. */
  clientInformationRequests?: ClientInformationRequest[];
  meta: {
    seededAt: string;
    /**
     * Sant för det publika demoföretaget. Läses från businesses.is_demo
     * (kolumn, fryst vid insert) när tillståndet laddas i Supabase-läget och
     * skrivs ALDRIG tillbaka – appen kan inte flagga om ett riktigt företag.
     */
    demo?: boolean;
    /** Engångshydrering av ROT-demodata (personnummer m.m.) – får inte återuppstå om användaren tagit bort det. */
    taxReductionDemoHydrated?: boolean;
    /**
     * Deterministiska kategoriregler lärda av användarens val: när ett köp
     * hos en leverantör bokförs med en kategori räknas det upp här, och nästa
     * köp hos samma leverantör föreslås/bokförs likadant med förklaringen
     * "X har bokförts som Y n gånger". Ingen ML – bara räknade beslut.
     */
    merchantCategoryRules?: Record<string, MerchantCategoryRule>;
  };
}

/** Lärd kategoriregel per leverantör (normaliserat namn som nyckel). */
export interface MerchantCategoryRule {
  /** Kategori-nyckel ur EXPENSE_CATEGORIES. */
  category: string;
  /** Antal gånger användaren bekräftat/valt kategorin för leverantören. */
  count: number;
  lastUsedAt: string;
}
