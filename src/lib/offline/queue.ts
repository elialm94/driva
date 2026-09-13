/**
 * Offline-köns rena logik (spec §9). Ingen IndexedDB, ingen fetch – bara
 * beslut som går att testa: ordning, beroenden, backoff, tenantbindning och
 * vad ett serverutfall gör med ett ärende. Klientadaptern (client.ts) och
 * fältläget kallar hit; servern (server.ts) delar typerna.
 */
import type {
  CachedJob,
  JobRef,
  OfflineBinding,
  OfflineMutation,
  OfflineMutationKind,
  OfflineMutationStatus,
  WireMutation,
  WireResult,
} from "./types";

/** Backoff: 2 s, 4 s, 8 s … tak 5 min. `jitter` ∈ [0,1) ger ±20 %. */
export function backoffMs(attempts: number, jitter = 0.5): number {
  const base = Math.min(2_000 * 2 ** Math.max(0, attempts - 1), 300_000);
  const spread = base * 0.2;
  return Math.round(base - spread + spread * 2 * jitter);
}

/** Efter så många misslyckade nätförsök parkeras ärendet som `failed` (manuell retry). */
export const MAX_AUTO_ATTEMPTS = 8;

const TERMINAL: ReadonlySet<OfflineMutationStatus> = new Set(["synced", "conflict", "rejected", "failed"]);

export function isTerminal(status: OfflineMutationStatus): boolean {
  return TERMINAL.has(status);
}

/** Lokalt utkast-id som ärendet skapar (kund- och uppdragsutkast). */
export function producedLocalId(m: OfflineMutation): string | null {
  if (m.kind === "customer_draft" || m.kind === "job_draft") {
    const p = m.payload as { localId?: string };
    return p.localId ?? null;
  }
  return null;
}

/** Lokala utkast-id:n ärendet refererar (måste vara synkade först). */
export function requiredLocalIds(m: OfflineMutation): string[] {
  const out: string[] = [];
  const p = m.payload as { job?: JobRef; customer?: { id: string } | { localId: string } };
  if (p.job && "localId" in p.job) out.push(p.job.localId);
  if (p.customer && "localId" in p.customer) out.push(p.customer.localId);
  return out;
}

/**
 * Ett ärende som pekar på ett utkast som ännu inte synkats (eller som
 * fastnat) kan inte skickas. Returnerar det blockerande ärendet, annars null.
 */
export function blockingDependency(m: OfflineMutation, all: OfflineMutation[]): OfflineMutation | null {
  for (const localId of requiredLocalIds(m)) {
    const producer = all.find((x) => producedLocalId(x) === localId);
    if (!producer) continue;
    if (producer.status !== "synced") return producer;
  }
  return null;
}

/**
 * Nästa sändningsomgång: väntande ärenden i seq-ordning vars backoff löpt
 * ut och vars beroenden är synkade. Ett parkerat ärende (konflikt/avvisat/
 * misslyckat) blockerar bara det som beror på det – resten går vidare, så
 * ett stopp på ett foto inte håller tillbaka dagens arbetstid.
 */
