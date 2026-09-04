-- ============================================================================
-- 28 · Offertgodkännande utan BankID (enkel elektronisk underskrift)
-- ----------------------------------------------------------------------------
-- Kunden godkänner offerten på offertlänken genom att skriva sitt namn och
-- trycka "Godkänn offert". Tabellen signatures blir godkännanderegistret:
--   * method         – simple_accept | bankid_mock (äldre demodata) | bankid (reserverat)
--   * order_ref, signer_personal_number_masked, environment – bara BankID-poster,
--                      därför nullable från och med nu
--   * evidence jsonb – contentHash (SHA-256 av den låsta versionen), statement
--                      (den mening kunden godkände), customerNameAtAccept,
--                      acceptedByEmail, ip, userAgent, linkSentTo
-- Fortsatt EN rad per offert (signatures_quote_uq) – dubbelgodkännande är omöjligt.
-- ============================================================================

alter table public.signatures
  add column if not exists method text not null default 'bankid_mock';

alter table public.signatures
  alter column order_ref drop not null,
  alter column signer_personal_number_masked drop not null,
  alter column environment drop not null;

alter table public.signatures drop constraint if exists signatures_environment_check;
alter table public.signatures
  add constraint signatures_environment_check
  check (environment is null or environment in ('mock', 'production'));

alter table public.signatures drop constraint if exists signatures_method_check;
alter table public.signatures
  add constraint signatures_method_check
  check (method in ('simple_accept', 'bankid_mock', 'bankid'));

-- Befintliga rader kom från mock-BankID i demon (environment = 'mock').
update public.signatures
   set method = case when environment = 'production' then 'bankid' else 'bankid_mock' end
 where method = 'bankid_mock';

comment on table public.signatures is
  'Kundens godkännande av en offertversion – en rad per offert. method simple_accept = namn + knapp på offertlänken; evidence bär contentHash, statement, ip, userAgent m.m.';
