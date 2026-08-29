import { db } from "../store";
import { uid } from "../ids";
import { kr } from "../format";
import type { AssistantCard, Customer, Job, Reminder, ReminderRelatedType } from "../types";
import {
  DAYPARTS,
  WEEKDAYS_SV,
  formatDueAt,
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
import { markInquiryHandled } from "../services/customers";
import { listInbox } from "../services/inbox";
import type { AiToolDef } from "./provider";
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
  createJobInvoiceDraft,
  createQuoteDraft,
  listOpenInquiriesResult,
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
};

type ToolHandler = (args: Record<string, unknown>) => ToolResult | Promise<ToolResult>;

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
    due: formatDueAt(r.dueAt, r.timezone),
    dueAt: r.dueAt,
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

function handleCreateReminder(args: Record<string, unknown>): ToolResult {
  const title = str(args, "title");
  if (!title) return { ok: false, forModel: {}, error: "title krävs" };
  const when = whenFromArgs(args);
  if (!when) {
    return { ok: false, forModel: {}, error: "Ange när jag ska påminna (dag, klockslag eller relativ tid)." };
  }
  if ("error" in when) return { ok: false, forModel: {}, error: when.error };

  const link = resolveReminderLink(str(args, "relatedType"), str(args, "relatedQuery"));
  if ("ask" in link) return link.ask; // klargörande – inget skapas

  const created = createReminder({
    title,
    description: str(args, "description"),
    when,
    source: "assistant",
    related: link.related,
  });
  if (!created.ok) return { ok: false, forModel: {}, error: created.error };

  const reminder = created.reminder;
  const dueText = formatDueAt(reminder.dueAt, reminder.timezone);
  const parts = [`Klart – jag påminner dig ${dueText}.`];
  if (link.relatedLabel) parts.push(`Kopplad till ${link.relatedLabel}.`);
  if (link.note) parts.push(link.note);
  return {
    ok: true,
    forModel: { reminder: compactReminder(reminder) },
    text: parts.join(" "),
    card: {
      kind: "list",
      title: "Påminnelse skapad",
      rows: [{ label: reminder.title, value: dueText, href: reminderTargetHref(reminder) }],
    },
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
        name: "list_open_inquiries",
        description:
          "Lista öppna förfrågningar (list open inquiries). Samma inbox som Inbox. Använd före create_quote när användaren nämner en förfrågan, t.ex. Karins bokhylla.",
        parameters: obj({ q: { type: "string", description: "Valfritt sökord: kund, företag, text" } }),
      },
    },
    handler: (args) => fromDomain(listOpenInquiriesResult(str(args, "q"))),
  },
  {
    requiresConfirmation: false,
    risk: "READ_ONLY",
    def: {
      type: "function",
      function: {
        name: "list_inbox",
        description:
          "Lista inboxen: öppna hemsideförfrågningar och inkommande leverantörsmejl. Inte samma lista som Behöver din uppmärksamhet på Hem.",
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
                  label: r.title,
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
          text: "Inga fakturor är försenade just nu – allt ser bra ut.",
        };
      }
      return {
        ok: true,
        forModel: { invoices: late.map(compactInvoice), count: late.length },
        text: `${late.length === 1 ? "1 faktura är försenad" : `${late.length} fakturor är försenade`}:`,
        card: {
          kind: "list",
          title: "Försenade fakturor",
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
          "Att göra-listan – samma åtgärdsmotor som Hem (”Vad behöver jag göra idag?”). Förfallna fakturor, offertuppföljning, ROT/RUT, kvitton, bokföringsfrågor och moms.",
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
        description: "Markera uppdrag som klart (mark job done). Pågår räknas från startdatum – använd inte pagar för att starta arbete.",
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
        name: "create_quote",
        description:
          "Skapa offertutkast (create quote draft). Skickas inte. amountInclVat i kronor inkl. moms. ROT/RUT-villkor läggs till av offerttjänsten – skriv inte egna villkor. Om kunden har en öppen förfrågan (t.ex. Karins bokhylla) kopplas den automatiskt och markeras som hanterad – samma objekt som i inboxen.",
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
            requestId: { type: "string", description: "Förfrågan att koppla. Lämna tomt för att hitta öppen förfrågan automatiskt." },
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
      return fromDomain(createQuoteDraft({ customerId, title, amountInclVat: amount, percentAtStart: num(args, "percentAtStart"), rot, requestId: str(args, "requestId"), appliedTaxReduction }));
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
          "Skapa nästa fakturautkast för ett uppdrag (createNextInvoiceForJob): del enligt betalningsplanen, annars resterande som slutfaktura. Samma pengalogik som Hem-åtgärden – räkna inte om beloppet. Skickas inte.",
        parameters: obj({ jobId: { type: "string" } }, ["jobId"]),
      },
    },
    handler: (args) => {
      const jobId = str(args, "jobId");
      if (!jobId) return { ok: false, forModel: {}, error: "jobId krävs" };
      return fromDomain(createJobInvoiceDraft(jobId));
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
          "Skapa en persisterad påminnelse (create reminder). Ange NÄR med exakt ett tidsuttryck: whenIso (lokal tid), whenDate (+ valfri time/daypart), weekday (+ nextWeek/time/daypart), relativeMinutes/relativeHours/relativeDays, eller enbart daypart (idag). relatedType+relatedQuery kopplar till kund/offert/faktura/uppdrag – hitta ALDRIG på kopplingar. Svara alltid med den tolkade tidpunkten.",
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
        text: `Klart – påminnelsen "${updated.reminder.title}" gäller nu ${formatDueAt(updated.reminder.dueAt, updated.reminder.timezone)}.`,
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
        name: "mark_inquiry_handled",
        description:
          "Markera en kundförfrågan som hanterad (status ny → besvarad) när användaren redan haft kontakt och ingen offert ska skapas ('jag har pratat med Karin, ta bort förfrågan från att göra'). Förfrågan lämnar Behöver din uppmärksamhet men ligger kvar i inboxen/historiken. query = kundnamn eller ord ur förfrågan. Flera träffar → fråga, gissa aldrig.",
        parameters: obj({ query: { type: "string" } }, ["query"]),
      },
    },
    handler: (args) => {
      const query = str(args, "query") ?? "";
      if (!query) return { ok: false, forModel: {}, error: "query krävs" };
      const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const customers = new Map(db().customers.map((c) => [c.id, c]));
      const matches = db()
        .requests.filter((r) => r.status === "ny")
        .filter((r) => {
          const hay = `${customers.get(r.customerId)?.name ?? ""} ${r.title} ${r.message}`.toLowerCase();
          return tokens.every((t) => hay.includes(t));
        });
      if (matches.length === 0) {
        return { ok: false, forModel: { count: 0 }, error: `Ingen öppen förfrågan matchar "${query}".` };
      }
      if (matches.length > 1) {
        return {
          ok: true,
          forModel: {
            inquiries: matches.slice(0, 8).map((r) => ({ id: r.id, title: r.title, customer: customers.get(r.customerId)?.name })),
            count: matches.length,
          },
          text: `${matches.length} öppna förfrågningar matchar "${query}" – vilken menar du?`,
          card: {
            kind: "list",
            title: "Vilken förfrågan?",
            rows: matches.slice(0, 8).map((r) => ({
              label: r.title,
              value: customers.get(r.customerId)?.name ?? "",
              href: `/inbox/${r.id}`,
            })),
          },
        };
      }
      const request = markInquiryHandled(matches[0].id);
      const name = customers.get(request.customerId)?.name ?? "kunden";
      return {
        ok: true,
        forModel: { requestId: request.id, status: request.status },
        text: `Klart – förfrågan ”${request.title}” från ${name} är markerad som hanterad. Den ligger kvar bland förfrågningarna.`,
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

export type ExecuteToolOptions = {
  /**
   * "user" (standard): deterministiska flöden – kommandofältet, regeltolken,
   * bekräftelseknappar. "ai": modellgenererade anrop – FORBIDDEN_FOR_AI
   * blockeras och argumenten valideras strikt mot verktygets schema.
   */
  origin?: "user" | "ai";
};

export async function executeTool(name: string, rawArgs: unknown, options: ExecuteToolOptions = {}): Promise<ToolResult> {
  const origin = options.origin ?? "user";
  const spec = specs.find((s) => s.def.function.name === name);
  if (!spec) return { ok: false, forModel: {}, error: `Okänt verktyg: ${name}` };

  if (origin === "ai" && spec.risk === "FORBIDDEN_FOR_AI") {
    logAudit(name, { blocked: "FORBIDDEN_FOR_AI" }, false, 0, "Blockerat för AI");
    return { ok: false, forModel: {}, error: "Det verktyget får inte användas av assistenten. Inget utfördes." };
  }

  let args = (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? rawArgs : {}) as Record<string, unknown>;
  if (origin === "ai") {
    const validated = validateToolArgs(spec.def.function.parameters, rawArgs);
    if (!validated.ok) {
      logAudit(name, rawArgs, false, 0, validated.error);
      return { ok: false, forModel: {}, error: validated.error };
    }
    args = validated.value;
  }

  const started = Date.now();
  try {
    const result = await spec.handler(args);
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
