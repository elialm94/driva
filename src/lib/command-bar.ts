/**
 * Kommandoregistret för kommandofältet (Hem + Assistent).
 *
 * REN, klientsäker modul: ingen databas, inga tjänster – bara statisk metadata
 * och deterministisk matchning/tolkning som körs i webbläsaren utan nätverk.
 *
 * Exekveringen sker på servern i src/lib/services/command-bar.ts via SAMMA
 * verktygslager som assistenten (src/lib/ai/tools.ts). Registret är därmed
 * exporterbart till en framtida LLM-agent: kommandon pekar på verktyg via
 * `run.tool`, och testerna verifierar att varje verktyg finns i registret.
 *
 * Princip: HELA originalfrasen → intent + argument. Autocomplete identifierar
 * intent men slänger ALDRIG resten. Deterministiskt först, LLM sen.
 */

import { DEFAULT_TIMEZONE } from "./reminders/when";
import {
  isPaymentReminderQuery,
  isReminderIntentQuery,
  parseReminderCommandInput,
  type ReminderCommandParse,
} from "./reminders/parse";

export type CommandRisk = "READ_ONLY" | "SAFE_WRITE" | "CONFIRM_REQUIRED";

export type CommandIcon =
  | "invoice"
  | "quote"
  | "job"
  | "customer"
  | "customerAdd"
  | "search"
  | "alert"
  | "clock"
  | "today"
  | "receipt"
  | "send"
  | "list"
  | "globe"
  | "handshake";

/** Steg i ett kontextflöde. Prompterna är det användaren ser i fältet. */
export type CommandStep =
  | { kind: "customer"; prompt: string }
  /** Riktiga fakturerbara uppdrag (kvar enligt offert) + fristående faktura. */
  | { kind: "invoiceTarget"; prompt: string }
  /** Inkommande uppdrag utan offert att utgå ifrån, annars kort titel. */
  | { kind: "quoteTopic"; prompt: string }
  | { kind: "title"; prompt: string; placeholder: string }
  /** Tidpunkt för intern påminnelse – parsas med parseReminderText. */
  | { kind: "when"; prompt: string; placeholder: string };

export type CommandRun =
  /** Körs direkt via verktygslagret (ai/tools), med ev. fasta argument. */
  | { kind: "tool"; tool: string; args?: Record<string, unknown> }
  /** Stegflöde som avslutas på servern via verktygslagret. */
  | { kind: "flow"; steps: CommandStep[]; cta: string; finishTool: string }
  /** Ren djuplänk – ingen serverkörning. */
  | { kind: "navigate"; href: string }
  /** Öppnar befintlig kundmodal (NewCustomerModal). */
  | { kind: "newCustomer" };

export type CommandWorkspace = "owner" | "accountant";

export type CommandId =
  | "create_invoice"
  | "create_quote"
  | "create_assignment"
  | "create_reminder"
  | "create_customer"
  | "find_customer"
  | "show_unpaid_invoices"
  | "show_overdue_invoices"
  | "show_open_quotes"
  | "show_today_actions"
  | "show_watching"
  | "show_invoices"
  | "upload_receipt"
  | "remind_late_invoices"
  | "review_vat"
  | "accountant_who_needs_help"
  | "accountant_vat_week"
  | "accountant_missing_docs"
  | "accountant_bank_diff"
  | "accountant_whats_open"
  | "accountant_unusual"
  | "accountant_reconcile"
  | "create_website"
  | "invite_accountant";

export interface CommandDef {
  id: CommandId;
  label: string;
  /** Sekundär rad i listan. */
  hint: string;
  /**
   * Starka fraser: exakt träff i fri text ger hög konfidens och kör kommandot.
   * Små bokstäver, utan skiljetecken.
   */
  aliases: string[];
  /** Svaga ord: bidrar bara till autocomplete och "Menade du?". */
  keywords: string[];
  icon: CommandIcon;
  risk: CommandRisk;
  /** Vad kommandot behöver innan det kan köra. */
  requiredContext: "customer" | null;
  run: CommandRun;
  /** Ordningsvikt vid lika poäng (högre först). */
  priority: number;
  /** Default owner – redovisningsfältet ser bara accountant. */
  workspace?: CommandWorkspace;
}

