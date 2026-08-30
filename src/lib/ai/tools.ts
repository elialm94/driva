import { db } from "../store";
import { uid } from "../ids";
import { kr } from "../format";
import type { AssistantCard, Customer, Job, Reminder, ReminderRelatedType } from "../types";
import {
  DAYPARTS,
  WEEKDAYS_SV,
  formatDueAt,
  formatDueAtDisplay,
  resolveWhen,
  type Daypart,
  type WeekdaySv,
  type WhenExpression,
} from "../reminders/when";
import {
  businessTimezone,
  completeReminder,
  createReminder,
  describeReminderDue,
  dismissReminder,
  reminderTargetHref,
  searchReminders,
  snoozeReminder,
  updateReminder,
} from "../services/reminders";
import { getBusinessActions, type BusinessAction } from "../services/actions";
import { controlsForAction } from "../services/action-issue";
import { snoozeAttentionUntil } from "../services/attention-state";
import { listInbox } from "../services/inbox";
import type { AiToolDef } from "./provider";
import { isInternalReminderIntent } from "./utterance";
import { validateToolArgs } from "./validate";
import { resolveCustomerName } from "./resolve";
import {
  ambiguousCustomers,
  compactCustomer,
  compactInvoice,
  compactJob,
  compactQuote,
  companyStatusResult,
  businessProfileResult,
  requestUpdateBusinessProfile,
  createCustomerDirect,
  createFinalInvoiceDraft,
  createInvoiceDraft,
  createJobDraft,
  completeJobDraft,
  createJobInvoiceDraft,
  createQuoteDraft,
  reopenJobDraft,
  requestDeleteOrArchiveJob,
  registerJobTimeDraft,
  addJobMaterialDraft,
  listSupplierInvoicesResult,
  getSupplierInvoiceResult,
  prepareSupplierPaymentResult,
  requestSubmitSupplierPayment,
  requestCancelSupplierPayment,
  requestUseVerifiedSupplierDetails,
  reviewDocumentExtractionResult,
  updateSupplierInvoiceFieldResult,
  requestGeneratePaymentFile,
  getPaymentStatusResult,
  missingReceiptsResult,
  momsResult,
  offerCreateCustomer,
  proposeInvoiceForCustomer,
  proposeExtraFromNotes,
  requestBookExpense,
  requestFollowUpQuotes,
  requestGenerateWebsite,
  requestPublishWebsite,
  requestRemindLate,
  requestSendInvoice,
  requestSendQuote,
  spendingRoomResult,
  todayAttentionResult,
  watchingResult,
  unpaidInvoicesResult,
  checkDomainAvailabilityResult,
  getDomainStatusResult,
  requestPurchaseDomain,
  type DomainResult,
} from "./domain";
import { currentVersion, daysOverdue, getCustomer, getInvoice, getJob, getQuote, invoiceTotals, isOverdue, requireCustomer } from "../services/data";
import { answerExpenseQuestion } from "../services/expenses";
import { setJobStatus } from "../services/jobs";
import {
  balansRapportResult,
  bokforingStatusResult,
  bokslutStatusResult,
  forklaraVerifikationResult,
  momsRapportResult,
  requestCloseFiscalYear,
  requestMarkVatDeclared,
  requestRunBokslutAutomation,
  requestCorrectVerification,
  requestUndoExpense,
  resultatRapportResult,
} from "./accounting-domain";

export type ToolResult = {
  ok: boolean;
  forModel: Record<string, unknown>;
  error?: string;
  text?: string;
  card?: AssistantCard;
  requiresConfirmation?: boolean;
  /** One-shot SAFE_WRITE: klienten kan ångra utan bekräftelsekort. */
  undo?: { kind: "dismiss_reminder"; id: string };
};

export type AccountantToolScope = "current" | "all_clients";

export type ExecuteToolOptions = {
  origin?: "user" | "ai";
  actorUserId?: string;
  actorRole?: import("../types").BusinessRole;
  businessId?: string;
  /** Server-satt – aldrig från modellens argument. */
  accountantScope?: AccountantToolScope;
};

type ToolHandler = (args: Record<string, unknown>, options?: ExecuteToolOptions) => ToolResult | Promise<ToolResult>;

/**
 * Riskklass per verktyg – deklarerad och SERVERSIDIGT upprätthållen:
 *   READ_ONLY         läser, ändrar inget
 *   SAFE_WRITE        skapar utkast/ofarliga ändringar – skickar aldrig något
 *   CONFIRM_REQUIRED  handlern skapar ENDAST ett bekräftelsekort (pendingAction);
 *                     själva åtgärden körs bara via användarens uttryckliga
 *                     bekräftelse – aldrig av en modell
 *   FORBIDDEN_FOR_AI  får aldrig anropas av en modell oavsett vad den ber om;
 *                     exponeras inte i modellens verktygslista och blockeras
 *                     dessutom i executeTool för origin "ai". Deterministiska
 *                     användarflöden (origin "user") påverkas inte.
 */
export type ToolRisk = "READ_ONLY" | "SAFE_WRITE" | "CONFIRM_REQUIRED" | "FORBIDDEN_FOR_AI";

type ToolSpec = {
  def: AiToolDef;
  risk: ToolRisk;
  requiresConfirmation: boolean;
  handler: ToolHandler;
};

