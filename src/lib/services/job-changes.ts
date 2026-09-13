import { db, save } from "../store";
import { publicToken, uid } from "../ids";
import type { DocLine, Job, JobChange, JobChangeApproval, JobChangeStatus, RotRut } from "../types";
import { docTotals } from "../calc";
import { jobChangeContentHash } from "../hash";
import { kr, datumLang } from "../format";
import { buyerSnapshot, sellerSnapshot } from "../invoices/snapshot";
import { normalizeAcceptName } from "../quote-acceptance";
import { syncDocLineClassification } from "../economic-line-type";
import { logAudit } from "../accounting/audit";
import { logActivity } from "./activity";
import { currentVersion, getJob, jobQuote, requireCustomer } from "./data";
import { rateLimitQuoteAccept } from "./quote-accept";
import { liveAllocationForSource, sourceBillingState } from "./billing-allocation";

/**
 * Ändringar och tillägg (ÄTA) på ett uppdrag – med kundens godkännande.
 *
 *   * En ändring är ett litet dokument: rubrik, vad som ändras, ev. tidspåverkan
 *     och prisrader. Den skapas som utkast, skickas (låses) och godkänns eller
 *     avböjs av kunden via en publik länk – samma mönster som offertlänken.
 *   * Innehållet låses vid utskick: hash + säljar-/köparsnapshot. Kunden
 *     godkänner exakt det dokument hen såg (hashen skickas med).
 *   * Ny version = ny rad som ersätter den gamla (status "ersatt"). Den gamla
 *     raden och dess bevis ligger kvar orörda.
 *   * Fakturering sker aldrig här. Godkända rader blir fakturerbara källor
 *     (change_line) i faktureringsallokeringen; "Delvis fakturerad" och
 *     "Fakturerad" härleds därifrån och lagras inte.
 *   * Ingen AI hittar på pris, material eller tid – tjänsten tar bara emot
 *     det användaren skrivit.
 */

export type JobChangeErrorCode =
  | "not_found"
  | "name_required"
  | "declined"
  | "not_approvable"
  | "changed"
  | "too_many"
  | "locked"
  | "lines_empty"
  | "billed";

export const JOB_CHANGE_TEXT: Record<JobChangeErrorCode, string> = {
  not_found: "Ändringen finns inte eller kan inte visas.",
  name_required: "Skriv ditt namn för att godkänna ändringen.",
  declined: "Ändringen har avböjts och kan inte längre godkännas. Kontakta företaget om du ändrat dig.",
  not_approvable: "Ändringen kan inte godkännas i sitt nuvarande läge.",
  changed: "Ändringen har uppdaterats sedan du öppnade den. Ladda om sidan och läs igenom den igen.",
  too_many: "För många försök. Vänta en stund och försök igen.",
  locked: "Ändringen är skickad till kunden och kan inte redigeras. Skapa en ny version i stället.",
  lines_empty: "Lägg till minst en rad med beskrivning innan ändringen skickas.",
  billed: "Ändringen är helt eller delvis fakturerad och kan inte ersättas.",
};

export class JobChangeError extends Error {
  readonly code: JobChangeErrorCode;
  constructor(code: JobChangeErrorCode) {
    super(JOB_CHANGE_TEXT[code]);
    this.name = "JobChangeError";
    this.code = code;
  }
}

/* ---------------------------------- läsning --------------------------------- */

export function allJobChanges(): JobChange[] {
  return db().jobChanges ?? [];
}

function changeList(): JobChange[] {
  const data = db();
  if (!data.jobChanges) data.jobChanges = [];
  return data.jobChanges;
}

export function getJobChange(id: string): JobChange | undefined {
  return allJobChanges().find((c) => c.id === id);
}

export function requireJobChange(id: string): JobChange {
  const c = getJobChange(id);
  if (!c) throw new JobChangeError("not_found");
  return c;
}

export function getJobChangeByToken(token: string): JobChange | undefined {
  const t = token.trim();
  if (!t) return undefined;
  return allJobChanges().find((c) => c.token === t);
}

/** Alla ändringar på ett uppdrag, nyaste först (nummer, sedan version). */
export function jobChangesForJob(jobId: string): JobChange[] {
  return allJobChanges()
    .filter((c) => c.jobId === jobId)
    .sort((a, b) => b.number - a.number || b.version - a.version);
}

/** Godkända ändringar som fortfarande gäller (inte ersatta). */
export function approvedJobChanges(jobId: string): JobChange[] {
  return jobChangesForJob(jobId).filter((c) => c.status === "godkand");
}

