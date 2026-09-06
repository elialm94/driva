-- ============================================================================
-- 41 · SIE-import flyttar även serieräknaren
-- ----------------------------------------------------------------------------
-- Migration 39:s app.import_verification flyttade bara
-- business_sequences.verification. Efter serier (migration 31) läser
-- app.post_verification verification_series->>'A' först. En import av A501
-- lämnade då jsonb-A på t.ex. 15 medan kolumnen blev 502 – nästa egna
-- bokföring fick det gamla numret (eller sequence_conflict i CAS).
-- ============================================================================

create or replace function app.import_verification(p_business_id uuid, p_verification jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number integer := (p_verification ->> 'number')::integer;
  v_series text := coalesce(p_verification ->> 'series', 'A');
  v_entry jsonb;
  v_pos integer := 0;
begin
  if v_number is null or v_number < 1 then
    raise exception 'import_ogiltig: verifikationen saknar nummer' using errcode = 'P0001';
  end if;
  if coalesce(p_verification ->> 'source_type', '') <> 'sie_import' then
    raise exception 'import_ogiltig: bara SIE-importer får behålla eget nummer' using errcode = 'P0001';
  end if;
  perform app.validate_entries(p_verification -> 'entries');

  insert into public.verifications (
    id, business_id, series, number, date, description,
    source_type, source_id, confidence, created_by, status, posted_at,
    fiscal_year_id, corrects_verification_id, explanation, created_at
  ) values (
    p_verification ->> 'id',
    p_business_id,
    v_series,
    v_number,
    p_verification ->> 'date',
    coalesce(p_verification ->> 'description', ''),
    'sie_import',
    p_verification ->> 'source_id',
    coalesce(p_verification ->> 'confidence', 'hog'),
    coalesce(p_verification ->> 'created_by', 'anvandare'),
    'bokford',
    (p_verification ->> 'posted_at')::timestamptz,
    p_verification ->> 'fiscal_year_id',
    null,
    p_verification ->> 'explanation',
    coalesce((p_verification ->> 'created_at')::timestamptz, now())
  );

  for v_entry in select * from jsonb_array_elements(p_verification -> 'entries') loop
    insert into public.accounting_entries (
      verification_id, business_id, position, account, account_name,
      debit, credit, vat_code, note
    ) values (
      p_verification ->> 'id',
      p_business_id,
      v_pos,
      (v_entry ->> 'account')::integer,
      coalesce(v_entry ->> 'account_name', ''),
      coalesce((v_entry ->> 'debit')::bigint, 0),
      coalesce((v_entry ->> 'credit')::bigint, 0),
      v_entry ->> 'vat_code',
      v_entry ->> 'note'
    );
    v_pos := v_pos + 1;
  end loop;

  -- Kolumnen och jsonb-räknaren måste hållas i takt. Serie A speglas i båda;
  -- övriga serier (t.ex. SIE för onumrerade poster) bara i jsonb.
  update public.business_sequences
     set verification = case
           when v_series = 'A' then greatest(verification, v_number + 1)
           else verification
         end,
         verification_series = jsonb_set(
           coalesce(verification_series, '{}'::jsonb),
           array[v_series],
           to_jsonb(
             greatest(
               coalesce(
                 (verification_series ->> v_series)::integer,
                 case when v_series = 'A' then verification else 1 end
               ),
               v_number + 1
             )
           )
         )
   where business_id = p_business_id;
end;
$$;
