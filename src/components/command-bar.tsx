"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import {
  AlertCircle,
  Check,
  ChevronRight,
  Clock,
  CornerDownLeft,
  FileText,
  Hammer,
  List,
  ListTodo,
  Loader2,
  PenLine,
  Receipt,
  Search,
  Send,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import type { AssistantCard } from "@/lib/types";
import {
  ACCOUNTANT_FALLBACK_COMMAND_IDS,
  COMMANDS,
  FALLBACK_COMMAND_IDS,
  FREE_TEXT_FALLBACK_MESSAGE,
  commandWorkspace,
  getCommand,
  matchCommands,
  parseFreeText,
  type CommandDef,
  type CommandIcon,
  type CommandStep,
  type CommandWorkspace,
} from "@/lib/command-bar";
import {
  formatResolvedCommandCta,
  resolveUtteranceCorrections,
} from "@/lib/ai/corrections";
import { isInternalReminderIntent } from "@/lib/ai/utterance";
import {
  applyReminderFollowUp,
  formatReminderDateChip,
  parseReminderCommandInput,
  parseReminderText,
  prettyReminderTitle,
  previewReminderDue,
  previewReminderDueFromArgs,
  reminderArgsFromLocal,
  reminderLocalFromArgs,
  reminderNeedsReview,
} from "@/lib/reminders/parse";
import { DEFAULT_TIMEZONE } from "@/lib/reminders/when";
import { DateTimePopover as DateTimePicker } from "./date-time-picker";
import type {
  CommandBarPrefetch,
  CommandEntityHit,
  CommandRunResult,
  InvoiceTargetOption,
  QuoteTopicOption,
} from "@/lib/services/command-bar";
import {
  commandCustomerSearchAction,
  commandInvoiceTargetsAction,
  commandQuoteTopicsAction,
  interpretFreeTextAction,
  runCommandAction,
} from "@/app/command-actions";
import { cancelAssistantActionAction, confirmAssistantActionAction } from "@/app/actions";
import { AppLink, useAppNavigate } from "./app-link";
import { AssistantCardView } from "./assistant-ui";
import { NewCustomerModal } from "./new-customer-modal";
import { buttonClasses, cx } from "./ui";
import type { VoiceUiState } from "./voice-input-button";

/**
 * Röstinmatning: enbart ett alternativt sätt att fylla i fältet – transkriptet
 * granskas och skickas som vanlig text (aldrig autosänd). Laddas dynamiskt
 * utan SSR så Hems initiala bundle inte växer; döljer sig själv när
 * webbläsaren saknar taligenkänning.
 */
const VoiceInputButton = dynamic(() => import("./voice-input-button").then((m) => m.VoiceInputButton), {
  ssr: false,
});

/**
 * Kommandofältet: Spotlight-lik palett, ingen chatt.
 *
 * Deterministiskt först: kommandomatchning och fri-text-tolkning körs helt i
 * klienten (ren modul, noll nätverk). Entitetssök är debouncat serversök via
 * läsmodellerna. Exekvering går genom samma verktygslager som assistenten.
 * CONFIRM_REQUIRED-åtgärder visar befintliga bekräftelsekort – fältet kringgår
 * aldrig en bekräftelse. SAFE_WRITE skapar bara utkast och djuplänkar dit.
 */

/* ---------------------------------- Ikoner ------------------------------------ */

const ICONS: Record<CommandIcon, typeof FileText> = {
  invoice: FileText,
  quote: PenLine,
  job: Hammer,
  customer: Users,
  customerAdd: UserPlus,
  search: Search,
  alert: AlertCircle,
  clock: Clock,
  today: ListTodo,
  receipt: Receipt,
  send: Send,
  list: List,
};

/* ------------------------------- Interna typer -------------------------------- */

type StepKind = CommandStep["kind"] | "confirm";

interface FlowState {
  command: CommandDef;
  step: StepKind;
  customer?: CommandEntityHit;
  invoiceTarget?: InvoiceTargetOption;
  invoiceOptions?: InvoiceTargetOption[];
  quoteOptions?: QuoteTopicOption[];
  optionsLoading?: boolean;
  /**
   * Påminnelseflödet: den TOLKADE påminnelsen är källan till sanning – inte
   * brödsmulorna. reminderTitle är alltid VAD; när en enda mening även bar
   * NÄR ligger den tolkade tiden i reminderArgs och råtexten i
   * reminderSource (skickas till servern som tolkar om med samma parser).
   */
  reminderTitle?: string;
  reminderArgs?: Record<string, string | number | boolean>;
  reminderSource?: string;
}

type BarItem =
  | { key: string; kind: "command"; command: CommandDef; entityQuery?: string }
  | { key: string; kind: "entity"; hit: CommandEntityHit }
  | { key: string; kind: "createCustomer"; name: string }
  | { key: string; kind: "invoiceTarget"; option: InvoiceTargetOption }
  | { key: string; kind: "quoteTopic"; option: QuoteTopicOption }
  | { key: string; kind: "customTitle" }
  | { key: string; kind: "titleSubmit"; title: string; submitText?: string; actionLabel?: string; sublabel?: string; icon?: CommandIcon }
  | { key: string; kind: "link"; label: string; sublabel?: string; href: string; icon: CommandIcon }
  /** Skicka frågan som fri text till LLM:n – visas bara med konfigurerad nyckel. */
  | { key: string; kind: "aiInterpret"; text: string }
  /** Deterministisk påminnelse ("påminn mig imorgon att …") – noll LLM. */
  | { key: string; kind: "reminderCreate"; text: string; title: string; due?: string };

interface Section {
  title?: string;
  items: BarItem[];
}

interface PanelModel {
  sections: Section[];
  /** Första raden förvald (Enter kör den). Falskt i ärligt "förstår inte"-läge. */
  preselect: boolean;
  /** Visa den ärliga fallbacktexten ovanför förslagen. */
  honest: boolean;
  emptyText?: string;
}

const IDLE_COMMAND_COUNT = 6;
const RECENT_PER_GROUP = 3;

function idleCommandItems(workspace: CommandWorkspace): BarItem[] {
  return [...COMMANDS]
    .filter((c) => commandWorkspace(c) === workspace)
    .sort((a, b) => b.priority - a.priority || a.label.localeCompare(b.label, "sv"))
    .slice(0, IDLE_COMMAND_COUNT)
    .map((command) => ({ key: `cmd-${command.id}`, kind: "command" as const, command }));
}

function commandItem(command: CommandDef, entityQuery?: string): BarItem {
  return { key: `cmd-${command.id}`, kind: "command", command, entityQuery };
}

/* ------------------------------- Huvudkomponent ------------------------------- */

