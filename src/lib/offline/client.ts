/**
 * Offline-köns klientadapter: bindning, köa, synka, rensa. Ren logik ligger i
 * queue.ts; lagring i idb.ts. Det här är limmet fältläget och statuspillen
 * pratar med. Endast webbläsare.
 */
import {
  deleteBlobs,
  deleteMutations,
  getBlob,
  listStoredMutations,
  putBlob,
  putMutations,
  readActiveTimer,
  readBinding,
  readCachedJobs,
  wipeOfflineDatabase,
  writeActiveTimer,
  writeBinding,
  writeCachedJobs,
  type ActiveTimer,
} from "./idb";
import {
  applyResult,
  applyTransportFailure,
  bindingDecision,
  nextBatch,
  pruneSynced,
  resolveLocalRefs,
  retryNow,
  summarize,
  toWire,
  type QueueSummary,
} from "./queue";
import type {
  CachedJob,
  OfflineMutation,
  OfflineMutationKind,
  OfflinePayloadByKind,
  SyncErrorResponse,
  SyncResponse,
  WireMutation,
} from "./types";

export const SYNC_ENDPOINT = "/api/offline/sync";

const KNOWN_ERROR_CODES: ReadonlySet<SyncErrorResponse["code"]> = new Set([
  "signed_out",
  "forbidden",
  "read_only",
  "bad_request",
  "server_error",
]);

type Listener = () => void;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

/** Prenumerera på ändringar i kön (statuspill, fältläge). */
export function subscribeOffline(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

/* ------------------------------ Bindning ------------------------------ */

/**
 * Bind enheten till (företag, användare) eller rensa om den var bunden till
 * något annat. Kallas från appskalet varje sidladdning och från fältläget.
 */
export async function ensureBinding(current: { businessId: string; userId: string } | null): Promise<"bind" | "keep" | "wipe"> {
  let stored = null;
  try {
    stored = await readBinding();
  } catch {
    return "keep";
  }
  const decision = bindingDecision(stored, current);
  if (decision === "wipe") await wipeOfflineStore();
  if (decision === "bind" && current) {
    await writeBinding({ ...current, boundAt: new Date().toISOString() });
  }
  return decision;
}

export async function wipeOfflineStore(): Promise<void> {
  await wipeOfflineDatabase();
  emit();
}

/* ------------------------------ Uppdrag ------------------------------ */

export async function cachedJobs(): Promise<CachedJob[]> {
  try {
    return await readCachedJobs();
  } catch {
    return [];
  }
}

export async function setCachedJobs(jobs: CachedJob[]): Promise<void> {
  await writeCachedJobs(jobs);
  emit();
}

export const activeTimer = readActiveTimer;
export async function setActiveTimer(t: ActiveTimer | null): Promise<void> {
  await writeActiveTimer(t);
  emit();
}

/* ------------------------------ Kö ------------------------------ */

export async function listMutations(): Promise<OfflineMutation[]> {
  try {
    return await listStoredMutations();
  } catch {
    return [];
  }
}

export async function queueSummary(): Promise<QueueSummary> {
  return summarize(await listMutations());
}

export interface EnqueueOptions {
  entityVersion?: string;
  /** Fil som ska följa med (foto/kvitto). Lagras krypterat, skickas som base64. */
  blob?: Blob;
}

export async function enqueue<K extends OfflineMutationKind>(
  kind: K,
  payload: OfflinePayloadByKind[K],
  opts: EnqueueOptions = {}
): Promise<OfflineMutation<K>> {
  const binding = await readBinding();
  if (!binding) throw new Error("Fältläget är inte kopplat till ett företag. Öppna Fältläge med nät en gång först.");
  const all = await listStoredMutations();
  const seq = all.length ? Math.max(...all.map((m) => m.seq)) + 1 : 1;
  let finalPayload = payload;
  if (opts.blob) {
    const blobRef = `blob-${newId()}`;
    await putBlob(blobRef, opts.blob);
    finalPayload = { ...payload, blobRef } as OfflinePayloadByKind[K];
  }
  const m: OfflineMutation<K> = {
    id: newId(),
    businessId: binding.businessId,
    userId: binding.userId,
    seq,
    createdAt: new Date().toISOString(),
    kind,
    payload: finalPayload,
    ...(opts.entityVersion ? { entityVersion: opts.entityVersion } : {}),
    status: "pending",
    attempts: 0,
    nextAttemptAt: 0,
  };
  await putMutations([m]);
  emit();
  return m;
}

export async function retryMutation(id: string): Promise<void> {
  const all = await listStoredMutations();
  const m = all.find((x) => x.id === id);
  if (!m) return;
  await putMutations([retryNow(m, Date.now())]);
  emit();
}

export async function discardMutation(id: string): Promise<void> {
  const all = await listStoredMutations();
  const m = all.find((x) => x.id === id);
  if (!m) return;
  const blobRef = (m.payload as { blobRef?: string }).blobRef;
  await deleteMutations([id]);
  if (blobRef) await deleteBlobs([blobRef]);
  emit();
}

/* ------------------------------ Synk ------------------------------ */

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("Kunde inte läsa filen"));
    r.readAsDataURL(blob);
  });
}

