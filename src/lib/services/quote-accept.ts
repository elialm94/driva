import { db, save } from "../store";
import { uid } from "../ids";
import type { Quote, QuoteAcceptance, QuoteAcceptanceMethod, QuoteVersion } from "../types";
import { quoteVersionHash } from "../hash";
import { docTotals } from "../calc";
import { dagarTill } from "../format";
import { buyerSnapshot, resolveQuoteCompany, sellerSnapshot } from "../invoices/snapshot";
import { acceptanceStatement, normalizeAcceptName } from "../quote-acceptance";
import { isDemoBusiness, isDemoMode } from "../demo";
import { isEmailFormat } from "../settings-validation";
import { mailProviderAvailable, type MailMessage, type MailSendMeta } from "../mail";
import { prepareQuoteAcceptedMail } from "../email/service";
import { currentVersion, getQuoteByToken, quoteAcceptance, requireCustomer } from "./data";
import { logActivity } from "./activity";
import { createJobFromQuote } from "./jobs";

/**
 * Offertgodkännande via offertlänken – den ENDA vägen för kunden att godkänna.
 *
 *   * acceptQuote(token, namn) är kanonisk: sidan anropar den via en publik
 *     server action. Assistenten har inget verktyg som når hit (den känner
 *     aldrig till kundens token), och ägaren kan inte godkänna åt kunden.
 *   * Samma atomiska väg som tidigare BankID-slutförandet: lås versionen,
 *     spara beviset, sätt godkänd, skapa/koppla uppdraget, en save().
 *   * Idempotent: en redan godkänd offert returnerar det befintliga
 *     godkännandet – dubbeltryck skapar aldrig två uppdrag.
 *   * Kundens namn krävs (trimmat, aldrig tomt). Inget personnummer, ingen
 *     ritad signatur, ingen legitimering – och det påstås inte heller.
 */

export type QuoteAcceptErrorCode =
  | "not_found"
  | "name_required"
  | "declined"
  | "expired"
  | "not_acceptable"
  | "changed"
  | "too_many";

export const QUOTE_ACCEPT_TEXT: Record<QuoteAcceptErrorCode, string> = {
  not_found: "Offerten finns inte eller kan inte visas.",
  name_required: "Skriv ditt namn för att godkänna offerten.",
  declined: "Offerten är avböjd och kan inte godkännas. Kontakta företaget om du ändrat dig.",
  expired: "Offertens giltighetstid har gått ut. Kontakta företaget för en uppdaterad offert.",
  not_acceptable: "Offerten kan inte godkännas i sitt nuvarande läge.",
  changed: "Offerten har ändrats sedan du öppnade den. Ladda om sidan och läs igenom den igen.",
  too_many: "För många försök. Vänta en stund och försök igen.",
};

export class QuoteAcceptError extends Error {
  readonly code: QuoteAcceptErrorCode;
  constructor(code: QuoteAcceptErrorCode) {
    super(QUOTE_ACCEPT_TEXT[code]);
    this.name = "QuoteAcceptError";
    this.code = code;
  }
}

/* -------------------------------- rate limit -------------------------------- */

const ACCEPT_WINDOW_MS = 10 * 60_000;
const MAX_ATTEMPTS_PER_TOKEN = 10;
const MAX_ATTEMPTS_PER_IP = 40;
const attemptsByKey = new Map<string, number[]>();

function withinLimit(key: string, max: number, now: number): boolean {
  const list = attemptsByKey.get(key) ?? [];
  while (list.length > 0 && now - list[0] > ACCEPT_WINDOW_MS) list.shift();
  if (list.length >= max) return false;
  list.push(now);
  attemptsByKey.set(key, list);
  if (attemptsByKey.size > 5_000) {
    for (const [k, v] of attemptsByKey) {
      while (v.length > 0 && now - v[0] > ACCEPT_WINDOW_MS) v.shift();
      if (v.length === 0) attemptsByKey.delete(k);
    }
  }
  return true;
}

