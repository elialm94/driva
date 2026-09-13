# Runbook: nyckelrotation

Alla hemligheter lever **enbart** i Vercel → Settings → Environment Variables
(Production) och i respektive leverantörs dashboard. Aldrig i repo, aldrig i
klientbundlar (inget `NEXT_PUBLIC_` för hemligheter). Efter varje ändring:
**Redeploy** (Vercel läser env vid build/start).

Ordning vid rotation: skapa ny nyckel → sätt i Vercel → redeploya → verifiera
(`/api/health`, `/admin/system`) → återkalla den gamla.

| Nyckel | Skapas i | Verifiera efteråt |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API (rotera JWT-secret roterar alla nycklar – planera nertid) | `/admin/system` → *Auth admin-API: Tillgängligt*; `/admin/admins` MFA-kolumn läsbar |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Samma som ovan | Inloggning fungerar |
| `SUPABASE_DB_URL` (lösenord) | Supabase → Settings → Database → Reset database password. Använd **Transaction pooler (6543)** | `/api/health` `database.canConnect:true` |
| `RESEND_API_KEY` | Resend → API Keys (skapa ny med *Sending + Receiving*, radera gammal efter deploy) | `/admin/system` → **Skicka testmejl** |
| `RESEND_WEBHOOK_SECRET` | Resend → Webhooks → endpointen → *Signing secret* (roll) | Skicka mejl till `test@in.<domän>` → *Inkommande (webhook)* OK |
| `SEND_EMAIL_HOOK_SECRET` | Supabase → Auth → Hooks → Send Email → *Generate secret* (`v1,whsec_…`) | Begär lösenordsåterställning → mejl kommer |
| `INBOUND_MAIL_WEBHOOK_SECRET` | Egen HMAC (`openssl rand -hex 32`) – används bara för manuell POST/tester | – |
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys → *Roll key* (välj övergångstid) | `/admin/system` → *Abonnemang (Stripe)* utan problem; testköp i test-läge |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks → endpointen → *Roll secret* | `stripe trigger customer.subscription.updated` → status *bearbetad* |
| `TINK_CLIENT_SECRET` | Tink Console → App → Credentials | Koppla ett testkonto (sandbox) |
| `FILING_API_TOKEN` | Filing-leverantörens portal | Testinlämning i leverantörens testmiljö |
| `OPENROUTER_API_KEY` | OpenRouter → Keys | Assistenten svarar; `/admin/system` AI-fel = 0 |
| `CRON_SECRET` | `openssl rand -hex 32`; Vercel Cron skickar den automatiskt | Nästa körning syns som `cron_run` i `/admin/system` |
| `SENTRY_AUTH_TOKEN` | Sentry → Settings → Auth Tokens (scope `project:releases`, `org:read`) | Nästa build laddar source maps |
| `SENTRY_TENANT_SALT` | `openssl rand -hex 16`. **Obs:** byte gör gamla tenant-hashar ojämförbara | – |

## Misstänkt läcka

1. Rotera direkt (även om osäkert). 2. Kontrollera användning i leverantörens
logg (Stripe: *Developers → Logs*; Supabase: *Auth logs*; Resend: *Logs*).
3. Följ [incident.md](incident.md) §3.

## Vad som INTE går att rotera utan påverkan

- Supabase JWT-secret: loggar ut alla användare och kräver att både anon- och
  service-nyckel byts samtidigt.
- Byte av `INBOUND_MAIL_DOMAIN`: kundernas visade inbox-adresser ändras –
  behåll gammal domän som alias (se `.env.example`).
