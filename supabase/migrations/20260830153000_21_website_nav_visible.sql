-- ============================================================================
-- 21 · Hemsida som optional modul: meny-synlighet på business_settings
-- ----------------------------------------------------------------------------
--   * website_nav_visible styr om Hemsida visas i sidomenyn.
--   * NULL = härled från befintlig hemsidedata (record / utkast / publicerad
--     sajt / domän). true/false är ett explicit val.
--   * Dölj raderar eller avpublicerar ALDRIG. Backfill sätter true för
--     företag som redan har website- eller domändata.
-- ============================================================================

alter table public.business_settings
  add column if not exists website_nav_visible boolean;

update public.business_settings s
   set website_nav_visible = true
 where s.website_nav_visible is null
   and (
     exists (select 1 from public.websites w where w.business_id = s.business_id)
     or exists (select 1 from public.domains d where d.business_id = s.business_id)
   );
