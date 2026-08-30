import { db, save } from "../store";
import { uid } from "../ids";
import type { AssistantCard, AssistantMessage } from "../types";
import { findCustomersByName } from "./customers";
import { deleteOrArchiveJob, isIncomingUnquotedJob } from "./jobs";
import { bookExpenseToJob, undoExpenseBooking } from "./expenses";
import { postVerificationCorrection } from "./verification-correction";
import {
  followUpQuoteByEmail,
  issueAndEmailInvoice,
  remindInvoiceByEmail,
  sendQuoteWithEmail,
} from "./document-mail";
import { generateWebsite, publishWebsite } from "./website";
import { activateWebsiteModule } from "./modules";
import { applyBusinessProfilePatch } from "./settings";
import { purchaseDomain } from "../domains/purchase";
import { isDomainError } from "../domains/errors";
import { runBokslutAutomation, closeFiscalYear } from "../accounting/close";
import { markVatReportDeclared } from "../accounting/vat";
import { AiDemoLimitError, isAiConfigured, chatWithTools, type AiChatMessage } from "../ai/provider";
import { assistantToolDefs, executeTool } from "../ai/tools";
import { historyToAiMessages, systemPrompt } from "../ai/prompt";
import { resolveCustomerNameArg } from "../ai/corrections";
import { isBankIdApprovalRequest, parseAmountInclVat, parseAppliedTaxReduction, parseFlexibleDate, cap, resolveCustomerName } from "../ai/resolve";
import {
  ambiguousCustomers,
  bankIdRefuseResult,
  companyStatusResult,
  createQuoteDraft,
  createJobDraft,
  createInvoiceDraft,
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
  unpaidInvoicesResult,
  businessProfileResult,
  requestPurchaseDomain,
  getDomainStatusResult,
  type DomainResult,
} from "../ai/domain";
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
} from "../ai/accounting-domain";

/**
 * Assistenten är en riktig operativ assistent: den utför handlingar via samma
 * tjänstelager som resten av produkten. `interpret` är integrationspunkten för
 * LLM med tool calling. Utan AI_API_KEY används regelbaserad fallback – vi
 * låtsas inte att en modell svarar.
 *
 * Viktiga externa handlingar (skicka, påminna, publicera) kräver alltid
 * bekräftelse. Assistenten kan aldrig markera en offert som godkänd – det kan
 * bara en genomförd BankID-signering.
 */

function push(msg: Omit<AssistantMessage, "id" | "at">): AssistantMessage {
  const m: AssistantMessage = { ...msg, id: uid(), at: new Date().toISOString() };
  db().assistantMessages.push(m);
  return m;
}

function reply(text: string, card?: AssistantCard) {
  push({ role: "assistant", text, card });
}

function apply(result: DomainResult): boolean {
  reply(result.text, result.card);
  return true;
}

const MONTHS = [
  "januari", "februari", "mars", "april", "maj", "juni",
  "juli", "augusti", "september", "oktober", "november", "december",
];

function parseStartLabel(text: string): string | null {
  const m = text.toLowerCase().match(new RegExp(`start(?:ar)?\\s+(?:den\\s+)?(\\d{1,2})\\s+(${MONTHS.join("|")})`));
  if (!m) return null;
  return `${m[1]} ${m[2]}`;
}

function helpCard(): AssistantCard {
  return {
    kind: "list",
    rows: [
      { label: "”Skapa ett uppdrag för Anna Andersson, badrum, nästa måndag”" },
      { label: "”Skapa en offert till Anna för köksrenoveringen, 85 000 kr, 30 % vid start”" },
      { label: "”Skicka en påminnelse till alla vars fakturor är sena”" },
      { label: "”Vilka kunder har inte betalat?”" },
      { label: "”Hur mycket kan jag spendera utan att riskera momsen?”" },
      { label: "”Vad behöver jag göra idag?”" },
    ],
  };
}

function withCustomer(
  name: string,
  resume: Parameters<typeof offerCreateCustomer>[1],
  fn: (customerId: string) => DomainResult
): boolean {
  const match = resolveCustomerName(name);
  if (match.kind === "none") return apply(offerCreateCustomer(match.query, resume));
  if (match.kind === "many") return apply(ambiguousCustomers(match.query, match.customers));
  return apply(fn(match.customer.id));
}

function extractCustomerName(text: string): string | null {
  const corrected = resolveCustomerNameArg(text);
  if (corrected) return corrected;
  const m = text.match(/(?:till|för|hos|at)\s+([A-Za-zÅÄÖåäö]+(?:\s+[A-ZÅÄÖ][a-zåäö]+)?)/i);
  return m ? m[1].trim() : null;
}

function extractJobTitle(text: string, customerName: string): string {
  const escaped = customerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rest = text
    .replace(/^(skapa|lägg upp|boka)\s+(ett\s+)?(uppdrag|jobb)\s*/i, "")
    .replace(new RegExp(`(?:för|till)\\s+${escaped}`, "i"), "")
    .replace(/nästa\s+\S+|imorgon|idag|övermorgon/gi, "")
    .replace(/[,.:]/g, " ")
    .trim();
  return rest.length >= 2 ? cap(rest) : "Uppdrag";
}

/* --------------------------------- Intents --------------------------------- */

function intentBankIdRefuse(text: string): boolean {
  if (!isBankIdApprovalRequest(text)) return false;
  return apply(bankIdRefuseResult());
}

