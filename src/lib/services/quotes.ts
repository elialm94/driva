import { db, save } from "../store";
import { uid, publicToken } from "../ids";
import type { DocLine, PaymentPlanPart, Quote, QuoteVersion, RotRut } from "../types";
import type { RichTextDoc } from "../richtext";
import { sanitizeRichText } from "../richtext";
import { currentVersion, getQuote, requireCustomer } from "./data";
import { docTotals } from "../calc";
import { kr, isoDaysFromNow, dagarTill, datumKort } from "../format";
import { logActivity } from "./activity";
import { taxReductionFields } from "../tax-reduction-terms";
import { rotWithAmounts } from "../tax-reduction-amount";
import { sellerSnapshot } from "../invoices/snapshot";
import { missingEmailForSend } from "../customer-validation";

export interface QuoteInput {
  customerId: string;
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
  /** Beskrivning – saneras alltid serverside (vitlista, se lib/richtext). */
  richText?: RichTextDoc;
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
    richText: sanitizeRichText(input.richText),
    ...taxReductionFields(rotWithAmounts(input.rot, input.lines, { documentKind: "offert" })),
    createdAt: now,
  };

  const quote: Quote = {
    id: quoteId,
    number,
    customerId: input.customerId,
    jobId: input.jobId,
    status: "utkast",
    currentVersionId: versionId,
    token: publicToken(),
    followUps: [],
    createdAt: now,
  };

  data.quoteVersions.push(version);
  data.quotes.push(quote);

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

export type QuoteVersionInput = Omit<QuoteInput, "customerId" | "jobId">;

/**
 * Uppdatera en offert. Låsta (BankID-signerade) versioner ändras aldrig –
 * i stället skapas en ny version som måste signeras på nytt.
 */
