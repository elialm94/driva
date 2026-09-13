# Ferva Admin – internt driftverktyg för plattformsteamet

Ferva Admin (`/admin`) är plattformsoperatörernas yta: användare, företag,
support, säkra driftåtgärder, audit och riktiga mätvärden. Den är **helt
separerad** från kundappen och redovisningsytan (`/redovisning`) – samma
Supabase-inloggning, men ett eget auktoriseringslager.

Tre begrepp som aldrig blandas ihop:

| Begrepp | Behörighetskälla | Räckvidd |
| --- | --- | --- |
| **Kund** | `business_memberships` (owner m.fl.) | Sitt eget företag |
| **Samarbetspartner** | `business_memberships` (t.ex. `accounting_consultant`) | Explicit tilldelade företag |
| **Ferva-admin** | `platform_admins` | Hela plattformen |

En platform-admin har **noll** tenantbehörighet av sin adminroll – tenantaccess
sker bara via en explicit, tidsbegränsad, auditerad supportsession.

## Roller

Exakt två roller:

- **`super_admin`** – allt nedan **plus** hantera adminteamet (bjuda in,
  inaktivera, ta bort, återaktivera admins).
- **`admin`** – hela den operativa ytan (användare, företag, support,
  supportläge, mätvärden, system) men kan **aldrig** röra en super_admin:
  inte ta bort, inte inaktivera, inte ändra roll, inte skapa super_admin,
  inte uppgradera sig själv.

Servern är källan till sanning: varje server action går genom
`requirePlatformAdmin()` / `requireSuperAdmin()` i `src/lib/platform/auth.ts`
(verifierad Supabase-session → aktiv `platform_admins`-rad → rollkrav →
operation). UI:t döljer bara det som ändå skulle nekas. En `admin` som anropar
en super_admin-åtgärd manuellt får 403.

**Sista-super_admin-skyddet:** den sista aktiva super_admin kan inte tas bort,
inaktiveras eller nedgraderas. Upprätthålls i tjänstelagret **och** av
databastriggern `app.platform_admins_guard()` – även direkta SQL-misstag
stoppas. Överlämning: utse först en ny super_admin, hantera sedan den gamla.

## Datamodell

Migration: `supabase/migrations/20260830074500_20_platform_admin.sql`.
Allt fungerar i **båda lagringslägena** – Supabase/Postgres (RLS) och lokalt
JSON-läge (`.data/platform.json` via `src/lib/platform/registry.ts`).

| Tabell | Innehåll |
| --- | --- |
| `platform_admins` | user_id → `auth.users`, roll, created_by, disabled_at/by |
| `platform_admin_invitations` | e-post, roll, **token_hash** (sha256 – klartext lagras aldrig), utgång, accepterad/återkallad |
| `support_tickets` | kundens supportärenden: företag, användare, ämne, meddelande, status, prioritet, tilldelad admin, rutt/useragent/appversion, ev. bilaga |
| `support_sessions` | admin, företag, **skäl (obligatoriskt)**, started_at, expires_at, ended_at, ev. ticket-koppling |
| `admin_audit_log` | central plattformsaudit: admin, roll, action, target, metadata – **immutabel** (update/delete blockeras av trigger) |
| `email_events` | transaktionsmejl: kind, mottagare, status (sent/failed/not_configured), fel, provider-id |
| `suggestion_events` (migration 49) | bankklassificeringens förslagsbeslut: källa, nivå (saker/troligt/osakert), beslut (auto/accepted/changed/rejected/private), riskflaggor, motpartstyp, kunskapsbas-/regelversion, ev. LLM-leverantör/modell/promptversion, sha256-hash av indata, beloppsspann. **Aldrig motpartstext, belopp, dokumentinnehåll eller personnummer.** |
| `businesses` – abonnemang (migration 51) | Stripe-fälten `stripe_customer_id`, `stripe_subscription_id`, `stripe_price_id`, `stripe_status`, `current_period_end`, `cancel_at_period_end`, `billing_updated_at`, `billing_event_created`; `subscription_status` får `past_due` (grace). Alla fryses av triggern `businesses_subscription_frozen` – bara faktureringsflödet (som sätter `app.allow_subscription_update = 1` i sin transaktion) får skriva; en medlems PATCH via Data API:t kan aldrig aktivera ett abonnemang. |
| `terms_acceptances` (migration 53) | append-only: användare, ev. företag, dokument, version, tidpunkt, källa (signup/app/checkout/admin), e-post vid tillfället. Trigger `terms_acceptances_immutable`. Ingen IP/user agent. |
| `business_settings.claims` (migration 54) | företagets aktiva verifieringar av F-skatt (bekräftelsedag, källa) och ansvarsförsäkring (bolag, giltig t.o.m., bekräftelsedag, källa). Genererad text påstår bara det som är verifierat. Migrationen nollar även `default_quote_terms` som är identisk med den gamla systemtexten (egna villkor rörs inte). |
| `stripe_webhook_events` (migration 51) | idempotent logg per Stripe event-id: mottagen, Stripes `created`, typ, livemode, API-version, företag, status (mottagen/bearbetad/ignorerad/fel), sanerat fel. **Ingen payload lagras.** |
| `platform_ops_records` (migration 52) | driftposter för systemvyn: `restore_drill`, `email_test_outbound`, `email_inbound`, `cron_run` – status, miljö, ansvarig och räknare i `summary` (icke-känslig JSON). Aldrig mejlinnehåll eller kunddata. |
| `filing_submissions` (migration 50) | två nya kolumner för manuell inlämning: `downloaded_at` (när filen hämtades) och `manual_receipt` (jsonb: referens, notering, ev. kvittensfil `{filename, contentType, sizeBytes, storagePath}`, rapporterad när/av vem). Provider-checken tillåter `'manuell'`; signatur- och id-kraven gäller inte manuella rader, men en manuell rad i `inlamnad`/`kvitterad` **måste** ha `manual_receipt`. Kvittensfilen ligger i den privata bucketen `receipts` under `<business_id>/<submission_id>/`. |

