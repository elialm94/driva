-- ============================================================================
-- 24 · Provperiod: kanoniskt trial-/prenumerationstillstånd på businesses
-- ----------------------------------------------------------------------------
-- Alla nya riktiga företag startar en 14-dagars gratis provperiod (inget
-- kort). Kolumnerna sätts av createBusinessWithOwner vid onboarding:
--
--   trial_started_at     = now()
--   trial_ends_at        = now() + 14 dagar
--   subscription_status  = 'trialing'
--
-- Ingen betalvägg/Stripe i denna version – kolumnerna är den kanoniska
-- platsen för framtida fakturering. Befintliga företag lämnas som null
-- (skapade före provperiodsmodellen). Demoföretag får ingen provperiod.
--
-- Skydd: businesses_update-RLS-policyn tillåter medlemmar att uppdatera sin
-- företagsrad (Data API:t är exponerat), så tillståndet fryses av en trigger:
-- trial-stämplarna är oföränderliga efter INSERT och subscription_status kan
-- bara ändras när serverkoden uttryckligen öppnat grinden (framtida
-- faktureringsflöde) – samma mönster som app.allow_issue i 06.
-- ============================================================================

alter table public.businesses
  add column if not exists trial_started_at timestamptz;
alter table public.businesses
  add column if not exists trial_ends_at timestamptz;
alter table public.businesses
  add column if not exists subscription_status text;

alter table public.businesses
  drop constraint if exists businesses_subscription_status_check;
alter table public.businesses
  add constraint businesses_subscription_status_check
  check (subscription_status is null
         or subscription_status in ('trialing', 'active', 'expired', 'canceled'));

create or replace function app.businesses_subscription_frozen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.trial_started_at is distinct from old.trial_started_at
     or new.trial_ends_at is distinct from old.trial_ends_at then
    raise exception 'immutability: provperiodens stämplar kan inte ändras'
      using errcode = 'P0001';
  end if;
  if new.subscription_status is distinct from old.subscription_status
     and coalesce(current_setting('app.allow_subscription_update', true), '') <> '1' then
    raise exception 'immutability: prenumerationsstatus ändras endast av faktureringsflödet'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists businesses_subscription_frozen on public.businesses;
create trigger businesses_subscription_frozen
  before update on public.businesses
  for each row execute function app.businesses_subscription_frozen();
