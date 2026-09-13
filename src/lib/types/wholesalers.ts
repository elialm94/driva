/**
 * Grossister: anslutning, rabattavtal, prisfiler, artiklar och beställningar.
 *
 * Del av domänmodellen. Importera via barrelen `@/lib/types`.
 */

import type { ID } from "./common";
import type { DocumentEmailDelivery } from "./documents";

/* ------------------------ Grossister & materialbeställningar ------------------------ */

/**
 * Grossistbeställningar (valfri funktion `wholesalers`). Belopp i den här
 * sektionen lagras som HELTALSÖREN (`*Ore`) – inköpspriser från grossist-
 * filer har ören. Kundpriset som når uppdraget/fakturan följer appens
 * befintliga modell (hela kronor per enhet) och avrundas vid härledningen,
 * så `customerUnitPriceOre` är alltid en multipel av 100.
 */
export type WholesalerKey = "ahlsell" | "dahl" | "sonepar" | "solar" | "lundagrossisten" | "rexel" | "other";

export type WholesalerDeliveryMode = "pickup" | "delivery";

/** Standardregel för kundpris på artiklar från anslutningen. */
export type WholesalerCustomerPriceRule =
  | { kind: "file_sales_price" }
  | { kind: "markup"; percent: number }
  | { kind: "later" };

/** Fält Ferva kan läsa ur en prisfil. */
export type WholesalerColumnKey =
  | "articleNumber"
  | "name"
  | "eNumber"
  | "rskNumber"
  | "gtin"
  | "category"
  | "brand"
  | "imageUrl"
  | "discountGroup"
  | "unit"
  | "packSize"
  | "listPrice"
  | "discountPercent"
  | "netPrice"
  | "salesPrice";

/** Fält → kolumnrubrik i filen (eller "#3" för kolumnindex utan rubrik). */
export type WholesalerColumnMapping = Partial<Record<WholesalerColumnKey, string>>;

export interface WholesalerConnection {
  id: ID;
  wholesaler: WholesalerKey;
  /** Eget visningsnamn, t.ex. "Ahlsell Västberga". Tomt = grossistens namn. */
  displayName?: string;
  customerNumber: string;
  /** Ordermejl eller personlig säljare – anges alltid av användaren. */
  orderEmail: string;
  /** Kopia till användarens egen e-post vid utskick. */
  ccSelf: boolean;
  defaultDeliveryMode: WholesalerDeliveryMode;
  defaultStore?: string;
  defaultDeliveryAddress?: string;
  contactPerson?: string;
  phone?: string;
  customerPriceRule: WholesalerCustomerPriceRule;
  /** Inaktiv = döljs i materialsök men anslutning, prisfiler och order finns kvar. */
  active: boolean;
  /** Aktiv prisimport (katalogen som söks). Saknas = ingen prislista ännu. */
  activeImportId?: ID;
  /** Senast använda kolumnmappning – föreslås för nästa fil från samma anslutning. */
  columnMapping?: WholesalerColumnMapping;
  /**
   * Rabattbrev: rabattgrupp → rabatt i procent. Fylls från en fil som bara
   * innehåller rabatter och används när prislistan har rabattgrupp men inget
   * nettopris. Nyckeln är normaliserad (trimmad, versaler).
   */
  discountGroups?: Record<string, number>;
  /**
   * Rabattavtal i grossistens eget format (t.ex. Ahlsell avtalsfil). Huvudet
   * bor här; villkoren (rabatt per materialklass, artikelvillkor) bor i
   * katalogstoren nycklade på `discountAgreement.id`. Slås ihop med
   * prislistan först när ett pris visas – aldrig vid importen.
   */
  discountAgreement?: WholesalerDiscountAgreement;
  /**
   * Favoritartiklar i materialbutiken, nycklade på grossistens artikelnummer
   * (artikel-id byts vid varje prisimport – artikelnumret består).
   */
  favoriteArticleNumbers?: string[];
  createdAt: string;
  updatedAt: string;
}

/** Känt grossistformat (parser-id i lib/wholesalers/formats/registry.ts). */
export type WholesalerFileFormatId = "ahlsell-avtalsfil" | "ahlsell-prisfil";

/**
 * Rabattavtal/rabattbrev från grossisten – huvudet. Rabatter lagras som
 * heltal i tiondels procent, priser i ören (ADR-1-tillägget i README).
 */
