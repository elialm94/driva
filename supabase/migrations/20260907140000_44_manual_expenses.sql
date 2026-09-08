-- Utgifter registrerade för hand (Ekonomi → Ny utgift): privata utlägg,
-- milersättning, traktamente och representation.
--   paid_by  'foretagskonto' (kredit 1930) eller 'privat' (skuld till ägaren, 2893).
--            NULL = företagskontot – alla köp från banken och kvitton hittills.
--   kind     'kop' | 'milersattning' | 'traktamente' | 'representation'. NULL = köp.
--   details  Uppgifterna bakom schablonen (km, bilslag, dagar, personer …) som
--            de såg ut när utgiften bokfördes, för spårbarhet och körjournal.
alter table public.expenses
  add column if not exists paid_by text
    check (paid_by is null or paid_by in ('foretagskonto', 'privat')),
  add column if not exists kind text
    check (kind is null or kind in ('kop', 'milersattning', 'traktamente', 'representation')),
  add column if not exists details jsonb;