Dessutom två nya kolumner på `businesses`: `is_demo` (demo exkluderas ur KPI:er)
och `disabled_at` (avstängda företag försvinner ur medlemmarnas företagslistor).

**RLS:** plattformstabellerna är låsta för `authenticated`/`anon` (kunder ser
ingenting, oavsett API). Appens serverroll (`driva_app`) når dem bara när
plattformskontexten är satt via GUC (`app.platform_admin_user_id`), vilket
enbart sker i adminflödena efter `requirePlatformAdmin()`. Undantag:
`support_tickets`, `email_events` och `suggestion_events` tillåter insert från
vanlig tenantkontext så att kundens "Hjälp & support", mejlloggen och
beslutsloggen fungerar. Ordinarie tenant-RLS är orörd.

### Förslag (`/admin/forslag`)

Kvalitetsvyn för den evidence-first-baserade bankklassificeringen
(`src/lib/services/bank-suggestion.ts`, kunskapsbas i
`src/lib/banking/merchants.ts`). Aggregerat över alla företag, 30 dagar:
godkända/ändrade/avvisade/privat per nivå, källa och motpartstyp, andel falskt
positiva (förslag som visades som Säker/Troligt men ändrades), vilka
riskflaggor som krävde människa, LLM-inblandning och AI-kostnad ur
`platformOverview().ai`. Rapporten byggs av
`src/lib/platform/suggestion-quality.ts`; loggningen sker i
`src/lib/services/suggestion-log.ts` och får aldrig stoppa en bokföring.

## Bootstrap av första super_admin (produktion)

Ingen klientväg, ingen publik flagga, inget hårdkodat. Exakta steg:

1. Personen skapar/har ett vanligt Ferva-konto (Supabase Auth) – logga in en
   gång så att användaren finns i `auth.users`.
2. Kör från en maskin med produktionsmiljövariablerna (kräver
   `SUPABASE_DB_URL`/`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`):

   ```bash
   npm run platform:bootstrap -- --email almqvist94@hotmail.com
   # eller exakt: --user-id <supabase-auth-uuid>
   # eller via env: PLATFORM_SUPER_ADMIN_USER_ID=<uuid> npm run platform:bootstrap
   ```

   Skriptet läser `.env.local`/`.env` i arbetskatalogen; alternativt
   `vercel env pull .env.local --environment=production` först. Det fungerar
   **bara** med server-side produktionscredentials och en **befintlig,
   verifierad** Supabase Auth-användare – det finns ingen publik route,
   ingen hemlig query-parameter och ingen hårdkodad admin.

3. Skriptet verifierar att auth-användaren finns (service-rollen), upsert:ar
   `platform_admins`-raden som aktiv `super_admin` och loggar `admin_bootstrap`
   i `admin_audit_log`. Idempotent – en redan aktiv super_admin lämnas orörd.
4. Personen loggar in som vanligt och öppnar `/admin` → tvingas registrera
   TOTP (se MFA nedan) → adminytan öppnas.

Alternativ utan skript: samma upsert direkt i SQL mot `platform_admins`
(service-/superuser-anslutning) – triggern och audit gäller ändå.

## Fler admins – inbjudningsflödet

