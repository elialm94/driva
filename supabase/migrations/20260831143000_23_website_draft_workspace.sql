-- Utkast för sektioner och primärknapp så att den publika sajten
-- inte ändras förrän Publicera, och så att Återställ kan slänga utkastet.
alter table public.websites add column if not exists draft_sections jsonb;
alter table public.websites add column if not exists draft_primary_cta jsonb;
