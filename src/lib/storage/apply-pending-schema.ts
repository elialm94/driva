/**
 * Applicerar schema som koden skriver mot när `supabase db push` inte körts.
 * Bara IF NOT EXISTS. Körs från /api/health och före tenant-skrivningar
 * (runWithTenant commit / createBusinessWithOwner) så att payer_*,
 * default_quote_terms och websites.footer finns innan upsert.
 */
import type { SqlClient, SqlExecutor } from "./executor";
import { allocateInboundMailSlugAsync, isLegacyHexInboundSlug } from "../inbox/inbound-slug";

let schemaEnsured = false;

/** Testkrok: nästa ensure kör apply igen (ny klient / annan databas). */
export function resetPendingSchemaGuard(): void {
  schemaEnsured = false;
}

/**
 * Idempotent: första skrivningen i processen lägger till saknade kolumner
 * (payer_*, footer, draft_design, …). Misslyckad apply cachas inte – nästa commit försöker igen.
 */
export async function ensurePendingSchema(client: SqlClient): Promise<void> {
  if (schemaEnsured) return;
  await applyPendingPageLoadSchema(client);
  schemaEnsured = true;
}

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

async function columnExists(client: SqlExecutor, table: string, column: string): Promise<boolean> {
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
  await ensureColumn(
    "businesses",
    "trial_started_at",
    `alter table public.businesses
       add column if not exists trial_started_at timestamptz,
       add column if not exists trial_ends_at timestamptz,
       add column if not exists subscription_status text`
  );

  await ensureColumn(
    "business_settings",
    "default_hourly_rate",
    `alter table public.business_settings add column if not exists default_hourly_rate integer`
  );
  await ensureColumn(
    "business_settings",
    "default_quote_terms",
    `alter table public.business_settings add column if not exists default_quote_terms text`
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
  await ensureColumn("websites", "footer", `alter table public.websites add column if not exists footer jsonb`);
  await ensureColumn(
    "websites",
    "draft_footer",
    `alter table public.websites add column if not exists draft_footer jsonb`
  );
  await ensureColumn(
    "websites",
    "privacy_policy_mode",
    `alter table public.websites add column if not exists privacy_policy_mode text`
  );
  await ensureColumn(
    "websites",
    "privacy_policy_custom_body",
    `alter table public.websites add column if not exists privacy_policy_custom_body jsonb`
  );
  await ensureColumn(
    "websites",
    "draft_privacy_policy",
    `alter table public.websites add column if not exists draft_privacy_policy jsonb`
  );
  await ensureColumn(
    "websites",
    "draft_revision",
    `alter table public.websites add column if not exists draft_revision integer not null default 0`
  );
  await ensureColumn(
    "websites",
    "published_revision",
    `alter table public.websites add column if not exists published_revision integer not null default 0`
  );
  await ensureColumn(
    "websites",
    "draft_sections",
    `alter table public.websites add column if not exists draft_sections jsonb`
  );
  await ensureColumn(
    "websites",
    "draft_primary_cta",
    `alter table public.websites add column if not exists draft_primary_cta jsonb`
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
    applied.push("payment_files");
  }

  // Oberoende av payment_files: settings-upserten skriver alltid dessa kolumner.
  // Tidigare låg DDL:en inne i `if (!payment_files)` – i produktion finns
  // tabellen redan, så payer_* saknades och varje "Spara ändringar" 500:ade.
  await ensureColumn(
    "business_settings",
    "payer_bank_name",
    `alter table public.business_settings add column if not exists payer_bank_name text`
  );
  await ensureColumn(
    "business_settings",
    "payer_iban",
    `alter table public.business_settings add column if not exists payer_iban text`
  );
  await ensureColumn(
    "business_settings",
    "payer_bic",
    `alter table public.business_settings add column if not exists payer_bic text`
  );

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

  const supportApplied = await ensurePlatformSupportSchema(client);
  applied.push(...supportApplied);

  const bankApplied = await ensureBankConnectionSchema(client);
  applied.push(...bankApplied);

  const acceptanceApplied = await ensureQuoteAcceptanceSchema(client);
  applied.push(...acceptanceApplied);

  const reminted = await remintHexInboundMailSlugs(client);
  if (reminted > 0) applied.push(`inbound_mail_slug.remint:${reminted}`);

  return applied;
}

/**
 * Engångs-remint: hex-sluggar (12 tecken a-f0-9) utan inbound-mejl får
 * en läsbar slug från business_settings.name. Har de redan mejl: lämna hex.
 */
export async function remintHexInboundMailSlugs(client: SqlExecutor): Promise<number> {
  if (!(await columnExists(client, "business_settings", "inbound_mail_slug"))) return 0;
  const inbox = await client.query(`select to_regclass('public.inbox_items') is not null as present`);
  const inboxPresent = Boolean(inbox[0]?.present);
  const mailFilter = inboxPresent
    ? `and not exists (
         select 1 from public.inbox_items i
          where i.business_id = s.business_id
            and (i.kind = 'mail' or i.source in ('email', 'vidarebefordrad'))
       )`
    : "";
  const rows = await client.query(
    `select s.business_id::text as business_id, coalesce(s.name, '') as name, s.inbound_mail_slug
       from public.business_settings s
      where s.inbound_mail_slug ~ '^[0-9a-f]{12}$'
        ${mailFilter}
      order by s.business_id`,
  );
  let updated = 0;
  for (const row of rows) {
    const current = String(row.inbound_mail_slug ?? "");
    if (!isLegacyHexInboundSlug(current)) continue;
    const next = await allocateInboundMailSlugAsync(String(row.name ?? ""), async (slug) => {
      const hit = await client.query(
        `select 1 from public.business_settings where inbound_mail_slug = $1 limit 1`,
        [slug],
      );
      return hit.length > 0;
    });
    if (next === current) continue;
    await client.query(`update public.business_settings set inbound_mail_slug = $2 where business_id = $1::uuid`, [
      String(row.business_id),
      next,
    ]);
    updated += 1;
  }
  return updated;
}

/**
 * Offertgodkännande (migration 28): signatures.method + nullable BankID-
 * kolumner. Utan detta 500:ar kundens "Godkänn offert" i en produktion där
 * `supabase db push` inte körts. Speglar migrationen exakt.
 */
export async function ensureQuoteAcceptanceSchema(client: SqlClient): Promise<string[]> {
  const applied: string[] = [];
  if (await columnExists(client, "signatures", "method")) return applied;
  await run(
    client,
    `alter table public.signatures add column if not exists method text not null default 'bankid_mock'`
  );
  await run(
    client,
    `alter table public.signatures
       alter column order_ref drop not null,
       alter column signer_personal_number_masked drop not null,
       alter column environment drop not null`
  );
  await run(client, `alter table public.signatures drop constraint if exists signatures_environment_check`);
  await run(
    client,
    `alter table public.signatures add constraint signatures_environment_check
       check (environment is null or environment in ('mock', 'production'))`
  );
  await run(client, `alter table public.signatures drop constraint if exists signatures_method_check`);
  await run(
    client,
    `alter table public.signatures add constraint signatures_method_check
       check (method in ('simple_accept', 'bankid_mock', 'bankid'))`
  );
  await run(
    client,
    `update public.signatures
        set method = case when environment = 'production' then 'bankid' else 'bankid_mock' end
      where method = 'bankid_mock'`
  );
  applied.push("signatures.method");
  return applied;
}

/**
 * Bankkoppling (migration 27): bank_connections + bank_accounts.external_id.
 * Skapas här med IF NOT EXISTS så att en produktion där `supabase db push`
 * inte körts ändå kan koppla banken. Speglar migrationen exakt – tokens är
 * server-only (policy enbart för driva_app).
 */
export async function ensureBankConnectionSchema(client: SqlClient): Promise<string[]> {
  const applied: string[] = [];
  if (!(await columnExists(client, "bank_accounts", "external_id"))) {
    await run(client, `alter table public.bank_accounts add column if not exists external_id text`);
    await run(
      client,
      `create unique index if not exists bank_accounts_external_id_uq
         on public.bank_accounts (business_id, external_id)
         where external_id is not null`
    );
    applied.push("bank_accounts.external_id");
  }
  const table = await client.query(`select to_regclass('public.bank_connections') is not null as present`);
  if (!table[0]?.present) {
    await run(
      client,
      `create table if not exists public.bank_connections (
        id text primary key,
        business_id uuid not null references public.businesses (id) on delete cascade,
        provider text not null check (provider in ('mock', 'tink')),
        status text not null check (status in ('disconnected', 'pending', 'connected', 'error', 'revoked')),
        external_user_id text,
        tink_user_id text,
        credentials_id text,
        access_token text,
        access_token_expires_at timestamptz,
        pending_state text,
        pending_state_expires_at timestamptz,
        bank_name text,
        masked_account text,
        last_sync_at timestamptz,
        last_error text,
        connected_at timestamptz,
        revoked_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`
    );
    await run(
      client,
      `create unique index if not exists bank_connections_business_uq on public.bank_connections (business_id)`
    );
    await run(client, `grant select, insert, update, delete on public.bank_connections to driva_app`);
    await run(client, `alter table public.bank_connections enable row level security`);
    await run(client, `drop policy if exists bank_connections_server on public.bank_connections`);
    await run(
      client,
      `create policy bank_connections_server on public.bank_connections
         for all to driva_app using (app.is_member(business_id)) with check (app.is_member(business_id))`
    );
    applied.push("bank_connections");
  }
  return applied;
}

/**
 * Kundens "Hjälp & support" skriver till support_tickets. Utan tabellen
 * (migrationen inte körd) blir formuläret ett generiskt fel. Skapas här
 * med IF NOT EXISTS så health/första ärendet räcker.
 */
export async function ensurePlatformSupportSchema(client: SqlClient): Promise<string[]> {
  const applied: string[] = [];
  const table = await client.query(`select to_regclass('public.support_tickets') is not null as present`);
  if (!table[0]?.present) {
    await run(
      client,
      `create table if not exists public.support_tickets (
        id text primary key,
        business_id uuid references public.businesses (id) on delete set null,
        user_id uuid,
        user_email text not null default '',
        user_name text not null default '',
        business_name text not null default '',
        subject text not null default '',
        message text not null default '',
        status text not null default 'open'
          check (status in ('open', 'in_progress', 'waiting_for_customer', 'resolved')),
        priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
        assigned_admin_id uuid,
        route text not null default '',
        user_agent text not null default '',
        app_version text not null default '',
        attachment_name text,
        attachment_data_url text,
        attachment_path text,
        environment text not null default '',
        admin_notes text not null default '',
        resolved_at timestamptz,
        resolved_by uuid,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`
    );
    await run(
      client,
      `create index if not exists support_tickets_status_idx
         on public.support_tickets (status, created_at desc)`
    );
    await run(
      client,
      `create index if not exists support_tickets_business_idx
         on public.support_tickets (business_id, created_at desc)`
    );
    await run(client, `grant select, insert, update on public.support_tickets to driva_app`);
    await run(client, `alter table public.support_tickets enable row level security`);
    await run(client, `drop policy if exists support_tickets_select on public.support_tickets`);
    await run(
      client,
      `create policy support_tickets_select on public.support_tickets
         for select to driva_app
         using (app.is_platform_context() or app.is_member(business_id))`
    );
    await run(client, `drop policy if exists support_tickets_insert on public.support_tickets`);
    await run(
      client,
      `create policy support_tickets_insert on public.support_tickets
         for insert to driva_app
         with check (app.is_platform_context() or app.is_member(business_id))`
    );
    await run(client, `drop policy if exists support_tickets_update on public.support_tickets`);
    await run(
      client,
      `create policy support_tickets_update on public.support_tickets
         for update to driva_app
         using (app.is_platform_context()) with check (app.is_platform_context())`
    );
    applied.push("support_tickets");
  }

  const extras: [string, string][] = [
    ["resolved_at", `alter table public.support_tickets add column if not exists resolved_at timestamptz`],
    ["resolved_by", `alter table public.support_tickets add column if not exists resolved_by uuid`],
    ["admin_notes", `alter table public.support_tickets add column if not exists admin_notes text not null default ''`],
    ["attachment_path", `alter table public.support_tickets add column if not exists attachment_path text`],
    ["environment", `alter table public.support_tickets add column if not exists environment text not null default ''`],
  ];
  for (const [column, ddl] of extras) {
    if (await columnExists(client, "support_tickets", column)) continue;
    await run(client, ddl);
    applied.push(`support_tickets.${column}`);
  }

  try {
    await client.query(
      `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
       values (
         'support_attachments',
         'support_attachments',
         false,
         10485760,
         array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
       )
       on conflict (id) do update
         set public = excluded.public,
             file_size_limit = excluded.file_size_limit,
             allowed_mime_types = excluded.allowed_mime_types`
    );
  } catch {
    // storage-schemat finns inte i alla miljöer (PGlite, lokal JSON-bro).
  }

  return applied;
}
