/**
 * Servertillämpning av offline-kön (spec §9).
 *
 * Kallas INNE i withBusiness (write) från /api/offline/sync. Varje ärende:
 *   1. valideras strukturellt (parse) – okänd typ eller trasig payload → rejected
 *   2. capability-kontroll mot aktörens roll – samma krav som formuläret
 *   3. idempotens: finns kvitto för (företag, nyckel) → returnera det utfallet
 *   4. konfliktkontroll mot entitetens nuläge (uppdrag borttaget/avslutat)
 *   5. tillämpas via den vanliga tjänsten
 *   6. kvitto skrivs (också för konflikt/avvisat, så omsändning inte gör om jobbet)
 *
 * Ordningen är klientens seq – ett uppdragsutkast före arbetstiden på det.
 */
import { uid } from "../ids";
import { can } from "../collaboration/permissions";
import type { CollaborationActor } from "../collaboration/actor";
import { getCustomer, getJob } from "../services/data";
import { addJobMaterial, registerJobTime } from "../services/job-work";
import { appendJobNote, createJob } from "../services/jobs";
import { addJobPhoto } from "../services/job-photos";
import { createCustomer } from "../services/customers";
import { ingestUploadedDocument } from "../services/inbox";
import { storeInboxAttachment } from "../inbox/attachment-file";
import { isAllowedReceiptContentType, MAX_RECEIPT_BYTES } from "../receipts/receipt-file";
import { findOfflineReceipt, insertOfflineReceipt } from "../platform/store";
import type { OfflineMutationReceipt } from "../platform/types";
import { CAPABILITY_BY_KIND } from "./queue";
import { OFFLINE_MUTATION_KINDS } from "./types";
import type {
  CustomerDraftPayload,
  JobDraftPayload,
  JobPhotoPayload,
  MaterialPayload,
  OfflineMutationKind,
  ReceiptPayload,
  WireMutation,
  WireResult,
  WorkNotePayload,
  WorkTimePayload,
} from "./types";

export const MAX_BATCH = 50;
const MAX_PHOTO_DATA_URL = 1_800_000;
const MAX_TEXT = 4_000;

/* ------------------------------ Parse ------------------------------ */

type Parsed =
  | { ok: true; kind: OfflineMutationKind; payload: unknown }
  | { ok: false; message: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, max = MAX_TEXT): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function isoDay(v: unknown): string | undefined {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
}

/** Bara serverns id accepteras här – klienten löser lokala utkast innan sändning. */
function serverRef(v: unknown): { id: string } | undefined {
  if (!isRecord(v)) return undefined;
  const id = str(v.id, 128);
  return id ? { id } : undefined;
}