/**
 * Ärlig tomtext när deterministisk tolkning inte räcker och ingen LLM är
 * konfigurerad. Vi låtsas ALDRIG att en modell har svarat.
 */
export const FREE_TEXT_FALLBACK_MESSAGE =
  "Jag kan ännu inte tolka helt fri text. Välj en åtgärd nedan.";

/** Kommandon som visas som förslag när inget matchar. */
export const FALLBACK_COMMAND_IDS: CommandId[] = ["create_quote", "create_invoice", "create_customer"];

export const ACCOUNTANT_FALLBACK_COMMAND_IDS: CommandId[] = [
  "accountant_who_needs_help",
  "accountant_vat_week",
  "accountant_missing_docs",
  "accountant_bank_diff",
];

export function commandWorkspace(cmd: CommandDef): CommandWorkspace {
  return cmd.workspace ?? "owner";
}

export const COMMANDS: CommandDef[] = [
  {
    id: "create_invoice",
    label: "Skapa faktura",
    hint: "Utkast – skickas aldrig automatiskt",
    aliases: ["fakturera", "skapa faktura", "ny faktura", "gör en faktura", "skapa fakturautkast", "slutfakturera"],
    keywords: ["faktura", "fakturautkast", "invoice"],
    icon: "invoice",
    risk: "SAFE_WRITE",
    requiredContext: "customer",
    run: {
      kind: "flow",
      steps: [
        { kind: "customer", prompt: "Vem vill du fakturera?" },
        { kind: "invoiceTarget", prompt: "Vad gäller fakturan?" },
      ],
      cta: "Skapa fakturautkast",
      finishTool: "create_invoice",
    },
    priority: 9,
  },
  {
    id: "create_quote",
    label: "Skapa offert",
    hint: "Utkast – skickas aldrig automatiskt",
    aliases: ["skapa offert", "ny offert", "offerera", "gör en offert", "ta fram offert", "skapa en offert"],
    keywords: ["offert", "offertutkast", "anbud", "quote"],
    icon: "quote",
    risk: "SAFE_WRITE",
    requiredContext: "customer",
    run: {
      kind: "flow",
      steps: [
        { kind: "customer", prompt: "Vem ska offerten till?" },
        { kind: "quoteTopic", prompt: "Vad gäller offerten?" },
      ],
      cta: "Skapa offertutkast",
      finishTool: "create_quote",
    },
    priority: 8,
  },
  {
    id: "create_assignment",
    label: "Skapa uppdrag",
    hint: "Nytt uppdrag för en kund",
    aliases: ["skapa uppdrag", "nytt uppdrag", "skapa jobb", "nytt jobb", "boka uppdrag", "lägg upp uppdrag"],
    keywords: ["uppdrag", "jobb", "projekt"],
    icon: "job",
    risk: "SAFE_WRITE",
    requiredContext: "customer",
    run: {
      kind: "flow",
      steps: [
        { kind: "customer", prompt: "Vem är uppdraget åt?" },
        { kind: "title", prompt: "Vad ska göras?", placeholder: "T.ex. Badrumsrenovering" },
      ],
      cta: "Skapa uppdrag",
      finishTool: "create_assignment",
    },
    priority: 7,
  },
  {
    id: "create_reminder",
    label: "Skapa påminnelse",
    hint: "Intern påminnelse till dig – skickas inte till kunden",
    aliases: ["skapa påminnelse", "påminnelse", "ny påminnelse", "påminn mig", "påminn", "kom ihåg", "reminder"],
    keywords: ["påminnelse", "påminn", "komma ihåg", "kom ihåg", "reminder"],
    icon: "clock",
    risk: "SAFE_WRITE",
    requiredContext: null,
    run: {
      kind: "flow",
      steps: [
        { kind: "title", prompt: "Vad vill du bli påmind om?", placeholder: "T.ex. Ring Göran" },
        { kind: "when", prompt: "När? (valfritt)", placeholder: "imorgon / onsdag / ingen tid" },
      ],
      cta: "Skapa påminnelse",
      finishTool: "create_reminder",
    },
    priority: 8,
  },
  {
    id: "create_customer",
    label: "Ny kund",
    hint: "Lägg till privatperson eller företag",
    aliases: ["ny kund", "skapa kund", "lägg till kund", "registrera kund"],
    keywords: ["kund", "kontakt", "customer"],
    icon: "customerAdd",
    risk: "SAFE_WRITE",
    requiredContext: null,
    run: { kind: "newCustomer" },
    priority: 6,
  },
  {
    id: "find_customer",
    label: "Hitta kund",
    hint: "Sök och öppna kundkortet",
    aliases: ["hitta kund", "sök kund", "öppna kund", "visa kund", "gå till kund"],
    keywords: ["kund", "kundkort", "sök"],
    icon: "search",
    risk: "READ_ONLY",
    requiredContext: "customer",
    run: {
      kind: "flow",
      steps: [{ kind: "customer", prompt: "Vilken kund letar du efter?" }],
      cta: "Öppna kund",
      finishTool: "find_customers",
    },
    priority: 5,
  },
  {
    id: "show_unpaid_invoices",
    label: "Visa obetalda fakturor",
    hint: "Vem har inte betalat?",
    aliases: [
      "vem har inte betalat",
      "vilka har inte betalat",
      "vilka kunder har inte betalat",
      "obetalda fakturor",
      "visa obetalda fakturor",
      "väntar på betalning",
    ],
    keywords: ["obetalt", "obetalda", "fakturor", "betalning", "fordringar"],
    icon: "alert",
    risk: "READ_ONLY",
    requiredContext: null,
    run: { kind: "tool", tool: "list_unpaid_invoices" },
    priority: 4,
  },
  {
    id: "show_overdue_invoices",
    label: "Visa sena fakturor",
    hint: "Förfallna fakturor med dagar och belopp",
    aliases: [
      "visa sena fakturor",
      "sena fakturor",
      "försenade fakturor",
      "förfallna fakturor",
      "vilka fakturor är sena",
      "vilka fakturor är försenade",
    ],
    keywords: ["sen", "sena", "försenad", "förfallen", "fakturor"],
    icon: "clock",
    risk: "READ_ONLY",
    requiredContext: null,
    run: { kind: "tool", tool: "list_overdue_invoices" },
    priority: 3,
  },
  {
    id: "show_open_quotes",
    label: "Visa öppna offerter",
    hint: "Skickade offerter som väntar på signering",
    aliases: ["visa öppna offerter", "öppna offerter", "offerter som väntar", "väntar på signering", "väntar på bankid", "skickade offerter"],
    keywords: ["offerter", "signering", "bankid", "väntar", "svar"],
    icon: "clock",
    risk: "READ_ONLY",
    requiredContext: null,
    run: { kind: "tool", tool: "list_quotes", args: { status: "skickad" } },
    priority: 3,
  },
  {
    id: "show_today_actions",
    label: "Vad behöver jag göra idag?",
    hint: "Samma åtgärdslista som Hem",
    aliases: [
      "vad behöver jag göra idag",
      "vad behöver jag göra",
      "vad ska jag göra idag",
      "att göra idag",
      "att göra",
      "dagens åtgärder",
    ],
    keywords: ["idag", "åtgärder", "todo", "göra"],
    icon: "today",
    risk: "READ_ONLY",
    requiredContext: null,
    run: { kind: "tool", tool: "list_actions" },
    priority: 4,
  },
  {
    id: "show_watching",
    label: "Vad är på gång?",
    hint: "Samma översikt som Hem → På gång",
    aliases: ["vad är på gång", "vad händer", "vad kommer", "på gång", "vad är på gång just nu"],
    keywords: ["pågående", "kommande", "väntar", "startar"],
    icon: "clock",
    risk: "READ_ONLY",
    requiredContext: null,
    run: { kind: "tool", tool: "list_watching" },
    priority: 4,
  },
  {
    id: "show_invoices",
    label: "Visa fakturor",
    hint: "Öppna fakturaregistret",
    aliases: ["visa fakturor", "öppna fakturor", "alla fakturor", "fakturalistan"],
    keywords: ["fakturor", "register", "lista"],
    icon: "list",
    risk: "READ_ONLY",
    requiredContext: null,
    run: { kind: "navigate", href: "/ekonomi?flik=fakturor" },
    priority: 4,
  },
  {
    id: "upload_receipt",
    label: "Ladda upp kvitto",
    hint: "Fota eller ladda upp – bokförs automatiskt",
    aliases: ["ladda upp kvitto", "fota kvitto", "lägg till kvitto", "nytt kvitto"],
    keywords: ["kvitto", "utgift", "köp", "underlag"],
    icon: "receipt",
    risk: "SAFE_WRITE",
    requiredContext: null,
    run: { kind: "navigate", href: "/ekonomi?flik=utgifter" },
    priority: 3,
  },
  {
    id: "create_website",
    label: "Skapa en hemsida",
    hint: "Aktiverar Hemsida och öppnar byggaren",
    aliases: [
      "skapa en hemsida",
      "skapa hemsida",
      "ny hemsida",
      "bygg hemsida",
      "aktivera hemsida",
      "öppna hemsida",
    ],
    keywords: ["hemsida", "website", "sajt"],
    icon: "globe",
    risk: "SAFE_WRITE",
    requiredContext: null,
    run: { kind: "tool", tool: "activate_website" },
    priority: 6,
  },
  {
    id: "invite_accountant",
    label: "Bjud in redovisningskonsult",
    hint: "Aktiverar Samarbeta och öppnar inbjudan",
    aliases: [
      "bjud in min redovisningskonsult",
      "bjud in redovisningskonsult",
      "bjud in revisor",
      "aktivera samarbeta",
      "öppna samarbeta",
    ],
    keywords: ["samarbeta", "redovisningskonsult", "revisor", "konsult"],
    icon: "handshake",
    risk: "SAFE_WRITE",
    requiredContext: null,
    run: { kind: "tool", tool: "activate_collaboration" },
    priority: 5,
  },
  {
    id: "remind_late_invoices",
    label: "Skicka betalningspåminnelse",
    hint: "E-post till kunder med sena fakturor – kräver bekräftelse",
    aliases: [
      "skicka betalningspåminnelse",
      "påminn om sena fakturor",
      "skicka påminnelse",
      "skicka påminnelser",
      "påminn kunder",
    ],
    keywords: ["betalningspåminnelse", "sena", "fakturor"],
    icon: "send",
    risk: "CONFIRM_REQUIRED",
    requiredContext: null,
    run: { kind: "tool", tool: "send_reminders" },
    priority: 2,
  },
  {
    id: "review_vat",
    label: "Granska inför moms",
    hint: "Undantag som blockerar deklarationen – samma åtgärdsmotor",
    aliases: [
      "granska inför moms",
      "granska x inför moms",
      "granska moms",
      "momsgranskning",
      "vad behövs inför moms",
    ],
    keywords: ["moms", "granska", "deklaration"],
    icon: "alert",
    risk: "READ_ONLY",
    requiredContext: null,
    run: { kind: "tool", tool: "list_accountant_exceptions" },
    priority: 5,
    workspace: "accountant",
  },
  {
    id: "accountant_who_needs_help",
    label: "Vilka klienter behöver min hjälp?",
    hint: "Undantag över klienterna – samma åtgärdsmotor",
    aliases: ["vilka klienter behöver min hjälp", "vilka klienter behöver hjälp", "klienter som behöver hjälp"],
    keywords: ["klienter", "hjälp", "undantag"],
    icon: "alert",
    risk: "READ_ONLY",
    requiredContext: null,
    run: { kind: "tool", tool: "list_accountant_exceptions" },
    priority: 8,
    workspace: "accountant",
  },
  {
    id: "accountant_vat_week",
    label: "Moms denna vecka",
    hint: "Momsundantag i aktuellt läge",
    aliases: ["moms denna vecka", "moms den här veckan"],
    keywords: ["moms", "vecka"],
    icon: "alert",
    risk: "READ_ONLY",
    requiredContext: null,
    run: { kind: "tool", tool: "list_accountant_exceptions" },
    priority: 7,
    workspace: "accountant",
  },
  {
    id: "accountant_missing_docs",
    label: "Saknade underlag",
    hint: "Kvitton och underlag som saknas",
    aliases: ["saknade underlag", "saknade kvitton", "underlag saknas"],
    keywords: ["underlag", "kvitto"],
    icon: "receipt",
    risk: "READ_ONLY",
    requiredContext: null,
    run: { kind: "tool", tool: "list_accountant_exceptions" },
    priority: 7,
    workspace: "accountant",
  },
  {
    id: "accountant_bank_diff",
    label: "Bankavvikelser",
    hint: "Differenser och omatchade betalningar",
    aliases: ["bankavvikelser", "bankavvikelse", "stäm av banken", "stam av banken"],
    keywords: ["bank", "differens", "avstämning"],
    icon: "alert",
    risk: "READ_ONLY",
    requiredContext: null,
    run: { kind: "tool", tool: "list_accountant_exceptions" },
    priority: 6,
    workspace: "accountant",
  },
  {
    id: "accountant_whats_open",
    label: "Vad behöver hanteras?",
    hint: "Öppna undantag i aktuellt läge",
    aliases: ["vad behöver hanteras", "vad behöver jag göra", "vad behöver min bedömning"],
    keywords: ["hanteras", "göra", "undantag"],
    icon: "today",
    risk: "READ_ONLY",
    requiredContext: null,
    run: { kind: "tool", tool: "list_accountant_exceptions" },
    priority: 8,
    workspace: "accountant",
  },
  {
    id: "accountant_unusual",
    label: "Visa ovanliga transaktioner",
    hint: "Bank- och bokföringsundantag",
    aliases: ["visa ovanliga transaktioner", "ovanliga transaktioner"],
    keywords: ["ovanliga", "transaktioner"],
    icon: "list",
    risk: "READ_ONLY",
    requiredContext: null,
    run: { kind: "tool", tool: "list_accountant_exceptions" },
    priority: 4,
    workspace: "accountant",
  },
  {
    id: "accountant_reconcile",
    label: "Stäm av banken",
    hint: "Samma avstämning som i Driva",
    aliases: ["stäm av banken", "avstäm banken"],
    keywords: ["stäm", "avstäm", "bank"],
    icon: "alert",
    risk: "READ_ONLY",
    requiredContext: null,
    run: { kind: "tool", tool: "list_accountant_exceptions" },
    priority: 5,
    workspace: "accountant",
  },
];

