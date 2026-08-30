import { db } from "../store";
import type { Invoice, Job, SupplierInvoice } from "../types";
import {
  daysOverdue,
  effectiveQuoteStatus,
  currentVersion,
  invoiceOutstanding,
  invoiceTotals,
  isOpenReceivable,
  isOverdue,
  jobQuote,
  quoteTotals,
  quoteWaitingDays,
  getCurrentVersion,
  getCustomer,
} from "./data";
import { creditRefundDue } from "./invoices";
import { derivedJobStatus, isPaymentPlanPartDue } from "./job-lifecycle";
import { jobMoneySummary, nextPaymentPlanPartForJob, remainingToInvoiceForJob } from "./attention";
import { taxReductionCaseForInvoice, taxReductionCaseForJob, type TaxReductionCase } from "./tax-reduction";
import {
  describeReminderDue,
  listReminders,
  reminderLocalDate,
  reminderTargetHref,
  reminderVisibleFrom,
} from "./reminders";
import { paymentSuggestionForTransaction } from "./payment-matching";
import { suppressedActionIds } from "./attention-state";
import { bankReconciliation } from "../accounting/reconciliation";
import { bokforingsdatum, calendarFiscalYear, quartersOf, vatDueDate, type Period } from "../accounting/dates";
import { computeVatPosition } from "../accounting/vat";
import { datumKort, kr, relativ } from "../format";
import { invoiceHref, jobHref, newQuoteHref, quoteHref } from "../nav";
import { isIncomingUnquotedJob, jobSourceLabel } from "./jobs";
import {
  latestPaymentForInvoice,
  remainingAmountForInvoice,
  supplierPaymentConfirmRows,
} from "./supplier-payments";
import {
  guessPaymentMethod,
  paymentDetailsInfo,
  paymentMethodLabel,
  provenanceLabel,
  supplierDetailsRequestInfo,
  type PaymentDetailsInfo,
} from "./payment-details";
import { payerAccountLabel } from "./payment-files";
import { amountIsCertain, isPaymentInFlight, isReadyToApproveNow, needsAmountReview } from "../inbox/workflow";
import { quoteWaitingLabel } from "../status-labels";

/**
 * Central åtgärdsmotor: EN härledning av "vad behöver jag göra?" ur riktig
 * domändata (fakturor, offerter, uppdrag, ROT/RUT, kvitton, bank, moms).
 * Hem, Bokföring och redovisningskön projicerar samma åtgärds-id:n
 * (action-views.ts) – aldrig parallella todo-tabeller. Ingen task-tabell:
 * raden försvinner när verkligheten är åtgärdad.
 */

export type ActionPriority = "urgent" | "action" | "upcoming" | "info";

export type ActionCategory =
  | "invoice"
  | "quote"
  | "job"
  | "rot"
  | "accounting"
  | "vat"
  | "supplier"
  | "reminder";

/** Ikonnyckel för UI:t – hålls som data så att motorn förblir ren serverkod. */
export type ActionIcon =
  | "alert"
  | "clock"
  | "inbox"
  | "receipt"
  | "question"
  | "invoice"
  | "bank"
  | "calendar"
  | "percent"
  | "bell";

/**
 * Radunderlag för den fokuserade betalningsuppgiftskön ("N leverantörsfakturor
 * behöver betalningsuppgifter" → Hantera). Varje rad bär SAMMA underliggande
 * åtgärd som en enskild uppmärksamhetsrad – ingen parallell modell.
 */
export interface PaymentDetailsQueueItem {
  supplierInvoiceId: string;
  supplier: string;
  amount: number;
  dueDate: string;
  href: string;
  action:
    | { kind: "verify"; candidateAccount?: string; candidateOcr?: string }
    | { kind: "reuse"; account: string; verifiedVia: string }
    | { kind: "request"; to: string; subject: string; message: string };
}

/** Knappen som utför åtgärden direkt i listan. Diskriminerad så UI:t kan koppla server actions. */
export type ActionCta =
  | { type: "link"; label: string; href: string }
  | { type: "remindInvoice"; label: string; invoiceId: string }
  | { type: "retryInvoiceEmail"; label: string; invoiceId: string }
  | { type: "followUpQuote"; label: string; quoteId: string }
  | { type: "uploadReceipt"; label: string; expenseId: string }
  | { type: "answerQuestion"; expenseId: string; options: string[] }
  | { type: "createJobInvoice"; label: string; jobId: string }
  | { type: "startJobFromQuote"; label: string; quoteId: string }
  | { type: "paySupplier"; label: string; supplierInvoiceId: string; paymentId?: string }
  /** Skapa pain.001-bankfil för fakturan (V1: fil + manuell uppladdning i internetbanken). */
  | { type: "createPaymentFile"; label: string; supplierInvoiceId: string }
  | { type: "confirmPaymentMatch"; label: string; txId: string; invoiceId: string }
  | { type: "pickPaymentMatch"; txId: string }
  | { type: "confirmRotPayout"; label: string; txId: string }
  | { type: "registerCreditRefund"; label: string; invoiceId: string; txId?: string }
  | { type: "reminderActions"; reminderId: string; dueAt: string; timezone: string }
  // Betalningsuppgifter för leverantörsfakturor – konkreta lösningsflöden,
  // aldrig ett generiskt "öppna dokumentet" som låtsas vara en åtgärd.
  | {
      /** Kontrollera/ange uppgifter i en fokuserad vy (dokumentkandidat förifylls). */
      type: "verifyPaymentDetails";
      label: string;
      supplierInvoiceId: string;
      candidateAccount?: string;
      candidateOcr?: string;
    }
  | {
      /** Återanvänd tidigare VERIFIERADE leverantörsuppgifter (bekräftelse krävs). */
      type: "useVerifiedSupplierDetails";
      label: string;
      supplierInvoiceId: string;
      account: string;
    }
  | {
      /** Explicit verifiering av ÄNDRAD destination – godkänns aldrig automatiskt. */
      type: "confirmChangedSupplierDetails";
      label: string;
      supplierInvoiceId: string;
      previousAccount: string;
      newAccount: string;
    }
  | {
      /** Be leverantören komplettera via e-post (extern sändning – bekräftelse krävs). */
      type: "requestSupplierDetails";
      label: string;
      supplierInvoiceId: string;
      to: string;
    }
  | { type: "paymentDetailsQueue"; label: string; items: PaymentDetailsQueueItem[] };

/**
 * Bekräftelseinnehåll för åtgärder som skickar externt (e-post) eller bokför
 * pengar. UI:t visar dialogen FÖRE utförandet – inget mejl går från ett rent
 * radklick. Vilka typer som kräver detta deklareras centralt i
 * action-issue.ts (requiresConfirmation); motorn levererar innehållet.
 */
export interface ActionConfirm {
  /** T.ex. "Skicka påminnelse?". */
  title: string;
  /** Entitetssammanfattning: dokument, belopp, mottagare. */
  rows: { label: string; value: string }[];
  /** Utför-knappen, t.ex. "Skicka påminnelse". */
  confirmLabel: string;
}

export interface BusinessAction {
  id: string;
  priority: ActionPriority;
  category: ActionCategory;
  icon: ActionIcon;
  /** T.ex. "Faktura #1042 är 7 dagar sen". */
  title: string;
  /** T.ex. "Brf Eken · 23 000 kr". */
  subtitle: string;
  /** Endast visning i redovisningskön – motorn sätter aldrig detta. */
  clientName?: string;
  /** Djuplänk rakt till platsen där felet fixas – aldrig en generisk lista. */
  href: string;
  cta?: ActionCta;
  secondary?: { label: string; href: string };
  amount?: number;
  /** Bekräftelsedialog före utförande (externa utskick, pengabokningar). */
  confirm?: ActionConfirm;
}