/** Byt blobRef mot inlinad data för tråden. Saknad blob → ärendet avvisas lokalt. */
async function inlineBlob(m: OfflineMutation): Promise<WireMutation | { error: string }> {
  const p = m.payload as { blobRef?: string };
  if (!p.blobRef) return toWire(m);
  const blob = await getBlob(p.blobRef);
  if (!blob) return { error: "Filen saknas på enheten." };
  const dataUrl = await blobToDataUrl(blob);
  const wire = toWire(m);
  if (m.kind === "job_photo") {
    return { ...wire, payload: { ...(wire.payload as object), blobRef: undefined, dataUrl } };
  }
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return { ...wire, payload: { ...(wire.payload as object), blobRef: undefined, contentBase64: base64, contentType: blob.type || (p as { contentType?: string }).contentType } };
}

export type SyncOutcome =
  | { kind: "idle" }
  | { kind: "synced"; sent: number; summary: QueueSummary }
  | { kind: "offline" }
  | { kind: "blocked"; code: SyncErrorResponse["code"]; message: string }
  | { kind: "wiped"; message: string };

let inFlight: Promise<SyncOutcome> | null = null;

/** Kör en synkomgång. Single-flight: parallella anrop får samma promise. */
export function syncNow(fetchImpl: typeof fetch = fetch): Promise<SyncOutcome> {
  if (inFlight) return inFlight;
  inFlight = runSync(fetchImpl).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runSync(fetchImpl: typeof fetch): Promise<SyncOutcome> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { kind: "offline" };
  let all = await listMutations();
  const now = Date.now();
  const batch = nextBatch(all, now);
  if (!batch.length) return { kind: "idle" };

  const wires: WireMutation[] = [];
  const marks: OfflineMutation[] = [];
  for (const m of batch) {
    const resolved = resolveLocalRefs(m, all);
    const wire = await inlineBlob(resolved);
    if ("error" in wire) {
      marks.push({ ...m, status: "failed", lastError: wire.error });
      continue;
    }
    wires.push(wire);
    marks.push({ ...m, status: "syncing" });
  }
  await putMutations(marks);
  emit();
  if (!wires.length) return { kind: "synced", sent: 0, summary: summarize(await listMutations()) };

  let response: Response;
  try {
    response = await fetchImpl(SYNC_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mutations: wires }),
      credentials: "same-origin",
    });
  } catch {
    await putMutations(batch.filter((m) => wires.some((w) => w.id === m.id)).map((m) => applyTransportFailure(m, Date.now(), "Ingen kontakt med servern.", Math.random())));
    emit();
    return { kind: "offline" };
  }

  let body: SyncResponse | SyncErrorResponse | null = null;
  try {
    body = (await response.json()) as SyncResponse | SyncErrorResponse;
  } catch {
    body = null;
  }

  const sent = batch.filter((m) => wires.some((w) => w.id === m.id));
  if (!body || !body.ok) {
    const rawCode = body && !body.ok ? body.code : undefined;
    const code: SyncErrorResponse["code"] = rawCode && KNOWN_ERROR_CODES.has(rawCode) ? rawCode : "server_error";
    const message = (body && !body.ok && body.message) || "Servern svarade inte som väntat.";
    if (code === "signed_out" || code === "forbidden") {
      await wipeOfflineStore();
      return { kind: "wiped", message };
    }
    // read_only / bad_request / 5xx: tillbaka till kön; 5xx med backoff.
    const back = code === "server_error";
    await putMutations(
      sent.map((m) => (back ? applyTransportFailure(m, Date.now(), message, Math.random()) : { ...m, status: "pending" as const, lastError: message }))
    );
    emit();
    return { kind: "blocked", code, message };
  }

  const byId = new Map(body.results.map((r) => [r.id, r]));
  const updated = sent.map((m) => {
    const r = byId.get(m.id);
    return r ? applyResult(m, r) : applyTransportFailure(m, Date.now(), "Servern svarade inte på ärendet.", Math.random());
  });
  await putMutations(updated);
  // Synkade blobbar behöver inte ligga kvar.
  const doneRefs = updated
    .filter((m) => m.status === "synced")
    .map((m) => (m.payload as { blobRef?: string }).blobRef)
    .filter((x): x is string => !!x);
  await deleteBlobs(doneRefs);

  all = pruneSynced(await listMutations());
  const keep = new Set(all.map((m) => m.id));
  const drop = (await listMutations()).filter((m) => !keep.has(m.id)).map((m) => m.id);
  await deleteMutations(drop);
  emit();
  return { kind: "synced", sent: wires.length, summary: summarize(all) };
}
