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

  const wholesalerApplied = await ensureWholesalerSchema(client);
  applied.push(...wholesalerApplied);

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

/** Standardpolicyer (driva_app + authenticated, medlemskap) för en tenanttabell. */
async function ensureTenantPolicies(
  client: SqlClient,
  table: string,
  ops: Array<"select" | "insert" | "update" | "delete">,
): Promise<void> {
  await run(client, `alter table public.${table} enable row level security`);
  for (const op of ops) {
    const name = `${table}_${op}`;
    await run(client, `drop policy if exists ${name} on public.${table}`);
    const clause =
      op === "select" || op === "delete"
        ? `using (app.is_member(business_id))`
        : op === "insert"
          ? `with check (app.is_member(business_id))`
          : `using (app.is_member(business_id)) with check (app.is_member(business_id))`;
    await run(
      client,
      `create policy ${name} on public.${table} for ${op} to driva_app, authenticated ${clause}`,
    );
  }
}

/**
 * Grossistbeställningar (migration 30). Speglar migrationen exakt så att en
 * produktion där `supabase db push` inte körts ändå kan aktivera funktionen.
 * Allt är IF NOT EXISTS / drop-if-exists – idempotent.
 */
export async function ensureWholesalerSchema(client: SqlClient): Promise<string[]> {
  const applied: string[] = [];

  if (!(await columnExists(client, "job_work_entries", "wholesaler_provenance"))) {
    await run(client, `alter table public.job_work_entries drop constraint if exists job_work_entries_source_check`);
    await run(
      client,
      `alter table public.job_work_entries
         add constraint job_work_entries_source_check
         check (source in ('manual', 'quote', 'ai', 'import', 'wholesaler'))`,
    );
    await run(client, `alter table public.job_work_entries add column if not exists wholesaler_provenance jsonb`);
    applied.push("job_work_entries.wholesaler_provenance");
  }

  if (!(await columnExists(client, "inbox_items", "purchase_order_id"))) {
    await run(client, `alter table public.inbox_items drop constraint if exists inbox_items_document_type_check`);
    await run(
      client,
      `alter table public.inbox_items
         add constraint inbox_items_document_type_check
         check (document_type in ('leverantorsfaktura', 'kvitto', 'ekonomiskt_dokument', 'orderbekraftelse'))`,
    );
    await run(
      client,
      `alter table public.inbox_items
         add column if not exists purchase_order_id text,
         add column if not exists purchase_order_confirmation_id text,
         add column if not exists purchase_order_candidates jsonb`,
    );
    applied.push("inbox_items.purchase_order_id");
  }

  const connections = await client.query(`select to_regclass('public.wholesaler_connections') is not null as present`);
  if (connections[0]?.present) return applied;

  await run(
    client,
    `create table if not exists public.wholesaler_connections (
      id text primary key,
      business_id uuid not null references public.businesses (id) on delete cascade,
      wholesaler text not null
        check (wholesaler in ('ahlsell', 'dahl', 'sonepar', 'solar', 'lundagrossisten', 'rexel', 'other')),
      display_name text,
      customer_number text not null default '',
      order_email text not null default '',
      cc_self boolean not null default false,
      default_delivery_mode text not null default 'pickup' check (default_delivery_mode in ('pickup', 'delivery')),
      default_store text,
      default_delivery_address text,
      contact_person text,
      phone text,
      customer_price_rule jsonb not null default '{"kind":"later"}'::jsonb,
      active boolean not null default true,
      active_import_id text,
      column_mapping jsonb,
      discount_groups jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`,
  );
  await run(
    client,
    `create index if not exists wholesaler_connections_business_idx on public.wholesaler_connections (business_id, created_at)`,
  );
  await run(client, `grant select, insert, update, delete on public.wholesaler_connections to driva_app`);
  await ensureTenantPolicies(client, "wholesaler_connections", ["select", "insert", "update", "delete"]);

  await run(
    client,
    `create table if not exists public.wholesaler_price_imports (
      id text primary key,
      business_id uuid not null references public.businesses (id) on delete cascade,
      connection_id text not null references public.wholesaler_connections (id) on delete cascade,
      filename text not null default '',
      file_kind text not null check (file_kind in ('csv', 'txt', 'xlsx', 'xml', 'zip')),
      status text not null check (status in ('processing', 'active', 'superseded', 'failed')),
      mapping jsonb not null default '{}'::jsonb,
      row_count integer not null default 0,
      product_count integer not null default 0,
      skipped_count integer not null default 0,
      errors jsonb not null default '[]'::jsonb,
      has_article_register boolean not null default false,
      has_discounts boolean not null default false,
      discount_group_count integer not null default 0,
      price_date date not null,
      failed_reason text,
      created_at timestamptz not null default now(),
      completed_at timestamptz
    )`,
  );
  await run(
    client,
    `create index if not exists wholesaler_price_imports_connection_idx
       on public.wholesaler_price_imports (business_id, connection_id, created_at desc)`,
  );
  await run(client, `grant select, insert, update, delete on public.wholesaler_price_imports to driva_app`);
  await ensureTenantPolicies(client, "wholesaler_price_imports", ["select", "insert", "update", "delete"]);

  await run(
    client,
    `create table if not exists public.wholesaler_products (
      id text primary key,
      business_id uuid not null references public.businesses (id) on delete cascade,
      connection_id text not null references public.wholesaler_connections (id) on delete cascade,
      import_id text not null references public.wholesaler_price_imports (id) on delete cascade,
      article_number text not null,
      name text not null,
      e_number text,
      rsk_number text,
      gtin text,
      category text,
      discount_group text,
      unit text not null default 'st',
      pack_size numeric check (pack_size is null or pack_size > 0),
      list_price_ore bigint check (list_price_ore is null or list_price_ore >= 0),
      discount_percent numeric check (discount_percent is null or (discount_percent >= 0 and discount_percent <= 100)),
      net_price_ore bigint check (net_price_ore is null or net_price_ore >= 0),
      net_price_source text check (net_price_source is null or net_price_source in ('file', 'discount_group')),
      sales_price_ore bigint check (sales_price_ore is null or sales_price_ore >= 0),
      article_key text not null,
      e_key text,
      rsk_key text,
      gtin_key text,
      name_key text not null default '',
      search_text text not null default ''
    )`,
  );
  await run(
    client,
    `create index if not exists wholesaler_products_import_article_idx
       on public.wholesaler_products (business_id, import_id, article_key)`,
  );
  await run(
    client,
    `create index if not exists wholesaler_products_import_e_idx
       on public.wholesaler_products (business_id, import_id, e_key) where e_key is not null`,
  );
  await run(
    client,
    `create index if not exists wholesaler_products_import_rsk_idx
       on public.wholesaler_products (business_id, import_id, rsk_key) where rsk_key is not null`,
  );
  await run(
    client,
    `create index if not exists wholesaler_products_import_gtin_idx
       on public.wholesaler_products (business_id, import_id, gtin_key) where gtin_key is not null`,
  );
  await run(
    client,
    `create index if not exists wholesaler_products_search_trgm_idx
       on public.wholesaler_products using gin (search_text gin_trgm_ops)`,
  );
  await run(client, `grant select, insert, update, delete on public.wholesaler_products to driva_app`);
  await ensureTenantPolicies(client, "wholesaler_products", ["select", "insert", "update", "delete"]);

  await run(
    client,
    `create or replace function app.assert_wholesaler_same_business()
     returns trigger language plpgsql set search_path = '' as $$
     declare v_business uuid;
     begin
       select business_id into v_business from public.wholesaler_connections where id = new.connection_id;
       if v_business is null then
         raise exception 'wholesaler: anslutningen finns inte' using errcode = 'P0001';
       end if;
       if v_business is distinct from new.business_id then
         raise exception 'wholesaler: anslutningen tillhör ett annat företag' using errcode = 'P0001';
       end if;
       return new;
     end; $$`,
  );
  await run(client, `drop trigger if exists wholesaler_price_imports_same_business on public.wholesaler_price_imports`);
  await run(
    client,
    `create trigger wholesaler_price_imports_same_business
       before insert or update of connection_id, business_id on public.wholesaler_price_imports
       for each row execute function app.assert_wholesaler_same_business()`,
  );
  await run(client, `drop trigger if exists wholesaler_products_same_business on public.wholesaler_products`);
  await run(
    client,
    `create trigger wholesaler_products_same_business
       before insert or update of connection_id, business_id on public.wholesaler_products
       for each row execute function app.assert_wholesaler_same_business()`,
  );

  await run(
    client,
    `create table if not exists public.purchase_orders (
      id text primary key,
      business_id uuid not null references public.businesses (id) on delete cascade,
      reference text not null,
      job_id text not null references public.jobs (id) on delete cascade,
      connection_id text not null references public.wholesaler_connections (id) on delete restrict,
      status text not null check (status in (
        'draft', 'sent', 'confirmed', 'partially_confirmed', 'needs_review', 'rejected', 'cancelled'
      )),
      channel text not null default 'email' check (channel in ('email', 'edi', 'api', 'punchout')),
      delivery jsonb not null default '{"mode":"pickup"}'::jsonb,
      orderer_name text not null default '',
      orderer_email text not null default '',
      orderer_phone text not null default '',
      message text,
      cc_self boolean not null default false,
      wholesaler_order_number text,
      sent_at timestamptz,
      sent_snapshot jsonb,
      last_email jsonb,
      last_send_attempt_at timestamptz,
      send_key text,
      created_by_user_id uuid,
      cancelled_at timestamptz,
      deviations_accepted_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`,
  );
  await run(
    client,
    `create unique index if not exists purchase_orders_reference_uq on public.purchase_orders (business_id, reference)`,
  );
  await run(
    client,
    `create index if not exists purchase_orders_job_idx on public.purchase_orders (business_id, job_id, created_at)`,
  );
  await run(
    client,
    `create index if not exists purchase_orders_wholesaler_number_idx
       on public.purchase_orders (business_id, wholesaler_order_number) where wholesaler_order_number is not null`,
  );
  await run(client, `grant select, insert, update, delete on public.purchase_orders to driva_app`);
  await ensureTenantPolicies(client, "purchase_orders", ["select", "insert", "update", "delete"]);

  await run(
    client,
    `create or replace function app.assert_purchase_order_links()
     returns trigger language plpgsql set search_path = '' as $$
     declare v_job_business uuid; v_conn_business uuid;
     begin
       select business_id into v_job_business from public.jobs where id = new.job_id;
       if v_job_business is null then
         raise exception 'purchase_order: uppdraget finns inte' using errcode = 'P0001';
       end if;
       if v_job_business is distinct from new.business_id then
         raise exception 'purchase_order: uppdraget tillhör ett annat företag' using errcode = 'P0001';
       end if;
       select business_id into v_conn_business from public.wholesaler_connections where id = new.connection_id;
       if v_conn_business is null then
         raise exception 'purchase_order: grossistanslutningen finns inte' using errcode = 'P0001';
       end if;
       if v_conn_business is distinct from new.business_id then
         raise exception 'purchase_order: grossistanslutningen tillhör ett annat företag' using errcode = 'P0001';
       end if;
       return new;
     end; $$`,
  );
  await run(client, `drop trigger if exists purchase_orders_links on public.purchase_orders`);
  await run(
    client,
    `create trigger purchase_orders_links
       before insert or update of job_id, connection_id, business_id on public.purchase_orders
       for each row execute function app.assert_purchase_order_links()`,
  );
  await run(
    client,
    `create or replace function app.purchase_orders_guard()
     returns trigger language plpgsql set search_path = '' as $$
     begin
       if tg_op = 'DELETE' then
         if old.sent_at is not null and not app.demo_reset_active(old.business_id) then
           raise exception 'immutability: en skickad beställning kan inte tas bort – avbryt eller skapa en ny'
             using errcode = 'P0001';
         end if;
         return old;
       end if;
       if old.sent_at is not null then
         if new.sent_at is distinct from old.sent_at
            or new.sent_snapshot is distinct from old.sent_snapshot
            or new.reference is distinct from old.reference
            or new.job_id is distinct from old.job_id
            or new.connection_id is distinct from old.connection_id
            or new.channel is distinct from old.channel then
           raise exception 'immutability: den skickade beställningen kan inte ändras – skapa en ny beställning'
             using errcode = 'P0001';
         end if;
         if new.status = 'draft' then
           raise exception 'immutability: en skickad beställning kan inte bli utkast igen'
             using errcode = 'P0001';
         end if;
       end if;
       return new;
     end; $$`,
  );
  await run(client, `drop trigger if exists purchase_orders_guard on public.purchase_orders`);
  await run(
    client,
    `create trigger purchase_orders_guard
       before update or delete on public.purchase_orders
       for each row execute function app.purchase_orders_guard()`,
  );

  await run(
    client,
    `create table if not exists public.purchase_order_lines (
      id text primary key,
      business_id uuid not null references public.businesses (id) on delete cascade,
      order_id text not null references public.purchase_orders (id) on delete cascade,
      position integer not null default 0,
      product_id text,
      article_number text,
      name text not null default '',
      e_number text,
      rsk_number text,
      unit text not null default 'st',
      pack_size numeric check (pack_size is null or pack_size > 0),
      qty numeric not null check (qty > 0),
      unit_cost_ore bigint check (unit_cost_ore is null or unit_cost_ore >= 0),
      customer_unit_price_ore bigint
        check (customer_unit_price_ore is null or (customer_unit_price_ore >= 0 and customer_unit_price_ore % 100 = 0)),
      customer_price_source text not null default 'missing'
        check (customer_price_source in ('explicit', 'file', 'markup', 'missing')),
      note text,
      is_free_text boolean not null default false,
      job_work_entry_id text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`,
  );
  await run(
    client,
    `create index if not exists purchase_order_lines_order_idx on public.purchase_order_lines (business_id, order_id, position)`,
  );
  await run(
    client,
    `create unique index if not exists purchase_order_lines_work_entry_uq
       on public.purchase_order_lines (job_work_entry_id) where job_work_entry_id is not null`,
  );
  await run(client, `grant select, insert, update, delete on public.purchase_order_lines to driva_app`);
  await ensureTenantPolicies(client, "purchase_order_lines", ["select", "insert", "update", "delete"]);
  await run(
    client,
    `create or replace function app.purchase_order_lines_guard()
     returns trigger language plpgsql set search_path = '' as $$
     declare v_business uuid; v_sent_at timestamptz;
     begin
       if tg_op = 'DELETE' then
         select sent_at into v_sent_at from public.purchase_orders where id = old.order_id;
         if v_sent_at is not null and not app.demo_reset_active(old.business_id) then
           raise exception 'immutability: rader på en skickad beställning kan inte tas bort'
             using errcode = 'P0001';
         end if;
         return old;
       end if;
       select business_id, sent_at into v_business, v_sent_at from public.purchase_orders where id = new.order_id;
       if v_business is null then
         raise exception 'purchase_order_line: beställningen finns inte' using errcode = 'P0001';
       end if;
       if v_business is distinct from new.business_id then
         raise exception 'purchase_order_line: beställningen tillhör ett annat företag' using errcode = 'P0001';
       end if;
       if tg_op = 'UPDATE' and v_sent_at is not null then
         if new.qty is distinct from old.qty
            or new.article_number is distinct from old.article_number
            or new.name is distinct from old.name
            or new.unit is distinct from old.unit
            or new.product_id is distinct from old.product_id
            or new.order_id is distinct from old.order_id then
           raise exception 'immutability: raderna på en skickad beställning kan inte ändras – skapa en ny beställning'
             using errcode = 'P0001';
         end if;
       end if;
       if tg_op = 'INSERT' and v_sent_at is not null and not app.demo_reset_active(new.business_id) then
         raise exception 'immutability: nya rader kan inte läggas på en skickad beställning'
           using errcode = 'P0001';
       end if;
       return new;
     end; $$`,
  );
  await run(client, `drop trigger if exists purchase_order_lines_guard on public.purchase_order_lines`);
  await run(
    client,
    `create trigger purchase_order_lines_guard
       before insert or update or delete on public.purchase_order_lines
       for each row execute function app.purchase_order_lines_guard()`,
  );

  await run(
    client,
    `create table if not exists public.purchase_order_confirmations (
      id text primary key,
      business_id uuid not null references public.businesses (id) on delete cascade,
      order_id text not null references public.purchase_orders (id) on delete cascade,
      inbox_item_id text,
      source text not null check (source in ('email', 'manual', 'demo')),
      match_method text not null check (match_method in ('reference', 'order_number', 'customer_job', 'manual')),
      status text not null check (status in ('applied', 'needs_review', 'approved', 'dismissed')),
      received_at timestamptz not null,
      wholesaler_order_number text,
      delivery_date date,
      total_ore bigint check (total_ore is null or total_ore >= 0),
      message text,
      lines jsonb not null default '[]'::jsonb,
      deviations jsonb not null default '[]'::jsonb,
      reviewed_at timestamptz,
      created_at timestamptz not null default now()
    )`,
  );
  await run(
    client,
    `create index if not exists purchase_order_confirmations_order_idx
       on public.purchase_order_confirmations (business_id, order_id, received_at)`,
  );
  await run(
    client,
    `create unique index if not exists purchase_order_confirmations_inbox_uq
       on public.purchase_order_confirmations (business_id, inbox_item_id) where inbox_item_id is not null`,
  );
  await run(client, `grant select, insert, update on public.purchase_order_confirmations to driva_app`);
  await ensureTenantPolicies(client, "purchase_order_confirmations", ["select", "insert", "update"]);
  await run(
    client,
    `create or replace function app.assert_confirmation_same_business()
     returns trigger language plpgsql set search_path = '' as $$
     declare v_business uuid;
     begin
       select business_id into v_business from public.purchase_orders where id = new.order_id;
       if v_business is null then
         raise exception 'purchase_order_confirmation: beställningen finns inte' using errcode = 'P0001';
       end if;
       if v_business is distinct from new.business_id then
         raise exception 'purchase_order_confirmation: beställningen tillhör ett annat företag' using errcode = 'P0001';
       end if;
       return new;
     end; $$`,
  );
  await run(
    client,
    `drop trigger if exists purchase_order_confirmations_same_business on public.purchase_order_confirmations`,
  );
  await run(
    client,
    `create trigger purchase_order_confirmations_same_business
       before insert or update of order_id, business_id on public.purchase_order_confirmations
       for each row execute function app.assert_confirmation_same_business()`,
  );

  await run(client, RESET_DEMO_BUSINESS_WITH_WHOLESALERS_SQL);

  applied.push("wholesalers");
  return applied;
}

