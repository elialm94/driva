import { db } from "../store";
import { uid } from "../ids";
import type { AssistantCard, Customer, Job } from "../types";
import type { AiToolDef } from "./provider";
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
  unpaidInvoicesResult,
  checkDomainAvailabilityResult,
  getDomainStatusResult,
  requestPurchaseDomain,
  type DomainResult,
} from "./domain";
import { currentVersion, getCustomer, getInvoice, getJob, getQuote, isOverdue } from "../services/data";
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

type ToolSpec = {
  def: AiToolDef;
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

const specs: ToolSpec[] = [
  {
    requiresConfirmation: false,
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
    def: {
      type: "function",
      function: {
        name: "list_open_inquiries",
        description:
          "Lista öppna förfrågningar (list open inquiries). Samma inbox som Kunder → Förfrågningar. Använd före create_quote när användaren nämner en förfrågan, t.ex. Karins bokhylla.",
        parameters: obj({ q: { type: "string", description: "Valfritt sökord: kund, företag, text" } }),
      },
    },
    handler: (args) => fromDomain(listOpenInquiriesResult(str(args, "q"))),
  },
  {
    requiresConfirmation: false,
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
      return { ok: true, forModel: { quotes: rows, count: rows.length } };
    },
  },
  {
    requiresConfirmation: false,
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
    def: {
      type: "function",
      function: {
        name: "list_overdue_invoices",
        description: "Lista försenade fakturor (overdue invoices).",
        parameters: obj({}),
      },
    },
    handler: () => {
      const late = db().invoices.filter(isOverdue);
      return { ok: true, forModel: { invoices: late.map(compactInvoice), count: late.length } };
    },
  },
  {
    requiresConfirmation: false,
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
    def: {
      type: "function",
      function: {
        name: "attention_items",
        description: "Vad som behöver göras idag (attention items / to-do).",
        parameters: obj({}),
      },
    },
    handler: () => fromDomain(todayAttentionResult()),
  },
  {
    requiresConfirmation: false,
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
        })
      );
    },
  },
  {
    requiresConfirmation: false,
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
      let customerId = str(args, "customerId");
      const name = str(args, "customerName");
      if (!customerId && name) {
        const resolved = resolveOrAsk(name, { kind: "create_quote", title, amountInclVat: amount, rot });
        if (!("customer" in resolved)) return resolved;
        customerId = resolved.customer.id;
      }
      if (!customerId) return { ok: false, forModel: {}, error: "customerName eller customerId krävs" };
      return fromDomain(createQuoteDraft({ customerId, title, amountInclVat: amount, percentAtStart: num(args, "percentAtStart"), rot, requestId: str(args, "requestId") }));
    },
  },
  {
    requiresConfirmation: false,
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
      if (!customerId && name) {
        const resolved = resolveOrAsk(name, { kind: "create_invoice", title, amountInclVat: amount, jobId, taxReduction });
        if (!("customer" in resolved)) return resolved;
        customerId = resolved.customer.id;
      }
      if (!customerId) return { ok: false, forModel: {}, error: "customerName eller customerId krävs" };
      return fromDomain(createInvoiceDraft({ customerId, title, amountInclVat: amount, jobId, taxReduction }));
    },
  },
  {
    requiresConfirmation: false,
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
];

export function assistantToolDefs(): AiToolDef[] {
  return specs.map((s) => s.def);
}

export function toolRequiresConfirmation(name: string): boolean {
  return specs.find((s) => s.def.function.name === name)?.requiresConfirmation ?? false;
}

export async function executeTool(name: string, rawArgs: unknown): Promise<ToolResult> {
  const spec = specs.find((s) => s.def.function.name === name);
  if (!spec) return { ok: false, forModel: {}, error: `Okänt verktyg: ${name}` };
  const args = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as Record<string, unknown>;
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