`super_admin` → `/admin/admins` → **Bjud in admin** (e-post). En engångslänk
(`/admin/inbjudan/<token>`, giltig 7 dagar, endast hash lagras) mejlas via
Resend. Mottagaren loggar in med (eller skapar) ett Ferva-konto på **exakt**
den e-postadressen och accepterar → `platform_admins`-rad med roll `admin`.
`admin` kan inte bjuda in någon. Inbjudningar kan skickas om och återkallas.

## Inloggning, MFA och sessioner

- Vanlig Supabase-inloggning på `/login`. Ingen separat admin-lösenordsbutik.
- Vanliga användare på `/admin` → 403-sida ("Du har inte behörighet…").
  Utloggade → redirect till `/login?next=/admin`.
- Ingen auto-redirect till `/admin` efter inloggning – en admin som också är
  vanlig Ferva-användare jobbar i kundappen tills hen själv går till `/admin`.
- **MFA (TOTP, Supabase Auth) – obligatoriskt för alla plattformsadmins.**
  Vanlig e-post/lösenord- eller magic-link-inloggning är `aal1` och räknas
  inte som MFA. `requirePlatformAdmin()` kräver `aal2` för **alla**
  adminsidor och server actions (`src/lib/platform/auth.ts`).
  - I Supabase-läget är kravet på som standard och kan **inte** stängas av i
    produktion (`VERCEL_ENV=production`/`NODE_ENV=production`). Utanför
    produktion kan `PLATFORM_ADMIN_REQUIRE_MFA=0` stänga av det för en
    staging utan TOTP. JSON-läget (dev) har ingen Supabase Auth och därmed
    ingen MFA – tydligt separat och stoppat i produktion.
  - **Registrering:** `/admin/mfa` (utanför panel-layouten – inget admindata
    renderas). Admin utan verifierad faktor skickas dit av `(panel)/layout.tsx`
    och får QR-kod + **reservnyckel** (TOTP-hemligheten, visas en gång, lagras
    aldrig av Ferva) och verifierar med första koden
    (`supabase.auth.mfa.enroll` → `challengeAndVerify`). Audit
    `admin_mfa_enrolled`.
  - **Utmaning:** admin med faktor men `aal1`-session redirectas till
    `/admin/mfa` (kodfält, `challengeAndVerify`) i stället för en rå 403.
    Server actions med `aal1` får däremot ett tydligt 403-fel.
  - **Hantering:** under `/admin/mfa` (menyn **Säkerhet**) kan admin lägga
    till fler enheter och ta bort en faktor – borttagning kräver `aal2`
    (Supabase nekar annars). Audit `admin_mfa_unenrolled`.
  - **Återställning (förlorad enhet):** endast `super_admin`, under
    `/admin/admins` → **Återställ MFA** på raden, med obligatoriskt skäl.
    Service role (`auth.admin.mfa.deleteFactor`) tar bort personens
    faktorer; audit `admin_mfa_reset` med skäl. Personen tvingas registrera
    ny faktor vid nästa besök. Aldrig på sig själv. Är den **enda**
    superadminen utelåst: Supabase Dashboard → Authentication → Users →
    användaren → *Remove MFA factors* (dokumenterat i
    `docs/runbooks/incident.md`).
  - Supabase: TOTP är påslaget som standard i alla projekt
    (Authentication → Multi-Factor → TOTP). Inga faktorer seedas någonsin.
  - Plattformstabellerna nås aldrig via Data API (inga policyer för
    `authenticated`/`anon`), så en `aal1`-session kan inte läsa dem ens
    direkt mot PostgREST; SQL-vägen auktoriseras server-side före varje
    anrop.
- Adminbehörighet bor aldrig i klienttillstånd/localStorage – varje request
  slår upp `platform_admins` på nytt (React `cache` per request).

## Supportläge ("Öppna som kund")

Inte impersonation – en explicit, kort, auditerad session:

1. Admin klickar **Starta supportläge** (från ärende eller företagsdetalj) och
   måste ange **skäl**.
2. `support_sessions`-rad skapas (admin, företag, skäl, ev. ärende,
   `expires_at` = 60 min). Ev. tidigare aktiv session för samma admin avslutas.
3. Cookien `driva_support_session` (httpOnly, sameSite=lax, secure i prod)
   pekar ut radens id, och `driva_business` sätts till kundens företag.
   **Cookien bär ingen behörighet** – varje request verifierar: giltig
   auth-session → aktiv platform_admin → sessionsrad som tillhör just den
   adminen, inte avslutad, inte utgången.
4. I kundappen injiceras ett syntetiskt owner-medlemskap för exakt det
   företaget (`listMemberships` i `src/lib/auth/session.ts`), så ordinarie
   tjänster och RLS fungerar oförändrat.
