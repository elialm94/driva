-- ============================================================================
-- 21 – Påminnelser: due_at är valfritt.
--
--   En påminnelse kan ha datum+tid, bara datum, eller ingen deadline alls.
--   Befintliga rader med due_at är oförändrade. has_explicit_time skiljer
--   fortfarande "onsdag" från "onsdag kl 00:00".
-- ============================================================================

alter table public.reminders
  alter column due_at drop not null;