export function getCommand(id: CommandId): CommandDef {
  const def = COMMANDS.find((c) => c.id === id);
  if (!def) throw new Error(`Okänt kommando: ${id}`);
  return def;
}

/* ------------------------------- Normalisering ------------------------------- */

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[?!.,:;"”']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(phrase: string): string[] {
  return phrase.split(" ").filter(Boolean);
}

/** Enkel subsekvens-fuzzy: alla tecken i q förekommer i ordning i w. */
function isSubsequence(q: string, w: string): boolean {
  let i = 0;
  for (const ch of w) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return i === q.length;
}

/* ------------------------------ Autocomplete-match ---------------------------- */

export interface CommandMatch {
  command: CommandDef;
  score: number;
}

interface Phrase {
  text: string;
  weight: number;
}

function phrasesFor(cmd: CommandDef): Phrase[] {
  return [
    { text: normalize(cmd.label), weight: 1 },
    ...cmd.aliases.map((a) => ({ text: normalize(a), weight: 0.95 })),
    ...cmd.keywords.map((k) => ({ text: normalize(k), weight: 0.7 })),
  ];
}

/** Bästa poäng för en enskild sökterm mot en fras (helfras eller per ord). */
function tokenScore(token: string, phrase: Phrase): number {
  let best = 0;
  if (phrase.text === token) best = 100;
  else if (phrase.text.startsWith(token)) best = 70;
  for (const w of words(phrase.text)) {
    if (w === token) best = Math.max(best, 60);
    else if (w.startsWith(token)) best = Math.max(best, 45);
    else if (token.length >= 3 && token.length <= w.length && isSubsequence(token, w)) {
      best = Math.max(best, 15);
    }
  }
  return best * phrase.weight;
}