export function CommandBar({
  prefetch,
  variant,
}: {
  prefetch: CommandBarPrefetch;
  variant: "hem" | "full" | "accountant";
}) {
  const workspace: CommandWorkspace = variant === "accountant" ? "accountant" : "owner";
  const navigate = useAppNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [flow, setFlow] = useState<FlowState | null>(null);
  const [hits, setHits] = useState<CommandEntityHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<CommandRunResult | null>(null);
  /**
   * Lättviktig fleragskontext för fri text via LLM: senaste utbytet skickas
   * med nästa tolkning så uppföljningssvar ("Altanen") fortsätter samma
   * flöde. Ingen historik-UI, inget permanent minne – nollställs vid
   * kommandostart/stängning.
   */
  const [aiTurns, setAiTurns] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [customerModal, setCustomerModal] = useState<null | { name: string; mode: "flow" | "navigate" }>(null);
  /** Röstinmatning: kapabilitet/aktivitet styr fältets padding och ⌘K-märket. */
  const [voiceUi, setVoiceUi] = useState<VoiceUiState>({ available: false, active: false });
  /** Vänligt röstfel (t.ex. nekad mikrofon) i panelens befintliga hintyta. */
  const [voiceHint, setVoiceHint] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const containerRef = useRef<HTMLDivElement>(null);
  const desktopInputRef = useRef<HTMLInputElement>(null);
  const sheetInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchSeq = useRef(0);
  const listboxId = useId();

  /* ------------------------------ Miljödetektering ---------------------------- */

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => {
      (isMobile ? sheetInputRef.current : desktopInputRef.current)?.focus();
    });
  }, [isMobile]);

  /* ------------------------------- Tillståndsbyten ---------------------------- */

  const resetAll = useCallback(() => {
    setQuery("");
    setFlow(null);
    setHits(null);
    setResult(null);
    setAiTurns([]);
    setSearching(false);
  }, []);

  const closeAll = useCallback(() => {
    resetAll();
    setOpen(false);
    desktopInputRef.current?.blur();
  }, [resetAll]);

  const navigateTo = useCallback(
    (href: string) => {
      closeAll();
      navigate(href);
    },
    [closeAll, navigate]
  );

  function applyResult(res: CommandRunResult) {
    if (res.ok && res.href && !res.requiresConfirmation) {
      navigateTo(res.href);
      return;
    }
    // Lyckat: nollställ flödet helt. Misslyckat: behåll användarens text och
    // flödessteg så inget skrivet går förlorat – felet visas ovanpå.
    if (res.ok) {
      setFlow(null);
      setQuery("");
      setHits(null);
    }
    setResult(res);
  }

  function runTool(command: CommandDef) {
    setResult(null);
    startTransition(async () => {
      applyResult(await runCommandAction(command.id, {}));
    });
  }

  function startCommand(command: CommandDef, entityQuery?: string) {
    setResult(null);
    setAiTurns([]);
    if (command.run.kind === "navigate") {
      navigateTo(command.run.href);
      return;
    }
    if (command.run.kind === "newCustomer") {
      setCustomerModal({ name: entityQuery ?? "", mode: "navigate" });
      return;
    }
    if (command.run.kind === "tool") {
      runTool(command);
      return;
    }
    setFlow({ command, step: command.run.steps[0]?.kind ?? "customer" });
    setQuery(entityQuery ?? "");
    setHits(null);
    focusInput();
  }

  /** Kundsteget klart → nästa steg (eller navigera för Hitta kund). */
  function pickCustomer(hit: CommandEntityHit) {
    const current = flow;
    if (!current) return;
    if (current.command.id === "find_customer") {
      navigateTo(hit.href);
      return;
    }
    const steps = current.command.run.kind === "flow" ? current.command.run.steps : [];
    const next = steps[1]?.kind;
    if (!next) return;
    setQuery("");
    setHits(null);
    setFlow({ ...current, customer: hit, step: next, optionsLoading: next !== "title" });
    focusInput();

    if (next === "invoiceTarget") {
      startTransition(async () => {
        const options = await commandInvoiceTargetsAction(hit.id);
        setFlow((prev) =>
          prev && prev.customer?.id === hit.id && prev.step === "invoiceTarget"
            ? { ...prev, invoiceOptions: options, optionsLoading: false }
            : prev
        );
      });
    } else if (next === "quoteTopic") {
      startTransition(async () => {
        const options = await commandQuoteTopicsAction(hit.id);
        setFlow((prev) => {
          if (!prev || prev.customer?.id !== hit.id || prev.step !== "quoteTopic") return prev;
          // Inga inkommande uppdrag utan offert → hoppa direkt till titelsteget.
          if (options.length === 0) return { ...prev, quoteOptions: [], optionsLoading: false, step: "title" };
          return { ...prev, quoteOptions: options, optionsLoading: false };
        });
      });
    }
  }

  function finishInvoice() {
    const f = flow;
    if (!f?.customer || !f.invoiceTarget || pending) return;
    const jobId = f.invoiceTarget.kind === "job" ? f.invoiceTarget.jobId : undefined;
    const customerId = f.customer.id;
    startTransition(async () => {
      applyResult(await runCommandAction("create_invoice", { customerId, jobId }));
    });
  }

  function finishQuote(input: { jobId?: string; title: string }) {
    const f = flow;
    if (!f?.customer || pending) return;
    const customerId = f.customer.id;
    startTransition(async () => {
      applyResult(await runCommandAction("create_quote", { customerId, jobId: input.jobId, title: input.title }));
    });
  }

  function finishTitle(title: string) {
    const f = flow;
    if (!title.trim() || pending) return;
    if (f?.command.id === "create_reminder") {
      // Ingen stel guide: tolka HELA meningen först. Fanns både VAD och NÄR
      // ("Ring Göran klockan 8 imorgon") → direkt till förhandsvisningen;
      // annars fråga enbart efter tiden som faktiskt saknas.
      const parsed = parseReminderCommandInput(title, new Date(), DEFAULT_TIMEZONE);
      // Guidat/slot-fill: alltid redigerbar preview när VAD+NÄR finns.
      // HIGH+SAFE utanför guidat läge one-shotas av NL-vägen (påminn mig …).
      const pretty = prettyReminderTitle(parsed?.title || title.trim());
      setFlow(
        parsed?.complete
          ? {
              command: f.command,
              step: "when",
              reminderTitle: pretty,
              reminderArgs: parsed.args,
              reminderSource: title.trim(),
            }
          : { command: f.command, step: "when", reminderTitle: pretty }
      );
      setQuery("");
      focusInput();
      return;
    }
    if (!f?.customer) return;
    if (f.command.id === "create_quote") {
      finishQuote({ title: title.trim() });
      return;
    }
    const customerId = f.customer.id;
    startTransition(async () => {
      applyResult(await runCommandAction("create_assignment", { customerId, title: title.trim() }));
    });
  }

  function finishReminder() {
    const f = flow;
    if (!f || f.command.id !== "create_reminder" || !f.reminderTitle || pending) return;
    const now = new Date();
    const q = query.trim();
    let title = f.reminderTitle;
    let args = f.reminderArgs;
    if (q) {
      const follow = applyReminderFollowUp(args ?? {}, q, now, DEFAULT_TIMEZONE);
      if (follow) {
        title = follow.title ?? title;
        args = follow.args;
      }
    }
    const local = args ? reminderLocalFromArgs(args, now, DEFAULT_TIMEZONE) : null;
    if (!local) return;
    // Exakt det som visas – aldrig den ursprungliga parsade frasen bakom UI:t.
    startTransition(async () => {
      applyResult(
        await runCommandAction("create_reminder", {
          title,
          whenIso: local.whenIso,
          whenDate: local.date,
          time: local.time,
        })
      );
    });
  }

  function updateReminderTitle(nextTitle: string) {
    setFlow((f) =>
      f?.command.id === "create_reminder" ? { ...f, reminderTitle: nextTitle, reminderSource: undefined } : f
    );
  }

  function updateReminderWhen(date: string, time: string) {
    setQuery("");
    setFlow((f) => {
      if (!f || f.command.id !== "create_reminder") return f;
      return {
        ...f,
        reminderArgs: { ...reminderArgsFromLocal(date, time), title: f.reminderTitle ?? "" },
        reminderSource: undefined,
      };
    });
  }

  function runFreeTextViaAi(text: string) {
    const turns = aiTurns;
    startTransition(async () => {
      const res = await interpretFreeTextAction(text, turns);
      setAiTurns([...turns, { role: "user" as const, text }, { role: "assistant" as const, text: res.text }].slice(-6));
      applyResult(res);
    });
  }

  function stepBack() {
    setResult(null);
    setHits(null);
    const current = flow;
    if (current?.command.id === "create_reminder") {
      if (current.step === "when") {
        // Tillbaka till titelsteget med hela råtexten (ingen information tappas).
        setQuery(current.reminderSource ?? current.reminderTitle ?? "");
        setFlow({ command: current.command, step: "title" });
        return;
      }
      setQuery("");
      setFlow(null);
      return;
    }
    setQuery("");
    setFlow((f) => {
      if (!f) return null;
      if (f.step === "confirm") return { ...f, step: "invoiceTarget", invoiceTarget: undefined };
      if (f.step === "title" && f.command.id === "create_quote" && (f.quoteOptions?.length ?? 0) > 0) {
        return { ...f, step: "quoteTopic" };
      }
      if (f.step === "invoiceTarget" || f.step === "quoteTopic" || f.step === "title") {
        return { command: f.command, step: "customer" };
      }
      return null;
    });
  }

  function activateItem(item: BarItem) {
    if (pending) return;
    switch (item.kind) {
      case "command":
        startCommand(item.command, item.entityQuery);
        break;
      case "entity":
        pickCustomer(item.hit);
        break;
      case "createCustomer":
        setCustomerModal({ name: item.name, mode: flow ? "flow" : "navigate" });
        break;
      case "invoiceTarget":
        setFlow((f) => (f ? { ...f, invoiceTarget: item.option, step: "confirm" } : f));
        setQuery("");
        break;
      case "quoteTopic":
        finishQuote({ jobId: item.option.jobId, title: item.option.label });
        break;
      case "customTitle":
        setFlow((f) => (f ? { ...f, step: "title" } : f));
        setQuery("");
        focusInput();
        break;
      case "titleSubmit":
        finishTitle(item.submitText ?? item.title);
        break;
      case "link":
        navigateTo(item.href);
        break;
      case "aiInterpret":
        runFreeTextViaAi(item.text);
        break;
      case "reminderCreate":
        // Servern kör samma deterministiska tolkning och skapar utan LLM.
        runFreeTextViaAi(item.text);
        break;
    }
  }

  /* ------------------------------ Debouncat kundsök --------------------------- */

  const inCustomerStep = flow?.step === "customer";
  useEffect(() => {
    if (!inCustomerStep) return;
    const q = query.trim();
    if (!q) {
      setHits(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++searchSeq.current;
    const timer = setTimeout(() => {
      commandCustomerSearchAction(q)
        .then((rows) => {
          if (seq !== searchSeq.current) return;
          setHits(rows);
          setSearching(false);
        })
        .catch(() => {
          if (seq === searchSeq.current) setSearching(false);
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [query, inCustomerStep]);

  /* ------------------------------ Panelinnehåll ------------------------------- */

  const model: PanelModel = useMemo(() => {
    if (result) return { sections: [], preselect: false, honest: false };

    if (flow) {
      if (flow.step === "customer") {
        const q = query.trim();
        if (!q) {
          return {
            sections: [
              {
                title: "Senaste kunder",
                items: prefetch.recentCustomers.map((hit) => ({ key: `ent-${hit.id}`, kind: "entity" as const, hit })),
              },
            ],
            preselect: prefetch.recentCustomers.length > 0,
            honest: false,
          };
        }
        const items: BarItem[] = (hits ?? []).map((hit) => ({ key: `ent-${hit.id}`, kind: "entity" as const, hit }));
        if (q.length >= 2 && !searching && flow.command.id !== "find_customer") {
          items.push({ key: "create-customer", kind: "createCustomer", name: q });
        }
        return {
          sections: [{ items }],
          preselect: (hits?.length ?? 0) > 0,
          honest: false,
          emptyText: searching ? undefined : hits && hits.length === 0 ? `Ingen kund matchar ”${q}”.` : undefined,
        };
      }
      if (flow.step === "invoiceTarget") {
        return {
          sections: [
            {
              title: "Vad gäller fakturan?",
              items: (flow.invoiceOptions ?? []).map((option) => ({
                key: option.kind === "job" ? `job-${option.jobId}` : "standalone",
                kind: "invoiceTarget" as const,
                option,
              })),
            },
          ],
          preselect: (flow.invoiceOptions?.length ?? 0) > 0,
          honest: false,
        };
      }
      if (flow.step === "quoteTopic") {
        const items: BarItem[] = (flow.quoteOptions ?? []).map((option) => ({
          key: `job-${option.jobId}`,
          kind: "quoteTopic" as const,
          option,
        }));
        items.push({ key: "custom-title", kind: "customTitle" });
        return {
          sections: [{ title: "Inkommande uppdrag", items }],
          preselect: true,
          honest: false,
        };
      }
      if (flow.step === "title") {
        const title = query.trim();
        const isReminder = flow.command.id === "create_reminder";
        // Tolka hela meningen redan här: bär den både VAD och NÄR visas den
        // tolkade tiden direkt – tidssteget hoppas över vid Enter.
        const parsedReminder = isReminder && title ? parseReminderCommandInput(title, new Date(), DEFAULT_TIMEZONE) : null;
        const parsedDue =
          parsedReminder?.complete === true
            ? previewReminderDueFromArgs(parsedReminder.args, new Date(), DEFAULT_TIMEZONE)
            : null;
        const resolvedTitle =
          parsedReminder?.complete === true ? prettyReminderTitle(parsedReminder.title) : title;
        const clarify = isReminder ? resolveUtteranceCorrections(title).clarify : undefined;
        return {
          sections: [
            {
              items: title
                ? [
                    {
                      key: "title-submit",
                      kind: "titleSubmit" as const,
                      title: resolvedTitle,
                      submitText: title,
                      actionLabel: parsedDue ? "Skapa påminnelse" : isReminder ? "Fortsätt med" : "Skapa",
                      sublabel: isReminder
                        ? clarify
                          ? clarify
                          : parsedDue
                            ? formatResolvedCommandCta({ command: "Skapa påminnelse", detail: resolvedTitle, when: parsedDue })
                            : "Nästa: när ska du bli påmind?"
                        : "Enter för att skapa",
                      icon: isReminder ? ("clock" as const) : ("job" as const),
                    },
                  ]
                : [],
            },
          ],
          preselect: Boolean(title) && !clarify,
          honest: false,
        };
      }
      if (flow.step === "when") {
        const whenText = query.trim();
        const follow = whenText
          ? applyReminderFollowUp(flow.reminderArgs ?? {}, whenText, new Date(), DEFAULT_TIMEZONE)
          : null;
        const preview = follow
          ? previewReminderDueFromArgs(follow.args, new Date(), DEFAULT_TIMEZONE)
          : whenText
            ? previewReminderDue(whenText, new Date(), DEFAULT_TIMEZONE)
            : null;
        return {
          sections: [],
          preselect: false,
          honest: false,
          emptyText:
            whenText && !preview
              ? "Jag förstod inte tidpunkten. Prova imorgon, onsdag eller om 2 timmar."
              : undefined,
        };
      }
      return { sections: [], preselect: false, honest: false }; // confirm-steget renderas separat
    }

    const q = query.trim();
    if (!q) {
      const vanliga: Section = { title: "Vanliga åtgärder", items: idleCommandItems(workspace) };
      const senaste: Section = {
        title: "Senaste",
        items: [
          ...prefetch.recentCustomers.slice(0, RECENT_PER_GROUP).map((hit) => ({
            key: `rc-${hit.id}`,
            kind: "link" as const,
            label: hit.label,
            sublabel: hit.sublabel,
            href: hit.href,
            icon: "customer" as const,
          })),
          ...prefetch.activeJobs.slice(0, RECENT_PER_GROUP).map((hit) => ({
            key: `rj-${hit.id}`,
            kind: "link" as const,
            label: hit.label,
            sublabel: hit.sublabel,
            href: hit.href,
            icon: "job" as const,
          })),
          ...prefetch.recentInvoices.slice(0, RECENT_PER_GROUP).map((hit) => ({
            key: `ri-${hit.id}`,
            kind: "link" as const,
            label: hit.label,
            sublabel: hit.sublabel,
            href: hit.href,
            icon: "invoice" as const,
          })),
        ],
      };
      if (workspace === "accountant") {
        return { sections: [vanliga], preselect: false, honest: false };
      }
      // Mobil följer "Senaste/Vanliga", desktop leder med åtgärderna.
      return { sections: isMobile ? [senaste, vanliga] : [vanliga, senaste], preselect: false, honest: false };
    }

    const parsed = parseFreeText(q, workspace);
    const matches = matchCommands(q, IDLE_COMMAND_COUNT, workspace);
    // Deterministiska förslag leder alltid; med nyckel finns en explicit rad
    // för att skicka frågan till LLM:n när förslagen inte är det man menade.
    const aiRow: BarItem[] =
      prefetch.aiConfigured && parsed.confidence !== "high" ? [{ key: "ai-interpret", kind: "aiInterpret", text: q }] : [];

    // "Påminn mig … att …" med tydligt tidsuttryck → deterministisk påminnelse
    // (noll LLM). Samma rena tolk som servern använder; raden leder så att
    // Enter inte fastnar i luddiga kommandoträffar ("Påminn om sena fakturor").
    const reminderClarify = isInternalReminderIntent(q) ? resolveUtteranceCorrections(q) : null;
    if (reminderClarify?.confidence === "ambiguous" && reminderClarify.clarify) {
      return {
        sections: [{ items: [...matches.slice(0, 3).map((m) => commandItem(m.command)), ...aiRow] }],
        preselect: false,
        honest: false,
        emptyText: reminderClarify.clarify,
      };
    }
    const reminderParsed = isInternalReminderIntent(q) ? parseReminderText(q, new Date(), DEFAULT_TIMEZONE) : null;
    if (reminderParsed) {
      const resolvedTitle = prettyReminderTitle(reminderParsed.title);
      return {
        sections: [
          {
            items: [
              {
                key: "reminder-create",
                kind: "reminderCreate",
                text: q,
                title: resolvedTitle,
                // Tolkningen visas INNAN något skapas – aldrig en dold gissning.
                due: previewReminderDueFromArgs(reminderParsed.args, new Date(), DEFAULT_TIMEZONE) ?? undefined,
              },
              ...matches.slice(0, 3).map((m) => commandItem(m.command)),
            ],
          },
        ],
        preselect: true,
        honest: false,
      };
    }

    if (parsed.confidence === "high") {
      const primary = getCommand(parsed.commandId);
      const rest = matches
        .filter((m) => m.command.id !== parsed.commandId)
        .slice(0, 3)
        .map((m) => commandItem(m.command));
      return {
        sections: [{ items: [commandItem(primary, parsed.entityQuery), ...rest] }],
        preselect: true,
        honest: false,
      };
    }
    if (matches.length > 0) {
      return {
        sections: [{ items: [...matches.map((m) => commandItem(m.command)), ...aiRow] }],
        preselect: true,
        honest: false,
      };
    }
    if (parsed.confidence === "low") {
      return {
        sections: [
          { title: "Menade du?", items: [...parsed.suggestions.map((id) => commandItem(getCommand(id))), ...aiRow] },
        ],
        preselect: true,
        honest: false,
      };
    }
    return {
      sections: [
        {
          items: [
            ...aiRow,
            ...(workspace === "accountant" ? ACCOUNTANT_FALLBACK_COMMAND_IDS : FALLBACK_COMMAND_IDS).map((id) =>
              commandItem(getCommand(id))
            ),
          ],
        },
      ],
      preselect: false,
      honest: true,
    };
  }, [flow, hits, isMobile, prefetch, query, result, searching, workspace]);

  const flatItems = useMemo(() => model.sections.flatMap((s) => s.items), [model]);
  const flatKey = useMemo(() => flatItems.map((i) => i.key).join("|"), [flatItems]);

  // Pågående LLM-uppföljning: Enter svarar modellen (ingen förvald rad) –
  // pilar + Enter väljer fortfarande ett kommando explicit.
  const inAiConversation = aiTurns.length > 0 && prefetch.aiConfigured && !flow;
  const aiLastText = inAiConversation ? aiTurns[aiTurns.length - 1]?.text : undefined;

  useEffect(() => {
    setHighlight(model.preselect && !inAiConversation && flatItems.length > 0 ? 0 : -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatKey, model.preselect, inAiConversation]);

  useEffect(() => {
    if (highlight < 0) return;
    const el = listRef.current?.querySelector(`[data-bar-index="${highlight}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  /* ------------------------------- Tangentbord -------------------------------- */

  function onEscape() {
    if (result) {
      setResult(null);
      focusInput();
      return;
    }
    if (query) {
      setQuery("");
      return;
    }
    if (flow) {
      setFlow(null);
      setHits(null);
      return;
    }
    closeAll();
  }

  function onInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onEscape();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (flatItems.length === 0) return;
      e.preventDefault();
      setHighlight((h) => {
        const delta = e.key === "ArrowDown" ? 1 : -1;
        const next = h + delta;
        if (next < 0) return flatItems.length - 1;
        if (next >= flatItems.length) return 0;
        return next;
      });
      return;
    }
    if (e.key === "Backspace" && query === "" && flow) {
      e.preventDefault();
      stepBack();
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (flow?.step === "confirm") {
      finishInvoice();
      return;
    }
    if (flow?.step === "when") {
      finishReminder();
      return;
    }
    if (flow?.step === "title") {
      finishTitle(query);
      return;
    }
    if (highlight >= 0 && flatItems[highlight]) {
      activateItem(flatItems[highlight]);
      return;
    }
    // Fri text till LLM: i ärligt läge (deterministisk tolkning gav inget)
    // eller som uppföljningssvar i pågående AI-utbyte. Utan nyckel står
    // fallbacktexten redan i panelen och inget nätverksanrop görs.
    // Undantag: "påminn …"-fraser har en deterministisk snabbväg på servern
    // (noll LLM) och skickas alltid.
    const reminderPhrase = isInternalReminderIntent(query.trim());
    if (!flow && !result && query.trim() && (prefetch.aiConfigured || reminderPhrase) && (model.honest || inAiConversation || reminderPhrase)) {
      runFreeTextViaAi(query.trim());
    }
  }

  /* ------------------------------ Globala genvägar ---------------------------- */

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => {
          (window.matchMedia("(max-width: 1023px)").matches ? sheetInputRef.current : desktopInputRef.current)?.focus();
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Klick utanför stänger desktop-popovern (inte i full-layout eller när kundmodal är öppen).
  useEffect(() => {
    if (!open || isMobile || variant === "full" || customerModal) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as HTMLElement;
      if (containerRef.current?.contains(target)) return;
      if (target.closest?.("[data-datetime-picker]")) return;
      closeAll();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, isMobile, variant, customerModal, closeAll]);

  // Bakgrundsscroll låst medan mobilarket är öppet.
  useEffect(() => {
    if (!(open && isMobile)) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, isMobile]);

  /* -------------------------------- Rendering --------------------------------- */

  const activeStep: CommandStep | null =
    flow && flow.command.run.kind === "flow"
      ? flow.command.run.steps.find((s) => s.kind === flow.step) ?? null
      : null;

  const placeholder =
    flow?.step === "confirm"
      ? "Bekräfta nedan"
      : flow?.step === "when" && flow.reminderArgs
        ? "Ändra tid? Skriv t.ex. imorgon kl 9"
        : activeStep
          ? activeStep.kind === "title" || activeStep.kind === "when"
            ? activeStep.placeholder
            : activeStep.prompt
          : prefetch.placeholder ?? (workspace === "accountant" ? "Fråga om bokföringen…" : "Vad vill du göra?");

  // Förhandsvisningen = det som skulle skapas. Skriven NL-rättelse slås ihop
  // med redan visade fält; picker och inline-titel skriver samma tillstånd.
  const reminderDraft = (() => {
    if (flow?.command.id !== "create_reminder" || flow.step !== "when" || !flow.reminderTitle) return null;
    const now = new Date();
    const q = query.trim();
    let title = flow.reminderTitle;
    let args = flow.reminderArgs;
    let followUpError = false;
    if (q) {
      const follow = applyReminderFollowUp(args ?? {}, q, now, DEFAULT_TIMEZONE);
      if (!follow) followUpError = true;
      else {
        title = follow.title ?? title;
        args = follow.args;
      }
    }
    const local = args ? reminderLocalFromArgs(args, now, DEFAULT_TIMEZONE) : null;
    const preview = local
      ? previewReminderDueFromArgs(args ?? reminderArgsFromLocal(local.date, local.time), now, DEFAULT_TIMEZONE)
      : q
        ? previewReminderDue(q, now, DEFAULT_TIMEZONE)
        : null;
    return { title, args, local, preview, followUpError };
  })();

  const reminderPreview = reminderDraft?.preview ?? null;
  const showReminderReview =
    Boolean(reminderDraft?.local) &&
    reminderNeedsReview({ complete: true, confidence: "high", inGuidedFlow: true });

  const inputValueDisabled = flow?.step === "confirm" || flow?.step === "invoiceTarget" || flow?.step === "quoteTopic";

  const showPanelDesktop = variant === "full" ? true : open;

  const flowChips = flow ? (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line/70 px-3 py-2">
      <span className="inline-flex items-center gap-1 rounded-full bg-ink/6 px-2.5 py-1 text-[12px] font-medium text-ink">
        {flow.command.label}
      </span>
      {flow.customer ? (
        <>
          <ChevronRight className="size-3 text-muted" aria-hidden />
          <span className="inline-flex items-center rounded-full bg-ink/6 px-2.5 py-1 text-[12px] font-medium text-ink">
            {flow.customer.label}
          </span>
        </>
      ) : null}
      {flow.reminderTitle && !showReminderReview ? (
        <>
          <ChevronRight className="size-3 text-muted" aria-hidden />
          <span className="inline-flex items-center rounded-full bg-ink/6 px-2.5 py-1 text-[12px] font-medium text-ink">
            {flow.reminderTitle}
          </span>
        </>
      ) : null}
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault() /* behåll fokus i sökfältet */}
        onClick={stepBack}
        className="ml-auto text-[12px] font-medium text-muted transition-colors hover:text-ink"
      >
        Tillbaka
      </button>
    </div>
  ) : null;

  const panelBody = (
    <>
      {flowChips}
      {result ? (
        <ResultView result={result} onClose={() => { setResult(null); focusInput(); }} />
      ) : flow?.step === "confirm" && flow.customer && flow.invoiceTarget ? (
        <InvoiceConfirm
          customer={flow.customer}
          target={flow.invoiceTarget}
          cta={flow.command.run.kind === "flow" ? flow.command.run.cta : "Skapa"}
          pending={pending}
          onConfirm={finishInvoice}
          onBack={stepBack}
        />
      ) : flow?.step === "when" && flow.reminderTitle && showReminderReview && reminderDraft?.local ? (
        <ReminderConfirm
          title={reminderDraft.title}
          date={reminderDraft.local.date}
          time={reminderDraft.local.time}
          preview={reminderPreview}
          followUpError={reminderDraft.followUpError}
          cta={flow.command.run.kind === "flow" ? flow.command.run.cta : "Skapa påminnelse"}
          pending={pending}
          onConfirm={finishReminder}
          onTitleChange={updateReminderTitle}
          onWhenChange={updateReminderWhen}
        />
      ) : (
        <div ref={listRef} id={listboxId} role="listbox" aria-label="Förslag" className="py-1.5">
          {aiLastText && !result ? (
            <p className="border-b border-line/70 px-4 py-2.5 text-[13px] leading-relaxed text-soft">
              <span className="font-medium text-muted">Assistenten: </span>
              {aiLastText}
              <span className="ml-1.5 text-muted">– svara med Enter</span>
            </p>
          ) : null}
          {model.honest && !inAiConversation ? (
            <p className="px-4 pb-1 pt-2.5 text-[13.5px] leading-relaxed text-soft">
              {FREE_TEXT_FALLBACK_MESSAGE}
            </p>
          ) : null}
          {voiceHint ? (
            <p role="status" className="px-4 py-2.5 text-[13.5px] leading-relaxed text-danger">
              {voiceHint}
            </p>
          ) : null}
          {pending || (searching && query.trim() && flow?.step === "customer") || flow?.optionsLoading ? (
            <div className="flex items-center gap-2 px-4 py-2.5 text-[13px] text-muted">
              <Loader2 className="size-3.5 animate-spin" /> Hämtar …
            </div>
          ) : null}
          {model.emptyText && !searching ? (
            <p className="px-4 py-2.5 text-[13.5px] text-soft">{model.emptyText}</p>
          ) : null}
          {(() => {
            let index = -1;
            return model.sections.map((section, si) => {
              if (section.items.length === 0 && !section.title) return null;
              return (
                <div key={section.title ?? `s${si}`}>
                  {section.title && section.items.length > 0 ? (
                    <p className="px-4 pb-1 pt-3 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted">
                      {section.title}
                    </p>
                  ) : null}
                  {section.items.map((item) => {
                    index += 1;
                    const i = index;
                    return (
                      <ItemRow
                        key={item.key}
                        item={item}
                        index={i}
                        optionId={`${listboxId}-opt-${i}`}
                        active={i === highlight}
                        disabled={pending}
                        onHover={() => setHighlight(i)}
                        onActivate={() => activateItem(item)}
                      />
                    );
                  })}
                </div>
              );
            });
          })()}
        </div>
      )}
    </>
  );

  const quickActionChips =
    prefetch.quickActions.length > 0 ? (
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {prefetch.quickActions.map((qa) => {
          const run = qa.run;
          return run.kind === "link" ? (
            <AppLink
              key={qa.id}
              href={run.href}
              className="shrink-0 rounded-full border border-line bg-card px-3.5 py-1.5 text-[12.5px] font-medium text-soft transition-colors hover:border-accent hover:text-ink"
            >
              {qa.label}
            </AppLink>
          ) : (
            <button
              key={qa.id}
              type="button"
              disabled={pending}
              onClick={() => {
                setOpen(true);
                startCommand(getCommand(run.commandId));
              }}
              className="shrink-0 rounded-full border border-line bg-card px-3.5 py-1.5 text-[12.5px] font-medium text-soft transition-colors hover:border-accent hover:text-ink disabled:opacity-50"
            >
              {qa.label}
            </button>
          );
        })}
      </div>
    ) : null;

  const inputField = (forSheet: boolean) => (
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        ref={forSheet ? sheetInputRef : desktopInputRef}
        role="combobox"
        aria-expanded={showPanelDesktop || (open && isMobile)}
        aria-controls={listboxId}
        aria-activedescendant={highlight >= 0 ? `${listboxId}-opt-${highlight}` : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        enterKeyHint="go"
        value={inputValueDisabled ? "" : query}
        readOnly={inputValueDisabled}
        autoFocus={forSheet}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setResult(null);
          if (!forSheet) setOpen(true);
        }}
        onFocus={(e) => {
          if (!forSheet && isMobile) {
            e.currentTarget.blur();
            setOpen(true);
            return;
          }
          if (!forSheet) setOpen(true);
        }}
        onKeyDown={onInputKeyDown}
        className={cx(
          "h-12 w-full rounded-2xl border border-line-strong bg-card pl-10 text-ink placeholder:text-muted focus:border-accent",
          // Mikrofonen (och ev. ⌘K) behöver högerkant – utan röststöd som förut.
          voiceUi.active ? (forSheet ? "pr-48" : "pr-40") : voiceUi.available ? (forSheet ? "pr-14" : "pr-24") : "pr-16",
          forSheet ? "text-[16px]" : "text-[15px]"
        )}
      />
      {!forSheet ? (
        <kbd
          className={cx(
            "pointer-events-none absolute top-1/2 hidden -translate-y-1/2 rounded-md border border-line bg-canvas px-1.5 py-0.5 text-[11px] font-medium text-muted",
            voiceUi.available ? "right-12" : "right-3.5",
            !voiceUi.active && "lg:inline-block"
          )}
        >
          ⌘K
        </kbd>
      ) : null}
      {(forSheet || !isMobile) && !inputValueDisabled ? (
        <VoiceInputButton
          forSheet={forSheet}
          value={query}
          onValueChange={(next) => {
            setQuery(next);
            setResult(null);
          }}
          onActive={() => {
            setOpen(true);
            focusInput();
          }}
          onUiState={setVoiceUi}
          onHint={setVoiceHint}
        />
      ) : null}
    </div>
  );

  return (
    <div ref={containerRef} className={variant === "full" ? "relative" : "relative mt-8"}>
      {inputField(false)}
      {quickActionChips}

      {/* Desktop: popover (hem) eller inline-panel (full) */}
      {showPanelDesktop && !isMobile ? (
        <div
          className={cx(
            "overflow-hidden rounded-2xl border border-line bg-card",
            variant === "hem"
              ? "absolute inset-x-0 top-[3.4rem] z-40 max-h-[26rem] overflow-y-auto shadow-pop animate-fade-in"
              : "mt-4 max-h-[60vh] min-h-40 overflow-y-auto shadow-card"
          )}
        >
          {panelBody}
        </div>
      ) : null}

      {/* Mobil: fullbreddsark med eget sökfält – tangentbordet täcker aldrig fältet. */}
      {open && isMobile
        ? createPortal(
            <div className="fixed inset-0 z-50 flex h-dvh flex-col bg-canvas lg:hidden">
              <div className="flex items-center gap-2 border-b border-line bg-card px-3 pb-2.5 pt-[max(env(safe-area-inset-top),0.625rem)]">
                {inputField(true)}
                <button
                  type="button"
                  onClick={closeAll}
                  className="shrink-0 px-1.5 py-2 text-[14px] font-medium text-soft transition-colors hover:text-ink"
                >
                  Avbryt
                </button>
              </div>
              <div className="flex-1 overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
                {panelBody}
              </div>
            </div>,
            document.body
          )
        : null}

      <NewCustomerModal
        open={customerModal !== null}
        initialName={customerModal?.name ?? ""}
        onClose={() => setCustomerModal(null)}
        onCreated={(customer) => {
          const mode = customerModal?.mode ?? "navigate";
          setCustomerModal(null);
          if (mode === "flow" && flow) {
            pickCustomer({
              id: customer.id,
              label: customer.name,
              href: `/kunder/${customer.id}`,
            });
            return;
          }
          navigateTo(`/kunder/${customer.id}`);
        }}
      />
    </div>
  );
}

/* ----------------------------------- Rader ------------------------------------ */

function rowVisual(item: BarItem): { icon: CommandIcon; label: ReactNode; sublabel?: string } {
  switch (item.kind) {
    case "command":
      return {
        icon: item.command.icon,
        label: (
          <>
            {item.command.label}
            {item.entityQuery ? <span className="ml-1.5 text-soft">”{item.entityQuery}”</span> : null}
          </>
        ),
        sublabel: item.command.hint,
      };
    case "entity":
      return { icon: "customer", label: item.hit.label, sublabel: item.hit.sublabel };
    case "createCustomer":
      return { icon: "customerAdd", label: `Lägg till ”${item.name}” som ny kund`, sublabel: "Öppnar kundformuläret" };
    case "invoiceTarget":
      return {
        icon: item.option.kind === "job" ? "job" : "invoice",
        label: item.option.label,
        sublabel: item.option.sublabel,
      };
    case "quoteTopic":
      return { icon: "quote", label: item.option.label, sublabel: item.option.sublabel };
    case "customTitle":
      return { icon: "quote", label: "Egen titel …", sublabel: "Skriv en kort rubrik för offerten" };
    case "titleSubmit":
      return {
        icon: item.icon ?? "job",
        label: `${item.actionLabel ?? "Skapa"} ”${item.title}”`,
        sublabel: item.sublabel ?? "Enter för att skapa",
      };
    case "link":
      return { icon: item.icon, label: item.label, sublabel: item.sublabel };
    case "aiInterpret":
      return {
        icon: "search",
        label: "Fråga assistenten",
        sublabel: `Tolkar ”${item.text.length > 60 ? `${item.text.slice(0, 57)}…` : item.text}” med AI`,
      };
    case "reminderCreate":
      return {
        icon: "clock",
        label: formatResolvedCommandCta({
          command: "Skapa påminnelse",
          detail: item.title.length > 40 ? `${item.title.slice(0, 37)}…` : item.title,
          when: item.due,
        }),
        sublabel: "Enter för att skapa",
      };
  }
}

function ItemRow({
  item,
  index,
  optionId,
  active,
  disabled,
  onHover,
  onActivate,
}: {
  item: BarItem;
  index: number;
  optionId: string;
  active: boolean;
  disabled: boolean;
  onHover: () => void;
  onActivate: () => void;
}) {
  const { icon, label, sublabel } = rowVisual(item);
  const Icon = ICONS[icon];
  const confirmRequired = item.kind === "command" && item.command.risk === "CONFIRM_REQUIRED";
  return (
    <button
      type="button"
      data-bar-index={index}
      id={optionId}
      role="option"
      aria-selected={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault() /* behåll fokus i sökfältet */}
      onMouseMove={onHover}
      onClick={onActivate}
      className={cx(
        "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors max-lg:min-h-13 max-lg:py-3",
        active ? "bg-accent-soft/60" : "hover:bg-canvas/70",
        disabled && "opacity-60"
      )}
    >
      <span
        className={cx(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          active ? "bg-accent text-white" : "bg-ink/5 text-soft"
        )}
      >
        <Icon className="size-4" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-ink">{label}</span>
        {sublabel ? <span className="block truncate text-[12.5px] text-muted">{sublabel}</span> : null}
      </span>
      {confirmRequired ? (
        <span className="shrink-0 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn">
          Bekräftas
        </span>
      ) : null}
      {active ? <CornerDownLeft className="hidden size-3.5 shrink-0 text-muted lg:block" aria-hidden /> : null}
    </button>
  );
}

/* ------------------------------ Bekräftelsesteg ------------------------------- */

function InvoiceConfirm({
  customer,
  target,
  cta,
  pending,
  onConfirm,
  onBack,
}: {
  customer: CommandEntityHit;
  target: InvoiceTargetOption;
  cta: string;
  pending: boolean;
  onConfirm: () => void;
  onBack: () => void;
}) {
  return (
    <div className="p-4">
      <div className="rounded-xl border border-accent/25 bg-accent-soft/40 px-4 py-3.5">
        <p className="text-[14.5px] font-medium leading-relaxed text-ink">
          {customer.label} · {target.label}
          {target.kind === "job" ? ` · ${target.sublabel}` : ""}
        </p>
        <p className="mt-1 text-[13px] text-soft">
          {target.kind === "job"
            ? "Beloppet kommer från betalplanen/offerten – du kan justera i utkastet."
            : "Ett tomt utkast skapas – rader och belopp fyller du i där."}
        </p>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" className={buttonClasses("accent", "md")} disabled={pending} onClick={onConfirm}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          {cta}
        </button>
        <button type="button" className={buttonClasses("ghost", "md")} disabled={pending} onClick={onBack}>
          Tillbaka
        </button>
      </div>
      <p className="mt-2.5 text-[12px] text-muted">Utkast – skickas aldrig automatiskt.</p>
    </div>
  );
}

/**
 * Redigerbar förhandsvisning före create_reminder.
 *
 * Andra AI-utkast (audit, samma princip – rätta i preview, inte starta om):
 *  - Påminnelse: IMPLEMENTERAT här (titel + dag/tid).
 *  - Faktura: InvoiceConfirm är valt kund/mål, inte NL-parse. Utkastet
 *    öppnas och redigeras i dokumentet. Följ-upp: inte bygga om produktflödet.
 *  - Offert / uppdrag: skapas och navigerar till befintlig editor. Följ-upp.
 *  - Kund: NewCustomerModal är redan ett redigerbart formulär.
 */
function ReminderConfirm({
  title,
  date,
  time,
  preview,
  followUpError,
  cta,
  pending,
  onConfirm,
  onTitleChange,
  onWhenChange,
}: {
  title: string;
  date: string;
  time: string;
  preview: string | null;
  followUpError: boolean;
  cta: string;
  pending: boolean;
  onConfirm: () => void;
  onTitleChange: (title: string) => void;
  onWhenChange: (date: string, time: string) => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const [pickerOpen, setPickerOpen] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const whenAnchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTitleDraft(title);
  }, [title]);

  useEffect(() => {
    if (editingTitle) titleRef.current?.focus();
  }, [editingTitle]);

  function commitTitle() {
    const next = prettyReminderTitle(titleDraft);
    setTitleDraft(next);
    if (next) onTitleChange(next);
    setEditingTitle(false);
  }

  return (
    <div className="p-4">
      <div className="rounded-xl border border-accent/25 bg-accent-soft/40 px-4 py-3.5">
        <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted">Påminnelse</p>
        {editingTitle ? (
          <input
            ref={titleRef}
            value={titleDraft}
            onChange={(e) => {
              setTitleDraft(e.target.value);
              onTitleChange(e.target.value);
            }}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitTitle();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setTitleDraft(title);
                setEditingTitle(false);
              }
            }}
            className="mt-1 h-11 w-full rounded-lg border border-accent/30 bg-card px-2.5 text-[14.5px] font-medium text-ink"
            aria-label="Påminnelsetext"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingTitle(true)}
            className="mt-1 min-h-11 w-full rounded-lg px-2.5 py-1.5 text-left text-[14.5px] font-medium leading-relaxed text-ink transition-colors hover:bg-card/70"
          >
            {title}
          </button>
        )}
        <p className="mt-3 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted">När</p>
        <div ref={whenAnchorRef} className="mt-1 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="min-h-11 rounded-lg bg-card px-2.5 py-1.5 text-[13.5px] font-medium text-ink ring-1 ring-line transition-colors hover:ring-accent"
          >
            {formatReminderDateChip(date)}
          </button>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="min-h-11 rounded-lg bg-card px-2.5 py-1.5 text-[13.5px] font-medium tabular text-ink ring-1 ring-line transition-colors hover:ring-accent"
          >
            {time}
          </button>
        </div>
        {preview ? <p className="sr-only">{preview}</p> : null}
        {followUpError ? (
          <p role="status" className="mt-2 text-[12.5px] text-danger">
            Jag förstod inte tidpunkten. Prova imorgon, onsdag eller om 2 timmar.
          </p>
        ) : null}
      </div>
      <DateTimePicker
        date={date}
        time={time}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        anchorRef={whenAnchorRef}
        onChange={(next) => onWhenChange(next.date, next.time)}
      />
      <div className="mt-3 flex items-center gap-2">
        <button type="button" className={buttonClasses("accent", "md")} disabled={pending} onClick={onConfirm}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          {cta}
        </button>
      </div>
      <p className="mt-2.5 text-[12px] text-muted">Intern påminnelse – skickas inte till kunden.</p>
    </div>
  );
}

/* -------------------------------- Resultatpanel ------------------------------- */

function ResultView({ result, onClose }: { result: CommandRunResult; onClose: () => void }) {
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <p className={cx("text-[14px] leading-relaxed", result.ok ? "text-ink" : "text-soft")}>
          {result.ok ? <Check className="mr-1.5 inline size-4 -translate-y-px text-ok" aria-hidden /> : null}
          {result.text}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Stäng resultatet"
          className="-mr-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-ink/5 hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </div>
      {result.card ? (
        result.card.kind === "confirm" ? (
          <BarConfirmCard card={result.card} />
        ) : (
          <AssistantCardView card={result.card} busy={false} compact />
        )
      ) : null}
    </div>
  );
}

/**
 * Bekräftelsekort för CONFIRM_REQUIRED-resultat. Samma pendingAction-flöde och
 * server actions som assistentens kort – fältet kringgår aldrig bekräftelsen.
 */
function BarConfirmCard({ card }: { card: Extract<AssistantCard, { kind: "confirm" }> }) {
  const [state, setState] = useState<"vantar" | "utford" | "avbruten">(card.state);
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-accent/25 bg-accent-soft/40">
      <div className="px-3.5 py-3">
        <p className="text-[13.5px] font-medium leading-relaxed">{card.summary}</p>
        {card.rows?.length ? (
          <div className="mt-2 space-y-1">
            {card.rows.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="text-soft">{r.label}</span>
                {r.value ? <span className="font-medium tabular">{r.value}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="border-t border-accent/15 px-3.5 py-2.5">
        {state === "vantar" ? (
          <div className="flex gap-2">
            <button
              className={buttonClasses("primary", "sm")}
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await confirmAssistantActionAction(card.actionId);
                  setState("utford");
                })
              }
            >
              <Check className="size-3.5" /> {card.confirmLabel}
            </button>
            <button
              className={buttonClasses("ghost", "sm")}
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await cancelAssistantActionAction(card.actionId);
                  setState("avbruten");
                })
              }
            >
              <X className="size-3.5" /> Avbryt
            </button>
          </div>
        ) : (
          <p className={cx("text-[13px] font-medium", state === "utford" ? "text-ok" : "text-muted")}>
            {state === "utford" ? "Utfört." : "Avbrutet – inget skickades."}
          </p>
        )}
      </div>
    </div>
  );
}
