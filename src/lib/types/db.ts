/**
 * Rotobjektet för lagringen: allt ett företag äger.
 *
 * Del av domänmodellen. Importera via barrelen `@/lib/types`.
 */

import type { CompanySettings } from "./company";
import type { Customer } from "./customers";
import type { BankIDOrder, CatalogArticle, Invoice, Payment, Quote, QuoteAcceptance, QuoteVersion } from "./documents";
import type { BillingAllocation, DocumentLine, Job, JobChange, JobWorkEntry } from "./jobs";
import type { BankAccount, BankConnection, BankCounterpartRule, BankTransaction, MerchantCategoryRule } from "./banking";
import type { Expense, PaymentFile, Receipt, Supplier, SupplierInvoice, SupplierPayment } from "./expenses";
import type { Accrual, Asset, ChartAccountRecord, Employee, EmployerDeclaration, FiscalYear, PayrollRun, VatReport, Verification, YearEndSchedule } from "./accounting";
import type { ActivityEvent, AuditEvent } from "./audit";
import type { AnnualReport } from "./annual-report";
import type { FilingSubmission } from "./filing";
import type { Website } from "./website";
import type { Domain, DomainAuditEvent } from "./domains";
import type { AssistantAuditEntry, AssistantMessage, AttentionState, PendingAssistantAction, Reminder } from "./assistant";
import type { ClientInformationRequest, CollaborationInvitation } from "./collaboration";
import type { InboxItem } from "./inbox";
import type { PurchaseOrder, PurchaseOrderConfirmation, PurchaseOrderLine, WholesalerConnection, WholesalerPriceImport } from "./wholesalers";
import type { DataImport, OnboardingState } from "./onboarding";
import type { LineKind } from "../economic-line-type";

/* ---------------------------------- Databas ---------------------------------- */