/**
 * Relevant närtid som Driva håller koll på – ingen åtgärd just nu.
 * Pågående (väntar på annan) och kommande (deadline) är samma feed.
 */
export interface WatchingItem {
  id: string;
  category: ActionCategory;
  title: string;
  subtitle: string;
  href: string;
  /** Relevant datum (YYYY-MM-DD) – På gång sorteras kronologiskt på detta. */
  date: string;
  amount?: number;
}

export interface BusinessActions {
  attention: BusinessAction[];
  watching: WatchingItem[];
}

/** Skickad offert utan svar i så här många dagar → dags att följa upp. */
export const QUOTE_FOLLOW_UP_DAYS = 7;
/** Moms visas som åtgärd på Hem först så här nära deklarationsdatumet. */
export const VAT_ATTENTION_DAYS = 14;
/** Moms blir brådskande så här nära (eller efter) deklarationsdatumet. */
export const VAT_URGENT_DAYS = 3;

/**
 * Tidsfönster för "På gång". Olika eventtyper har olika relevans –
 * samma tal ska inte vara utspridda i komponenter.
 * Allt utanför fönstret är HIDDEN (inte kalenderdump).
 */
export const WATCHING = {
  /** Öppen faktura: visa när förfallodatum är inom så här många dagar. */
  invoiceDays: 14,
  /** Planerat uppdrag: visa så här många dagar före start. */
  jobDays: 14,
  /** Obetald leverantörsfaktura: visa så här många dagar före förfall. */
  supplierDays: 14,
  /**
   * Moms: visa i På gång när deklarationen är inom så här många dagar,
   * men ännu inte så nära att den blivit en åtgärd (VAT_ATTENTION_DAYS).
   * 2,5 månader bort är HIDDEN.
   */
  vatDays: 45,
  /** Framtida påminnelse: visa så här många dagar innan den blir åtgärd. */
  reminderDays: 7,
  /** Säkerhetslock – UI:t visar 6 och resten bakom "Visa fler". */
  maxItems: 20,
} as const;

const DAY_MS = 86_400_000;

function startOfLocalDayMs(d: Date): number {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c.getTime();
}

/** Hela dagar från `now` till datumet. Positivt = framtid. */
function daysFrom(now: Date, iso: string): number {
  return Math.round((startOfLocalDayMs(new Date(iso)) - startOfLocalDayMs(now)) / DAY_MS);
}

function withinWatchingWindow(now: Date, iso: string, windowDays: number): boolean {
  const days = daysFrom(now, iso);
  return days >= 0 && days <= windowDays;
}

/**
 * Fast prioritetsordning inom "Behöver din uppmärksamhet".
 * 0–3 är brådskande (rött), resten vanliga åtgärder.
 *
 * vatOverdue ≠ vatUrgent: en PASSERAD deklarationsdeadline är ett lagkrav
 * med förseningsavgifter och rankas över sena kundfakturor; en deadline som
 * bara närmar sig (vatUrgent) ligger kvar under betalningsproblemen.
 */
const RANK = {
  invoiceDeliveryFailed: 0,
  vatOverdue: 1,
  invoiceOverdue: 2,
  paymentMismatch: 3,
  vatUrgent: 4,
  bank: 5,
  supplierOverdue: 6,
  accountingQuestion: 7,
  reminder: 8,
  newJob: 9,
  jobInvoice: 10,
  rot: 11,
  vatSoon: 12,
  quoteFollowUp: 13,
  quoteExpired: 14,
  missingReceipt: 15,
  clientRequest: 6,
} as const;

interface Ranked {
  rank: number;
  /** Lägre först inom samma rank. */
  order: number;
  action: BusinessAction;
}

function isNextControlFlow(err: unknown): boolean {
  const digest = (err as { digest?: string } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP"));
}

/** En trasig rad får inte fälla hela Hem/layouten. */
function runCollect(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
    console.error(`[actions] hoppade ${label}:`, err instanceof Error ? err.message : err);
  }
}

function customerLabel(id: string): string {
  return getCustomer(id)?.name ?? "Okänd kund";
}

export function getBusinessActions(
  now = new Date(),
  opts: {
    /**
     * Ta med snoozade rader (registeretiketter i Ekonomi behöver den konkreta
     * åtgärden även när uppmärksamhetsraden är dold – snooze döljer
     * uppmärksamhet, aldrig fakta). Standard: exkludera – samma semantik för
     * Hem, Bokföring och AI:ns "vad behöver jag göra?".
     */
    includeSnoozed?: boolean;
  } = {}
): BusinessActions {
  const ranked: Ranked[] = [];
  const watching: WatchingItem[] = [];

  runCollect("invoices", () => collectInvoices(ranked, watching, now));
  runCollect("quotes", () => collectQuotes(ranked, watching));
  runCollect("jobs", () => collectJobs(ranked, watching, now));
  runCollect("reminders", () => collectReminders(ranked, watching, now));
  runCollect("tax", () => collectTaxReduction(ranked, watching, now));
  runCollect("bookkeeping", () => collectBookkeepingSources(ranked, watching, now));
  runCollect("suppliers", () => collectSuppliers(ranked, watching, now));

  const attention = applyAttentionPolicy(ranked, now, opts.includeSnoozed);
  const attentionIds = new Set(attention.map((a) => a.id));
  watching.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const unique = watching.filter((item) => !attentionIds.has(item.id));

  return { attention, watching: unique.slice(0, WATCHING.maxItems) };
}

/**
 * Bokföringskällor som delas av Hem-motorn, Bokföring-sidan och nav-badgen.
 * Inga kundfakturor/offerter/uppdrag – de hör till andra ytor.
 */
function collectBookkeepingSources(ranked: Ranked[], watching: WatchingItem[], now: Date) {
  runCollect("accounting", () => collectAccounting(ranked));
  runCollect("client-requests", () => collectClientRequests(ranked));
  runCollect("inbox-mail", () => collectInboxMail(ranked));
  runCollect("vat", () => collectVat(ranked, watching, now));
}

/** Snooze/HIDE: dolda tills tidpunkten passerat – sedan synliga igen om saken kvarstår. */
function applyAttentionPolicy(ranked: Ranked[], now: Date, includeSnoozed?: boolean): BusinessAction[] {
  ranked.sort((a, b) => a.rank - b.rank || a.order - b.order);
  let attention = ranked.map((r) => r.action);
  if (!includeSnoozed) {
    const suppressed = suppressedActionIds(now);
    if (suppressed.size > 0) attention = attention.filter((a) => !suppressed.has(a.id));
  }
  return attention;
}

/**
 * Nav-badge + Bokföring-sidan: aktiva bokföringsfrågor som väntar på användaren.
 *
 * Räknas (priority `urgent`|`action`, kategori `accounting`|`vat`):
 *   – saknat kvitto (`receipt-*`)
 *   – kategori att välja (`question-*`)
 *   – belopp/dokument att kontrollera (`inbox-mail-*`)
 *   – oklar banktransaktion eller oförklarad differens (`bank-*`)
 *   – väntande klientunderlag (`client-request-*`)
 *   – moms att deklarera när deadline är inom VAT_ATTENTION_DAYS eller passerad (`vat-*`)
 *
 * Räknas inte:
 *   – bokförda/redan lösta poster (motorn härleder dem inte)
 *   – informational- eller upcoming-priority
 *   – framtida deadlines som bara ligger i På gång (moms längre bort än VAT_ATTENTION_DAYS)
 *   – snoozade rader innan snooze går ut (återvänder automatiskt om saken kvarstår)
 *   – kundfakturor, offerter, uppdrag, leverantörsbetalningar (Inbox/Ekonomi/Hem)
 */
export function countsTowardBookkeepingBadge(
  action: Pick<BusinessAction, "category" | "priority">
): boolean {
  if (action.priority === "info" || action.priority === "upcoming") return false;
  return action.category === "accounting" || action.category === "vat";
}

