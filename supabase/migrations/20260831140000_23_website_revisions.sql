-- Revisioner så att en sen hemside-save efter publicering inte kan
-- återskapa utkast och göra redigeraren smutsig igen.
alter table public.websites add column if not exists draft_revision integer not null default 0;
alter table public.websites add column if not exists published_revision integer not null default 0;