export interface WholesalerDiscountAgreement {
  /** Villkoren i katalogstoren pekar hit; byts vid varje ny avtalsfil. */
  id: ID;
  format: WholesalerFileFormatId;
  filename: string;
  /** Importposten (historik) som skapade avtalet. */
  importId?: ID;
  /** 1 = kundavtal/standardavtal, 3 = anläggningsavtal. */
  agreementType: "1" | "3";
  customerNumber: string;
  /** "000" för kundavtal. */
  facilityNumber: string;
  /** Avtalsbeteckning, t.ex. "R87 VS WC-MALL NIVÅ 2". */
  name: string;
  /** KEDJERABATTKOD – parsas och lagras; ingen beräkning byggs på J. */
  chainDiscountCode: "J" | "N";
  /** Körningsdatum (YYYY-MM-DD). */
  runDate?: string;
  /** Giltigt till och med (YYYY-MM-DD). */
  endDate?: string;
  classDiscountCount: number;
  articleTermCount: number;
  specDiscountCount: number;
  netPriceCount: number;
  /** Rader med KEDJERABATTKOD = J – flaggas i UI:t. */
  chainDiscountRows: number;
  importedAt: string;
  /**
   * Hur många artiklar i den aktiva prislistan som saknar matchande rabatt.
   * Räknas om vid varje import av endera filen – det är siffran som avslöjar
   * om fel avtalsfil laddats upp.
   */
  coverage?: WholesalerAgreementCoverage;
}

export interface WholesalerAgreementCoverage {
  importId: ID;
  articleCount: number;
  withoutTermsCount: number;
  computedAt: string;
}

/**
 * Villkor ur ett rabattavtal. Bor i katalogstoren (tusentals rader per
 * avtal) – se lib/wholesalers/catalog-store.ts. Exakt ett av
 * materialClass/articleNumber är satt.
 */
export interface WholesalerAgreementTerm {
  id: ID;
  connectionId: ID;
  agreementId: ID;
  kind: "class" | "article";
  /** Materialklass (högertrimmad) – kind = class. Kan vara huvudgrupp (5 tecken) eller undergrupp (6). */
  materialClass?: string;
  materialClassText?: string;
  /** Grossistens artikelnummer – kind = article. */
  articleNumber?: string;
  /** Rabatt i tiondels procent: klassrabatt (class) eller specrabatt (article). */
  discountTenths?: number;
  /** Nettopris i ören – kind = article. */
  netPriceOre?: number;
  /** Kedjerabatt i tiondels procent – bara lagrad, aldrig räknad. */
  chainDiscountTenths?: number;
  /** Giltigt till och med (YYYY-MM-DD). */
  endDate?: string;
}

export type WholesalerPriceFileKind = "csv" | "txt" | "xlsx" | "xml" | "zip";

/**
 * Importens livscykel. processing → active (blir katalogen) | failed.
 * Byts katalogen ut blir den gamla superseded – aldrig raderad ur historiken.
 */
export type WholesalerPriceImportStatus = "processing" | "active" | "superseded" | "failed";

export interface WholesalerPriceImportError {
  row: number;
  message: string;
}

export interface WholesalerPriceImport {
  id: ID;
  connectionId: ID;
  filename: string;
  fileKind: WholesalerPriceFileKind;
  /** Känt grossistformat som filen tolkades med. Saknas = generisk kolumnmappning. */
  format?: WholesalerFileFormatId;
  status: WholesalerPriceImportStatus;
  mapping: WholesalerColumnMapping;
  /** Datarader i filen (exkl. rubrik). */
  rowCount: number;
  /** Artiklar som importerades. */
  productCount: number;
  skippedCount: number;
  /** De första felen med radnummer – begripliga för användaren. */
  errors: WholesalerPriceImportError[];
  /** Filen innehöll artikelregister (artikelnummer + benämning). */
  hasArticleRegister: boolean;
  /** Filen innehöll rabatter/rabattgrupper. */
  hasDiscounts: boolean;
  discountGroupCount: number;
  /** Prislistans datum (YYYY-MM-DD) – "Dina priser uppdaterades …". */
  priceDate: string;
  failedReason?: string;
  createdAt: string;
  completedAt?: string;
}

/**
 * Artikel i grossistkatalogen. Bor UTANFÖR DB-aggregatet (tusentals rader per
 * import) i en egen lagring med serversök och index – se
 * lib/wholesalers/catalog-store.ts. Nås alltid via tenantens business_id.
 */
