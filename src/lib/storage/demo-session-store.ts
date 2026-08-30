/**
 * Isolerad butik för den publika demon i produktion.
 *
 * Varje besökare får en egen rad i public.demo_sessions (jsonb = samma
 * seedade Södermalms-tillstånd som JSON-demon). Ingen Supabase-auth, inga
 * skrivningar mot riktiga företag. Tester använder en minneskarta.
 */
import type { DB } from "../types";
import { freshDemoDb } from "../store";
import { isSupabaseMode } from "./config";
import { sqlClient } from "./adapter-supabase";
import type { SqlClient } from "./executor";

const memory = new Map<string, { store: DB; expiresAt: number }>();
let tableReady = false;

function useMemoryBackend(): boolean {
  return process.env.DRIVA_TEST === "1" || !isSupabaseMode();
}

export async function ensureDemoSessionsTable(client?: SqlClient): Promise<void> {
  if (useMemoryBackend() || tableReady) return;
  const db = client ?? (await sqlClient());
  await db.query(
    `create table if not exists public.demo_sessions (
      id text primary key,
      store jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      expires_at timestamptz not null
    )`
  );
  await db.query(`create index if not exists demo_sessions_expires_idx on public.demo_sessions (expires_at)`);
  await db.query(`alter table public.demo_sessions enable row level security`);
  tableReady = true;
}

function cloneDb(store: DB): DB {
  return structuredClone(store);
}

export async function createDemoSessionStore(id: string, expiresAtMs: number): Promise<DB> {
  const store = freshDemoDb();
  if (useMemoryBackend()) {
    memory.set(id, { store: cloneDb(store), expiresAt: expiresAtMs });
    return cloneDb(store);
  }
  await ensureDemoSessionsTable();
  await pruneExpiredDemoSessions();
  const client = await sqlClient();
  await client.query(
    `insert into public.demo_sessions (id, store, expires_at)
     values ($1, $2::jsonb, $3::timestamptz)
     on conflict (id) do update
       set store = excluded.store,
           updated_at = now(),
           expires_at = excluded.expires_at`,
    [id, JSON.stringify(store), new Date(expiresAtMs).toISOString()]
  );
  return store;
}

export async function loadDemoSessionStore(id: string): Promise<DB | null> {
  if (useMemoryBackend()) {
    const row = memory.get(id);
    if (!row || row.expiresAt <= Date.now()) {
      if (row) memory.delete(id);
      return null;
    }
    return cloneDb(row.store);
  }
  await ensureDemoSessionsTable();
  const client = await sqlClient();
  const rows = await client.query(
    `select store from public.demo_sessions where id = $1 and expires_at > now()`,
    [id]
  );
  const raw = rows[0]?.store;
  if (!raw) return null;
  if (typeof raw === "string") return JSON.parse(raw) as DB;
  return raw as DB;
}

export async function saveDemoSessionStore(id: string, store: DB): Promise<void> {
  if (useMemoryBackend()) {
    const row = memory.get(id);
    if (!row) {
      memory.set(id, { store: cloneDb(store), expiresAt: Date.now() + 8 * 3600_000 });
      return;
    }
    row.store = cloneDb(store);
    return;
  }
  const client = await sqlClient();
  await client.query(
    `update public.demo_sessions
        set store = $2::jsonb, updated_at = now()
      where id = $1 and expires_at > now()`,
    [id, JSON.stringify(store)]
  );
}

export async function resetDemoSessionStore(id: string): Promise<DB> {
  const store = freshDemoDb();
  await saveDemoSessionStore(id, store);
  return store;
}

export async function deleteDemoSessionStore(id: string): Promise<void> {
  if (useMemoryBackend()) {
    memory.delete(id);
    return;
  }
  try {
    const client = await sqlClient();
    await client.query(`delete from public.demo_sessions where id = $1`, [id]);
  } catch {
    // Avslut ska inte fastna på en städmiss.
  }
}

export async function pruneExpiredDemoSessions(): Promise<void> {
  if (useMemoryBackend()) {
    const now = Date.now();
    for (const [key, row] of memory) {
      if (row.expiresAt <= now) memory.delete(key);
    }
    return;
  }
  try {
    const client = await sqlClient();
    await client.query(`delete from public.demo_sessions where expires_at <= now()`);
  } catch {
    // Städning är bäst-ansträngning.
  }
}

export function __resetDemoSessionStoreForTests(): void {
  memory.clear();
}