/**
 * Samma mängd som Bokföring visar som "bokföringsfrågor att lösa".
 * Kör bara bokföringskällor – inte hela Hem-kön.
 */
export function listBookkeepingAttention(
  now = new Date(),
  opts: { includeSnoozed?: boolean } = {}
): BusinessAction[] {
  const ranked: Ranked[] = [];
  collectBookkeepingSources(ranked, [], now);
  return applyAttentionPolicy(ranked, now, opts.includeSnoozed).filter(countsTowardBookkeepingBadge);
}

/**
 * Nav-badge: antal aktiva olösta bokföringsfrågor. 0 = ingen badge.
 * Billigare än getBusinessActions() – ingen faktura-/offert-/uppdragskö.
 */
export function countBookkeepingBadge(now = new Date()): number {
  const ranked: Ranked[] = [];
  collectBookkeepingSources(ranked, [], now);
  const suppressed = suppressedActionIds(now);
  let n = 0;
  for (const { action } of ranked) {
    if (suppressed.has(action.id)) continue;
    if (countsTowardBookkeepingBadge(action)) n += 1;
  }
  return n;
}

/* ---------------------------------- Fakturor --------------------------------- */

function invoiceLabel(inv: Invoice): string {
  return inv.number == null ? "Fakturautkast" : `Faktura #${inv.number}`;
}

function collectInvoices(ranked: Ranked[], watching: WatchingItem[], now: Date) {
  for (const inv of db().invoices) {
    const customer = getCustomer(inv.customerId);
    if (!customer) continue;
    // Kreditfakturor är inga fordringar. Krediterade original kan dock ha en
    // återbetalningsskuld (kunden hann betala) – den fångas nedan.
    if (inv.type === "kredit") continue;

    // PAYMENT_MISMATCH/CREDIT_REFUND_DUE: pengar som ska tillbaka till kunden –
    // överbetalning (bokad som skuld på 2420) eller kreditering av betald faktura.
    const refundDue = creditRefundDue(inv);
    if (refundDue > 0) {
      ranked.push({
        rank: RANK.paymentMismatch,
        order: -refundDue,
        action: {
          id: `invoice-refund-${inv.id}`,
          priority: "action",
          category: "invoice",
          icon: "alert",
          title:
            inv.status === "krediterad"
              ? `Återbetala ${kr(refundDue)} – faktura #${inv.number} krediterades efter betalning`
              : `${customer.name} betalade ${kr(refundDue)} för mycket på faktura #${inv.number}`,
          subtitle: `${customer.name} · pengarna ligger som skuld i bokföringen tills de betalas tillbaka eller kvittas`,
          href: invoiceHref(inv.id),
          cta: { type: "registerCreditRefund", label: "Markera återbetald", invoiceId: inv.id },
          amount: refundDue,
          confirm: {
            title: "Bokför återbetalning?",
            rows: [
              { label: "Kund", value: customer.name },
              { label: "Faktura", value: `#${inv.number}` },
              { label: "Belopp", value: kr(refundDue) },
              { label: "Bokförs som", value: "återbetald kundskuld" },
            ],
            confirmLabel: "Markera återbetald",
          },
        },
      });
    }

    if (inv.status === "krediterad") continue;

    const deliveryFailed =
      (inv.status === "skickad" || inv.status === "delbetald") && Boolean(inv.issuedAt) && !inv.sentAt;
    if (deliveryFailed) {
      const toPay = invoiceTotals(inv).toPay;
      ranked.push({
        rank: RANK.invoiceDeliveryFailed,
        order: -toPay,
        action: {
          id: `invoice-delivery-${inv.id}`,
          priority: "urgent",
          category: "invoice",
          icon: "alert",
          title: `${invoiceLabel(inv)} kunde inte skickas`,
          subtitle: `${customer.name} · ${kr(toPay)} · mejlet nådde aldrig kunden`,
          href: invoiceHref(inv.id),
          cta: { type: "retryInvoiceEmail", label: "Skicka igen", invoiceId: inv.id },
          amount: toPay,
          confirm: {
            title: "Skicka fakturan igen?",
            rows: [
              { label: "Faktura", value: `${invoiceLabel(inv)} · ${customer.name}` },
              { label: "Belopp", value: kr(toPay) },
              { label: "Mottagare", value: customer.email || "E-postadress saknas" },
            ],
            confirmLabel: "Skicka igen",
          },
        },
      });
      continue;
    }

    if (!isOpenReceivable(inv)) continue;
    // Utestående = att betala − inbetalt − delkrediterat (EN härledning i data.ts).
    const outstanding = invoiceOutstanding(inv);
    if (outstanding <= 0) continue;
    const partial = inv.status === "delbetald";

    if (isOverdue(inv)) {
      const days = daysOverdue(inv);
      ranked.push({
        rank: RANK.invoiceOverdue,
        order: -(days * 1_000_000 + Math.min(outstanding, 999_999)),
        action: {
          id: `invoice-late-${inv.id}`,
          priority: "urgent",
          category: "invoice",
          icon: "alert",
          title: `${invoiceLabel(inv)} är ${days} ${days === 1 ? "dag" : "dagar"} sen`,
          subtitle: `${customer.name} · ${kr(outstanding)}${partial ? " återstår (delbetald)" : ""}`,
          href: invoiceHref(inv.id),
          cta: { type: "remindInvoice", label: "Skicka påminnelse", invoiceId: inv.id },
          amount: outstanding,
          confirm: {
            title: "Skicka påminnelse?",
            rows: [
              { label: "Faktura", value: `${invoiceLabel(inv)} · ${customer.name}` },
              { label: "Utestående", value: `${kr(outstanding)}${partial ? " (delbetald)" : ""}` },
              { label: "Förfallen", value: `${days} ${days === 1 ? "dag" : "dagar"}` },
              { label: "Mottagare", value: customer.email || "E-postadress saknas" },
            ],
            confirmLabel: "Skicka påminnelse",
          },
        },
      });
    } else if (withinWatchingWindow(now, inv.dueDate, WATCHING.invoiceDays)) {
      watching.push({
        id: `invoice-open-${inv.id}`,
        category: "invoice",
        title: `${invoiceLabel(inv)} · ${kr(outstanding)}${partial ? " återstår" : ""}`,
        subtitle: `${customer.name} · ${partial ? "delbetald · " : ""}förfaller ${relativ(inv.dueDate)}`,
        href: invoiceHref(inv.id),
        amount: outstanding,
        date: inv.dueDate.slice(0, 10),
      });
    }
  }
}

/* ---------------------------------- Offerter --------------------------------- */