export interface WholesalerProduct {
  id: ID;
  connectionId: ID;
  importId: ID;
  articleNumber: string;
  name: string;
  eNumber?: string;
  rskNumber?: string;
  gtin?: string;
  category?: string;
  /** Fabrikat/varumärke om filen anger det – visas på artikelkortet. */
  brand?: string;
  /** Länk (https) till grossistens produktbild – bara om filen innehåller en. */
  imageUrl?: string;
  /** Rabattgrupp/materialklass – nyckeln mot rabattbrev och rabattavtal. */
  discountGroup?: string;
  unit: string;
  packSize?: number;
  /** Lagerförd hos grossisten, om prisfilen anger det. */
  stocked?: boolean;
  listPriceOre?: number;
  discountPercent?: number;
  /**
   * Kundens inköpspris exkl. moms i ören. Lagrat när filen ger det
   * uttryckligt (`file`) eller via det äldre rabattbrevet (`discount_group`).
   * `agreement_*` sätts vid LÄSNING ur rabattavtalet (agreement-pricing.ts)
   * och lagras aldrig.
   */
  netPriceOre?: number;
  netPriceSource?: WholesalerNetPriceSource;
  /** Rekommenderat/avtalat utpris exkl. moms i ören, om filen anger det. */
  salesPriceOre?: number;
  /** Förklaring av inköpspriset (regel, listpris, materialklass, avtal, datum). Beräknas vid läsning. */
  priceExplanation?: WholesalerPriceExplanation;
}

export type WholesalerNetPriceSource =
  | "file"
  | "discount_group"
  | "agreement_net_price"
  | "agreement_spec_discount"
  | "agreement_class_discount";

/** Varje framräknat pris ska kunna förklaras: vilket listpris, vilken regel, vilken klass, vilket avtal, vilket datum. */
export interface WholesalerPriceExplanation {
  rule: WholesalerNetPriceSource | "list_price" | "none";
  listPriceOre?: number;
  /** Rabatt i tiondels procent som användes. */
  discountTenths?: number;
  /** Artikelns materialklass i prislistan. */
  materialClass?: string;
  /** Klassen i avtalet som matchade (samma som materialClass vid exakt träff, kortare vid prefix). */
  matchedClass?: string;
  matchedClassText?: string;
  agreementName?: string;
  agreementEndDate?: string;
  /** Begriplig svensk text för UI:t. */
  text: string;
}

/**
 * Orderns kanal. V1 skickar bara e-post; edi/api/punchout är reserverade så
 * att modellen inte behöver ändras när en direktkanal kommer.
 */
export type PurchaseOrderChannel = "email" | "edi" | "api" | "punchout";

/**
 * Orderstatus. UI visar svenska etiketter (status-labels.ts) – aldrig dessa.
 *   draft → sent (mejlet gick iväg – INTE bekräftad) → confirmed |
 *   partially_confirmed | needs_review (avvikelse) | rejected. cancelled när som helst före sent.
 */
export type PurchaseOrderStatus =
  | "draft"
  | "sent"
  | "confirmed"
  | "partially_confirmed"
  | "needs_review"
  | "rejected"
  | "cancelled";

export interface PurchaseOrderDelivery {
  mode: WholesalerDeliveryMode;
  store?: string;
  address?: string;
  /** Önskat datum (YYYY-MM-DD). */
  requestedDate?: string;
}

/**
 * Var kundpriset på raden kommer från. Precedens: explicit → file → markup →
 * missing ("Kundpris saknas" – raden blir aldrig fakturerbar till 0 kr).
 */
export type PurchaseOrderCustomerPriceSource = "explicit" | "file" | "markup" | "missing";

