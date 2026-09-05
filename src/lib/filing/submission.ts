/**
 * Statusmaskinen för en inlämning.
 *
 *   utkast → genererad → signerad → inlamnad → kvitterad
 *                                        └──→ avvisad
 *
 * Varje steg kräver att det förra faktiskt är gjort, och varje steg skriver
 * audit. Skillnaden mot dagens "markera som inlämnad" är att stegen efter
 * signerad inte går att ta själv: "inlamnad" kräver ett id från myndigheten och
 * "kvitterad" en kvittens. Finns ingen leverantör stannar inlämningen på
 * signerad, och filen hämtas och lämnas in för hand.
 *
 * Filerna byggs om vid inlämningen och jämförs mot kontrollsumman som
 * signerades. Har underlaget ändrats efter signeringen släpps signaturen och
 * inlämningen faller tillbaka till genererad – en signatur som gäller en annan
 * fil än den som skickas är ingen signatur.
 */
import { createHash } from "node:crypto";
import type { FilingFileRef, FilingKind, FilingSubmission, FilingSubmissionStatus } from "../types";
import { db, save } from "../store";
import { uid } from "../ids";
import { logAudit } from "../accounting/audit";
import { orgNumber10 } from "../accounting/filing-format";
import { FILING_ERROR_TEXT, FilingError, userFacingFilingError } from "./errors";
import { buildFilingPayload, FILING_KIND_LABEL, type FilingPayload } from "./payload";
import type { FilingProvider } from "./provider";
import { selectFilingProvider } from "./select";
import { selectFilingSigner } from "./signing";

export const FILING_STATUS_LABEL: Record<FilingSubmissionStatus, string> = {
  utkast: "Utkast",
  genererad: "Genererad",
  signerad: "Signerad",
  inlamnad: "Inlämnad",
  kvitterad: "Kvitterad",
  avvisad: "Avvisad",
};

/** Tillåtna övergångar. Allt annat är ett fel i anropet, inte i användarens data. */
const TRANSITIONS: Record<FilingSubmissionStatus, readonly FilingSubmissionStatus[]> = {
  utkast: ["genererad"],
  // Att generera om en genererad inlämning är samma steg igen, inte ett nytt.
  genererad: ["genererad", "signerad"],
  signerad: ["genererad", "inlamnad"],
  inlamnad: ["kvitterad", "avvisad"],
  kvitterad: [],
  avvisad: [],
};

const TERMINAL: readonly FilingSubmissionStatus[] = ["kvitterad", "avvisad"];

export function isTerminalFilingStatus(status: FilingSubmissionStatus): boolean {
  return TERMINAL.includes(status);
}

