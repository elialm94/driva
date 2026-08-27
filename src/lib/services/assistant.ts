import { db, save } from "../store";
import { uid } from "../ids";
import type { AssistantCard, AssistantMessage } from "../types";
import { findCustomersByName } from "./customers";
import { bookExpenseToJob } from "./expenses";
import { followUpQuote, sendQuote } from "./quotes";
import { sendInvoice, sendReminder } from "./invoices";
import { generateWebsite, publishWebsite } from "./website";
import { isAiConfigured, chatWithTools, type AiChatMessage } from "../ai/provider";
import { assistantToolDefs, executeTool } from "../ai/tools";
import { historyToAiMessages, systemPrompt } from "../ai/prompt";
import { isBankIdApprovalRequest, parseAmountInclVat, parseFlexibleDate, cap, resolveCustomerName } from "../ai/resolve";
import {
  ambiguousCustomers,
  bankIdRefuseResult,
  companyStatusResult,
  createQuoteDraft,
  createJobDraft,
  missingReceiptsResult,
  momsResult,
  offerCreateCustomer,
  proposeInvoiceForCustomer,
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
  type DomainResult,
} from "../ai/domain";

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
  const m = text.match(/(?:till|för|at)\s+([A-Za-zÅÄÖåäö]+(?:\s+[A-ZÅÄÖ][a-zåäö]+)?)/i);
  return m ? m[1].trim() : null;
}

/* --------------------------------- Intents --------------------------------- */

function intentBankIdRefuse(text: string): boolean {
  if (!isBankIdApprovalRequest(text)) return false;
  return apply(bankIdRefuseResult());
}

function intentCreateQuote(text: string): boolean {
  if (!/offert/i.test(text) || !/(skapa|gör|ta fram|skriv|fixa)/i.test(text)) return false;

  const nameMatch = text.match(/till\s+([A-Za-zÅÄÖåäö]+(?:\s+[A-ZÅÄÖ][a-zåäö]+)?)/);
  if (!nameMatch) {
    reply("Vem ska offerten till? Skriv till exempel: ”Skapa en offert till Anna för köksrenoveringen, 85 000 kr”.");
    return true;
  }
  const amount = parseAmountInclVat(text);
  const titleMatch = text.match(/för\s+(?:en\s+|ett\s+)?([^.,\d]+?)(?=\s*[,.]|\s*\d|$)/i);
  let title = titleMatch ? cap(titleMatch[1].trim()) : "Offererat arbete";
  title = title.replace(/^(Den|Det|En|Ett)\s+/i, "");
  if (title.toLowerCase() === nameMatch[1].toLowerCase()) title = "Offererat arbete";

  const inclMaterial = /inklusive material|inkl\.? material/i.test(text);
  const start = parseStartLabel(text);
  const introParts = [
    `${title} enligt överenskommelse.`,
    inclMaterial ? "Priset inkluderar material." : null,
    start ? `Planerad start: ${start}.` : null,
  ].filter(Boolean);

  return withCustomer(nameMatch[1], { kind: "create_quote", title, amountInclVat: amount ?? undefined }, (customerId) =>
    createQuoteDraft({
      customerId,
      title,
      amountInclVat: amount ?? undefined,
      intro: introParts.join(" "),
    })
  );
}

