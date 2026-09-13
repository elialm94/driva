/**
 * Klientens lokala lager för offline-fältläget: IndexedDB + WebCrypto.
 *
 * Vad som ligger här: kön (payload krypterad), blobbar (foton/kvitton,
 * krypterade), en minimerad uppdragslista och tenantbindningen. Nyckeln är
 * en icke-exporterbar AES-GCM-nyckel som själv lagras i IndexedDB – den kan
 * användas av ursprunget men aldrig läsas ut som bytes. Saknar plattformen
 * WebCrypto (osäker kontext) lagras posterna okrypterade med flaggan `plain`
 * så att det syns i systemvyn i stället för att fältläget tyst slutar fungera.
 *
 * Endast webbläsare. Ingen import från server-kod.
 */
import type { CachedJob, OfflineBinding, OfflineMutation } from "./types";

export const OFFLINE_DB_NAME = "ferva-offline";
const DB_VERSION = 1;

type StoredMutation = Omit<OfflineMutation, "payload"> & {
  enc?: ArrayBuffer;
  iv?: ArrayBuffer;
  plain?: unknown;
};

interface StoredBlob {
  ref: string;
  type: string;
  enc?: ArrayBuffer;
  iv?: ArrayBuffer;
  plain?: ArrayBuffer;
}

export interface ActiveTimer {
  jobId: string;
  startedAt: string;
}

function hasIdb(): boolean {
  return typeof indexedDB !== "undefined";
}

function hasSubtle(): boolean {
  return typeof crypto !== "undefined" && !!crypto.subtle && typeof crypto.subtle.encrypt === "function";
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB-fel"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB-fel"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB avbröts"));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!hasIdb()) return Promise.reject(new Error("IndexedDB saknas"));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const open = indexedDB.open(OFFLINE_DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      if (!db.objectStoreNames.contains("mutations")) {
        const s = db.createObjectStore("mutations", { keyPath: "id" });
        s.createIndex("seq", "seq", { unique: false });
      }
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs", { keyPath: "ref" });
    };
    open.onsuccess = () => {
      open.result.onversionchange = () => {
        open.result.close();
        dbPromise = null;
      };
      resolve(open.result);
    };
    open.onerror = () => reject(open.error ?? new Error("Kunde inte öppna offline-lagret"));
    open.onblocked = () => reject(new Error("Offline-lagret är låst av en annan flik"));
  });
  return dbPromise;
}

/* ------------------------------ Kryptering ------------------------------ */

let keyPromise: Promise<CryptoKey | null> | null = null;

async function cryptoKey(): Promise<CryptoKey | null> {
  if (!hasSubtle()) return null;
  if (keyPromise) return keyPromise;
  keyPromise = (async () => {
    const db = await openDb();
    const existing = await req(db.transaction("meta").objectStore("meta").get("cryptoKey"));
    if (existing) return existing as CryptoKey;
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const tx = db.transaction("meta", "readwrite");
    tx.objectStore("meta").put(key, "cryptoKey");
    await done(tx);
    return key;
  })();
  return keyPromise;
}

async function encrypt(bytes: ArrayBuffer): Promise<{ enc: ArrayBuffer; iv: ArrayBuffer } | null> {
  const key = await cryptoKey();
  if (!key) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  return { enc, iv: iv.buffer };
}

async function decrypt(enc: ArrayBuffer, iv: ArrayBuffer): Promise<ArrayBuffer> {
  const key = await cryptoKey();
  if (!key) throw new Error("Krypteringsnyckeln saknas");
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(iv) }, key, enc);
}

const te = new TextEncoder();
const td = new TextDecoder();

/** Krypteras posterna på den här enheten? (Statuspill/systemvy.) */
export function offlineEncryptionAvailable(): boolean {
  return hasSubtle();
}

/* ------------------------------ Meta ------------------------------ */

async function metaGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  const v = await req(db.transaction("meta").objectStore("meta").get(key));
  return (v as T | undefined) ?? null;
}

async function metaPut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").put(value, key);
  await done(tx);
}

