/**
 * Servervakter för supportmatrisen (spec §10): "Servern ska blockera ett ej
 * stött val även om UI kringgås." Alla vakter läser matrisen och bolagets
 * scope – ingen egen copy, inga egna regler.
 */

import type { CompanySettings } from "../types";
import { db } from "../store";
import { supportEntry, type SupportEntry, type SupportEntryId } from "./matrix";
import {
  assessEligibility,
  companyFormEntryId,
  entryStatusFor,
  type CompanyFormAnswer,
  type EligibilityInput,
  type EntryStatus,
} from "./eligibility";

export class ScopeBlockedError extends Error {
  readonly entry: SupportEntry;
  readonly status: EntryStatus;
  constructor(entry: SupportEntry, status: EntryStatus, message?: string) {
    super(message ?? scopeBlockedMessage(entry, status));
    this.name = "ScopeBlockedError";
    this.entry = entry;
    this.status = status;
  }
}

export function scopeBlockedMessage(entry: SupportEntry, status: EntryStatus): string {
  if (status === "consultant") {
    return `${entry.label} är ett konsultfall i Ferva: en redovisningskonsult med tillgång till bolaget måste godkänna det innan det kan användas. Bjud in konsulten under Samarbeta.`;
  }
  return `${entry.label} stöds inte i Ferva ännu. ${entry.summary}`;
}

/** Företagsformen är den enda matrisposten som skickas som rå text från formulär. */
export function assertCompanyFormSupported(form: string): asserts form is "ab" | "enskild" {
  const answer: CompanyFormAnswer = form === "ab" || form === "enskild" ? form : "annan";
  const entry = supportEntry(companyFormEntryId(answer));
  if (entry.level === "unsupported") throw new ScopeBlockedError(entry, "unsupported");
}

/**
 * Onboardingens serversida: skapa inte bolaget när bedömningen är
 * "stöds inte". Konsultfall släpps igenom – de spärras per funktion tills
 * konsulten godkänt (assertScopeAllowed).
 */
export function assertEligibleToCreate(input: EligibilityInput): void {
  const e = assessEligibility(input);
  if (e.verdict !== "unsupported") return;
  const first = e.blocking[0];
  throw new ScopeBlockedError(
    first,
    "unsupported",
    e.blocking.length === 1
      ? scopeBlockedMessage(first, "unsupported")
      : `Ferva stöder inte företaget ännu: ${e.blocking.map((b) => b.label.toLocaleLowerCase("sv")).join(", ")}.`,
  );
}

/** Per funktion, i tenantkontext: kastar när posten inte får användas i bolaget. */
export function assertScopeAllowed(entryId: SupportEntryId, settings: Pick<CompanySettings, "scope" | "companyForm"> = db().settings): void {
  const status = entryStatusFor(settings, entryId);
  if (status === "supported" || status === "approved") return;
  throw new ScopeBlockedError(supportEntry(entryId), status);
}

export function isScopeBlockedError(e: unknown): e is ScopeBlockedError {
  return e instanceof ScopeBlockedError || (e instanceof Error && e.name === "ScopeBlockedError");
}