5. En persistent banner visas överallt i kundappen:
   "SUPPORTLÄGE – Du arbetar med {företag} \[Avsluta]". Aldrig otydligt vilken
   tenant som påverkas.
6. **Audit:** alla skrivningar under supportläge loggas med **adminen** som
   aktör ("… (Ferva-support)") i tenantens `audit_log`, plus en
   `support_write`-post i `admin_audit_log`. Start/slut loggas också.
7. Avslut: bannerns **Avsluta**, admin-UI:t, eller automatiskt vid utgång.

## Kundens "Hjälp & support"

Länk i kundappens meny (desktop-sidfot + mobilens "Mer") → `/support`:
kort beskrivning + valfri bild/PDF. Metadata (användare, företag, aktuell
rutt, useragent, appversion, tidsstämpel) bifogas automatiskt – kunden skriver
aldrig teknisk info. **Ärendet sparas i `support_tickets` och syns i
`/admin/support`** – mejl är inte ett krav och får aldrig stoppa skapandet.
Kön visar Datum/Företag/Användare/Ärende/Status; i detaljen [Öppen] [Pågår]
[Löst], intern anteckning, **Öppna företag** och **Starta supportläge**.

## Miljövariabler

| Variabel | Krävs | Beskrivning |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | För användaråtgärder | Endast serversidan (aldrig `NEXT_PUBLIC`). Används av auth-admin-åtgärder: skicka om verifiering, inaktivera/radera auth-konto, e-postuppslag. Utan nyckel visas åtgärderna som ärligt otillgängliga. |
| `PLATFORM_SUPER_ADMIN_USER_ID` | Vid bootstrap | Alternativ till `--user-id`/`--email` för `npm run platform:bootstrap`. |
| `PLATFORM_ADMIN_REQUIRE_MFA` | Nej (default **på**) | `0` stänger av MFA-kravet **endast utanför produktion** (staging utan TOTP). I produktion krävs alltid `aal2`. |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | För felövervakning | Server/edge respektive klient. Utan DSN initieras Sentry inte. `SENTRY_ENVIRONMENT` valfritt; `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` endast för source maps i build; `SENTRY_TENANT_SALT` valfritt – utan salt skickas ingen tenant-hash. Se avsnittet Drift. |
| `RESTORE_DRILL_DB_URL`, `RESTORE_DRILL_STAGING_REF`, `PRODUCTION_SUPABASE_PROJECT_REF` | Vid restore drill | Endast för `npm run restore:drill` (staging). Se `docs/runbooks/backup-restore.md`. |
| `DRIVA_APP_URL` (eller `APP_URL`) | I produktion | Absolut bas-URL för inbjudningslänkar i mejl och Stripe-retur-URL:er. |
| `LEGAL_ENTITY_NAME`, `LEGAL_ENTITY_ORG_NUMBER`, `LEGAL_ENTITY_ADDRESS`, `LEGAL_CONTACT_EMAIL` (+ valfri `LEGAL_PRIVACY_EMAIL`) | **I produktion** | Juridisk avtalspart för villkor, integritetspolicy och biträdesavtal. Saknas de: sidorna visar öppet *[avtalspart ej konfigurerad]*, `/api/health` svarar 503 i produktion (`legal_entity_incomplete`), systemvyn visar rött och Stripe Checkout vägrar starta. Organisationsnumrets kontrollsiffra valideras. Se avsnittet Juridik. |
| `FILING_PROVIDER_NAME`, `FILING_PROVIDER_TERMS_URL` | När filing är aktiv | Namn och avtalslänk för inlämningsleverantören på `/underbitraden`. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID` (+ valfri `STRIPE_PUBLISHABLE_KEY`) | För abonnemang | Server-only. Alla tre krävs, annars visar Inställningar → Konto *Abonnemangsbetalning är inte konfigurerad* och inget abonnemang simuleras. Systemvyn listar konfigurationsproblem i klartext (blandade test/live-nycklar, live-nyckel utanför produktion, `prod_` i stället för `price_`). Se avsnittet Abonnemang nedan och `.env.example`. |
| Befintliga | – | Supabase-URL/nycklar, `SUPABASE_DB_URL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` återanvänds. Inga nya publika variabler. |

## Produktionsuppsättning (Vercel + Supabase)

1. **Migrera:** kör migrationerna som vanligt (inkl.
   `20260830074500_20_platform_admin.sql`) mot produktions-Postgres.
   `npm run test:db` validerar hela kedjan mot PGlite innan.
2. **Vercel-miljö:** kontrollera `SUPABASE_SERVICE_ROLE_KEY` (server-only) och
   `DRIVA_APP_URL=https://…`. Sätt `SENTRY_DSN` (och ev.
   `NEXT_PUBLIC_SENTRY_DSN`) för felövervakning. Lämna
   `PLATFORM_ADMIN_REQUIRE_MFA` osatt – MFA krävs alltid i produktion.
