/**
 * Uppdrag: status, avslut, faktureringsallokering, ändringar, foton, arbete och material.
 *
 * Del av domänmodellen. Importera via barrelen `@/lib/types`.
 */

import type { ID, VatRate } from "./common";
import type { HousingDetails, TaxReductionApplication } from "./tax-reduction";
import type { DocLine, InvoiceBuyerSnapshot, InvoiceSellerSnapshot } from "./documents";
import type { WholesalerCustomerPriceRule } from "./wholesalers";

/* ---------------------------------- Uppdrag (Job) ------------------------------------- */

export type JobStatus = "kommande" | "pagar" | "klart";
/** Varifrån uppdraget kom. Källa för analys – inte en egen entitet. */
export type JobSource = "manual" | "web_form" | "email" | "import" | "phone" | "other";

export interface JobNotification {
  /** `off` = företagaren har stängt av notisen (Inställningar → Notiser); inget att skicka om. */
  status: "pending" | "sent" | "failed" | "off";
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
   * Arkiverat (mjuk borttagning). Döljs från Aktiva. Fakturor,
   * offerter och bokföring rörs inte.
   */
  archivedAt?: string;
  /** Foton från arbetsplatsen – bevis mot kunden, inte bokföringsunderlag. */
  photos?: JobPhoto[];
  /**
   * Avslutsflödet: beslut om vad som inte ska faktureras (nu eller alls) och
   * händelser som bara finns i flödet (avslutat, öppnat igen). Saknas =
   * inget beslut fattat. Ligger på uppdraget – små listor per uppdrag.
   */
  billingDeferrals?: BillingDeferral[];
  closeout?: JobCloseoutState;
  /** Kundvyn: vad kunden får se via sin länk. Saknas = ingen länk delad. */
  customerShare?: JobCustomerShare;
  /**
   * Stabil inköpsreferens unik inom företaget, t.ex. FV-1042.
   * Delar namnrymd med beställningsreferenser så att en tagg alltid pekar på
   * högst en sak. Tilldelas vid skapande och ändras aldrig.
   */
  purchaseRef?: string;
  /** Påslagsregel för material på det här uppdraget. Vinner över kundens regel. */
  materialPriceRule?: WholesalerCustomerPriceRule;
}

/* ------------------------------ Avsluta uppdrag ------------------------------ */

/**
 * Beslut i avslutsflödet om en källrad som INTE faktureras nu.
 *   inte_fakturerbart – räknas aldrig som kvar att fakturera (garanti, eget fel …).
 *   hantera_senare    – ligger kvar som ofakturerat men hindrar inte avslut.
 * Ett beslut per källa; nytt beslut ersätter det gamla. Sätts resolvedAt när
 * källan ändå faktureras eller beslutet tas bort.
 */
export type BillingDeferralKind = "inte_fakturerbart" | "hantera_senare";

export interface BillingDeferral {
  id: ID;
  sourceType: BillingSourceType;
  sourceId: ID;
  kind: BillingDeferralKind;
  note?: string;
  createdAt: string;
  createdBy?: "anvandare" | "assistent";
  resolvedAt?: string;
}

export type JobCloseoutEventKind =
  | "avslutat"
  | "oppnat_igen"
  | "beslut_inte_fakturerbart"
  | "beslut_hantera_senare"
  | "beslut_borttaget"
  | "fakturautkast_skapat"
  | "kundvy_delad"
  | "kundvy_stangd"
  | "slutunderlag_skapat"
  | "dagsrapport";

export interface JobCloseoutEvent {
  id: ID;
  at: string;
  kind: JobCloseoutEventKind;
  /** Kort, kundvänlig text utan systemjargong – visas i tidslinjen. */
  text: string;
  /** Kopplad faktura/ändring/källa när det finns en. */
  entity?: { type: "faktura" | "andring" | "kalla"; id: ID };
  createdBy?: "anvandare" | "assistent";
}

export interface JobCloseoutState {
  /** Sätts när uppdraget avslutas via flödet. Tas bort när det öppnas igen. */
  completedAt?: string;
  /** Vad användaren valde som faktureringssätt i det senaste avslutet. */
  billingMode?: CloseoutBillingMode;
  events: JobCloseoutEvent[];
}

/** Faktureringssätt i avslutsflödet. Härlett förslag, användaren kan byta. */
export type CloseoutBillingMode = "slutfaktura" | "delfaktura" | "lopande" | "ingen";

/** Vad kunden får se på sin uppdragslänk. Allt är av som standard. */
export interface JobCustomerShare {
  token: string;
  sharedAt: string;
  /** Länken pausad: sidan svarar "inte tillgänglig". Inställningarna finns kvar. */
  disabledAt?: string;
  quote: boolean;
  changes: boolean;
  /** Foto-id:n som delas explicit. Tom = inga foton. */
  photoIds: ID[];
  invoices: boolean;
  paymentStatus: boolean;
  closeoutSummary: boolean;
}

/* --------------------------- Faktureringsallokering --------------------------- */