function commandScore(cmd: CommandDef, query: string): number {
  const phrases = phrasesFor(cmd);
  const q = normalize(query);
  if (!q) return 0;

  // Helfrasnivå: hela frågan mot hela frasen.
  let phraseLevel = 0;
  for (const p of phrases) {
    if (p.text === q) phraseLevel = Math.max(phraseLevel, 100 * p.weight);
    else if (p.text.startsWith(q)) phraseLevel = Math.max(phraseLevel, 85 * p.weight);
  }

  // Ordnivå: snitt av varje sökords bästa träff (ord som inte träffar drar ner).
  const tokens = words(q);
  let sum = 0;
  for (const t of tokens) {
    let best = 0;
    for (const p of phrases) best = Math.max(best, tokenScore(t, p));
    sum += best;
  }
  const tokenLevel = tokens.length > 0 ? sum / tokens.length : 0;

  const raw = Math.max(phraseLevel, tokenLevel);
  return raw > 0 ? raw + cmd.priority : 0;
}

/** Lägsta poäng för att alls visas som förslag. */
const MATCH_MIN_SCORE = 20;
/** Lägsta poäng för "Menade du?" (låg konfidens) vid fri text. */
const SUGGEST_MIN_SCORE = 40;

/**
 * Klientmatchning för autocomplete: prefix/alias/nyckelord + enkel fuzzy.
 * Ren funktion, noll nätverk.
 */
