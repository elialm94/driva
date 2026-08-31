-- ============================================================================
-- 22 · Ta bort pensionerade Instagram-sektioner från hemsidor
-- ----------------------------------------------------------------------------
--   * Sektionstyp är inte en DB-enum – sektioner ligger i websites.sections
--     (jsonb). Instagram-feeden är borttagen ur produkten.
--   * Befintliga rader med type = 'instagram' droppas så att publicerade
--     sajter inte lämnar kvar feed/OAuth-data. Övriga sektioner orörda.
-- ============================================================================

update public.websites
set sections = coalesce(
  (
    select jsonb_agg(elem)
    from jsonb_array_elements(sections) as elem
    where elem->>'type' is distinct from 'instagram'
  ),
  '[]'::jsonb
)
where exists (
  select 1
  from jsonb_array_elements(sections) as elem
  where elem->>'type' = 'instagram'
);
