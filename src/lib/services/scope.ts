/**
 * Produktomfattning per bolag (spec §10): ägarens svar på onboardingens
 * frågor och konsultens godkännanden av konsultfall. Körs i tenantkontext
 * (withBusiness). Behörigheten avgörs av capability-modellen: bara
 * `approve_scope` (redovisningskonsult) får godkänna eller återkalla.
 */

import { db, save } from "../store";
import { logAudit } from "../accounting/audit";
import { currentActor } from "../collaboration/actor";
import { can } from "../collaboration/permissions";
import type { BusinessScope, ScopeApproval, ScopeFlag } from "../types";
import { SUPPORT_MATRIX_VERSION, supportEntry, type SupportEntryId } from "../support/matrix";
import { businessEligibility, newBusinessScope, parseScopeFlags } from "../support/eligibility";

const NOTE_MAX = 500;

function ensureScope(): BusinessScope {
  const s = db().settings;
  if (!s.scope) s.scope = newBusinessScope([]);
  return s.scope;
}

/** Ägarens svar (onboarding eller Inställningar → Företag). Godkännanden rörs inte. */
export function updateScopeFlags(rawFlags: readonly unknown[]): BusinessScope {
  const flags = parseScopeFlags(rawFlags);
  const scope = ensureScope();
  const before = scope.flags.join(",");
  scope.flags = flags;
  scope.matrixVersion = SUPPORT_MATRIX_VERSION;
  scope.assessedAt = new Date().toISOString();
  if (before !== flags.join(",")) {
    const verdict = businessEligibility(db().settings).verdict;
    logAudit(
      "anvandare",
      "omfattning_andrad",
      `Svaren om produktomfattning ändrades (${flags.length ? flags.join(", ") : "inget markerat"}). Bedömning: ${verdict}.`,
      { targetType: "omfattning" },
    );
  }
  save();
  return scope;
}

function requireApprover(): { userId: string; name: string; email: string } {
  const actor = currentActor();
  if (!actor || !can(actor.role, "approve_scope")) {
    throw new Error("Bara en redovisningskonsult med tillgång till bolaget kan godkänna konsultfall.");
  }
  return { userId: actor.userId, name: actor.name, email: actor.email };
}

/**
 * Konsulten godkänner att bolaget använder ett konsultfall. Idempotent: ett
 * befintligt godkännande ersätts av det nya (nytt datum, ny version, ny not).
 * Poster som inte är konsultfall kan varken behöva eller få godkännande.
 */
export function approveScopeEntry(entryId: SupportEntryId, note?: string): ScopeApproval {
  const entry = supportEntry(entryId);
  if (entry.level !== "consultant") {
    throw new Error(
      entry.level === "supported"
        ? `${entry.label} stöds redan och behöver inget godkännande.`
        : `${entry.label} stöds inte i Ferva och kan inte godkännas av konsult.`,
    );
  }
  const approvedBy = requireApprover();
  const trimmedNote = note?.trim().slice(0, NOTE_MAX);
  const approval: ScopeApproval = {
    entryId,
    approvedAt: new Date().toISOString(),
    approvedBy,
    matrixVersion: SUPPORT_MATRIX_VERSION,
    ...(trimmedNote ? { note: trimmedNote } : {}),
  };
  const scope = ensureScope();
  scope.approvals = [...scope.approvals.filter((a) => a.entryId !== entryId), approval];
  logAudit(
    "anvandare",
    "omfattning_godkand",
    `${approvedBy.name || approvedBy.email} godkände konsultfallet "${entry.label}" (matris ${SUPPORT_MATRIX_VERSION}).${trimmedNote ? ` Not: ${trimmedNote}` : ""}`,
    { targetType: "omfattning", targetId: entryId },
  );
  save();
  return approval;
}

export function revokeScopeApproval(entryId: SupportEntryId): void {
  const entry = supportEntry(entryId);
  const by = requireApprover();
  const scope = ensureScope();
  const had = scope.approvals.some((a) => a.entryId === entryId);
  if (!had) return;
  scope.approvals = scope.approvals.filter((a) => a.entryId !== entryId);
  logAudit(
    "anvandare",
    "omfattning_aterkallad",
    `${by.name || by.email} återkallade godkännandet av konsultfallet "${entry.label}". Nya fakturor/åtgärder i fallet spärras igen.`,
    { targetType: "omfattning", targetId: entryId },
  );
  save();
}

export function scopeFlagsOf(): ScopeFlag[] {
  return db().settings.scope?.flags ?? [];
}
