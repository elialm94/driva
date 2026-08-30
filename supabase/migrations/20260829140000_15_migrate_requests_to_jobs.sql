-- ============================================================================
-- 15 – Förfrågan/requests tas bort. Inkommande webbformulär är uppdrag.
--
--   * jobs får källa + originalmeddelande (analys, inte egen entitet).
--   * Befintliga requests flyttas till jobs (idempotent, inga dubbletter).
--   * quotes.request_id slopas; kopplingen är quote.job_id.
--   * Aviseringskolumnen byter namn till website_notification_email.
-- ============================================================================

-- ------------------------------ Jobbkällor ---------------------------------

alter table public.jobs
  add column if not exists source text not null default 'manual';

alter table public.jobs
  drop constraint if exists jobs_source_check;

alter table public.jobs
  add constraint jobs_source_check
  check (source in ('manual', 'web_form', 'email', 'import', 'phone', 'other'));

alter table public.jobs
  add column if not exists original_message text;

alter table public.jobs
  add column if not exists idempotency_key text;

alter table public.jobs
  add column if not exists notification jsonb;

create unique index if not exists jobs_idempotency_uq
  on public.jobs (business_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists jobs_source_idx
  on public.jobs (business_id, source);

-- ------------------------------ Migrera rader ------------------------------

do $$
begin
  if to_regclass('public.requests') is null then
    return;
  end if;

  -- Redan konverterade (offert pekar på uppdrag): kopiera källa/meddelande.
  update public.jobs j
  set
    source = case
      when j.source is distinct from 'manual' then j.source
      else mapped.source
    end,
    original_message = coalesce(j.original_message, mapped.message),
    idempotency_key = coalesce(j.idempotency_key, mapped.idempotency_key),
    notification = coalesce(j.notification, mapped.notification)
  from (
    select
      q.job_id,
      r.message,
      r.idempotency_key,
      r.notification,
      case r.source
        when 'hemsida' then 'web_form'
        when 'telefon' then 'phone'
        when 'manuell' then 'manual'
        when 'assistent' then 'import'
        else 'email'
      end as source
    from public.requests r
    join public.quotes q
      on q.job_id is not null
     and (q.request_id = r.id or q.id = r.quote_id)
  ) mapped
  where j.id = mapped.job_id;

  -- Öppna/okonverterade: skapa uppdrag med samma id (bokmärken /kunder/forfragningar/:id).
  insert into public.jobs (
    id, business_id, customer_id, quote_id, title, description, status,
    checklist, notes, created_at, source, original_message, idempotency_key, notification
  )
  select
    r.id,
    r.business_id,
    r.customer_id,
    coalesce(r.quote_id, q.id),
    case when nullif(btrim(r.title), '') is null then left(btrim(r.message), 60) else r.title end,
    r.message,
    'kommande',
    '[]'::jsonb,
    '',
    r.created_at,
    case r.source
      when 'hemsida' then 'web_form'
      when 'telefon' then 'phone'
      when 'manuell' then 'manual'
      when 'assistent' then 'import'
      else 'email'
    end,
    r.message,
    r.idempotency_key,
    r.notification
  from public.requests r
  left join public.quotes q on q.request_id = r.id
  where not exists (select 1 from public.jobs j where j.id = r.id)
    and not exists (
      select 1
      from public.quotes q2
      where q2.job_id is not null
        and (q2.request_id = r.id or q2.id = r.quote_id)
    )
    and (
      r.idempotency_key is null
      or not exists (
        select 1
        from public.jobs j
        where j.business_id = r.business_id
          and j.idempotency_key = r.idempotency_key
      )
    );

  -- Offerter som bara hade request_id får job_id.
  update public.quotes q
  set job_id = r.id
  from public.requests r
  where q.job_id is null
    and (q.request_id = r.id or r.quote_id = q.id)
    and exists (select 1 from public.jobs j where j.id = r.id);
end $$;

-- ------------------------------ Städa schema -------------------------------

alter table public.quotes drop column if exists request_id;

drop table if exists public.requests cascade;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'business_settings'
      and column_name = 'inquiry_notification_email'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'business_settings'
      and column_name = 'website_notification_email'
  ) then
    alter table public.business_settings
      rename column inquiry_notification_email to website_notification_email;
  end if;
end $$;