/** Samma kropp som migration 30 – reset måste tömma grossisttabellerna före uppdrag/anslutningar. */
const RESET_DEMO_BUSINESS_WITH_WHOLESALERS_SQL = `
create or replace function app.reset_demo_business(p_business_id uuid, p_keep_user_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.businesses b where b.id = p_business_id and b.is_demo
  ) then
    raise exception 'demo_reset: företaget är inte ett demoföretag' using errcode = 'P0001';
  end if;
  perform set_config('app.demo_reset', '1', true);
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 42));
  delete from public.accounting_entries where business_id = p_business_id;
  delete from public.verifications where business_id = p_business_id;
  delete from public.payments where business_id = p_business_id;
  delete from public.invoice_issued_snapshots where business_id = p_business_id;
  delete from public.invoice_line_items where business_id = p_business_id;
  delete from public.invoices where business_id = p_business_id;
  delete from public.signatures where business_id = p_business_id;
  delete from public.bankid_orders where business_id = p_business_id;
  delete from public.quote_versions where business_id = p_business_id;
  delete from public.quotes where business_id = p_business_id;
  delete from public.purchase_order_confirmations where business_id = p_business_id;
  delete from public.purchase_order_lines where business_id = p_business_id;
  delete from public.purchase_orders where business_id = p_business_id;
  delete from public.wholesaler_products where business_id = p_business_id;
  delete from public.wholesaler_price_imports where business_id = p_business_id;
  delete from public.wholesaler_connections where business_id = p_business_id;
  delete from public.job_work_entries where business_id = p_business_id;
  delete from public.jobs where business_id = p_business_id;
  delete from public.work_locations where business_id = p_business_id;
  delete from public.customers where business_id = p_business_id;
  delete from public.bank_transactions where business_id = p_business_id;
  delete from public.bank_accounts where business_id = p_business_id;
  delete from public.bank_connections where business_id = p_business_id;
  delete from public.receipts where business_id = p_business_id;
  delete from public.expenses where business_id = p_business_id;
  delete from public.supplier_payments where business_id = p_business_id;
  delete from public.supplier_invoices where business_id = p_business_id;
  delete from public.payment_files where business_id = p_business_id;
  delete from public.vat_reports where business_id = p_business_id;
  delete from public.assets where business_id = p_business_id;
  delete from public.accruals where business_id = p_business_id;
  delete from public.annual_reports where business_id = p_business_id;
  delete from public.fiscal_years where business_id = p_business_id;
  delete from public.websites where business_id = p_business_id;
  delete from public.domains where business_id = p_business_id;
  delete from public.assistant_messages where business_id = p_business_id;
  delete from public.pending_actions where business_id = p_business_id;
  delete from public.audit_log where business_id = p_business_id;
  delete from public.reminders where business_id = p_business_id;
  delete from public.attention_states where business_id = p_business_id;
  delete from public.inbox_items where business_id = p_business_id;
  delete from public.client_information_requests where business_id = p_business_id;
  delete from public.collaboration_invitations where business_id = p_business_id;
  if p_keep_user_id is not null then
    update public.business_memberships
       set revoked_at = now()
     where business_id = p_business_id
       and revoked_at is null
       and user_id <> p_keep_user_id;
  end if;
  update public.business_sequences
     set quote = 1, invoice = 1, verification = 1
   where business_id = p_business_id;
  update public.businesses
     set state_version = state_version + 1,
         accounting_locked_through = null,
         meta = '{}'::jsonb
   where id = p_business_id;
end;
$$;
`;
