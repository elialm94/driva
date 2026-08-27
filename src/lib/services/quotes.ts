import { db, save } from "../store";
import { uid, publicToken } from "../ids";
import type { DocLine, PaymentPlanPart, Quote, QuoteVersion, RotRut } from "../types";
import { currentVersion, getQuote, requireCustomer } from "./data";
import { docTotals } from "../calc";
import { kr, isoDaysFromNow } from "../format";
import { logActivity } from "./activity";
import { taxReductionFields } from "../tax-reduction-terms";
import { sellerSnapshot } from "../invoices/snapshot";

export interface QuoteInput {
  customerId: string;
  requestId?: string;
  jobId?: string;
  title: string;
  intro: string;
  lines: DocLine[];
  rot: RotRut | null;
  paymentPlan: PaymentPlanPart[];
  paymentTermsDays: number;
  lateInterestRate?: number;
  validUntil: string;
  terms: string;
}

export const STANDARD_TERMS =
  "Offerten omfattar arbete och material enligt specifikationen ovan. Eventuella tillkommande arbeten offereras separat innan de påbörjas. Vi innehar F-skattsedel och full ansvarsförsäkring. Garanti lämnas enligt konsumenttjänstlagen.";

export function createQuote(input: QuoteInput, createdBy: "anvandare" | "assistent" = "anvandare"): Quote {
  const data = db();
  const customer = requireCustomer(input.customerId);
  const quoteId = uid();
  const versionId = uid();
  const number = data.sequences.quote++;
  const now = new Date().toISOString();

  const version: QuoteVersion = {
    id: versionId,
    quoteId,
    version: 1,
    title: input.title,
    intro: input.intro,
    lines: input.lines,
    paymentPlan: input.paymentPlan,
    paymentTermsDays: input.paymentTermsDays,
    lateInterestRate: input.lateInterestRate ?? data.settings.lateInterestRate,
    validUntil: input.validUntil,
    terms: input.terms,
    ...taxReductionFields(input.rot),
    createdAt: now,
  };

  const quote: Quote = {
    id: quoteId,
    number,
    customerId: input.customerId,
    requestId: input.requestId,
    jobId: input.jobId,
    status: "utkast",
    currentVersionId: versionId,
    token: publicToken(),
    followUps: [],
    createdAt: now,
  };

  data.quoteVersions.push(version);
  data.quotes.push(quote);

  if (input.requestId) {
    const req = data.requests.find((r) => r.id === input.requestId);
    if (req) {
      req.status = "offert_skapad";
      req.quoteId = quoteId;
    }
  }

  if (input.jobId) {
    const job = data.jobs.find((j) => j.id === input.jobId);
    if (job && !job.quoteId) job.quoteId = quoteId;
  }

  logActivity(
    createdBy === "assistent"
      ? `Assistenten skapade utkast till offert #${number} för ${customer.name}.`
      : `Offert #${number} skapades för ${customer.name}.`,
    { customerId: customer.id, entity: { type: "offert", id: quoteId } }
  );
  save();
  return quote;
}

export type QuoteVersionInput = Omit<QuoteInput, "customerId" | "requestId" | "jobId">;

/**
 * Uppdatera en offert. Låsta (BankID-signerade) versioner ändras aldrig –
 * i stället skapas en ny version som måste signeras på nytt.
 */
export function updateQuote(quoteId: string, input: QuoteVersionInput): Quote {
  const data = db();
  const quote = getQuote(quoteId);
  if (!quote) throw new Error("Offerten finns inte");
  const version = currentVersion(quote);

  if (version.lockedAt || quote.status === "godkand") {
    // Ny version krävs efter signering.
    const newVersion: QuoteVersion = {
      id: uid(),
      quoteId,
      version: version.version + 1,
      ...input,
      ...taxReductionFields(input.rot),
      createdAt: new Date().toISOString(),
    };
    data.quoteVersions.push(newVersion);
    quote.currentVersionId = newVersion.id;
    quote.status = "utkast";
    quote.sentAt = undefined;
    quote.viewedAt = undefined;
    quote.decidedAt = undefined;
    logActivity(
      `Ny version (v${newVersion.version}) av offert #${quote.number} skapades. Den behöver signeras med BankID på nytt.`,
      { customerId: quote.customerId, entity: { type: "offert", id: quoteId } }
    );
  } else {
    Object.assign(version, input, taxReductionFields(input.rot));
    version.sellerSnapshot = undefined;
    if (quote.status === "skickad") {
      quote.status = "utkast";
      quote.sentAt = undefined;
      quote.viewedAt = undefined;
    }
  }
  save();
  return quote;
}