function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function num(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(/\s/g, "").replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function fromDomain(r: DomainResult, requiresConfirmation = false): ToolResult {
  return {
    ok: r.ok,
    forModel: r.forModel,
    error: r.ok ? undefined : r.text,
    text: r.text,
    card: r.card,
    requiresConfirmation,
  };
}

function resolveOrAsk(name: string, resume?: Parameters<typeof offerCreateCustomer>[1]): ToolResult | { customer: Customer } {
  const match = resolveCustomerName(name);
  if (match.kind === "none") return fromDomain(offerCreateCustomer(match.query, resume));
  if (match.kind === "many") return fromDomain(ambiguousCustomers(match.query, match.customers));
  return { customer: match.customer };
}

function obj(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

/* ------------------------------- Påminnelser ------------------------------- */

/**
 * Platta, striktvaliderade verktygsargument → strukturerat tidsuttryck.
 * Returnerar undefined när inga tidsfält alls angavs (så att update kan
 * lämna tiden orörd) och ett fel när kombinationen är obegriplig.
 */
function whenFromArgs(args: Record<string, unknown>): WhenExpression | { error: string } | undefined {
  const whenIso = str(args, "whenIso");
  const whenDate = str(args, "whenDate");
  const weekday = str(args, "weekday") as WeekdaySv | undefined;
  const time = str(args, "time");
  const daypart = str(args, "daypart") as Daypart | undefined;
  const minutes = num(args, "relativeMinutes");
  const hours = num(args, "relativeHours");
  const days = num(args, "relativeDays");

  if (minutes !== undefined || hours !== undefined || days !== undefined) {
    return { kind: "relative", minutes, hours, days };
  }
  if (weekday) return { kind: "weekday", weekday, nextWeek: args.nextWeek === true, time, daypart };
  if (whenDate) return { kind: "date", date: whenDate, time, daypart };
  if (whenIso) {
    // Klockslag/dagsdel vid sidan av ISO-strängen respekteras (datumdelen används).
    if (time || daypart) return { kind: "date", date: whenIso.slice(0, 10), time, daypart };
    return { kind: "isoDateTime", value: whenIso };
  }
  if (daypart) return { kind: "daypart", daypart };
  if (time) return { error: "Ett klockslag behöver också en dag (t.ex. whenDate eller weekday)." };
  return undefined;
}

function compactReminder(r: Reminder) {
  return {
    id: r.id,
    title: r.title,
    due: r.dueAt ? formatDueAt(r.dueAt, r.timezone, r.hasExplicitTime) : "Ingen tid",
    ...(r.dueAt ? { dueAt: r.dueAt } : {}),
    hasExplicitTime: r.hasExplicitTime,
    status: r.status,
    ...(r.snoozedUntil ? { snoozedUntil: r.snoozedUntil } : {}),
    ...(r.relatedEntityType ? { related: { type: r.relatedEntityType, id: r.relatedEntityId } } : {}),
  };
}

/** Unik träff → påminnelsen. Ingen/flera → färdigt ToolResult (fråga, aldrig gissa). */
function findReminderOrAsk(query: string): { reminder: Reminder } | { result: ToolResult } {
  if (!query) return { result: { ok: false, forModel: {}, error: "query krävs" } };
  const matches = searchReminders(query);
  if (matches.length === 1) return { reminder: matches[0] };
  if (matches.length === 0) {
    return {
      result: {
        ok: false,
        forModel: { reminders: [], count: 0 },
        error: `Ingen aktiv påminnelse matchar "${query}".`,
      },
    };
  }
  return {
    result: {
      ok: true,
      forModel: { reminders: matches.slice(0, 8).map(compactReminder), count: matches.length },
      text: `${matches.length} påminnelser matchar "${query}" – vilken menar du?`,
      card: {
        kind: "list",
        title: "Vilken påminnelse?",
        rows: matches.slice(0, 8).map((r) => ({ label: r.title, value: describeReminderDue(r).text })),
      },
    },
  };
}

/**
 * Fritextsök bland uppmärksamhetsraderna (samma motor som Hem). Alla ord
 * måste träffa rubrik+underrubrik – "sena fakturan brf eken" hittar raden.
 * Snoozade rader är exkluderade (default-semantiken) – de "finns inte" just nu.
 */
function searchAttention(query: string): BusinessAction[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  return getBusinessActions().attention.filter((a) => {
    const hay = `${a.title} ${a.subtitle}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}

/** Unik träff → åtgärdsraden. Ingen/flera → färdigt ToolResult (fråga, aldrig gissa). */
function findAttentionOrAsk(query: string): { action: BusinessAction } | { result: ToolResult } {
  if (!query) return { result: { ok: false, forModel: {}, error: "query krävs" } };
  const matches = searchAttention(query);
  if (matches.length === 1) return { action: matches[0] };
  if (matches.length === 0) {
    return {
      result: {
        ok: false,
        forModel: { actions: [], count: 0 },
        error: `Ingen rad under Behöver din uppmärksamhet matchar "${query}".`,
      },
    };
  }
  return {
    result: {
      ok: true,
      forModel: {
        actions: matches.slice(0, 8).map((a) => ({ id: a.id, title: a.title, subtitle: a.subtitle })),
        count: matches.length,
      },
      text: `${matches.length} rader matchar "${query}" – vilken menar du?`,
      card: {
        kind: "list",
        title: "Vilken rad?",
        rows: matches.slice(0, 8).map((a) => ({ label: a.title, value: a.subtitle, href: a.href })),
      },
    },
  };
}

/**
 * Entitetskoppling: exakt EN träff kopplas, flera → klargörande (skapar
 * inget), noll → ren textpåminnelse (gissar aldrig).
 */
function resolveReminderLink(
  type: string | undefined,
  query: string | undefined
):
  | { related?: { type: ReminderRelatedType; id: string }; relatedLabel?: string; note?: string }
  | { ask: ToolResult } {
  if (!type || !query) return {};
  const data = db();
  const numberIn = (s: string): number | undefined => {
    const m = /(\d+)/.exec(s);
    return m ? Number(m[1]) : undefined;
  };
  switch (type) {
    case "customer": {
      const match = resolveCustomerName(query);
      if (match.kind === "one")
        return { related: { type: "customer", id: match.customer.id }, relatedLabel: match.customer.name };
      if (match.kind === "many") return { ask: fromDomain(ambiguousCustomers(match.query, match.customers)) };
      return { note: `Ingen kund matchade "${query}" – påminnelsen sparas utan koppling.` };
    }
    case "quote": {
      const n = numberIn(query);
      const quote = n !== undefined ? data.quotes.find((q) => q.number === n) : undefined;
      if (quote) return { related: { type: "quote", id: quote.id }, relatedLabel: `offert #${quote.number}` };
      return { note: `Ingen offert matchade "${query}" – påminnelsen sparas utan koppling.` };
    }
    case "invoice": {
      const n = numberIn(query);
      const invoice = n !== undefined ? data.invoices.find((i) => i.number === n) : undefined;
      if (invoice)
        return { related: { type: "invoice", id: invoice.id }, relatedLabel: `faktura #${invoice.number}` };
      return { note: `Ingen faktura matchade "${query}" – påminnelsen sparas utan koppling.` };
    }
    case "job": {
      const q = query.toLowerCase();
      const jobs = data.jobs.filter((j) => j.title.toLowerCase().includes(q));
      if (jobs.length === 1) return { related: { type: "job", id: jobs[0].id }, relatedLabel: jobs[0].title };
      if (jobs.length > 1) {
        return {
          ask: {
            ok: true,
            forModel: { jobs: jobs.slice(0, 8).map(compactJob), count: jobs.length },
            text: `${jobs.length} uppdrag matchar "${query}" – vilket menar du?`,
            card: {
              kind: "list",
              title: "Vilket uppdrag?",
              rows: jobs.slice(0, 8).map((j) => ({ label: j.title, href: `/uppdrag/${j.id}` })),
            },
          },
        };
      }
      return { note: `Inget uppdrag matchade "${query}" – påminnelsen sparas utan koppling.` };
    }
    default:
      return {};
  }
}

function formatReminderWhenText(reminder: Reminder): string {
  if (!reminder.dueAt) return "Ingen tid";
  return formatDueAtDisplay(reminder.dueAt, reminder.timezone, reminder.hasExplicitTime);
}

function handleCreateReminder(args: Record<string, unknown>): ToolResult {
  const title = str(args, "title");
  if (!title) return { ok: false, forModel: {}, error: "title krävs" };
  const when = whenFromArgs(args);
  if (when && "error" in when) return { ok: false, forModel: {}, error: when.error };

  const link = resolveReminderLink(str(args, "relatedType"), str(args, "relatedQuery"));
  if ("ask" in link) return link.ask; // klargörande – inget skapas

  const created = createReminder({
    title,
    description: str(args, "description"),
    when: when && !("error" in when) ? when : { kind: "none" },
    source: "assistant",
    related: link.related,
  });
  if (!created.ok) return { ok: false, forModel: {}, error: created.error };

  const reminder = created.reminder;
  const dueDisplay = formatReminderWhenText(reminder);
  const parts = [
    reminder.dueAt ? `Påminnelse skapad till ${dueDisplay}.` : `Påminnelse skapad – ${dueDisplay}.`,
  ];
  if (link.relatedLabel) parts.push(`Kopplad till ${link.relatedLabel}.`);
  if (link.note) parts.push(link.note);
  return {
    ok: true,
    forModel: { reminder: compactReminder(reminder) },
    text: parts.join(" "),
    card: {
      kind: "list",
      title: "Påminnelse skapad",
      rows: [{ label: reminder.title, value: dueDisplay, href: reminderTargetHref(reminder) }],
    },
    undo: { kind: "dismiss_reminder", id: reminder.id },
  };
}

const specs: ToolSpec[] = [
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "find_customers",
        description: "Hitta kunder på namn (find customers by name). Returnerar 0, 1 eller flera.",
        parameters: obj({ name: { type: "string", description: "Namn eller del av namn" } }, ["name"]),
      },
    },
    handler: (args) => {
      const name = str(args, "name");
      if (!name) return { ok: false, forModel: {}, error: "name krävs" };
      const match = resolveCustomerName(name);
      if (match.kind === "none") return fromDomain(offerCreateCustomer(match.query));
      if (match.kind === "many") return fromDomain(ambiguousCustomers(match.query, match.customers));
      return {
        ok: true,
        forModel: { customers: [compactCustomer(match.customer)] },
        text: `Hittade ${match.customer.name}.`,
        card: {
          kind: "entity",
          entity: "kund",
          title: match.customer.name,
          href: `/kunder/${match.customer.id}`,
          openLabel: "Öppna kund",
          subtitle: match.customer.city,
        },
      };
    },
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "get_customer",
        description: "Hämta en kund via id (get customer by id).",
        parameters: obj({ customerId: { type: "string" } }, ["customerId"]),
      },
    },
    handler: (args) => {
      const id = str(args, "customerId");
      const c = id ? getCustomer(id) : undefined;
      if (!c) return { ok: false, forModel: {}, error: "Kunden finns inte" };
      const jobs = db().jobs.filter((j) => j.customerId === c.id).map(compactJob);
      return { ok: true, forModel: { customer: compactCustomer(c), jobs } };
    },
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "list_inbox",
        description:
          "Lista inboxen: inkommande leverantörsfakturor, kvitton och ekonomiska dokument. Inte samma lista som Behöver din uppmärksamhet på Hem.",
        parameters: obj({ q: { type: "string", description: "Valfritt sökord" } }),
      },
    },
    handler: (args) => {
      const q = str(args, "q");
      const page = listInbox({ q, filter: "oppna", page: 1, pageSize: 20 });
      return {
        ok: true,
        forModel: { count: page.total, items: page.rows },
        text: page.total === 0 ? "Inget öppet i inboxen." : `${page.total} öppna poster i inboxen.`,
        card:
          page.rows.length === 0
            ? undefined
            : {
                kind: "list" as const,
                title: "Inbox",
                rows: page.rows.map((r) => ({
                  label: r.documentLabel,
                  value: r.fromLabel,
                  href: `/inbox/${r.id}`,
                })),
                links: [{ label: "Öppna inboxen", href: "/inbox" }],
              },
      };
    },
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "list_supplier_invoices",
        description: "Lista leverantörsfakturor (list supplier invoices). Samma objekt som i Inbox och Ekonomi.",
        parameters: obj({ q: { type: "string", description: "Valfritt sökord: leverantör, fakturanummer, OCR" } }),
      },
    },
    handler: (args) => fromDomain(listSupplierInvoicesResult(str(args, "q"))),
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "get_supplier_invoice",
        description: "Hämta en leverantörsfaktura (get supplier invoice).",
        parameters: obj({ invoiceId: { type: "string" } }, ["invoiceId"]),
      },
    },
    handler: (args) => {
      const id = str(args, "invoiceId");
      if (!id) return { ok: false, forModel: {}, error: "invoiceId krävs" };
      return fromDomain(getSupplierInvoiceResult(id));
    },
  },
  {
    requiresConfirmation: false,
    risk: "SAFE_WRITE",
    def: {
      type: "function",
      function: {
        name: "prepare_supplier_payment",
        description:
          "Förbered leverantörsbetalning (prepare supplier payment). Skapar instruktion, skickar ALDRIG till bank.",
        parameters: obj(
          {
            invoiceId: { type: "string" },
            scheduledDate: { type: "string", description: "YYYY-MM-DD, default förfallodatum" },
          },
          ["invoiceId"]
        ),
      },
    },
    handler: (args) => {
      const id = str(args, "invoiceId");
      if (!id) return { ok: false, forModel: {}, error: "invoiceId krävs" };
      return fromDomain(prepareSupplierPaymentResult(id, str(args, "scheduledDate")));
    },
  },
  {
    requiresConfirmation: true,
    risk: "CONFIRM_REQUIRED",
    def: {
      type: "function",
      function: {
        name: "submit_supplier_payment",
        description:
          "Be om bekräftelse att skicka leverantörsbetalning till banken. Skickar INTE själv – visar bekräftelsekort med mottagare och konto.",
        parameters: obj({ paymentId: { type: "string" } }, ["paymentId"]),
      },
    },
    handler: (args) => {
      const id = str(args, "paymentId");
      if (!id) return { ok: false, forModel: {}, error: "paymentId krävs" };
      return fromDomain(requestSubmitSupplierPayment(id), true);
    },
  },
  {
    requiresConfirmation: true,
    risk: "CONFIRM_REQUIRED",
    def: {
      type: "function",
      function: {
        name: "cancel_supplier_payment",
        description: "Be om bekräftelse att avbryta en förberedd eller skickad leverantörsbetalning. Avbryter inte själv.",
        parameters: obj({ paymentId: { type: "string" } }, ["paymentId"]),
      },
    },
    handler: (args) => {
      const id = str(args, "paymentId");
      if (!id) return { ok: false, forModel: {}, error: "paymentId krävs" };
      return fromDomain(requestCancelSupplierPayment(id), true);
    },
  },
  {
    requiresConfirmation: true,
    risk: "CONFIRM_REQUIRED",
    def: {
      type: "function",
      function: {
        name: "use_verified_supplier_details",
        description:
          "Komplettera en leverantörsfaktura som saknar betalningsuppgifter med leverantörens TIDIGARE VERIFIERADE uppgifter (use previously verified supplier payment details). Uppgifterna hämtas ur domänen – ange aldrig konto själv. Visar bekräftelsekort; utför inget utan användarens godkännande.",
        parameters: obj({ invoiceId: { type: "string", description: "Leverantörsfakturans id" } }, ["invoiceId"]),
      },
    },
    handler: (args) => {
      const id = str(args, "invoiceId");
      if (!id) return { ok: false, forModel: {}, error: "invoiceId krävs" };
      return fromDomain(requestUseVerifiedSupplierDetails(id), true);
    },
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "review_document_extraction",
        description:
          "Visa vad Driva läst ur ett inkommande dokument (review document extraction): fält för fält med läge Säker/Kontrollera. Godkännandet görs av användaren i Kontrollera-vyn – verktyget ändrar inget.",
        parameters: obj({ itemId: { type: "string", description: "Inboxpostens id" } }, ["itemId"]),
      },
    },
    handler: (args) => {
      const id = str(args, "itemId");
      if (!id) return { ok: false, forModel: {}, error: "itemId krävs" };
      return fromDomain(reviewDocumentExtractionResult(id));
    },
  },
  {
    requiresConfirmation: false,
    risk: "SAFE_WRITE",
    def: {
      type: "function",
      function: {
        name: "update_supplier_invoice_field",
        description:
          "Uppdatera ETT säkert fält på en leverantörsfaktura (update supplier invoice field): description, dueDate (YYYY-MM-DD) eller invoiceNumber. Belopp rättas via bokföringen och betalningsuppgifter via kontrollflödet – hitta ALDRIG på bankgiro/konto.",
        parameters: obj(
          {
            invoiceId: { type: "string" },
            field: { type: "string", enum: ["description", "dueDate", "invoiceNumber"] },
            value: { type: "string" },
          },
          ["invoiceId", "field", "value"]
        ),
      },
    },
    handler: (args) => {
      const id = str(args, "invoiceId");
      const field = str(args, "field");
      const value = str(args, "value");
      if (!id || !field || value == null) return { ok: false, forModel: {}, error: "invoiceId, field och value krävs" };
      return fromDomain(updateSupplierInvoiceFieldResult(id, field, value));
    },
  },
  {
    requiresConfirmation: true,
    risk: "CONFIRM_REQUIRED",
    def: {
      type: "function",
      function: {
        name: "generate_payment_file",
        description:
          "Be om bekräftelse att skapa en bankfil (pain.001) för en eller flera BOKFÖRDA leverantörsfakturor med verifierade betalningsuppgifter. Skapar INTE filen själv – visar bekräftelsekort. Filen laddas upp manuellt i internetbanken; skapad fil betyder varken skickad eller betald.",
        parameters: obj(
          {
            invoiceIds: {
              type: "array",
              items: { type: "string" },
              description: "Leverantörsfakturornas id:n (en fil kan bära flera betalningar)",
            },
          },
          ["invoiceIds"]
        ),
      },
    },
    handler: (args) => {
      const raw = args.invoiceIds;
      const ids = Array.isArray(raw) ? raw.map((v) => String(v)).filter(Boolean) : [];
      if (ids.length === 0) return { ok: false, forModel: {}, error: "invoiceIds krävs" };
      return fromDomain(requestGeneratePaymentFile(ids), true);
    },
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "get_payment_status",
        description:
          "Betalningsstatus för en leverantörsfaktura (get payment status): bokförd/ej, redo att betala, bankfil skapad, betald, avstämd – och exakta hinder om något blockerar.",
        parameters: obj({ invoiceId: { type: "string" } }, ["invoiceId"]),
      },
    },
    handler: (args) => {
      const id = str(args, "invoiceId");
      if (!id) return { ok: false, forModel: {}, error: "invoiceId krävs" };
      return fromDomain(getPaymentStatusResult(id));
    },
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "list_assignments",
        description: "Lista uppdrag/jobb (list jobs). Valfritt kundnamn eller status.",
        parameters: obj({
          customerName: { type: "string" },
          status: { type: "string", enum: ["kommande", "pagar", "klart"] },
        }),
      },
    },
    handler: (args) => {
      let jobs = db().jobs;
      const name = str(args, "customerName");
      if (name) {
        const resolved = resolveOrAsk(name);
        if (!("customer" in resolved)) return resolved;
        jobs = jobs.filter((j) => j.customerId === resolved.customer.id);
      }
      const status = str(args, "status") as Job["status"] | undefined;
      if (status) jobs = jobs.filter((j) => j.status === status);
      const rows = jobs.slice(0, 20).map(compactJob);
      return {
        ok: true,
        forModel: { jobs: rows, count: rows.length },
        text: rows.length ? `${rows.length} uppdrag.` : "Inga uppdrag matchade.",
        card:
          rows.length === 0
            ? undefined
            : {
                kind: "list",
                title: "Uppdrag",
                rows: rows.map((j) => ({
                  label: `${j.title} · ${j.customerName ?? ""}`,
                  value: j.status,
                  href: `/uppdrag/${j.id}`,
                })),
              },
      };
    },
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "get_assignment",
        description: "Hämta ett uppdrag (get job) via id. Inkluderar anteckningar som kontext – hitta inte på pris för extraarbete.",
        parameters: obj({ jobId: { type: "string" } }, ["jobId"]),
      },
    },
    handler: (args) => {
      const job = str(args, "jobId") ? getJob(str(args, "jobId")!) : undefined;
      if (!job) return { ok: false, forModel: {}, error: "Uppdraget finns inte" };
      return { ok: true, forModel: compactJob(job) };
    },
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "list_quotes",
        description: "Lista offerter (list quotes). Valfritt kundnamn eller status.",
        parameters: obj({
          customerName: { type: "string" },
          status: { type: "string", enum: ["utkast", "skickad", "godkand", "avbojd", "utgangen"] },
        }),
      },
    },
    handler: (args) => {
      let quotes = db().quotes;
      const name = str(args, "customerName");
      if (name) {
        const resolved = resolveOrAsk(name);
        if (!("customer" in resolved)) return resolved;
        quotes = quotes.filter((q) => q.customerId === resolved.customer.id);
      }
      const status = str(args, "status");
      if (status) quotes = quotes.filter((q) => q.status === status);
      const rows = quotes.slice(0, 20).map(compactQuote);
      return {
        ok: true,
        forModel: { quotes: rows, count: rows.length },
        text: rows.length === 0 ? "Inga offerter matchade." : `${rows.length} offert${rows.length === 1 ? "" : "er"}.`,
        card:
          rows.length === 0
            ? undefined
            : {
                kind: "list",
                title: "Offerter",
                rows: rows.map((q) => ({
                  label: `Offert #${q.number} · ${q.title}`,
                  value: `${q.customerName} · ${kr(q.toPay)} · ${q.statusLabel}`,
                  href: `/ekonomi/offerter/${q.id}`,
                })),
              },
      };
    },
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "get_quote",
        description: "Hämta en offert (get quote) via id.",
        parameters: obj({ quoteId: { type: "string" } }, ["quoteId"]),
      },
    },
    handler: (args) => {
      const q = str(args, "quoteId") ? getQuote(str(args, "quoteId")!) : undefined;
      if (!q) return { ok: false, forModel: {}, error: "Offerten finns inte" };
      const v = currentVersion(q);
      return {
        ok: true,
        forModel: {
          ...compactQuote(q),
          intro: v.intro.slice(0, 240),
          lineCount: v.lines.length,
        },
      };
    },
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "list_invoices",
        description: "Lista fakturor (list invoices). Valfritt kundnamn eller status.",
        parameters: obj({
          customerName: { type: "string" },
          status: { type: "string", enum: ["utkast", "skickad", "betald", "krediterad"] },
        }),
      },
    },
    handler: (args) => {
      let invoices = db().invoices;
      const name = str(args, "customerName");
      if (name) {
        const resolved = resolveOrAsk(name);
        if (!("customer" in resolved)) return resolved;
        invoices = invoices.filter((i) => i.customerId === resolved.customer.id);
      }
      const status = str(args, "status");
      if (status) invoices = invoices.filter((i) => i.status === status);
      const rows = invoices.slice(0, 20).map(compactInvoice);
      return { ok: true, forModel: { invoices: rows, count: rows.length } };
    },
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "get_invoice",
        description: "Hämta en faktura (get invoice) via id.",
        parameters: obj({ invoiceId: { type: "string" } }, ["invoiceId"]),
      },
    },
    handler: (args) => {
      const i = str(args, "invoiceId") ? getInvoice(str(args, "invoiceId")!) : undefined;
      if (!i) return { ok: false, forModel: {}, error: "Fakturan finns inte" };
      return { ok: true, forModel: compactInvoice(i) };
    },
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "list_unpaid_invoices",
        description: "Kunder/fakturor som väntar på betalning (unpaid invoices, status skickad).",
        parameters: obj({}),
      },
    },
    handler: () => fromDomain(unpaidInvoicesResult()),
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "list_overdue_invoices",
        description: "Lista försenade fakturor (overdue invoices).",
        parameters: obj({}),
      },
    },
    handler: () => {
      const late = [...db().invoices.filter(isOverdue)].sort((a, b) => daysOverdue(b) - daysOverdue(a));
      if (late.length === 0) {
        return {
          ok: true,
          forModel: { invoices: [], count: 0 },
          text: "Inga fakturor är förfallna just nu – allt ser bra ut.",
        };
      }
      return {
        ok: true,
        forModel: { invoices: late.map(compactInvoice), count: late.length },
        text: `${late.length === 1 ? "1 faktura är förfallen" : `${late.length} fakturor är förfallna`}:`,
        card: {
          kind: "list",
          title: "Förfallna fakturor",
          rows: late.map((i) => {
            const days = daysOverdue(i);
            return {
              label: `${requireCustomer(i.customerId).name} · faktura #${i.number}`,
              value: `${kr(invoiceTotals(i).toPay)} · ${days} ${days === 1 ? "dag" : "dagar"} sen`,
              href: `/ekonomi/fakturor/${i.id}`,
            };
          }),
        },
      };
    },
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "list_missing_receipts",
        description: "Köp som saknar kvitto (missing receipts).",
        parameters: obj({}),
      },
    },
    handler: () => fromDomain(missingReceiptsResult()),
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "business_stats",
        description: "Nyckeltal för företaget (business stats): omsättning, obetalt, vinst.",
        parameters: obj({}),
      },
    },
    handler: () => fromDomain(companyStatusResult()),
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "get_business_profile",
        description:
          "Läs företagsuppgifter och standardval (org.nr, momsreg.nr, adress, bankgiro, betalningsvillkor). Ändrar ingenting.",
        parameters: obj({}),
      },
    },
    handler: () => fromDomain(businessProfileResult()),
  },
  {
    requiresConfirmation: true,
    risk: "CONFIRM_REQUIRED",
    def: {
      type: "function",
      function: {
        name: "update_business_profile",
        description:
          "Be om bekräftelse att ändra företagsuppgifter eller betalningsuppgifter. Sparar inte själv. Använd samma fältnamn som i Inställningar, t.ex. bankgiro, orgNumber, vatNumber, address.",
        parameters: obj({
          name: { type: "string" },
          orgNumber: { type: "string" },
          vatNumber: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          websiteUrl: { type: "string" },
          address: { type: "string" },
          postalCode: { type: "string" },
          city: { type: "string" },
          sate: { type: "string" },
          country: { type: "string" },
          bankgiro: { type: "string" },
          plusgiro: { type: "string" },
          bankAccount: { type: "string" },
          iban: { type: "string" },
          bic: { type: "string" },
          paymentTermsDays: { type: "number" },
          lateInterestRate: { type: "number" },
          quoteValidityDays: { type: "number" },
          defaultVatRate: { type: "number" },
        }),
      },
    },
    handler: (args) => {
      const patch: Record<string, string | number | null> = {};
      for (const [key, value] of Object.entries(args)) {
        if (value == null || value === "") continue;
        if (typeof value === "string" || typeof value === "number") patch[key] = value;
      }
      return fromDomain(requestUpdateBusinessProfile(patch), true);
    },
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "finance_overview",
        description: "Ekonomisk överblick: bank, momsreserv, tillgängligt (available cash).",
        parameters: obj({}),
      },
    },
    handler: () => fromDomain(spendingRoomResult()),
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "moms_status",
        description: "Moms för innevarande period (VAT due).",
        parameters: obj({}),
      },
    },
    handler: () => fromDomain(momsResult()),
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "list_actions",
        description:
          "Att göra-listan – samma prioriterade Hem-vy (”Vad behöver jag göra idag?”). Förfallna fakturor, offertuppföljning, ROT/RUT, bokföringsgrupp, moms. Enskilda bokföringsundantag finns kompletta under Bokföring.",
        parameters: obj({}),
      },
    },
    handler: () => fromDomain(todayAttentionResult()),
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "list_watching",
        description:
          "På gång-listan – samma read-model som Hem (”Vad är på gång?”). Offerter som väntar, fakturor som förfaller snart, uppdrag som startar, moms nära deadline. Inte samma sak som list_actions.",
        parameters: obj({}),
      },
    },
    handler: () => fromDomain(watchingResult()),
  },
  {
    requiresConfirmation: false,
    risk: "SAFE_WRITE",
    def: {
      type: "function",
      function: {
        name: "create_customer",
        description:
          "Skapa kund (create customer). Kräv e-post – hitta inte på en. Saknas e-post: anropa utan email så erbjuds formuläret.",
        parameters: obj({
          name: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          kind: { type: "string", enum: ["privat", "foretag"] },
        }, ["name"]),
      },
    },
    handler: (args) => {
      const name = str(args, "name");
      if (!name) return { ok: false, forModel: {}, error: "name krävs" };
      const email = str(args, "email");
      if (!email) return fromDomain(offerCreateCustomer(name));
      return fromDomain(createCustomerDirect({ name, email, phone: str(args, "phone"), kind: str(args, "kind") as Customer["kind"] }));
    },
  },
  {
    requiresConfirmation: false,
    risk: "SAFE_WRITE",
    def: {
      type: "function",
      function: {
        name: "create_assignment",
        description: "Skapa manuellt uppdrag (create job). Draft, ingen offert krävs. startDate i ISO (YYYY-MM-DD).",
        parameters: obj(
          {
            customerName: { type: "string" },
            customerId: { type: "string" },
            title: { type: "string" },
            startDate: { type: "string", description: "ISO-datum" },
            description: { type: "string" },
            workLocationHint: { type: "string", description: "Bostad, t.ex. hem eller fritidshus. Inte personnummer." },
          },
          ["title"]
        ),
      },
    },
    handler: (args) => {
      const title = str(args, "title");
      if (!title) return { ok: false, forModel: {}, error: "title krävs" };
      let customerId = str(args, "customerId");
      const name = str(args, "customerName");
      if (!customerId && name) {
        const resolved = resolveOrAsk(name, { kind: "create_job", title, startDate: str(args, "startDate"), description: str(args, "description") });
        if (!("customer" in resolved)) return resolved;
        customerId = resolved.customer.id;
      }
      if (!customerId) return { ok: false, forModel: {}, error: "customerName eller customerId krävs" };
      return fromDomain(
        createJobDraft({
          customerId,
          title,
          startDate: str(args, "startDate"),
          description: str(args, "description"),
          workLocationHint: str(args, "workLocationHint"),
        })
      );
    },
  },
  {
    requiresConfirmation: false,
    risk: "SAFE_WRITE",
    def: {
      type: "function",
      function: {
        name: "update_assignment_status",
        description: "Markera uppdrag som klart (mark job done). Pågår räknas från startdatum – använd inte pagar för att starta arbete. Återöppna med status kommande/pagar – rör inte fakturor.",
        parameters: obj(
          {
            jobId: { type: "string" },
            status: { type: "string", enum: ["kommande", "pagar", "klart"] },
          },
          ["jobId", "status"]
        ),
      },
    },
    handler: (args) => {
      const jobId = str(args, "jobId");
      const status = str(args, "status") as Job["status"] | undefined;
      if (!jobId || !status) return { ok: false, forModel: {}, error: "jobId och status krävs" };
      if (status === "klart") return fromDomain(completeJobDraft(jobId));
      const current = getJob(jobId);
      if (current && (current.status === "klart" || current.completedAt)) {
        return fromDomain(reopenJobDraft(jobId));
      }
      try {
        const job = setJobStatus(jobId, status);
        return { ok: true, forModel: compactJob(job), text: `Uppdraget ${job.title} är nu ${status}.` };
      } catch (e) {
        return { ok: false, forModel: {}, error: e instanceof Error ? e.message : "Kunde inte uppdatera" };
      }
    },
  },
  {
    requiresConfirmation: false,
    risk: "SAFE_WRITE",
    def: {
      type: "function",
      function: {
        name: "complete_job",
        description: "Markera uppdrag som klart. Ändrar bara arbetsstatus – fakturor, offerter och betalningar påverkas inte.",
        parameters: obj({ jobId: { type: "string" } }, ["jobId"]),
      },
    },
    handler: (args) => {
      const jobId = str(args, "jobId");
      if (!jobId) return { ok: false, forModel: {}, error: "jobId krävs" };
      return fromDomain(completeJobDraft(jobId));
    },
  },
  {
    requiresConfirmation: false,
    risk: "SAFE_WRITE",
    def: {
      type: "function",
      function: {
        name: "reopen_job",
        description: "Återöppna ett klart uppdrag. Återställer bara arbetsstatus. Fakturor, offerter, betalningar och bokföring rörs inte.",
        parameters: obj({ jobId: { type: "string" } }, ["jobId"]),
      },
    },
    handler: (args) => {
      const jobId = str(args, "jobId");
      if (!jobId) return { ok: false, forModel: {}, error: "jobId krävs" };
      return fromDomain(reopenJobDraft(jobId));
    },
  },
  {
    requiresConfirmation: true,
    risk: "CONFIRM_REQUIRED",
    def: {
      type: "function",
      function: {
        name: "delete_or_archive_job",
        description:
          "Be om bekräftelse att ta bort eller arkivera ett uppdrag. Tar inte bort själv. Tomt uppdrag raderas, annars arkiveras det. Utfärdade fakturor, signerade offerter och bokföring raderas aldrig.",
        parameters: obj({ jobId: { type: "string" } }, ["jobId"]),
      },
    },
    handler: (args) => {
      const jobId = str(args, "jobId");
      if (!jobId) return { ok: false, forModel: {}, error: "jobId krävs" };
      return fromDomain(requestDeleteOrArchiveJob(jobId), true);
    },
  },
  {
    requiresConfirmation: false,
    risk: "SAFE_WRITE",
    def: {
      type: "function",
      function: {
        name: "create_quote",
        description:
          "Skapa offertutkast (create quote draft). Skickas inte. amountInclVat i kronor inkl. moms. ROT/RUT-villkor läggs till av offerttjänsten – skriv inte egna villkor. Om kunden har ett inkommande uppdrag utan offert (t.ex. Karins bokhylla) kopplas det automatiskt via jobId.",
        parameters: obj(
          {
            customerName: { type: "string" },
            customerId: { type: "string" },
            title: { type: "string" },
            amountInclVat: { type: "number" },
            percentAtStart: { type: "number", description: "Andel i procent som betalas vid start" },
            taxReduction: { type: "string", enum: ["rot", "rut"], description: "Sätt rot eller rut. Villkorstexten läggs till automatiskt." },
            appliedTaxReduction: {
              type: "number",
              description:
                "Avdrag att använda i kronor. Får inte överstiga maximalt avdrag utifrån den här offerten. Inte kundens saldo hos Skatteverket.",
            },
            jobId: { type: "string", description: "Uppdrag att koppla. Lämna tomt för att hitta inkommande uppdrag utan offert automatiskt." },
          },
          ["title"]
        ),
      },
    },
    handler: (args) => {
      const title = str(args, "title") ?? "Offererat arbete";
      const amount = num(args, "amountInclVat");
      const taxReduction = str(args, "taxReduction");
      const rot = taxReduction === "rot" || taxReduction === "rut" ? taxReduction : null;
      const appliedTaxReduction = num(args, "appliedTaxReduction");
      let customerId = str(args, "customerId");
      const name = str(args, "customerName");
      if (!customerId && name) {
        const resolved = resolveOrAsk(name, { kind: "create_quote", title, amountInclVat: amount, rot, appliedTaxReduction });
        if (!("customer" in resolved)) return resolved;
        customerId = resolved.customer.id;
      }
      if (!customerId) return { ok: false, forModel: {}, error: "customerName eller customerId krävs" };
      return fromDomain(createQuoteDraft({ customerId, title, amountInclVat: amount, percentAtStart: num(args, "percentAtStart"), rot, jobId: str(args, "jobId"), appliedTaxReduction }));
    },
  },
  {
    requiresConfirmation: false,
    risk: "SAFE_WRITE",
    def: {
      type: "function",
      function: {
        name: "create_invoice",
        description:
          "Skapa fakturautkast (create invoice draft). Skickas inte. För ROT/RUT: sätt taxReduction, hitta uppdraget och återanvänd sparade uppgifter. Hitta ALDRIG på personnummer eller fastighetsbeteckning. Fråga bara om den uppgift som saknas – inte en lista. Skicka inte personnummer.",
        parameters: obj({
          customerName: { type: "string" },
          customerId: { type: "string" },
          title: { type: "string" },
          amountInclVat: { type: "number" },
          jobId: { type: "string" },
          taxReduction: { type: "string", enum: ["rot", "rut"], description: "Sätt rot eller rut. Villkorstexten läggs till automatiskt. Skicka inte personnummer." },
          workLocationHint: { type: "string", description: "Bostad att fakturera mot, t.ex. fritidshus. Inte personnummer." },
          appliedTaxReduction: {
            type: "number",
            description:
              "Avdrag att använda i kronor. Får inte överstiga maximalt avdrag utifrån den här fakturan. Inte kundens saldo hos Skatteverket.",
          },
        }),
      },
    },
    handler: (args) => {
      let customerId = str(args, "customerId");
      const name = str(args, "customerName");
      const title = str(args, "title");
      const amount = num(args, "amountInclVat");
      const jobId = str(args, "jobId");
      const taxReductionRaw = str(args, "taxReduction");
      const taxReduction = taxReductionRaw === "rot" || taxReductionRaw === "rut" ? taxReductionRaw : null;
      const appliedTaxReduction = num(args, "appliedTaxReduction");
      if (!customerId && name) {
        const resolved = resolveOrAsk(name, { kind: "create_invoice", title, amountInclVat: amount, jobId, taxReduction, appliedTaxReduction });
        if (!("customer" in resolved)) return resolved;
        customerId = resolved.customer.id;
      }
      if (!customerId) return { ok: false, forModel: {}, error: "customerName eller customerId krävs" };
      return fromDomain(
        createInvoiceDraft({
          customerId,
          title,
          amountInclVat: amount,
          jobId,
          taxReduction,
          appliedTaxReduction,
          workLocationHint: str(args, "workLocationHint"),
        })
      );
    },
  },
  {
    requiresConfirmation: false,
    risk: "SAFE_WRITE",
    def: {
      type: "function",
      function: {
        name: "create_final_invoice",
        description: "Skapa slutfaktura-utkast för ett uppdrag (createFinalInvoiceForJob). Skickas inte.",
        parameters: obj({ jobId: { type: "string" } }, ["jobId"]),
      },
    },
    handler: (args) => {
      const jobId = str(args, "jobId");
      if (!jobId) return { ok: false, forModel: {}, error: "jobId krävs" };
      try {
        return fromDomain(createFinalInvoiceDraft(jobId));
      } catch (e) {
        return { ok: false, forModel: {}, error: e instanceof Error ? e.message : "Kunde inte skapa slutfaktura. Inget sparades." };
      }
    },
  },
  {
    requiresConfirmation: false,
    risk: "SAFE_WRITE",
    def: {
      type: "function",
      function: {
        name: "create_job_invoice",
        description:
          "Skapa fakturautkast för ett uppdrag. basis=quote: enligt godkänd offert (betalningsplan). basis=actuals: ofakturerat registrerat arbete. Utan basis: offert om den finns, annars actuals. Skickas inte.",
        parameters: obj({
          jobId: { type: "string" },
          basis: { type: "string", enum: ["quote", "actuals", "empty"] },
        }, ["jobId"]),
      },
    },
    handler: (args) => {
      const jobId = str(args, "jobId");
      if (!jobId) return { ok: false, forModel: {}, error: "jobId krävs" };
      const basis = str(args, "basis");
      const resolved = basis === "quote" || basis === "actuals" || basis === "empty" ? basis : undefined;
      return fromDomain(createJobInvoiceDraft(jobId, resolved));
    },
  },
  {
    requiresConfirmation: false,
    risk: "SAFE_WRITE",
    def: {
      type: "function",
      function: {
        name: "register_job_time",
        description:
          "Registrera arbetstid på ett uppdrag idag (eller angivet datum). Timpris hämtas från offerten om det finns. Skapar inte dagsverken – bara en actual-post. Offerten ändras inte.",
        parameters: obj(
          {
            jobId: { type: "string" },
            hours: { type: "number" },
            description: { type: "string" },
            date: { type: "string", description: "YYYY-MM-DD. Tomt = idag." },
            unitPrice: { type: "number", description: "Timpris exkl. moms. Tomt = från offerten." },
          },
          ["jobId", "hours"]
        ),
      },
    },
    handler: (args) => {
      const jobId = str(args, "jobId");
      const hours = num(args, "hours");
      if (!jobId || hours == null) return { ok: false, forModel: {}, error: "jobId och hours krävs" };
      return fromDomain(
        registerJobTimeDraft({
          jobId,
          hours,
          description: str(args, "description"),
          date: str(args, "date"),
          unitPrice: num(args, "unitPrice"),
        })
      );
    },
  },
  {
    requiresConfirmation: false,
    risk: "SAFE_WRITE",
    def: {
      type: "function",
      function: {
        name: "add_job_material",
        description:
          "Lägg till material på ett uppdrag. qty och unitPrice (exkl. moms) krävs. Inte lager – bara en actual-post. Offerten ändras inte.",
        parameters: obj(
          {
            jobId: { type: "string" },
            description: { type: "string" },
            qty: { type: "number" },
            unitPrice: { type: "number" },
            unit: { type: "string" },
            date: { type: "string", description: "YYYY-MM-DD. Tomt = idag." },
          },
          ["jobId", "description", "qty", "unitPrice"]
        ),
      },
    },
    handler: (args) => {
      const jobId = str(args, "jobId");
      const description = str(args, "description");
      const qty = num(args, "qty");
      const unitPrice = num(args, "unitPrice");
      if (!jobId || !description || qty == null || unitPrice == null) {
        return { ok: false, forModel: {}, error: "jobId, description, qty och unitPrice krävs" };
      }
      return fromDomain(
        addJobMaterialDraft({
          jobId,
          description,
          qty,
          unitPrice,
          unit: str(args, "unit"),
          date: str(args, "date"),
        })
      );
    },
  },
  {
    requiresConfirmation: false,
    risk: "SAFE_WRITE",
    def: {
      type: "function",
      function: {
        name: "propose_invoice_for_customer",
        description: "Föreslå slutfaktura för kund (look up jobs + remaining to invoice). Skapar utkast om entydigt.",
        parameters: obj({ customerName: { type: "string" }, customerId: { type: "string" } }),
      },
    },
    handler: (args) => {
      let customerId = str(args, "customerId");
      const name = str(args, "customerName");
      if (!customerId && name) {
        const resolved = resolveOrAsk(name);
        if (!("customer" in resolved)) return resolved;
        customerId = resolved.customer.id;
      }
      if (!customerId) return { ok: false, forModel: {}, error: "kund krävs" };
      try {
        return fromDomain(proposeInvoiceForCustomer(customerId));
      } catch (e) {
        return { ok: false, forModel: {}, error: e instanceof Error ? e.message : "Kunde inte fakturera. Inget sparades." };
      }
    },
  },
  {
    requiresConfirmation: false,
    risk: "SAFE_WRITE",
    def: {
      type: "function",
      function: {
        name: "propose_extra_from_notes",
        description:
          "Läs uppdragsanteckningar och fråga om extraarbete. Hitta ALDRIG på pris. Utan amountInclVat: visa anteckningen och fråga. Med belopp: bekräftelsekort för tilläggsoffert (utkast, skickas inte).",
        parameters: obj({
          customerName: { type: "string" },
          customerId: { type: "string" },
          amountInclVat: { type: "number", description: "Endast om användaren angett belopp. Hitta inte på pris." },
        }),
      },
    },
    handler: (args) => {
      let customerId = str(args, "customerId");
      const name = str(args, "customerName");
      const amount = num(args, "amountInclVat");
      if (!customerId && name) {
        const resolved = resolveOrAsk(name);
        if (!("customer" in resolved)) return resolved;
        customerId = resolved.customer.id;
      }
      if (!customerId) return { ok: false, forModel: {}, error: "kund krävs" };
      return fromDomain(proposeExtraFromNotes(customerId, amount), Boolean(amount && amount > 0));
    },
  },
  {
    requiresConfirmation: true,
    risk: "CONFIRM_REQUIRED",
    def: {
      type: "function",
      function: {
        name: "send_quote",
        description: "Be om bekräftelse att skicka offert. Skickar INTE själv – visar bekräftelsekort.",
        parameters: obj({ quoteId: { type: "string" } }, ["quoteId"]),
      },
    },
    handler: (args) => {
      const id = str(args, "quoteId");
      if (!id) return { ok: false, forModel: {}, error: "quoteId krävs" };
      return fromDomain(requestSendQuote(id), true);
    },
  },
  {
    requiresConfirmation: true,
    risk: "CONFIRM_REQUIRED",
    def: {
      type: "function",
      function: {
        name: "send_invoice",
        description: "Be om bekräftelse att skicka faktura. Skickar INTE själv – visar bekräftelsekort.",
        parameters: obj({ invoiceId: { type: "string" } }, ["invoiceId"]),
      },
    },
    handler: (args) => {
      const id = str(args, "invoiceId");
      if (!id) return { ok: false, forModel: {}, error: "invoiceId krävs" };
      return fromDomain(requestSendInvoice(id), true);
    },
  },
  {
    requiresConfirmation: true,
    risk: "CONFIRM_REQUIRED",
    def: {
      type: "function",
      function: {
        name: "send_reminders",
        description: "Be om bekräftelse att påminna om försenade fakturor (sendReminder). Skickar inte själv.",
        parameters: obj({}),
      },
    },
    handler: () => fromDomain(requestRemindLate(), true),
  },
  {
    requiresConfirmation: true,
    risk: "CONFIRM_REQUIRED",
    def: {
      type: "function",
      function: {
        name: "follow_up_quotes",
        description: "Be om bekräftelse att följa upp offerter som väntar på BankID (followUpQuote).",
        parameters: obj({ minDays: { type: "number" } }),
      },
    },
    handler: (args) => fromDomain(requestFollowUpQuotes(num(args, "minDays") ?? 7), true),
  },
  {
    requiresConfirmation: true,
    risk: "CONFIRM_REQUIRED",
    def: {
      type: "function",
      function: {
        name: "generate_website",
        description: "Be om bekräftelse att generera hemsideutkast. Publicerar inte.",
        parameters: obj({ description: { type: "string" } }, ["description"]),
      },
    },
    handler: (args) => fromDomain(requestGenerateWebsite(str(args, "description") ?? ""), true),
  },
  {
    requiresConfirmation: true,
    risk: "CONFIRM_REQUIRED",
    def: {
      type: "function",
      function: {
        name: "publish_website",
        description: "Be om bekräftelse att publicera hemsidan. Publicerar inte själv.",
        parameters: obj({}),
      },
    },
    handler: () => fromDomain(requestPublishWebsite(), true),
  },
  {
    requiresConfirmation: true,
    risk: "CONFIRM_REQUIRED",
    def: {
      type: "function",
      function: {
        name: "book_expense",
        description: "Be om bekräftelse att bokföra ett köp, valfritt kopplat till uppdrag (bookExpenseToJob).",
        parameters: obj(
          {
            expenseId: { type: "string" },
            category: { type: "string" },
            jobId: { type: "string" },
          },
          ["expenseId", "category"]
        ),
      },
    },
    handler: (args) => {
      const expenseId = str(args, "expenseId");
      const category = str(args, "category");
      if (!expenseId || !category) return { ok: false, forModel: {}, error: "expenseId och category krävs" };
      return fromDomain(requestBookExpense({ expenseId, category, jobId: str(args, "jobId") }), true);
    },
  },
  {
    requiresConfirmation: false,
    risk: "FORBIDDEN_FOR_AI",
    def: {
      type: "function",
      function: {
        name: "answer_expense_question",
        description: "Svara på bokföringsfråga (answerExpenseQuestion) så att köpet bokförs.",
        parameters: obj({ expenseId: { type: "string" }, answer: { type: "string" } }, ["expenseId", "answer"]),
      },
    },
    handler: (args) => {
      const expenseId = str(args, "expenseId");
      const answer = str(args, "answer");
      if (!expenseId || !answer) return { ok: false, forModel: {}, error: "expenseId och answer krävs" };
      const expense = db().expenses.find((e) => e.id === expenseId);
      if (!expense) return { ok: false, forModel: {}, error: "Köpet finns inte. Inget sparades." };
      answerExpenseQuestion(expenseId, answer, "assistent");
      return {
        ok: true,
        forModel: { expenseId, booked: true },
        text: `Köpet hos ${expense.supplier} är bokfört som ${answer}.`,
      };
    },
  },
  /* ------------------------- Bokföringsmotorn (läsning) ------------------------ */
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "bokforing_status",
        description:
          "Vad behöver göras med bokföringen (bookkeeping status): obesvarade frågor, kvitton, bankavstämning, nästa moms, periodlås.",
        parameters: obj({}),
      },
    },
    handler: () => fromDomain(bokforingStatusResult()),
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "moms_rapport",
        description:
          "Momsrapport per deklarationsruta för en momsperiod (VAT report). periodKey t.ex. 2026-K2; utelämna för aktuell period.",
        parameters: obj({ periodKey: { type: "string", description: "T.ex. 2026-K2" } }),
      },
    },
    handler: (args) => fromDomain(momsRapportResult(str(args, "periodKey"))),
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "resultat_rapport",
        description: "Resultatrapport ur bokföringen (income statement): omsättning, kostnader, resultat.",
        parameters: obj({}),
      },
    },
    handler: () => fromDomain(resultatRapportResult()),
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "balans_rapport",
        description: "Balansrapport ur bokföringen (balance sheet): tillgångar, skulder, eget kapital.",
        parameters: obj({}),
      },
    },
    handler: () => fromDomain(balansRapportResult()),
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "bokslut_status",
        description: "Bokslutets checklista och vad som återstår för att stänga året (year-end closing status).",
        parameters: obj({}),
      },
    },
    handler: () => fromDomain(bokslutStatusResult()),
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "forklara_verifikation",
        description:
          "Förklara varför något bokfördes som det gjorde (explain booking). query = verifikationsnummer (A12) eller del av beskrivningen (t.ex. Bauhaus).",
        parameters: obj({ query: { type: "string" } }, ["query"]),
      },
    },
    handler: (args) => {
      const query = str(args, "query");
      if (!query) return { ok: false, forModel: {}, error: "query krävs" };
      return fromDomain(forklaraVerifikationResult(query));
    },
  },
  /* --------------------- Bokföringsmotorn (bekräftelsekort) -------------------- */
  {
    requiresConfirmation: true,
    risk: "CONFIRM_REQUIRED",
    def: {
      type: "function",
      function: {
        name: "bokfor_bokslutsposter",
        description:
          "Be om bekräftelse att bokföra årets avskrivningar och planerade periodiseringar (year-end automation). Bokför inte själv.",
        parameters: obj({}),
      },
    },
    handler: () => fromDomain(requestRunBokslutAutomation(), true),
  },
  {
    requiresConfirmation: true,
    risk: "CONFIRM_REQUIRED",
    def: {
      type: "function",
      function: {
        name: "slutfor_bokslut",
        description:
          "Be om bekräftelse att slutföra bokslutet och stänga räkenskapsåret (close fiscal year). Kräver att checklistan är grön. Stänger inte själv.",
        parameters: obj({}),
      },
    },
    handler: () => fromDomain(requestCloseFiscalYear(), true),
  },
  {
    requiresConfirmation: true,
    risk: "CONFIRM_REQUIRED",
    def: {
      type: "function",
      function: {
        name: "angra_bokforing",
        description:
          "Be om bekräftelse att ångra en bokförd utgift via rättelseverifikation (undo booking). query = leverantörsnamn eller expenseId.",
        parameters: obj({ query: { type: "string" } }, ["query"]),
      },
    },
    handler: (args) => {
      const query = str(args, "query");
      if (!query) return { ok: false, forModel: {}, error: "query krävs" };
      return fromDomain(requestUndoExpense(query), true);
    },
  },
  {
    requiresConfirmation: true,
    risk: "CONFIRM_REQUIRED",
    def: {
      type: "function",
      function: {
        name: "ratta_bokforing",
        description:
          "Be om bekräftelse att rätta en bokförd verifikation (correct booking). query = A12, leverantör eller id. category = utgiftskategori (material, forsakring, …) när kostnadskontot är fel. Aldrig debet/kredit-rader – Driva skapar rättelsen. Kundfaktura → kreditflöde. Betalning → omatcha.",
        parameters: obj({
          query: { type: "string", description: "Verifikationsnummer (A12), leverantör eller id." },
          category: { type: "string", description: "Ny utgiftskategori, t.ex. material eller forsakring." },
        }, ["query"]),
      },
    },
    handler: (args) => {
      const query = str(args, "query");
      if (!query) return { ok: false, forModel: {}, error: "query krävs" };
      return fromDomain(requestCorrectVerification(query, str(args, "category")), true);
    },
  },
  {
    requiresConfirmation: true,
    risk: "CONFIRM_REQUIRED",
    def: {
      type: "function",
      function: {
        name: "markera_moms_deklarerad",
        description:
          "Be om bekräftelse att markera en momsperiod som deklarerad (mark VAT declared). Skickar INGET till Skatteverket – låser perioden och för om momsen.",
        parameters: obj({ periodKey: { type: "string", description: "T.ex. 2026-K2. Utelämna för perioden som väntar." } }),
      },
    },
    handler: (args) => fromDomain(requestMarkVatDeclared(str(args, "periodKey")), true),
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "check_domain_availability",
        description: "Kolla om en .se-adress är ledig (check domain availability). Köper INTE.",
        parameters: obj({ query: { type: "string", description: "t.ex. sodermalmssnickeri eller sodermalmssnickeri.se" } }, ["query"]),
      },
    },
    handler: async (args) => {
      const query = str(args, "query");
      if (!query) return { ok: false, forModel: {}, error: "query krävs" };
      return fromDomain(await checkDomainAvailabilityResult(query));
    },
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "get_domain_status",
        description: "Läs status för företagets .se-adress (get domain status). Ändrar ingenting.",
        parameters: obj({}),
      },
    },
    handler: () => fromDomain(getDomainStatusResult()),
  },
  {
    requiresConfirmation: true,
    risk: "CONFIRM_REQUIRED",
    def: {
      type: "function",
      function: {
        name: "purchase_domain",
        description:
          "Be om bekräftelse att köpa och koppla en .se-adress. Köper INTE själv – visar bekräftelsekort. Använd samma tjänst som Hemsida → Domän.",
        parameters: obj({ hostname: { type: "string" } }, ["hostname"]),
      },
    },
    handler: (args) => {
      const hostname = str(args, "hostname");
      if (!hostname) return { ok: false, forModel: {}, error: "hostname krävs" };
      return fromDomain(requestPurchaseDomain(hostname), true);
    },
  },

  /* ------------------------------- Påminnelser ------------------------------ */
  // Modellen extraherar ETT strukturerat tidsuttryck ur svenskan (platta,
  // strikt validerade argument); resolvern i lib/reminders/when.ts äger all
  // policy (veckodagsregel, standardtid 10:00, dagsdelar, tidszon).
  {
    requiresConfirmation: false,
    risk: "SAFE_WRITE",
    def: {
      type: "function",
      function: {
        name: "create_reminder",
        description:
          "Skapa en persisterad påminnelse (create reminder). NÄR är valfritt: whenIso, whenDate (+ valfri time/daypart), weekday, relativeMinutes/Hours/Days, eller daypart. Utan tidsfält skapas en odaterad påminnelse (giltig, inte försenad). relatedType+relatedQuery kopplar till kund/offert/faktura/uppdrag – hitta ALDRIG på kopplingar.",
        parameters: obj(
          {
            title: { type: "string", description: "Vad som ska göras, t.ex. 'Ringa Göran Svensson'" },
            description: { type: "string" },
            whenIso: { type: "string", description: "Lokal tid YYYY-MM-DDTHH:MM eller YYYY-MM-DD" },
            whenDate: { type: "string", description: "YYYY-MM-DD" },
            weekday: { type: "string", enum: [...WEEKDAYS_SV] },
            nextWeek: { type: "boolean", description: "Sant för 'nästa onsdag'" },
            time: { type: "string", description: "HH:MM om användaren angav klockslag" },
            daypart: { type: "string", enum: [...DAYPARTS] },
            relativeMinutes: { type: "number" },
            relativeHours: { type: "number" },
            relativeDays: { type: "number" },
            relatedType: { type: "string", enum: ["customer", "quote", "invoice", "job"] },
            relatedQuery: { type: "string", description: "T.ex. 'Göran', 'offert 113', 'faktura 1047'" },
          },
          ["title"]
        ),
      },
    },
    handler: (args) => handleCreateReminder(args),
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "list_reminders",
        description:
          "Lista aktiva påminnelser (list reminders), tidigast först. Valfritt sökord. Svarar även på 'Vad ska jag komma ihåg denna vecka?'.",
        parameters: obj({ q: { type: "string", description: "Valfritt sökord i titel/beskrivning" } }),
      },
    },
    handler: (args) => {
      const reminders = searchReminders(str(args, "q") ?? "");
      const rows = reminders.slice(0, 20).map((r) => ({
        label: r.title,
        value: describeReminderDue(r).text + (r.snoozedUntil ? " · uppskjuten" : ""),
        href: reminderTargetHref(r),
      }));
      return {
        ok: true,
        forModel: { reminders: reminders.slice(0, 20).map(compactReminder), count: reminders.length },
        text: reminders.length
          ? `${reminders.length} ${reminders.length === 1 ? "påminnelse" : "påminnelser"}.`
          : "Du har inga aktiva påminnelser.",
        card: rows.length ? { kind: "list", title: "Påminnelser", rows } : undefined,
      };
    },
  },
  {
    requiresConfirmation: false,
    risk: "SAFE_WRITE",
    def: {
      type: "function",
      function: {
        name: "update_reminder",
        description:
          "Flytta eller ändra en påminnelse (update reminder). query = ord ur påminnelsens titel. Ny tid anges med samma tidsuttryck som create_reminder. Flera träffar → listan visas, fråga användaren.",
        parameters: obj(
          {
            query: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            whenIso: { type: "string" },
            whenDate: { type: "string" },
            weekday: { type: "string", enum: [...WEEKDAYS_SV] },
            nextWeek: { type: "boolean" },
            time: { type: "string" },
            daypart: { type: "string", enum: [...DAYPARTS] },
            relativeMinutes: { type: "number" },
            relativeHours: { type: "number" },
            relativeDays: { type: "number" },
          },
          ["query"]
        ),
      },
    },
    handler: (args) => {
      const found = findReminderOrAsk(str(args, "query") ?? "");
      if ("result" in found) return found.result;
      const when = whenFromArgs(args);
      if (when && "error" in when) return { ok: false, forModel: {}, error: when.error };
      const updated = updateReminder(found.reminder.id, {
        ...(str(args, "title") ? { title: str(args, "title") } : {}),
        ...(typeof args.description === "string" ? { description: args.description } : {}),
        ...(when ? { when } : {}),
      });
      if (!updated.ok) return { ok: false, forModel: {}, error: updated.error };
      const due = describeReminderDue(updated.reminder);
      return {
        ok: true,
        forModel: { reminder: compactReminder(updated.reminder) },
        text: updated.reminder.dueAt
          ? `Klart – påminnelsen "${updated.reminder.title}" gäller nu ${formatDueAt(updated.reminder.dueAt, updated.reminder.timezone, updated.reminder.hasExplicitTime)}.`
          : `Klart – påminnelsen "${updated.reminder.title}" har ingen tid.`,
        card: {
          kind: "list",
          title: "Påminnelse uppdaterad",
          rows: [{ label: updated.reminder.title, value: due.text, href: reminderTargetHref(updated.reminder) }],
        },
      };
    },
  },
  {
    requiresConfirmation: false,
    risk: "SAFE_WRITE",
    def: {
      type: "function",
      function: {
        name: "complete_reminder",
        description: "Markera en påminnelse som klar (complete reminder). query = ord ur titeln.",
        parameters: obj({ query: { type: "string" } }, ["query"]),
      },
    },
    handler: (args) => {
      const found = findReminderOrAsk(str(args, "query") ?? "");
      if ("result" in found) return found.result;
      const reminder = completeReminder(found.reminder.id);
      return {
        ok: true,
        forModel: { reminder: compactReminder(reminder) },
        text: `Klart – "${reminder.title}" är avklarad.`,
      };
    },
  },
  {
    requiresConfirmation: false,
    risk: "SAFE_WRITE",
    def: {
      type: "function",
      function: {
        name: "snooze_reminder",
        description:
          "Skjut upp en påminnelse (snooze reminder). query = ord ur titeln. Ny tidpunkt med samma tidsuttryck som create_reminder (t.ex. relativeHours: 1 eller weekday).",
        parameters: obj(
          {
            query: { type: "string" },
            whenIso: { type: "string" },
            whenDate: { type: "string" },
            weekday: { type: "string", enum: [...WEEKDAYS_SV] },
            nextWeek: { type: "boolean" },
            time: { type: "string" },
            daypart: { type: "string", enum: [...DAYPARTS] },
            relativeMinutes: { type: "number" },
            relativeHours: { type: "number" },
            relativeDays: { type: "number" },
          },
          ["query"]
        ),
      },
    },
    handler: (args) => {
      const found = findReminderOrAsk(str(args, "query") ?? "");
      if ("result" in found) return found.result;
      const when = whenFromArgs(args);
      if (!when) return { ok: false, forModel: {}, error: "Ange när påminnelsen ska återkomma." };
      if ("error" in when) return { ok: false, forModel: {}, error: when.error };
      const resolved = resolveWhen(when, new Date(), found.reminder.timezone);
      if (!resolved.ok) return { ok: false, forModel: {}, error: resolved.error };
      const reminder = snoozeReminder(found.reminder.id, resolved.value.dueAt);
      return {
        ok: true,
        forModel: { reminder: compactReminder(reminder) },
        text: `Uppskjuten – jag påminner dig ${formatDueAt(resolved.value.dueAt, reminder.timezone)}.`,
      };
    },
  },
  {
    // Mjuk borttagning (status DISMISSED, historiken kvar) – samma direkta
    // mönster som att slänga utkast i appen; inget bekräftelsekort krävs.
    requiresConfirmation: false,
    risk: "SAFE_WRITE",
    def: {
      type: "function",
      function: {
        name: "dismiss_reminder",
        description:
          "Ta bort en påminnelse (dismiss reminder). Mjuk borttagning – historiken bevaras. query = ord ur titeln.",
        parameters: obj({ query: { type: "string" } }, ["query"]),
      },
    },
    handler: (args) => {
      const found = findReminderOrAsk(str(args, "query") ?? "");
      if ("result" in found) return found.result;
      const reminder = dismissReminder(found.reminder.id);
      return {
        ok: true,
        forModel: { reminder: compactReminder(reminder) },
        text: `Borttagen – "${reminder.title}" påminner inte längre.`,
      };
    },
  },

  /* ------------------------- Behöver din uppmärksamhet ------------------------ */
  // Naturligt språk når SAMMA tillståndsvägar som ⋯-menyn på Hem: snooze är
  // ren presentation (attention_states), "hanterad" är domänövergången.
  {
    requiresConfirmation: false,
    risk: "SAFE_WRITE",
    def: {
      type: "function",
      function: {
        name: "snooze_attention",
        description:
          "Snooza en rad under Behöver din uppmärksamhet (sen faktura, väntande offert, saknat kvitto m.m.): dölj den tills en tidpunkt. Ändrar ALDRIG status – fakturan förblir försenad, raden återkommer om saken kvarstår. Använd när användaren syftar på en BEFINTLIG rad ('påminn mig om den sena fakturan på fredag'); skapa INTE en ny påminnelse då. query = ord ur radens rubrik (t.ex. 'faktura 1042', kundnamn). Tidpunkt med samma tidsuttryck som create_reminder.",
        parameters: obj(
          {
            query: { type: "string" },
            whenIso: { type: "string" },
            whenDate: { type: "string" },
            weekday: { type: "string", enum: [...WEEKDAYS_SV] },
            nextWeek: { type: "boolean" },
            time: { type: "string" },
            daypart: { type: "string", enum: [...DAYPARTS] },
            relativeMinutes: { type: "number" },
            relativeHours: { type: "number" },
            relativeDays: { type: "number" },
          },
          ["query"]
        ),
      },
    },
    handler: (args) => {
      const found = findAttentionOrAsk(str(args, "query") ?? "");
      if ("result" in found) return found.result;
      const action = found.action;
      if (!controlsForAction(action).canSnooze) {
        return { ok: false, forModel: { actionId: action.id }, error: "Den här raden ska aldrig tystas och kan inte snoozas." };
      }
      const when = whenFromArgs(args);
      if (!when) return { ok: false, forModel: {}, error: "Ange när raden ska visas igen." };
      if ("error" in when) return { ok: false, forModel: {}, error: when.error };
      const tz = businessTimezone();
      const resolved = resolveWhen(when, new Date(), tz);
      if (!resolved.ok) return { ok: false, forModel: {}, error: resolved.error };
      snoozeAttentionUntil(action.id, resolved.value.dueAt);
      return {
        ok: true,
        forModel: { actionId: action.id, title: action.title, snoozedUntil: resolved.value.dueAt },
        text: `Klart – "${action.title}" är undanlagd till ${formatDueAt(resolved.value.dueAt, tz)}. Kvarstår saken då dyker raden upp igen.`,
      };
    },
  },
  {
    requiresConfirmation: false,
    risk: "SAFE_WRITE",
    def: {
      type: "function",
      function: {
        name: "request_client_information",
        description:
          "Be ägaren om underlag (kvitto). Syns på Hem hos kunden. expenseId = utgiften som saknar kvitto.",
        parameters: obj({ expenseId: { type: "string" }, message: { type: "string" } }, ["expenseId"]),
      },
    },
    handler: (args) => {
      const { currentActor } = require("../collaboration/actor") as typeof import("../collaboration/actor");
      const { requestClientInformation } = require("../collaboration/requests") as typeof import("../collaboration/requests");
      const actor = currentActor();
      if (!actor || (actor.role !== "accounting_consultant" && actor.role !== "owner" && actor.role !== "admin")) {
        return { ok: false, forModel: {}, error: "Bara redovisningskonsulten kan be kunden om underlag." };
      }
      const expenseId = str(args, "expenseId") ?? "";
      const req = requestClientInformation({
        expenseId,
        message: str(args, "message"),
        requestedByUserId: actor.userId,
        requestedByName: actor.name || "Redovisningskonsulten",
        requestedByRole: actor.role === "accounting_consultant" ? "accounting_consultant" : "accounting_consultant",
      });
      return {
        ok: true,
        forModel: { requestId: req.id, message: req.message },
        text: `Klart – kunden ser: ${req.message}`,
      };
    },
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "list_accountant_exceptions",
        description:
          "Sammanfatta bokföringsundantag (samma åtgärdsmotor). Omfattning (detta företag eller alla klienter) sätts av servern – skicka inte scope. Aldrig rå huvudbok.",
        parameters: obj({}),
      },
    },
    handler: async (_args, options) => {
      const { accountantQueue, ACCOUNTANT_ISSUE_LABEL, accountantIssueType } = require("../collaboration/issues") as typeof import("../collaboration/issues");
      const { listAccountantClients } = require("../collaboration/clients") as typeof import("../collaboration/clients");
      const { attentionForBusiness } = require("../collaboration/portfolio") as typeof import("../collaboration/portfolio");
      const { currentActor } = require("../collaboration/actor") as typeof import("../collaboration/actor");
      const scope = options?.accountantScope === "all_clients" ? "all_clients" : "current";

      if (scope === "all_clients") {
        const userId = options?.actorUserId ?? currentActor()?.userId;
        if (!userId) {
          return { ok: false, forModel: { scope }, error: "Ingen användare i kontexten." };
        }
        const clients = listAccountantClients(userId);
        const items: { id: string; type: string | null; title: string; businessId: string; businessName: string }[] = [];
        for (const c of clients) {
          const attention = await attentionForBusiness(c.businessId);
          for (const a of accountantQueue(attention)) {
            items.push({
              id: a.id,
              type: accountantIssueType(a),
              title: a.title,
              businessId: c.businessId,
              businessName: c.businessName,
            });
          }
        }
        return {
          ok: true,
          forModel: { scope: "all_clients", count: items.length, clients: clients.length, items: items.slice(0, 30) },
          text:
            items.length === 0
              ? "Alla klienter: redo – inga undantag."
              : `Alla klienter: ${items.length} saker hos ${new Set(items.map((i) => i.businessId)).size} klienter. ${items
                  .slice(0, 8)
                  .map((a) => `${a.businessName}: ${ACCOUNTANT_ISSUE_LABEL[(a.type as keyof typeof ACCOUNTANT_ISSUE_LABEL) ?? "UNCLEAR_CATEGORY"]}`)
                  .join("; ")}.`,
        };
      }

      const queue = accountantQueue(getBusinessActions().attention);
      return {
        ok: true,
        forModel: {
          scope: "current",
          count: queue.length,
          items: queue.slice(0, 20).map((a) => ({
            id: a.id,
            type: accountantIssueType(a),
            title: a.title,
          })),
        },
        text:
          queue.length === 0
            ? "Detta företag: redo – inga undantag."
            : `Detta företag: ${queue.length} saker: ${queue
                .slice(0, 8)
                .map((a) => ACCOUNTANT_ISSUE_LABEL[accountantIssueType(a) ?? "UNCLEAR_CATEGORY"])
                .join(", ")}.`,
      };
    },
  },
];