export function parseWireMutation(raw: unknown): Parsed {
  if (!isRecord(raw)) return { ok: false, message: "Ogiltigt ärende." };
  const kind = raw.kind;
  if (typeof kind !== "string" || !(OFFLINE_MUTATION_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, message: "Den här typen av ändring kan inte göras offline." };
  }
  const p = raw.payload;
  if (!isRecord(p)) return { ok: false, message: "Ärendet saknar innehåll." };
  switch (kind as OfflineMutationKind) {
    case "work_time": {
      const job = serverRef(p.job);
      const hours = num(p.hours);
      const date = isoDay(p.date);
      if (!job) return { ok: false, message: "Arbetstiden saknar uppdrag." };
      if (hours == null || hours <= 0 || hours > 24) return { ok: false, message: "Ange timmar mellan 0 och 24." };
      if (!date) return { ok: false, message: "Arbetstiden saknar datum." };
      const payload: WorkTimePayload = { job, hours, date, ...(str(p.description, 300) ? { description: str(p.description, 300) } : {}) };
      return { ok: true, kind: "work_time", payload };
    }
    case "work_note": {
      const job = serverRef(p.job);
      const text = str(p.text);
      if (!job) return { ok: false, message: "Anteckningen saknar uppdrag." };
      if (!text) return { ok: false, message: "Anteckningen är tom." };
      const payload: WorkNotePayload = { job, text };
      return { ok: true, kind: "work_note", payload };
    }
    case "job_photo": {
      const job = serverRef(p.job);
      const dataUrl = typeof p.dataUrl === "string" ? p.dataUrl : undefined;
      if (!job) return { ok: false, message: "Fotot saknar uppdrag." };
      if (!dataUrl || !dataUrl.startsWith("data:image/")) return { ok: false, message: "Fotot kunde inte läsas." };
      if (dataUrl.length > MAX_PHOTO_DATA_URL) return { ok: false, message: "Fotot är för stort." };
      const payload: JobPhotoPayload = { job, dataUrl, ...(str(p.caption, 200) ? { caption: str(p.caption, 200) } : {}) };
      return { ok: true, kind: "job_photo", payload };
    }
    case "receipt": {
      const filename = str(p.filename, 120) ?? "kvitto.jpg";
      const contentType = str(p.contentType, 80) ?? "image/jpeg";
      const contentBase64 = typeof p.contentBase64 === "string" ? p.contentBase64.replace(/\s/g, "") : "";
      if (!isAllowedReceiptContentType(contentType)) return { ok: false, message: "Kvittot måste vara en bild eller PDF." };
      if (!contentBase64) return { ok: false, message: "Kvittofilen kunde inte läsas." };
      // base64 → bytes ≈ 3/4
      if (contentBase64.length * 0.75 > MAX_RECEIPT_BYTES) return { ok: false, message: "Kvittot är för stort." };
      const payload: ReceiptPayload = { filename, contentType, contentBase64, ...(str(p.note, 300) ? { note: str(p.note, 300) } : {}) };
      return { ok: true, kind: "receipt", payload };
    }
    case "material": {
      const job = serverRef(p.job);
      const description = str(p.description, 300);
      const qty = num(p.qty);
      const unitPrice = num(p.unitPrice);
      if (!job) return { ok: false, message: "Materialraden saknar uppdrag." };
      if (!description) return { ok: false, message: "Beskriv materialet." };
      if (qty == null || qty <= 0) return { ok: false, message: "Ange en mängd större än noll." };
      if (unitPrice == null || unitPrice < 0) return { ok: false, message: "Priset måste vara minst 0 kr." };
      const payload: MaterialPayload = { job, description, qty, unitPrice, ...(str(p.unit, 20) ? { unit: str(p.unit, 20) } : {}) };
      return { ok: true, kind: "material", payload };
    }
    case "customer_draft": {
      const localId = str(p.localId, 128);
      const name = str(p.name, 200);
      const kind2 = p.kind === "foretag" ? "foretag" : "privat";
      if (!localId) return { ok: false, message: "Kundutkastet saknar id." };
      if (!name) return { ok: false, message: "Kunden saknar namn." };
      const payload: CustomerDraftPayload = {
        localId,
        kind: kind2,
        name,
        ...(str(p.phone, 40) ? { phone: str(p.phone, 40) } : {}),
        ...(str(p.email, 200) ? { email: str(p.email, 200) } : {}),
        ...(str(p.address, 200) ? { address: str(p.address, 200) } : {}),
        ...(str(p.postalCode, 12) ? { postalCode: str(p.postalCode, 12) } : {}),
        ...(str(p.city, 80) ? { city: str(p.city, 80) } : {}),
      };
      return { ok: true, kind: "customer_draft", payload };
    }
    case "job_draft": {
      const localId = str(p.localId, 128);
      const title = str(p.title, 200);
      const customer = serverRef(p.customer);
      if (!localId) return { ok: false, message: "Uppdragsutkastet saknar id." };
      if (!title) return { ok: false, message: "Uppdraget saknar titel." };
      if (!customer) return { ok: false, message: "Uppdraget saknar kund." };
      const payload: JobDraftPayload = {
        localId,
        title,
        customer,
        ...(str(p.description) ? { description: str(p.description) } : {}),
        ...(isoDay(p.startDate) ? { startDate: isoDay(p.startDate) } : {}),
      };
      return { ok: true, kind: "job_draft", payload };
    }
  }
}

/* ------------------------------ Apply ------------------------------ */

type ApplyOutcome = { outcome: "synced"; ref?: string } | { outcome: "conflict" | "failed"; message: string };

/** Uppdraget måste finnas och vara öppet. `entityVersion` = status vid cachning. */
function jobGate(jobId: string, entityVersion: string | undefined): ApplyOutcome | null {
  const job = getJob(jobId);
  if (!job) return { outcome: "conflict", message: "Uppdraget finns inte längre på servern." };
  if (job.status === "klart" && entityVersion && entityVersion !== "klart") {
    return { outcome: "conflict", message: `Uppdraget "${job.title}" markerades som klart medan du var offline. Kontrollera innan du registrerar mer på det.` };
  }
  return null;
}

