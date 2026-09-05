import { db, save } from "../store";
import { uid } from "../ids";
import { chartAccount } from "./chart";
import type { Verification, VerificationEntry, VerificationSource } from "../types";
import { bokforingsdatum, ensureFiscalYearFor, isDateLocked, lockedThrough } from "./fiscal";
import { logAudit } from "./audit";

/**
 * Central verifikationsmotor. ALL bokföring går genom `postVerification` –
 * UI, AI och automatik använder samma väg. Motorn garanterar:
 *
 *  1. Balans: summa debet = summa kredit (annars PostingError, inget sparas).
 *  2. Endast aktiva konton ur kontoregistret (accounting/chart.ts), hela
 *     kronor, inga negativa belopp.
 *  3. Atomär nummertilldelning per serie (synkron read-modify-write).
 *  4. Periodlås: inget bokförs i låst period eller stängt räkenskapsår.
 *  5. Oföränderlighet: bokförda verifikationer ändras/tas aldrig bort –
 *     rättelser skapas med `createCorrection` (omvänd verifikation + ev. ny).
 *
 * AI:n har inga undantag: den kan bara nå bokföringen via denna motor.
 */

export type PostingErrorCode =
  | "obalanserad"
  | "tom"
  | "ogiltigt_belopp"
  | "okant_konto"
  | "period_last"
  | "rakenskapsar_stangt"
  | "redan_rattad";

export class PostingError extends Error {
  code: PostingErrorCode;
  constructor(code: PostingErrorCode, message: string) {
    super(message);
    this.name = "PostingError";
    this.code = code;
  }
}

export interface PostLineInput {
  account: number;
  debit?: number;
  credit?: number;
  vatCode?: string;
  note?: string;
}

export interface PostVerificationInput {
  /** Bokföringsdatum (ISO eller YYYY-MM-DD). */
  date: string;
  description: string;
  entries: PostLineInput[];
  source: VerificationSource;
  confidence?: Verification["confidence"];
  createdBy: Verification["createdBy"];
  /** Klarspråksförklaring som visas för användaren ("Varför bokfördes detta?"). */
  explanation?: string;
  correctsVerificationId?: string;
}

/** Normalisera och validera rader. Kastar PostingError vid fel – inget sparas. */
export function validateEntries(input: PostLineInput[]): VerificationEntry[] {
  if (!input || input.length < 2) {
    throw new PostingError("tom", "En verifikation behöver minst två rader (debet och kredit).");
  }
  const entries: VerificationEntry[] = [];
  for (const line of input) {
    const debit = line.debit ?? 0;
    const credit = line.credit ?? 0;
    if (!Number.isInteger(debit) || !Number.isInteger(credit) || debit < 0 || credit < 0) {
      throw new PostingError("ogiltigt_belopp", `Ogiltigt belopp på konto ${line.account}. Belopp anges i hela kronor och kan inte vara negativa.`);
    }
    if (debit > 0 && credit > 0) {
      throw new PostingError("ogiltigt_belopp", `Konto ${line.account} har både debet och kredit på samma rad. Dela upp i två rader.`);
    }
    if (debit === 0 && credit === 0) continue; // nollrader ignoreras
    const account = chartAccount(line.account);
    if (!account) {
      throw new PostingError("okant_konto", `Konto ${line.account} finns inte i kontoplanen. Bokföringen hittar inte på konton.`);
    }
    if (account.archived) {
      throw new PostingError(
        "okant_konto",
        `Konto ${line.account} ${account.name} är arkiverat och tar inte emot nya konteringar. Välj ett aktivt konto.`
      );
    }
    entries.push({
      account: line.account,
      accountName: account.name,
      debit,
      credit,
      vatCode: line.vatCode,
      note: line.note,
    });
  }
  const sumDebit = entries.reduce((s, e) => s + e.debit, 0);
  const sumCredit = entries.reduce((s, e) => s + e.credit, 0);
  if (entries.length < 2 || sumDebit === 0) {
    throw new PostingError("tom", "En verifikation behöver minst två rader med belopp.");
  }
  if (sumDebit !== sumCredit) {
    throw new PostingError(
      "obalanserad",
      `Verifikationen balanserar inte: debet ${sumDebit} kr, kredit ${sumCredit} kr. Inget har bokförts.`
    );
  }
  return entries;
}

export function isBalanced(entries: { debit: number; credit: number }[]): boolean {
  return entries.reduce((s, e) => s + e.debit - e.credit, 0) === 0 && entries.some((e) => e.debit > 0);
}

/** Atomär nummertilldelning för serie A – en enda synkron inkrementering, aldrig från klienten. */
function allocateVerificationNumber(): number {
  const data = db();
  const number = data.sequences.verification;
  data.sequences.verification = number + 1;
  return number;
}

export interface PostOptions {
  /**
   * Endast för deterministiska systemposter (bokslut, avskrivning, periodisering,
   * momsomföring) som per definition bokförs på fasta periodslutdatum även när
   * perioden är låst. Exponeras aldrig mot UI-formulär eller AI-verktyg.
   * Stängda räkenskapsår är alltid spärrade, även med denna flagga.
   */
  bypassPeriodLock?: boolean;
}