3. **Bootstrap:** kör `npm run platform:bootstrap -- --email …` (steg ovan).
4. **Verifiera:** logga in → `/admin` → registrera TOTP på `/admin/mfa` →
   adminytan öppnas; en icke-admin ser 403; bjud in nästa admin från
   `/admin/admins`.
5. **Drift:** `/admin/system` visar version, migrationsläge, Sentry, Resend
   (ut/in + testmejl), Stripe, Tink, filing, cron, webhooks och backup/restore
   – se avsnittet Drift och `docs/runbooks/`.

## Abonnemang (Stripe Billing)

Spec §5. Koden ligger i `src/lib/billing/*`; webhooken i
`src/app/api/stripe/webhook/route.ts` (publik sökväg i `src/proxy.ts`,
signaturen verifieras mot den råa kroppen); knapparna i
`src/components/abonnemang-card.tsx` (Inställningar → Konto) och
serveråtgärderna i `src/app/abonnemang-actions.ts`.

**Affärsregler i koden**

- Nya företag startar 14 dagars provperiod utan kort (migration 24, oförändrat).
  Under provperioden står dagarna kvar diskret under Konto – ingen banner.
- **Fortsätt med Ferva** → Stripe Checkout (`mode: subscription`, kund skapas
  server-side, `client_reference_id` = företagets id). Checkout-success
  aktiverar aldrig något: bannern på Konto säger *aktiveras så snart Stripe
  bekräftat*, och webhooken skriver tillståndet.
- Webhooken är sanningskälla: `checkout.session.completed`,
  `customer.subscription.created/updated/deleted/paused/resumed/trial_will_end`,
  `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`,
  `invoice.payment_action_required`. Faktura- och checkouthändelser läser om
  abonnemanget från Stripe. Dubbletter (samma event-id) och händelser med
  äldre `created` än det som redan skrivits ignoreras.
- Kanoniskt tillstånd: `trialing` / `active` / `past_due` (grace: full
  åtkomst, banner *Betalning väntar*) / `expired` / `canceled` (full åtkomst
  till `current_period_end`). `unpaid`/`paused` från Stripe ⇒ `expired`.
- **Skrivskydd** (`withBusiness` → `assertWritable`): provperiod slut utan
  abonnemang eller upphört abonnemang ⇒ `SubscriptionReadOnlyError` för alla
  skrivande flöden utom de som skickar `allowReadOnly: true` (Checkout,
  kundportal). Läsning, export och support fungerar alltid. Företag från före
  provperiodsmodellen (`subscription_status is null`) och demoföretag låses
  aldrig.
- Uppsägning sker i Customer Portal och gäller till periodens slut. Data
  raderas aldrig automatiskt.

**Uppsättning (dashboard)**

1. Stripe → Products → *Ferva*, pris 199 kr/månad, återkommande, SEK, exklusive
   moms → `STRIPE_PRICE_ID`.
2. Developers → Webhooks → endpoint `https://<prod>/api/stripe/webhook` med
   händelserna ovan → `STRIPE_WEBHOOK_SECRET`.
3. Settings → Billing → Customer portal: tillåt byte av betalmetod, kvitton
   och uppsägning vid periodens slut; inga planbyten.
4. Vercel: `STRIPE_SECRET_KEY` (sk_live_ bara i Production), `STRIPE_WEBHOOK_SECRET`,
   `STRIPE_PRICE_ID`. Preview-miljöer får test-nycklar och en egen test-webhook.
5. Kör migration 51 (pending schema lägger annars till kolumnerna vid första
   skrivningen, men triggern som fryser fälten kommer bara med migrationen).
6. Verifiera i `/admin/system` → *Abonnemang (Stripe)*: läge, webhookfel 7 d,
   senaste webhook.

**Lokalt**: `stripe listen --forward-to localhost:3123/api/stripe/webhook`,
sedan `stripe trigger checkout.session.completed` /
`customer.subscription.updated` / `invoice.payment_failed`. Tester utan nätverk:
`src/lib/billing/billing.test.ts` (signaturen verifieras med SDK:ns
`generateTestHeaderString`).

## Drift: felövervakning, systemvy, backup och runbooks

### Felövervakning (Sentry)

`@sentry/nextjs` är integrerat för server (`sentry.server.config.ts`), edge
(`sentry.edge.config.ts`) och klient (`src/instrumentation-client.ts`);
`src/instrumentation.ts` registrerar per runtime och exporterar
`onRequestError = Sentry.captureRequestError`; `app/global-error.tsx` fångar
renderfel. `next.config.ts` wrappas med `withSentryConfig` **bara när en DSN
finns** – utan konfiguration är bygget oförändrat.