function intentCreateQuote(text: string): boolean {
  if (!/offert/i.test(text) || !/(skapa|gör|ta fram|skriv|fixa)/i.test(text)) return false;

  const nameMatch = text.match(/(?:till|för)\s+([A-Za-zÅÄÖåäö]+(?:\s+[A-ZÅÄÖ][a-zåäö]+)?)/);
  if (!nameMatch) {
    reply("Vem ska offerten till? Skriv till exempel: ”Skapa en offert till Anna för köksrenoveringen, 85 000 kr”.");
    return true;
  }
  let name = nameMatch[1];
  if (resolveCustomerName(name).kind === "none" && /s$/i.test(name) && !name.includes(" ")) {
    name = name.slice(0, -1);
  }
  const appliedTaxReduction = parseAppliedTaxReduction(text);
  const amount = parseAmountInclVat(
    text.replace(/(\d{1,3}(?:[ .\u00a0]\d{3})+|\d{3,})\s*(?:kr)?\s*i\s+(?:rot[-\s]?|rut[-\s]?)?avdrag/gi, "")
  );
  const afterName = text.slice((nameMatch.index ?? 0) + nameMatch[0].length).replace(/^s\b/i, "");
  const titleMatch =
    afterName.match(/(?:för\s+)?(?:en\s+|ett\s+)?([^.,\d]+?)(?=\s*[,.]|\s*\d|$)/i) ||
    text.match(/för\s+(?:en\s+|ett\s+)?([^.,\d]+?)(?=\s*[,.]|\s*\d|$)/i);
  let title = titleMatch ? cap(titleMatch[1].trim()) : "Offererat arbete";
  title = title.replace(/^(Den|Det|En|Ett)\s+/i, "");
  if (title.toLowerCase() === name.toLowerCase()) title = "Offererat arbete";

  const inclMaterial = /inklusive material|inkl\.? material/i.test(text);
  const start = parseStartLabel(text);
  const introParts = [
    `${title} enligt överenskommelse.`,
    inclMaterial ? "Priset inkluderar material." : null,
    start ? `Planerad start: ${start}.` : null,
  ].filter(Boolean);

  const percentMatch = text.match(/(\d{1,3})\s*%\s*vid start/i);
  const percentAtStart = percentMatch ? parseInt(percentMatch[1], 10) : undefined;
  const rot: "rot" | "rut" | null = /\brut\b/i.test(text) ? "rut" : /\brot\b/i.test(text) ? "rot" : null;

  return withCustomer(name, { kind: "create_quote", title, amountInclVat: amount ?? undefined, rot, appliedTaxReduction: appliedTaxReduction ?? undefined }, (customerId) =>
    createQuoteDraft({
      customerId,
      title,
      amountInclVat: amount ?? undefined,
      intro: introParts.join(" "),
      percentAtStart,
      rot,
      appliedTaxReduction: appliedTaxReduction ?? undefined,
    })
  );
}

function intentListIncomingJobs(text: string): boolean {
  if (!/(nytt uppdrag|nya uppdrag|inkommande uppdrag|webbformulär)/i.test(text)) return false;
  if (/(skapa|offert)/i.test(text)) return false;
  const jobs = db().jobs.filter(isIncomingUnquotedJob);
  if (jobs.length === 0) {
    return apply({
      ok: true,
      text: "Inga inkommande uppdrag utan offert just nu.",
      forModel: { count: 0, jobs: [] },
    });
  }
  return apply({
    ok: true,
    text: jobs.length === 1 ? "1 nytt uppdrag utan offert." : `${jobs.length} nya uppdrag utan offert.`,
    card: {
      kind: "list",
      title: "Nya uppdrag",
      rows: jobs.slice(0, 20).map((j) => {
        const customer = db().customers.find((c) => c.id === j.customerId);
        return {
          label: `${customer?.name ?? "Kund"} · ${j.title}`,
          value: (j.originalMessage || j.description).replace(/\s+/g, " ").trim().slice(0, 80),
          href: `/uppdrag/${j.id}`,
        };
      }),
    },
    forModel: {
      count: jobs.length,
      jobs: jobs.slice(0, 20).map((j) => ({ id: j.id, title: j.title, customerId: j.customerId })),
    },
  });
}

function intentCreateJob(text: string): boolean {
  if (!/(skapa|lägg upp|boka)\s+(ett\s+)?(uppdrag|jobb)/i.test(text) && !/(nytt uppdrag|nytt jobb)/i.test(text)) {
    return false;
  }
  const name = extractCustomerName(text);
  if (!name) {
    reply("Vem är uppdraget åt? Skriv till exempel: ”Skapa uppdrag för Anna Andersson, badrum, nästa måndag”.");
    return true;
  }
  const startDate = parseFlexibleDate(text) ?? undefined;
  const title = extractJobTitle(text, name);

  return withCustomer(name, { kind: "create_job", title, startDate, description: text }, (customerId) =>
    createJobDraft({ customerId, title, startDate, description: text })
  );
}

function intentExtraFromNotes(text: string): boolean {
  if (!/(extra|tillägg|anteckning)/i.test(text) || !/fakturera/i.test(text)) return false;
  const name = extractCustomerName(text);
  if (!name) return false;
  const amount = parseAmountInclVat(text);
  return withCustomer(name, { kind: "create_invoice", amountInclVat: amount ?? undefined }, (customerId) =>
    proposeExtraFromNotes(customerId, amount ?? undefined)
  );
}