export function matchCommands(query: string, limit = 6, workspace: CommandWorkspace = "owner"): CommandMatch[] {
  const q = normalize(query);
  if (!q) return [];
  return COMMANDS.filter((command) => commandWorkspace(command) === workspace)
    .map((command) => ({ command, score: commandScore(command, q) }))
    .filter((m) => m.score >= MATCH_MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.command.label.localeCompare(b.command.label, "sv"))
    .slice(0, limit);
}

/* --------------------------- Deterministisk fri text --------------------------- */

export type ParsedInput =
  /** Kör kommandot direkt; ev. kundnamn förifylls i kundsteget. */
  | { confidence: "high"; commandId: CommandId; entityQuery?: string }
  /** "Menade du?" med 2–3 kommandoförslag. */
  | { confidence: "low"; suggestions: CommandId[] }
  /** Ärligt: vi förstår inte. Inget fejkat AI-svar. */
  | { confidence: "none" };

/**
 * Fullständig kommandotolkning: originalfrasen bevaras alltid. Autocomplete
 * eller alias-träff är BARA intent – argumenten kommer ur hela `source`.
 */
export type ParsedCommand =
  | {
      confidence: "high";
      commandId: CommandId;
      /** Hela originalfrasen – skickas till parsern, aldrig en avhuggen etikett. */
      source: string;
      /** Text efter intentfrasen (kund, belopp, uppgift …). Tom om bara alias. */
      leftover: string;
      entityQuery?: string;
      reminder?: ReminderCommandParse;
    }
  | { confidence: "low"; suggestions: CommandId[]; source: string; leftover: string }
  | { confidence: "none"; source: string; leftover: string };