function collectQuotes(ranked: Ranked[], watching: WatchingItem[]) {
  for (const q of db().quotes) {
    const customer = getCustomer(q.customerId);
    if (!customer) continue;
    if (!getCurrentVersion(q)) continue;
    if (q.status === "godkand") {
      const hasJob =
        Boolean(q.jobId && db().jobs.some((j) => j.id === q.jobId)) || db().jobs.some((j) => j.quoteId === q.id);
      if (hasJob) continue;
      const toPay = quoteTotals(q).toPay;
      ranked.push({
        rank: RANK.jobInvoice,
        order: -toPay,
        action: {
          id: `quote-start-job-${q.id}`,
          priority: "action",
          category: "quote",
          icon: "inbox",
          title: `Starta uppdrag från offert #${q.number}`,
          subtitle: `${customer.name} · ${kr(toPay)} · godkänd`,
          href: quoteHref(q.id),
          cta: { type: "startJobFromQuote", label: "Starta uppdrag", quoteId: q.id },
          amount: toPay,
        },
      });
      continue;
    }
    if (q.status !== "skickad") continue; // utkast/avböjd kräver inget globalt
    const toPay = quoteTotals(q).toPay;

    if (effectiveQuoteStatus(q) === "utgangen") {
      ranked.push({
        rank: RANK.quoteExpired,
        order: -toPay,
        action: {
          id: `quote-expired-${q.id}`,
          priority: "action",
          category: "quote",
          icon: "clock",
          title: `Offert #${q.number} har gått ut`,
          subtitle: `${customer.name} · ${kr(toPay)} · giltig till ${datumKort(currentVersion(q).validUntil)}`,
          href: quoteHref(q.id),
          cta: { type: "link", label: "Öppna offerten", href: quoteHref(q.id) },
          amount: toPay,
        },
      });
      continue;
    }

    const days = quoteWaitingDays(q);
    if (days >= QUOTE_FOLLOW_UP_DAYS) {
      ranked.push({
        rank: RANK.quoteFollowUp,
        order: -days,
        action: {
          id: `quote-wait-${q.id}`,
          priority: "action",
          category: "quote",
          icon: "clock",
          title: `Offert #${q.number} har väntat i ${days} dagar`,
          subtitle: `${customer.name} · ${kr(toPay)} · ${quoteWaitingLabel({ viewed: Boolean(q.viewedAt) })}`,
          href: quoteHref(q.id),
          // Skickar en påminnelse via e-post – etiketten säger vad som händer.
          cta: { type: "followUpQuote", label: "Skicka påminnelse", quoteId: q.id },
          amount: toPay,
          confirm: {
            title: "Skicka påminnelse?",
            rows: [
              { label: "Offert", value: `#${q.number} · ${customer.name}` },
              { label: "Belopp", value: kr(toPay) },
              { label: "Skickades", value: `för ${days} dagar sedan` },
              { label: "Mottagare", value: customer.email || "E-postadress saknas" },
            ],
            confirmLabel: "Skicka påminnelse",
          },
        },
      });
    } else {
      // "Öppnad · väntar på signering": vad som hänt + vad vi väntar på –
      // metoden (BankID) hör hemma i tidslinjen, inte här.
      watching.push({
        id: `quote-open-${q.id}`,
        category: "quote",
        title: `Offert #${q.number} · ${kr(toPay)}`,
        subtitle: `${customer.name} · ${quoteWaitingLabel({ viewed: Boolean(q.viewedAt) })}`,
        href: quoteHref(q.id),
        amount: toPay,
        date: (q.sentAt ?? q.createdAt).slice(0, 10),
      });
    }
  }
}

/* ------------------------------- Uppdrag/fakturering ------------------------- */

function collectJobs(ranked: Ranked[], watching: WatchingItem[], now: Date) {
  for (const job of db().jobs) {
    const customer = getCustomer(job.customerId);
    if (!customer) continue;
    if (isIncomingUnquotedJob(job)) {
      const href = jobHref(job.id);
      const via = jobSourceLabel(job.source);
      ranked.push({
        rank: RANK.newJob,
        order: -(Date.parse(job.createdAt) || 0),
        action: {
          id: `job-new-${job.id}`,
          priority: "action",
          category: "job",
          icon: "inbox",
          title: `Nytt uppdrag: ${job.title}`,
          subtitle: via ? `${customer.name} · ${via}` : customer.name,
          href,
          cta: { type: "link", label: "Öppna uppdrag", href },
          secondary: {
            label: "Skapa offert",
            href: newQuoteHref({ kund: job.customerId, job: job.id, from: { href, label: job.title } }),
          },
        },
      });
    }

    const derived = derivedJobStatus(job, now);

    if (
      derived === "planerat" &&
      job.startDate &&
      withinWatchingWindow(now, job.startDate, WATCHING.jobDays)
    ) {
      watching.push({
        id: `job-start-${job.id}`,
        category: "job",
        title: `${job.title} startar ${relativ(job.startDate)}`,
        subtitle: customer.name,
        href: jobHref(job.id),
        date: job.startDate.slice(0, 10),
      });
    }

    const quote = jobQuote(job);
    if (!quote || quote.status !== "godkand") continue;
    const remaining = remainingToInvoiceForJob(job.id);
    if (remaining <= 0) continue;

    if (derived === "klart") {
      ranked.push({
        rank: RANK.jobInvoice,
        order: -remaining,
        action: {
          id: `job-final-${job.id}`,
          priority: "action",
          category: "job",
          icon: "invoice",
          title: `${job.title} är klart – ${kr(remaining)} kvar att fakturera`,
          subtitle: `${customer.name} · enligt godkänd offert`,
          href: jobHref(job.id),
          cta: { type: "createJobInvoice", label: "Skapa slutfaktura", jobId: job.id },
          amount: remaining,
        },
      });
      continue;
    }

    const next = nextPaymentPlanPartForJob(job.id);
    if (!next || !isPaymentPlanPartDue(next, derived)) continue;
    const money = jobMoneySummary(job.id);
    ranked.push({
      rank: RANK.jobInvoice,
      order: -next.amount,
      action: {
        id: `job-invoice-${job.id}`,
        priority: "action",
        category: "job",
        icon: "invoice",
        title: `${kr(next.amount)} kan faktureras för ${job.title}`,
        subtitle: `${customer.name} · ${next.percent} % ${next.label.toLowerCase()}${
          money.invoiced > 0 ? " · enligt betalplanen" : " · enligt godkänd offert"
        }`,
        href: jobHref(job.id),
        cta: {
          type: "createJobInvoice",
          label: next.isLast ? "Skapa slutfaktura" : "Skapa faktura",
          jobId: job.id,
        },
        amount: next.amount,
      },
    });
  }
}

/* --------------------------------- Påminnelser -------------------------------- */

/**
 * Policy (härledd – aldrig lagrad):
 *  - Klockslag/dagsdel → syns i uppmärksamhet från dueAt.
 *  - Dagsnivå → syns från lokal dagsstart (förfaller kl 10:00 = standardtid).
 *  - Framtida inom WATCHING.reminderDays → På gång, aldrig uppmärksamhet i förtid.
 *  - Uppskjutna försvinner tills snoozedUntil. COMPLETED/DISMISSED syns aldrig.
 *  - Förseningar presenteras tydligt ("Försenad – skulle gjorts igår kl 10:00").
 */
function collectReminders(ranked: Ranked[], watching: WatchingItem[], now: Date) {
  for (const reminder of listReminders()) {
    const visibleFrom = reminderVisibleFrom(reminder);
    const due = describeReminderDue(reminder, now);
    const href = reminderTargetHref(reminder);

    if (visibleFrom.getTime() > now.getTime()) {
      const days = Math.round((startOfLocalDayMs(visibleFrom) - startOfLocalDayMs(now)) / DAY_MS);
      if (days <= WATCHING.reminderDays) {
        watching.push({
          id: `reminder-upcoming-${reminder.id}`,
          category: "reminder",
          title: reminder.title,
          subtitle: due.text,
          href,
          date: reminderLocalDate(reminder),
        });
      }
      continue;
    }

    ranked.push({
      rank: RANK.reminder,
      // Mest försenade först, därefter tidigast tidpunkt.
      order: Date.parse(reminder.dueAt) || 0,
      action: {
        id: `reminder-${reminder.id}`,
        priority: due.overdue ? "urgent" : "action",
        category: "reminder",
        icon: "bell",
        title: reminder.title,
        subtitle: reminder.description ? `${due.text} · ${reminder.description}` : due.text,
        href,
        cta: {
          type: "reminderActions",
          reminderId: reminder.id,
          dueAt: reminder.dueAt,
          timezone: reminder.timezone,
        },
      },
    });
  }
}

/* ---------------------------------- ROT/RUT ----------------------------------- */

