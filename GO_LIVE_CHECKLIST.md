# Ferva – go-live-checklista

Två sorters punkter. **Automatiskt verifierbara** går att köra från repot eller
läsa av på `GET /api/health` (utan inloggning) och `/admin/system` (TOTP). **Manuella
externa** kräver avtal, dashboardsteg eller credentials som inte finns i repot –
de är inte klara bara för att koden, adaptern eller miljövariabeln finns.

Kryssa bara det som är verifierat i **produktion**. Kommandon körs från repo-roten.

## A. Kod och databas (automatiskt verifierbart)

| # | Kontroll | Hur | Klart när |
| --- | --- | --- | --- |
| A1 | Sex grindar gröna på `main` | `npm run typecheck && npm run lint && npm test && npm run test:db && npm run test:adapter && npm run build` (samma som `.github/workflows/ci.yml`) | 0 fel i alla sex; CI grön på senaste commit |
| A2 | Migrationssekvensen appliceras från noll | `npm run test:db` skriver *Applicerade N migrationer* och listar filerna i versionsordning; `src/lib/storage/schema-version.test.ts` låser `EXPECTED_MIGRATION_VERSION` mot katalogen | Ingen dubblerad version, sista fil = konstanten |
| A3 | Produktionsdatabasen har alla migrationer | Bygget kör `supabase db push --include-all` före `next build` (`scripts/vercel-build.sh`); **saknas `SUPABASE_MIGRATION_DB_URL` i Vercel Production-scope avbryts bygget med felkod** – ingen varning, ingen escape-hatch, förra deployen fortsätter svara (se B9); därefter `GET /api/health` | Byggloggen visar *Migrations up to date* (inte *[migrate] FEL: SUPABASE_MIGRATION_DB_URL är inte satt*, som betyder att variabeln måste sättas innan någon deploy går igenom); `warnings[]` utan `migrations_behind`; `/admin/system` → *Migrationer*: DB-version = kodens `EXPECTED_MIGRATION_VERSION` |
| A4 | XML-filer valideras i CI | Workflowen installerar `libxml2-utils`; `CI=true npm test` faller om xmllint saknas (`src/lib/__fixtures__/xmllint.ts`) | HUS mot pinnad XSD (`docs/skatteverket/hus/SCHEMAS.sha256`), AGI/eSKD/iXBRL välformade |
| A5 | Varumärke | `npm test` → `src/lib/brand-scan.test.ts` (källkod, manifest, PDF, mejl, filnamn) | 0 synliga "Driva" |
| A6 | Juridisk avtalspart | `GET /api/health` i produktion; `/villkor` och `/signup` utloggat | Inte `legal_entity_incomplete`; `/villkor`, `/integritet`, `/bitradesavtal` visar **FERVA AB** (värdet kommer från `LEGAL_ENTITY_NAME` i Vercel, aldrig från koden), inte "[avtalspart ej konfigurerad]"; `/signup` visar registreringsformuläret i stället för *Registreringen är tillfälligt stängd* (spärren i `src/lib/auth/signup-gate.ts` vägrar nya provperioder i produktion så länge `LEGAL_ENTITY_*` är ofullständiga) |
| A7 | Sentry | `GET /api/health` | Inte `sentry_unconfigured`; `/admin/system` → *Felövervakning (Sentry)* visar DSN konfigurerad; ett provocerat fel (t.ex. felaktig URL under `/api/`) syns i Sentry med `correlationId` |
| A8 | MFA-krav | `GET /api/health` | Inte `admin_mfa_not_required`; `/admin/system` → *MFA-krav för admins: Påslaget (AAL2 krävs)* |
| A9 | Cron | Vercel Cron `/api/cron/reminders` 07:00 (`vercel.json`), `CRON_SECRET` satt | Efter första dygnet: inte `cron_never_ran`/`cron_stale`/`cron_failed` |
| A10 | Stripe-webhooks | `/admin/system` → *Abonnemang (Stripe)* | Inte `stripe_webhook_failures`; senaste webhook < 24 h efter första testköpet |
| A11 | E-post live | `/admin/system` → *Skicka testmejl* | Mejlet landar med DKIM/SPF pass (se `docs/runbooks/epost-produktion.md`) |
| A12 | Supportmatris publik | Öppna `/omfattning` utloggad | Version `SUPPORT_MATRIX_VERSION` stämmer med `src/lib/support/matrix.ts`; villkoren länkar dit |
| A13 | PWA | Chrome → Lighthouse → PWA-installerbar; `/manifest.webmanifest`, `/sw.js` svarar 200 | Installationsprompt visas; `/falt` fungerar med nätet av efter ett besök online |
| A14 | Responsivt | Desktop, 390 px och 320 px på `/`, `/bokforing`, `/uppdrag/[id]`, `/ekonomi/fakturor/[id]`, onboarding | Ingen horisontell scroll, primärknappar nåbara |