Skydd (`src/lib/observability/scrub.ts`, testat i `scrub.test.ts`):
request-body, cookies, headers, query-strängar, lokala variabler, e-post/IP
tas alltid bort; fritext skrubbas för personnummer, JWT/Bearer, Stripe-,
Resend-, Supabase- och AI-nycklar, anslutningssträngar, IBAN, långa
nummerserier och base64-blobbar; console-/UI-brödsmulor kastas; endast
taggarna i `ALLOWED_TAGS` (route, integration, correlationId, release,
tenant-hash …) passerar. Ingen Session Replay. `sendDefaultPii: false`.

`reportSafeError(error, { route, integration, businessId })`
(`src/lib/observability/report.ts`) används i webhook/cron-vägar, sätter
taggar och returnerar ett korrelations-id som också loggas/svaras ut.
Tenant-id skickas bara som `sha256(SENTRY_TENANT_SALT:businessId)` – utan
salt skickas ingen tenant-tagg.

### Systemvy (`/admin/system`)

Endast verifierbar status, aldrig grönt av artighet: version (release),
migrationer (DB `supabase_migrations.schema_migrations` vs
`EXPECTED_MIGRATION_VERSION` i `src/lib/storage/schema-version.ts`, testat
mot katalogen), Sentry (server/klient/source maps), Resend (utgående fel,
senaste testmejl, senaste inkommande webhook), Stripe (läge, webhookfel,
senaste händelse, köade), Tink/filing (konfigurerat eller ej), påminnelsecron
(senaste körning, >36 h ⇒ Fel), backup/restore (PITR-bekräftelse, senaste
dokumenterade restore drill, RPO/RTO, ansvarig – **Ej verifierat** tills en
super_admin registrerat en riktig drill). Driftposterna bor i
`platform_ops_records` (migration 52; JSON-läget: `.data/platform.json`):
`cron_run` (skrivs av `/api/cron/reminders`), `email_inbound`
(`/api/inbox/inbound`, bara HTTP-status), `email_test_outbound` (knappen
**Skicka testmejl** till adminens egen adress – aldrig fri mottagare, aldrig
innehåll), `restore_drill` (formuläret, super_admin, audit
`restore_drill_recorded`).

`GET /api/health` (utan inloggning, inga hemligheter) svarar dessutom med
`ops`: release, migrationsläge, senaste cron, Stripe-webhookfel, Sentry
konfigurerad, MFA-krav, restore drill verifierad samt `warnings[]`
(`migrations_behind`, `cron_stale`, `cron_failed`, `cron_never_ran`,
`stripe_webhook_failures`, `restore_drill_unverified`,
`sentry_unconfigured`, `admin_mfa_not_required`) – larmbara från en extern
monitor. Varningar fäller inte statuskoden (annars larmflimmer).

### Backup/restore

Supabase PITR/backup kan inte läsas via API och simuleras därför inte –
aktivering och verifiering är dokumenterad steg för steg i
`docs/runbooks/backup-restore.md`. `npm run restore:drill -- --target staging
--staging-ref <ref>` (`scripts/restore-drill.ts`) verifierar en **återläst
staging-kopia** i en READ ONLY-transaktion: kärnschema + senaste migration,
immutabilitetstriggrar, tenantantal, ledger-checksumma och debet = kredit per
företag. Scriptet vägrar allt annat än `--target staging`, kräver explicit
staging-identitet i värdnamnet och vägrar värdnamn som matchar
produktionsprojektet. RESULT-raden klistras in i systemvyns formulär.

### Runbooks (`docs/runbooks/`)

`incident.md`, `nyckelrotation.md`, `epoststopp.md`, `bankstopp.md`,
`stripe-webhook-fel.md`, `filing-fel.md`, `backup-restore.md`,
`epost-produktion.md` (SPF/DKIM/DMARC, bounce/complaint, Resend-signatur,
inbound MX, auth email hook).

## Juridik och dataskydd (spec §7)

Allt juridiskt härleds från ett centralt register i `src/lib/legal/`:

- `entity.ts` – avtalsparten ur `LEGAL_*`-env (aldrig hårdkodad).
- `providers.ts` – leverantörs-/underbiträdesregistret. En leverantör listas
  bara när den faktiskt är påslagen (nyckel/konfiguration finns): Vercel,
  Supabase, Resend, Stripe (självständigt ansvarig), Tink, OpenRouter eller
  generisk AI-leverantör, Google Maps (klientsida), Sentry, aktiv
  inlämningstjänst. Projektberoende uppgifter (vald region) är märkta
  *verifieras vid go-live* och listas i systemvyn under **Juridik &
  leverantörsregister → Att verifiera**.
