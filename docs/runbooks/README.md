# Runbooks – Ferva drift

Korta, konkreta checklistor för driftansvarig. Alla förutsätter åtkomst till
Vercel-projektet, Supabase-projektet och Ferva Admin (`/admin`, TOTP krävs).
Ingen runbook innehåller hemligheter – värden hämtas alltid ur respektive
dashboard.

| Runbook | När |
| --- | --- |
| [incident.md](incident.md) | Appen svarar inte, 500-fel, misstänkt intrång, utelåst admin |
| [nyckelrotation.md](nyckelrotation.md) | Planerad rotation eller misstänkt läcka av en nyckel |
| [epoststopp.md](epoststopp.md) | Kunder får inte offerter/fakturor/bekräftelser; inkommande kvitton kommer inte fram |
| [bankstopp.md](bankstopp.md) | Bankkopplingen (Tink) hämtar inte transaktioner eller går inte att koppla |
| [stripe-webhook-fel.md](stripe-webhook-fel.md) | Abonnemang aktiveras inte, webhookfel i systemvyn/Stripe |
| [filing-fel.md](filing-fel.md) | Deklarationsfil kan inte genereras eller filing-leverantören felar |
| [backup-restore.md](backup-restore.md) | Aktivera/verifiera PITR, genomföra och registrera restore drill |
| [epost-produktion.md](epost-produktion.md) | Sätta upp och verifiera SPF/DKIM/DMARC, webhooks, inbound MX, auth-hook |

Var alltid börjar: **`/admin/system`** (verifierbar status, senaste fel,
korrelations-id) och **`GET /api/health`** (utan inloggning, `warnings[]`).
Sentry-fel har taggen `correlationId` som också visas i loggar/svar.