/** Grundläggande skydd mot skriptade försök: per token och per IP, glidande fönster. */
export function rateLimitQuoteAccept(token: string, ip: string | undefined, now = Date.now()): boolean {
  const tokenOk = withinLimit(`token:${token}`, MAX_ATTEMPTS_PER_TOKEN, now);
  const ipOk = ip ? withinLimit(`ip:${ip}`, MAX_ATTEMPTS_PER_IP, now) : true;
  return tokenOk && ipOk;
}

export function __resetQuoteAcceptRateLimitForTests(): void {
  attemptsByKey.clear();
}

/* --------------------------------- statement -------------------------------- */

/** Meningen kunden godkänner – samma text på sidan och i det sparade beviset. */
export function quoteAcceptanceStatement(quote: Quote, version: QuoteVersion = currentVersion(quote)): string {
  const seller = resolveQuoteCompany(version, db().settings);
  const t = docTotals(version.lines, version.rot);
  return acceptanceStatement({
    title: version.title,
    companyName: seller.name,
    datedIso: version.createdAt,
    total: t.total,
    deduction: t.deduction,
  });
}

/* --------------------------------- acceptera -------------------------------- */

export interface AcceptQuoteInput {
  token: string;
  name: string;
  /** Hashen sidan renderade – kunden godkänner exakt det dokumentet. */
  expectedContentHash?: string;
  ip?: string;
  userAgent?: string;
}

export interface AcceptQuoteResult {
  outcome: "accepted" | "already_accepted";
  quote: Quote;
  acceptance: QuoteAcceptance;
}