export function assistantToolDefs(): AiToolDef[] {
  return specs.map((s) => s.def);
}

/**
 * Verktyg som en modell får se och anropa. FORBIDDEN_FOR_AI-verktyg finns
 * inte i listan – modellen kan bokstavligen inte anropa det som inte
 * exponeras – och blockeras dessutom i executeTool (hängslen och livrem).
 */
export function aiCallableToolDefs(): AiToolDef[] {
  return specs.filter((s) => s.risk !== "FORBIDDEN_FOR_AI").map((s) => s.def);
}

/**
 * Påminnelse-intent: bara de verktyg som behövs för att skapa/ändra
 * påminnelser och länka kund – inte hela registret. Samma modell, färre
 * inputtokens, ingen extra HTTP-runda.
 */
export const REMINDER_AI_TOOL_NAMES = [
  "create_reminder",
  "list_reminders",
  "update_reminder",
  "complete_reminder",
  "snooze_reminder",
  "dismiss_reminder",
  "find_customers",
  "snooze_attention",
] as const;

/** Verktygspaket utifrån känd intent. Okänd fritext → hela anropsbara listan. */
export function aiCallableToolDefsFor(text: string, priorUserTexts: string[] = []): AiToolDef[] {
  const all = aiCallableToolDefs();
  const reminder =
    isInternalReminderIntent(text) || priorUserTexts.some((t) => isInternalReminderIntent(t));
  if (!reminder) return all;
  const allow = new Set<string>(REMINDER_AI_TOOL_NAMES);
  return all.filter((t) => allow.has(t.function.name));
}