function caseInvoices(cse: TaxReductionCase): Invoice[] {
  const data = db();
  if (cse.jobId) {
    return data.invoices.filter(
      (i) => i.jobId === cse.jobId && i.rot && i.type !== "kredit" && i.status !== "krediterad"
    );
  }
  const inv = cse.invoiceId ? data.invoices.find((i) => i.id === cse.invoiceId) : undefined;
  return inv ? [inv] : [];
}

function collectTaxReduction(ranked: Ranked[], watching: WatchingItem[], now: Date) {
  const data = db();
  const today = bokforingsdatum(now.toISOString());
  const cases: { cse: TaxReductionCase; href: string; context: string; customerId: string }[] = [];

  for (const job of data.jobs) {
    const cse = taxReductionCaseForJob(job);
    if (!cse.type || cse.phase === "none") continue;
    cases.push({ cse, href: jobHref(job.id), context: job.title, customerId: job.customerId });
  }
  for (const inv of data.invoices) {
    if (!inv.rot || inv.jobId || inv.type === "kredit" || inv.status === "krediterad") continue;
    const cse = taxReductionCaseForInvoice(inv);
    if (!cse.type || cse.phase === "none") continue;
    cases.push({ cse, href: invoiceHref(inv.id), context: invoiceLabel(inv), customerId: inv.customerId });
  }

  for (const { cse, href, context, customerId } of cases) {
    const invoices = caseInvoices(cse);
    const deduction = invoices.reduce((s, i) => s + invoiceTotals(i).deduction, 0);
    const customer = customerLabel(customerId);
    const label = cse.label; // "ROT" | "RUT"

    switch (cse.phase) {
      case "waiting_payment":
        watching.push({
          id: `rot-wait-pay-${cse.jobId ?? cse.invoiceId}`,
          category: "rot",
          title: `${label}-avdrag väntar på kundens betalning`,
          subtitle: `${context} · ${customer} · ${kr(deduction)}`,
          href,
          amount: deduction,
          date: today,
        });
        break;
      case "waiting_work":
        watching.push({
          id: `rot-wait-work-${cse.jobId ?? cse.invoiceId}`,
          category: "rot",
          title: `${label}-avdrag väntar på att arbetet blir klart`,
          subtitle: `${context} · ${customer} · ${kr(deduction)}`,
          href,
          amount: deduction,
          date: today,
        });
        break;
      case "missing_fields":
        ranked.push({
          rank: RANK.rot,
          order: -deduction,
          action: {
            id: `rot-missing-${cse.jobId ?? cse.invoiceId}`,
            priority: "action",
            category: "rot",
            icon: "percent",
            title: `En uppgift saknas för ${label}-ansökan`,
            subtitle: `${cse.missing[0]?.label ?? "Uppgift saknas"} · ${customer} · ${kr(deduction)}`,
            href,
            cta: { type: "link", label: "Komplettera", href },
            amount: deduction,
          },
        });
        break;
      case "ready":
        ranked.push({
          rank: RANK.rot,
          order: -deduction,
          action: {
            id: `rot-ready-${cse.jobId ?? cse.invoiceId}`,
            priority: "action",
            category: "rot",
            icon: "percent",
            title: `${kr(deduction)} ${label} är redo att ansökas`,
            subtitle: `${context} · ${customer}`,
            href,
            cta: { type: "link", label: "Öppna ansökan", href },
            amount: deduction,
          },
        });
        break;
      case "underlag":
        watching.push({
          id: `rot-submitted-${cse.jobId ?? cse.invoiceId}`,
          category: "rot",
          title: `${label}-ansökan väntar på Skatteverket`,
          subtitle: `${context} · ${customer} · ${kr(deduction)}`,
          href,
          amount: deduction,
          date: today,
        });
        break;
      case "godkant":
        // Beslut fattat men pengarna har inte kommit → väntar på extern part.
        if (!cse.application?.payout) {
          watching.push({
            id: `rot-payout-wait-${cse.jobId ?? cse.invoiceId}`,
            category: "rot",
            title: `${label} godkänt – väntar på utbetalning från Skatteverket`,
            subtitle: `${context} · ${customer} · ${kr(deduction)}`,
            href,
            amount: deduction,
            date: today,
          });
        }
        break;
      case "delvis_godkant":
      case "nekat": {
        // Restfaktura redan skapad → beslutet är omhändertaget, fakturan lever sitt eget liv.
        const ids = new Set(invoices.map((i) => i.id));
        const handled = data.invoices.some((r) => r.deniedReductionOf && ids.has(r.deniedReductionOf));
        if (handled) break;
        const application = cse.application;
        const denied = application?.decision?.deniedAmount ?? deduction;
        const approved = Math.max(0, deduction - denied);
        const restHref = cse.invoiceId ? invoiceHref(cse.invoiceId) : href;
        ranked.push({
          rank: RANK.rot,
          order: -denied,
          action: {
            id: `rot-denied-${cse.jobId ?? cse.invoiceId}`,
            priority: "action",
            category: "rot",
            icon: "percent",
            title:
              cse.phase === "nekat"
                ? `Skatteverket nekade ${label}-avdraget – fakturera kunden ${kr(denied)}`
                : `Skatteverket godkände ${kr(approved)} av ${kr(deduction)} i ${label}`,
            subtitle: `${context} · ${customer} · fakturera kunden ${kr(denied)}`,
            href: restHref,
            cta: { type: "link", label: "Fakturera resten", href: restHref },
            amount: denied,
          },
        });
        break;
      }
      default:
        break; // preliminar/godkant/none: inget att visa
    }
  }
}

/* ------------------------------ Bokföring/kvitton ----------------------------- */