/** Texten efter en känd intentfras – tom sträng om frågan BARA var aliaset. */
export function leftoverAfterIntent(source: string, commandId: CommandId): string {
  const cmd = getCommand(commandId);
  const raw = source.replace(/\s+/g, " ").trim();
  const n = normalize(raw);
  if (!n) return "";
  const phrases = [normalize(cmd.label), ...cmd.aliases.map(normalize)].sort((a, b) => b.length - a.length);
  for (const p of phrases) {
    if (!p) continue;
    if (n === p) return "";
    if (n.startsWith(`${p} `)) {
      const idx = n.indexOf(p);
      // Samma längd i normaliserad form ≈ samma antal tecken i början.
      return raw.slice(idx + p.length).trim();
    }
  }
  // Inget rent prefix – hela frasen är leftover (parsern tar originalet).
  return raw;
}

/** Ord som aldrig är kundnamn – rensas ur infångade namnfraser. */
const NAME_STOPWORDS = new Set([
  "en", "ett", "den", "det", "min", "mitt", "mina", "kund", "kunden", "ny", "nytt",
  "idag", "imorgon", "nu", "sen", "gärna", "tack",
]);

function cleanEntityQuery(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // Klipp vid fras som beskriver innehåll snarare än kund: "för köket", "om altanen" …
  const cut = raw.split(/\s+(?:för|om|gällande|angående|avseende|på)\s+/)[0] ?? raw;
  const parts = words(normalize(cut)).filter((w) => !NAME_STOPWORDS.has(w));
  const name = parts.slice(0, 3).join(" ").trim();
  return name.length >= 2 ? name : undefined;
}

