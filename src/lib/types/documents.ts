/**
 * Offert- och fakturadokument: rader, versioner, godkännande, betalning.
 *
 * Del av domänmodellen. Importera via barrelen `@/lib/types`.
 */

import type { ID, VatRate } from "./common";
import type { Customer } from "./customers";
import type { RotRut, TaxReductionApplication, TaxReductionDetails, TaxReductionTermsSnapshot } from "./tax-reduction";
import type { EconomicLineType, LineKind } from "../economic-line-type";
import type { RichTextDoc } from "../richtext";

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
  /** Rad på en godkänd ändring/tillägg (JobChange). sourceId = ändringsradens id. */
  | "CHANGE_LINE"
  | "MANUAL";

/** Företagets egna artikelregister – timpris, material, schabloner. */
export interface CatalogArticle {
  id: ID;
  description: string;
  kind: LineKind;
  unit: string;
  unitPrice: number;
  vatRate: VatRate;
  discountPercent?: number;
}

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
  /** Pris per enhet, exkl. moms – före radrabatt. */
  unitPrice: number;
  /**
   * Radrabatt i procent (0–100). Saknas = 0. À-priset räknas om i
   * `lineTotal` så offert, faktura och bokföring alltid stämmer.
   */
  discountPercent?: number;
  /**
   * Sektionsrubrik – syns på dokumentet men räknas inte i summan.
   * qty/pris/moms ignoreras.
   */
  isHeading?: boolean;
  vatRate: VatRate;
  sourceKind?: LineSourceKind;
  /** Offertrad-id, uppdragspost-id eller motsvarande. */
  sourceId?: ID;
  sourceQuoteNumber?: number;
  paymentPlanIndex?: number;
}

/**
 * En del i offertens betalplan (förskott, delbetalning, slutbetalning).
 *
 *   * percent – andel av offertsumman inkl. moms. Sista delen faktureras
 *     alltid som RESTEN (avrundning, tidigare fakturor, krediter) – aldrig
 *     som procent rakt av.
 *   * amount  – fast belopp i hela kronor inkl. moms (t.ex. "förskott 20 000
 *     kr"). När det finns styr det över percent. Nya fält är valfria så att
 *     äldre versioner behåller sitt contentHash (se lib/hash).
 *   * kind    – förskott / delbetalning / slutbetalning. Saknas = härleds av
 *     positionen (första = förskott när det finns fler än en, sista = slut).
 */
export type PaymentPlanPartKind = "forskott" | "delbetalning" | "slutbetalning";

export interface PaymentPlanPart {
  label: string;
  percent: number;
  amount?: number;
  kind?: PaymentPlanPartKind;
}

/* ---------------------------------- Offerter --------------------------------- */

export type QuoteStatus = "utkast" | "skickad" | "godkand" | "avbojd" | "utgangen";