export interface DB {
  settings: CompanySettings;
  sequences: {
    quote: number;
    invoice: number;
    /** Nästa nummer i verifikationsserie A. Speglas i verificationSeries. */
    verification: number;
    /**
     * Nästa nummer per verifikationsserie. Varje serie har en egen obruten
     * nummerföljd, vilket är hela poängen med serier – A och M får inte dela
     * räknare och lämna hål i varandras nummerföljd.
     */
    verificationSeries?: Record<string, number>;
  };
  customers: Customer[];
  quotes: Quote[];
  quoteVersions: QuoteVersion[];
  /** Offertgodkännanden (en per offert). Tabellnamnet signatures är historiskt. */
  signatures: QuoteAcceptance[];
  bankidOrders: BankIDOrder[];
  jobs: Job[];
  /** Registrerat/avtalat arbete på uppdrag – skilt från offert- och fakturarader. */
  jobWorkEntries: JobWorkEntry[];
  invoices: Invoice[];
  payments: Payment[];
  bankAccounts: BankAccount[];
  bankTransactions: BankTransaction[];
  /** Bankkoppling (Tink/mock), max en aktiv per företag. Äldre JSON-filer saknar fältet – guardera med ?? []. */
  bankConnections?: BankConnection[];
  expenses: Expense[];
  receipts: Receipt[];
  supplierInvoices: SupplierInvoice[];
  supplierPayments: SupplierPayment[];
  /** Genererade bankfiler (pain.001). Äldre JSON-filer saknar fältet – guardera med ?? []. */
  paymentFiles: PaymentFile[];
  verifications: Verification[];
  /**
   * Företagets avvikelser från den levererade BAS-kontoplanen (egna konton,
   * omdöpta och arkiverade). Standardplanen ligger i koden. Äldre JSON-filer
   * saknar fältet – guardera med ?? [].
   */
  chartAccounts?: ChartAccountRecord[];
  /** Räkenskapsår. Skapas automatiskt (kalenderår) av bokföringsmotorn. */
  fiscalYears: FiscalYear[];
  /** Bokföringsinställningar. lockedThrough: bokföringen är låst t.o.m. detta datum (YYYY-MM-DD). */
  accounting: { lockedThrough?: string };
  vatReports: VatReport[];
  /** Anställda. Äldre JSON-filer saknar fältet – guardera med ?? []. */
  employees?: Employee[];
  /** Bokförda lönekörningar. Äldre JSON-filer saknar fältet – guardera med ?? []. */
  payrollRuns?: PayrollRun[];
  /** Arbetsgivardeklarationer. Äldre JSON-filer saknar fältet – guardera med ?? []. */
  employerDeclarations?: EmployerDeclaration[];
  assets: Asset[];
  accruals: Accrual[];
  /** Bokslutsbilagor. Äldre JSON-filer saknar fältet – guardera med ?? []. */
  yearEndSchedules?: YearEndSchedule[];
  auditTrail: AuditEvent[];
  annualReports: AnnualReport[];
  /** Inlämningar av deklarationer till myndighet. Äldre JSON-filer saknar fältet – guardera med ?? []. */
  filingSubmissions?: FilingSubmission[];
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
  /** Grossistanslutningar (valfri funktion). Äldre JSON-filer saknar fältet – guardera med ?? []. */
  wholesalerConnections?: WholesalerConnection[];
  /** Prisimporter (metadata + fel). Själva artiklarna bor i katalogstoren. Guardera med ?? []. */
  wholesalerPriceImports?: WholesalerPriceImport[];
  /** Materialbeställningar (varukorgar + skickade order). Guardera med ?? []. */
  purchaseOrders?: PurchaseOrder[];
  purchaseOrderLines?: PurchaseOrderLine[];
  purchaseOrderConfirmations?: PurchaseOrderConfirmation[];
  /**
   * Onboardingens tillstånd + Kom igång-profilen. Saknas (äldre företag,
   * JSON-demo) = onboarding klar – befintliga företag tvingas aldrig om.
   */
  onboarding?: OnboardingState | null;
  /** Genomförda dataimporter (audit + dubblettskydd). Guardera med ?? []. */
  dataImports?: DataImport[];
  /** Leverantörsregister. Guardera med ?? []. */
  suppliers?: Supplier[];
  /** Faktureringsallokeringar (källrad → fakturarad). Guardera med ?? []. */
  billingAllocations?: BillingAllocation[];
  /** Ändringar och tillägg på uppdrag. Guardera med ?? []. */
  jobChanges?: JobChange[];
  /**
   * Artikelrader från kvitto, leverantörsfaktura eller orderbekräftelse.
   * Skilda från Expense/SupplierInvoice (bokföringsunderlag). Guardera med ?? [].
   */
  documentLines?: DocumentLine[];
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
    /**
     * Lärda motpartsregler för banktransaktioner som inte är köp eller kund-
     * betalningar (bankavgift, skattekonto, lön, amortering …). Nyckeln är det
     * normaliserade motpartsnamnet. Första bokningen ger ett förslag nästa gång,
     * den andra gör att transaktionen bokförs automatiskt med förklaring.
     */
    bankCounterpartRules?: Record<string, BankCounterpartRule>;
    /**
     * Explicit tillstånd för valfria funktioner (Hemsida, Samarbeta).
     * true = på, false = avstängd (data finns kvar). Saknas flaggan men
     * data finns → backfill som aktiv så inget försvinner för befintliga.
     */
    features?: {
      website?: boolean;
      collaboration?: boolean;
      /** Grossistbeställningar. Avstängd = dold; anslutningar, prisfiler och order finns kvar. */
      wholesalers?: boolean;
    };
    /**
     * Nästa löpnummer för beställningsreferensen (FV-1001, FV-1002 …).
     * Saknas = börja på 1001. Skrivs i samma commit som ordern (state_version-CAS).
     */
    purchaseOrderSequence?: number;
    /** Demon: den fiktiva grossisten är seedad – seedas aldrig om av misstag. */
    wholesalerDemoSeeded?: boolean;
    /**
     * Publika sajten är pausad tills användaren publicerar igen.
     * Sätts när Hemsida stängs av. Rör inte website.status – det
     * publicerade innehållet ligger kvar.
     */
    websitePausedAt?: string;
    /**
     * Bokföringsläget per företag (äldre). Nya sparningar går i
     * `bookkeepingModeByUser`. Saknas båda = enkelt.
     */
    bookkeepingMode?: "enkelt" | "avancerat";
    /**
     * Bokföringsläget per användare. Nyckeln är userId. Saknas = fall tillbaka
     * på `bookkeepingMode` och därefter enkelt.
     */
    bookkeepingModeByUser?: Record<string, "enkelt" | "avancerat">;
    /** false = F-skatt bokförs inte automatiskt. Saknas = på. */
    autoBookFSkatt?: boolean;
    tradeProfile?: "snickare" | "elektriker" | "vvs" | "malare" | "ovrigt";
    /** Senaste inklistrade skattekontoutdraget, för förslag i kön. */
    lastTaxAccountStatement?: { date: string; text: string; amount: number }[];
    /**
     * Företagets egna artikelregister (timpris, material, schabloner).
     * Används som förslag när rader läggs på offert och faktura.
     */
    articles?: CatalogArticle[];
    /**
     * Prisradsbeskrivningar som användaren glömt i autocomplete.
     * Sträng = glömd för alla radtyper (äldre format). Objekt = glömd
     * bara för den typen. Påverkar bara förslag – historiska dokument orörda.
     */
    ignoredLineDescriptions?: Array<string | { key: string; kind: LineKind }>;
  };
}
