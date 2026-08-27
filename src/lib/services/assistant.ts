import { db, save } from "../store";
import { uid } from "../ids";
import type { AssistantCard, AssistantMessage, PendingAssistantAction } from "../types";
import { kr, datumLang, relativ } from "../format";
import { findCustomersByName } from "./customers";
import { createQuote, followUpQuote, quoteDefaults } from "./quotes";
import { sendReminder } from "./invoices";
import { currentVersion, invoiceTotals, isOverdue, daysOverdue, quoteWaitingDays, requireCustomer, quoteTotals } from "./data";
import { financeOverview, businessStats, momsForCurrentPeriod } from "./finance";
import { bookExpenseToJob } from "./expenses";
import { generateWebsite } from "./website";
import { docTotals } from "../calc";

/**
 * Assistenten är en riktig operativ assistent: den utför handlingar via samma
 * tjänstelager som resten av produkten. Tolkningen är regelbaserad i demon –
 * `interpret` är integrationspunkten för en riktig LLM med function calling.
 *
 * Viktiga externa handlingar (skicka påminnelser, publicera, bokföra) kräver
 * alltid en bekräftelse av användaren. Assistenten kan aldrig markera en
 * offert som godkänd – det kan bara en genomförd BankID-signering.
 */

function push(msg: Omit<AssistantMessage, "id" | "at">): AssistantMessage {
  const m: AssistantMessage = { ...msg, id: uid(), at: new Date().toISOString() };
  db().assistantMessages.push(m);
  return m;
}

function reply(text: string, card?: AssistantCard) {
  push({ role: "assistant", text, card });
}

function addPending(action: PendingAssistantAction) {
  db().pendingActions.push(action);
}

/* ------------------------------ Tolkningshjälp ------------------------------ */

function parseAmount(text: string): number | null {
  const m = text.match(/(\d{1,3}(?:[ .\u00a0]\d{3})+|\d{3,})\s*(?:kr|:-|kronor)/i);
  if (!m) return null;
  return parseInt(m[1].replace(/[ .\u00a0]/g, ""), 10);
}

const MONTHS = [
  "januari", "februari", "mars", "april", "maj", "juni",
  "juli", "augusti", "september", "oktober", "november", "december",
];

