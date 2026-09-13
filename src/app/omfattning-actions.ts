"use server";

/**
 * Serveråtgärder för produktomfattningen (spec §10).
 *
 *   updateScopeFlagsAction      ägaren ändrar sina svar (Inställningar → Företag)
 *   approveScopeEntryAction     konsulten godkänner ett konsultfall i klientens bolag
 *   revokeScopeApprovalAction   konsulten återkallar godkännandet
 *
 * Godkännanden kräver capability `approve_scope`, som bara redovisnings-
 * konsulten har. Ägaren kan alltså inte godkänna åt sig själv, och en revisor
 * kan inte godkänna alls. Servern läser rollen – klienten skickar aldrig den.
 */
import { revalidatePath } from "next/cache";
import { withBusiness } from "@/lib/auth/session";
import { approveScopeEntry, revokeScopeApproval, updateScopeFlags } from "@/lib/services/scope";
import { isSupportEntryId } from "@/lib/support/matrix";
import { userFacingStorageError } from "@/lib/storage/sql-errors";

type Result = { ok: true } | { ok: false; error: string };

export async function updateScopeFlagsAction(flags: unknown): Promise<Result> {
  try {
    const raw = Array.isArray(flags) ? flags : [];
    await withBusiness(() => {
      updateScopeFlags(raw);
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: userFacingStorageError(e, "Svaren kunde inte sparas.") };
  }
}

export async function approveScopeEntryAction(input: { businessId: string; entryId: string; note?: string }): Promise<Result> {
  if (!isSupportEntryId(input?.entryId)) return { ok: false, error: "Okänd post i supportmatrisen." };
  const entryId = input.entryId;
  const note = typeof input.note === "string" ? input.note : undefined;
  try {
    await withBusiness(
      () => {
        approveScopeEntry(entryId, note);
      },
      { capability: "approve_scope", businessId: input.businessId },
    );
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: userFacingStorageError(e, "Godkännandet kunde inte sparas.") };
  }
}

export async function revokeScopeApprovalAction(input: { businessId: string; entryId: string }): Promise<Result> {
  if (!isSupportEntryId(input?.entryId)) return { ok: false, error: "Okänd post i supportmatrisen." };
  const entryId = input.entryId;
  try {
    await withBusiness(
      () => {
        revokeScopeApproval(entryId);
      },
      { capability: "approve_scope", businessId: input.businessId },
    );
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: userFacingStorageError(e, "Godkännandet kunde inte återkallas.") };
  }
}
