/**
 * Delad testdatabas: PGlite (Postgres/WASM) med Supabase-shims och samtliga
 * migrationer applicerade. Används av db-validate (SQL-invarianter) och
 * adapter-validate (hela persistenslagret) – ingen Docker krävs.
 *
 * Shimmar ENDAST det Supabase-plattformen äger i en riktig stack:
 * rollerna anon/authenticated/service_role, auth-schemat (users + uid())
 * och storage-schemat (buckets/objects).
 */
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

export async function createMigratedPglite(): Promise<{ db: PGlite; migrationFiles: string[] }> {
  const db = await PGlite.create({ extensions: { pg_trgm, pgcrypto } });

  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;

    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text
    );
    -- Speglar Supabase: auth.uid() läser sub-claimen ur JWT:n.
    create or replace function auth.uid() returns uuid
      language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

    create schema storage;
    create table storage.buckets (
      id text primary key,
      name text not null,
      public boolean not null default false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text references storage.buckets (id),
      name text,
      owner uuid,
      created_at timestamptz default now()
    );
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated;
    grant select, insert, update, delete on storage.objects to authenticated;
    grant select on storage.buckets to anon, authenticated;
  `);

  const migrationFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (migrationFiles.length === 0) {
    throw new Error(`Inga migrationsfiler i ${MIGRATIONS_DIR}`);
  }
  for (const file of migrationFiles) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql);
    } catch (e) {
      throw new Error(`Migration ${file} misslyckades: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Samma tidszonsdisciplin som produktionens anslutning (UTC) – annars
  // tolkas date-semantiska strängar i värdmaskinens tidszon.
  await db.exec(`set time zone 'UTC'`);

  return { db, migrationFiles };
}