function intentRotInvoice(text: string): boolean {
  if (!/(rot|rut)[-\s]?faktura|faktura.{0,20}(rot|rut)/i.test(text)) return false;
  const type: "rot" | "rut" = /\brut\b/i.test(text) ? "rut" : "rot";
  let name = extractCustomerName(text);
  if (!name) {
    reply(`Vem ska ${type.toUpperCase()}-fakturan till? Skriv till exempel: ”Skapa ROT-faktura för Annas köksrenovering”.`);
    return true;
  }
  if (resolveCustomerName(name).kind === "none" && /s$/i.test(name)) {
    name = name.slice(0, -1);
  }
  const titleHint = text
    .replace(/skapa\s+(en\s+)?(rot|rut)[-\s]?faktura/gi, "")
    .replace(new RegExp(`(?:för|till)\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?`, "i"), "")
    .replace(/[,.:]/g, " ")
    .replace(/(\d{1,3}(?:[ .\u00a0]\d{3})+|\d{3,})\s*(?:kr)?\s*i\s+(?:rot[-\s]?|rut[-\s]?)?avdrag/gi, "")
    .replace(/men\s+anv[aä]nd\s+(bara|endast)/gi, "")
    .trim();
  const appliedTaxReduction = parseAppliedTaxReduction(text);
  return withCustomer(name, { kind: "create_invoice", title: titleHint || undefined, taxReduction: type, appliedTaxReduction: appliedTaxReduction ?? undefined }, (customerId) =>
    createInvoiceDraft({ customerId, title: titleHint || undefined, taxReduction: type, appliedTaxReduction: appliedTaxReduction ?? undefined })
  );
}

function intentInvoiceCustomer(text: string): boolean {
  if (!/(fakturera|slutfaktura|skapa faktura)/i.test(text)) return false;
  const name = extractCustomerName(text);
  if (!name) return false;
  return withCustomer(name, { kind: "create_invoice" }, (customerId) => proposeInvoiceForCustomer(customerId));
}

