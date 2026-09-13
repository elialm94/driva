/**
 * Offline-fältläge V1 (spec §9) – gemensamma typer för klientkö och server.
 *
 * Grundregel: klienten är ALDRIG sanningskälla. Kön är en lista av avsikter
 * ("jag jobbade 2 timmar på uppdrag X") som servern validerar och tillämpar
 * via de vanliga tjänsterna, med samma auth/tenant/capability-kontroll som
 * ett vanligt formulär. Klienten sparar bara det som krävs för att kunna
 * skriva avsikterna: uppdragets id, titel och kundnamn.
 */

/** Vad som får göras offline. Allt annat kräver nät – inga undantag. */
export type OfflineMutationKind =
  | "work_time"
  | "work_note"
  | "job_photo"
  | "receipt"
  | "material"
  | "customer_draft"
  | "job_draft";

export const OFFLINE_MUTATION_KINDS: readonly OfflineMutationKind[] = [
  "work_time",
  "work_note",
  "job_photo",
  "receipt",
  "material",
  "customer_draft",
  "job_draft",
];

/** Referens till ett uppdrag: serverns id ELLER ett lokalt utkast-id i samma kö. */
export type JobRef = { id: string } | { localId: string };

export interface WorkTimePayload {
  job: JobRef;
  hours: number;
  description?: string;
  /** Utförandedag (YYYY-MM-DD). */
  date: string;
}

export interface WorkNotePayload {
  job: JobRef;
  text: string;
}

export interface JobPhotoPayload {
  job: JobRef;
  caption?: string;
  /** Nyckel i klientens blob-lager. På tråden ersätts den av dataUrl. */
  blobRef?: string;
  dataUrl?: string;
}

export interface ReceiptPayload {
  filename: string;
  contentType: string;
  blobRef?: string;
  contentBase64?: string;
  /** Fri anteckning ("Bauhaus, skruv till Andersson"). */
  note?: string;
}

export interface MaterialPayload {
  job: JobRef;
  description: string;
  qty: number;
  unit?: string;
  unitPrice: number;
}

export interface CustomerDraftPayload {
  localId: string;
  kind: "privat" | "foretag";
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  postalCode?: string;
  city?: string;
}

export interface JobDraftPayload {
  localId: string;
  customer: { id: string } | { localId: string };
  title: string;
  description?: string;
  startDate?: string;
}

export type OfflinePayloadByKind = {
  work_time: WorkTimePayload;
  work_note: WorkNotePayload;
  job_photo: JobPhotoPayload;
  receipt: ReceiptPayload;
  material: MaterialPayload;
  customer_draft: CustomerDraftPayload;
  job_draft: JobDraftPayload;
};

export type OfflineMutationStatus =
  | "pending"
  | "syncing"
  | "synced"
  | "conflict"
  | "failed"
  | "rejected"
  | "blocked";

/**
 * Ett köat ärende på klienten. `id` är idempotensnyckeln (uuid) – servern
 * svarar med samma utfall om nyckeln redan är tillämpad.
 */
export interface OfflineMutation<K extends OfflineMutationKind = OfflineMutationKind> {
  id: string;
  /** Företaget kön är bunden till. Ett annat företag i sessionen → kön rensas. */
  businessId: string;
  userId: string;
  /** Strikt ordning inom kön. */
  seq: number;
  createdAt: string;
  kind: K;
  payload: OfflinePayloadByKind[K];
  /** Uppdragets status när det cachades – konfliktdetektering på servern. */
  entityVersion?: string;
  status: OfflineMutationStatus;
  attempts: number;
  /** Tidigast nästa försök (epoch ms). */
  nextAttemptAt: number;
  lastError?: string;
  /** Serverns referens när den är synkad (nytt uppdrags-id, post-id …). */
  serverRef?: string;
}

/** Vad som skickas över tråden – ingen klientstatus, blobbar inlinade. */
export interface WireMutation {
  id: string;
  seq: number;
  createdAt: string;
  kind: OfflineMutationKind;
  payload: unknown;
  entityVersion?: string;
}

export type WireOutcome = "synced" | "conflict" | "failed" | "rejected";

export interface WireResult {
  id: string;
  outcome: WireOutcome;
  /** Referens till det som skapades (t.ex. nytt uppdrags-id). */
  ref?: string;
  /** Användarsäkert meddelande (svenska). Aldrig payload. */
  message?: string;
  /** Redan tillämpad vid ett tidigare försök – klienten ska bara markera synkad. */
  duplicate?: boolean;
}

export interface SyncResponse {
  ok: true;
  results: WireResult[];
  /** Serverns tid – klienten använder den för backoff-baslinje, inte för lokala klockor. */
  serverTime: string;
}

export interface SyncErrorResponse {
  ok: false;
  /** `signed_out` och `forbidden` → klienten rensar lokalt offlineinnehåll. */
  code: "signed_out" | "forbidden" | "read_only" | "bad_request" | "server_error";
  message: string;
}

/** Minimerad uppdragsbild som får ligga kvar i enheten. Inget mer. */
export interface CachedJob {
  id: string;
  title: string;
  customerName: string;
  status: "kommande" | "pagar" | "klart";
  /** Kort adress för orientering på plats. */
  address?: string;
  cachedAt: string;
}

/** Vem enheten är bunden till. Byte → allt lokalt raderas. */
export interface OfflineBinding {
  businessId: string;
  userId: string;
  boundAt: string;
}