async function applyOne(kind: OfflineMutationKind, payload: unknown, entityVersion: string | undefined): Promise<ApplyOutcome> {
  switch (kind) {
    case "work_time": {
      const p = payload as WorkTimePayload & { job: { id: string } };
      const gate = jobGate(p.job.id, entityVersion);
      if (gate) return gate;
      const entry = registerJobTime(p.job.id, { hours: p.hours, date: p.date, description: p.description, source: "manual" });
      return { outcome: "synced", ref: entry.id };
    }
    case "work_note": {
      const p = payload as WorkNotePayload & { job: { id: string } };
      const gate = jobGate(p.job.id, entityVersion);
      if (gate) return gate;
      appendJobNote(p.job.id, p.text);
      return { outcome: "synced", ref: p.job.id };
    }
    case "job_photo": {
      const p = payload as JobPhotoPayload & { job: { id: string }; dataUrl: string };
      const gate = jobGate(p.job.id, entityVersion);
      if (gate) return gate;
      const photo = addJobPhoto(p.job.id, { dataUrl: p.dataUrl, caption: p.caption });
      return { outcome: "synced", ref: photo.id };
    }
    case "material": {
      const p = payload as MaterialPayload & { job: { id: string } };
      const gate = jobGate(p.job.id, entityVersion);
      if (gate) return gate;
      const entry = addJobMaterial(p.job.id, {
        description: p.description,
        qty: p.qty,
        unit: p.unit,
        unitPrice: p.unitPrice,
        source: "manual",
      });
      return { outcome: "synced", ref: entry.id };
    }
    case "receipt": {
      const p = payload as ReceiptPayload & { contentBase64: string };
      const stored = await storeInboxAttachment(`offline-${uid()}`, p.filename, p.contentType, p.contentBase64);
      // Ingen AI-tolkning här: kvittot landar i inkorgen för kontroll som en
      // vanlig uppladdning utan tolkade fält.
      const result = ingestUploadedDocument({
        filename: p.filename,
        contentType: p.contentType,
        text: p.note ?? "",
        sizeBytes: Math.floor(p.contentBase64.length * 0.75),
        ...(stored.storagePath ? { storagePath: stored.storagePath } : {}),
        ...(stored.contentBase64 ? { contentBase64: stored.contentBase64 } : {}),
      });
      if (!result.ok) return { outcome: "failed", message: result.error };
      return { outcome: "synced", ref: result.item.id };
    }
    case "customer_draft": {
      const p = payload as CustomerDraftPayload;
      const customer = createCustomer({
        kind: p.kind,
        name: p.name,
        phone: p.phone,
        email: p.email,
        address: p.address,
        postalCode: p.postalCode,
        city: p.city,
      });
      return { outcome: "synced", ref: customer.id };
    }
    case "job_draft": {
      const p = payload as JobDraftPayload & { customer: { id: string } };
      if (!getCustomer(p.customer.id)) return { outcome: "conflict", message: "Kunden finns inte längre på servern." };
      const job = createJob({
        customerId: p.customer.id,
        title: p.title,
        description: p.description,
        startDate: p.startDate,
        source: "manual",
      });
      return { outcome: "synced", ref: job.id };
    }
  }
}

/** Fel från tjänsterna är redan svenska användarmeddelanden – aldrig stackspår. */
function userMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : "";
  return msg && msg.length < 300 ? msg : "Kunde inte spara ändringen.";
}

/**
 * Tillämpa en omgång i seq-ordning. Avvisade/konflikter stoppar inte de andra
 * – klienten har redan hållit tillbaka det som beror på dem.
 */
export async function applyOfflineBatch(raw: unknown, actor: CollaborationActor): Promise<WireResult[]> {
  if (!Array.isArray(raw)) throw new Error("bad_request");
  if (raw.length > MAX_BATCH) throw new Error("bad_request");
  const ordered = [...raw].sort((a, b) => (num(isRecord(a) ? a.seq : 0) ?? 0) - (num(isRecord(b) ? b.seq : 0) ?? 0));
  const results: WireResult[] = [];
  for (const item of ordered) {
    const id = isRecord(item) ? str(item.id, 128) : undefined;
    if (!id || id.length < 8) {
      results.push({ id: id ?? "", outcome: "rejected", message: "Ärendet saknar giltig nyckel." });
      continue;
    }
    const wire = item as WireMutation;
    const prior = await findOfflineReceipt(actor.businessId, id);
    if (prior) {
      results.push({ id, outcome: prior.outcome, ref: prior.resultRef, message: prior.message, duplicate: true });
      continue;
    }
    const parsed = parseWireMutation(wire);
    const clientCreatedAt = typeof wire.createdAt === "string" && !Number.isNaN(Date.parse(wire.createdAt)) ? wire.createdAt : new Date().toISOString();
    const base: Omit<OfflineMutationReceipt, "outcome" | "kind"> = {
      id: uid(),
      businessId: actor.businessId,
      userId: actor.userId,
      idempotencyKey: id,
      clientCreatedAt,
      appliedAt: new Date().toISOString(),
    };
    if (!parsed.ok) {
      const rec = await insertOfflineReceipt({ ...base, kind: String(wire.kind ?? "okänd").slice(0, 64), outcome: "rejected", message: parsed.message });
      results.push({ id, outcome: rec.outcome, message: rec.message, duplicate: rec.id !== base.id });
      continue;
    }
    if (!can(actor.role, CAPABILITY_BY_KIND[parsed.kind])) {
      const rec = await insertOfflineReceipt({ ...base, kind: parsed.kind, outcome: "rejected", message: "Din roll får inte göra den här ändringen." });
      results.push({ id, outcome: rec.outcome, message: rec.message, duplicate: rec.id !== base.id });
      continue;
    }
    let applied: ApplyOutcome;
    try {
      applied = await applyOne(parsed.kind, parsed.payload, typeof wire.entityVersion === "string" ? wire.entityVersion : undefined);
    } catch (e) {
      applied = { outcome: "failed", message: userMessage(e) };
    }
    const rec = await insertOfflineReceipt({
      ...base,
      kind: parsed.kind,
      outcome: applied.outcome,
      ...(applied.outcome === "synced" && applied.ref ? { resultRef: applied.ref } : {}),
      ...(applied.outcome !== "synced" ? { message: applied.message } : {}),
    });
    results.push({ id, outcome: rec.outcome, ref: rec.resultRef, message: rec.message, duplicate: rec.id !== base.id });
  }
  return results;
}