function intentSendQuote(text: string): boolean {
  if (!/skicka\s+(offerten|offert|en offert)/i.test(text) || /påminn/i.test(text)) return false;
  const num = text.match(/#?\s*(\d{2,4})/);
  if (num) {
    const q = db().quotes.find((x) => x.number === parseInt(num[1], 10));
    if (q) return apply(requestSendQuote(q.id));
  }
  const name = extractCustomerName(text);
  if (name) {
    const match = resolveCustomerName(name);
    if (match.kind === "one") {
      const drafts = db().quotes.filter((x) => x.customerId === match.customer.id && x.status === "utkast");
      if (drafts.length === 1) return apply(requestSendQuote(drafts[0].id));
    }
  }
  return false;
}

function intentSendInvoice(text: string): boolean {
  if (!/skicka\s+(fakturan|faktura|en faktura)/i.test(text) || /påminn/i.test(text)) return false;
  const num = text.match(/#?\s*(\d{3,5})/);
  if (num) {
    const found = db().invoices.find((i) => i.number === parseInt(num[1], 10));
    if (found) return apply(requestSendInvoice(found.id));
  }
  const name = extractCustomerName(text);
  if (name) {
    const match = resolveCustomerName(name);
    if (match.kind === "one") {
      const drafts = db().invoices.filter((i) => i.customerId === match.customer.id && i.status === "utkast");
      if (drafts.length === 1) return apply(requestSendInvoice(drafts[0].id));
      if (drafts.length > 1) {
        reply("Vilken faktura ska skickas?", {
          kind: "list",
          rows: drafts.map((i) => ({
            label: `Faktura #${i.number}`,
            href: `/ekonomi/fakturor/${i.id}`,
          })),
        });
        return true;
      }
    }
  }
  return false;
}

function intentRemindLate(text: string): boolean {
  if (!/påminn/i.test(text) || !/(sen|försen|förfall|inte betalat)/i.test(text)) return false;
  return apply(requestRemindLate());
}

function intentFollowUpQuotes(text: string): boolean {
  if (!/följ upp/i.test(text)) return false;
  const daysMatch = text.match(/(\d+)\s*dag/);
  const minDays = daysMatch ? parseInt(daysMatch[1], 10) : 7;
  return apply(requestFollowUpQuotes(minDays));
}

function intentUnpaid(text: string): boolean {
  if (!/(inte betalat|obetal|väntar på betalning|vilka.*betalat)/i.test(text)) return false;
  return apply(unpaidInvoicesResult());
}

function intentSpendingRoom(text: string): boolean {
  if (
    !/(spendera|utrymme|råd med|tillgängligt|tillgangligt|hur mycket.*pengar|på banken)/i.test(text) &&
    !(/moms/i.test(text) && /risk/i.test(text))
  ) {
    return false;
  }
  return apply(spendingRoomResult());
}

function intentMissingReceipts(text: string): boolean {
  if (!/(saknar kvitto|kvitto saknas|utan kvitto|köp saknar)/i.test(text)) return false;
  return apply(missingReceiptsResult());
}

function intentCompanyProfile(text: string): boolean {
  if (!/(org(?:anisations)?\.?\s*nr|organisationsnummer|momsreg|bankgiro|företagsuppgift|vilket.*nummer har jag)/i.test(text)) {
    return false;
  }
  if (/(byt|ändra|uppdatera|sätt|ändra till)/i.test(text)) return false;
  return apply(businessProfileResult());
}

function intentCompanyStatus(text: string): boolean {
  if (!/(hur går|hur mår|läget|status för företaget)/i.test(text)) return false;
  return apply(companyStatusResult());
}

function intentToday(text: string): boolean {
  if (!/(vad behöver jag göra|att göra idag|att-göra|vad ska jag göra)/i.test(text)) return false;
  return apply(todayAttentionResult());
}

function intentBookExpense(text: string): boolean {
  if (!/(boka|bokför)/i.test(text)) return false;
  const data = db();
  const candidates = data.expenses.filter((e) => e.status !== "bokford");
  const expense = candidates.find((e) => text.toLowerCase().includes(e.supplier.toLowerCase().split(" ")[0]));
  if (!expense) return false;

  let categoryKey = "ovrigt";
  if (/material/i.test(text)) categoryKey = "material";
  else if (/verktyg/i.test(text)) categoryKey = "verktyg";
  else if (/representation/i.test(text)) categoryKey = "representation";

  let jobId: string | undefined;
  const jobMatch = text.match(/till\s+([A-Za-zÅÄÖåäö]+)s?\s+(?:jobb|uppdrag)/i);
  if (jobMatch) {
    const jobCustomers = findCustomersByName(jobMatch[1]);
    if (jobCustomers.length === 1) {
      const job = data.jobs.find((j) => j.customerId === jobCustomers[0].id && j.status !== "klart");
      if (job) jobId = job.id;
    }
  }
  return apply(requestBookExpense({ expenseId: expense.id, category: categoryKey, jobId }));
}

function intentDomain(text: string): boolean {
  if (!/domän/i.test(text) && !/(ledig|upptagen|skaffa).*\.se|\.se.*(ledig|upptagen|köp)/i.test(text)) return false;
  if (/(köp|skaffa|beställ)/i.test(text)) {
    const m = text.match(/([a-z0-9-]+(?:\.se)?)/i);
    if (!m) {
      reply("Vilken .se-adress vill du skaffa? Skriv till exempel sodermalmssnickeri.");
      return true;
    }
    return apply(requestPurchaseDomain(m[1]));
  }
  if (/(status|hur går|kopplad|live)/i.test(text)) return apply(getDomainStatusResult());
  return apply({
    ok: true,
    text: "Sök och köp .se-adressen under Hemsida → Domän. Jag köper inget utan att du bekräftar.",
    card: { kind: "links", links: [{ label: "Öppna Domän", href: "/hemsida/doman" }] },
    forModel: { hint: "domain_ui" },
  });
}

function intentWebsite(text: string): boolean {
  if (!/hemsida|webbplats|sajt/i.test(text) || !/(skapa|bygg|gör|fixa|generera|publicera)/i.test(text)) return false;
  if (/publicera/i.test(text)) return apply(requestPublishWebsite());
  return apply(requestGenerateWebsite(text));
}

function intentMoms(text: string): boolean {
  if (!/moms/i.test(text)) return false;
  return apply(momsResult());
}

function intentBokforingStatus(text: string): boolean {
  if (!/(bokföring|bokforing)/i.test(text)) return false;
  if (!/(vad behöver|hur går|läget|status|uppdaterad|göra med)/i.test(text)) return false;
  return apply(bokforingStatusResult());
}

function intentMomsRapport(text: string): boolean {
  if (!/(momsrapport|momsdeklaration|deklarera moms|momsunderlag)/i.test(text)) return false;
  if (/(markera|deklarerat|lämnat in)/i.test(text)) return apply(requestMarkVatDeclared());
  return apply(momsRapportResult());
}

function intentBokslut(text: string): boolean {
  if (!/bokslut/i.test(text)) return false;
  if (/(slutför|stäng|avsluta året|gör klart)/i.test(text)) return apply(requestCloseFiscalYear());
  if (/(avskrivning|periodisering|bokför.*poster)/i.test(text)) return apply(requestRunBokslutAutomation());
  return apply(bokslutStatusResult());
}

function intentForklaraVerifikation(text: string): boolean {
  const m = text.match(/varför bokfördes\s+(.+?)\??$/i) ?? text.match(/förklara\s+(?:verifikation\s+)?([A-Za-z]?\d+)/i);
  if (!m) return false;
  return apply(forklaraVerifikationResult(m[1].trim()));
}

function intentAngraBokforing(text: string): boolean {
  if (!/(ångra|angra)/i.test(text) || !/(bokning|bokföring|köp)/i.test(text)) return false;
  const data = db();
  const booked = data.expenses.filter((e) => e.status === "bokford" && e.verificationId);
  const expense = booked.find((e) => text.toLowerCase().includes(e.supplier.toLowerCase().split(" ")[0]));
  if (!expense) return false;
  return apply(requestUndoExpense(expense.id));
}

function intentResultatBalans(text: string): boolean {
  if (/resultatrapport|resultaträkning/i.test(text)) return apply(resultatRapportResult());
  if (/balansrapport|balansräkning/i.test(text)) return apply(balansRapportResult());
  return false;
}

function intentGreetingOrHelp(text: string): boolean {
  const isGreeting = /^(hej|tja|hallå|god morgon|godmorgon|tjena|hejsan)\b/i.test(text.trim());
  if (!isGreeting) return false;
  reply("Hej! Jag kan utföra saker i hela produkten – här är några exempel:", helpCard());
  return true;
}

export function dispatchRules(text: string): boolean {
  return (
    intentBankIdRefuse(text) ||
    intentGreetingOrHelp(text) ||
    intentCreateJob(text) ||
    intentCreateQuote(text) ||
    intentListIncomingJobs(text) ||
    intentExtraFromNotes(text) ||
    intentRotInvoice(text) ||
    intentInvoiceCustomer(text) ||
    intentSendQuote(text) ||
    intentSendInvoice(text) ||
    intentRemindLate(text) ||
    intentFollowUpQuotes(text) ||
    intentUnpaid(text) ||
    intentSpendingRoom(text) ||
    intentMissingReceipts(text) ||
    intentCompanyProfile(text) ||
    intentCompanyStatus(text) ||
    intentBokforingStatus(text) ||
    intentBokslut(text) ||
    intentMomsRapport(text) ||
    intentForklaraVerifikation(text) ||
    intentAngraBokforing(text) ||
    intentResultatBalans(text) ||
    intentToday(text) ||
    intentBookExpense(text) ||
    intentDomain(text) ||
    intentWebsite(text) ||
    intentMoms(text)
  );
}

const MAX_TOOL_ROUNDS = 8;

/**
 * LLM-varv med tool calling. Använder samma tjänster som UI:t via `executeTool`.
 * Returnerar false om anropet inte kunde slutföras (anroparen faller tillbaka).
 */
export async function interpret(): Promise<boolean> {
  const messages: AiChatMessage[] = [
    { role: "system", content: systemPrompt() },
    ...historyToAiMessages(db().assistantMessages),
  ];
  const tools = assistantToolDefs();
  let lastCard: AssistantCard | undefined;
  let lastText: string | undefined;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await chatWithTools({ messages, tools });
    if (result.toolCalls.length === 0) {
      const content = (result.content ?? "").trim();
      reply(content || lastText || "Klart.", lastCard);
      return true;
    }
    messages.push({
      role: "assistant",
      content: result.content,
      tool_calls: result.toolCalls,
    });
    for (const call of result.toolCalls) {
      let parsed: unknown = {};
      try {
        parsed = JSON.parse(call.function.arguments || "{}");
      } catch {
        parsed = {};
      }
      const out = await executeTool(call.function.name, parsed);
      if (out.card) lastCard = out.card;
      if (out.text) lastText = out.text;
      const payload = out.ok
        ? { ok: true, ...out.forModel, requiresConfirmation: out.requiresConfirmation }
        : { ok: false, error: out.error ?? "Verktyget misslyckades. Inget sparades." };
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(payload),
      });
    }
  }
  reply(lastText || "Jag stannade där – bekräfta kortet eller skriv hur du vill gå vidare.", lastCard);
  return true;
}

