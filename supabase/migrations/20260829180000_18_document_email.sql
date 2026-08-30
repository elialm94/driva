-- Senaste lyckade e-postleveransen (Resend message id + mottagare).
-- Sätts bara efter provider-succé. Ingen e-post-CRM.

alter table public.quotes
  add column if not exists last_email jsonb,
  add column if not exists last_send_attempt_at timestamptz;

alter table public.invoices
  add column if not exists last_email jsonb,
  add column if not exists last_send_attempt_at timestamptz;