/**
 * Källa som kan faktureras. Generell – samma modell används av avslutsflödet,
 * betalplanen och (senare) vidarefakturering av material/kvitton.
 *
 *   quote_line        – rad på godkänd offertversion (sourceId = DocLine.id).
 *   payment_plan_part – del i betalplanen (sourceId = `${quoteId}:plan:${index}`).
 *   quote_remainder   – resterande enligt offert som klumpsumma (sourceId = quoteId).
 *   work_entry        – registrerad tid/material/övrigt (sourceId = JobWorkEntry.id).
 *   change_line       – rad på godkänd ändring (sourceId = ändringsradens id).
 *   expense           – utgift/kvitto som vidarefaktureras (sourceId = Expense.id).
   *   receipt_line      – dokumentrad från kvitto/faktura (sourceId = DocumentLine.id).
   *                       Vidarefakturering skapar i regel en work_entry; den här
   *                       typen finns så att en rad kan spåras utan extra utgift.
 *   manual            – fri rad utan källa; allokeras aldrig.
 */
export type BillingSourceType =
  | "quote_line"
  | "payment_plan_part"
  | "quote_remainder"
  | "work_entry"
  | "change_line"
  | "expense"
  | "receipt_line"
  | "manual";

export interface BillingSourceRef {
  sourceType: BillingSourceType;
  sourceId: ID;
}

/**
 *   draft     – ligger på ett fakturautkast (reserverar källan).
 *   invoiced  – fakturan är utfärdad.
 *   released  – frisläppt (utkast kastat, rad borttagen eller faktura helt
 *               krediterad). Historik – räknas inte som fakturerad.
 */
export type BillingAllocationStatus = "draft" | "invoiced" | "released";

/**
 * Spårbar länk källrad → fakturarad. EN levande (draft/invoiced) allokering
 * per källa (unikt index i databasen, samma kontroll i tjänsten) – det är
 * detta som hindrar dubbelfakturering.
 */
export interface BillingAllocation {
  id: ID;
  jobId?: ID;
  sourceType: BillingSourceType;
  sourceId: ID;
  invoiceId: ID;
  invoiceLineId: ID;
  /** Antal av källan som allokerats (hela källan om det saknas). */
  qty?: number;
  /** Radens belopp exkl. moms, hela kronor, vid allokeringen. */
  amountExclVat: number;
  status: BillingAllocationStatus;
  createdAt: string;
  invoicedAt?: string;
  releasedAt?: string;
  releaseReason?: "utkast_kastat" | "rad_borttagen" | "faktura_krediterad";
}

/* ------------------------ Dokumentrader (materialkedjan) ------------------------ */

/**
 * Operativa artikelrader från ett ekonomiskt underlag. Kvittot/fakturan
 * bokförs en gång; de här raderna blir material på uppdrag när användaren
 * markerar Till kunden. De skapar ingen extra verifikation.
 */
export type DocumentLineSource = "receipt" | "supplier_invoice" | "order_confirmation" | "manual";
export type DocumentLineDisposition = "customer" | "company" | "private" | "ignored";
export type DocumentLineStatus = "proposed" | "needs_review" | "confirmed" | "rejected";
export type DocumentLineRole = "article" | "freight" | "deposit" | "rounding" | "return" | "fee";

export interface DocumentLineFieldConfidence {
  articleNumber?: number;
  name?: number;
  qty?: number;
  unit?: number;
  unitPrice?: number;
  lineAmount?: number;
  vat?: number;
}

/** Rå läsning eller användarens bekräftade värden. Inga påhittade fält. */
export interface DocumentLineValues {
  articleNumber?: string;
  name?: string;
  qty?: number;
  unit?: string;
  /** Styckpris som stod på dokumentet, hela kronor. */
  unitPrice?: number;
  lineAmount?: number;
  discount?: number;
  vatRate?: number;
  vatAmount?: number;
  page?: number;
  unreadable?: boolean;
  role?: DocumentLineRole;
}

export interface DocumentLineAllocation {
  id: ID;
  jobId: ID;
  qty: number;
  amountExclVat: number;
  jobWorkEntryId?: ID;
}

export type MaterialCustomerPriceSource =
  | "explicit"
  | "job"
  | "customer"
  | "connection"
  | "file"
  | "markup"
  | "missing";

export interface DocumentLine {
  id: ID;
  source: DocumentLineSource;
  /** Kvittot, leverantörsfakturan, bekräftelsen eller inboxposten raden kom ur. */
  sourceDocumentId: ID;
  sourceIndex: number;
  inboxItemId?: ID;
  receiptId?: ID;
  expenseId?: ID;
  supplierInvoiceId?: ID;
  purchaseOrderId?: ID;
  purchaseOrderConfirmationId?: ID;
  raw: DocumentLineValues;
  confirmed?: DocumentLineValues;
  articleNumber?: string;
  eNumber?: string;
  rskNumber?: string;
  gtin?: string;
  qty?: number;
  unit?: string;
  /** Inköpspris exkl. moms per enhet, hela kronor. */
  unitCost?: number;
  /** Kundpris exkl. moms per enhet. Saknas = får inte bli 0 kr på fakturan. */
  customerPrice?: number;
  customerPriceSource?: MaterialCustomerPriceSource;
  customerPriceRule?: WholesalerCustomerPriceRule;
  customerPriceExplanation?: string;
  disposition: DocumentLineDisposition;
  status: DocumentLineStatus;
  allocations: DocumentLineAllocation[];
  fieldConfidence?: DocumentLineFieldConfidence;
  /** Deterministisk kontroll: radsumma mot dokumentets total. */
  mathOk: boolean;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
}

