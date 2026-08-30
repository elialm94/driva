/**
 * Applicerar schema som koden skriver mot när `supabase db push` inte körts.
 * Bara IF NOT EXISTS. Körs från /api/health via Vercels databas-URL.
 */
import type { SqlClient } from "./executor";

function isBenignSchemaError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "42P07" || code === "42710" || code === "42701" || code === "42P16" || code === "42723";
}

async function run(client: SqlClient, sql: string): Promise<void> {
  try {
    await client.query(sql);
  } catch (err) {
    if (isBenignSchemaError(err)) return;
    throw err;
  }
}

async function columnExists(client: SqlClient, table: string, column: string): Promise<boolean> {
  const rows = await client.query(
    `select exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = $1 and column_name = $2
     ) as present`,
    [table, column]
  );
  return Boolean(rows[0]?.present);
}

export async function applyPendingPageLoadSchema(client: SqlClient): Promise<string[]> {
  const applied: string[] = [];

  async function ensureColumn(table: string, column: string, ddl: string): Promise<void> {
    if (await columnExists(client, table, column)) return;
    await run(client, ddl);
    applied.push(`${table}.${column}`);
  }

  await ensureColumn(
    "businesses",
    "is_demo",
    `alter table public.businesses add column if not exists is_demo boolean not null default false`
  );
  await ensureColumn(
    "businesses",
    "disabled_at",
    `alter table public.businesses add column if not exists disabled_at timestamptz`
  );

  await ensureColumn("websites", "design", `alter table public.websites add column if not exists design jsonb`);
  await ensureColumn(
    "websites",
    "draft_design",
    `alter table public.websites add column if not exists draft_design jsonb`
  );
  await ensureColumn(
    "websites",
    "privacy_policy_supplement",
    `alter table public.websites add column if not exists privacy_policy_supplement text`
  );

  await ensureColumn(
    "quotes",
    "work_location_id",
    `alter table public.quotes add column if not exists work_location_id text`
  );
  await ensureColumn(
    "invoices",
    "work_location_id",
    `alter table public.invoices add column if not exists work_location_id text`
  );
  await ensureColumn(
    "invoices",
    "payment_plan_index",
    `alter table public.invoices add column if not exists payment_plan_index integer`
  );
  await ensureColumn(
    "jobs",
    "archived_at",
    `alter table public.jobs add column if not exists archived_at timestamptz`
  );
  await ensureColumn(
    "invoice_line_items",
    "source_kind",
    `alter table public.invoice_line_items
       add column if not exists source_kind text,
       add column if not exists source_id text,
       add column if not exists source_quote_number integer,
       add column if not exists payment_plan_index integer`
  );

  const files = await client.query(`select to_regclass('public.payment_files') is not null as present`);
  if (!files[0]?.present) {
    await run(
      client,
      `create table if not exists public.payment_files (
        id text primary key,
        business_id uuid not null references public.businesses (id) on delete cascade,
        filename text not null,
        message_id text not null,
        format text not null check (format in ('ISO20022_PAIN001')),
        payment_ids jsonb not null default '[]'::jsonb,
        supplier_invoice_ids jsonb not null default '[]'::jsonb,
        total_amount bigint not null check (total_amount >= 1),
        currency text not null default 'SEK',
        xml text not null,
        status text not null check (status in ('CREATED', 'REPLACED', 'CANCELLED')),
        replaced_by_file_id text,
        created_at timestamptz not null default now(),
        created_by text not null default 'anvandare' check (created_by in ('anvandare', 'assistent'))
      )`
    );
    await run(
      client,
      `create unique index if not exists payment_files_message_id_uq on public.payment_files (business_id, message_id)`
    );
    await run(
      client,
      `create index if not exists payment_files_business_status_idx on public.payment_files (business_id, status, created_at)`
    );
    await run(client, `grant select, insert, update on public.payment_files to driva_app`);
    await run(client, `alter table public.payment_files enable row level security`);
    await run(client, `drop policy if exists payment_files_select on public.payment_files`);
    await run(
      client,
      `create policy payment_files_select on public.payment_files
         for select to driva_app, authenticated using (app.is_member(business_id))`
    );
    await run(client, `drop policy if exists payment_files_insert on public.payment_files`);
    await run(
      client,
      `create policy payment_files_insert on public.payment_files
         for insert to driva_app, authenticated with check (app.is_member(business_id))`
    );
    await run(client, `drop policy if exists payment_files_update on public.payment_files`);
    await run(
      client,
      `create policy payment_files_update on public.payment_files
         for update to driva_app, authenticated
         using (app.is_member(business_id)) with check (app.is_member(business_id))`
    );
    await run(client, `alter table public.supplier_payments drop constraint if exists supplier_payments_status_check`);
    await run(
      client,
      `alter table public.supplier_payments
         add constraint supplier_payments_status_check check (status in (
           'DRAFT', 'READY', 'PAYMENT_FILE_CREATED', 'SUBMITTED_TO_BANK',
           'AWAITING_APPROVAL', 'SCHEDULED', 'PAID', 'FAILED', 'CANCELLED'
         ))`
    );
    await run(
      client,
      `alter table public.supplier_payments
         add column if not exists payment_file_id text references public.payment_files (id)`
    );
    await run(client, `drop index if exists supplier_payments_active_invoice_uq`);
    await run(
      client,
      `create unique index supplier_payments_active_invoice_uq
         on public.supplier_payments (business_id, supplier_invoice_id)
         where status in (
           'DRAFT', 'READY', 'PAYMENT_FILE_CREATED', 'SUBMITTED_TO_BANK',
           'AWAITING_APPROVAL', 'SCHEDULED'
         )`
    );
    await run(
      client,
      `alter table public.inbox_items
         add column if not exists extraction jsonb,
         add column if not exists reviewed_at timestamptz`
    );
    await run(
      client,
      `alter table public.business_settings
         add column if not exists payer_bank_name text,
         add column if not exists payer_iban text,
         add column if not exists payer_bic text`
    );
    applied.push("payment_files");
  }

  await run(
    client,
    `alter table public.invoice_line_items drop constraint if exists invoice_line_items_kind_check`
  );
  await run(
    client,
    `alter table public.invoice_line_items
       add constraint invoice_line_items_kind_check
       check (kind in ('arbete', 'material', 'resor', 'ovrigt'))`
  );
  await run(client, `alter table public.job_work_entries drop constraint if exists job_work_entries_type_check`);
  await run(
    client,
    `alter table public.job_work_entries
       add constraint job_work_entries_type_check
       check (type in ('labor', 'material', 'travel', 'other'))`
  );

  return applied;
}
