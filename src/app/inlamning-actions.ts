"use server";

import { revalidatePath } from "next/cache";
import { withBusiness } from "@/lib/auth/session";
import { requireUser } from "@/lib/auth/session";
import { userFacingFilingError } from "@/lib/filing/errors";
import {
  fetchFilingReceipt,
  generateFilingSubmission,
  signFilingSubmission,
  submitFilingSubmission,
} from "@/lib/filing/submission";
import type { FilingKind, FilingSubmission } from "@/lib/types";

/**
 * Serveråtgärder för inlämningen. Tunna omslag runt src/lib/filing – ingen
 * statuslogik här.
 *
 * Behörigheten är delad på samma sätt som leverantörsbetalningarna:
 * `prepare_filing` räcker för att generera filen (konsulten upprättar
 * deklarationen), medan signering och inlämning kräver `submit_filing` och
 * därmed ägarytan. Att skriva under en deklaration är bolagets egen handling.
 */

function refresh() {
  revalidatePath("/", "layout");
}

type Result = { ok: true; submission: FilingSubmission } | { ok: false; error: string };

const KINDS: readonly FilingKind[] = ["moms", "agi", "ink2", "arsredovisning"];

function isFilingKind(value: string): value is FilingKind {
  return (KINDS as readonly string[]).includes(value);
}

/**
 * businessId skickas av konsultytan, som arbetar i en klients böcker: utan det
 * avgör cookien vems deklaration som byggs. withBusiness kontrollerar
 * medlemskapet innan något händer.
 */
async function run(
  fn: () => Promise<FilingSubmission> | FilingSubmission,
  capability: "prepare_filing" | "submit_filing",
  businessId?: string
): Promise<Result> {
  try {
    const submission = await withBusiness(async () => await fn(), { capability, businessId });
    refresh();
    return { ok: true, submission };
  } catch (e) {
    refresh();
    return { ok: false, error: userFacingFilingError(e) };
  }
}

export async function generateFilingAction(kind: string, subjectId: string, businessId?: string): Promise<Result> {
  if (!isFilingKind(kind)) return { ok: false, error: `Okänd deklarationstyp: ${kind}` };
  return run(() => generateFilingSubmission({ kind, subjectId, by: "anvandare" }), "prepare_filing", businessId);
}

export async function signFilingAction(submissionId: string, businessId?: string): Promise<Result> {
  const user = await requireUser();
  const signedByName = user.name?.trim() || user.email;
  return run(
    () => signFilingSubmission(submissionId, { signedByName, by: "anvandare" }),
    "submit_filing",
    businessId
  );
}

export async function submitFilingAction(submissionId: string, businessId?: string): Promise<Result> {
  return run(() => submitFilingSubmission(submissionId, { by: "anvandare" }), "submit_filing", businessId);
}

export async function fetchFilingReceiptAction(submissionId: string, businessId?: string): Promise<Result> {
  return run(() => fetchFilingReceipt(submissionId, { by: "anvandare" }), "submit_filing", businessId);
}
