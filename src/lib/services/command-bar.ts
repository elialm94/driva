import { db, save } from "../store";
import { kr } from "../format";
import type { AssistantCard } from "../types";
import {
  FREE_TEXT_FALLBACK_MESSAGE,
  getCommand,
  type CommandId,
} from "../command-bar";
import { aiCallableToolDefs, executeTool, type ToolResult } from "../ai/tools";
import { getAiIntentProvider } from "../ai/intent";
import type { LoopTurn } from "../ai/loop";
import { isAiConfigured } from "../ai/provider";
import { parseReminderText } from "../reminders/parse";
import { businessTimezone } from "./reminders";
import { getBusinessActions } from "./actions";
import { listCustomersForTable } from "./customers";
import { listJobsForTable } from "./job-list";
import { listInvoicesForTable } from "./economy-list";
import { nextPaymentPlanPartForJob, remainingToInvoiceForJob } from "./attention";
import { customerHref, invoiceHref, jobHref } from "../nav";

/**
 * Serverstöd för kommandofältet.
 *
 * All exekvering går genom verktygslagret (ai/tools → domäntjänster) – samma
 * väg som assistenten och en framtida LLM. Ingen affärslogik räknas här:
 * belopp, kvar-att-fakturera och åtgärder kommer från tjänsterna.
 *
 * Läsmodellerna (kunder/uppdrag/fakturor) används för entitetssök – begränsat
 * antal rader lämnar servern, aldrig hela registret.
 */

/* --------------------------------- Prefetch ---------------------------------- */

export interface QuickAction {
  id: string;
  label: string;
  run: { kind: "command"; commandId: CommandId } | { kind: "link"; href: string };
}

export interface CommandEntityHit {
  id: string;
  label: string;
  sublabel?: string;
  href: string;
}

export interface CommandBarPrefetch {
  /** Sant bara när en riktig LLM-nyckel finns – annars ärlig fallback utan nätverk. */
  aiConfigured: boolean;
  /** Dynamiska snabbåtgärder ur åtgärdsmotorn + statiska reserver. */
  quickActions: QuickAction[];
  /** Litet urval för direktvisade förslag – aldrig hela registret. */
  recentCustomers: CommandEntityHit[];
  activeJobs: CommandEntityHit[];
  recentInvoices: CommandEntityHit[];
}

const PREFETCH_COUNT = 5;
const QUICK_ACTION_COUNT = 4;

const STATIC_QUICK_ACTIONS: QuickAction[] = [
  { id: "qa-create-quote", label: "Skapa offert", run: { kind: "command", commandId: "create_quote" } },
  { id: "qa-create-invoice", label: "Skapa faktura", run: { kind: "command", commandId: "create_invoice" } },
  { id: "qa-new-customer", label: "Ny kund", run: { kind: "command", commandId: "create_customer" } },
];

/** Snabbåtgärder ur samma åtgärdsmotor som Hem – riktig data, inga påhitt. */
function quickActionsFromEngine(): QuickAction[] {
  const attention = getBusinessActions().attention;
  const chips: QuickAction[] = [];

  const overdue = attention.filter((a) => a.id.startsWith("invoice-late-"));
  if (overdue.length > 0) {
    chips.push({
      id: "qa-overdue",
      label: overdue.length === 1 ? "1 sen faktura" : `${overdue.length} sena fakturor`,
      run: { kind: "command", commandId: "show_overdue_invoices" },
    });
  }

  for (const a of attention) {
    if (chips.length >= 3) break;
    if (a.id.startsWith("invoice-late-")) continue; // samlade i räknaren ovan
    if (a.id.startsWith("rot-ready-")) {
      const kind = a.title.includes("RUT") ? "RUT" : "ROT";
      chips.push({ id: a.id, label: `${kind} redo · ${kr(a.amount ?? 0)}`, run: { kind: "link", href: a.href } });
    } else if (a.category === "job" && a.cta?.type === "createJobInvoice") {
      chips.push({ id: a.id, label: `Fakturera ${kr(a.amount ?? 0)}`, run: { kind: "link", href: a.href } });
    } else if (a.category === "inquiry") {
      chips.push({ id: a.id, label: "Ny förfrågan", run: { kind: "link", href: a.href } });
    } else if (a.category === "vat" && a.priority === "urgent") {
      chips.push({ id: a.id, label: "Moms ska deklareras", run: { kind: "link", href: a.href } });
    }
  }

  for (const fallback of STATIC_QUICK_ACTIONS) {
    if (chips.length >= QUICK_ACTION_COUNT) break;
    chips.push(fallback);
  }
  return chips.slice(0, QUICK_ACTION_COUNT);
}