/** Skicka offerten till kunden (efter preview). */
export function sendQuote(quoteId: string): Quote {
  const quote = getQuote(quoteId);
  if (!quote) throw new Error("Offerten finns inte");
  const customer = requireCustomer(quote.customerId);
  const version = currentVersion(quote);
  // Ingen ROT/RUT-offert får skickas utan systemvillkoret, oavsett skapandeflöde.
  if (!version.lockedAt) {
    Object.assign(version, taxReductionFields(version.rot));
    version.sellerSnapshot = sellerSnapshot(db().settings);
  }
  const t = docTotals(version.lines, version.rot);
  quote.status = "skickad";
  quote.sentAt = new Date().toISOString();
  logActivity(`Offert #${quote.number} skickades till ${customer.name} (${kr(t.toPay)}).`, {
    customerId: customer.id,
    entity: { type: "offert", id: quoteId },
  });
  save();
  return quote;
}

/** Kunden öppnade offertlänken. */
export function markQuoteViewed(quoteId: string): void {
  const quote = getQuote(quoteId);
  if (!quote || quote.viewedAt || quote.status !== "skickad") return;
  quote.viewedAt = new Date().toISOString();
  const customer = requireCustomer(quote.customerId);
  logActivity(`${customer.name} öppnade offert #${quote.number}.`, {
    customerId: customer.id,
    entity: { type: "offert", id: quoteId },
  });
  save();
}

export function declineQuote(quoteId: string, reason?: string): void {
  const quote = getQuote(quoteId);
  if (!quote || quote.status === "godkand") return;
  quote.status = "avbojd";
  quote.decidedAt = new Date().toISOString();
  quote.declineReason = reason;
  const customer = requireCustomer(quote.customerId);
  logActivity(
    `${customer.name} avböjde offert #${quote.number}${reason ? ` – ”${reason}”` : ""}.`,
    { customerId: customer.id, entity: { type: "offert", id: quoteId } }
  );
  save();
}

/** Skicka en vänlig påminnelse om en obesvarad offert. */
export function followUpQuote(quoteId: string, by: "anvandare" | "assistent" = "anvandare"): void {
  const quote = getQuote(quoteId);
  if (!quote || quote.status !== "skickad") return;
  quote.followUps.push(new Date().toISOString());
  const customer = requireCustomer(quote.customerId);
  logActivity(
    `${by === "assistent" ? "Assistenten skickade" : "Du skickade"} en påminnelse till ${customer.name} om offert #${quote.number}.`,
    { customerId: customer.id, entity: { type: "offert", id: quoteId } }
  );
  save();
}

/** En kundfråga från offertsidan. */
export function askQuoteQuestion(quoteId: string, question: string): void {
  const quote = getQuote(quoteId);
  if (!quote) return;
  const customer = requireCustomer(quote.customerId);
  logActivity(`${customer.name} ställde en fråga om offert #${quote.number}: ”${question}”`, {
    customerId: customer.id,
    entity: { type: "offert", id: quoteId },
  });
  save();
}

/** Standardvärden för en ny offert. */
export function quoteDefaults() {
  const settings = db().settings;
  return {
    paymentTermsDays: settings.paymentTermsDays,
    lateInterestRate: settings.lateInterestRate,
    validUntil: isoDaysFromNow(settings.quoteValidityDays ?? 30),
    defaultVatRate: settings.defaultVatRate ?? 25,
    terms: STANDARD_TERMS,
  };
}