/** ROT/RUT-läget följer uppdragets offert: ändringen är en del av samma avtal. */
export function jobChangeRot(change: JobChange): RotRut | null {
  const job = getJob(change.jobId);
  const quote = job ? jobQuote(job) : undefined;
  const rot = quote ? currentVersion(quote).rot : null;
  return rot ? { type: rot.type } : null;
}

export function jobChangeTotals(change: JobChange) {
  return docTotals(change.lines, jobChangeRot(change));
}

/* ------------------------------------ hash ---------------------------------- */

/** Kanoniskt hash av ändringens innehåll – det kunden faktiskt godkänner. */
export function jobChangeHash(c: JobChange): string {
  return jobChangeContentHash(c);
}

/** Meningen kunden godkänner – samma på sidan och i det sparade beviset. */
export function jobChangeStatement(change: JobChange): string {
  const job = getJob(change.jobId);
  const seller = change.sellerSnapshot?.name ?? db().settings.name;
  const t = jobChangeTotals(change);
  const amount =
    t.total < 0
      ? `ett prisavdrag om ${kr(Math.abs(t.total))}`
      : t.total === 0
        ? "oförändrat pris"
        : `ett tillägg om ${kr(t.total)}`;
  const rot = t.deduction > 0 ? `, varav ${kr(t.deduction)} är ett preliminärt ROT/RUT-avdrag` : "";
  const jobTitle = job?.title ?? "uppdraget";
  return `Genom att godkänna accepterar du ändringen “${change.title}” till uppdraget “${jobTitle}” från ${seller} daterad ${datumLang(change.sentAt ?? change.createdAt)} med ${amount}${rot}.`;
}

/* --------------------------------- statusar --------------------------------- */

export type JobChangeDisplayStatus = JobChangeStatus | "delvis_fakturerad" | "fakturerad";

export const JOB_CHANGE_STATUS_LABEL: Record<JobChangeDisplayStatus, string> = {
  utkast: "Utkast",
  vantar_pa_kunden: "Väntar på kunden",
  godkand: "Godkänd",
  avbojd: "Avböjd",
  ersatt: "Ersatt av ny version",
  delvis_fakturerad: "Delvis fakturerad",
  fakturerad: "Fakturerad",
};

/** Fakturerbara rader (rubriker räknas inte). */
export function billableChangeLines(change: JobChange): DocLine[] {
  return change.lines.filter((l) => !l.isHeading);
}

/**
 * Visningsstatus: godkänd + alla rader fakturerade → "Fakturerad", några →
 * "Delvis fakturerad". Härleds från allokeringen, lagras aldrig.
 */
export function jobChangeDisplayStatus(change: JobChange): JobChangeDisplayStatus {
  if (change.status !== "godkand") return change.status;
  const lines = billableChangeLines(change);
  if (lines.length === 0) return "godkand";
  let billed = 0;
  for (const line of lines) {
    if (sourceBillingState({ sourceType: "change_line", sourceId: line.id }).status !== "unbilled") billed += 1;
  }
  if (billed === 0) return "godkand";
  return billed === lines.length ? "fakturerad" : "delvis_fakturerad";
}

export function jobChangeStatusLabel(change: JobChange): string {
  return JOB_CHANGE_STATUS_LABEL[jobChangeDisplayStatus(change)];
}

/** Färgton för statusetiketten (matchar Badge-tonerna i UI:t). */
export function jobChangeStatusTone(change: JobChange): "ok" | "warn" | "danger" | "neutral" | "info" {
  switch (jobChangeDisplayStatus(change)) {
    case "godkand":
    case "fakturerad":
      return "ok";
    case "delvis_fakturerad":
      return "info";
    case "vantar_pa_kunden":
      return "warn";
    case "avbojd":
      return "danger";
    default:
      return "neutral";
  }
}

function hasLiveBilling(change: JobChange): boolean {
  return billableChangeLines(change).some((l) => Boolean(liveAllocationForSource({ sourceType: "change_line", sourceId: l.id })));
}

/* ---------------------------------- skapa/ändra ----------------------------- */

export interface JobChangeInput {
  title: string;
  description: string;
  timeImpact?: string;
  lines: DocLine[];
  createdBy?: JobChange["createdBy"];
}

function cleanText(raw: unknown, max: number): string {
  return typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim().slice(0, max) : "";
}

function cleanLines(lines: DocLine[]): DocLine[] {
  return lines
    .filter((l) => l && typeof l.description === "string" && (l.isHeading || l.description.trim().length > 0))
    .map((l) =>
      syncDocLineClassification({
        ...l,
        id: l.id || uid(),
        description: l.description.trim(),
        unit: typeof l.unit === "string" && l.unit.trim() ? l.unit.trim() : "st",
        qty: Number.isFinite(l.qty) ? l.qty : 0,
        unitPrice: Number.isFinite(l.unitPrice) ? l.unitPrice : 0,
        sourceKind: undefined,
        sourceId: undefined,
        paymentPlanIndex: undefined,
      })
    );
}

