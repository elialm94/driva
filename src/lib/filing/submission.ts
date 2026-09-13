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
 *
 * Utan leverantör finns den manuella vägen (längst ner): filen hämtas
 * (downloadedAt), lämnas in av användaren i myndighetens e-tjänst och
 * rapporteras med referensnummer eller kvittensfil. Raden blir då kvitterad
 * med provider "manuell" – statusen säger fortfarande bara vad som hänt, och
 * vem som sa det.
 */
import { createHash } from "node:crypto";
import type { FilingFileRef, FilingKind, FilingManualReceipt, FilingSubmission, FilingSubmissionStatus } from "../types";
import { db, save } from "../store";
import { uid } from "../ids";
import { logAudit } from "../accounting/audit";
import { orgNumber10 } from "../accounting/filing-format";
import { generateVatReport, markVatReportDeclared, vatReportForPeriod } from "../accounting/vat";
import { employerDeclarationFor, generateEmployerDeclaration, markEmployerDeclarationDeclared } from "../accounting/payroll";
import { advanceAnnualReportStatus } from "../accounting/annual-report";
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

/* --------------------------- Manuell inlämning ----------------------------- */

/**
 * Filen hämtades för att lämnas in för hand. Finns ingen inlämning i arbete
 * skapas den (genererad), så att kontrollsumman för det som hämtades är låst
 * innan användaren lämnar in det. Nedladdning är inte inlämning: statusen
 * förblir genererad.
 */
export function markFilingDownloaded(input: GenerateFilingInput): FilingSubmission {
  let submission = openFilingSubmission(input.kind, input.subjectId);
  if (!submission || submission.status === "utkast") submission = generateFilingSubmission(input);
  submission.downloadedAt = new Date().toISOString();
  touch(submission);
  logAudit(
    input.by,
    "inlamning_nedladdad",
    `${FILING_KIND_LABEL[submission.kind]} för ${submission.label} hämtades för manuell inlämning (${submission.files.map((f) => f.filename).join(" + ")}).`,
    { targetType: "inlamning", targetId: submission.id }
  );
  return submission;
}

export interface ManualFilingReportInput {
  kind: FilingKind;
  subjectId: string;
  /** Myndighetens referens- eller kvittensnummer. */
  reference?: string;
  note?: string;
  file?: FilingManualReceipt["file"];
  reportedByName: string;
  reportedByUserId?: string;
  by: "anvandare";
  /**
   * Spegla inlämningen i den deklarationsstatus resten av bokföringen redan
   * använder (momsrapport deklarerad, AGI lämnad, årsredovisning markerad som
   * inlämnad). Standard på; testerna kan stänga av det.
   */
  syncDomainStatus?: boolean;
}

/**
 * "Jag har lämnat in": användaren har själv lämnat in filen i myndighetens
 * e-tjänst och rapporterar det. Kräver referensnummer eller kvittensfil – ett
 * påstående utan något att visa upp är ingen inlämning.
 *
 * Filerna byggs om och jämförs mot det som hämtades: har underlaget ändrats
 * sedan dess är det inte den filen som lämnades in, och raden faller
 * tillbaka till genererad så att användaren hämtar den nya.
 *
 * Raden blir kvitterad med provider manuell. Kvittensen är användarens egen
 * uppgift – texten säger det, och Ferva påstår inte att den kontrollerats.
 * En rättelse senare blir en ny rad, aldrig en ändring av den här.
 */