- `documents.ts` – versionerade texter: `/villkor` (v2.0), `/integritet`
  (v2.0), `/bitradesavtal` (DPA + säkerhetsbilaga, v1.0) och den publika
  `/underbitraden`. Alla sidor bär **utkastmarkering** tills juridisk granskning
  registrerats i `GO_LIVE_CHECKLIST.md`.
- `acceptance.ts` – villkorsgodkännande per användare (tabell
  `terms_acceptances`, migration 53, append-only). Signup kräver kryssrutan och
  skriver `terms_version` i user_metadata som bevis; första inloggade
  sidladdningen flyttar beviset till tabellen (`source = signup`). Höjd
  **major**-version ⇒ `/godkann-villkor` visas före all företagsdata (app-,
  redovisnings- och onboardinglayouten) och `withBusiness` vägrar skrivningar
  tills nytt aktivt godkännande finns. Minor-ändringar kräver inget nytt
  godkännande.
- `data-subject.ts` – registrerades export: `GET /api/konto/export` (JSON med
  konto, medlemskap, godkända villkor, egna supportärenden) från
  Inställningar → Konto → *Dina uppgifter och avtal*.

Admin: användarvyn har **Registrerades begäran (GDPR)** – rättelse (loggas),
radering (raderingspolicyn, blockeras av bokföringslagen) eller
**anonymisering** (auth-e-post/telefon ersätts med platshållare, supportärenden
anonymiseras, medlemskap återkallas, företag med bevarandeplikt inaktiveras och
behålls skrivskyddade). Radering/anonymisering kräver super_admin, grund och
bekräftelse; allt auditeras (`data_subject_request`, `user_anonymized`) utan
att den gamla adressen loggas.

Raderingstexten är harmoniserad med bokföringslagen: räkenskapsinformation
bevaras sju år efter räkenskapsårets utgång och utlovas aldrig raderad i förtid.

## PWA, offline-fältläge och mobilskal (spec §9)

**PWA.** `src/app/manifest.ts` ger `/manifest.webmanifest` (installerbar på
Android/Chrome och iOS "Lägg till på hemskärmen"); ikonerna i `public/icons/`
är platshållare genererade av `scripts/generate-pwa-icons.ts`. Service workern
serveras av `/sw.js` (`src/app/sw.js/route.ts`) med release-strängen inbakad
som version – varje deploy är en ny worker som raderar föregående versions
cache vid aktivering. Källan (`src/lib/pwa/service-worker-source.ts`) är en
**allowlist**: bara `/_next/static/*`, ikoner/manifest och offline-reservsidan
`/offline` får cachas. HTML för inloggade sidor, RSC-payloads, `/api/*`, auth,
admin, redovisning, dokument (offert/faktura/PDF) och kundlänkar med token
passerar alltid orört. Policyn testas i VM utan webbläsare
(`src/lib/offline/offline.test.ts`). Registrering sker bara i produktion eller
med `NEXT_PUBLIC_PWA_DEV=1`. `experimental.useOffline` håller navigeringar och
server actions väntande vid nätbortfall.

