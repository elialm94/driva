-- ============================================================================
-- 17 – Arkiverade uppdrag (mjuk borttagning).
--
--   Hård radering bara om uppdraget är tomt. Annars archived_at.
--   Fakturor, offerter, betalningar och verifikationer raderas aldrig här.
-- ============================================================================

alter table public.jobs
  add column if not exists archived_at timestamptz;

create index if not exists jobs_business_archived_idx
  on public.jobs (business_id, archived_at)
  where archived_at is not null;
