-- Resor som egen ekonomisk radtyp (TRAVEL).
-- Befintliga arbete/material/ovrigt-rader lämnas orörda – ingen omklassning
-- från beskrivning. Övrigt förblir Övrigt.

alter table public.invoice_line_items
  drop constraint if exists invoice_line_items_kind_check;

alter table public.invoice_line_items
  add constraint invoice_line_items_kind_check
  check (kind in ('arbete', 'material', 'resor', 'ovrigt'));

alter table public.job_work_entries
  drop constraint if exists job_work_entries_type_check;

alter table public.job_work_entries
  add constraint job_work_entries_type_check
  check (type in ('labor', 'material', 'travel', 'other'));
