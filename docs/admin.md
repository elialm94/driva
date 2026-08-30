# Driva Admin – internt driftverktyg för plattformsteamet

Driva Admin (`/admin`) är plattformsoperatörernas yta: användare, företag,
support, säkra driftåtgärder, audit och riktiga mätvärden. Den är **helt
separerad** från kundappen och redovisningsytan (`/redovisning`) – samma
Supabase-inloggning, men ett eget auktoriseringslager.

Tre begrepp som aldrig blandas ihop:

| Begrepp | Behörighetskälla | Räckvidd |
| --- | --- | --- |
| **Kund** | `business_memberships` (owner m.fl.) | Sitt eget företag |
| **Samarbetspartner** | `business_memberships` (t.ex. `accounting_consultant`) | Explicit tilldelade företag |
| **Driva-admin** | `platform_admins` | Hela plattformen |

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

Dessutom två nya kolumner på `businesses`: `is_demo` (demo exkluderas ur KPI:er)
och `disabled_at` (avstängda företag försvinner ur medlemmarnas företagslistor).

**RLS:** plattformstabellerna är låsta för `authenticated`/`anon` (kunder ser
ingenting, oavsett API). Appens serverroll (`driva_app`) når dem bara när
plattformskontexten är satt via GUC (`app.platform_admin_user_id`), vilket
enbart sker i adminflödena efter `requirePlatformAdmin()`. Undantag:
`support_tickets` och `email_events` tillåter insert från vanlig tenantkontext
(`app.is_member`) så att kundens "Hjälp & support" och mejlloggen fungerar.
Ordinarie tenant-RLS är orörd.

## Bootstrap av första super_admin (produktion)

Ingen klientväg, ingen publik flagga, inget hårdkodat. Exakta steg:

1. Personen skapar/har ett vanligt Driva-konto (Supabase Auth) – logga in en
   gång så att användaren finns i `auth.users`.
2. Kör från en maskin med produktionsmiljövariablerna (kräver
   `SUPABASE_DB_URL`/`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`):

   ```bash
   npm run platform:bootstrap -- --email person@driva.se
   # eller exakt: --user-id <supabase-auth-uuid>
   # eller via env: PLATFORM_SUPER_ADMIN_USER_ID=<uuid> npm run platform:bootstrap
   ```

3. Skriptet verifierar att auth-användaren finns (service-rollen), upsert:ar
   `platform_admins`-raden som aktiv `super_admin` och loggar `admin_bootstrap`
   i `admin_audit_log`. Idempotent – en redan aktiv super_admin lämnas orörd.
4. Personen loggar in som vanligt och öppnar `/admin`.

Alternativ utan skript: samma upsert direkt i SQL mot `platform_admins`
(service-/superuser-anslutning) – triggern och audit gäller ändå.

## Fler admins – inbjudningsflödet

`super_admin` → `/admin/admins` → **Bjud in admin** (e-post). En engångslänk
(`/admin/inbjudan/<token>`, giltig 7 dagar, endast hash lagras) mejlas via
Resend. Mottagaren loggar in med (eller skapar) ett Driva-konto på **exakt**
den e-postadressen och accepterar → `platform_admins`-rad med roll `admin`.
`admin` kan inte bjuda in någon. Inbjudningar kan skickas om och återkallas.

## Inloggning, MFA och sessioner

- Vanlig Supabase-inloggning på `/login`. Ingen separat admin-lösenordsbutik.
- Vanliga användare på `/admin` → 403-sida ("Du har inte behörighet…").
  Utloggade → redirect till `/login?next=/admin`.
- Ingen auto-redirect till `/admin` efter inloggning – en admin som också är
  vanlig Driva-användare jobbar i kundappen tills hen själv går till `/admin`.
- **MFA-status:** arkitekturen är MFA-redo. Sessionens
  AAL-claim (`aal`) läses redan; med `PLATFORM_ADMIN_REQUIRE_MFA=1` kräver
  `requirePlatformAdmin()` `aal2` (genomförd andra faktor) för **alla**
  adminanrop. Flaggan är av som standard eftersom projektets Supabase-instans
  inte har MFA-enrollment aktiverat ännu. Aktivering: slå på TOTP i Supabase
  Auth-inställningarna, låt adminteamet registrera en faktor (Supabase
  standard-UI/API), sätt sedan flaggan i Vercel.
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
   aktör ("… (Driva-support)") i tenantens `audit_log`, plus en
   `support_write`-post i `admin_audit_log`. Start/slut loggas också.
7. Avslut: bannerns **Avsluta**, admin-UI:t, eller automatiskt vid utgång.

## Kundens "Hjälp & support"

Länk i kundappens meny (desktop-sidfot + mobilens "Mer") → `/support`:
"Vad behöver du hjälp med?" + kort beskrivning + valfri bild/fil. Metadata
(användare, företag, aktuell rutt, useragent, appversion, tidsstämpel) bifogas
automatiskt – kunden skriver aldrig teknisk info. Ärendet hamnar i
`/admin/support` (köflikar Nya/Pågående/Väntar/Klart; status, prioritet,
tilldelning; direktknappar **Öppna företag** och **Starta supportläge**).

## Miljövariabler

| Variabel | Krävs | Beskrivning |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | För användaråtgärder | Endast serversidan (aldrig `NEXT_PUBLIC`). Används av auth-admin-åtgärder: skicka om verifiering, inaktivera/radera auth-konto, e-postuppslag. Utan nyckel visas åtgärderna som ärligt otillgängliga. |
| `PLATFORM_SUPER_ADMIN_USER_ID` | Vid bootstrap | Alternativ till `--user-id`/`--email` för `npm run platform:bootstrap`. |
| `PLATFORM_ADMIN_REQUIRE_MFA` | Nej (default av) | `1` ⇒ `aal2` (MFA) krävs för alla adminanrop. Slå på när Supabase-MFA är aktiverat. |
| `DRIVA_APP_URL` (eller `APP_URL`) | I produktion | Absolut bas-URL för inbjudningslänkar i mejl. |
| Befintliga | – | Supabase-URL/nycklar, `SUPABASE_DB_URL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` återanvänds. Inga nya publika variabler. |

## Produktionsuppsättning (Vercel + Supabase)

1. **Migrera:** kör migrationerna som vanligt (inkl.
   `20260830074500_20_platform_admin.sql`) mot produktions-Postgres.
   `npm run test:db` validerar hela kedjan mot PGlite innan.
2. **Vercel-miljö:** kontrollera `SUPABASE_SERVICE_ROLE_KEY` (server-only) och
   `DRIVA_APP_URL=https://…`. Lämna `PLATFORM_ADMIN_REQUIRE_MFA` osatt tills
   MFA-enrollment är på plats.
3. **Bootstrap:** kör `npm run platform:bootstrap -- --email …` (steg ovan).
4. **Verifiera:** logga in → `/admin` öppnas; en icke-admin ser 403; bjud in
   nästa admin från `/admin/admins`.

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
