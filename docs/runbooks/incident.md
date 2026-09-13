# Runbook: incident

Mål: begränsa skada, återställa tjänsten, dokumentera. Kunddata rör vi aldrig
utan supportsession (auditerad) – felsökning görs på status/loggar.

## 0. Triage (5 min)

1. `GET https://<prod>/api/health` – `status`, `database.*`, `ops.warnings[]`.
   - `misconfigured`/`degraded` ⇒ miljövariabler eller migrationer (steg 2).
2. Vercel → Deployments: senaste deploy grön? Rulla tillbaka (**Promote** föregående
   produktion) om felet började med en deploy.
3. Sentry (om `SENTRY_DSN` satt): Issues, filtrera på `release` = aktuell commit.
   Korrelations-id (`correlationId`-tagg) matchar `[ferva] fel <id>` i Vercel-loggen.
4. Supabase → Reports/Logs: databasfel, anslutningar (pooler port 6543!).
5. `/admin/system` (kräver TOTP): Senaste fel, mejl, webhooks, cron.

## 1. Appen svarar 500 / "Sidan kunde inte laddas"

- Vercel-loggar för routen; `digest` i felsidan matchar loggposten.
- Om `Supabase-miljön saknas` ⇒ env-variabel tappad → sätt om, redeploya.
- Om `set local role driva_app` felar ⇒ rollen saknas i DB → migrationer inte
  körda mot rätt projekt.

## 2. Migrationer saknas (`migrations_behind` / `hasCoreTables:false`)

```bash
npx supabase link --project-ref <prod-ref>
npx supabase db push          # kör bara nya filer i supabase/migrations
```

`/admin/system` → *Version & migrationer* ska visa DB = kod
(`EXPECTED_MIGRATION_VERSION`). Sidladdningsfallbacken
(`applyPendingPageLoadSchema`) täcker kolumner/tabeller tillfälligt men
ersätter inte `db push`.

## 3. Misstänkt intrång eller läckt nyckel

1. Rotera berörd nyckel omedelbart – se [nyckelrotation.md](nyckelrotation.md).
2. Supabase → Authentication → Users: logga ut berörda användare (*Sign out*),
   för admins: kontrollera `admin_audit_log` (`/admin/system`, insert-only).
3. Inaktivera admin vid behov: `/admin/admins` → **Inaktivera**.
4. Dokumentera tidslinje; bedöm anmälningsplikt (IMY inom 72 h) med jurist.

## 4. Utelåst admin (MFA)

- Admin har tappat enheten men **annan super_admin finns**: `/admin/admins` →
  **Återställ MFA** (skäl krävs, audit `admin_mfa_reset`). Personen registrerar
  ny faktor på `/admin/mfa`.
- **Enda** super_admin utelåst: Supabase Dashboard → Authentication → Users →
  användaren → *Multi-factor* → ta bort faktorerna. Logga in igen →
  `/admin/mfa` tvingar ny registrering. Skriv en manuell notering i
  incidentloggen (dashboard-åtgärden syns inte i `admin_audit_log`).
- Ingen admin alls kvar: `npm run platform:bootstrap -- --email <adress>` med
  produktions-env (`docs/admin.md`).

## 5. Databas nere / återläsning

Följ [backup-restore.md](backup-restore.md). Ferva flyttar inga pengar –
ingen betalning behöver stoppas, men Stripe-webhooken retriar automatiskt
(händelser bearbetas idempotent när DB är tillbaka).

## 6. Efteråt

- Skriv post-mortem (vad, när, påverkan, rotorsak, åtgärder).
- Registrera ev. restore drill i `/admin/system` om återläsning gjordes.
- Uppdatera denna runbook om något steg saknades.
