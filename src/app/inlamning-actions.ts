"use server";

import { revalidatePath } from "next/cache";
import { withBusiness } from "@/lib/auth/session";
import { requireUser } from "@/lib/auth/session";
import { userFacingFilingError } from "@/lib/filing/errors";
import {
  fetchFilingReceipt,
  generateFilingSubmission,
  markFilingDownloaded,
  openFilingSubmission,
  reportManualFilingSubmission,
  signFilingSubmission,
  submitFilingSubmission,
} from "@/lib/filing/submission";
import { filingReceiptFromForm, storeFilingReceiptFile } from "@/lib/filing/receipt-file";
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

/* --------------------------- Manuell inlämning ----------------------------- */

/**
 * Filen hämtas för att lämnas in för hand. Konsulten får förbereda
 * (prepare_filing): raden låser kontrollsumman för det som hämtades.
 */
export async function markFilingDownloadedAction(kind: string, subjectId: string, businessId?: string): Promise<Result> {
  if (!isFilingKind(kind)) return { ok: false, error: `Okänd deklarationstyp: ${kind}` };
  return run(() => markFilingDownloaded({ kind, subjectId, by: "anvandare" }), "prepare_filing", businessId);
}

/**
 * "Jag har lämnat in" – kräver submit_filing (ägarens handling). Formuläret
 * bär kind, subjectId, reference, note, ev. businessId och kvittensfilen som
 * File i fältet "kvittens". Filen sparas inne i tenantkontexten innan raden
 * skrivs; misslyckas lagringen rapporteras ingen inlämning.
 */
export async function reportManualFilingAction(form: FormData): Promise<Result> {
  const kind = String(form.get("kind") ?? "");
  const subjectId = String(form.get("subjectId") ?? "").trim();
  const reference = String(form.get("reference") ?? "").trim();
  const note = String(form.get("note") ?? "").trim();
  const businessId = String(form.get("businessId") ?? "").trim() || undefined;
  if (!isFilingKind(kind)) return { ok: false, error: `Okänd deklarationstyp: ${kind}` };
  if (!subjectId) return { ok: false, error: "Ärendet saknas." };

  const user = await requireUser();
  const reportedByName = user.name?.trim() || user.email;
  let upload: Awaited<ReturnType<typeof filingReceiptFromForm>>;
  try {
    upload = await filingReceiptFromForm(form);
  } catch {
    return { ok: false, error: "Kvittensfilen kunde inte läsas. Välj filen igen." };
  }
  if (!reference && !upload) {
    return { ok: false, error: "Ange myndighetens referens- eller kvittensnummer, eller ladda upp kvittensen." };
  }

  return run(
    async () => {
      // Se till att raden finns innan filen lagras under dess id.
      const open = openFilingSubmission(kind, subjectId) ?? generateFilingSubmission({ kind, subjectId, by: "anvandare" });
      const file = upload ? await storeFilingReceiptFile(open.id, upload) : undefined;
      return reportManualFilingSubmission({
        kind,
        subjectId,
        reference: reference || undefined,
        note: note || undefined,
        file,
        reportedByName,
        reportedByUserId: user.id,
        by: "anvandare",
      });
    },
    "submit_filing",
    businessId
  );
}