export interface QuoteVersion {
  id: ID;
  quoteId: ID;
  version: number;
  title: string;
  /**
   * LEGACY: gamla "Beskrivning av arbetet" (ren text). Ersatt av richText –
   * olåsta versioner migreras vid läsning (lib/quote-description) och fältet
   * tas bort. Det finns bara kvar på BankID-låsta versioner, eftersom det
   * ingår i contentHash; där renderas det ihopslaget med richText via
   * quoteDescriptionDoc(). Skrivs aldrig för nya versioner.
   */
  intro?: string;
  lines: DocLine[];
  rot: RotRut | null;
  paymentPlan: PaymentPlanPart[];
  paymentTermsDays: number;
  /** Dröjsmålsränta i procent per år vid försenad betalning. */
  lateInterestRate?: number;
  validUntil: string;
  /** Företagets/användarens villkor. ROT/RUT-villkor ligger i taxReductionTerms. */
  terms: string;
  /**
   * Beskrivning – rik text (strikt vitlistad delmängd, se lib/richtext).
   * Saneras vid varje servergräns. Ligger på versionen → BankID-låsning fryser
   * den, och den ingår villkorligt i contentHash (endast när den finns).
   */
  richText?: RichTextDoc;
  /**
   * Snapshotade ROT/RUT-villkor (standard eller redigerade). Sätts vid första
   * ROT-val, behålls i utkast om ROT slås av (renderas då inte). Låsta
   * versioner muteras aldrig. Ingår i contentHash när fältet finns.
   */
  taxReductionTerms?: TaxReductionTermsSnapshot | null;
  /**
   * Företagsuppgifter när versionen skickades eller BankID-låstes.
   * Ingår inte i contentHash – ändra inte hash-payloaden.
   */
  sellerSnapshot?: InvoiceSellerSnapshot;
  /**
   * Kunduppgifter (namn/adress) när versionen skickades eller BankID-låstes –
   * dokumentet ska återge den adress kunden faktiskt fick, även om kunden
   * ändras senare. Ingår inte i contentHash – ändra inte hash-payloaden.
   */
  buyerSnapshot?: InvoiceBuyerSnapshot;
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
   * Bostad som ROT på den här offerten gäller. Måste vara explicit
   * sparad här – kundens fastigheter räcker inte vid utskick.
   * RUT kräver inget fastighetsval. Samma relation som Job.workLocationId,
   * så kedjan offert → uppdrag → faktura kan ärva fältet utan ny modell.
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

/* ----------------------------- Offertgodkännande ------------------------------ */

/**
 * Hur kunden godkände offerten.
 *   simple_accept – kunden skrev sitt namn och tryckte Godkänn offert på
 *                   offertlänken (enkel elektronisk underskrift).
 *   bankid_mock   – äldre demosignaturer från mock-BankID (inte på kundvägen längre).
 *   bankid        – reserverat för en riktig BankID-leverantör; ingen finns i koden.
 */
export type QuoteAcceptanceMethod = "simple_accept" | "bankid_mock" | "bankid";

/**
 * Kundens godkännande av EXAKT en offertversion. Bevisvärdet ligger i
 * kombinationen: låst version + contentHash (vad), acceptedByName + kund-
 * uppgifter (vem), acceptedAt (när), linkSentTo (länken gick till kundens
 * e-post), ip/userAgent (varifrån) och statement (den mening kunden godkände).
 * Lagras i tabellen signatures – en rad per offert.
 */
export interface QuoteAcceptance {
  id: ID;
  quoteId: ID;
  quoteVersionId: ID;
  method: QuoteAcceptanceMethod;
  /** ISO-tid. Visas i Europe/Stockholm (format.ts). */
  acceptedAt: string;
  /** Namnet kunden skrev, trimmat. */
  acceptedByName: string;
  /** Kundens namn i registret vid godkännandet (företag: bolagsnamnet). */
  customerNameAtAccept: string;
  acceptedByEmail?: string;
  /** SHA-256 av den låsta version kunden såg (samma som QuoteVersion.contentHash). */
  contentHash: string;
  /** Den fullständiga mening kunden godkände, ordagrant som den visades. */
  statement: string;
  ip?: string;
  userAgent?: string;
  /** Adressen offertlänken skickades till, om offerten mejlades. */
  linkSentTo?: string;
  /** Bara på äldre BankID-poster. */
  bankid?: {
    orderRef: string;
    personalNumberMasked: string;
    environment: BankIDEnvironment;
    note: string;
  };
}

/* ---------------------------------- BankID ----------------------------------- */

export type BankIDEnvironment = "mock" | "production";

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

/* ---------------------------------- Fakturor --------------------------------- */

/**
 * Fakturastatus. "delbetald" = utfärdad fordran där inbetalningar täcker en
 * del av att-betala. Förfallen härleds (isOverdue) och lagras aldrig.
 */
export type InvoiceStatus = "utkast" | "skickad" | "delbetald" | "betald" | "krediterad";

/**
 * Leveranskanal utanför e-post. Bara de två: mejlade fakturor känns igen på
 * sentAt/lastEmail och behöver ingen egen markering.
 */
export type InvoiceDeliveryChannel = "utskrift" | "manuell";
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
  /**
   * F-skatt var aktivt bekräftad av företaget när dokumentet utfärdades
   * (bekräftelsedagen). Saknas = påståendet "Godkänd för F-skatt" visas inte,
   * även på äldre dokument som frystes innan verifieringen fanns.
   */
  fSkattConfirmedAt?: string;
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
   * Köparens momsregistreringsnummer. Fryses bara när fakturan tillämpar
   * omvänd byggmoms, där lagen kräver köparens momsnummer på dokumentet.
   * Härlett ur köparens organisationsnummer vid utfärdandet.
   */
  vatNumber?: string;
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
  /**
   * Fakturan utfärdades med omvänd byggmoms. Fryst, för att dokumentet ska
   * bära laghänvisningen även om kundens markering ändras efteråt.
   */
  reverseCharge?: boolean;
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
   * Omvänd byggmoms på den här fakturan: raderna faktureras utan moms och
   * köparen redovisar den. Sätts från kundens markering när utkastet skapas
   * och fryses i issuedSnapshot vid utfärdandet.
   */
  reverseCharge?: boolean;
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
  /**
   * Vald leveranskanal när fakturan INTE mejlades: "utskrift" = användaren
   * laddade ner PDF:en för att lämna den på papper, "manuell" = användaren
   * skickade den själv på annat sätt. E-postleveransen bärs av sentAt och
   * lastEmail och sätter aldrig det här fältet.
   *
   * Fältet finns för att "utfärdad utan sentAt" har två helt olika
   * betydelser: ett mejl som inte gick fram (ett fel som ska lyftas) och en
   * pappersfaktura (ett medvetet val). Utan det ser åtgärdsmotorn varje
   * pappersfaktura som ett leveransfel.
   */
  deliveredBy?: InvoiceDeliveryChannel;
  /**
   * När kunden bevisligen fick fakturan via en annan kanal än e-post
   * ("Markera som skickad"). En nedladdad PDF räknas inte – då vet vi bara
   * att fakturan är utfärdad, inte att den nått kunden.
   */
  deliveredAt?: string;
  /** Senaste leveransförsöket (skicka igen). */
  lastSentAt?: string;
  lastEmail?: DocumentEmailDelivery;
  lastSendAttemptAt?: string;
  paidAt?: string;
  reminders: string[];
  token: string;
  /**
   * Bankgirot OCR-10 (mjuk): fakturanummer + kontrollsiffra.
   * Tom på utkast. Sätts en gång i `issueInvoice` och fryses i issuedSnapshot.
   */
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