export function acceptQuote(input: AcceptQuoteInput): AcceptQuoteResult {
  const token = typeof input.token === "string" ? input.token.trim() : "";
  if (!token) throw new QuoteAcceptError("not_found");
  if (!rateLimitQuoteAccept(token, input.ip)) throw new QuoteAcceptError("too_many");

  const quote = getQuoteByToken(token);
  // Utkast är inte publika: samma svar som för en okänd länk.
  if (!quote || quote.status === "utkast") throw new QuoteAcceptError("not_found");

  const existing = quoteAcceptance(quote.id);
  if (quote.status === "godkand" && existing) {
    return { outcome: "already_accepted", quote, acceptance: existing };
  }

  const name = normalizeAcceptName(input.name);
  if (!name) throw new QuoteAcceptError("name_required");

  if (quote.status === "avbojd") throw new QuoteAcceptError("declined");
  if (quote.status !== "skickad") throw new QuoteAcceptError("not_acceptable");
  const version = currentVersion(quote);
  if (dagarTill(version.validUntil) < 0) throw new QuoteAcceptError("expired");

  // Kunden godkänner det dokument hen såg – inte en version som hunnit ändras.
  const currentHash = quoteVersionHash(version);
  if (input.expectedContentHash && input.expectedContentHash !== currentHash) {
    throw new QuoteAcceptError("changed");
  }
  if (version.lockedAt && version.contentHash && version.contentHash !== currentHash) {
    throw new QuoteAcceptError("changed");
  }

  const acceptance = finalizeQuoteAcceptance(quote, version, {
    method: "simple_accept",
    acceptedByName: name,
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { outcome: "accepted", quote, acceptance };
}

export interface FinalizeAcceptanceInput {
  method: QuoteAcceptanceMethod;
  acceptedByName: string;
  ip?: string;
  userAgent?: string;
  bankid?: QuoteAcceptance["bankid"];
}

/**
 * Den gemensamma slutpunkten: låser versionen, sparar beviset, markerar
 * offerten godkänd och skapar eller kopplar uppdraget – i en save().
 * Anroparen har redan kontrollerat status. Används av acceptQuote och av
 * den kvarvarande mock-BankID-providern (som inte längre nås från kundsidan).
 */
export function finalizeQuoteAcceptance(
  quote: Quote,
  version: QuoteVersion,
  input: FinalizeAcceptanceInput
): QuoteAcceptance {
  const data = db();
  const existing = quoteAcceptance(quote.id);
  if (quote.status === "godkand" && existing) return existing;
  if (quote.status !== "skickad") throw new QuoteAcceptError("not_acceptable");
  if (quote.currentVersionId !== version.id) throw new QuoteAcceptError("changed");

  const customer = requireCustomer(quote.customerId);
  const now = new Date().toISOString();

  // 1. Lås exakt den version kunden godkände. Snapshots ingår inte i hashen.
  if (!version.sellerSnapshot) version.sellerSnapshot = sellerSnapshot(data.settings);
  if (!version.buyerSnapshot) version.buyerSnapshot = buyerSnapshot(customer);
  version.lockedAt = now;
  version.contentHash = quoteVersionHash(version);

  // 2. Beviset: vad, vem, när, varifrån – och den mening kunden godkände.
  const email = customer.email?.trim();
  const acceptance: QuoteAcceptance = {
    id: uid(),
    quoteId: quote.id,
    quoteVersionId: version.id,
    method: input.method,
    acceptedAt: now,
    acceptedByName: input.acceptedByName,
    customerNameAtAccept: customer.name,
    ...(email && isEmailFormat(email) ? { acceptedByEmail: email } : {}),
    contentHash: version.contentHash,
    statement: quoteAcceptanceStatement(quote, version),
    ...(input.ip ? { ip: input.ip } : {}),
    ...(input.userAgent ? { userAgent: input.userAgent.slice(0, 512) } : {}),
    ...(quote.lastEmail?.sentTo ? { linkSentTo: quote.lastEmail.sentTo } : {}),
    ...(input.bankid ? { bankid: input.bankid } : {}),
  };
  data.signatures.push(acceptance);

  // 3. Offerten är godkänd.
  quote.status = "godkand";
  quote.decidedAt = now;

  // 4. Koppla till befintligt uppdrag, eller skapa ett – aldrig ett andra.
  const hadJob = Boolean(
    (quote.jobId && data.jobs.some((j) => j.id === quote.jobId)) || data.jobs.some((j) => j.quoteId === quote.id)
  );
  const job = createJobFromQuote(quote);
  quote.jobId = job.id;

  // 5. Företagaren ser det direkt i aktiviteten – inget klick krävs av kunden.
  logActivity(
    hadJob
      ? `${acceptance.acceptedByName} godkände offert #${quote.number}.`
      : `${acceptance.acceptedByName} godkände offert #${quote.number}. Uppdraget ${version.title} skapades.`,
    { customerId: customer.id, entity: { type: "offert", id: quote.id } }
  );

  save();
  return acceptance;
}

/* ------------------------------- notifiering -------------------------------- */

export interface PreparedAcceptedMail {
  message: MailMessage;
  meta: MailSendMeta;
}

/**
 * Mejl till företagaren om att offerten godkänts. Förbereds INNE i tenant-
 * kontexten (företagsnamn, mottagare) och skickas av anroparen efter svaret
 * (next/server after) så att kunden aldrig väntar på e-posttjänsten.
 * Demo och demoföretaget: ingen Resend, ingen förberedelse.
 * Returnerar null när inget ska skickas. Får aldrig kasta.
 */
export function prepareQuoteAcceptedNotice(acceptance: QuoteAcceptance): PreparedAcceptedMail | null {
  try {
    if (isDemoBusiness() || isDemoMode()) return null;
    if (!mailProviderAvailable()) return null;
    const to = db().settings.email?.trim();
    if (!to || !isEmailFormat(to)) return null;
    const quote = db().quotes.find((q) => q.id === acceptance.quoteId);
    const version = db().quoteVersions.find((v) => v.id === acceptance.quoteVersionId);
    if (!quote || !version) return null;
    const t = docTotals(version.lines, version.rot);
    return prepareQuoteAcceptedMail({
      to,
      quoteId: quote.id,
      quoteNumber: quote.number,
      title: version.title,
      acceptedByName: acceptance.acceptedByName,
      acceptedAt: acceptance.acceptedAt,
      amount: t.toPay,
    });
  } catch {
    return null;
  }
}
