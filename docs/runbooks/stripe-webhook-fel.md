# Runbook: Stripe webhook-fel

Webhooken är **sanningskällan** för abonnemangsstatus: Checkout-retursidan
aktiverar aldrig något själv. Fel här ⇒ kunder som betalat kan ligga kvar som
*Skrivskyddat* eller *Betalning väntar*. Ingen kund förlorar data – läsning och
export fungerar alltid.

## 1. Läs av

- `/admin/system` → *Abonnemang (Stripe)*: **Ej konfigurerat** + *Att åtgärda*
  (t.ex. blandade test/live-nycklar, `prod_` i stället för `price_`, live-nyckel
  utanför produktion). *Webhookfel 7 d*, *Senaste webhook*, *Köade*.
- `GET /api/health` → `ops.stripe.webhookFailures7d`, varning `stripe_webhook_failures`.
- Stripe Dashboard → Developers → Webhooks → endpointen: senaste leveranser
  och svarskod.
- Sentry: tagg `integration:stripe`, `correlationId` = samma id som i vårt
  500-svar till Stripe.

## 2. Svarskod → orsak

| Vårt svar | Orsak | Åtgärd |
| --- | --- | --- |
| `503 Abonnemangsbetalning är inte konfigurerad` | `STRIPE_*` saknas i Vercel | Sätt `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`; redeploya |
| `400 Ogiltig signatur` | Fel `STRIPE_WEBHOOK_SECRET` (annan endpoint/roll) eller body ändrad av proxy | Kopiera *Signing secret* från exakt den endpointen; kontrollera att inget läser `req.json()` före oss |
| `400 Stripe-Signature saknas` | Anrop från annat än Stripe | Ignorera; kontrollera att URL:en inte läckt |
| `500` + `correlationId` | Bearbetningsfel (DB nere, Stripe API-fel vid återhämtning av subscription) | Stripe retriar automatiskt i upp till 3 dagar; raden är `fel` i `stripe_webhook_events`. Åtgärda rotorsaken, tryck **Resend** i Stripe |
| `200 outcome: ignorerad` | Okänd händelsetyp, händelse utan matchande företag, demoföretag eller **äldre** än redan tillämpad (`created`) | Normalt. Saknas företaget: se §3 |
| `200 outcome: duplicate` | Redan mottaget event-id | Normalt (idempotens) |

## 3. Kund betalade men är fortfarande skrivskyddad

1. Stripe → Customers → sök kundens e-post → subscription **active**?
2. Subscriptionens metadata `businessId` / Checkout `client_reference_id` ska
   vara företagets id. Saknas ⇒ Checkout startades inte från Ferva (t.ex.
   Payment Link) – koppla via Stripe: sätt metadata `businessId` på
   subscriptionen och skicka om `customer.subscription.updated`.
3. Stripe → Webhooks → händelsen → **Resend**. Vår hantering hämtar alltid
   subscriptionen på nytt från Stripe och skriver kanonisk status i en
   transaktion (`app.allow_subscription_update`).
4. Kontrollera: `/admin/businesses/<id>` (abonnemangsfält) och kundens
   *Inställningar → Konto*. Cachen (30 s) töms vid bearbetad webhook.

## 4. Betalning misslyckas (past_due)

Kunden behåller skrivrätt (grace) och ser *Betalning väntar* med länk till
kundportalen. Stripes dunning avgör; vid `customer.subscription.deleted`
eller `unpaid` blir företaget skrivskyddat. Ingen manuell åtgärd – hjälp
kunden till **Hantera betalning** vid behov.

## 5. Endpoint saknas helt (ny miljö)

Stripe → Developers → Webhooks → **Add endpoint**:
`https://<prod>/api/stripe/webhook`, events `checkout.session.completed`,
`customer.subscription.created|updated|deleted|paused|resumed|trial_will_end`,
`invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`,
`invoice.payment_action_required`. Kopiera signing secret →
`STRIPE_WEBHOOK_SECRET`. Lokalt: `stripe listen --forward-to
localhost:3123/api/stripe/webhook`.
