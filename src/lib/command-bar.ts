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
 * Princip: deterministiskt först, LLM sen. "Skriv tre bokstäver → välj → klart."
 */

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
  | "list";

/** Steg i ett kontextflöde. Prompterna är det användaren ser i fältet. */
export type CommandStep =
  | { kind: "customer"; prompt: string }
  /** Riktiga fakturerbara uppdrag (kvar enligt offert) + fristående faktura. */
  | { kind: "invoiceTarget"; prompt: string }
  /** Öppna förfrågningar att utgå ifrån, annars kort titel. */
  | { kind: "quoteTopic"; prompt: string }
  | { kind: "title"; prompt: string; placeholder: string };

export type CommandRun =
  /** Körs direkt via verktygslagret (ai/tools), med ev. fasta argument. */
  | { kind: "tool"; tool: string; args?: Record<string, unknown> }
  /** Stegflöde som avslutas på servern via verktygslagret. */
  | { kind: "flow"; steps: CommandStep[]; cta: string; finishTool: string }
  /** Ren djuplänk – ingen serverkörning. */
  | { kind: "navigate"; href: string }
  /** Öppnar befintlig kundmodal (NewCustomerModal). */
  | { kind: "newCustomer" };

export type CommandId =
  | "create_invoice"
  | "create_quote"
  | "create_assignment"
  | "create_customer"
  | "find_customer"
  | "show_unpaid_invoices"
  | "show_overdue_invoices"
  | "show_open_quotes"
  | "show_today_actions"
  | "show_watching"
  | "show_invoices"
  | "upload_receipt"
  | "remind_late_invoices";

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
}

/**
 * Ärlig tomtext när deterministisk tolkning inte räcker och ingen LLM är
 * konfigurerad. Vi låtsas ALDRIG att en modell har svarat.
 */
export const FREE_TEXT_FALLBACK_MESSAGE =
  "Jag kan ännu inte tolka helt fri text. Välj en åtgärd nedan.";

/** Kommandon som visas som förslag när inget matchar. */
export const FALLBACK_COMMAND_IDS: CommandId[] = ["create_quote", "create_invoice", "create_customer"];

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
    hint: "Skickade offerter som väntar på BankID",
    aliases: ["visa öppna offerter", "öppna offerter", "offerter som väntar", "väntar på bankid", "skickade offerter"],
    keywords: ["offerter", "bankid", "väntar", "svar"],
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
    id: "remind_late_invoices",
    label: "Påminn om sena fakturor",
    hint: "Kräver bekräftelse innan något skickas",
    aliases: ["påminn om sena fakturor", "skicka påminnelse", "skicka påminnelser", "påminn kunder"],
    keywords: ["påminnelse", "påminn", "sena", "fakturor"],
    icon: "send",
    risk: "CONFIRM_REQUIRED",
    requiredContext: null,
    run: { kind: "tool", tool: "send_reminders" },
    priority: 2,
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
export function matchCommands(query: string, limit = 6): CommandMatch[] {
  const q = normalize(query);
  if (!q) return [];
  return COMMANDS.map((command) => ({ command, score: commandScore(command, q) }))
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
];

/**
 * Deterministisk tolkning av fri text – regler och alias, ingen modell.
 * Hög konfidens kör kommandoflödet, låg ger "Menade du?", ingen ger den
 * ärliga fallbacktexten (FREE_TEXT_FALLBACK_MESSAGE).
 */
export function parseFreeText(text: string): ParsedInput {
  const t = normalize(text);
  if (!t) return { confidence: "none" };

  // 1. Exakt alias/etikett → hög konfidens utan kundnamn.
  for (const cmd of COMMANDS) {
    if (normalize(cmd.label) === t || cmd.aliases.some((a) => normalize(a) === t)) {
      return { confidence: "high", commandId: cmd.id };
    }
  }

  // 2. Verbmönster → hög konfidens, ev. med kundnamn till kundsteget.
  for (const p of HIGH_PATTERNS) {
    const m = t.match(p.re);
    if (!m) continue;
    const entityQuery = p.entityGroup ? cleanEntityQuery(m[p.entityGroup]) : undefined;
    return { confidence: "high", commandId: p.commandId, entityQuery };
  }

  // 3. Delträffar → låg konfidens med förslag.
  const suggestions = matchCommands(t, 3).filter((m) => m.score >= SUGGEST_MIN_SCORE);
  if (suggestions.length > 0) {
    return { confidence: "low", suggestions: suggestions.map((m) => m.command.id) };
  }

  return { confidence: "none" };
}
