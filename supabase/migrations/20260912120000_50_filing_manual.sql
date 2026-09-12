-- ============================================================================
-- 50 · Manuell inlämning av deklarationer
-- ----------------------------------------------------------------------------
-- Ferva lämnar inte in deklarationer maskinellt utan avtal (FILING_API_*).
-- Standardvägen är därför manuell: användaren hämtar filen, lämnar in den i
-- myndighetens e-tjänst och rapporterar sedan i Ferva att det är gjort, med
-- myndighetens referensnummer och/eller en uppladdad kvittens.
--
--   provider = 'manuell'   raden fördes till kvitterad av användaren själv
--   downloaded_at          när filen senast hämtades för manuell inlämning
--   manual_receipt         jsonb: { reference?, note?, file?, reportedAt,
--                          reportedByName, reportedByUserId? }
--
-- Kvittensfilen (PDF/bild) lagras som kvitton: i privata bucketen `receipts`
-- under <business_id>/<inlämnings-id>/<filnamn> när fillagring finns, annars
-- inline (contentBase64) i manual_receipt.file. Samma tenantpolicy och samma
-- bevarandetid (bokföringsunderlag, 7 år) som kvittona.
--
-- Löftena i statusen står kvar för mock/live. För manuella rader finns ingen
-- signatur i Ferva (användaren signerade i e-tjänsten) och inget id från en
-- leverantör – i stället krävs användarens rapport (manual_receipt).
-- ============================================================================

alter table public.filing_submissions
  add column if not exists downloaded_at timestamptz,
  add column if not exists manual_receipt jsonb;

alter table public.filing_submissions
  drop constraint if exists filing_submissions_provider_check;
alter table public.filing_submissions
  add constraint filing_submissions_provider_check
  check (provider in ('mock', 'live', 'manuell'));

alter table public.filing_submissions
  drop constraint if exists filing_submissions_signed_has_signature;
alter table public.filing_submissions
  add constraint filing_submissions_signed_has_signature check (
    status not in ('signerad', 'inlamnad', 'kvitterad') or signature is not null or provider = 'manuell'
  );

alter table public.filing_submissions
  drop constraint if exists filing_submissions_submitted_has_id;
alter table public.filing_submissions
  add constraint filing_submissions_submitted_has_id check (
    status not in ('inlamnad', 'kvitterad') or provider_submission_id is not null or provider = 'manuell'
  );

alter table public.filing_submissions
  drop constraint if exists filing_submissions_manual_has_report;
alter table public.filing_submissions
  add constraint filing_submissions_manual_has_report check (
    provider <> 'manuell' or status not in ('inlamnad', 'kvitterad') or manual_receipt is not null
  );

comment on column public.filing_submissions.manual_receipt is
  'Användarens egen rapport om manuell inlämning: referensnummer och/eller kvittensfil. Ferva har inte kontrollerat kvittensen hos myndigheten.';
