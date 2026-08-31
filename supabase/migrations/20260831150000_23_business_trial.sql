-- ============================================================================
-- 23 · Provperiod: kanoniskt trial-/prenumerationstillstånd på businesses.
--
--   * Sätts vid företagsskapandet (onboarding): trial_started_at = now,
--     trial_ends_at = now + 14 dagar, subscription_status = 'trialing'.
--   * Demoföretag (is_demo) får ALDRIG trial-fält – de är inte konton.
--   * Ingen betalning/Stripe i detta steg: kolumnerna är bara den kanoniska
--     sanningen som senare gating/fakturering kan läsa.
--   * Speglas (läs-endast) till DB.meta i appen – skrivs aldrig tillbaka via
--     jsonb:n (samma mönster som is_demo).
-- ============================================================================

alter table public.businesses
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists subscription_status text;

alter table public.businesses
  drop constraint if exists businesses_subscription_status_check;
alter table public.businesses
  add constraint businesses_subscription_status_check
  check (
    subscription_status is null
    or subscription_status in ('trialing', 'active', 'expired', 'canceled')
  );
