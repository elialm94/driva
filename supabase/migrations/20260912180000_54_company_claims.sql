-- Sanna standardtexter (spec §8).
--
-- 1) business_settings.claims: företagets AKTIVA verifieringar av F-skatt och
--    ansvarsförsäkring (jsonb, se lib/company-claims.ts). Genererad text får
--    bara påstå något när en aktuell verifiering finns här.
-- 2) Den gamla systemtexten för offertvillkor påstod F-skatt och "full
--    ansvarsförsäkring" åt alla företag. Endast rader som är IDENTISKA med den
--    orörda systemtexten nollas – företagets egna formuleringar rörs inte.
--    Tomt värde = offerterna följer systemets neutrala text plus det som
--    faktiskt är verifierat. Befintliga offerter påverkas inte.

alter table public.business_settings
  add column if not exists claims jsonb;

update public.business_settings
   set claims = null
 where claims is not null
   and jsonb_typeof(claims) <> 'object';

update public.business_settings
   set default_quote_terms = null
 where btrim(regexp_replace(coalesce(default_quote_terms, ''), '\s+', ' ', 'g')) =
       'Offerten omfattar arbete och material enligt specifikationen ovan. Eventuella tillkommande arbeten offereras separat innan de påbörjas. Vi innehar F-skattsedel och full ansvarsförsäkring. Garanti lämnas enligt konsumenttjänstlagen.';
