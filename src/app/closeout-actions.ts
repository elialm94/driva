"use server";

/**
 * Avslut, ändringar och kundvy – server actions.
 *
 * Ägarens anrop går via withBusiness (tenantkontext + roll). Kundens anrop
 * från de publika sidorna (/andring/[token], /uppdrag-kund/[token]) går via
 * withPublicBusiness och identifieras enbart av token – aldrig av id eller
 * inloggning. Inget skickas externt härifrån; länkar delas av företagaren.
 */
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { withBusiness, withBusinessRead, withPublicBusiness } from "@/lib/auth/session";
import { clientIpFrom } from "@/lib/auth/demo-session";
import type { BillingDeferral, CloseoutBillingMode, DocLine } from "@/lib/types";
import { invoiceTotals } from "@/lib/services/data";
import {
  CloseoutError,
  clearBillingDeferral,
  closeoutView,
  completeJobCloseout,
  createCloseoutInvoiceDraft,
  parseCloseoutKey,
  reopenJobCloseout,
  setBillingDeferral,
  type CloseoutView,
} from "@/lib/services/closeout";
import {
  JOB_CHANGE_TEXT,
  JobChangeError,
  approveJobChange,
  createJobChange,
  createJobChangeVersion,
  declineJobChange,
  deleteJobChange,
  getJobChange,
  jobChangeTotals,
  sendJobChange,
  updateJobChange,
  type JobChangeErrorCode,
  type JobChangeInput,
} from "@/lib/services/job-changes";

function refresh() {
  revalidatePath("/", "layout");
}

export type JobChangeActionResult = { ok: true; changeId: string } | { ok: false; error: string };

function failure(e: unknown, fallback: string): { ok: false; error: string } {
  if (e instanceof JobChangeError) return { ok: false, error: e.message };
  return { ok: false, error: e instanceof Error && e.message ? e.message : fallback };
}

/* ----------------------------------- Ägaren ---------------------------------- */

export async function createJobChangeAction(jobId: string, input: JobChangeInput): Promise<JobChangeActionResult> {
  return withBusiness(() => {
    try {
      const change = createJobChange(jobId, { ...input, createdBy: "anvandare" });
      refresh();
      return { ok: true, changeId: change.id } as const;
    } catch (e) {
      return failure(e, "Ändringen kunde inte sparas.");
    }
  });
}

export async function updateJobChangeAction(
  changeId: string,
  input: Partial<JobChangeInput>
): Promise<JobChangeActionResult> {
  return withBusiness(() => {
    try {
      const change = updateJobChange(changeId, input);
      refresh();
      return { ok: true, changeId: change.id } as const;
    } catch (e) {
      return failure(e, "Ändringen kunde inte sparas.");
    }
  });
}

/** Spara utkastet och skicka (lås) i ett steg – det som "Skicka till kunden" gör. */
export async function saveAndSendJobChangeAction(
  changeId: string,
  input: Partial<JobChangeInput>
): Promise<JobChangeActionResult> {
  return withBusiness(() => {
    try {
      const change = getJobChange(changeId);
      if (!change) return { ok: false, error: JOB_CHANGE_TEXT.not_found } as const;
      if (change.status === "utkast") updateJobChange(changeId, input);
      sendJobChange(changeId);
      refresh();
      return { ok: true, changeId } as const;
    } catch (e) {
      return failure(e, "Ändringen kunde inte skickas.");
    }
  });
}

export async function sendJobChangeAction(changeId: string): Promise<JobChangeActionResult> {
  return withBusiness(() => {
    try {
      sendJobChange(changeId);
      refresh();
      return { ok: true, changeId } as const;
    } catch (e) {
      return failure(e, "Ändringen kunde inte skickas.");
    }
  });
}

export async function createJobChangeVersionAction(changeId: string): Promise<JobChangeActionResult> {
  return withBusiness(() => {
    try {
      const draft = createJobChangeVersion(changeId);
      refresh();
      return { ok: true, changeId: draft.id } as const;
    } catch (e) {
      return failure(e, "Ny version kunde inte skapas.");
    }
  });
}

export async function deleteJobChangeAction(changeId: string): Promise<JobChangeActionResult> {
  return withBusiness(() => {
    try {
      deleteJobChange(changeId);
      refresh();
      return { ok: true, changeId } as const;
    } catch (e) {
      return failure(e, "Utkastet kunde inte tas bort.");
    }
  });
}

/* ----------------------------------- Kunden ---------------------------------- */

export type ApproveJobChangeActionResult =
  | { ok: true; approvedByName: string; approvedAt: string; amount: number; alreadyApproved: boolean }
  | { ok: false; error: string; code: JobChangeErrorCode | "unknown" };