export function createJobChange(jobId: string, input: JobChangeInput): JobChange {
  const job = getJob(jobId);
  if (!job) throw new Error(`Uppdraget ${jobId} finns inte`);
  const existing = jobChangesForJob(jobId);
  const number = existing.reduce((m, c) => Math.max(m, c.number), 0) + 1;
  const change: JobChange = {
    id: uid(),
    jobId,
    customerId: job.customerId,
    number,
    version: 1,
    status: "utkast",
    title: cleanText(input.title, 200) || `Ändring ${number}`,
    description: cleanText(input.description, 4000),
    ...(cleanText(input.timeImpact, 300) ? { timeImpact: cleanText(input.timeImpact, 300) } : {}),
    lines: cleanLines(input.lines),
    token: publicToken(),
    createdAt: new Date().toISOString(),
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
  };
  changeList().push(change);
  save();
  return change;
}

export function updateJobChange(id: string, input: Partial<JobChangeInput>): JobChange {
  const change = requireJobChange(id);
  if (change.status !== "utkast") throw new JobChangeError("locked");
  if (input.title !== undefined) change.title = cleanText(input.title, 200) || change.title;
  if (input.description !== undefined) change.description = cleanText(input.description, 4000);
  if (input.timeImpact !== undefined) {
    const t = cleanText(input.timeImpact, 300);
    if (t) change.timeImpact = t;
    else delete change.timeImpact;
  }
  if (input.lines !== undefined) change.lines = cleanLines(input.lines);
  save();
  return change;
}

export function deleteJobChange(id: string): void {
  const change = requireJobChange(id);
  if (change.status !== "utkast") throw new JobChangeError("locked");
  const list = changeList();
  const idx = list.findIndex((c) => c.id === id);
  if (idx >= 0) list.splice(idx, 1);
  // Ett kasserat utkast till ny version lämnar den gamla raden gällande.
  if (change.replacesChangeId) {
    const prev = getJobChange(change.replacesChangeId);
    if (prev && prev.replacedByChangeId === id) delete prev.replacedByChangeId;
  }
  save();
}

/**
 * Skicka = lås. Snapshots och hash sätts, status blir "väntar på kunden".
 * Själva utskicket (länk, e-post) sköts av anroparen; i demo skickas inget.
 */
export function sendJobChange(id: string): JobChange {
  const change = requireJobChange(id);
  if (change.status !== "utkast") return change;
  if (billableChangeLines(change).length === 0) throw new JobChangeError("lines_empty");
  const data = db();
  const customer = requireCustomer(change.customerId);
  const now = new Date().toISOString();
  change.sellerSnapshot = sellerSnapshot(data.settings);
  change.buyerSnapshot = buyerSnapshot(customer);
  change.lockedAt = now;
  change.sentAt = now;
  change.contentHash = jobChangeHash(change);
  change.status = "vantar_pa_kunden";
  // Ny version ersätter den gamla först när den faktiskt skickas.
  if (change.replacesChangeId) {
    const prev = getJobChange(change.replacesChangeId);
    if (prev && prev.status !== "ersatt") {
      prev.status = "ersatt";
      prev.replacedByChangeId = change.id;
    }
  }
  logActivity(`Ändring ${change.number} “${change.title}” skickades till kunden för godkännande.`, {
    customerId: change.customerId,
    entity: { type: "andring", id: change.id },
  });
  save();
  return change;
}

/**
 * Ny version av en skickad, avböjd eller (ofakturerad) godkänd ändring.
 * Kopian är ett utkast; den gamla blir "ersatt" när den nya skickas.
 */
export function createJobChangeVersion(id: string): JobChange {
  const prev = requireJobChange(id);
  if (prev.status === "utkast") return prev;
  if (prev.status === "ersatt") throw new JobChangeError("not_approvable");
  if (prev.status === "godkand" && hasLiveBilling(prev)) throw new JobChangeError("billed");
  const draft = allJobChanges().find((c) => c.replacesChangeId === prev.id && c.status === "utkast");
  if (draft) return draft;
  const change: JobChange = {
    id: uid(),
    jobId: prev.jobId,
    customerId: prev.customerId,
    number: prev.number,
    version: prev.version + 1,
    status: "utkast",
    title: prev.title,
    description: prev.description,
    ...(prev.timeImpact ? { timeImpact: prev.timeImpact } : {}),
    lines: prev.lines.map((l) => ({ ...l, id: uid() })),
    token: publicToken(),
    createdAt: new Date().toISOString(),
    replacesChangeId: prev.id,
    ...(prev.createdBy ? { createdBy: prev.createdBy } : {}),
  };
  prev.replacedByChangeId = change.id;
  changeList().push(change);
  save();
  return change;
}