export function reportManualFilingSubmission(input: ManualFilingReportInput): FilingSubmission {
  const reference = input.reference?.trim() || undefined;
  const note = input.note?.trim() || undefined;
  if (!reference && !input.file) {
    throw new FilingError("Ange myndighetens referens- eller kvittensnummer, eller ladda upp kvittensen.");
  }
  if (reference && reference.length > 80) {
    throw new FilingError("Referensnumret är för långt (max 80 tecken).");
  }

  let submission = openFilingSubmission(input.kind, input.subjectId);
  if (!submission || submission.status === "utkast") {
    submission = generateFilingSubmission({ kind: input.kind, subjectId: input.subjectId, by: input.by });
  }
  if (submission.status !== "genererad" && submission.status !== "signerad") {
    throw new FilingError(
      `Inlämningen är ${FILING_STATUS_LABEL[submission.status].toLowerCase()} och kan inte rapporteras som manuellt inlämnad.`
    );
  }

  const payload = buildFilingPayload(submission.kind, submission.subjectId);
  const files = fileRefs(payload);
  if (!sameFiles(submission.files, files)) {
    submission.files = files;
    submission.status = "genererad";
    submission.signature = undefined;
    submission.downloadedAt = undefined;
    submission.generatedAt = new Date().toISOString();
    touch(submission);
    throw new FilingError(
      "Underlaget har ändrats sedan filen hämtades, så filen är byggd om. Hämta den nya filen, lämna in den och rapportera sedan."
    );
  }

  if (input.syncDomainStatus !== false) syncDomainStatusAfterManualFiling(submission, input.by);

  const now = new Date().toISOString();
  submission.provider = "manuell";
  submission.status = "kvitterad";
  submission.submittedAt = now;
  submission.manualReceipt = {
    reference,
    note,
    file: input.file,
    reportedAt: now,
    reportedByName: input.reportedByName,
    reportedByUserId: input.reportedByUserId,
  };
  submission.receipt = {
    receiptId: reference ?? `Kvittens bifogad: ${input.file!.filename}`,
    receivedAt: now,
    message: `Rapporterad av ${input.reportedByName}. Ferva har inte skickat filen och inte kontrollerat kvittensen hos ${authorityName(submission.authority)}.`,
  };
  submission.lastError = undefined;
  touch(submission);
  logAudit(
    input.by,
    "inlamning_rapporterad",
    `${FILING_KIND_LABEL[submission.kind]} för ${submission.label} rapporterades som inlämnad för hand hos ${authorityName(submission.authority)} av ${input.reportedByName}` +
      `${reference ? ` (referens ${reference})` : ""}${input.file ? ` med kvittensfil ${input.file.filename}` : ""}. ` +
      `Kontrollsumma ${submission.files.map((f) => `${f.filename} ${f.sha256.slice(0, 16)}…`).join(", ")}.`,
    { targetType: "inlamning", targetId: submission.id }
  );
  return submission;
}

function authorityName(authority: FilingSubmission["authority"]): string {
  return authority === "skatteverket" ? "Skatteverket" : "Bolagsverket";
}

/**
 * Samma handling ska synas på ett ställe. När momsdeklarationen rapporteras
 * som inlämnad markeras momsrapporten som deklarerad (och momsen förs om till
 * 2650) precis som knappen på momssidan gör; AGI markeras som lämnad; en
 * signerad årsredovisning markeras som inlämnad. Vakterna i de funktionerna
 * (perioden slut, ordningen, checklistan) gäller även här – de visas som
 * blockerare på deklarationsytan innan man kommer så långt.
 */
function syncDomainStatusAfterManualFiling(submission: FilingSubmission, by: "anvandare"): void {
  try {
    switch (submission.kind) {
      case "moms": {
        const report = vatReportForPeriod(submission.subjectId) ?? generateVatReport(submission.subjectId, by);
        if (report.status !== "deklarerad") markVatReportDeclared(report.id, by);
        return;
      }
      case "agi": {
        const declaration = employerDeclarationFor(submission.subjectId) ?? generateEmployerDeclaration(submission.subjectId, by);
        if (declaration.status !== "deklarerad") markEmployerDeclarationDeclared(declaration.id, by);
        return;
      }
      case "arsredovisning": {
        const report = db().annualReports.find((r) => r.id === submission.subjectId);
        if (!report) throw new FilingError("Årsredovisningen finns inte.");
        if (report.status === "inlamnad_markerad") return;
        if (report.status !== "signerad") {
          throw new FilingError(
            "Årsredovisningen måste vara granskad och markerad som underskriven på bokslutssidan innan den rapporteras som inlämnad."
          );
        }
        advanceAnnualReportStatus(report.id, "inlamnad_markerad", by);
        return;
      }
      case "ink2":
        return;
    }
  } catch (e) {
    if (e instanceof FilingError) throw e;
    throw new FilingError(e instanceof Error ? e.message : "Deklarationen kunde inte markeras som lämnad.");
  }
}
