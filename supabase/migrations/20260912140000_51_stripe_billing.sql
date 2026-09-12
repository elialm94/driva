-- ============================================================================
-- 51 · Stripe Billing: abonnemangsfält på businesses + idempotent webhook-logg
-- ----------------------------------------------------------------------------
-- Provperioden (24) fortsätter starta utan kort. Det här lägger till
-- serverfälten som Stripe-webhooken är sanningskälla för:
--
--   stripe_customer_id      Stripe Customer (skapas server-side vid Checkout)
--   stripe_subscription_id  Stripe Subscription
--   stripe_price_id         priset abonnemanget löper på
--   stripe_status           Stripes råa status (trialing/active/past_due/…)
--   current_period_end      periodens slut enligt Stripe
--   cancel_at_period_end    uppsagt via kundportalen, gäller till periodens slut
--   billing_updated_at      när webhooken senast skrev
--   billing_event_created   Stripe-eventets `created` som skrev senast – skydd
--                           mot händelser som kommer i fel ordning
--
-- subscription_status (kanoniskt) får ett femte värde: 'past_due' = grace vid
-- tillfälligt betalningsfel. Skrivåtkomsten tas inte bort förrän Stripes
-- retry-/dunningpolicy är uttömd (då blir raden canceled/expired).
--
-- Alla Stripe-fält fryses av samma trigger som subscription_status: bara
-- serverflödet som öppnat grinden app.allow_subscription_update får skriva.
-- Medlemmars UPDATE via Data API:t kan därför aldrig sätta ett kund-id eller
-- aktivera ett abonnemang.
-- ============================================================================

alter table public.businesses
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_price_id text,
  add column if not exists stripe_status text,
  add column if not exists current_period_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists billing_updated_at timestamptz,
  add column if not exists billing_event_created bigint;

create unique index if not exists businesses_stripe_customer_uq
  on public.businesses (stripe_customer_id) where stripe_customer_id is not null;
create unique index if not exists businesses_stripe_subscription_uq
  on public.businesses (stripe_subscription_id) where stripe_subscription_id is not null;

alter table public.businesses
  drop constraint if exists businesses_subscription_status_check;
alter table public.businesses
  add constraint businesses_subscription_status_check
  check (subscription_status is null
         or subscription_status in ('trialing', 'active', 'past_due', 'expired', 'canceled'));

create or replace function app.businesses_subscription_frozen()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_gate boolean := coalesce(current_setting('app.allow_subscription_update', true), '') = '1';
begin
  if new.trial_started_at is distinct from old.trial_started_at
     or new.trial_ends_at is distinct from old.trial_ends_at then
    raise exception 'immutability: provperiodens stämplar kan inte ändras'
      using errcode = 'P0001';
  end if;
  if not v_gate and (
       new.subscription_status is distinct from old.subscription_status
    or new.stripe_customer_id is distinct from old.stripe_customer_id
    or new.stripe_subscription_id is distinct from old.stripe_subscription_id
    or new.stripe_price_id is distinct from old.stripe_price_id
    or new.stripe_status is distinct from old.stripe_status
    or new.current_period_end is distinct from old.current_period_end
    or new.cancel_at_period_end is distinct from old.cancel_at_period_end
    or new.billing_updated_at is distinct from old.billing_updated_at
    or new.billing_event_created is distinct from old.billing_event_created
  ) then
    raise exception 'immutability: abonnemangsfält ändras endast av faktureringsflödet'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists businesses_subscription_frozen on public.businesses;
create trigger businesses_subscription_frozen
  before update on public.businesses
  for each row execute function app.businesses_subscription_frozen();

-- ----------------------------------------------------------------------------
-- Webhook-händelser: en rad per Stripe event-id (idempotens). Ingen payload –
-- bara det som behövs för att se att händelsen togs emot, vad den var och hur
-- bearbetningen gick. Felet är en kort, sanerad text (aldrig kortuppgifter,
-- aldrig hela objektet).
-- ----------------------------------------------------------------------------

create table if not exists public.stripe_webhook_events (
  id text primary key,
  received_at timestamptz not null default now(),
  event_created timestamptz,
  type text not null,
  livemode boolean not null default false,
  api_version text,
  business_id uuid,
  status text not null default 'mottagen'
    check (status in ('mottagen', 'bearbetad', 'ignorerad', 'fel')),
  error text,
  processed_at timestamptz
);

create index if not exists stripe_webhook_events_received_idx
  on public.stripe_webhook_events (received_at desc);
create index if not exists stripe_webhook_events_business_idx
  on public.stripe_webhook_events (business_id, received_at desc);

alter table public.stripe_webhook_events enable row level security;
grant select, insert, update on public.stripe_webhook_events to driva_app;

-- Data API (authenticated/anon): inga policyer → ser ingenting.
-- Webhooken och admin körs i plattformskontext (utanför tenant).
drop policy if exists stripe_webhook_events_platform on public.stripe_webhook_events;
create policy stripe_webhook_events_platform on public.stripe_webhook_events
  for all to driva_app
  using (app.is_platform_context())
  with check (app.is_platform_context());

comment on table public.stripe_webhook_events is
  'Idempotent logg över Stripe-webhookhändelser (spec §5). Ingen payload lagras.';