interface HighPattern {
  commandId: CommandId;
  re: RegExp;
  /** Fångstgrupp med kundnamn, om mönstret har en. */
  entityGroup?: number;
}

/**
 * Verbmönster med hög konfidens. Matchar från strängens början så att
 * "fakturera Johan" och "skapa offert till Anna" träffar direkt.
 */
const HIGH_PATTERNS: HighPattern[] = [
  { commandId: "create_invoice", re: /^fakturera\s+(.+)$/, entityGroup: 1 },
  { commandId: "create_invoice", re: /^(?:skapa|gör|ta fram)\s+(?:en\s+)?(?:ny\s+)?(?:slut)?faktura(?:utkast)?(?:\s+(?:till|för|åt)\s+(.+))?$/, entityGroup: 1 },
  { commandId: "create_invoice", re: /^ny\s+faktura(?:\s+(?:till|för|åt)\s+(.+))?$/, entityGroup: 1 },
  { commandId: "create_quote", re: /^offerera\s+(.+)$/, entityGroup: 1 },
  { commandId: "create_quote", re: /^(?:skapa|gör|ta fram)\s+(?:en\s+)?(?:ny\s+)?offert(?:utkast)?(?:\s+(?:till|för|åt)?\s*(.+))?$/, entityGroup: 1 },
  { commandId: "create_quote", re: /^ny\s+offert(?:\s+(?:till|för|åt)\s+(.+))?$/, entityGroup: 1 },
  { commandId: "create_assignment", re: /^(?:skapa|boka|lägg upp)\s+(?:ett\s+)?(?:nytt\s+)?(?:uppdrag|jobb)(?:\s+(?:till|för|åt|hos)?\s*(.+))?$/, entityGroup: 1 },
  { commandId: "find_customer", re: /^(?:hitta|sök|öppna|visa|gå till)\s+kund(?:en)?\s+(.+)$/, entityGroup: 1 },
  { commandId: "show_unpaid_invoices", re: /^(?:vem|vilka)(?:\s+\S+){0,4}\s+inte\s+betalat.*$/ },
  { commandId: "show_overdue_invoices", re: /^(?:visa\s+)?(?:sena|försenade|förfallna)\s+fakturor$/ },
  { commandId: "show_overdue_invoices", re: /^vilka\s+fakturor\s+är\s+(?:sena|försenade)$/ },
  { commandId: "show_today_actions", re: /^vad\s+(?:behöver|ska|måste)\s+jag\s+göra(?:\s+idag)?$/ },
  { commandId: "show_watching", re: /^vad\s+(?:är\s+)?på\s+gång(?:\s+just\s+nu)?$/ },
  { commandId: "show_watching", re: /^vad\s+händer(?:\s+just\s+nu)?$/ },
  { commandId: "create_reminder", re: /^påminnelse$/ },
  { commandId: "create_reminder", re: /^påminn(a)?( mig)?$/ },
  { commandId: "create_reminder", re: /^skapa påminnelse$/ },
  // Extern kund-e-post – inte intern påminnelse. "påminnelse" ensamt ska inte träffa här.
  { commandId: "remind_late_invoices", re: /^skicka\s+(?:en\s+)?påminnelse(?:r)?(?:\s+till\s+.+)?$/ },
];