function collectAccounting(ranked: Ranked[]) {
  const data = db();

  for (const e of data.expenses) {
    if (e.status === "behover_svar") {
      ranked.push({
        rank: RANK.accountingQuestion,
        order: Date.parse(e.date) || 0,
        action: {
          id: `question-${e.id}`,
          priority: "action",
          category: "accounting",
          icon: "question",
          title: e.question?.text ?? `Hur ska köpet hos ${e.supplier} bokföras?`,
          subtitle: `${e.supplier} · ${kr(e.amount)} · ${datumKort(e.date)}`,
          href: `/ekonomi?flik=utgifter&atgard=question-${e.id}`,
          cta: e.question
            ? { type: "answerQuestion", expenseId: e.id, options: e.question.options }
            : undefined,
          amount: e.amount,
        },
      });
    } else if (e.status === "saknar_kvitto") {
      const asked = (data.clientInformationRequests ?? []).some((r) => r.expenseId === e.id && !r.resolvedAt);
      if (!asked) {
        ranked.push({
          rank: RANK.missingReceipt,
          order: Date.parse(e.date) || 0,
          action: {
            id: `receipt-${e.id}`,
            priority: "action",
            category: "accounting",
            icon: "receipt",
            title: `Kvitto saknas – ${e.supplier}, ${kr(e.amount)}`,
            subtitle: `Köp ${datumKort(e.date)} · fota eller ladda upp kvittot så bokförs det`,
            href: `/ekonomi?flik=utgifter&atgard=receipt-${e.id}`,
            cta: { type: "uploadReceipt", label: "Lägg till kvitto", expenseId: e.id },
            amount: e.amount,
          },
        });
      }
    }
  }

  // Banktransaktioner som varken är bokförda eller täckta av en öppen utgiftsfråga.
  // Matchningsmotorns förslag härleds här (lagras aldrig): SUGGEST får en
  // bekräfta-knapp, REQUIRES_USER får den härledda diagnosen i klartext.
  const recon = bankReconciliation();
  for (const tx of recon.unhandled) {
    const coveredByExpense = data.expenses.some((e) => e.bankTransactionId === tx.id && e.status !== "bokford");
    if (coveredByExpense) continue;
    const incoming = tx.amount > 0;
    const suggestion = paymentSuggestionForTransaction(tx);
    // Djuplänk rakt till transaktionen (samma format som actionResolveHref).
    const txHref = `/ekonomi?flik=bank&atgard=${encodeURIComponent(`bank-${tx.id}`)}`;

    let title = incoming
      ? `Inbetalning från ${tx.counterpart} kunde inte matchas`
      : `Banktransaktion behöver hanteras – ${tx.counterpart}`;
    // Omatchad betalning utan säkert förslag: "Matcha betalning" rakt till
    // transaktionen – aldrig en generisk "Öppna banken".
    let cta: ActionCta = incoming
      ? { type: "pickPaymentMatch", txId: tx.id }
      : { type: "link", label: "Öppna transaktionen", href: txHref };
    let subtitle = `${kr(Math.abs(tx.amount))} · ${datumKort(tx.date)} · ${tx.description}`;

    switch (suggestion.kind) {
      case "match":
        title = `Bekräfta betalning: ${tx.counterpart} → faktura #${suggestion.invoiceNumber}`;
        subtitle = `${kr(tx.amount)} · ${suggestion.reason}${suggestion.diff && suggestion.diff > 0 ? ` · ${kr(suggestion.diff)} skulle återstå (delbetalning)` : ""}`;
        cta = { type: "confirmPaymentMatch", label: "Boka betalningen", txId: tx.id, invoiceId: suggestion.invoiceId! };
        break;
      case "overpayment":
        title = `Betalningen avviker med +${kr(-(suggestion.diff ?? 0))} – faktura #${suggestion.invoiceNumber}`;
        subtitle = `${tx.counterpart} betalade ${kr(tx.amount)} · ${suggestion.reason}`;
        cta = { type: "confirmPaymentMatch", label: "Boka och hantera överskottet", txId: tx.id, invoiceId: suggestion.invoiceId! };
        break;
      case "duplicate":
        title = `Möjlig dubbelbetalning från ${tx.counterpart}`;
        subtitle = `${kr(tx.amount)} · ${suggestion.reason}`;
        cta = { type: "pickPaymentMatch", txId: tx.id };
        break;
      case "tax_reduction_payout":
        if (suggestion.payout) {
          title = suggestion.diff
            ? `Skatteverket betalade ${kr(tx.amount)} av ${kr(suggestion.payout.expectedAmount)} – delvis godkänt?`
            : `Bekräfta ${suggestion.payout.label}-utbetalning från Skatteverket`;
          subtitle = `${suggestion.payout.customerName} · ${suggestion.reason}`;
          cta = { type: "confirmRotPayout", label: "Boka utbetalningen", txId: tx.id };
        } else {
          title = "Utbetalning från Skatteverket kunde inte matchas";
          subtitle = `${kr(tx.amount)} · ${suggestion.reason}`;
        }
        break;
      case "credit_refund":
        title = `Bekräfta återbetalning till kund – faktura #${suggestion.invoiceNumber}`;
        subtitle = `${kr(Math.abs(tx.amount))} · ${suggestion.reason}`;
        cta = { type: "registerCreditRefund", label: "Boka återbetalningen", invoiceId: suggestion.invoiceId!, txId: tx.id };
        break;
      default:
        subtitle = `${kr(Math.abs(tx.amount))} · ${datumKort(tx.date)} · ${suggestion.reason}`;
        break;
    }

    ranked.push({
      rank: RANK.bank,
      order: -Math.abs(tx.amount),
      action: {
        id: `bank-${tx.id}`,
        priority: "action",
        category: "accounting",
        icon: "bank",
        title,
        subtitle,
        href: txHref,
        cta,
        amount: Math.abs(tx.amount),
      },
    });
  }

  // Oförklarad differens mellan bank och bokföring – ska aldrig tystas.
  if (Math.abs(recon.unexplained) >= 1) {
    ranked.push({
      rank: RANK.bank,
      order: -Math.abs(recon.unexplained) - 1_000_000_000,
      action: {
        id: "bank-unexplained",
        priority: "action",
        category: "accounting",
        icon: "bank",
        title: "Banken stämmer inte mot bokföringen",
        subtitle: `Oförklarad skillnad ${kr(recon.unexplained)} · kontrollera banktransaktionerna`,
        href: "/ekonomi?flik=bank",
        cta: { type: "link", label: "Öppna banken", href: "/ekonomi?flik=bank" },
        amount: Math.abs(recon.unexplained),
      },
    });
  }
}

function collectClientRequests(ranked: Ranked[]) {
  for (const req of db().clientInformationRequests ?? []) {
    if (req.resolvedAt) continue;
    const expense = req.expenseId ? db().expenses.find((e) => e.id === req.expenseId) : undefined;
    ranked.push({
      rank: RANK.clientRequest,
      order: Date.parse(req.createdAt) || 0,
      action: {
        id: `client-request-${req.id}`,
        priority: "action",
        category: "accounting",
        icon: "receipt",
        title: req.title,
        subtitle: expense
          ? `${expense.supplier} · ${kr(expense.amount)}`
          : `${req.requestedByName} väntar på underlag`,
        href: expense
          ? `/ekonomi?flik=utgifter&atgard=receipt-${expense.id}`
          : "/ekonomi?flik=utgifter",
        cta: expense
          ? { type: "uploadReceipt", label: "Lägg till kvitto", expenseId: expense.id }
          : { type: "link", label: "Öppna utgifter", href: "/ekonomi?flik=utgifter" },
        amount: expense?.amount,
      },
    });
  }
}

/* ------------------------------ Leverantörsfakturor --------------------------- */

/** Gruppera betalningsuppgiftsrader på Hem när de är så här många. */
export const PAYMENT_DETAILS_GROUP_THRESHOLD = 3;

interface DetailCase {
  order: number;
  action: BusinessAction;
  queueItem: PaymentDetailsQueueItem;
}

/**
 * En bokförd, obetald faktura utan betalbara uppgifter → rad med KONKRET
 * lösning per orsak. Osäker läsning: kontrollera mot dokumentet. Verifierad
 * historik finns: föreslå återanvändning. Saknas helt: be leverantören via
 * mejl om avsändare + e-postleverantör finns – annars ingen Hem-rad alls
 * (status bor i Inbox/Ekonomi där manuell komplettering finns).
 */