export interface PurchaseOrderLine {
  id: ID;
  orderId: ID;
  position: number;
  productId?: ID;
  articleNumber?: string;
  name: string;
  eNumber?: string;
  rskNumber?: string;
  unit: string;
  packSize?: number;
  qty: number;
  /** Förväntad inköpskostnad per enhet i ören (från prislistan). */
  unitCostOre?: number;
  /** Kundpris per enhet i ören (multipel av 100 – hela kronor). */
  customerUnitPriceOre?: number;
  customerPriceSource: PurchaseOrderCustomerPriceSource;
  note?: string;
  /** Egen fritextrad (finns inte i katalogen). */
  isFreeText: boolean;
  /** Materialrad på uppdraget som skapats från bekräftad rad – idempotensnyckel. */
  jobWorkEntryId?: ID;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderSnapshotLine {
  lineId: ID;
  articleNumber?: string;
  name: string;
  eNumber?: string;
  rskNumber?: string;
  qty: number;
  unit: string;
  packSize?: number;
  unitCostOre?: number;
  note?: string;
}

/**
 * Det grossisten faktiskt fick – fryses vid utskicket och ändras aldrig.
 * Senare ändringar är en ny beställning, inte en mutation av historiken.
 */
export interface PurchaseOrderSentSnapshot {
  sentAt: string;
  channel: PurchaseOrderChannel;
  /**
   * live = mejlet lämnade Ferva via e-postleverantören. simulated = demo/
   * utvecklingsmiljö utan riktig leverans – UI:t säger det tydligt.
   */
  transport: "live" | "simulated";
  to: string;
  cc?: string;
  replyTo: string;
  subject: string;
  companyName: string;
  orgNumber: string;
  wholesalerName: string;
  customerNumber: string;
  orderer: { name: string; email: string; phone: string };
  jobTitle: string;
  delivery: PurchaseOrderDelivery;
  message?: string;
  lines: PurchaseOrderSnapshotLine[];
  /** Summa förväntad inköpskostnad i ören (om alla rader har inköpspris). */
  expectedCostOre?: number;
  /** Textversionen av mejlet – bevis på innehållet. */
  textBody: string;
}

export interface PurchaseOrder {
  id: ID;
  /** Fervas stabila beställningsreferens, t.ex. FV-1001. Unik per företag. */
  reference: string;
  jobId: ID;
  connectionId: ID;
  status: PurchaseOrderStatus;
  channel: PurchaseOrderChannel;
  delivery: PurchaseOrderDelivery;
  ordererName: string;
  ordererEmail: string;
  ordererPhone: string;
  /** Övergripande meddelande till grossisten. */
  message?: string;
  ccSelf: boolean;
  /** Grossistens ordernummer när det blivit känt (bekräftelse eller manuellt). */
  wholesalerOrderNumber?: string;
  sentAt?: string;
  sentSnapshot?: PurchaseOrderSentSnapshot;
  lastEmail?: DocumentEmailDelivery;
  lastSendAttemptAt?: string;
  /** Nyckeln för det utskick som lyckades – samma nyckel igen = redan skickat. */
  sendKey?: string;
  /** Skapare (auth.users.id) – null i JSON-läget. */
  createdByUserId?: string | null;
  cancelledAt?: string;
  /** Användaren har godkänt avvikelserna i bekräftelserna. */
  deviationsAcceptedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type PurchaseOrderConfirmationSource = "email" | "manual" | "demo";
export type PurchaseOrderConfirmationStatus = "applied" | "needs_review" | "approved" | "dismissed";
/** Hur bekräftelsen kopplades till beställningen. */
export type PurchaseOrderMatchMethod = "reference" | "order_number" | "customer_job" | "manual";
export type PurchaseOrderDeviationKind =
  | "qty"
  | "price"
  | "backorder"
  | "substitute"
  | "missing"
  | "added"
  | "delivery_date"
  | "total";
/** Var raden lästes: strukturerad data (tabell/CSV/XML), text, eller AI-kandidat. */
export type PurchaseOrderExtractionSource = "structured" | "text" | "ai";

export interface PurchaseOrderConfirmationLine {
  id: ID;
  /** Matchad orderrad. Saknas = tillagd/okänd artikel. */
  orderLineId?: ID;
  articleNumber?: string;
  name?: string;
  confirmedQty?: number;
  unit?: string;
  /** Verkligt inköpspris per enhet i ören. */
  unitCostOre?: number;
  backordered: boolean;
  backorderDate?: string;
  substituteArticleNumber?: string;
  substituteName?: string;
  /** 0–1. Under AUTO-tröskeln kräver raden mänsklig kontroll. */
  confidence: number;
  source: PurchaseOrderExtractionSource;
  deviations: PurchaseOrderDeviationKind[];
}

export interface PurchaseOrderConfirmation {
  id: ID;
  orderId: ID;
  inboxItemId?: ID;
  source: PurchaseOrderConfirmationSource;
  matchMethod: PurchaseOrderMatchMethod;
  status: PurchaseOrderConfirmationStatus;
  receivedAt: string;
  wholesalerOrderNumber?: string;
  deliveryDate?: string;
  totalOre?: number;
  message?: string;
  lines: PurchaseOrderConfirmationLine[];
  deviations: PurchaseOrderDeviationKind[];
  reviewedAt?: string;
  createdAt: string;
}
