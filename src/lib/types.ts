/**
 * Domänmodell för Driva – AI-native business-in-a-box för svenska småföretag.
 * Alla belopp är i SEK (hela kronor om inget annat anges), datum är ISO-strängar.
 */

export type ID = string;

/* ---------------------------------- Företag ---------------------------------- */

export interface CompanySettings {
  name: string;
  orgNumber: string;
  vatNumber: string;
  email: string;
  phone: string;
  address: string;
  postalCode: string;
  city: string;
  bankgiro: string;
  logoInitials: string;
  /** Preliminärskatt (F-skatt) som dras varje månad. */
  fSkattPerMonth: number;
  /** Reserv för arbetsgivaravgifter och personalskatt per månad. */
  payrollReservePerMonth: number;
  /** Standard betalningsvillkor i dagar. */
  paymentTermsDays: number;
  /** Standard dröjsmålsränta i procent per år (räntelagen: referensränta + 8 %-enheter). */
  lateInterestRate: number;
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
  /** AI-tolkning av förfrågan. */
  ai?: {
    workType?: string;
    desiredStart?: string;
    budget?: string;
    address?: string;
  };
}

/* ---------------------------------- Dokumentrader ---------------------------- */

export type LineKind = "arbete" | "material" | "ovrigt";
export type VatRate = 0 | 6 | 12 | 25;

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
  terms: string;
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

/* ---------------------------------- Jobb ------------------------------------- */

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
}

/* ---------------------------------- Fakturor --------------------------------- */

export type InvoiceStatus = "utkast" | "skickad" | "betald" | "krediterad";
export type InvoiceType = "faktura" | "delbetalning" | "slutfaktura" | "kredit";

export interface Invoice {
  id: ID;
  number: number;
  customerId: ID;
  jobId?: ID;
  quoteId?: ID;
  type: InvoiceType;
  status: InvoiceStatus;
  lines: DocLine[];
  rot: RotRut | null;
  issueDate: string;
  dueDate: string;
  /** Dröjsmålsränta i procent per år vid försenad betalning. */
  lateInterestRate?: number;
  sentAt?: string;
  paidAt?: string;
  reminders: string[];
  token: string;
  ocr: string;
  creditsInvoiceId?: ID;
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
}

export type VerificationSource =
  | { type: "kundfaktura"; id: ID }
  | { type: "betalning"; id: ID }
  | { type: "utgift"; id: ID }
  | { type: "leverantorsfaktura"; id: ID }
  | { type: "banktransaktion"; id: ID }
  | { type: "rattelse"; id: ID }
  | { type: "manuell" };

export interface Verification {
  id: ID;
  series: "A";
  number: number;
  date: string;
  description: string;
  entries: VerificationEntry[];
  source: VerificationSource;
  confidence: "hog" | "medel" | "lag";
  createdBy: "auto" | "anvandare" | "assistent";
  createdAt: string;
}

/* ---------------------------------- Aktivitet -------------------------------- */

export interface ActivityEvent {
  id: ID;
  at: string;
  text: string;
  customerId?: ID;
  entity?: {
    type: "offert" | "faktura" | "jobb" | "forfragan" | "utgift" | "verifikation" | "hemsida";
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
  /** Tjänster-kort. Arrayordning = visningsordning. */
  items?: WebsiteSectionItem[];
}

export interface Website {
  id: ID;
  slug: string;
  businessName: string;
  tagline: string;
  city?: string;
  status: "utkast" | "publicerad";
  theme: WebsiteTheme;
  sections: WebsiteSection[];
  publishedAt?: string;
  createdAt: string;
  submissions: number;
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
    };

export interface AssistantMessage {
  id: ID;
  role: "user" | "assistant";
  at: string;
  text: string;
  card?: AssistantCard;
}

export type PendingAssistantAction =
  | { id: ID; type: "paminn_forsenade"; invoiceIds: ID[] }
  | { id: ID; type: "folj_upp_offerter"; quoteIds: ID[] }
  | { id: ID; type: "bokfor_utgift"; expenseId: ID; category: string; jobId?: ID }
  | { id: ID; type: "generera_hemsida"; description: string };

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
  activity: ActivityEvent[];
  website: Website | null;
  assistantMessages: AssistantMessage[];
  pendingActions: PendingAssistantAction[];
  meta: { seededAt: string };
}