/* ---------------------------- Ändringar och tillägg ---------------------------- */

/**
 *   utkast            – skapad, inte skickad.
 *   vantar_pa_kunden  – skickad/delad, kunden har inte svarat.
 *   godkand           – kunden godkände exakt den här versionen (approval).
 *   avbojd            – kunden avböjde.
 *   ersatt            – ersatt av en ny version (replacedByChangeId).
 * "Delvis fakturerad"/"Fakturerad" härleds ur allokeringarna – lagras aldrig.
 */
export type JobChangeStatus = "utkast" | "vantar_pa_kunden" | "godkand" | "avbojd" | "ersatt";

/** Kundens godkännande av EXAKT en ändringsversion – samma bevismodell som offerten. */
export interface JobChangeApproval {
  approvedAt: string;
  approvedByName: string;
  customerNameAtApproval: string;
  /** SHA-256 av det låsta innehållet (samma som JobChange.contentHash). */
  contentHash: string;
  statement: string;
  ip?: string;
  userAgent?: string;
}

export interface JobChange {
  id: ID;
  jobId: ID;
  customerId: ID;
  /** Löpnummer per uppdrag (Ändring 1, 2 …). Versioner delar nummer. */
  number: number;
  version: number;
  status: JobChangeStatus;
  title: string;
  /** Vad som ändras och varför – ren text som kunden ser. */
  description: string;
  /** Påverkan på tid, om någon ("cirka två extra dagar"). */
  timeImpact?: string;
  lines: DocLine[];
  /** Publik token för kundlänken. */
  token: string;
  createdAt: string;
  sentAt?: string;
  viewedAt?: string;
  decidedAt?: string;
  declineReason?: string;
  /** Låsning vid utskick: innehållet får inte ändras efter att kunden sett det. */
  lockedAt?: string;
  contentHash?: string;
  sellerSnapshot?: InvoiceSellerSnapshot;
  buyerSnapshot?: InvoiceBuyerSnapshot;
  approval?: JobChangeApproval;
  replacesChangeId?: ID;
  replacedByChangeId?: ID;
  createdBy?: "anvandare" | "assistent";
}

export interface JobPhoto {
  id: ID;
  createdAt: string;
  /** JPEG/PNG data-URL. */
  dataUrl: string;
  caption?: string;
}

/**
 * Registrerat arbete/material på ett uppdrag – inte offertrader och inte
 * fakturarader. Offertrad = avtalat. Work entry (actual) = utfört.
 * Fakturarad = det som faktureras (eget liv, skapas från offert eller actuals).
 */
export type JobWorkEntryType = "labor" | "material" | "travel" | "other";
export type JobWorkEntryRole = "planned" | "actual";
/** wholesaler = bekräftad rad från en grossistbeställning (services/wholesalers/confirmations). */
export type JobWorkEntrySource = "manual" | "quote" | "ai" | "import" | "wholesaler";

/**
 * Proveniens för material som kommer från en bekräftad grossistbeställning.
 * Inköpskostnaden (ören) hålls skild från kundpriset (unitPrice, hela kronor).
 */
export interface JobWorkEntryWholesalerProvenance {
  connectionId: ID;
  purchaseOrderId: ID;
  purchaseOrderLineId: ID;
  confirmationId?: ID;
  articleNumber?: string;
  /** Faktisk inköpskostnad per enhet i ören (bekräftelse eller leverantörsfaktura). */
  unitCostOre?: number;
  /** Förväntad inköpskostnad från skickad order/prislista. Ändras inte när faktiskt pris kommer. */
  expectedUnitCostOre?: number;
}

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
  /**
   * Registrerad på en ändring (JobChange). Priset mot kunden är ändringens
   * godkända rader; posten faktureras därför aldrig separat utan följer
   * ändringen när den faktureras.
   */
  changeId?: ID;
  /** Kopplad faktura (utkast eller utfärdad). Saknas = ej fakturerad. */
  invoiceId?: ID;
  /** Endast source = wholesaler: vilken orderrad/bekräftelse raden kommer från. */
  wholesaler?: JobWorkEntryWholesalerProvenance;
  /** Utgift som skapade materialraden (kvitto → material). */
  expenseId?: ID;
  /** Dokumentrad som skapade materialraden – idempotens mot dubletter. */
  documentLineId?: ID;
  /** Allokering på dokumentraden när antalet delats mellan uppdrag. */
  documentLineAllocationId?: ID;
  createdAt: string;
  updatedAt: string;
}

/** Hur uppdraget faktureras – härlett, inte en användarväljare. */
export type JobPricingKind = "fast_pris" | "lopande" | "hybrid";
