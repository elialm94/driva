# Runbook – MFA (TOTP) för plattformsadmin

Alla plattformsadmins måste ha en verifierad TOTP-faktor och en `aal2`-session
för att nå `/admin` (`requirePlatformAdmin()` i `src/lib/platform/auth.ts`).
Kravet kan inte stängas av i produktion. Ingen faktor seedas, ingen hemlighet
lagras av Ferva – reservnyckeln visas en gång vid registreringen.

## 1. Slå på TOTP i Supabase (engångssteg)

1. Supabase Dashboard → **Authentication → Multi-Factor** → *TOTP* = Enabled.
   Det är standard i nya projekt; kontrollera innan första admin loggar in.
2. Behåll *Phone/SMS* avstängt – Ferva stöder bara TOTP.
3. **Verifiera:** `GET /api/health` får inte innehålla `admin_mfa_not_required`
   i `warnings[]` i produktion. Systemvyn `/admin/system` visar *MFA-krav för admins: Påslaget (AAL2 krävs)*.

## 2. Första registrering

1. Admin loggar in på `/login` som vanligt (aal1) och går till `/admin`.
2. `(panel)/layout.tsx` skickar hen till `/admin/mfa`: QR-kod + reservnyckel
   (TOTP-hemligheten i klartext). **Skriv ner reservnyckeln** i lösenordshanteraren
   innan första koden verifieras – den visas aldrig igen.
3. Första koden verifieras (`challengeAndVerify`) → audit `admin_mfa_enrolled`
   → adminytan öppnas.

## 3. Ny inloggning med faktor

Admin med faktor men `aal1`-session redirectas till `/admin/mfa` och anger kod.
Server actions med `aal1` ger 403 i stället – ladda om sidan så utmaningen visas.

## 4. Ny enhet / byte av telefon (admin har fortfarande den gamla)

`/admin/mfa` (menyn **Säkerhet**) → *Lägg till enhet* → verifiera → ta bort den
gamla faktorn (kräver `aal2`, audit `admin_mfa_unenrolled`).

## 5. Förlorad enhet

| Vem | Åtgärd |
| --- | --- |
| Admin med reservnyckel | Lägg in nyckeln manuellt i valfri TOTP-app (Base32-hemlighet) → logga in → byt enhet enligt punkt 4 |
| Annan admin, en `super_admin` finns | `super_admin` → `/admin/admins` → raden → **Återställ MFA** med skäl. Service role tar bort alla faktorer (`auth.admin.mfa.deleteFactor`), audit `admin_mfa_reset`. Personen tvingas registrera ny faktor vid nästa besök. Aldrig på sig själv. |
| **Enda** `super_admin` utelåst | Supabase Dashboard → **Authentication → Users** → användaren → *Remove MFA factors*. Nästa besök på `/admin/mfa` tvingar ny registrering. Skriv en manuell notering i `admin_audit_log` (SQL, service role) med skäl och datum – dashboardsteget lämnar inget spår i Ferva. |

## 6. Kontroller efter varje åtgärd

- `/admin/admins` visar MFA-status per admin (kräver att `SUPABASE_SERVICE_ROLE_KEY`
  är satt – annars "okänd").
- `admin_audit_log`: `admin_mfa_enrolled` / `admin_mfa_unenrolled` / `admin_mfa_reset`
  med aktör, mål och skäl.
- Sentry/loggar innehåller aldrig koder eller TOTP-hemligheter (skrubbning i
  `src/lib/observability/scrub.ts`).

## 7. Aldrig

- Sätt aldrig `PLATFORM_ADMIN_REQUIRE_MFA=0` i produktion – koden ignorerar
  det, men sätt det inte i Vercel heller (staging utan TOTP är enda syftet).
- Dela aldrig reservnyckel i chatt/mejl. Ta aldrig bort en faktor "för att
  testa" i produktion.
