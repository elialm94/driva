-- Notiser till företagaren (Inställningar → Notiser): egen mottagare och
-- avstängda händelser. NULL = allt på, till företagets e-post.
alter table public.business_settings
  add column if not exists notices jsonb;