export const readBinding = () => metaGet<OfflineBinding>("binding");
export const writeBinding = (b: OfflineBinding) => metaPut("binding", b);
export const readCachedJobs = async () => (await metaGet<CachedJob[]>("jobs")) ?? [];
export const writeCachedJobs = (jobs: CachedJob[]) => metaPut("jobs", jobs);
export const readActiveTimer = () => metaGet<ActiveTimer>("timer");
export const writeActiveTimer = (t: ActiveTimer | null) => metaPut("timer", t);

/* ------------------------------ Mutationer ------------------------------ */

async function toStored(m: OfflineMutation): Promise<StoredMutation> {
  const { payload, ...rest } = m;
  const bytes = te.encode(JSON.stringify(payload)).buffer as ArrayBuffer;
  const e = await encrypt(bytes);
  return e ? { ...rest, enc: e.enc, iv: e.iv } : { ...rest, plain: payload };
}

async function fromStored(s: StoredMutation): Promise<OfflineMutation> {
  const { enc, iv, plain, ...rest } = s;
  if (enc && iv) {
    const bytes = await decrypt(enc, iv);
    return { ...rest, payload: JSON.parse(td.decode(bytes)) } as OfflineMutation;
  }
  return { ...rest, payload: plain } as OfflineMutation;
}

export async function listStoredMutations(): Promise<OfflineMutation[]> {
  const db = await openDb();
  const rows = (await req(db.transaction("mutations").objectStore("mutations").getAll())) as StoredMutation[];
  const out: OfflineMutation[] = [];
  for (const r of rows) {
    try {
      out.push(await fromStored(r));
    } catch {
      // Odekrypterbar post (nyckel borta) – bättre att tappa raden än att låsa kön.
    }
  }
  return out.sort((a, b) => a.seq - b.seq);
}

export async function putMutations(ms: OfflineMutation[]): Promise<void> {
  if (!ms.length) return;
  const stored = await Promise.all(ms.map(toStored));
  const db = await openDb();
  const tx = db.transaction("mutations", "readwrite");
  for (const s of stored) tx.objectStore("mutations").put(s);
  await done(tx);
}

export async function deleteMutations(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await openDb();
  const tx = db.transaction("mutations", "readwrite");
  for (const id of ids) tx.objectStore("mutations").delete(id);
  await done(tx);
}

/* ------------------------------ Blobbar ------------------------------ */

export async function putBlob(ref: string, blob: Blob): Promise<void> {
  const bytes = await blob.arrayBuffer();
  const e = await encrypt(bytes);
  const row: StoredBlob = e ? { ref, type: blob.type, enc: e.enc, iv: e.iv } : { ref, type: blob.type, plain: bytes };
  const db = await openDb();
  const tx = db.transaction("blobs", "readwrite");
  tx.objectStore("blobs").put(row);
  await done(tx);
}

export async function getBlob(ref: string): Promise<Blob | null> {
  const db = await openDb();
  const row = (await req(db.transaction("blobs").objectStore("blobs").get(ref))) as StoredBlob | undefined;
  if (!row) return null;
  const bytes = row.enc && row.iv ? await decrypt(row.enc, row.iv) : row.plain;
  if (!bytes) return null;
  return new Blob([bytes], { type: row.type });
}

export async function deleteBlobs(refs: string[]): Promise<void> {
  if (!refs.length) return;
  const db = await openDb();
  const tx = db.transaction("blobs", "readwrite");
  for (const ref of refs) tx.objectStore("blobs").delete(ref);
  await done(tx);
}

/* ------------------------------ Rensning ------------------------------ */

/**
 * Radera ALLT lokalt offlineinnehåll, inklusive krypteringsnyckeln. Kallas
 * vid utloggning, tenantbyte och när servern svarar 401/403.
 */
export async function wipeOfflineDatabase(): Promise<void> {
  if (!hasIdb()) return;
  if (dbPromise) {
    try {
      (await dbPromise).close();
    } catch {
      /* redan stängd */
    }
    dbPromise = null;
  }
  keyPromise = null;
  await new Promise<void>((resolve) => {
    const del = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
    del.onsuccess = () => resolve();
    del.onerror = () => resolve();
    del.onblocked = () => resolve();
  });
}
