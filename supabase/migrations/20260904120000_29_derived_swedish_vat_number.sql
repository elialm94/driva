-- ============================================================================
-- 29 · Momsreg.nr härleds ur organisationsnumret för svenska företag
-- ----------------------------------------------------------------------------
-- business_settings.vat_number var ett eget användarifyllt fält. För svenska
-- företag är det ren dubbellagring: momsnumret ÄR "SE" + org.nr:s 10 siffror
-- + "01". Appen härleder det nu vid varje skrivning (deriveSwedishVatNumber i
-- src/lib/invoices/formats.ts) och vid normalize(), så kolumnen är en spegel
-- av org.nr – inte en egen sanning.
--
-- Kolumnen behålls: den läses av fakturans frysta säljar-snapshot, exporter
-- och sidfötter, och utländska bolag (country <> Sverige) har fortfarande ett
-- eget manuellt momsnummer här som INTE får skrivas över.
--
-- Backfillen nedan är avsiktligt försiktig och rör bara det som är säkert:
--
--   1. Tomma svenska rader med giltigt org.nr fylls i.
--   2. Svenska rader som redan matchar normaliseras (versaler, blanktecken).
--
-- Rader där ett svenskt företag har ett momsnummer som INTE matchar org.nr
-- lämnas OFÖRÄNDRADE. Ett sådant värde är antingen en felskrivning eller en
-- verklig avvikelse (momsgrupp, historiskt filialsuffix 02/03, felaktigt
-- registrerat land) och ska inte tysta skrivas över av en migration. Appen
-- visar det härledda värdet, så avvikelsen syns men gör ingen skada. Kör
-- rapportfrågan i slutet av filen för att hitta dem.
--
-- Utfärdade fakturor rörs inte: säljaruppgifterna ligger frysta i
-- invoices.issued_snapshot och ska förbli exakt som de var vid utfärdandet.
-- ============================================================================

-- Enda källan i databasen till samma regel som appens deriveSwedishVatNumber.
-- Tom sträng när org.nr inte är 10 siffror – härled aldrig ur skräp.
create or replace function app.derive_swedish_vat_number(org_number text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when length(regexp_replace(coalesce(org_number, ''), '\D', '', 'g')) = 10
      then 'SE' || regexp_replace(org_number, '\D', '', 'g') || '01'
    else ''
  end
$$;

comment on function app.derive_swedish_vat_number(text) is
  'Svenskt momsreg.nr ur org.nr: SE + 10 siffror + 01. Syntaktisk härledning – säger inget om faktisk momsregistrering.';

-- Svenskt land = tomt (kolumnens default är Sverige) eller ett Sverige-alias.
create or replace function app.is_swedish_country(country text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(trim(coalesce(country, ''))) in ('', 'sverige', 'sweden', 'se', 'swe')
$$;

-- 1 + 2: fyll tomma och normalisera de som redan stämmer. Mismatchande
-- svenska värden och alla utländska momsnummer träffas inte av where-satsen.
update public.business_settings s
set vat_number = app.derive_swedish_vat_number(s.org_number)
where app.is_swedish_country(s.country)
  and app.derive_swedish_vat_number(s.org_number) <> ''
  and s.vat_number <> app.derive_swedish_vat_number(s.org_number)
  and (
    trim(s.vat_number) = ''
    or upper(replace(s.vat_number, ' ', '')) = app.derive_swedish_vat_number(s.org_number)
  );

-- Rapportera det som lämnades kvar så avvikelserna går att titta på i stället
-- för att försvinna tyst. Notiserna hamnar i migrationsloggen.
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select s.business_id, s.name, s.org_number, s.vat_number,
           app.derive_swedish_vat_number(s.org_number) as derived
    from public.business_settings s
    where app.is_swedish_country(s.country)
      and trim(s.vat_number) <> ''
      and upper(replace(s.vat_number, ' ', '')) <> app.derive_swedish_vat_number(s.org_number)
    order by s.name
  loop
    n := n + 1;
    raise notice 'moms-avvikelse: business=% namn=% org.nr=% sparat=% härlett=%',
      r.business_id, r.name, r.org_number, r.vat_number, r.derived;
  end loop;
  if n > 0 then
    raise notice 'Totalt % svenska företag har ett sparat momsreg.nr som inte matchar org.nr. Värdena är ORÖRDA – appen visar det härledda.', n;
  end if;
end $$;

-- Rapportfråga att köra igen när som helst:
--
--   select business_id, name, org_number, vat_number,
--          app.derive_swedish_vat_number(org_number) as derived
--   from public.business_settings
--   where app.is_swedish_country(country)
--     and trim(vat_number) <> ''
--     and upper(replace(vat_number, ' ', '')) <> app.derive_swedish_vat_number(org_number);
