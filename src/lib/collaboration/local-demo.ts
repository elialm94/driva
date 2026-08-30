/**
 * Lokal JSON-demo: en färdig redovisningskonsult (Anna) på demoföretaget
 * så /redovisning går att öppna utan riktig inbjudan.
 *
 * Körs inte i Supabase. Återskapar inte en membership som ägaren redan revokerat.
 */
import { db } from "../store";
import {
  LOCAL_JSON_ACCOUNTANT_EMAIL,
  LOCAL_JSON_ACCOUNTANT_ID,
  LOCAL_JSON_ACCOUNTANT_NAME,
  LOCAL_JSON_BUSINESS_ID,
  LOCAL_JSON_USER_ID,
} from "./actor";
import {
  membershipFor,
  putMembership,
  upsertUser,
} from "./registry";

export function localDemoBusinessName(): string {
  try {
    return db().settings.name || "Södermalms Snickeri AB";
  } catch {
    return "Södermalms Snickeri AB";
  }
}

export function ensureLocalDemoCollaboration(businessName = localDemoBusinessName()): {
  ownerId: string;
  accountantId: string;
} {
  const now = new Date().toISOString();
  upsertUser({ id: LOCAL_JSON_USER_ID, email: "demo@driva.local", name: "Du" });
  upsertUser({
    id: LOCAL_JSON_ACCOUNTANT_ID,
    email: LOCAL_JSON_ACCOUNTANT_EMAIL,
    name: LOCAL_JSON_ACCOUNTANT_NAME,
  });

  if (!membershipFor(LOCAL_JSON_USER_ID, LOCAL_JSON_BUSINESS_ID)) {
    putMembership({
      businessId: LOCAL_JSON_BUSINESS_ID,
      businessName,
      userId: LOCAL_JSON_USER_ID,
      role: "owner",
      createdAt: now,
    });
  }

  if (!membershipFor(LOCAL_JSON_ACCOUNTANT_ID, LOCAL_JSON_BUSINESS_ID)) {
    putMembership({
      businessId: LOCAL_JSON_BUSINESS_ID,
      businessName,
      userId: LOCAL_JSON_ACCOUNTANT_ID,
      role: "accounting_consultant",
      invitedByUserId: LOCAL_JSON_USER_ID,
      acceptedAt: now,
      lastActiveAt: now,
      createdAt: now,
    });
  }

  for (const extra of [
    { id: "demo-ckl", name: "CKL Bygg AB" },
    { id: "demo-andersson", name: "Anderssons Måleri" },
  ]) {
    if (!membershipFor(LOCAL_JSON_ACCOUNTANT_ID, extra.id)) {
      putMembership({
        businessId: extra.id,
        businessName: extra.name,
        userId: LOCAL_JSON_ACCOUNTANT_ID,
        role: "accounting_consultant",
        invitedByUserId: LOCAL_JSON_USER_ID,
        acceptedAt: now,
        createdAt: now,
      });
    }
  }

  return { ownerId: LOCAL_JSON_USER_ID, accountantId: LOCAL_JSON_ACCOUNTANT_ID };
}

/**
 * Publika demosessionen (Supabase): visa Anna som kopplad konsult i Samarbeta.
 * Raden finns BARA i det instanslokala registret – Anna är ingen auth-användare
 * och får aldrig SQL-medlemskap eller RLS-åtkomst. Redovisningsytan öppnas i
 * stället som en vy på demo-användarens egen session (demo-aktörskakan).
 * Återskapar inte en rad som besökaren tagit bort på den här instansen.
 */
export function ensureDemoAccountantShown(businessId: string, businessName: string): void {
  const now = new Date().toISOString();
  upsertUser({
    id: LOCAL_JSON_ACCOUNTANT_ID,
    email: LOCAL_JSON_ACCOUNTANT_EMAIL,
    name: LOCAL_JSON_ACCOUNTANT_NAME,
  });
  if (!membershipFor(LOCAL_JSON_ACCOUNTANT_ID, businessId)) {
    putMembership({
      businessId,
      businessName,
      userId: LOCAL_JSON_ACCOUNTANT_ID,
      role: "accounting_consultant",
      acceptedAt: now,
      lastActiveAt: now,
      createdAt: now,
    });
  }
}

/** Återställer Annas demo-åtkomst även om den revokerats (endast explicit demo-knapp). */
export function restoreLocalAccountantDemo(businessName = localDemoBusinessName()): void {
  ensureLocalDemoCollaboration(businessName);
  const existing = membershipFor(LOCAL_JSON_ACCOUNTANT_ID, LOCAL_JSON_BUSINESS_ID);
  if (existing?.revokedAt) {
    putMembership({
      ...existing,
      businessName,
      role: "accounting_consultant",
      revokedAt: undefined,
      acceptedAt: existing.acceptedAt ?? new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    });
  }
}
