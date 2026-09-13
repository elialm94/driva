# Runbook: e-poststopp

Symptom: kunder får inte offert/faktura/påminnelse; nya användare får inget
bekräftelsemejl; kvitton till `{slug}@in.<domän>` dyker inte upp i Underlag.

## 1. Var står det still?

`/admin/system` → *Mejl (Resend)*:

| Rad | Betyder |
| --- | --- |
| **Status: Ej konfigurerat** | `RESEND_API_KEY` eller `RESEND_FROM_EMAIL` saknas i Vercel. Utskick loggas som `not_configured` – inget låtsas-mejl har gått. |
| **Misslyckade utskick 7 d > 0** | Se *Senaste fel*: `Avsändardomänen är inte verifierad` ⇒ DNS/Resend-domän; `rate limit`/`5xx` ⇒ Resend-driftstörning; `invalid to` ⇒ kundens adress. |
| **Senaste utgående test** | Tryck **Skicka testmejl** – går till din egen adress. Kontrollera rubrikerna (*Visa original*): `spf=pass dkim=pass dmarc=pass`. |
| **Inkommande (webhook): Okänd/Fel** | Inget/failat anrop från Resend på `/api/inbox/inbound/resend`. |

`/admin/support` → kundens ärende visar vilka mejl som loggats (`email_events`,
aldrig innehåll).

## 2. Utgående

1. Resend → Domains: avsändardomänen **Verified**? Annars fixa DNS
   ([epost-produktion.md](epost-produktion.md)) och vänta på verifiering.
2. Resend → Logs: hitta mejlet på `providerMessageId` (finns i `email_events`).
   *Bounced/Complained* ⇒ kundens adress; be företagaren rätta e-post på kunden
   och skicka om från dokumentet.
3. Resend-status: https://resend-status.com – vid störning: vänta, inget
   retry-jobb finns; företagaren skickar om manuellt när tjänsten är uppe.
4. Nyckel ogiltig (`401`)? Rotera enligt [nyckelrotation.md](nyckelrotation.md).

## 3. Auth-mejl (bekräftelse, återställning)

Supabase → Auth → Hooks → Send Email måste peka på
`https://<prod>/api/auth/send-email` med samma hemlighet som
`SEND_EMAIL_HOOK_SECRET`. Fel hemlighet ⇒ Supabase loggar hook-fel och
användaren ser *Bekräftelsemejlet kunde inte skickas*. Tillfällig nödlösning:
stäng av hooken (Supabase skickar egna mallar) tills hemligheten rättats.

## 4. Inkommande kvitton

1. Resend → Domains → `in.<domän>`: **Receiving** på och MX **Verified**.
2. Resend → Webhooks: endpoint `https://<prod>/api/inbox/inbound/resend`, event
   `email.received`, senaste leveranser 2xx? `401` ⇒ `RESEND_WEBHOOK_SECRET`
   fel; `503` ⇒ `INBOUND_MAIL_MODE` inte `live` eller nyckel saknas.
3. Skicka ett testmejl till `test@in.<domän>` (okänd slug ⇒ 404 är väntat och
   bekräftar att kedjan når appen). `/admin/system` → *Inkommande (webhook)*
   uppdateras.
4. Kundens slug: `/admin/businesses/<id>` visar inbox-adressen; företagaren
   ser den under Underlag.

## 5. Kommunikation

Om stoppet varat > 1 h: informera berörda företagare (supportärende) att
mejl kan behöva skickas om från dokumentet – inget skickas dubbelt
automatiskt.