export function commandBarPrefetch(): CommandBarPrefetch {
  const customers = listCustomersForTable({ sort: "aktivitet", pageSize: PREFETCH_COUNT }).rows.map((r) => ({
    id: r.id,
    label: r.name,
    sublabel: r.email || undefined,
    href: customerHref(r.id),
  }));
  const jobs = listJobsForTable({ lifecycle: "aktiva", pageSize: PREFETCH_COUNT }).rows.map((r) => ({
    id: r.id,
    label: r.title,
    sublabel: [r.customerName, r.economyLabel].filter(Boolean).join(" · ") || undefined,
    href: jobHref(r.id),
  }));
  const invoices = listInvoicesForTable({ pageSize: PREFETCH_COUNT }).rows.map((r) => ({
    id: r.id,
    label: r.label === "Utkast" ? "Fakturautkast" : `Faktura ${r.label}`,
    sublabel: [r.customerName, kr(r.amount)].filter(Boolean).join(" · ") || undefined,
    href: invoiceHref(r.id),
  }));

  return {
    aiConfigured: isAiConfigured(),
    quickActions: quickActionsFromEngine(),
    recentCustomers: customers,
    activeJobs: jobs,
    recentInvoices: invoices,
  };
}

/* -------------------------------- Entitetssök -------------------------------- */

export const ENTITY_SEARCH_LIMIT = 8;

/** Serversidigt kundsök via samma läsmodell som kundregistret. Max 8 träffar. */
export function searchCustomersForCommand(q: string, limit = ENTITY_SEARCH_LIMIT): CommandEntityHit[] {
  const query = q.trim();
  if (!query) return [];
  return listCustomersForTable({ q: query, sort: "aktivitet", pageSize: Math.min(limit, ENTITY_SEARCH_LIMIT) }).rows.map(
    (r) => ({
      id: r.id,
      label: r.name,
      sublabel: r.email || undefined,
      href: customerHref(r.id),
    })
  );
}

/* --------------------------------- Stegval ----------------------------------- */

export type InvoiceTargetOption =
  | { kind: "job"; jobId: string; label: string; sublabel: string; amount: number }
  | { kind: "standalone"; label: string; sublabel: string };

/**
 * "Vad gäller fakturan?" – fakturerbara uppdrag med belopp från samma
 * pengalogik som Uppdrag/åtgärdsmotorn: remainingToInvoiceForJob och
 * nextPaymentPlanPartForJob. Beloppet som visas är det som
 * createNextInvoiceForJob faktiskt skapar – aldrig omräknat här.
 */
export function invoiceTargetOptionsFor(customerId: string): InvoiceTargetOption[] {
  const jobs = db().jobs.filter((j) => j.customerId === customerId);
  const withRemaining = jobs
    .map((job) => ({ job, remaining: remainingToInvoiceForJob(job.id) }))
    .filter((x) => x.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining);

  const options: InvoiceTargetOption[] = withRemaining.map(({ job, remaining }) => {
    // Samma villkor som createNextInvoiceForJob: pågående uppdrag med fler
    // delar kvar i betalningsplanen → nästa del, annars resterande belopp.
    const next = job.status !== "klart" ? nextPaymentPlanPartForJob(job.id) : null;
    const partNext = next && !next.isLast ? next : null;
    return {
      kind: "job",
      jobId: job.id,
      label: job.title,
      sublabel: partNext
        ? `${kr(partNext.amount)} · nästa delbetalning (${kr(remaining)} kvar enligt offert)`
        : `${kr(remaining)} kvar enligt offert`,
      amount: partNext ? partNext.amount : remaining,
    };
  });
  options.push({
    kind: "standalone",
    label: "Fristående faktura",
    sublabel: "Tomt utkast utan koppling till uppdrag",
  });
  return options;
}

export interface QuoteTopicOption {
  requestId: string;
  label: string;
  sublabel: string;
}

/** "Vad gäller offerten?" – öppna förfrågningar för kunden (samma inbox som Kunder). */
export function quoteTopicOptionsFor(customerId: string): QuoteTopicOption[] {
  return db()
    .requests.filter((r) => r.customerId === customerId && r.status === "ny")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5)
    .map((r) => {
      const compact = r.message.replace(/\s+/g, " ").trim();
      return {
        requestId: r.id,
        label: r.title,
        sublabel: compact.length > 80 ? `${compact.slice(0, 77)}…` : compact,
      };
    });
}

/* -------------------------------- Exekvering --------------------------------- */

export interface CommandRunResult {
  ok: boolean;
  text: string;
  card?: AssistantCard;
  requiresConfirmation?: boolean;
  /** Primär djuplänk (t.ex. skapat utkast) – klienten navigerar dit direkt. */
  href?: string;
  /** Sant när fri text inte kunde tolkas och ingen LLM är konfigurerad. */
  notConfigured?: boolean;
}

export interface CommandRunParams {
  customerId?: string;
  jobId?: string;
  requestId?: string;
  title?: string;
}

function missingParam(what: string): ToolResult {
  return { ok: false, forModel: {}, error: `${what} krävs. Inget sparades.` };
}

function toRunResult(result: ToolResult): CommandRunResult {
  return {
    ok: result.ok,
    text: result.ok
      ? result.text ?? "Klart."
      : result.error ?? result.text ?? "Det gick inte. Inget sparades.",
    card: result.card,
    requiresConfirmation: result.requiresConfirmation,
    href: result.card?.kind === "entity" ? result.card.href : undefined,
  };
}