function intentCreateJob(text: string): boolean {
  if (!/(skapa|lägg upp|boka)\s+(ett\s+)?(uppdrag|jobb)/i.test(text) && !/(nytt uppdrag|nytt jobb)/i.test(text)) {
    return false;
  }
  const name =
    extractCustomerName(text) ||
    text.match(/([A-ZÅÄÖ][a-zåäö]+(?:\s+[A-ZÅÄÖ][a-zåäö]+)?)/)?.[1] ||
    null;
  if (!name) {
    reply("Vem är uppdraget åt? Skriv till exempel: ”Skapa uppdrag för Anna Andersson, badrum, nästa måndag”.");
    return true;
  }
  const startDate = parseFlexibleDate(text) ?? undefined;
  let title = "Uppdrag";
  const titleMatch =
    text.match(/(?:uppdrag|jobb)\s+(?:för|till)\s+[A-Za-zÅÄÖåäö]+(?:\s+[A-ZÅÄÖ][a-zåäö]+)?[,:]?\s+([^,.]+?)(?=\s*(?:nästa|imorgon|idag|start)|$)/i) ||
    text.match(/,\s*([^,]+?)(?=\s*(?:nästa|imorgon|idag)|$)/i);
  if (titleMatch) {
    title = cap(titleMatch[1].replace(/\s+(nästa|imorgon|idag).*$/i, "").trim());
  } else {
    const rest = text
      .replace(/^(skapa|lägg upp|boka)\s+(ett\s+)?(uppdrag|jobb)\s*/i, "")
      .replace(/(?:för|till)\s+[A-Za-zÅÄÖåäö]+(?:\s+[A-ZÅÄÖ][a-zåäö]+)?/i, "")
      .replace(/nästa\s+\S+|imorgon|idag|övermorgon/gi, "")
      .replace(/[,.]/g, " ")
      .trim();
    if (rest) title = cap(rest);
  }
  if (!title || title.length < 2) title = "Uppdrag";

  return withCustomer(name, { kind: "create_job", title, startDate, description: text }, (customerId) =>
    createJobDraft({ customerId, title, startDate, description: text })
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
            href: `/pengar/fakturor/${i.id}`,
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

function intentWebsite(text: string): boolean {
  if (!/hemsida|webbplats|sajt/i.test(text) || !/(skapa|bygg|gör|fixa|generera|publicera)/i.test(text)) return false;
  if (/publicera/i.test(text)) return apply(requestPublishWebsite());
  return apply(requestGenerateWebsite(text));
}

function intentMoms(text: string): boolean {
  if (!/moms/i.test(text)) return false;
  return apply(momsResult());
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
    intentInvoiceCustomer(text) ||
    intentSendQuote(text) ||
    intentSendInvoice(text) ||
    intentRemindLate(text) ||
    intentFollowUpQuotes(text) ||
    intentUnpaid(text) ||
    intentSpendingRoom(text) ||
    intentMissingReceipts(text) ||
    intentCompanyStatus(text) ||
    intentToday(text) ||
    intentBookExpense(text) ||
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
      const out = executeTool(call.function.name, parsed);
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
    } catch {
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

export function confirmPendingAction(actionId: string): void {
  const data = db();
  const idx = data.pendingActions.findIndex((a) => a.id === actionId);
  if (idx === -1) return;
  const action = data.pendingActions[idx];
  data.pendingActions.splice(idx, 1);

  switch (action.type) {
    case "paminn_forsenade": {
      for (const id of action.invoiceIds) sendReminder(id, "assistent");
      updateConfirmCard(actionId, "utford", `${action.invoiceIds.length === 1 ? "Påminnelsen" : "Påminnelserna"} har skickats.`);
      reply(
        action.invoiceIds.length === 1
          ? "Klart – påminnelsen är skickad. Jag säger till om betalningen inte dyker upp inom några dagar."
          : `Klart – ${action.invoiceIds.length} påminnelser är skickade. Jag säger till om betalningarna inte dyker upp inom några dagar.`
      );
      break;
    }
    case "folj_upp_offerter": {
      for (const id of action.quoteIds) followUpQuote(id, "assistent");
      updateConfirmCard(actionId, "utford", "Påminnelserna har skickats.");
      reply(`Klart – jag har påmint ${action.quoteIds.length === 1 ? "kunden" : `${action.quoteIds.length} kunder`} om att offerten väntar på BankID-godkännande.`);
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
      sendQuote(action.quoteId);
      updateConfirmCard(actionId, "utford", "Offerten har skickats.");
      reply("Klart – offerten är skickad. Kunden godkänner med BankID när hen är redo.");
      break;
    }
    case "skicka_faktura": {
      sendInvoice(action.invoiceId);
      updateConfirmCard(actionId, "utford", "Fakturan har skickats.");
      reply("Klart – fakturan är skickad och bokförd.");
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
    apply(createQuoteDraft({ customerId, title: resume.title || "Offererat arbete", amountInclVat: resume.amountInclVat }));
  } else if (resume.kind === "create_job") {
    apply(createJobDraft({ customerId, title: resume.title, startDate: resume.startDate, description: resume.description }));
  } else if (resume.kind === "create_invoice") {
    apply(proposeInvoiceForCustomer(customerId));
  }
  save();
}
