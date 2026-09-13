# Runbook: e-post i produktion (Resend)

Checklista för att sätta upp och **verifiera** e-post innan go-live. Allt
nedan kontrolleras manuellt i Resend/DNS – Ferva kan bara visa vad som
faktiskt hänt (`email_events`, driftposter), aldrig gissa att DNS är rätt.

## 1. Avsändardomän (SPF, DKIM, DMARC)

1. Resend → Domains → **Add domain**: använd en underdomän för utskick,
   t.ex. `mail.<domän>` (håller apexens DMARC-rykte skilt). Region: EU
   (Irland) för dataminimering.
2. Lägg DNS-posterna Resend visar:
   - **DKIM**: TXT `resend._domainkey.mail.<domän>` (värde från Resend).
   - **SPF**: TXT på `send.mail.<domän>` (eller den host Resend anger):
     `v=spf1 include:amazonses.com ~all` – kopiera exakt från Resend.
   - **MX** för bounce-hantering på samma host (Resend anger
     `feedback-smtp.eu-west-1.amazonses.com`, prio 10).
3. **DMARC** på apex: TXT `_dmarc.<domän>` =
   `v=DMARC1; p=quarantine; rua=mailto:dmarc@<domän>; adkim=r; aspf=r; pct=100`.
   Börja med `p=none` en vecka om domänen redan används för annan e-post,
   läs rapporterna, gå sedan till `quarantine`.
4. Vänta tills Resend visar **Verified** på alla poster.
5. Sätt i Vercel: `RESEND_API_KEY`, `RESEND_FROM_EMAIL=noreply@mail.<domän>`
   (eller `hej@…`), `RESEND_FROM_NAME=Ferva`. Redeploya.
6. **Verifiera:** `/admin/system` → **Skicka testmejl** → öppna mejlet →
   *Visa original*: `spf=pass`, `dkim=pass`, `dmarc=pass`. Testa även mot
   Outlook/Hotmail (striktare filter) – **den första superadminen använder
   hotmail.com**, så det testet är obligatoriskt.

## 2. Bounce / complaint

Resend hanterar bounces automatiskt och stoppar upprepade utskick till
studsande adresser. För att Ferva ska visa det i supportvyn:

1. Resend → Webhooks → **Add endpoint** `https://<prod>/api/inbox/inbound/resend`
   (samma endpoint tar emot `email.received`); lägg till events
   `email.bounced`, `email.complained`, `email.delivery_delayed`. Ferva
   loggar okända händelsetyper som mottagna (200) – status per mottagare läses
   i Resend Logs tills en dedikerad bounce-vy prioriteras.
2. Rutin: vid *complained* – sluta skicka till adressen (ta bort e-post på
   kunden i företagets kundregister via supportsession efter samtal med
   företagaren).

## 3. Webhook-signatur

Alla Resend-webhooks verifieras med **Svix-signatur**
(`svix-id`, `svix-timestamp`, `svix-signature`) mot `RESEND_WEBHOOK_SECRET`
(`src/lib/inbox/resend-signature.ts`). Fel hemlighet ⇒ `401` och Resend
retriar. Toleransfönster 5 min – kontrollera serverklockan om `401` med
rätt hemlighet. Rotera per [nyckelrotation.md](nyckelrotation.md).

## 4. Inbound MX (kvitton till `{slug}@in.<domän>`)

1. Resend → Domains → **Add domain** `in.<domän>` som eget domänobjekt →
   slå på **Receiving**.
2. DNS: MX på host `in` enligt Resend (catch-all – alla `{slug}@in.<domän>`).
3. Vänta på **Verified** för Receiving-MX.
4. Resend → Webhooks: endpointen ovan med event `email.received`.
5. Vercel: `INBOUND_MAIL_MODE=live`, `INBOUND_MAIL_DOMAIN=in.<domän>`,
   `RESEND_WEBHOOK_SECRET`. Redeploya.
6. **Verifiera:** skicka ett mejl med PDF-bilaga till ett riktigt företags
   adress (syns under Underlag i appen) – posten dyker upp; `/admin/system` →
   *Inkommande (webhook)* visar tid och HTTP 200. Ett mejl till okänd slug
   ger 404 (väntat).
7. Behåll ev. äldre inbound-domän som alias tills alla kunder informerats.

## 5. Supabase Auth → Send Email-hook

1. Supabase → Authentication → **Hooks** → *Send Email* → Enable → HTTPS →
   `https://<prod>/api/auth/send-email` → **Generate secret** → kopiera
   (`v1,whsec_…`) → Vercel `SEND_EMAIL_HOOK_SECRET`. Redeploya.
2. Authentication → **URL Configuration**: Site URL `https://<prod>`,
   Redirect URLs innehåller `https://<prod>/auth/bekrafta`.
3. Authentication → **Rate limits**: höj *emails per hour* till rimlig nivå
   (standard 2/h blockerar onboarding).
4. **Verifiera:** skapa ett testkonto → bekräftelsemejlet kommer från
   `RESEND_FROM_EMAIL` med Ferva-mall; *Glömt lösenord* fungerar; länkarna
   pekar på `https://<prod>/auth/bekrafta`. `/admin/system` → *Senaste
   mejlutskick* visar `signup`/`recovery` som *Skickat*.

## 6. Löpande

- `/admin/system` visar misslyckade utskick 7 d och senaste inkommande.
- DMARC-rapporter (`rua`) läses veckovis första månaden.
- Vid e-poststopp: [epoststopp.md](epoststopp.md).