export async function sendUserMessage(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  push({ role: "user", text: trimmed });

  if (isBankIdApprovalRequest(trimmed)) {
    apply(bankIdRefuseResult());
    save();
    return;
  }

  if (isAiConfigured()) {
    try {
      await interpret();
      save();
      return;
    } catch (e) {
      // Demons AI-budget är slut: ärligt besked i stället för teknisk reserv.
      if (e instanceof AiDemoLimitError) {
        reply(e.message, helpCard());
        save();
        return;
      }
      // Teknisk detalj till loggen; användaren får ett mänskligt besked nedan.
      console.error("[driva:assistent] LLM-anropet misslyckades, faller tillbaka på regler.", e);
      if (!dispatchRules(trimmed)) {
        reply(
          "Språktjänsten svarade inte. Inget har sparats av den. Jag kan fortfarande hjälpa till med vanliga kommandon – till exempel skapa offert, uppdrag eller fråga vilka som inte betalat.",
          helpCard()
        );
      }
      save();
      return;
    }
  }

  if (!dispatchRules(trimmed)) {
    reply("Det där har jag inte lärt mig ännu. Här är sådant jag kan hjälpa till med direkt:", helpCard());
  }
  save();
}

function updateConfirmCard(actionId: string, state: "utford" | "avbruten", resultText?: string): void {
  for (const m of db().assistantMessages) {
    if (!m.card) continue;
    if (m.card.kind === "confirm" && m.card.actionId === actionId) {
      m.card.state = state;
      m.card.resultText = resultText;
    }
    if (m.card.kind === "create_customer" && m.card.actionId === actionId) {
      m.card.state = state;
      m.card.resultText = resultText;
    }
  }
}