/**
 * Kör ett kommando via verktygslagret. Stegflödenas parametrar (kund, uppdrag,
 * förfrågan, titel) kommer från klientens val – aldrig fri text hit.
 */
export async function runBarCommand(commandId: CommandId, params: CommandRunParams = {}): Promise<CommandRunResult> {
  const def = getCommand(commandId);
  let result: ToolResult;

  if (def.run.kind === "tool") {
    result = await executeTool(def.run.tool, def.run.args ?? {});
  } else if (def.run.kind === "flow") {
    switch (def.id) {
      case "create_invoice":
        result = params.jobId
          ? await executeTool("create_job_invoice", { jobId: params.jobId })
          : params.customerId
            ? await executeTool("create_invoice", { customerId: params.customerId })
            : missingParam("Kund");
        break;
      case "create_quote":
        result = params.customerId
          ? await executeTool("create_quote", {
              customerId: params.customerId,
              requestId: params.requestId,
              title: params.title ?? "",
            })
          : missingParam("Kund");
        break;
      case "create_assignment":
        result =
          params.customerId && params.title?.trim()
            ? await executeTool("create_assignment", { customerId: params.customerId, title: params.title.trim() })
            : missingParam(params.customerId ? "Titel" : "Kund");
        break;
      default:
        // find_customer avslutas i klienten (ren navigering till kundkortet).
        result = { ok: false, forModel: {}, error: "Kommandot körs i klienten." };
    }
  } else {
    result = { ok: false, forModel: {}, error: "Kommandot körs i klienten." };
  }

  // Utkast och väntande bekräftelser ska överleva requesten (Supabase-commit).
  if (result.ok) save();
  return toRunResult(result);
}

/* ------------------------------ Fri text → LLM ------------------------------- */

const MAX_CLIENT_TURNS = 6;
const MAX_CLIENT_TURN_CHARS = 400;

/** Sanera fleragskontext från klienten: begränsat antal, begränsad längd. */
export function sanitizeTurns(turns: unknown): LoopTurn[] {
  if (!Array.isArray(turns)) return [];
  return turns
    .filter(
      (t): t is LoopTurn =>
        !!t &&
        typeof t === "object" &&
        ((t as LoopTurn).role === "user" || (t as LoopTurn).role === "assistant") &&
        typeof (t as LoopTurn).text === "string"
    )
    .slice(-MAX_CLIENT_TURNS)
    .map((t) => ({ role: t.role, text: t.text.slice(0, MAX_CLIENT_TURN_CHARS) }));
}

/**
 * Sista utväg för fri text som den deterministiska tolkningen inte klarar.
 * Utan konfigurerad LLM svarar Noop-leverantören "not_configured" och
 * användaren får den ärliga fallbacktexten – aldrig ett fejkat svar.
 *
 * Med OpenRouter körs hela verktygsloopen serverside: modellen ser bara
 * AI-anropbara verktyg (aldrig FORBIDDEN_FOR_AI) och komprimerade resultat.
 * `turns` är det senaste utbytet i fältet så uppföljningsfrågor fungerar
 * ("Fakturera Johan" → "Altanen eller köket?" → "Altanen").
 */
export async function interpretFreeTextViaAi(text: string, turns: LoopTurn[] = []): Promise<CommandRunResult> {
  // Deterministisk snabbväg: vanliga påminnelsefraser ("påminn mig imorgon
  // att …") skapas utan LLM – noll kostnad, samma verktygshanterare (samma
  // länknings- och tidspolicy). Bara första meddelandet – uppföljningar i en
  // pågående AI-konversation ska förbli hos modellen.
  if (turns.length === 0) {
    const parsed = parseReminderText(text, new Date(), businessTimezone());
    if (parsed) {
      const result = await executeTool("create_reminder", parsed.args, { origin: "user" });
      save();
      return toRunResult(result);
    }
  }

  const provider = getAiIntentProvider();
  const intent = await provider.interpret(text, aiCallableToolDefs(), {
    today: new Date().toISOString().slice(0, 10),
    locale: "sv",
    turns,
  });

  switch (intent.kind) {
    case "not_configured":
      return { ok: false, text: FREE_TEXT_FALLBACK_MESSAGE, notConfigured: true };
    case "none":
      return { ok: false, text: FREE_TEXT_FALLBACK_MESSAGE };
    case "answer":
      return { ok: true, text: intent.text };
    case "unavailable":
      // Loggen (llm_request med fel) ska överleva requesten även vid fel.
      save();
      return { ok: false, text: intent.text };
    case "final": {
      // Utkast, pendingActions och användningslogg ska överleva requesten.
      save();
      // Ingen auto-navigering: användaren ser modellens svar + kort med
      // djuplänk ("Öppna …") och väljer själv – utkastet är redan skapat.
      return {
        ok: intent.ok,
        text: intent.text,
        card: intent.card,
        requiresConfirmation: intent.requiresConfirmation,
      };
    }
    case "tool_call": {
      // Äldre ett-stegs-leverantör (openai-compatible): kör verktyget här.
      const result = await executeTool(intent.tool, intent.args, { origin: "ai" });
      if (result.ok) save();
      return toRunResult(result);
    }
  }
}
