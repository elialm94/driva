-- ============================================================================
-- 20 · Integritetspolicy: valfritt tillägg på hemsidan
-- ----------------------------------------------------------------------------
--   Företagsnamn, org.nr, adress och kontakt hämtas alltid live från
--   business_settings. Den här kolumnen är bara företagets egna tillägg till
--   den genererade policyn – inte en fryst kopia av företagsuppgifterna.
-- ============================================================================

alter table public.websites
  add column if not exists privacy_policy_supplement text;
