# Runbook: bankstopp (Tink)

Ferva läser bara kontoinformation (Tink AIS) och flyttar aldrig pengar.
Ett bankstopp påverkar därför bara bankmatchningen i bokföringen – aldrig
betalningar. Kunden kan alltid fortsätta med manuell kontering och
kontoutdragsimport.

## 1. Avgränsa

| Källa | Kontroll |
| --- | --- |
| `/admin/system` → *Bank (Tink)* | **Ej konfigurerat** ⇒ någon av `TINK_CLIENT_ID`, `TINK_CLIENT_SECRET`, `TINK_REDIRECT_URI` saknas. Kunder ser då bankkopplingen som otillgänglig – inget simuleras. |
| Sentry | Issues med tagg `integration:tink` (skrubbade – ingen banktext). |
| Tink Console → Logs | Fel per anrop (401 = credentials, 429 = kvot, 5xx = Tink). |
| Tink status | https://status.tink.com |
| En kund | `/admin/businesses/<id>` → supportsession → Bokföring → Bank: status på kopplingen. |

## 2. Vanliga orsaker

- **Utgången bankkoppling (90 dagar, PSD2):** normalt – kunden förnyar via
  **Koppla om bank** i appen. Inget att göra på plattformssidan.
- **Redirect-URI stämmer inte:** `TINK_REDIRECT_URI` måste exakt matcha
  Tink Console → App → Redirect URIs (`https://<prod>/api/bank/tink/callback`,
  se `src/app/api/bank/tink/callback/route.ts`). Fel ⇒ Tink Link visar fel före
  bankval.
- **Sandbox vs production:** `TINK_ENV=production` i prod, `sandbox` lokalt.
  Fel miljö ⇒ banklista utan svenska banker eller 401.
- **Bankens eget avbrott:** syns i Tink Console som fel för just den
  providern. Informera kunden; transaktioner hämtas i kapp automatiskt när
  banken är uppe.
- **Roterad secret:** [nyckelrotation.md](nyckelrotation.md).

## 3. Under stoppet

- Kundens arbete blockeras inte: bokföring, fakturering, moms fungerar utan
  banken. Bankmatchningen visar äldre transaktioner; nya kommer efter
  återkoppling.
- Sätt ett meddelande i supportärenden vid längre störning. Lova inte
  återhämtning innan Tink/banken bekräftat.

## 4. Efteråt

- Kontrollera att hämtningen kommer i kapp (senaste transaktion per kund).
- Dubbletter kan inte uppstå: Tink-transaktions-id är unikt per konto.