/**
 * Deterministisk tolkning av fri text – regler och alias, ingen modell.
 * Hög konfidens kör kommandoflödet, låg ger "Menade du?", ingen ger den
 * ärliga fallbacktexten (FREE_TEXT_FALLBACK_MESSAGE).
 */
export function parseFreeText(text: string, workspace: CommandWorkspace = "owner"): ParsedInput {
  const t = normalize(text);
  if (!t) return { confidence: "none" };

  // 1. Exakt alias/etikett → hög konfidens utan kundnamn.
  for (const cmd of COMMANDS) {
    if (commandWorkspace(cmd) !== workspace) continue;
    if (normalize(cmd.label) === t || cmd.aliases.some((a) => normalize(a) === t)) {
      return { confidence: "high", commandId: cmd.id };
    }
  }

  // 2. Verbmönster → hög konfidens, ev. med kundnamn till kundsteget.
  for (const p of HIGH_PATTERNS) {
    const cmd = COMMANDS.find((c) => c.id === p.commandId);
    if (cmd && commandWorkspace(cmd) !== workspace) continue;
    const m = t.match(p.re);
    if (!m) continue;
    const entityQuery = p.entityGroup ? cleanEntityQuery(m[p.entityGroup]) : undefined;
    return { confidence: "high", commandId: p.commandId, entityQuery };
  }

  // 3. Delträffar → låg konfidens med förslag.
  const suggestions = matchCommands(t, 3, workspace).filter((m) => m.score >= SUGGEST_MIN_SCORE);
  if (suggestions.length > 0) {
    return { confidence: "low", suggestions: suggestions.map((m) => m.command.id) };
  }

  return { confidence: "none" };
}

/**
 * HELA originalfrasen → intent + argument. Används av kommandofältet så att
 * autocomplete "Skapa påminnelse" aldrig reducerar inmatningen till bara
 * etiketten och startar en tom guide.
 *
 * Pipeline: full input → deterministisk intent+args → complete? annars
 * saknade fält (slot-fill) eller låg/ingen konfidens (LLM-reserv).
 */
export function parseCommand(
  text: string,
  workspace: CommandWorkspace = "owner",
  now: Date = new Date(),
  timezone: string = DEFAULT_TIMEZONE
): ParsedCommand {
  const source = text.replace(/\s+/g, " ").trim();
  if (!source) return { confidence: "none", source: "", leftover: "" };

  // Intern påminnelse: parsea ALLTID hela meningen innan något steg väljs.
  if (isReminderIntentQuery(source) && !isPaymentReminderQuery(source)) {
    const reminder = parseReminderCommandInput(source, now, timezone);
    return {
      confidence: "high",
      commandId: "create_reminder",
      source,
      leftover: source,
      reminder: reminder ?? { complete: false, missing: "both" },
    };
  }

  const parsed = parseFreeText(source, workspace);
  if (parsed.confidence === "high") {
    const leftover = leftoverAfterIntent(source, parsed.commandId);
    return {
      confidence: "high",
      commandId: parsed.commandId,
      source,
      leftover,
      entityQuery: parsed.entityQuery,
    };
  }
  if (parsed.confidence === "low") {
    return { confidence: "low", suggestions: parsed.suggestions, source, leftover: source };
  }
  return { confidence: "none", source, leftover: source };
}
