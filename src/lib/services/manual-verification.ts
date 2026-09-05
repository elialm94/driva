import { db, save } from "../store";
import { uid } from "../ids";
import { chartAccounts } from "../accounting/chart";
import { postVerification, verificationLabel, type PostLineInput } from "../accounting/engine";
import { MANUAL_SERIES } from "../accounting/series";
import { todayDate } from "../accounting/dates";
import type { Verification, VerificationAttachment } from "../types";
import { logActivity } from "./activity";
import { kr } from "../format";

/**
 * Manuellt verifikat: fri debet/kredit-kontering som ägaren eller
 * redovisningskonsulten skriver själv. Allt går genom `postVerification`, så
 * balanskrav, kontokontroll, periodlås, nummertilldelning och oföränderlighet
 * är exakt desamma som för automatiken. Skillnaden är serien (M) och att
 * underlaget kommer utifrån och därför läggs som bilaga på verifikationen.
 */

export interface ManualVerificationLine {
  account: number;
  debit?: number;
  credit?: number;
  note?: string;
}

export interface ManualVerificationInput {
  /** Bokföringsdatum (YYYY-MM-DD). Utan datum bokförs verifikationen idag. */
  date?: string;
  /** Handelsdatum, när händelsen inträffade ett annat datum än den bokförs. */
  transactionDate?: string;
  description: string;
  lines: ManualVerificationLine[];
  /** Varför verifikationen bokförs – visas som förklaring på verifikationen. */
  explanation?: string;
  /** Redan lagrat underlag, se receipts/verification-attachment.ts. */
  attachment?: VerificationAttachment;
}

export type ManualVerificationActor = "anvandare" | "assistent";

/** Kontoväljarens rader: hela det aktiva kontoregistret, i nummerordning. */
export interface AccountPickerOption {
  account: number;
  name: string;
  label: string;
  section: string;
  custom: boolean;
}

export function accountPickerOptions(): AccountPickerOption[] {
  return chartAccounts().map((a) => ({
    account: a.number,
    name: a.name,
    label: `${a.number} ${a.name}`,
    section: a.section,
    custom: a.custom === true,
  }));
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function requireDate(value: string | undefined, field: string): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const trimmed = value.trim();
  if (!DATE_ONLY.test(trimmed)) throw new Error(`${field} måste anges som ÅÅÅÅ-MM-DD.`);
  const parsed = new Date(`${trimmed}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
    throw new Error(`${field} är inte ett riktigt datum.`);
  }
  return trimmed;
}

/**
 * Bokför ett manuellt verifikat. Kastar med ett läsbart fel om något är fel –
 * då bokförs ingenting. Beloppen anges i hela kronor, precis som i motorn.
 */
export function postManualVerification(
  input: ManualVerificationInput,
  by: ManualVerificationActor = "anvandare"
): Verification {
  const description = input.description.trim();
  if (!description) throw new Error("Verifikationen behöver en beskrivning av vad som hänt.");

  const date = requireDate(input.date, "Bokföringsdatum") ?? todayDate();
  const transactionDate = requireDate(input.transactionDate, "Handelsdatum");

  const lines: PostLineInput[] = [];
  for (const line of input.lines) {
    const debit = Math.round(line.debit ?? 0);
    const credit = Math.round(line.credit ?? 0);
    if (debit === 0 && credit === 0) continue;
    lines.push({
      account: line.account,
      debit,
      credit,
      ...(line.note?.trim() ? { note: line.note.trim() } : {}),
    });
  }
  if (lines.length < 2) {
    throw new Error("Ett verifikat behöver minst två rader: en debet och en kredit.");
  }

  const verification = postVerification({
    date,
    transactionDate,
    description,
    entries: lines,
    source: { type: "manuell" },
    confidence: "hog",
    createdBy: by,
    series: MANUAL_SERIES,
    explanation: input.explanation?.trim() || undefined,
    attachment: input.attachment,
  });

  const total = verification.entries.reduce((s, e) => s + e.debit, 0);
  logActivity(`${verificationLabel(verification)} bokfördes manuellt: ${description} (${kr(total)}).`, {
    createdBy: by,
    entity: { type: "verifikation", id: verification.id },
  });
  save();
  return verification;
}

/**
 * Id att lagra bilagan under innan verifikationen finns. Verifikationens eget
 * id skapas i motorn, så uppladdningen får ett eget id för sökvägen i bucketen.
 */
export function newAttachmentKey(): string {
  return uid();
}

/** Verifikationen bakom en bilagelänk – används av API-routen. */
export function verificationWithAttachment(id: string): Verification | undefined {
  const v = db().verifications.find((x) => x.id === id);
  return v?.attachment ? v : undefined;
}
