-- ============================================================================
-- 19 · Hemsidans utseende: tema + accentfärg med utkast → publicera-modell
-- ----------------------------------------------------------------------------
--   * design:        publicerat utseende {"themeId","accent"} – det besökare
--                    ser på den publika sajten.
--   * draft_design:  utkast till utseende. Uppdaterar byggarens förhands-
--                    visning direkt och töms när sajten publiceras.
--
--   Båda är null på äldre sajter: utseendet härleds då i domänlagret från det
--   äldre theme-palettfältet (alla äldre sajter blir "klassisk" med närmast
--   matchande accent) – ingen datamigrering behövs och ingen publicerad sajt
--   byter karaktär. Giltiga värden ägs av domänlagret
--   (src/lib/website-design.ts); kolumnerna är avsiktligt fria jsonb så att
--   nya teman/accenter inte kräver schemaändring.
-- ============================================================================

alter table public.websites
  add column design jsonb,
  add column draft_design jsonb;