export async function approveJobChangeByTokenAction(
  token: string,
  name: string,
  expectedContentHash: string
): Promise<ApproveJobChangeActionResult> {
  const h = await headers();
  const ip = clientIpFrom(h);
  const userAgent = h.get("user-agent") ?? undefined;
  const safeToken = typeof token === "string" ? token : "";
  const result = await withPublicBusiness(
    "job_change",
    safeToken,
    (): ApproveJobChangeActionResult => {
      try {
        const r = approveJobChange({
          token: safeToken,
          name,
          expectedContentHash: typeof expectedContentHash === "string" ? expectedContentHash : undefined,
          ip: ip || undefined,
          userAgent,
        });
        refresh();
        return {
          ok: true,
          approvedByName: r.approval.approvedByName,
          approvedAt: r.approval.approvedAt,
          amount: jobChangeTotals(r.change).toPay,
          alreadyApproved: r.outcome === "already_approved",
        };
      } catch (e) {
        if (e instanceof JobChangeError) return { ok: false, error: e.message, code: e.code };
        return { ok: false, error: "Godkännandet kunde inte sparas. Försök igen.", code: "unknown" };
      }
    },
    { retry: false }
  );
  if (!result) return { ok: false, error: JOB_CHANGE_TEXT.not_found, code: "not_found" };
  return result;
}

export async function declineJobChangeByTokenAction(token: string, reason?: string): Promise<void> {
  const safeToken = typeof token === "string" ? token : "";
  await withPublicBusiness(
    "job_change",
    safeToken,
    () => {
      declineJobChange(safeToken, typeof reason === "string" ? reason.slice(0, 2000) : undefined);
      refresh();
    },
    { retry: false }
  );
}

/** Typexport så klientkomponenter kan skicka rader utan att importera tjänsten. */
export type JobChangeLineInput = DocLine;

/* --------------------------------- Avsluta uppdrag ---------------------------- */

export type CloseoutActionResult = { ok: true } | { ok: false; error: string };
export type CloseoutDraftActionResult = { ok: true; invoiceId: string; amount: number } | { ok: false; error: string };

function closeoutFailure(e: unknown, fallback: string): { ok: false; error: string } {
  if (e instanceof CloseoutError) return { ok: false, error: e.message };
  return { ok: false, error: e instanceof Error && e.message ? e.message : fallback };
}

export async function closeoutViewAction(jobId: string): Promise<CloseoutView | null> {
  return withBusinessRead(() => {
    try {
      return closeoutView(jobId);
    } catch {
      return null;
    }
  });
}

export async function setBillingDeferralAction(
  jobId: string,
  key: string,
  kind: BillingDeferral["kind"],
  note?: string
): Promise<CloseoutActionResult> {
  return withBusiness(() => {
    const ref = parseCloseoutKey(key);
    if (!ref) return { ok: false, error: "Posten kunde inte tolkas." } as const;
    try {
      setBillingDeferral(jobId, ref, kind, note);
      refresh();
      return { ok: true } as const;
    } catch (e) {
      return closeoutFailure(e, "Beslutet kunde inte sparas.");
    }
  });
}

export async function clearBillingDeferralAction(jobId: string, key: string): Promise<CloseoutActionResult> {
  return withBusiness(() => {
    const ref = parseCloseoutKey(key);
    if (!ref) return { ok: false, error: "Posten kunde inte tolkas." } as const;
    try {
      clearBillingDeferral(jobId, ref);
      refresh();
      return { ok: true } as const;
    } catch (e) {
      return closeoutFailure(e, "Beslutet kunde inte ändras.");
    }
  });
}

/** Skapar fakturautkastet – aldrig ett utskick. Idempotent på serversidan. */
export async function createCloseoutDraftAction(
  jobId: string,
  mode: CloseoutBillingMode,
  includeKeys?: string[]
): Promise<CloseoutDraftActionResult> {
  return withBusiness(
    () => {
      try {
        const invoice = createCloseoutInvoiceDraft(jobId, {
          mode,
          ...(Array.isArray(includeKeys) ? { includeKeys: includeKeys.filter((k) => typeof k === "string") } : {}),
        });
        refresh();
        return { ok: true, invoiceId: invoice.id, amount: invoiceTotals(invoice).toPay } as const;
      } catch (e) {
        return closeoutFailure(e, "Fakturautkastet kunde inte skapas.");
      }
    },
    { retry: false }
  );
}

export async function completeJobCloseoutAction(
  jobId: string,
  mode: CloseoutBillingMode,
  invoiceId?: string
): Promise<CloseoutActionResult> {
  return withBusiness(() => {
    try {
      completeJobCloseout(jobId, { mode, ...(invoiceId ? { invoiceId } : {}) });
      refresh();
      return { ok: true } as const;
    } catch (e) {
      return closeoutFailure(e, "Uppdraget kunde inte avslutas.");
    }
  });
}

export async function reopenJobCloseoutAction(jobId: string): Promise<CloseoutActionResult> {
  return withBusiness(() => {
    try {
      reopenJobCloseout(jobId);
      refresh();
      return { ok: true } as const;
    } catch (e) {
      return closeoutFailure(e, "Uppdraget kunde inte öppnas igen.");
    }
  });
}