**Offline-fältläge V1 (`/falt`).** Det enda i appen som fungerar utan nät.
Klienten är aldrig sanningskälla: den sparar en *minimerad* uppdragslista
(id, titel, kundnamn, status, adress) för de uppdrag användaren uttryckligen
valt, och en kö av avsikter (arbetstid, anteckning, foto, kvitto, materialrad,
kund-/uppdragsutkast). Kön ligger i IndexedDB (`ferva-offline`) med payload
och blobbar krypterade med en icke-exporterbar AES-GCM-nyckel (WebCrypto);
saknas WebCrypto visas det i fältläget. Synk går via `POST /api/offline/sync`
i seq-ordning med backoff (2 s → 5 min, max 8 automatiska försök) och samma
`withBusiness`-kontroll som formulären: session, tenant, capability per
ärendetyp (`change_jobs`, `manage_customers`, `write_accounting`),
abonnemangets skrivskydd och villkorsgrinden. Servern kvitterar varje ärende i
`offline_mutations` (migration 55, unik per företag + klientnyckel, immutabel)
– en omsändning får första utfallet tillbaka utan att något görs om.
Konflikter (uppdraget klart/borttaget) och avvisningar parkeras i köns
konfliktvy med *Försök igen*/*Ta bort*. Utloggning, tenantbyte och 401/403
från synken raderar hela det lokala lagret inklusive nyckeln. Demosessioner
har inget fältläge.

**Mobilskal.** `mobile/` är ett Capacitor-skal som laddar den driftsatta
PWA:n via `FERVA_APP_URL`; egna beroenden, exkluderat från tsc/eslint. Körbart
lokalt, **inte butiksklart** – återstående punkter står i `mobile/README.md`.

## Supportmatris, eligibility och konsultfall (spec §10)

**Matrisen.** `src/lib/support/matrix.ts` är versionerad
(`SUPPORT_MATRIX_VERSION`) och listar varje fall med nivå *supported* /
*consultant* / *unsupported*, var regeln upprätthålls i koden, primärkälla,
giltighetsdatum, ägare och testfiler. Testet `src/lib/support/support.test.ts`
vägrar poster utan källa/ägare/test och låser spec §10:s nivåer. Byter en post
nivå: bumpa versionen – sparade svar och godkännanden bär versionen de gavs
mot. Publikt läsbar på `/omfattning` (villkoren hänvisar dit).

**Eligibility.** Onboardingens steg 1 har en fråga med fem kryssrutor
(`scope`). Klienten visar beskedet direkt; `createCompanyAction` kör
`assertEligibleToCreate` igen och vägrar skapa bolaget vid *unsupported*.
Svaren sparas i `business_settings.scope` (jsonb, migration 56 + pending-
schema) tillsammans med konsultens godkännanden. Bolag skapade före kolumnen
har `null`: de bedöms bara på företagsformen tills ägaren svarar under
Inställningar → Företag.

**Konsultfall.** Enskild firma och omvänd byggmoms på egna kundfakturor är
tillåtna först när en redovisningskonsult med tillgång till bolaget godkänt
dem på `/redovisning/k/<businessId>/omfattning`. Behörigheten är capability
`approve_scope` (bara `accounting_consultant`; ägare, admin, medlem och
revisor kan inte). Godkännande/återkallande auditloggas
(`omfattning_godkand`/`omfattning_aterkallad`) och skrivs i samma transaktion
som inställningarna. Servervakterna: `collectScopeBlockers` i
`src/lib/invoices/validate.ts` (blocker `scope_reverse_charge`),
`assertCompanyFormSupported` i onboarding och `updateBusinessProfile`,
`assertScopeAllowed(entryId)` för nya funktioner.

**Support.** Frågan "varför kan kunden inte skicka fakturan?" med omvänd
byggmoms: kontrollera att bolaget har en konsult (Samarbeta) och att
konsulten godkänt fallet. Ferva-admin ändrar inte godkännanden åt bolaget.

## Lokal utveckling (JSON-läget)

Utan Supabase-miljö finns en tydligt separerad dev-väg: öppna
`/dev/som-admin` → en seedad **Dev Superadmin** (`admin@driva.internal`)
sätts som lokal identitet och `/admin` öppnas. Rutten gör ingenting i
Supabase-läge och JSON-läget stoppas i produktion av `src/lib/storage/config`.
Plattformsdata bor i `.data/platform.json` (gitignorerad).

## Säkerhetsinvarianter

- Service-rollnyckeln lämnar aldrig servern; ingen SQL-konsol, inga
  fritext-frågor – bara explicita domänåtgärder.
- Farliga åtgärder (radera/inaktivera användare eller företag, ta bort admin)
  kräver bekräftelse som visar vad som påverkas, vad som bevaras och om det
  går att ångra. Radering följer domänpolicy: bokförda räkenskaper bevaras
  (bokföringslagen) – då blockeras radering och inaktivering/anonymisering
  erbjuds i stället. Blind radering av auth-rader förekommer inte.
- Personnummer maskeras som standard i admin-UI:t.
- `admin_audit_log` är immutabel; admins kan inte radera sin egen historik.
- Alla mätvärden på `/admin` definieras i **en** modul
  (`src/lib/platform/metrics.ts`) och bygger enbart på verklig data – inga
  påhittade MRR/ARR/churn-siffror. Demo-företag exkluderas ur KPI:er
  (AI-kostnad visas inklusive demo eftersom kostnaden är verklig).

## Tester

`src/lib/platform.test.ts` täcker rollgränser (admin kan inte röra
super_admin), sista-super_admin-skyddet, inbjudningslivscykeln,
supportsessioner (skäl, utgång, avslut, attribution), raderingspolicyer och
auditens immutabilitet. `scripts/db-validate.ts` verifierar dessutom
Postgres-lagret: triggers, RLS för `authenticated`/`anon`/`driva_app` med och
utan plattformskontext. Kör `npm run test`, `npm run test:db`,
`npm run test:adapter`, `npm run typecheck`, `npm run build`.
`src/lib/offline/offline.test.ts` täcker offline-kön (ordning, beroenden,
backoff, tenantbindning, dataminimering), serverns idempotens/konflikt/
capability-kontroll och service workerns cachepolicy.
