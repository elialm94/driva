-- Produktomfattning och eligibility (spec §10).
--
-- business_settings.scope: bolagets svar på onboardingens frågor mot
-- supportmatrisen, matrisversionen svaren gavs mot och redovisningskonsultens
-- godkännanden av konsultfall (jsonb, se lib/support/eligibility.ts).
-- Servern läser kolumnen i sina vakter: ett konsultfall (t.ex. omvänd byggmoms
-- på egna kundfakturor) släpps bara igenom när ett godkännande finns här.
-- Bolag skapade före kolumnen har null och behandlas som obedömda utan
-- godkännanden – ingen backfill hittar på svar åt dem.

alter table public.business_settings
  add column if not exists scope jsonb;

update public.business_settings
   set scope = null
 where scope is not null
   and jsonb_typeof(scope) <> 'object';