export function updateQuote(quoteId: string, input: QuoteVersionInput): Quote {
  const data = db();
  const quote = getQuote(quoteId);
  if (!quote) throw new Error("Offerten finns inte");
  const version = currentVersion(quote);
  // Servergräns: klientens rika text lita aldrig på rakt av.
  input = { ...input, richText: sanitizeRichText(input.richText) };

  if (version.lockedAt || quote.status === "godkand") {
    // Ny version krävs efter signering.
    const newVersion: QuoteVersion = {
      id: uid(),
      quoteId,
      version: version.version + 1,
      ...input,
      ...taxReductionFields(rotWithAmounts(input.rot, input.lines, { documentKind: "offert" })),
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
    Object.assign(version, input, taxReductionFields(rotWithAmounts(input.rot, input.lines, { documentKind: "offert" })));
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

export interface QuoteSendBlocker {
  code: string;
  message: string;
  href?: string;
  actionLabel?: string;
}

/**
 * Vad som saknas innan offerten kan skickas — EN källa för checklistan på
 * offertsidan och skickaflödet. Saknad kund-e-post (code "buyer_email")
 * namnges explicit och kompletteras inline i skickaflödet utan att avbryta.
 */
export function quoteSendBlockers(quoteId: string): QuoteSendBlocker[] {
  const quote = getQuote(quoteId);
  if (!quote) return [];
  const version = currentVersion(quote);
  const blockers: QuoteSendBlocker[] = [];
  if (dagarTill(version.validUntil) < 0) {
    blockers.push({
      code: "valid_until_passed",
      message: `Giltig till-datumet (${datumKort(version.validUntil)}) har passerat – kunden skulle inte kunna godkänna offerten.`,
      href: `/ekonomi/offerter/${quote.id}/redigera`,
      actionLabel: "Ändra datum",
    });
  }
  const emailBlocker = missingEmailForSend(requireCustomer(quote.customerId));
  if (emailBlocker) {
    // Namnges i checklistan; kompletteras inline i skickaflödet – ingen länk till Kunden.
    blockers.push(emailBlocker);
  }
  return blockers;
}

/** Leveransutfall från e-postlagret. Produktionsvägen anropar bara hit efter provider-succé. */
export interface QuoteDeliveryInfo {
  /** "demo": demoföretagets utskick – simulerat eller till DEMO_EMAIL_SINK. */
  mode: "mock" | "live" | "test" | "demo";
  ok: boolean;
  messageId?: string;
  sentTo?: string;
}

const MOCK_DELIVERY: QuoteDeliveryInfo = { mode: "mock", ok: true };

/** Skicka offerten till kunden. E-posten skickas av document-mail.ts – här uppdateras tillstånd och aktivitet. */
export function sendQuote(quoteId: string, delivery: QuoteDeliveryInfo = MOCK_DELIVERY): Quote {
  const quote = getQuote(quoteId);
  if (!quote) throw new Error("Offerten finns inte");
  const customer = requireCustomer(quote.customerId);
  const version = currentVersion(quote);
  if (dagarTill(version.validUntil) < 0) {
    throw new Error(
      `Offertens giltighetsdatum (${datumKort(version.validUntil)}) har passerat – kunden skulle inte kunna godkänna den. Ändra "Giltig till" och skicka sedan.`
    );
  }
  // Ingen ROT/RUT-offert får skickas utan systemvillkoret, oavsett skapandeflöde.
  if (!version.lockedAt) {
    Object.assign(version, taxReductionFields(rotWithAmounts(version.rot, version.lines, { documentKind: "offert", mode: "clamp" })));
    version.sellerSnapshot = sellerSnapshot(db().settings);
  }
  const t = docTotals(version.lines, version.rot);
  quote.status = "skickad";
  quote.sentAt = new Date().toISOString();
  quote.lastSendAttemptAt = quote.sentAt;
  if (delivery.messageId && delivery.sentTo) {
    quote.lastEmail = { provider: "resend", messageId: delivery.messageId, sentTo: delivery.sentTo };
  }
  const emailed = delivery.mode !== "mock" && delivery.ok;
  logActivity(
    emailed
      ? `Offert #${quote.number} skickades med e-post till ${delivery.sentTo ?? customer.email} (${kr(t.toPay)}).`
      : `Offert #${quote.number} markerades som skickad (${kr(t.toPay)}).`,
    {
      customerId: customer.id,
      entity: { type: "offert", id: quoteId },
    }
  );
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

/**
 * "Inte aktuell" – ägarsidans avslut av en väntande/utgången offert (till
 * skillnad från declineQuote som är kundens nej via den publika länken).
 * Riktig domänövergång: status avbojd + skäl; offerten ligger kvar i
 * registret och kundhistoriken men lämnar "Behöver din uppmärksamhet".
 */
export function markQuoteNotRelevant(quoteId: string, reason = "Inte längre aktuell"): Quote {
  const quote = getQuote(quoteId);
  if (!quote) throw new Error("Offerten finns inte.");
  if (quote.status !== "skickad") throw new Error("Bara skickade offerter kan markeras som inte aktuella.");
  quote.status = "avbojd";
  quote.decidedAt = new Date().toISOString();
  quote.declineReason = reason;
  const customer = requireCustomer(quote.customerId);
  logActivity(`Offert #${quote.number} markerades som inte aktuell.`, {
    customerId: customer.id,
    entity: { type: "offert", id: quoteId },
  });
  save();
  return quote;
}

/** Skicka en vänlig påminnelse om en obesvarad offert. */
export function followUpQuote(
  quoteId: string,
  by: "anvandare" | "assistent" = "anvandare",
  delivery: QuoteDeliveryInfo = MOCK_DELIVERY
): void {
  const quote = getQuote(quoteId);
  if (!quote || quote.status !== "skickad") return;
  quote.followUps.push(new Date().toISOString());
  const customer = requireCustomer(quote.customerId);
  const emailed = delivery.mode !== "mock" && delivery.ok;
  const who = by === "assistent" ? "Assistenten" : "Du";
  logActivity(
    emailed
      ? `${who} skickade en påminnelse med e-post till ${customer.name} om offert #${quote.number}.`
      : `${who} noterade en påminnelse om offert #${quote.number}.`,
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