function detailCaseFor(s: SupplierInvoice, details: PaymentDetailsInfo, href: string): DetailCase | null {
  const uncertain = details.cause === "EXTRACTION_UNCERTAIN";
  const due = `förfaller ${datumKort(s.dueDate)}`;
  const base = { supplierInvoiceId: s.id, supplier: s.supplier, amount: s.amount, dueDate: s.dueDate, href };

  if (details.reusable && details.previous) {
    const prev = details.previous;
    const verifiedVia = `${provenanceLabel(prev.source)} ${datumKort(prev.verifiedAt)}`;
    return {
      order: -s.amount,
      action: {
        id: `supplier-reuse-${s.id}`,
        priority: "action",
        category: "supplier",
        icon: "bank",
        title: `${s.supplier} · ${kr(s.amount)} – ${uncertain ? "bankgirot kunde inte läsas på fakturan" : "betalningsuppgifter saknas på fakturan"}`,
        subtitle: `Tidigare verifierat: ${prev.account} (${verifiedVia}) · ${due}`,
        href,
        cta: {
          type: "useVerifiedSupplierDetails",
          label: "Använd tidigare uppgifter",
          supplierInvoiceId: s.id,
          account: prev.account,
        },
        secondary: { label: "Kontrollera dokument", href },
        amount: s.amount,
        confirm: {
          title: "Använd tidigare verifierade uppgifter?",
          rows: [
            { label: "Leverantör", value: s.supplier },
            { label: "Konto", value: prev.account },
            { label: "Verifierat via", value: verifiedVia },
            { label: "Belopp", value: kr(s.amount) },
          ],
          confirmLabel: "Använd tidigare uppgifter",
        },
      },
      queueItem: { ...base, action: { kind: "reuse", account: prev.account, verifiedVia } },
    };
  }

  if (uncertain) {
    const candidate = details.candidate ?? {};
    return {
      order: -s.amount,
      action: {
        id: `supplier-verify-${s.id}`,
        priority: "action",
        category: "supplier",
        icon: "bank",
        title: `Kontrollera betalningsuppgifter för ${s.supplier}`,
        subtitle: `${kr(s.amount)} · ${due}${candidate.account ? ` · läst ur dokumentet: ${candidate.account}` : ""}`,
        href,
        cta: {
          type: "verifyPaymentDetails",
          label: "Kontrollera",
          supplierInvoiceId: s.id,
          ...(candidate.account ? { candidateAccount: candidate.account } : {}),
          ...(candidate.ocr ? { candidateOcr: candidate.ocr } : {}),
        },
        secondary: { label: "Visa dokumentet", href },
        amount: s.amount,
      },
      queueItem: {
        ...base,
        action: {
          kind: "verify",
          ...(candidate.account ? { candidateAccount: candidate.account } : {}),
          ...(candidate.ocr ? { candidateOcr: candidate.ocr } : {}),
        },
      },
    };
  }

  const request = supplierDetailsRequestInfo(s);
  if (!request.possible || !request.to || !request.subject || !request.message) return null;
  return {
    order: -s.amount,
    action: {
      id: `supplier-bank-${s.id}`,
      priority: "action",
      category: "supplier",
      icon: "bank",
      title: `Betalningsuppgifter saknas – ${s.supplier}`,
      subtitle: `${kr(s.amount)} · ${s.invoiceNumber} · Driva kan be leverantören komplettera`,
      href,
      cta: { type: "requestSupplierDetails", label: "Be leverantören", supplierInvoiceId: s.id, to: request.to },
      secondary: { label: "Lägg till själv", href },
      amount: s.amount,
      confirm: {
        title: "Be leverantören om betalningsuppgifter?",
        rows: [
          { label: "Till", value: request.to },
          { label: "Faktura", value: `${s.invoiceNumber} · ${kr(s.amount)}` },
          { label: "Meddelande", value: request.message.split("\n\n")[1] ?? request.subject },
        ],
        confirmLabel: "Skicka",
      },
    },
    queueItem: { ...base, action: { kind: "request", to: request.to, subject: request.subject, message: request.message } },
  };
}

/** Få rader: visa var för sig. Många likadana: EN grupprad med fokuserad kö. */
function emitDetailCases(ranked: Ranked[], cases: DetailCase[]) {
  if (cases.length < PAYMENT_DETAILS_GROUP_THRESHOLD) {
    for (const c of cases) ranked.push({ rank: RANK.supplierOverdue, order: c.order, action: c.action });
    return;
  }
  const items = [...cases].sort((a, b) => b.queueItem.amount - a.queueItem.amount).map((c) => c.queueItem);
  const total = items.reduce((sum, i) => sum + i.amount, 0);
  ranked.push({
    rank: RANK.supplierOverdue,
    order: -total,
    action: {
      id: "supplier-details-group",
      priority: "action",
      category: "supplier",
      icon: "bank",
      title: `${items.length} leverantörsfakturor behöver betalningsuppgifter`,
      subtitle: `${items.map((i) => i.supplier).join(" · ")} · totalt ${kr(total)}`,
      href: "/ekonomi?flik=utgifter",
      cta: { type: "paymentDetailsQueue", label: "Hantera", items },
      amount: total,
    },
  });
}

function collectSuppliers(ranked: Ranked[], watching: WatchingItem[], now: Date) {
  const detailCases: DetailCase[] = [];

  for (const s of db().supplierInvoices) {
    const payment = latestPaymentForInvoice(s.id);
    const href = s.inboxItemId ? `/inbox/${s.inboxItemId}` : `/ekonomi?flik=utgifter&atgard=${encodeURIComponent(`supplier-${s.id}`)}`;

    if (payment?.status === "FAILED") {
      const remaining = remainingAmountForInvoice(s);
      ranked.push({
        rank: RANK.supplierOverdue,
        order: -s.amount,
        action: {
          id: `supplier-fail-${s.id}`,
          priority: "urgent",
          category: "supplier",
          icon: "alert",
          title: `Betalningen till ${s.supplier} misslyckades`,
          subtitle: `${kr(remaining || payment.amount)}${payment.failureReason ? ` · ${payment.failureReason}` : ""}`,
          href,
          cta: { type: "createPaymentFile", label: "Skapa ny bankfil", supplierInvoiceId: s.id },
          amount: remaining || payment.amount,
          confirm: {
            title: "Skapa ny bankfil?",
            rows: supplierPaymentConfirmRows(payment, s),
            confirmLabel: "Skapa bankfil",
          },
        },
      });
      continue;
    }

    const details = s.status === "betald" ? undefined : paymentDetailsInfo(s);

    // D. Ändrad destination – högriskundantag som ALDRIG godkänns automatiskt.
    if (details && (details.cause === "CHANGED" || payment?.destinationChanged)) {
      const previousAccount = details.previous?.account ?? "tidigare verifierat konto";
      const newAccount = details.account ?? payment?.recipientAccount ?? "—";
      ranked.push({
        rank: RANK.supplierOverdue,
        order: -s.amount,
        action: {
          id: `supplier-dest-${s.id}`,
          priority: "urgent",
          category: "supplier",
          icon: "alert",
          title: `${s.supplier} har nya betalningsuppgifter`,
          subtitle: `Tidigare: ${previousAccount} · Ny faktura: ${newAccount} · kontrollera uppgifterna innan betalning`,
          href,
          cta: {
            type: "confirmChangedSupplierDetails",
            label: "Kontrollera uppgifterna",
            supplierInvoiceId: s.id,
            previousAccount,
            newAccount,
          },
          secondary: { label: "Visa dokumentet", href },
          amount: s.amount,
          confirm: {
            title: "Godkänn nya betalningsuppgifter?",
            rows: [
              { label: "Leverantör", value: s.supplier },
              { label: "Tidigare verifierat", value: previousAccount },
              { label: "Ny faktura", value: newAccount },
              { label: "Belopp", value: kr(s.amount) },
            ],
            confirmLabel: "Uppgifterna stämmer – godkänn",
          },
        },
      });
      continue;
    }

    if (details && s.accountingStatus === "bokford") {
      // Förfrågan skickad → inte en aktiv åtgärd; Driva bevakar tills svar kommer.
      if (details.cause === "AWAITING_SUPPLIER") {
        const sentAt = details.request?.sentAt ?? s.createdAt;
        watching.push({
          id: `supplier-await-${s.id}`,
          category: "supplier",
          title: `Väntar på betalningsuppgifter från ${s.supplier}`,
          subtitle: `${kr(s.amount)} · ${s.invoiceNumber} · frågan skickades ${datumKort(sentAt)}`,
          href,
          date: sentAt.slice(0, 10),
          amount: s.amount,
        });
        continue;
      }
      if (details.cause === "EXTRACTION_UNCERTAIN" || details.cause === "MISSING") {
        const kase = detailCaseFor(s, details, href);
        if (kase) detailCases.push(kase);
        continue;
      }
    }

    if (payment && isPaymentInFlight(payment.status)) {
      watching.push({
        id: `supplier-pay-${s.id}`,
        category: "supplier",
        title: `${s.supplier} · ${kr(payment.amount)}`,
        subtitle: `Betalas ${datumKort(payment.scheduledDate)}`,
        href,
        date: payment.scheduledDate.slice(0, 10),
        amount: payment.amount,
      });
      continue;
    }

    if (isReadyToApproveNow({ invoice: s, payment, now })) {
      // V1: primäråtgärden är [Skapa bankfil] (pain.001) – aldrig ett påstått
      // "skickat till bank". Bekräftelsen visar exakt vad som betalas varifrån.
      const amount = payment?.amount ?? (remainingAmountForInvoice(s) || s.amount);
      const account = payment?.recipientAccount ?? details?.account;
      const ocr = payment?.ocr ?? s.ocr;
      const payer = payerAccountLabel();
      ranked.push({
        rank: RANK.supplierOverdue,
        order: -s.amount,
        action: {
          id: `supplier-${s.id}`,
          priority: "action",
          category: "supplier",
          icon: "invoice",
          title: `${s.supplier} är redo att betalas`,
          subtitle: `${kr(amount)} · förfaller ${datumKort(s.dueDate)} · bokförd`,
          href,
          cta: { type: "createPaymentFile", label: "Skapa bankfil", supplierInvoiceId: s.id },
          amount,
          confirm: {
            title: `Betala ${s.supplier}?`,
            rows: [
              { label: "Belopp", value: kr(amount) },
              { label: "Förfallodatum", value: datumKort(s.dueDate) },
              ...(account ? [{ label: paymentMethodLabel(guessPaymentMethod(account)), value: account }] : []),
              ...(ocr ? [{ label: "OCR", value: ocr }] : []),
              ...(payer ? [{ label: "Från", value: `${db().settings.name}, ${payer}` }] : []),
            ],
            confirmLabel: "Skapa bankfil",
          },
        },
      });
    }
  }

  emitDetailCases(ranked, detailCases);
}