export function canAdvanceFiling(from: FilingSubmissionStatus, to: FilingSubmissionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

function assertTransition(submission: FilingSubmission, to: FilingSubmissionStatus): void {
  if (canAdvanceFiling(submission.status, to)) return;
  throw new FilingError(
    `Inlämningen är ${FILING_STATUS_LABEL[submission.status].toLowerCase()} och kan inte bli ${FILING_STATUS_LABEL[to].toLowerCase()}.`
  );
}

/* ------------------------------- Lagring ---------------------------------- */

export function filingSubmissions(): FilingSubmission[] {
  const data = db();
  data.filingSubmissions ??= [];
  return data.filingSubmissions;
}

export function filingSubmissionById(id: string): FilingSubmission | undefined {
  return filingSubmissions().find((s) => s.id === id);
}

/** Alla inlämningar för samma period, äldst först. Rättelser blir egna rader. */
export function filingSubmissionsFor(kind: FilingKind, subjectId: string): FilingSubmission[] {
  return filingSubmissions().filter((s) => s.kind === kind && s.subjectId === subjectId);
}

/** Den inlämning som gäller nu: den senaste raden för perioden. */
export function latestFilingSubmission(kind: FilingKind, subjectId: string): FilingSubmission | undefined {
  const list = filingSubmissionsFor(kind, subjectId);
  return list[list.length - 1];
}

/** Den inlämning som fortfarande är i arbete, om någon. */
export function openFilingSubmission(kind: FilingKind, subjectId: string): FilingSubmission | undefined {
  const latest = latestFilingSubmission(kind, subjectId);
  return latest && !isTerminalFilingStatus(latest.status) ? latest : undefined;
}

function touch(submission: FilingSubmission): void {
  submission.updatedAt = new Date().toISOString();
  for (const key of Object.keys(submission) as (keyof FilingSubmission)[]) {
    if (submission[key] === undefined) delete submission[key];
  }
  save();
}

/* ------------------------------ Generering -------------------------------- */

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fileRefs(payload: FilingPayload): FilingFileRef[] {
  return payload.files.map((f) => ({
    filename: f.filename,
    contentType: f.contentType,
    size: f.bytes.length,
    sha256: sha256Hex(f.bytes),
  }));
}

function sameFiles(a: FilingFileRef[], b: FilingFileRef[]): boolean {
  return a.length === b.length && a.every((f, i) => f.sha256 === b[i].sha256 && f.filename === b[i].filename);
}

export interface GenerateFilingInput {
  kind: FilingKind;
  subjectId: string;
  by: "anvandare" | "assistent";
}

/**
 * Bygg filerna och ta inlämningen till genererad.
 *
 * Finns en inlämning i arbete för samma period används den raden – ett nytt
 * försök på samma deklaration ska inte bli två inlämningar. Är den senaste
 * raden kvitterad eller avvisad skapas en ny rad, för då är det här en
 * rättelse eller ett nytt försök och båda ska synas i historiken.
 */
export function generateFilingSubmission(input: GenerateFilingInput): FilingSubmission {
  const payload = buildFilingPayload(input.kind, input.subjectId);
  const files = fileRefs(payload);
  const now = new Date().toISOString();
  const provider = selectFilingProvider();

  let submission = openFilingSubmission(input.kind, input.subjectId);
  if (!submission) {
    submission = {
      id: `inlamning-${uid()}`,
      kind: input.kind,
      subjectId: input.subjectId,
      label: payload.label,
      authority: payload.authority,
      provider: provider.name,
      status: "utkast",
      files: [],
      createdBy: input.by,
      createdAt: now,
      updatedAt: now,
    };
    filingSubmissions().push(submission);
  }
  assertTransition(submission, "genererad");

  // En signerad inlämning som genereras om tappar signaturen bara när filerna
  // faktiskt ändrats. Samma fil igen är samma handling.
  const unchanged = submission.status === "signerad" && sameFiles(submission.files, files);
  submission.label = payload.label;
  submission.authority = payload.authority;
  submission.provider = provider.name;
  submission.files = files;
  submission.generatedAt = now;
  submission.lastError = undefined;
  if (!unchanged) {
    submission.status = "genererad";
    submission.signature = undefined;
  }
  touch(submission);

  logAudit(
    input.by,
    "inlamning_genererad",
    `${FILING_KIND_LABEL[input.kind]} för ${payload.label} genererades som ${files.map((f) => f.filename).join(" + ")}.`,
    { targetType: "inlamning", targetId: submission.id }
  );
  return submission;
}

/* ------------------------------- Signering -------------------------------- */

export function signFilingSubmission(id: string, input: { signedByName: string; by: "anvandare" }): FilingSubmission {
  const submission = requireSubmission(id);
  assertTransition(submission, "signerad");
  const signature = selectFilingSigner().sign({ submission, signedByName: input.signedByName });
  submission.signature = signature;
  submission.status = "signerad";
  submission.lastError = undefined;
  touch(submission);
  logAudit(
    input.by,
    "inlamning_signerad",
    `${FILING_KIND_LABEL[submission.kind]} för ${submission.label} signerades av ${signature.signedByName}` +
      `${signature.method === "bankid_mock" ? " (demosignatur)" : ""}.`,
    { targetType: "inlamning", targetId: submission.id }
  );
  return submission;
}

/* ------------------------------- Inlämning -------------------------------- */

/**
 * Lämna in filerna. Filerna byggs om och jämförs mot det som signerades: har
 * underlaget ändrats faller inlämningen tillbaka till genererad och får signeras
 * på nytt.
 */
export async function submitFilingSubmission(
  id: string,
  input: { by: "anvandare"; provider?: FilingProvider }
): Promise<FilingSubmission> {
  const submission = requireSubmission(id);
  if (submission.status === "inlamnad" || submission.status === "kvitterad") {
    throw new FilingError(FILING_ERROR_TEXT.alreadySubmitted);
  }
  if (submission.status !== "signerad" || !submission.signature) {
    throw new FilingError(FILING_ERROR_TEXT.notSigned);
  }

  const payload = buildFilingPayload(submission.kind, submission.subjectId);
  const files = fileRefs(payload);
  if (!sameFiles(submission.files, files)) {
    submission.files = files;
    submission.status = "genererad";
    submission.signature = undefined;
    submission.generatedAt = new Date().toISOString();
    touch(submission);
    throw new FilingError(
      "Underlaget har ändrats sedan signeringen, så filen är genererad om. Läs igenom den och signera på nytt."
    );
  }

  const provider = input.provider ?? selectFilingProvider();
  const signature = submission.signature;
  let outcome;
  try {
    outcome = await provider.submit({
      kind: submission.kind,
      authority: submission.authority,
      label: submission.label,
      orgNumber: orgNumber10(db().settings.orgNumber),
      files: payload.files,
      signature,
      idempotencyKey: submission.id,
    });
  } catch (e) {
    submission.lastError = userFacingFilingError(e);
    touch(submission);
    throw e;
  }

  const now = new Date().toISOString();
  submission.provider = provider.name;
  if (outcome.kind === "rejected") {
    submission.status = "avvisad";
    submission.rejection = { reason: outcome.reason, at: now };
    submission.lastError = undefined;
    touch(submission);
    logAudit(
      input.by,
      "inlamning_avvisad",
      `${FILING_KIND_LABEL[submission.kind]} för ${submission.label} avvisades: ${outcome.reason}`,
      { targetType: "inlamning", targetId: submission.id }
    );
    return submission;
  }

  submission.status = "inlamnad";
  submission.submittedAt = now;
  submission.providerSubmissionId = outcome.providerSubmissionId;
  submission.lastError = undefined;
  touch(submission);
  logAudit(
    input.by,
    "inlamning_inlamnad",
    `${FILING_KIND_LABEL[submission.kind]} för ${submission.label} lämnades in till ` +
      `${submission.authority === "skatteverket" ? "Skatteverket" : "Bolagsverket"} (id ${outcome.providerSubmissionId}).`,
    { targetType: "inlamning", targetId: submission.id }
  );

  if (outcome.receipt) recordReceipt(submission, outcome.receipt, input.by);
  return submission;
}

/* -------------------------------- Kvittens -------------------------------- */

function recordReceipt(
  submission: FilingSubmission,
  receipt: NonNullable<FilingSubmission["receipt"]>,
  by: "anvandare"
): FilingSubmission {
  assertTransition(submission, "kvitterad");
  submission.receipt = receipt;
  submission.status = "kvitterad";
  submission.lastError = undefined;
  touch(submission);
  logAudit(
    by,
    "inlamning_kvitterad",
    `Kvittens ${receipt.receiptId} för ${FILING_KIND_LABEL[submission.kind].toLowerCase()} ${submission.label}.`,
    { targetType: "inlamning", targetId: submission.id }
  );
  return submission;
}

/**
 * Hämta kvittensen för en mottagen inlämning. Returnerar raden oförändrad när
 * myndigheten inte behandlat den än – väntan är inte ett fel.
 */
export async function fetchFilingReceipt(
  id: string,
  input: { by: "anvandare"; provider?: FilingProvider }
): Promise<FilingSubmission> {
  const submission = requireSubmission(id);
  if (submission.status === "kvitterad") return submission;
  if (submission.status !== "inlamnad" || !submission.providerSubmissionId) {
    throw new FilingError("Inlämningen är inte mottagen av myndigheten än, så det finns ingen kvittens att hämta.");
  }
  const provider = input.provider ?? selectFilingProvider();
  let outcome;
  try {
    outcome = await provider.fetchReceipt(submission.providerSubmissionId);
  } catch (e) {
    submission.lastError = userFacingFilingError(e);
    touch(submission);
    throw e;
  }
  if (outcome.kind === "pending") return submission;
  if (outcome.kind === "rejected") {
    submission.status = "avvisad";
    submission.rejection = { reason: outcome.reason, at: new Date().toISOString() };
    submission.lastError = undefined;
    touch(submission);
    logAudit(
      input.by,
      "inlamning_avvisad",
      `${FILING_KIND_LABEL[submission.kind]} för ${submission.label} avvisades: ${outcome.reason}`,
      { targetType: "inlamning", targetId: submission.id }
    );
    return submission;
  }
  return recordReceipt(submission, outcome.receipt, input.by);
}

function requireSubmission(id: string): FilingSubmission {
  const submission = filingSubmissionById(id);
  if (!submission) throw new FilingError(FILING_ERROR_TEXT.noSubmission);
  return submission;
}
