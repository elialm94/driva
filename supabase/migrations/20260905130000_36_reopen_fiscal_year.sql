-- ============================================================================
-- 36 · Återöppning av stängt räkenskapsår
-- ----------------------------------------------------------------------------
-- Ett bokslut är en slutsats, inte en sanning: fakturan som kom i mars kan visa
-- sig gälla december. Utan en väg tillbaka finns bara dåliga utvägar – bokföra
-- fjolårets fel i år, eller behålla en årsredovisning man vet är felaktig.
--
-- Återöppningen är därför tillåten men spårbar. reopenings är en jsonb-lista
-- med ett element per omtag: när, av vem, skälet, vilka bokslutsverifikationer
    10|-- som återfördes och vilka återföringar som bokfördes, samt periodlåset som
-- gällde innan (låset måste flyttas bakåt för att året ska gå att rätta, och
-- sätts tillbaka när året stängs igen). Formen beskrivs i src/lib/types.ts
-- (FiscalYearReopening). Listan skrivs aldrig över – den växer.
--
-- superseded_at på årsredovisningen markerar att rapporten inte längre beskriver
-- böckerna. Rapporten raderas inte: en undertecknad eller inlämnad
-- årsredovisning är en handling som har funnits och ska gå att läsa efteråt.
-- ============================================================================

    20|alter table public.fiscal_years
  add column if not exists reopenings jsonb;

comment on column public.fiscal_years.reopenings is
  'Historik över återöppningar: när, av vem, skäl, återförda bokslutsverifikationer och tidigare periodlås. Skrivs aldrig över.';

alter table public.annual_reports
  add column if not exists superseded_at timestamptz;

alter table public.annual_reports
    30|  add column if not exists superseded_reason text;

comment on column public.annual_reports.superseded_at is
  'Satt när räkenskapsåret öppnades igen efter att rapporten upprättades. Rapporten står kvar som historik men gäller inte längre.';

-- Den gällande rapporten för ett år är den som inte är ersatt. Uppslaget sker
-- per räkenskapsår i varje vy, så det får ett eget index.
create index if not exists annual_reports_current_idx
  on public.annual_reports (business_id, fiscal_year_id)
  where superseded_at is null;
