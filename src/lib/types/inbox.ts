/**
 * Underlag som kommit in: bilagor, tolkning och uppdragsmatchning.
 *
 * Del av domänmodellen. Importera via barrelen `@/lib/types`.
 */

import type { ID } from "./common";

/* ---------------------------------- Inbox --------------------------------- */

export type InboxItemKind = "mail" | "uppladdning";
export type InboxItemStatus = "ny" | "behandlad" | "bokford";
/**
 * orderbekraftelse = grossistens svar på en materialbeställning. Går aldrig
 * genom faktura-/kvittopipelinen – kopplas till en purchase_order i stället.
 */
export type InboxDocumentType = "leverantorsfaktura" | "kvitto" | "ekonomiskt_dokument" | "orderbekraftelse";
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
   * Sökväg i den privata bucketen `inbox_attachments`
   * (<business_id>/<dokumentnyckel>/<filnamn>). Sätts i Supabase-läge med
   * service-nyckel – det är den vägen ett flersidigt inskannat underlag tar.
   */
  storagePath?: string;
  /**
   * Små dokument (≤ ~1,5 MB, pdf/bild) lagras inline när fillagring saknas
   * (JSON-läge/demo), så att båda lagringslägena kan servera innehållet.
   * Demobilagor (storageKey "demo/…") genereras i stället deterministiskt och
   * lagrar aldrig bytes. Aldrig både storagePath och contentBase64.
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
 * flyttats till parsed* (t.ex. ett belopp Ferva inte vågar lita på).
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
  /** Orderbekräftelse: säkert kopplad grossistbeställning. */
  purchaseOrderId?: ID;
  /** Orderbekräftelse: bekräftelseposten som skapades ur mejlet. */
  purchaseOrderConfirmationId?: ID;
  /**
   * Orderbekräftelse med OSÄKER matchning: möjliga beställningar som
   * användaren väljer bland. Kopplas aldrig automatiskt.
   */
  purchaseOrderCandidateIds?: ID[];
  /**
   * Föreslaget uppdrag efter tenant är identifierad. Aldrig satt från
   * From/ämne/dokumenttext utan att tenanten redan är känd.
   */
  suggestedJobId?: ID;
  /** Hur förslaget togs fram – audit, aldrig tenantnyckel. */
  jobMatchMethod?: InboxJobMatchMethod;
  createdAt: string;
  processedAt?: string;
}

/** Hur ett uppdrag föreslogs på ett underlag. Tenant löses aldrig härifrån. */
export type InboxJobMatchMethod =
  | "plus_tag"
  | "subject_ref"
  | "document_ref"
  | "recent"
  | "supplier"
  | "order"
  | "started_from_job"
  | "manual";