export async function confirmPendingAction(actionId: string): Promise<void> {
  const data = db();
  const idx = data.pendingActions.findIndex((a) => a.id === actionId);
  if (idx === -1) return;
  const action = data.pendingActions[idx];
  data.pendingActions.splice(idx, 1);

  switch (action.type) {
    case "paminn_forsenade": {
      let mailed = false;
      for (const id of action.invoiceIds) {
        const { outcome } = await remindInvoiceByEmail(id, "assistent");
        // "demo": demoföretagets simulerade utskick räknas som skickat i UX:et.
        if (outcome.ok && (outcome.mode === "live" || outcome.mode === "demo")) mailed = true;
      }
      updateConfirmCard(
        actionId,
        mailed ? "utford" : "avbruten",
        mailed
          ? `${action.invoiceIds.length === 1 ? "Påminnelsen" : "Påminnelserna"} har skickats.`
          : "Påminnelsen kunde inte skickas."
      );
      reply(
        mailed
          ? action.invoiceIds.length === 1
            ? "Klart – påminnelsen är skickad med e-post. Jag säger till om betalningen inte dyker upp inom några dagar."
            : `Klart – ${action.invoiceIds.length} påminnelser är skickade med e-post. Jag säger till om betalningarna inte dyker upp inom några dagar.`
          : "Påminnelsen kunde inte skickas. Försök igen."
      );
      break;
    }
    case "folj_upp_offerter": {
      let mailed = false;
      for (const id of action.quoteIds) {
        const { outcome } = await followUpQuoteByEmail(id, "assistent");
        if (outcome.ok && (outcome.mode === "live" || outcome.mode === "demo")) mailed = true;
      }
      updateConfirmCard(actionId, mailed ? "utford" : "avbruten", mailed ? "Påminnelserna har skickats." : "Påminnelsen kunde inte skickas.");
      reply(
        mailed
          ? `Klart – jag har påmint ${action.quoteIds.length === 1 ? "kunden" : `${action.quoteIds.length} kunder`} med e-post om att offerten väntar på signering.`
          : "Påminnelsen kunde inte skickas. Försök igen."
      );
      break;
    }
    case "bokfor_utgift": {
      bookExpenseToJob(action.expenseId, action.category, action.jobId, "assistent");
      updateConfirmCard(actionId, "utford", "Bokfört.");
      const expense = db().expenses.find((e) => e.id === action.expenseId);
      reply(`Klart – köpet hos ${expense?.supplier ?? ""} är bokfört${action.jobId ? " och kopplat till uppdraget" : ""}. Verifikationen ligger under Bokföring.`, {
        kind: "links",
        links: [{ label: "Öppna Bokföring", href: "/bokforing" }],
      });
      break;
    }
    case "aktivera_hemsida": {
      activateWebsiteModule();
      updateConfirmCard(actionId, "utford", "Hemsida är aktiverad.");
      reply("Klart – Hemsida är aktiverad och syns i menyn. Öppna buildern när du vill skapa eller redigera sajten.", {
        kind: "links",
        links: [{ label: "Öppna Hemsida", href: "/hemsida" }],
      });
      break;
    }
    case "generera_hemsida": {
      const site = generateWebsite(action.description);
      updateConfirmCard(actionId, "utford", "Utkastet är klart.");
      reply(`Klart! Jag har tagit fram ett utkast för ${site.businessName}. Granska texterna och publicera när du är nöjd.`, {
        kind: "links",
        links: [{ label: "Öppna Hemsida", href: "/hemsida" }],
      });
      break;
    }
    case "skicka_offert": {
      try {
        const { outcome } = await sendQuoteWithEmail(action.quoteId);
        if (!outcome.ok) {
          updateConfirmCard(actionId, "avbruten", outcome.error ?? "Kunde inte skicka offerten.");
          reply(outcome.error ?? "Kunde inte skicka offerten.");
          break;
        }
        updateConfirmCard(actionId, "utford", "Offerten har skickats.");
        reply("Klart – offerten är skickad med e-post. Kunden signerar med BankID när hen är redo.");
      } catch (e) {
        const message = e instanceof Error ? e.message : "Kunde inte skicka offerten.";
        updateConfirmCard(actionId, "avbruten", message);
        reply(message);
      }
      break;
    }
    case "skicka_faktura": {
      try {
        const { outcome } = await issueAndEmailInvoice(action.invoiceId, "assistent");
        if (!outcome.ok) {
          updateConfirmCard(actionId, "avbruten", outcome.error ?? "Fakturan kunde inte skickas.");
          reply(
            `Fakturan är utfärdad och bokförd, men e-posten misslyckades: ${outcome.error ?? "okänt fel"}. Försök skicka igen.`
          );
          break;
        }
        updateConfirmCard(actionId, "utford", "Fakturan har skickats.");
        reply("Klart – fakturan är utfärdad, skickad med e-post och bokförd.");
      } catch (e) {
        const message = e instanceof Error ? e.message : "Kunde inte skicka fakturan.";
        updateConfirmCard(actionId, "avbruten", message);
        reply(message);
      }
      break;
    }
    case "publicera_hemsida": {
      publishWebsite();
      updateConfirmCard(actionId, "utford", "Hemsidan är publicerad.");
      reply("Klart – hemsidan är publicerad.", { kind: "links", links: [{ label: "Öppna Hemsida", href: "/hemsida" }] });
      break;
    }
    case "skapa_kund":
      break;
    case "uppdatera_foretag": {
      try {
        applyBusinessProfilePatch(action.patch);
        updateConfirmCard(actionId, "utford", "Inställningarna är uppdaterade.");
        reply("Klart – uppgifterna är sparade i Inställningar. Utfärdade fakturor och BankID-signerade offerter ändras inte.", {
          kind: "links",
          links: [{ label: "Öppna Inställningar", href: "/installningar" }],
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Kunde inte spara.";
        updateConfirmCard(actionId, "avbruten", message);
        reply(message);
      }
      break;
    }
    case "kor_bokslut_automatik": {
      try {
        const res = runBokslutAutomation(action.fiscalYearId, "assistent");
        updateConfirmCard(actionId, "utford", "Bokslutsposterna är bokförda.");
        reply(
          `Klart – ${res.depreciations} avskrivning${res.depreciations === 1 ? "" : "ar"} och ${res.accruals} periodisering${res.accruals === 1 ? "" : "ar"} bokfördes som bokslutsverifikationer.`,
          { kind: "links", links: [{ label: "Öppna bokslutet", href: "/bokforing/bokslut" }] }
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : "Kunde inte bokföra bokslutsposterna.";
        updateConfirmCard(actionId, "avbruten", message);
        reply(message);
      }
      break;
    }
    case "slutfor_bokslut": {
      try {
        const res = closeFiscalYear(action.fiscalYearId, "assistent");
        updateConfirmCard(actionId, "utford", `Räkenskapsåret ${res.fiscalYear.label} är stängt.`);
        reply(
          `Klart – bokslutet för ${res.fiscalYear.label} är slutfört. Årets resultat ${res.aretsResultat.toLocaleString("sv-SE")} kr fördes mot eget kapital${res.skatt ? ` och ${res.skatt.toLocaleString("sv-SE")} kr bokfördes som preliminär bolagsskatt` : ""}. ${res.nextYear.label} har fått ingående balanser och året är låst.`,
          { kind: "links", links: [{ label: "Öppna bokslutet", href: "/bokforing/bokslut" }] }
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : "Kunde inte slutföra bokslutet.";
        updateConfirmCard(actionId, "avbruten", message);
        reply(message);
      }
      break;
    }
    case "angra_utgift": {
      try {
        undoExpenseBooking(action.expenseId, "assistent");
        const expense = db().expenses.find((e) => e.id === action.expenseId);
        updateConfirmCard(actionId, "utford", "Bokningen är ångrad.");
        reply(
          `Klart – bokningen av köpet hos ${expense?.supplier ?? ""} är återförd med en rättelseverifikation. Svara på frågan under Bokföring så bokförs det rätt.`,
          { kind: "links", links: [{ label: "Öppna Bokföring", href: "/bokforing" }] }
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : "Kunde inte ångra bokningen.";
        updateConfirmCard(actionId, "avbruten", message);
        reply(message);
      }
      break;
    }
    case "ratta_bokforing": {
      try {
        const posted = postVerificationCorrection(action.verificationId, action.intent, "assistent");
        updateConfirmCard(actionId, "utford", `Rättelse ${posted.reversalLabel} bokförd.`);
        reply(
          `Klart – ${posted.originalLabel} rättades genom ${posted.reversalLabel}${posted.replacementLabel ? `. Ny bokning: ${posted.replacementLabel}` : ""}. Originalet ändrades inte.`,
          { kind: "links", links: [{ label: "Öppna verifikationerna", href: `/bokforing/verifikationer?v=${posted.reversal.id}` }] }
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : "Kunde inte rätta bokföringen.";
        updateConfirmCard(actionId, "avbruten", message);
        reply(message);
      }
      break;
    }
    case "markera_moms_deklarerad": {
      try {
        const report = markVatReportDeclared(action.reportId, "assistent");
        updateConfirmCard(actionId, "utford", "Momsen är markerad som deklarerad.");
        reply(
          `Klart – momsen för ${report.label} är markerad som deklarerad och perioden är låst. ${report.attBetala >= 0 ? `Kom ihåg att betala ${report.attBetala.toLocaleString("sv-SE")} kr till Skatteverket.` : `Du får tillbaka ${(-report.attBetala).toLocaleString("sv-SE")} kr.`}`,
          { kind: "links", links: [{ label: "Öppna momsöversikten", href: "/bokforing/moms" }] }
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : "Kunde inte markera momsen som deklarerad.";
        updateConfirmCard(actionId, "avbruten", message);
        reply(message);
      }
      break;
    }
    case "skapa_tillaggsoffert": {
      const result = createQuoteDraft({
        customerId: action.customerId,
        title: action.title,
        amountInclVat: action.amountInclVat,
      });
      updateConfirmCard(actionId, "utford", "Tilläggsofferten är skapad som utkast.");
      reply(result.text, result.card);
      break;
    }
    case "skicka_leverantorsbetalning": {
      try {
        const { submitSupplierPayment } = await import("./supplier-payments");
        const result = submitSupplierPayment(action.paymentId);
        if (!result.ok) {
          updateConfirmCard(actionId, "avbruten", result.error);
          reply(result.error);
          break;
        }
        const invoice = db().supplierInvoices.find((s) => s.id === result.payment.supplierInvoiceId);
        updateConfirmCard(actionId, "utford", "Instruktionen är skickad till banken.");
        reply(
          result.alreadySubmitted
            ? `Betalningen till ${invoice?.supplier ?? "leverantören"} var redan skickad.`
            : `Klart – betalningen till ${invoice?.supplier ?? "leverantören"} är skickad till banken. Den är inte betald förrän banken bekräftar.`,
          { kind: "links", links: [{ label: "Öppna Inbox", href: invoice?.inboxItemId ? `/inbox/${invoice.inboxItemId}` : "/inbox" }] }
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : "Kunde inte skicka betalningen.";
        updateConfirmCard(actionId, "avbruten", message);
        reply(message);
      }
      break;
    }
    case "avbryt_leverantorsbetalning": {
      try {
        const { cancelSupplierPayment } = await import("./supplier-payments");
        const payment = cancelSupplierPayment(action.paymentId);
        updateConfirmCard(actionId, "utford", "Betalningen är avbruten.");
        reply(`Klart – betalningen på ${payment.amount} kr är avbruten.`);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Kunde inte avbryta betalningen.";
        updateConfirmCard(actionId, "avbruten", message);
        reply(message);
      }
      break;
    }
    case "skapa_bankfil": {
      // Bekräftad bankfil: samma tjänst och samma vakter som [Skapa bankfil]
      // i UI:t. Filen skapas och länkas för nedladdning – Driva påstår aldrig
      // att den är skickad till banken eller betald.
      try {
        const { createPaymentFile } = await import("./payment-files");
        const result = createPaymentFile({ supplierInvoiceIds: action.supplierInvoiceIds, by: "assistent" });
        if (!result.ok) {
          const message = result.problems.join(" ");
          updateConfirmCard(actionId, "avbruten", message);
          reply(message);
          break;
        }
        updateConfirmCard(actionId, "utford", `Bankfilen ${result.file.filename} är skapad.`);
        reply(
          `Klart – bankfilen ${result.file.filename} är skapad. Ladda ned den och ladda upp den i din internetbank; betalningen godkänner du där. Inget är betalt förrän banken genomfört den.`,
          {
            kind: "links",
            links: [
              { label: "Ladda ned bankfilen", href: `/api/betalfil/${result.file.id}` },
              { label: "Öppna Ekonomi", href: "/ekonomi?flik=utgifter" },
            ],
          }
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : "Kunde inte skapa bankfilen.";
        updateConfirmCard(actionId, "avbruten", message);
        reply(message);
      }
      break;
    }
    case "anvand_leverantorsuppgifter": {
      // Återanvänder leverantörens VERIFIERADE uppgifter via samma tjänst som
      // UI:t – proveniens supplier_history, aldrig något AI:n angett själv.
      try {
        const { useVerifiedSupplierDetails } = await import("./supplier-payments");
        const { invoice, details } = useVerifiedSupplierDetails(action.supplierInvoiceId);
        updateConfirmCard(actionId, "utford", "Betalningsuppgifterna är kompletterade.");
        reply(
          `Klart – ${invoice.supplier} ${invoice.invoiceNumber} använder nu de tidigare verifierade uppgifterna (${details.account}). Betalningen skickas inte förrän du godkänner den.`,
          {
            kind: "links",
            links: [{ label: "Öppna dokumentet", href: invoice.inboxItemId ? `/inbox/${invoice.inboxItemId}` : "/ekonomi?flik=utgifter" }],
          }
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : "Kunde inte återanvända uppgifterna.";
        updateConfirmCard(actionId, "avbruten", message);
        reply(message);
      }
      break;
    }
    case "ta_bort_uppdrag": {
      try {
        const result = deleteOrArchiveJob(action.jobId);
        const jobGone = result.kind === "deleted";
        updateConfirmCard(
          actionId,
          "utford",
          jobGone ? "Uppdraget är borttaget." : "Uppdraget är arkiverat."
        );
        reply(
          jobGone
            ? "Klart – uppdraget är borttaget. Det fanns ingen godkänd offert, utfärdad faktura eller bokföring."
            : "Klart – uppdraget är arkiverat. Fakturor, offerter och bokföring är oförändrade.",
          jobGone
            ? { kind: "links", links: [{ label: "Öppna Uppdrag", href: "/kunder?flik=uppdrag" }] }
            : { kind: "links", links: [{ label: "Öppna uppdrag", href: `/uppdrag/${result.jobId}` }] }
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : "Kunde inte ta bort uppdraget.";
        updateConfirmCard(actionId, "avbruten", message);
        reply(message);
      }
      break;
    }
    case "kop_doman": {
      try {
        await purchaseDomain(action.hostname, { actor: "assistent" });
        updateConfirmCard(actionId, "utford", `${action.hostname} är köpt och kopplas.`);
        reply(`Klart – ${action.hostname} är köpt och kopplas till hemsidan.`, {
          kind: "links",
          links: [{ label: "Öppna Domän", href: "/hemsida/doman" }],
        });
      } catch (e) {
        const message = isDomainError(e) || e instanceof Error ? (e as Error).message : "Kunde inte köpa adressen.";
        updateConfirmCard(actionId, "avbruten", message);
        reply(message, { kind: "links", links: [{ label: "Öppna Domän", href: "/hemsida/doman" }] });
      }
      break;
    }
  }
  save();
}

export function cancelPendingAction(actionId: string): void {
  const data = db();
  const idx = data.pendingActions.findIndex((a) => a.id === actionId);
  if (idx !== -1) data.pendingActions.splice(idx, 1);
  updateConfirmCard(actionId, "avbruten");
  reply("Okej, jag avvaktar med det.");
  save();
}

export function completeCreateCustomerAndResume(actionId: string, customerId: string): void {
  const data = db();
  const idx = data.pendingActions.findIndex((a) => a.id === actionId);
  const action = idx === -1 ? undefined : data.pendingActions[idx];
  if (idx !== -1) data.pendingActions.splice(idx, 1);
  const customer = data.customers.find((c) => c.id === customerId);
  const name = customer?.name ?? "Kunden";
  updateConfirmCard(actionId, "utford", `${name} är tillagd.`);

  const resume = action && action.type === "skapa_kund" ? action.resume : undefined;
  if (!resume || !customer) {
    reply(`${name} är tillagd. Vad vill du att jag gör nu?`, {
      kind: "entity",
      entity: "kund",
      title: name,
      href: `/kunder/${customerId}`,
      openLabel: "Öppna kund",
    });
    save();
    return;
  }

  if (resume.kind === "create_quote") {
    apply(createQuoteDraft({ customerId, title: resume.title || "Offererat arbete", amountInclVat: resume.amountInclVat, rot: resume.rot ?? null, appliedTaxReduction: resume.appliedTaxReduction }));
  } else if (resume.kind === "create_job") {
    apply(createJobDraft({ customerId, title: resume.title, startDate: resume.startDate, description: resume.description }));
  } else if (resume.kind === "create_invoice") {
    apply(
      createInvoiceDraft({
        customerId,
        title: resume.title,
        amountInclVat: resume.amountInclVat,
        jobId: resume.jobId,
        taxReduction: resume.taxReduction ?? null,
        appliedTaxReduction: resume.appliedTaxReduction,
      })
    );
  }
  save();
}
