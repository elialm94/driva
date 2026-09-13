/**
 * Utgifter, kvitton, leverantörer, leverantörsfakturor och betalfiler.
 *
 * Del av domänmodellen. Importera via barrelen `@/lib/types`.
 */

import type { ID } from "./common";

/* ---------------------------------- Utgifter --------------------------------- */

export type ExpenseStatus = "saknar_kvitto" | "behover_svar" | "bokford";

/**
 * Vem som la ut pengarna. Företagskontot krediterar 1930; ett privat utlägg
 * blir en skuld till ägaren (2893) tills bolaget för över pengarna.
 * Saknas fältet är det företagskontot (alla köp från banken och kvitton).
 */
export type ExpensePaidBy = "foretagskonto" | "privat";

/**
 * Utgiftens slag när den registrerats för hand. Saknas = vanligt köp.
 * Milersättning och traktamente är skattefria schablonersättningar till
 * ägaren (ingen moms, ingen leverantör); representation har egna avdrags-
 * och momsregler.
 */
export type ExpenseKind = "kop" | "milersattning" | "traktamente" | "representation";

export type VehicleKind = "egen" | "formansbil" | "formansbil_el";

/**
 * Representationens slag styr både konto och avdrag: måltider är aldrig
 * avdragsgilla (momsen får lyftas till en schablon per person), enklare
 * förtäring är avdragsgill upp till 60 kr per person. Kund- och personal-
 * representation bokförs på olika konton (60xx respektive 76xx).
 */
export type RepresentationKind = "kundmaltid" | "kundfika" | "personalmaltid" | "personalfika";

/** Uppgifterna bakom en schablon- eller representationsutgift, som de såg ut när den bokfördes. */
export interface ExpenseDetails {
  mileage?: {
    km: number;
    vehicle: VehicleKind;
    /** Skatteverkets schablon det år resan gjordes, kr per mil. */
    ratePerMil: number;
    route?: string;
  };
  perDiem?: {
    fullDays: number;
    halfDays: number;
    nights: number;
    destination?: string;
    /** Avresa och hemkomst som lokal datumtid, "2026-03-10T07:30" (reseräkningen). */
    departure?: string;
    arrival?: string;
    /** Fri kost under resan: minskar dagbeloppet. */
    freeMeals?: "inga" | "frukost" | "lunch_eller_middag" | "lunch_och_middag" | "alla";
    /** Landskod (ISO 3166-1 alpha-2). Saknas = Sverige. */
    countryCode?: string;
    countryName?: string;
    /** Bolaget betalade login, så inget nattraktamente. */
    paidLodging?: boolean;
    reason?: string;
    /** Schablonen det år resan gjordes. */
    rates: { heldag: number; halvdag: number; natt: number };
  };
  representation?: {
    kind: RepresentationKind;
    persons: number;
    alcohol: boolean;
    participants?: string;
    purpose?: string;
  };
}

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
  paidBy?: ExpensePaidBy;
  kind?: ExpenseKind;
  details?: ExpenseDetails;
}

export interface Receipt {
  id: ID;
  expenseId?: ID;
  filename: string;
  source: "foto" | "uppladdning" | "email";
  uploadedAt: string;
  /**
   * Själva filen (bokföringsunderlaget). Saknas båda lagringsfälten finns bara
   * uppgifterna om kvittot – UI:t säger det ärligt. Se lib/receipts/receipt-file.ts.
   */
  contentType?: string;
  sizeBytes?: number;
  /** Sökväg i privata bucketen `receipts` (Supabase-läge med service-nyckel). */
  storagePath?: string;
  /** Inline base64 (JSON-läge/demo, eller utan fillagring). Aldrig båda satta. */
  contentBase64?: string;
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
  /** T.ex. ferva-betalningar-2026-08-30.xml. */
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

/* ------------------------------- Leverantörer ------------------------------- */

/**
 * Leverantörsregister (importerat eller manuellt). Fakturor från inboxen
 * refererar leverantören med namn; registret ger kontakt- och
 * betalningsuppgifter som förslag – aldrig automatiskt verifierade.
 */
export interface Supplier {
  id: ID;
  name: string;
  orgNumber?: string;
  email?: string;
  phone?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  bankgiro?: string;
  plusgiro?: string;
  bankAccount?: string;
  iban?: string;
  notes?: string;
  source: "import" | "manuell";
  createdAt: string;
  updatedAt: string;
}