## B. Manuella externa steg (kräver avtal, dashboard eller credentials)

Varje punkt anger exakt kommando eller dashboardsteg. Ingen av dem är klar
förrän den är utförd i produktion och verifierad enligt kolumnen längst till höger.

### B1. Stripe live

1. Stripe Dashboard (live-läge) → Products → *Ferva*, 199 kr/mån, återkommande, SEK, exkl. moms → kopiera `price_…`.
2. Developers → Webhooks → *Add endpoint* `https://<prod>/api/stripe/webhook` med
   `checkout.session.completed`, `customer.subscription.created/updated/deleted/paused/resumed/trial_will_end`,
   `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`, `invoice.payment_action_required`
   → kopiera `whsec_…`.
3. Settings → Billing → Customer portal: byte av betalmetod, kvitton, uppsägning vid periodens slut; inga planbyten.
4. Vercel → Settings → Environment Variables (**Production**): `STRIPE_SECRET_KEY=sk_live_…`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`. Preview får test-nycklar och egen test-webhook.
5. **Verifiera:** ett riktigt köp med ett litet belopp eller Stripes testkort i test-läge först; `/admin/system` visar webhooken; företaget går från *provperiod* till *aktivt* utan handpåläggning. Runbook: `docs/runbooks/stripe-webhook-fel.md`.

### B2. Första super_admin (bootstrap)

Kräver produktionscredentials lokalt (`vercel env pull .env.local --environment=production`) och att personen loggat in en gång.

```bash
npm run platform:bootstrap -- --email <adminens e-post>
# eller: npm run platform:bootstrap -- --user-id <supabase-auth-uuid>
```

**Verifiera:** personen öppnar `/admin` → tvingas till `/admin/mfa` → registrerar TOTP → adminytan öppnas; `admin_audit_log` har `admin_bootstrap` och `admin_mfa_enrolled`. Detaljer: `docs/admin.md` → *Bootstrap*.

### B3. Supabase TOTP

Supabase Dashboard → Authentication → Multi-Factor → **TOTP = Enabled** (Phone avstängt). **Verifiera:** A8 ovan. Runbook: `docs/runbooks/mfa.md`.

### B4. Backup/PITR och restore drill

1. Supabase → Settings → Add-ons → **Point in Time Recovery** på (kräver betald plan); Database → Backups → *Earliest restore point* visas.
2. Restore drill mot ett **staging**-projekt (aldrig prod):

```bash
npm run restore:drill -- --target staging --staging-ref <staging-projektref>
# kräver RESTORE_DRILL_DB_URL, RESTORE_DRILL_STAGING_REF, PRODUCTION_SUPABASE_PROJECT_REF
```

3. Klistra in RESULT-raden i `/admin/system` → **Registrera genomförd restore drill** (endast super_admin).

**Verifiera:** `GET /api/health` utan `restore_drill_unverified`. Runbook: `docs/runbooks/backup-restore.md`.

### B5. Resend – DNS, webhooks, inbound

1. Resend → Domains → utskicksdomän (t.ex. `mail.<domän>`) → SPF/DKIM-poster i DNS → **Verified**; DMARC TXT på apex.
2. Resend → Webhooks → `https://<prod>/api/inbox/inbound/resend` (bounce/complaint + `email.received`) → `RESEND_WEBHOOK_SECRET`.
3. Inbound: domänobjekt `in.<domän>` med Receiving, MX på host `in` → **Verified**; Vercel: `INBOUND_MAIL_MODE=live`, `INBOUND_MAIL_DOMAIN`.
4. Supabase → Authentication → Hooks → *Send Email* → `https://<prod>/api/auth/send-email` → `SEND_EMAIL_HOOK_SECRET`.
5. Vercel: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`.

**Verifiera:** A11; ett kvitto mejlat till `<slug>@in.<domän>` dyker upp i företagets inkorg; ett nytt konto får bekräftelsemejl från Ferva-adressen. Runbook: `docs/runbooks/epost-produktion.md`.

### B6. Inlämning (filing) – leverantör och riktig signering

Läget i produktion är **manuell guidad inlämning** (filer + kvittens registreras av användaren). Live-leverantör kräver avtal:

1. Teckna avtal med inlämningsleverantören; hämta bas-URL och token.
2. Vercel: `FILING_API_BASE_URL`, `FILING_API_TOKEN`, `FILING_ENV=production`, samt `FILING_PROVIDER_NAME` och `FILING_PROVIDER_TERMS_URL` (visas på `/underbitraden`).
3. Riktig signering (BankID) via leverantören – Fervas mock-BankID får aldrig signera i produktion (`DRIVA_DEMO` styr bara demon).

**Verifiera:** en testinlämning i leverantörens testmiljö går igenom med kvittens i `filing_submissions`; `/admin/system` → *Myndighetsinlämning* visar live-leverantören i stället för *Manuell inlämning (ingen leverantör)*. Runbook: `docs/runbooks/filing-fel.md`.

### B7. Juridisk och redovisningsmässig expertgranskning

- Jurist granskar `/villkor` (v2.1), `/integritet`, `/bitradesavtal`, `/underbitraden` och avtalsparten i env (`LEGAL_ENTITY_*`, `LEGAL_CONTACT_EMAIL`, `LEGAL_PRIVACY_EMAIL`).
- Auktoriserad redovisningskonsult granskar supportmatrisen (`src/lib/support/matrix.ts`, `/omfattning`), bankförslagens regler, moms-/AGI-/SRU-/iXBRL-generatorerna och ROT/RUT-flödet mot gällande regler och `effectiveFrom`-datum.

**Verifiera:** skriftligt godkännande arkiverat; ändringar landar som nya versioner (villkor → `LEGAL_DOCUMENTS`, matris → `SUPPORT_MATRIX_VERSION`).

### B8. App Store / Google Play

Mobilskalet (`mobile/`) är körbart men **inte butiksklart**. Återstår, se `mobile/README.md`:
riktiga ikoner/splash, App Privacy/Data safety, Apple 4.2-motivering, `targetSdkVersion`,
signering (Apple Distribution-certifikat, Android upload key – aldrig i repot), universal links,
fysisk testkörning offline → online.

```bash
cd mobile && npm install && FERVA_APP_URL=https://<prod> npx cap sync && npx cap open ios   # respektive android
```

**Verifiera:** godkänd review i båda butikerna.

### B9. Övriga produktionsvariabler

Sätt i Vercel (Production) och kontrollera att `GET /api/health` är `status: "ok"`:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_MIGRATION_DB_URL` (direktanslutning, procentkodat lösenord – bara Production, används av byggsteget i A3),
`DRIVA_APP_URL`, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, `SENTRY_DSN`, `LEGAL_ENTITY_*`, `LEGAL_CONTACT_EMAIL`,
AI (`AI_PROVIDER`, `OPENROUTER_API_KEY`) om assistenten ska vara på, Tink (`TINK_*`, `TINK_ENV=production`) om
bankkoppling ska vara live. Fullständig lista med kommentarer: `.env.example`.

## C. Efter första deploy

- [ ] `GET /api/health` → `status: "ok"`, `warnings: []` (eller bara `restore_drill_unverified` tills B4 är gjord).
- [ ] Skapa ett riktigt företag via onboarding: omfattningsfrågorna visas, verdiktet stämmer, villkor v2.1 godkänns.
- [ ] Utfärda en faktura med F-skatt **inte** verifierad: sidfoten saknar "Godkänd för F-skatt"; verifiera i Inställningar → Företag → texten kommer tillbaka.
- [ ] Bjud in en redovisningskonsult; konsulten ser klienten under `/redovisning` och kan godkänna ett konsultfall under `/redovisning/k/<id>/omfattning`.
- [ ] Sentry tar emot ett testfel; Resend-testmejl levereras; Stripe-webhook loggas.
