-- ============================================================================
-- 22 · Sidfot på hemsidan (utkast → publicera, samma modell som utseende)
-- ----------------------------------------------------------------------------
--   * footer:        publicerad sidfot (visa/dölj, sociala länkar, kort text).
--   * draft_footer:  utkast. Uppdaterar förhandsvisningen direkt, den publika
--                    sajten först vid "Publicera ändringar".
--   Kontakt, tjänster och logotyp hämtas live – de kopieras inte in här.
-- ============================================================================

alter table public.websites
  add column if not exists footer jsonb,
  add column if not exists draft_footer jsonb;