export function markJobChangeViewed(id: string): void {
  const change = getJobChange(id);
  if (!change || change.viewedAt || change.status === "utkast") return;
  change.viewedAt = new Date().toISOString();
  save();
}

/* --------------------------------- kundens beslut ---------------------------- */

export interface ApproveJobChangeInput {
  token: string;
  name: string;
  expectedContentHash?: string;
  ip?: string;
  userAgent?: string;
}

export interface ApproveJobChangeResult {
  outcome: "approved" | "already_approved";
  change: JobChange;
  approval: JobChangeApproval;
}

export function approveJobChange(input: ApproveJobChangeInput): ApproveJobChangeResult {
  const token = typeof input.token === "string" ? input.token.trim() : "";
  if (!token) throw new JobChangeError("not_found");
  if (!rateLimitQuoteAccept(`andring:${token}`, input.ip)) throw new JobChangeError("too_many");

  const change = getJobChangeByToken(token);
  if (!change || change.status === "utkast") throw new JobChangeError("not_found");
  if (change.status === "godkand" && change.approval) {
    return { outcome: "already_approved", change, approval: change.approval };
  }
  const name = normalizeAcceptName(input.name);
  if (!name) throw new JobChangeError("name_required");
  if (change.status === "avbojd") throw new JobChangeError("declined");
  if (change.status !== "vantar_pa_kunden") throw new JobChangeError("not_approvable");

  const currentHash = jobChangeHash(change);
  if (input.expectedContentHash && input.expectedContentHash !== currentHash) throw new JobChangeError("changed");
  if (change.contentHash && change.contentHash !== currentHash) throw new JobChangeError("changed");

  const customer = requireCustomer(change.customerId);
  const now = new Date().toISOString();
  const approval: JobChangeApproval = {
    approvedAt: now,
    approvedByName: name,
    customerNameAtApproval: customer.name,
    contentHash: currentHash,
    statement: jobChangeStatement(change),
    ...(input.ip ? { ip: input.ip } : {}),
    ...(input.userAgent ? { userAgent: input.userAgent.slice(0, 512) } : {}),
  };
  change.approval = approval;
  change.status = "godkand";
  change.decidedAt = now;
  const t = jobChangeTotals(change);
  logActivity(`${name} godkände ändring ${change.number} “${change.title}” (${kr(t.total)}).`, {
    customerId: customer.id,
    entity: { type: "andring", id: change.id },
  });
  logAudit("system", "andring_godkand", `Ändring ${change.number} v${change.version} godkänd av ${name}. Hash ${currentHash.slice(0, 12)}.`, {
    targetType: "andring",
    targetId: change.id,
  });
  save();
  return { outcome: "approved", change, approval };
}

export function declineJobChange(token: string, reason?: string): JobChange | undefined {
  const change = getJobChangeByToken(token);
  if (!change || change.status !== "vantar_pa_kunden") return undefined;
  const now = new Date().toISOString();
  change.status = "avbojd";
  change.decidedAt = now;
  const cleanReason = cleanText(reason, 2000);
  if (cleanReason) change.declineReason = cleanReason;
  logActivity(`Kunden avböjde ändring ${change.number} “${change.title}”.`, {
    customerId: change.customerId,
    entity: { type: "andring", id: change.id },
  });
  logAudit("system", "andring_avbojd", `Ändring ${change.number} v${change.version} avböjd av kunden.${cleanReason ? ` Skäl: ${cleanReason}` : ""}`, {
    targetType: "andring",
    targetId: change.id,
  });
  save();
  return change;
}

/* ------------------------------ till fakturering ---------------------------- */

/** Fakturarad från en godkänd ändringsrad – spårbar via sourceKind/sourceId. */
export function changeLineToDocLine(change: JobChange, line: DocLine): DocLine {
  return syncDocLineClassification({
    ...line,
    id: uid(),
    description: change.lines.length > 1 ? line.description : line.description || change.title,
    sourceKind: "CHANGE_LINE",
    sourceId: line.id,
  });
}

/** Sammanställning för uppdragets ekonomi: godkända tillägg exkl. moms. */
export function approvedChangesTotal(job: Pick<Job, "id">): number {
  return approvedJobChanges(job.id).reduce((s, c) => s + docTotals(c.lines, null).subtotal, 0);
}
