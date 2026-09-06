-- ============================================================================
-- 33 · Momsperiodicitet
-- ----------------------------------------------------------------------------
-- Skatteverket registrerar företaget för EN redovisningsperiod för moms:
-- helår (beskattningsunderlag upp till 1 mkr), kvartal (upp till 40 mkr, och
-- huvudregeln för ett litet aktiebolag) eller månad (över 40 mkr, eller på
-- egen begäran). Produkten gissar aldrig utifrån omsättningen – kolumnen
-- speglar registreringen, och styr både periodindelningen på momssidan och
-- förfallodagen (SFL 26 kap.).
--
-- Default 'kvartal' matchar huvudregeln och gör att befintliga företag
-- fortsätter exakt som förut.
-- ============================================================================

alter table public.business_settings
  add column if not exists vat_periodicity text not null default 'kvartal';

alter table public.business_settings
  drop constraint if exists business_settings_vat_periodicity_check;

alter table public.business_settings
  add constraint business_settings_vat_periodicity_check
  check (vat_periodicity in ('manad', 'kvartal', 'helar'));

comment on column public.business_settings.vat_periodicity is
  'Redovisningsperiod för moms: manad, kvartal eller helar. Speglar registreringen hos Skatteverket.';