export function toolRequiresConfirmation(name: string): boolean {
  return specs.find((s) => s.def.function.name === name)?.requiresConfirmation ?? false;
}

export function toolRisk(name: string): ToolRisk | undefined {
  return specs.find((s) => s.def.function.name === name)?.risk;
}

/** Riskklass per verktyg – exporteras för dokumentation/framtida agenter. */
export function toolRegistrySummary(): { name: string; risk: ToolRisk }[] {
  return specs.map((s) => ({ name: s.def.function.name, risk: s.risk }));
}

/** Se ExecuteToolOptions ovan – exporterad typ ägs av registret. */

export async function executeTool(name: string, rawArgs: unknown, options: ExecuteToolOptions = {}): Promise<ToolResult> {
  const origin = options.origin ?? "user";
  const spec = specs.find((s) => s.def.function.name === name);
  if (!spec) return { ok: false, forModel: {}, error: `Okänt verktyg: ${name}` };

  const { currentActor } = await import("../collaboration/actor");
  const { toolAllowedForRole } = await import("../collaboration/permissions");
  const actor = currentActor();
  const role = options.actorRole ?? actor?.role;
  if (role && !toolAllowedForRole(name, role)) {
    logAudit(name, { blocked: "ROLE" }, false, 0, "Saknar behörighet");
    return { ok: false, forModel: {}, error: "Du har inte behörighet att göra det i det här företaget. Inget utfördes." };
  }
  if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
    const claimed = (rawArgs as Record<string, unknown>).businessId;
    const allowed = options.businessId ?? actor?.businessId;
    if (typeof claimed === "string" && allowed && claimed !== allowed) {
      logAudit(name, { blocked: "IDOR" }, false, 0, "Fel företag");
      return { ok: false, forModel: {}, error: "Verktyget får bara användas i det öppna företaget. Inget utfördes." };
    }
  }

  if (origin === "ai" && spec.risk === "FORBIDDEN_FOR_AI") {
    logAudit(name, { blocked: "FORBIDDEN_FOR_AI" }, false, 0, "Blockerat för AI");
    return { ok: false, forModel: {}, error: "Det verktyget får inte användas av assistenten. Inget utfördes." };
  }

  let args = (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? rawArgs : {}) as Record<string, unknown>;
  if (origin === "ai") {
    const { scope: _scopeIgnored, accountantScope: _acctScopeIgnored, ...safeRaw } = args;
    args = safeRaw;
    const validated = validateToolArgs(spec.def.function.parameters, safeRaw);
    if (!validated.ok) {
      logAudit(name, rawArgs, false, 0, validated.error);
      return { ok: false, forModel: {}, error: validated.error };
    }
    args = validated.value;
  }

  const started = Date.now();
  try {
    const result = await spec.handler(args, options);
    logAudit(name, args, result.ok, Date.now() - started, result.error);
    if (!result.ok && !result.error) {
      return { ...result, error: "Verktyget misslyckades. Inget sparades." };
    }
    return result;
  } catch (e) {
    const error = e instanceof Error ? e.message : "Okänt fel";
    logAudit(name, args, false, Date.now() - started, error);
    return { ok: false, forModel: {}, error: `${error}. Inget sparades.` };
  }
}

function logAudit(tool: string, params: unknown, success: boolean, ms: number, error?: string) {
  db().assistantAudit.push({
    id: uid(),
    at: new Date().toISOString(),
    tool,
    params,
    success,
    ms,
    error,
  });
}

export const ASSISTANT_TOOL_NAMES = specs.map((s) => s.def.function.name);