/**
 * Bokför en verifikation. Detta är enda vägen in i bokföringen.
 * Kastar PostingError om något är fel – då sparas ingenting.
 */
export function postVerification(input: PostVerificationInput, opts?: PostOptions): Verification {
  const entries = validateEntries(input.entries);
  const date = bokforingsdatum(input.date.length > 10 ? input.date : `${input.date}T12:00:00`);

  const existingFy = db().fiscalYears.find((f) => f.startDate <= date && date <= f.endDate);
  if (existingFy?.status === "stangt") {
    throw new PostingError(
      "rakenskapsar_stangt",
      `Räkenskapsåret ${existingFy.label} är stängt. Rättelser bokförs i öppet räkenskapsår.`
    );
  }
  if (!opts?.bypassPeriodLock && isDateLocked(date)) {
    const lock = lockedThrough();
    throw new PostingError(
      "period_last",
      `Bokföringen är låst till och med ${lock}. Händelsen kan inte bokföras på ${date} – välj ett datum i öppen period.`
    );
  }

  const fy = ensureFiscalYearFor(date, input.createdBy === "auto" ? "system" : input.createdBy);
  const now = new Date().toISOString();
  const verification: Verification = {
    id: uid(),
    series: "A",
    number: allocateVerificationNumber(),
    date: input.date.length > 10 ? input.date : `${input.date}T12:00:00.000Z`,
    description: input.description,
    entries,
    source: input.source,
    confidence: input.confidence ?? "hog",
    createdBy: input.createdBy,
    status: "bokford",
    postedAt: now,
    fiscalYearId: fy.id,
    explanation: input.explanation,
    correctsVerificationId: input.correctsVerificationId,
    createdAt: now,
  };
  db().verifications.push(verification);
  logAudit(
    input.createdBy === "auto" ? "system" : input.createdBy,
    "verifikation_bokford",
    `${verificationLabel(verification)} bokfördes: ${input.description}.`,
    { targetType: "verifikation", targetId: verification.id }
  );
  return verification;
}

/** "A123" – etikett för en verifikation. */
export function verificationLabel(v: Pick<Verification, "series" | "number">): string {
  return `${v.series}${v.number}`;
}

export function getVerification(id: string): Verification | undefined {
  return db().verifications.find((v) => v.id === id);
}

export interface CorrectionInput {
  verificationId: string;
  reason: string;
  /** Ny, korrekt bokning (valfri). Utan denna skapas bara återföringen. */
  replacementEntries?: PostLineInput[];
  replacementDescription?: string;
  by: Verification["createdBy"];
}

export interface CorrectionResult {
  reversal: Verification;
  replacement?: Verification;
}

/** Första öppna bokföringsdag: idag, eller dagen efter periodlåset om idag är låst. */
function firstOpenPostingDate(): string {
  const now = new Date().toISOString();
  const lock = lockedThrough();
  if (!lock || bokforingsdatum(now) > lock) return now;
  const d = new Date(`${lock}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/**
 * Rättelseverifikation: originalet lämnas orört, en omvänd verifikation
 * bokförs (i öppen period), och eventuellt en ny korrekt bokning.
 * Historiken skrivs aldrig om. Är dagens datum låst bokförs rättelsen på
 * första öppna dag – sena rättelser landar alltid i öppen period.
 */
export function createCorrection(input: CorrectionInput): CorrectionResult {
  const original = getVerification(input.verificationId);
  if (!original) throw new PostingError("tom", "Verifikationen finns inte.");
  if (original.correctedByVerificationId) {
    throw new PostingError("redan_rattad", `${verificationLabel(original)} är redan rättad.`);
  }

  const today = firstOpenPostingDate();
  const reversedEntries: PostLineInput[] = original.entries.map((e) => ({
    account: e.account,
    debit: e.credit,
    credit: e.debit,
    vatCode: e.vatCode,
  }));

  const reversal = postVerification({
    date: today,
    description: `Rättelse av ${verificationLabel(original)}: ${input.reason}`,
    entries: reversedEntries,
    source: { type: "rattelse", id: original.id },
    confidence: "hog",
    createdBy: input.by,
    explanation: `Återför ${verificationLabel(original)} (${original.description}). Originalet står kvar – bokföring skrivs aldrig om.`,
    correctsVerificationId: original.id,
  });
  original.correctedByVerificationId = reversal.id;

  let replacement: Verification | undefined;
  if (input.replacementEntries) {
    replacement = postVerification({
      date: today,
      description: input.replacementDescription ?? `Omföring efter rättelse av ${verificationLabel(original)}`,
      entries: input.replacementEntries,
      source: { type: "rattelse", id: original.id },
      confidence: "hog",
      createdBy: input.by,
      explanation: `Ny, korrekt bokning efter rättelsen av ${verificationLabel(original)}.`,
    });
  }

  logAudit(input.by === "auto" ? "system" : input.by, "verifikation_rattad", `${verificationLabel(original)} rättades: ${input.reason}`, {
    targetType: "verifikation",
    targetId: original.id,
  });
  save();
  return { reversal, replacement };
}