function collectInboxMail(ranked: Ranked[]) {
  for (const item of db().inboxItems ?? []) {
    const invoice = item.supplierInvoiceId
      ? db().supplierInvoices.find((s) => s.id === item.supplierInvoiceId)
      : undefined;
    const payment = item.supplierInvoiceId ? latestPaymentForInvoice(item.supplierInvoiceId) : undefined;
    if (payment?.status === "FAILED" || payment?.destinationChanged) continue;
    // Ändrad destination har redan en egen högprioriterad rad (supplier-dest-).
    if (invoice && invoice.status !== "betald" && paymentDetailsInfo(invoice).cause === "CHANGED") continue;
    if (invoice && isReadyToApproveNow({ invoice, payment })) continue;

    const needsReview =
      item.status === "ny" &&
      (!amountIsCertain(item) ||
        (item.documentType !== "kvitto" && !item.supplierInvoiceId) ||
        (invoice && invoice.accountingStatus !== "bokford"));
    if (!needsReview) continue;

    const href = `/inbox/${item.id}`;
    const amountReview = needsAmountReview(item);
    const who = item.parsedSupplier ?? (item.subject || "dokument");
    const docWord = item.documentType === "kvitto" ? "kvittot" : "fakturan";
    ranked.push({
      rank: RANK.newJob,
      order: -(Date.parse(item.createdAt) || 0),
      action: {
        id: `inbox-mail-${item.id}`,
        priority: "action",
        category: "accounting",
        icon: "inbox",
        title: amountReview
          ? `Kontrollera belopp för ${who}-${docWord}`
          : `Granska ${item.documentType === "kvitto" ? "kvitto" : "faktura"} från ${item.parsedSupplier ?? item.fromAddress}`,
        subtitle:
          amountReview && item.parsedAmount != null
            ? `Läst ${kr(item.parsedAmount)} – behöver kontroll mot dokumentet.`
            : item.parsedAmount != null
              ? `${kr(item.parsedAmount)} · ${excerpt(item.textBody)}`
              : excerpt(item.textBody),
        href,
        cta: amountReview
          ? { type: "link", label: "Kontrollera", href: `/inbox/${item.id}/kontrollera` }
          : { type: "link", label: "Öppna i inboxen", href },
        secondary: { label: "Visa posten", href },
      },
    });
  }
}

function excerpt(text: string, max = 80): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/* ---------------------------------- Moms -------------------------------------- */

function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(`${toDate}T12:00:00Z`) - Date.parse(`${fromDate}T12:00:00Z`)) / 86_400_000);
}

function collectVat(ranked: Ranked[], watching: WatchingItem[], now: Date) {
  const data = db();
  const today = bokforingsdatum(now.toISOString());
  const year = Number(today.slice(0, 4));

  const overdue: { period: Period; amount: number; refund: boolean; dueDate: string; daysTo: number }[] = [];

  for (const y of [year - 1, year]) {
    for (const period of quartersOf(calendarFiscalYear(y))) {
      if (period.start > today) continue; // framtida period
      const report = data.vatReports.find((r) => r.periodStart === period.start && r.periodEnd === period.end);
      if (report?.status === "deklarerad") continue;
      const pos = computeVatPosition(period);
      if (pos.utgaende === 0 && pos.ingaende === 0 && pos.attBetala === 0) continue; // ingen momsaktivitet
      const dueDate = vatDueDate(period);
      const amount = Math.abs(pos.attBetala);
      const refund = pos.attBetala < 0;

      const daysTo = daysBetween(today, dueDate);
      if (period.end >= today || daysTo > VAT_ATTENTION_DAYS) {
        // Pågående period eller deadline längre bort än åtgärdströskeln:
        // På gång bara när deadline är nära nog att vara relevant.
        if (daysTo >= 0 && daysTo <= WATCHING.vatDays) {
          watching.push({
            id: `vat-${period.key}`,
            category: "vat",
            title: `Moms ${kr(amount)}${refund ? " tillbaka" : ""}`,
            subtitle: `${period.label} · deklareras senast ${datumKort(dueDate)}`,
            href: "/bokforing/moms",
            date: dueDate,
            amount,
          });
        }
        continue;
      }
      overdue.push({ period, amount, refund, dueDate, daysTo });
    }
  }

  if (overdue.length === 0) return;

  const worst = overdue.reduce((a, b) => (a.daysTo <= b.daysTo ? a : b));
  // Passerad deklarationsdeadline är ett lagkrav (förseningsavgifter) och
  // rankas över sena kundfakturor; en deadline som bara närmar sig är urgent
  // men ligger kvar under betalningsproblemen.
  const passed = worst.daysTo < 0;
  const urgent = worst.daysTo <= VAT_URGENT_DAYS;
  const rank = passed ? RANK.vatOverdue : urgent ? RANK.vatUrgent : RANK.vatSoon;

  if (overdue.length === 1) {
    const { period, amount, refund, dueDate, daysTo } = overdue[0];
    ranked.push({
      rank,
      order: daysTo,
      action: {
        id: `vat-${period.key}`,
        priority: urgent ? "urgent" : "action",
        category: "vat",
        icon: "calendar",
        title:
          daysTo < 0
            ? `Momsen för ${period.label} skulle ha deklarerats ${datumKort(dueDate)}`
            : `Moms ska deklareras ${relativ(dueDate)}`,
        subtitle: `${period.label} · ${kr(amount)} ${refund ? "att få tillbaka" : "att betala"}`,
        href: "/bokforing/moms",
        cta: { type: "link", label: "Öppna momsöversikten", href: "/bokforing/moms" },
        amount,
      },
    });
    return;
  }

  const net = overdue.reduce((s, p) => s + (p.refund ? -p.amount : p.amount), 0);
  ranked.push({
    rank,
    order: worst.daysTo,
    action: {
      id: "vat-multiple",
      priority: urgent ? "urgent" : "action",
      category: "vat",
      icon: "calendar",
      title: `${overdue.length} momsperioder väntar på deklaration`,
      subtitle: `${overdue.map((p) => p.period.label).join(", ")} · ${kr(Math.abs(net))} ${
        net < 0 ? "att få tillbaka" : "att betala"
      }`,
      href: "/bokforing/moms",
      cta: { type: "link", label: "Öppna momsöversikten", href: "/bokforing/moms" },
      amount: Math.abs(net),
    },
  });
}
