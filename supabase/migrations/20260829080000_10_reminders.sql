-- ============================================================================
-- 10 – Påminnelser: persisterade reminders skapade ur naturligt språk.
--
--   * dueAt är en absolut tidpunkt (timestamptz); timezone lagras per rad så
--     att all användarvänd formatering sker i lokal tid (aldrig rå UTC).
--   * has_explicit_time styr uppmärksamhetspolicyn: klockslag/dagsdel →
--     visas från due_at; dagsnivå → visas från lokal dagsstart.
--   * status: PENDING/COMPLETED/DISMISSED. "Förfallen" härleds ur due_at –
--     lagras aldrig. Borttagning är mjuk (DISMISSED) – ingen DELETE-väg,
--     historiken bevaras. recurrence_rule är reserverad för framtida
--     återkommande påminnelser (ingen implementation).
--   * user_id är skaparen; tjänstelagret skopar per användare ovanpå RLS
--     (RLS isolerar per företag enligt standardmönstret i 07).
-- ============================================================================

create table public.reminders (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid references auth.users (id),
  title text not null check (length(title) between 1 and 300),
  description text,
  due_at timestamptz not null,
  timezone text not null default 'Europe/Stockholm',
  has_explicit_time boolean not null default false,
  status text not null default 'PENDING' check (status in ('PENDING', 'COMPLETED', 'DISMISSED')),
  source text not null default 'assistant' check (source in ('assistant', 'user')),
  related_entity_type text check (related_entity_type in ('customer', 'quote', 'invoice', 'job')),
  related_entity_id text,
  recurrence_rule text,
  snoozed_until timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  -- Kopplingen är alltid komplett eller frånvarande – aldrig halv.
  constraint reminders_related_pair check (
    (related_entity_type is null) = (related_entity_id is null)
  )
);

create index reminders_business_status_due_idx
  on public.reminders (business_id, status, due_at);

-- Serverrollen: ingen DELETE – borttagning är mjuk (status = DISMISSED).
grant select, insert, update on public.reminders to driva_app;

-- RLS enligt standardmönstret (07): medlemskap i företaget krävs.
alter table public.reminders enable row level security;
create policy reminders_select on public.reminders
  for select to driva_app, authenticated using (app.is_member(business_id));
create policy reminders_insert on public.reminders
  for insert to driva_app, authenticated with check (app.is_member(business_id));
create policy reminders_update on public.reminders
  for update to driva_app, authenticated
  using (app.is_member(business_id)) with check (app.is_member(business_id));