function parseStartDate(text: string): string | null {
  const m = text.toLowerCase().match(new RegExp(`start(?:ar)?\\s+(?:den\\s+)?(\\d{1,2})\\s+(${MONTHS.join("|")})`));
  if (!m) return null;
  return `${m[1]} ${m[2]}`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* --------------------------------- Intents --------------------------------- */

function intentCreateQuote(text: string): boolean {
  if (!/offert/i.test(text) || !/(skapa|gör|ta fram|skriv|fixa)/i.test(text)) return false;

  const nameMatch = text.match(/till\s+([A-Za-zÅÄÖåäö]+(?:\s+[A-ZÅÄÖ][a-zåäö]+)?)/);
  if (!nameMatch) {
    reply("Vem ska offerten till? Skriv till exempel: ”Skapa en offert till Anna för köksrenoveringen, 85 000 kr”.");
    return true;
  }
  const candidates = findCustomersByName(nameMatch[1]);
  if (candidates.length === 0) {
    reply(
      `Jag hittar ingen kund som heter ”${nameMatch[1]}”. Lägg till kunden först så fixar jag offerten sedan.`,
      { kind: "links", links: [{ label: "Öppna Kunder", href: "/kunder" }] }
    );
    return true;
  }
  if (candidates.length > 1) {
    reply(`Jag hittar flera kunder som matchar ”${nameMatch[1]}” – vem menar du?`, {
      kind: "list",
      rows: candidates.map((c) => ({ label: c.name, href: `/kunder/${c.id}` })),
    });
    return true;
  }
  const customer = candidates[0];

  const amount = parseAmount(text);
  const titleMatch = text.match(/för\s+(?:en\s+|ett\s+)?([^.,\d]+?)(?=\s*[,.]|\s*\d|$)/i);
  let title = titleMatch ? cap(titleMatch[1].trim()) : "Offererat arbete";
  title = title.replace(/^(Den|Det|En|Ett)\s+/i, "");
  if (title.toLowerCase() === customer.name.toLowerCase()) title = "Offererat arbete";

  const inclMaterial = /inklusive material|inkl\.? material/i.test(text);
  const start = parseStartDate(text);
  const percentMatch = text.match(/(\d{1,3})\s*%\s*vid start/i);

  const exkl = amount ? Math.round(amount / 1.25) : 0;
  const defaults = quoteDefaults();
  const introParts = [
    `${title} enligt överenskommelse.`,
    inclMaterial ? "Priset inkluderar material." : null,
    start ? `Planerad start: ${start}.` : null,
  ].filter(Boolean);

  const quote = createQuote(
    {
      customerId: customer.id,
      title,
      intro: introParts.join(" "),
      lines: [
        {
          id: uid(),
          kind: "arbete",
          description: inclMaterial ? `${title}, arbete och material` : title,
          qty: 1,
          unit: "st",
          unitPrice: exkl,
          vatRate: 25,
        },
      ],
      rot: null,
      paymentPlan: percentMatch
        ? [
            { label: "Vid arbetets start", percent: parseInt(percentMatch[1], 10) },
            { label: "När arbetet är klart och godkänt", percent: 100 - parseInt(percentMatch[1], 10) },
          ]
        : [{ label: "Betalning när arbetet är klart", percent: 100 }],
      paymentTermsDays: defaults.paymentTermsDays,
      validUntil: defaults.validUntil,
      terms: defaults.terms,
    },
    "assistent"
  );

  const v = currentVersion(quote);
  const t = docTotals(v.lines, v.rot);
  reply(
    `Klart! Jag har skapat ett utkast: offert #${quote.number} till ${customer.name} på ${kr(t.total)} inkl. moms${
      percentMatch ? ` med delbetalning ${percentMatch[1]} % vid start` : ""
    }. Granska den och skicka när du är nöjd – du ser alltid exakt hur kunden kommer se den innan något går iväg.`,
    {
      kind: "links",
      links: [{ label: `Öppna offert #${quote.number}`, href: `/pengar/offerter/${quote.id}` }],
    }
  );
  return true;
}

function intentRemindLate(text: string): boolean {
  if (!/påminn/i.test(text) || !/(sen|försen|förfall|inte betalat)/i.test(text)) return false;
  const data = db();
  const late = data.invoices.filter(isOverdue);
  if (late.length === 0) {
    reply("Inga fakturor är försenade just nu – allt ser bra ut.");
    return true;
  }
  const action: PendingAssistantAction = { id: uid(), type: "paminn_forsenade", invoiceIds: late.map((i) => i.id) };
  addPending(action);
  reply(`Jag hittade ${late.length === 1 ? "1 försenad faktura" : `${late.length} försenade fakturor`}. Ska jag skicka påminnelser?`, {
    kind: "confirm",
    actionId: action.id,
    summary: "Betalningspåminnelse skickas med e-post till varje kund.",
    rows: late.map((i) => ({
      label: `Faktura #${i.number} – ${requireCustomer(i.customerId).name}`,
      value: `${kr(invoiceTotals(i).toPay)} · ${daysOverdue(i)} dagar sen`,
    })),
    confirmLabel: late.length === 1 ? "Skicka påminnelse" : "Skicka påminnelser",
    state: "vantar",
  });
  return true;
}

function intentFollowUpQuotes(text: string): boolean {
  if (!/följ upp/i.test(text)) return false;
  const daysMatch = text.match(/(\d+)\s*dag/);
  const minDays = daysMatch ? parseInt(daysMatch[1], 10) : 7;
  const data = db();
  const waiting = data.quotes.filter((q) => q.status === "skickad" && quoteWaitingDays(q) >= minDays);
  if (waiting.length === 0) {
    reply(`Ingen offert har väntat på BankID i mer än ${minDays} dagar.`);
    return true;
  }
  const action: PendingAssistantAction = { id: uid(), type: "folj_upp_offerter", quoteIds: waiting.map((q) => q.id) };
  addPending(action);
  reply("Dessa offerter väntar fortfarande på BankID-godkännande. Ska jag skicka en vänlig påminnelse?", {
    kind: "confirm",
    actionId: action.id,
    summary: "En påminnelse med offertlänken skickas till varje kund.",
    rows: waiting.map((q) => ({
      label: `Offert #${q.number} – ${requireCustomer(q.customerId).name}`,
      value: `${kr(quoteTotals(q).toPay)} · väntat ${quoteWaitingDays(q)} dagar`,
    })),
    confirmLabel: "Skicka påminnelser",
    state: "vantar",
  });
  return true;
}

function intentUnpaid(text: string): boolean {
  if (!/(inte betalat|obetal|väntar på betalning|vilka.*betalat)/i.test(text)) return false;
  const data = db();
  const unpaid = data.invoices.filter((i) => i.status === "skickad");
  if (unpaid.length === 0) {
    reply("Alla fakturor är betalda. Snyggt!");
    return true;
  }
  const total = unpaid.reduce((s, i) => s + invoiceTotals(i).toPay, 0);
  reply(`${unpaid.length === 1 ? "1 faktura väntar" : `${unpaid.length} fakturor väntar`} på betalning – totalt ${kr(total)}.`, {
    kind: "list",
    rows: unpaid.map((i) => ({
      label: `${requireCustomer(i.customerId).name} – faktura #${i.number}`,
      value: `${kr(invoiceTotals(i).toPay)}${isOverdue(i) ? ` · ${daysOverdue(i)} dagar sen` : ` · förfaller ${relativ(i.dueDate)}`}`,
      href: `/pengar/fakturor/${i.id}`,
    })),
  });
  return true;
}

function intentSpendingRoom(text: string): boolean {
  if (!/(spendera|utrymme|råd med)/i.test(text) && !(/moms/i.test(text) && /risk/i.test(text))) return false;
  const f = financeOverview();
  reply(
    `Du har ${kr(f.bank)} på banken. Jag reserverar ${kr(f.moms)} för moms (betalas ${datumLang(f.momsDue)}), ${kr(
      f.fSkatt
    )} för F-skatt och ${kr(f.payrollReserve)} för löneskatter. Kommande räkningar ligger på ${kr(
      f.upcoming
    )}. Ungefär ${kr(f.available)} är tryggt att spendera utan att riskera momsen.`
  );
  return true;
}

function intentMissingReceipts(text: string): boolean {
  if (!/(saknar kvitto|kvitto saknas|utan kvitto|köp saknar)/i.test(text)) return false;
  const missing = db().expenses.filter((e) => e.status === "saknar_kvitto");
  if (missing.length === 0) {
    reply("Alla köp har kvitton. Bokföringen är komplett.");
    return true;
  }
  reply(`${missing.length === 1 ? "1 köp saknar kvitto" : `${missing.length} köp saknar kvitto`}:`, {
    kind: "list",
    rows: missing.map((e) => ({
      label: `${e.supplier} – ${kr(e.amount)}`,
      value: datumLang(e.date),
    })),
    links: [{ label: "Lägg till kvitton under Pengar", href: "/pengar?flik=utgifter" }],
  });
  return true;
}

function intentCompanyStatus(text: string): boolean {
  if (!/(hur går|hur mår|läget|status för företaget)/i.test(text)) return false;
  const s = businessStats();
  const f = financeOverview();
  reply(
    `Det går bra. Du har fakturerat ${kr(s.revenueMonth)} den här månaden och ${kr(s.revenueYear)} i år, med en uppskattad vinst på ${kr(
      s.profitYear
    )}. ${kr(s.unpaidSum)} väntar på betalning${s.overdueCount > 0 ? ` (varav ${kr(s.overdueSum)} är försenat)` : ""} och ${kr(
      s.upcomingIncome
    )} är på väg in från godkända offerter som inte fakturerats klart. På banken finns ${kr(f.bank)}, varav ungefär ${kr(f.available)} är tillgängligt efter moms, skatt och räkningar.`,
    { kind: "links", links: [{ label: "Öppna Pengar", href: "/pengar" }] }
  );
  return true;
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
  let jobLabel = "";
  const jobMatch = text.match(/till\s+([A-Za-zÅÄÖåäö]+)s?\s+(?:jobb|uppdrag)/i);
  if (jobMatch) {
    const jobCustomers = findCustomersByName(jobMatch[1]);
    if (jobCustomers.length === 1) {
      const job = data.jobs.find((j) => j.customerId === jobCustomers[0].id && j.status !== "klart");
      if (job) {
        jobId = job.id;
        jobLabel = ` och kopplas till uppdraget ${job.title}`;
      }
    }
  }

  const action: PendingAssistantAction = { id: uid(), type: "bokfor_utgift", expenseId: expense.id, category: categoryKey, jobId };
  addPending(action);
  reply(`Köpet hos ${expense.supplier} på ${kr(expense.amount)} bokförs som ${categoryKey === "material" ? "material" : categoryKey}${jobLabel}. Ser det rätt ut?`, {
    kind: "confirm",
    actionId: action.id,
    summary: expense.receiptId
      ? "Verifikation skapas automatiskt med kvittot som underlag."
      : "Verifikation skapas automatiskt. Kvitto saknas fortfarande – ladda gärna upp det i efterhand.",
    rows: [
      { label: expense.supplier, value: kr(expense.amount) },
      { label: "Kategori", value: categoryKey === "material" ? "Material" : cap(categoryKey) },
      ...(jobLabel ? [{ label: "Kopplas till", value: jobLabel.replace(" och kopplas till uppdraget ", "") }] : []),
    ],
    confirmLabel: "Bokför",
    state: "vantar",
  });
  return true;
}

function intentWebsite(text: string): boolean {
  if (!/hemsida|webbplats|sajt/i.test(text) || !/(skapa|bygg|gör|fixa|generera)/i.test(text)) return false;
  const action: PendingAssistantAction = { id: uid(), type: "generera_hemsida", description: text };
  addPending(action);
  const existing = db().website;
  reply(
    existing
      ? "Jag tar fram ett nytt hemsideutkast utifrån din beskrivning. Det ersätter det nuvarande innehållet under Hemsida, men inget publiceras förrän du godkänner det. Ska jag köra?"
      : "Jag tar fram ett hemsideutkast utifrån din beskrivning. Du får förhandsgranska allt innan något publiceras. Ska jag köra?",
    {
      kind: "confirm",
      actionId: action.id,
      summary: "Startsida, tjänster, om oss, galleri och kontaktformulär med offertförfrågan genereras.",
      confirmLabel: "Skapa utkast",
      state: "vantar",
    }
  );
  return true;
}

function intentMoms(text: string): boolean {
  if (!/moms/i.test(text)) return false;
  const m = momsForCurrentPeriod();
  reply(
    `Beräknad moms att betala för ${m.namn} är ${kr(Math.max(0, m.attBetala))} (utgående ${kr(m.utgaende)} minus ingående ${kr(
      m.ingaende
    )}). Förfallodatum: ${datumLang(m.due)}. Beloppet uppdateras löpande när fakturor och kvitton bokförs.`,
    { kind: "links", links: [{ label: "Öppna Bokföring", href: "/bokforing" }] }
  );
  return true;
}

function intentGreetingOrHelp(text: string): boolean {
  const isGreeting = /^(hej|tja|hallå|god morgon|godmorgon|tjena|hejsan)\b/i.test(text.trim());
  if (!isGreeting) return false;
  reply("Hej! Jag kan utföra saker i hela produkten – här är några exempel:", helpCard());
  return true;
}

function helpCard(): AssistantCard {
  return {
    kind: "list",
    rows: [
      { label: "”Skapa en offert till Anna för köksrenoveringen, 85 000 kr, 30 % vid start”" },
      { label: "”Skicka en påminnelse till alla vars fakturor är sena”" },
      { label: "”Följ upp alla offerter som väntat på BankID i mer än 7 dagar”" },
      { label: "”Vilka kunder har inte betalat?”" },
      { label: "”Hur mycket kan jag spendera utan att riskera momsen?”" },
      { label: "”Vilka köp saknar kvitto?”" },
      { label: "”Boka Bauhaus-köpet som material till Annas uppdrag”" },
      { label: "”Hur går företaget?”" },
    ],
  };
}

/* ------------------------------- Publikt API ------------------------------- */

export function sendUserMessage(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  push({ role: "user", text: trimmed });

  const handled =
    intentGreetingOrHelp(trimmed) ||
    intentCreateQuote(trimmed) ||
    intentRemindLate(trimmed) ||
    intentFollowUpQuotes(trimmed) ||
    intentUnpaid(trimmed) ||
    intentSpendingRoom(trimmed) ||
    intentMissingReceipts(trimmed) ||
    intentCompanyStatus(trimmed) ||
    intentBookExpense(trimmed) ||
    intentWebsite(trimmed) ||
    intentMoms(trimmed);

  if (!handled) {
    reply("Det där har jag inte lärt mig ännu. Här är sådant jag kan hjälpa till med direkt:", helpCard());
  }
  save();
}

function updateConfirmCard(actionId: string, state: "utford" | "avbruten", resultText?: string): void {
  for (const m of db().assistantMessages) {
    if (m.card?.kind === "confirm" && m.card.actionId === actionId) {
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
