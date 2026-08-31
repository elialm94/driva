-- ============================================================================
-- 22 · Integritetspolicy: STANDARD / CUSTOM + utkast
-- ----------------------------------------------------------------------------
--   Befintligt privacy_policy_supplement är oförändrat (STANDARD + tillägg).
--   Saknat mode = standard. Custom body och draft skrivs bara när user
--   anpassar eller har opublicerade ändringar.
-- ============================================================================

alter table public.websites
  add column if not exists privacy_policy_mode text;

alter table public.websites
  add column if not exists privacy_policy_custom_body jsonb;

alter table public.websites
  add column if not exists draft_privacy_policy jsonb;

alter table public.websites
  drop constraint if exists websites_privacy_policy_mode_check;

alter table public.websites
  add constraint websites_privacy_policy_mode_check
  check (privacy_policy_mode is null or privacy_policy_mode in ('standard', 'custom'));