export function nextBatch(all: OfflineMutation[], now: number, limit = 20): OfflineMutation[] {
  const sorted = [...all].sort((a, b) => a.seq - b.seq);
  const out: OfflineMutation[] = [];
  for (const m of sorted) {
    if (m.status !== "pending") continue;
    if (m.nextAttemptAt > now) continue;
    if (blockingDependency(m, sorted)) continue;
    out.push(m);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Ersätt lokala utkast-referenser med serverns id:n innan sändning. Kallas
 * per omgång; ett ärende vars producent inte är synkad kommer inte hit
 * (nextBatch filtrerar), men vi faller säkert om det ändå skulle hända.
 */
export function resolveLocalRefs(m: OfflineMutation, all: OfflineMutation[]): OfflineMutation {
  const p = { ...(m.payload as unknown as Record<string, unknown>) };
  const swap = (ref: unknown): unknown => {
    if (ref && typeof ref === "object" && "localId" in (ref as object)) {
      const localId = (ref as { localId: string }).localId;
      const producer = all.find((x) => producedLocalId(x) === localId && x.status === "synced" && x.serverRef);
      return producer ? { id: producer.serverRef } : ref;
    }
    return ref;
  };
  if ("job" in p) p.job = swap(p.job);
  if ("customer" in p) p.customer = swap(p.customer);
  return { ...m, payload: p } as unknown as OfflineMutation;
}

/** Trådformat: bara det servern behöver. */
export function toWire(m: OfflineMutation): WireMutation {
  return {
    id: m.id,
    seq: m.seq,
    createdAt: m.createdAt,
    kind: m.kind,
    payload: m.payload,
    ...(m.entityVersion ? { entityVersion: m.entityVersion } : {}),
  };
}

/** Tillämpa serverns svar på ett ärende. */
export function applyResult(m: OfflineMutation, r: WireResult): OfflineMutation {
  switch (r.outcome) {
    case "synced":
      return { ...m, status: "synced", serverRef: r.ref, lastError: undefined };
    case "conflict":
      return { ...m, status: "conflict", lastError: r.message ?? "Uppgifterna på servern har ändrats." };
    case "rejected":
      return { ...m, status: "rejected", lastError: r.message ?? "Servern avvisade ändringen." };
    case "failed":
      return { ...m, status: "failed", lastError: r.message ?? "Kunde inte spara." };
  }
}

/**
 * Nätfel / 5xx: räkna upp försök och sätt backoff. Efter MAX_AUTO_ATTEMPTS
 * parkeras ärendet som `failed` så användaren ser det i konfliktvyn i stället
 * för att kön tyst snurrar.
 */
export function applyTransportFailure(m: OfflineMutation, now: number, message: string, jitter = 0.5): OfflineMutation {
  const attempts = m.attempts + 1;
  if (attempts >= MAX_AUTO_ATTEMPTS) {
    return { ...m, status: "failed", attempts, lastError: `${message} (${attempts} försök)` };
  }
  return { ...m, status: "pending", attempts, nextAttemptAt: now + backoffMs(attempts, jitter), lastError: message };
}

/** Manuell "Försök igen" från konfliktvyn: tillbaka i kön utan backoff. */
export function retryNow(m: OfflineMutation, now: number): OfflineMutation {
  if (m.status === "synced") return m;
  return { ...m, status: "pending", attempts: 0, nextAttemptAt: now, lastError: undefined };
}

/** Sammanfattning för statuspillen. */
export interface QueueSummary {
  pending: number;
  syncing: number;
  synced: number;
  parked: number;
}

export function summarize(all: OfflineMutation[]): QueueSummary {
  const s: QueueSummary = { pending: 0, syncing: 0, synced: 0, parked: 0 };
  for (const m of all) {
    if (m.status === "pending" || m.status === "blocked") s.pending += 1;
    else if (m.status === "syncing") s.syncing += 1;
    else if (m.status === "synced") s.synced += 1;
    else s.parked += 1;
  }
  return s;
}

/**
 * Tenantbindning: kön hör till exakt ett (företag, användare). Allt annat →
 * rensa. Ingen bindning ännu → bind. `null` current = utloggad → rensa.
 */
export type BindingDecision = "bind" | "keep" | "wipe";

export function bindingDecision(
  stored: OfflineBinding | null,
  current: { businessId: string; userId: string } | null
): BindingDecision {
  if (!current) return stored ? "wipe" : "keep";
  if (!stored) return "bind";
  return stored.businessId === current.businessId && stored.userId === current.userId ? "keep" : "wipe";
}

/** Dataminimering: det här är ALLT om ett uppdrag som får ligga i enheten. */
export function minimizeJob(
  job: { id: string; title: string; status: CachedJob["status"]; address?: string },
  customerName: string,
  now: string
): CachedJob {
  return {
    id: job.id,
    title: job.title,
    customerName,
    status: job.status,
    ...(job.address ? { address: job.address } : {}),
    cachedAt: now,
  };
}

/** Kapabilitet servern kräver per ärendetyp – samma som motsvarande formulär. */
export const CAPABILITY_BY_KIND: Record<OfflineMutationKind, "change_jobs" | "manage_customers" | "write_accounting"> = {
  work_time: "change_jobs",
  work_note: "change_jobs",
  job_photo: "change_jobs",
  material: "change_jobs",
  job_draft: "change_jobs",
  customer_draft: "manage_customers",
  receipt: "write_accounting",
};

export const KIND_LABEL: Record<OfflineMutationKind, string> = {
  work_time: "Arbetstid",
  work_note: "Anteckning",
  job_photo: "Foto",
  receipt: "Kvitto",
  material: "Material",
  customer_draft: "Ny kund",
  job_draft: "Nytt uppdrag",
};

/** Hela kön får aldrig växa obegränsat – äldst synkade rensas först. */
export function pruneSynced(all: OfflineMutation[], keep = 200): OfflineMutation[] {
  const synced = all.filter((m) => m.status === "synced").sort((a, b) => a.seq - b.seq);
  if (synced.length <= keep) return all;
  const drop = new Set(synced.slice(0, synced.length - keep).map((m) => m.id));
  // Producenter som andra ärenden fortfarande refererar behålls.
  for (const m of all) {
    if (drop.has(m.id) && all.some((x) => !drop.has(x.id) && requiredLocalIds(x).includes(producedLocalId(m) ?? ""))) {
      drop.delete(m.id);
    }
  }
  return all.filter((m) => !drop.has(m.id));
}
