# Driva — Agent navigation + verification map

Canonical map for coding, QA, and product agents. **Not** generic product docs.

Use this file to answer, without rediscovering the app:

- Where does the feature live (Swedish UI name + route)?
- How does a user get there?
- Which states, tables, and components matter?
- How do I reproduce and verify a fix?

**Product:** Swedish business app for a one-person trade/service company (carpenter, painter, electrician, plumber, excavation contractor). Live: https://driva-alpha.vercel.app/

**Core chain:** Kund → Uppdrag → Offert (kunden godkänner på länken) → Faktura → Betalning → Bokföring.

**Status vocabulary:** one source — `src/lib/status-labels.ts`. Never show raw enums (`skickad`, `POSTED`, `pending`) as primary UI. The accept method is **not** a status — and the customer accept is **never** called BankID, e-legitimation or avancerad underskrift (see `offer.accept_simple`).

**Unknowns** are marked `UNKNOWN`. Facts below are from code + the live demo on 2026-09-01 unless noted. Shared address autocomplete ([PR #79](https://github.com/elialm94/driva/pull/79)) verified against main code 2026-09-04. Receipt file storage ([PR #77](https://github.com/elialm94/driva/pull/77)) verified against main code and the live demo 2026-09-04.

---

## How to use this map (example)

Bug: *“the quote delete button doesn't work.”*

1. **Where:** Offerter live under **Ekonomi → Offerter**, not a top-level nav item.
2. **Go there:** `/demo` → sidebar/bottom **Ekonomi** → tab **Offerter** (`/ekonomi?flik=offerter`).
3. **States that matter:** only **Utkast** can be discarded. Sent quotes use **Inte aktuell** (→ `avbojd`), not delete.
4. **Demo fixture:** Offert **#116** `quote-bokhylla` (Eva Holmgren) is the only seeded draft.
5. **Code/data:** `DiscardDraftButton` → `discardQuoteAction` → `discardQuote()`; tables `quotes`, `quote_versions`.
6. **Verify:** see [Offerter](#offerter-quotes) → *How an agent verifies*.

---

## App shell & navigation

### Layout

- App chrome: `src/app/(app)/layout.tsx` — `Sidebar` + `BottomNav` (`src/components/nav.tsx`) + `main` (`lg:pl-60`, bottom padding for mobile nav).
- Root wrapper: `data-driva-demo="1"` when JSON demo **or** public demo session. Client gates read it: the shared address autocomplete (`src/components/address-input.tsx`) stays on the local Swedish example list and never calls Google when `[data-driva-demo]` is present — see [Address autocomplete](#address-autocomplete-shared).
- Back/origin: `tillbaka` + `tillbakaNamn` query params (`src/lib/nav.ts`). `AppLink` stamps origin; `SmartBack` reads it. Browser back is real history.
- Completing a send-blocker (customer email, company settings, ROT personnummer) must stamp the **document you left**, not that document's parent. Offert #6 → *Lägg till e-post* → customer Back is **Offert #6**. Helpers: `pageOrigin`, `hrefFromOrigin`. Inställningar accepts `tillbaka` even without a default back (`acceptsReturnTo`).
- Breadcrumbs = structure, never history (`structuralCrumbs`).
- Support impersonation: `SupportModeBanner` when a Driva Admin support session is active.

### Address autocomplete (shared)

One Places integration for every editable physical address — `AddressAutocomplete` (single input) + `AddressFields` (gata / postnummer / ort) in `src/components/address-input.tsx`; pure helpers in `src/lib/address-autocomplete.ts` (+ `address-autocomplete.test.ts`). **Do not fork another.**

- **Source:** Google Places API (New) when `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is set **and** the surface is not demo. `[data-driva-demo]` → local Swedish example list only, no Google HTTP. Missing key / Google failure → manual typing still works; no raw Google errors, no dead dropdown. Demo suggestions carry a **Demo** tag.
- **Behaviour:** Sweden-first (`includedRegionCodes: ["se"]`), no map/Street View. Search from **3 meaningful characters** after trim (`"va"` does not fire), debounce 250 ms (`ADDRESS_SEARCH_DEBOUNCE_MS`). One session token per typing session; `fetchFields` only after the user picks a suggestion. Opening an edit form with a saved address does **not** call Places. Picking writes street + postal + city (or one composed line); name / e-mail / phone / personnummer untouched. `composeSelected="street"` (default) vs `"line"` (`gata, postnummer ort`) for single-field forms.
- **Keyboard:** Arrow/Enter selects; Enter does not submit the parent form while the list is open; Escape closes; Tab moves on.
- **Selectors:** input `role="combobox"` `aria-expanded` `aria-autocomplete="list"`; menu is portaled + viewport-flipped with `data-address-suggestions`; options `data-address-option={i}`. No `data-testid`.

| Surface | File | Mode |
|---------|------|------|
| Ny kund (privat + företag) | `new-customer-modal.tsx` | `AddressFields` |
| Redigera kund | `customer-details-form.tsx` | `AddressFields` |
| ROT-bostad / fastighet | `customer-rot-section.tsx` | `AddressFields` |
| Onboarding företagsadress | `onboarding-form.tsx` | `AddressFields`; ids `ob-address`, `ob-postal`, `ob-city` |
| Inställningar företagsadress | `settings-form.tsx` | `AddressFields`; ids `installningar-address`, `installningar-postalCode`, `installningar-city`; label **Gatuadress** |
| Faktura/offert blockers → komplettera adress | `settings-billing-readiness.tsx` | `AddressFields`; ids `komplettera-address`, `komplettera-postalCode`, `komplettera-city` |
| Nytt uppdrag, ny adress | `uppdrag-form.tsx` | `AddressFields`; names `newAddress`, `newPostalCode`, `newCity` |
| Redigera uppdrag (one line) | `uppdrag-form.tsx` | `AddressAutocomplete composeSelected="line"` |
| ROT saknad arbetsadress | `tax-reduction-application.tsx` | `AddressAutocomplete composeSelected="line"` |

**Not autocomplete (do not expect it):** invoice/quote documents and public `/faktura/*` `/offert/*` (read-only); website contact/footer (company address from settings); inbox inbound e-mail address; domain registrant; fastighetsbeteckning; Land/säte fields; search boxes; supplier/kvitto extraction.

**Verify (demo):** `/demo` → Kunder → **Ny kund** → type `Väd` in **Adress** (default label; Inställningar says **Gatuadress**) → list `[data-address-suggestions]` with **Demo** tag (e.g. *Vädursvägen 13*) → pick → adress + postnummer + ort filled, name field untouched. Puppeteer: assert no request to `maps.googleapis.com`.

### Primary nav (Swedish labels as shown)

Config: `NAV_ITEMS` in `src/lib/nav.ts`. Icons in `src/components/nav.tsx`.

| UI label | Route | Section | Badge |
|----------|-------|---------|-------|
| Hem | `/` | `hem` | never |
| Kunder | `/kunder` | `kunder` | never |
| Ekonomi | `/ekonomi` | `ekonomi` | never |
| Inbox | `/inbox` | `inbox` | open items (`countInboxBadge`) |
| Bokföring | `/bokforing` | `bokforing` | bookkeeping questions (`countBookkeepingBadge`) |
| Samarbeta | `/samarbeta` | `samarbeta` | never; **optional** |
| Hemsida | `/hemsida` | `hemsida` | never; **optional** |

Footer (not a section): **Inställningar** `/installningar`, **Hjälp & support** `/support?fran=<path>`.

**Optional features** (`src/lib/features.ts`, `src/lib/optional-features.ts`): `website`, `collaboration`. Hidden from nav when off. Direct URL redirects to `/installningar?flik=funktioner`. Existing usage without a stored flag counts as on (backfill). Explicit `false` wins. Deactivate does **not** delete content.

**Live demo (2026-09-01):** nav shows Hem, Kunder, Ekonomi, Inbox (badge **1**), Bokföring (badge **4**), Hemsida. **Samarbeta is absent** (collaboration not activated). Company footer: **Södermalms Snickeri AB** + **Demo** badge.

Badge aria: `Inbox, {n} öppna` / `Bokföring, {n} bokföringsfrågor att lösa`. Counts from `src/lib/services/nav-counts.ts`.

### Desktop vs mobile

- **Desktop (`lg+`):** fixed 240px sidebar. Company name / demo menu in footer.
- **Mobile:** bottom bar = first 4 visible items (Hem, Kunder, Ekonomi, Inbox) + **Mer**. Mer sheet (`role="dialog"` `aria-label="Mer"`) holds Bokföring, optional Samarbeta/Hemsida, Inställningar, support, demo/logout.
- Editor pages widen via `data-editor-shell` / `data-site-editor-shell`.

### Auth gates

Proxy (Next 16 middleware): `src/proxy.ts`. Real auth is always server-side (`ensurePageBusiness` / `withBusiness`).

**Public prefixes** (no login): `/login`, `/signup`, `/verifiera-epost`, `/glomt-losenord`, `/auth/bekrafta`, `/demo`, `/valkommen`, `/villkor`, `/integritet`, `/offert`, `/faktura`, `/sajt`, `/integritetspolicy`, `/inbjudan`, `/api/health`, `/admin/inbjudan`, `/api/inbox`, `/api/dev`. (`/api/bankid/*` is **removed** — the customer accept is a server action from `/offert/[token]`.)

`/api/kvitto/[receiptId]` is **not** public — it requires a session or demo cookie (`withBusinessRead`); without one the proxy redirects to `/login?next=/api/kvitto/…`.

**Logged-out `/`:** rewrite to `/valkommen` (URL stays `/`). **`/valkommen`:** redirect to `/`.

**Protected + no session + no demo cookie:** redirect `/login?next=<path>`.

**Logged-in on `/login` or `/signup`:** redirect `/`. Demo sessions are **allowed** on signup (create-account from demo).

**JSON mode** (no Supabase env): proxy is passive; local `.data/db.json` is already the demo company. Production without Supabase env **hard-errors** (no silent demo).

**Page gate:** `ensurePageBusiness()` — demo loads per-session JSON; Supabase loads tenant snapshot; no memberships → `/onboarding`; accounting-only role → `/redovisning`.

### Org / company context

- Tenant = `businesses` row. Active company via request slot / `driva_business` cookie.
- Roles: `owner`, `admin`, `member`, `accounting_consultant`, `auditor` (`src/lib/collaboration/permissions.ts`).
- Workspace cookie `driva_workspace`: `owner` | `redovisning`.
- Demo actor cookie `driva_demo_actor=accountant` switches to accountant UI.
- `WorkspaceSwitcher` appears for real users who also have accounting memberships.

### Legacy path rewrites (`src/lib/nav.ts`)

| Old | Now |
|-----|-----|
| `/pengar`, `/pengar/*` | `/ekonomi`, `/ekonomi/*` |
| `/jobb`, `/jobb/:id` | `/uppdrag`, `/uppdrag/:id` |
| `/uppdrag` (list) | `/kunder?flik=uppdrag` |
| `/assistent` | `/` |
| `/kunder?flik=forfragningar` | `/kunder?flik=uppdrag` |
| `/kunder/forfragningar/:id` | `/uppdrag/:id` |

---

## Data model overview

Postgres in `supabase/migrations/`. App aggregate `DB` in `src/lib/types.ts` (JSON mode = one snapshot). Amounts: **öre-free kronor as `bigint`**. Entity ids: **text** (uuids or seed ids like `cust-anna`).

`public.requests` existed in migration 03 and was **dropped** in `15_migrate_requests_to_jobs.sql`. Incoming website forms create **jobs**, not inbox items.

```
auth.users
  └── business_memberships (role) → businesses
        ├── business_settings (1:1)
        ├── business_sequences (quote / invoice / verification)
        ├── customers → work_locations
        ├── jobs → job_work_entries
        ├── quotes → quote_versions; signatures (1:1 = the customer's acceptance record); bankid_orders (legacy, unused by UI)
        ├── invoices → invoice_line_items; invoice_issued_snapshots; payments
        ├── expenses → receipts (file: storage_path in bucket `receipts` XOR content_base64)
        ├── supplier_invoices → supplier_payments → payment_files
        ├── bank_accounts → bank_transactions; bank_connections (Tink tokens, server-only RLS)
        ├── inbox_items
        ├── reminders; attention_states
        ├── verifications → accounting_entries
        ├── fiscal_years; vat_reports; assets; accruals; annual_reports
        ├── websites; domains
        ├── collaboration_invitations; client_information_requests
        └── assistant_messages; pending_actions; audit_log
```

Platform (not tenant): `platform_admins`, `platform_admin_invitations`, `support_tickets`, `support_sessions`, `admin_audit_log`, `email_events`.

**Relationships agents hit most:**

| From | To | Notes |
|------|----|-------|
| Quote / invoice | Customer | Required; same customer if linked to a job |
| Quote / invoice | Job | Optional; same-customer invariant (`22_document_job_same_customer`) |
| Invoice | Quote | Optional chain |
| Invoice | Payments | One bank tx → one invoice (unique) |
| Inbox item | Expense or supplier invoice | Pipeline after review |
| Reminder | customer / quote / invoice / job | Optional related entity |
| Attention state | `action_id` | Presentation only — does not change domain status |

**Businesses extras:** `is_demo` (frozen), `trial_started_at`, `trial_ends_at`, `subscription_status` (trial is DB state; **no paywall UI found**).

---

## Demo mode

### What it is

Two layers (`src/lib/demo.ts`):

1. **`isDemoMode()`** — env: `DRIVA_DEMO=1` force on; `=0` force off; production default off; local JSON/dev default on. Gates **fake money** (simulate payment, ROT payout demo, exempelkvitto, legacy mock-BankID provider).
2. **`isDemoBusiness()`** — `db().meta.demo === true` from `businesses.is_demo`. Public seeded demo company in Supabase. Public `/demo` session clones also set `meta.demo = true` (`src/lib/storage/demo-session-store.ts`).

Public **Se demo** never touches tenant data (no `businesses` / `auth.users` / RLS rows). `GET /demo` (`src/app/demo/route.ts`) sets httpOnly cookie `driva_demo` (`<expiresMs>.<sessionId>`) and clones `buildSeed()` (`src/lib/seed.ts`) into the session's own store (`src/lib/storage/demo-session-store.ts`): local JSON mode → `.data/demo-sessions/<id>.json`; Supabase mode (Vercel) → one jsonb row in `public.demo_sessions` (migration 29, `state_version`-checked per-instance cache) so every serverless instance sees the same session — a file in `/tmp` was per-instance and made the Ekonomi register show stale status after a public accept. Incognito = new clone.

Logged-in real user hitting `/demo` → `/`. Prefetch → 204. Rate limit fail → `/login?demo=upptagen`. Cookie TTL default 24h (1–72). Expired cookie → landing.

### Enter / exit

| Action | How |
|--------|-----|
| Enter | Landing **Se demo** or login **Se demo** → `/demo` |
| Stay | Same cookie reuses the file |
| Reset | Sidebar company row → **Återställ demo** (confirm **Återställa demon?**) or Inställningar demo section. `resetDemoAction` → `resetDemoSessionState()` |
| End | **Avsluta demo** (public session only) → `endDemoAction` |
| Convert | **Skapa ditt eget konto** → `endDemoToSignupAction` → `/signup` |
| Accountant view | **Visa redovisningsvyn** → `enterLocalAccountantDemoAction` (cookie `driva_demo_actor=accountant`) |

Demo menu: `src/components/demo-menu.tsx`. Trigger = company name + **Demo** badge. Copy: *Du använder demon* / *Utforska Driva med exempeldatan för {title}.*

Local JSON (`npm run dev`, no Supabase): already seeded; **Avsluta demo** hidden (`canEndDemo` false). Reset still works.

### Seed company

**Södermalms Snickeri AB**, org `559123-4567`, address Renstiernas gata 12, 116 28 Stockholm, bankgiro `5678-1234`, inbound `demo@in.driva.se`, site slug `sodermalms-snickeri`. Demo user: `demo@driva.local` / name **Du**. Accountant persona: **Anna Svensson**.

### What is seeded (stable ids)

**Kunder (9):** `cust-anna` Anna Andersson, `cust-brf` Brf Eken, `cust-johan` Johan Lindberg, `cust-nord` Nord Studio AB, `cust-sara` Sara Nilsson, `cust-karin` Karin Ek, `cust-bertil` Bertil Lindqvist, `cust-eva` Eva Holmgren, `cust-glantan` Restaurang Gläntan AB.

**Offerter (8):**

| id | # | Title | Customer | Status (UI) | Public token |
|----|---|-------|----------|-------------|--------------|
| `quote-bokhylla` | 116 | Platsbyggd bokhylla i ek | Eva Holmgren | Utkast | `demo-eva-bokhylla` (not public) |
| `quote-nord2` | 114 | Kontorsinredning – etapp 2 | Nord Studio AB | Väntar på godkännande | `demo-nord-etapp2` |
| `quote-garderob` | 113 | Platsbyggd garderob | Anna Andersson | Väntar på godkännande | `demo-anna-garderob` |
| `quote-fasad` | 115 | Fasadarbete och nya fönsterfoder | Bertil Lindqvist | Väntar på godkännande (öppnad) | `demo-bertil-fasad` |
| `quote-dorrar` | 112 | Byte av förrådsdörrar | Brf Eken | Väntar på godkännande | `demo-brf-dorrar` |
| `quote-altan` | 111 | Altanrenovering | Johan Lindberg | Godkänd | `demo-johan-altan` |
| `quote-kok` | 110 | Köksrenovering | Anna Andersson | Godkänd | `demo-anna-kok` |
| `quote-nord1` | 106 | Kontorsinredning – etapp 1 | Nord Studio AB | Godkänd | `demo-nord-etapp1` |

Seeded acceptances (`signatures`): `sig-nord1`, `sig-kok`, `sig-altan` — all `method: simple_accept` with statement, contentHash, e-mail, ip, userAgent.

**Uppdrag (stable):** `job-kok` (Pågår), `job-altan` (Planerat), `job-fonster` / `job-nord1` / `job-kokso` / `job-racke` (Klart — hidden under Aktiva), plus planned jobs for Sara, Karin, garderob, nord2, fasad.

**Fakturor:** paid `#1033`–`#1041`/`#1045`; `#1042` slutfaktura Brf Eken **Förfallen**; `#1047` delbetalning Johan **Skickad**; `inv-1048` **Utkast** Brf Eken (list shows “Utkast”, no number). Tokens e.g. `demo-f1048`.

**Inbox:** `inbox-mail-beijer` (Beijer, redo att betala), `inbox-mail-byggmax` (Byggmax, kontrollera belopp — **the badge item**), `inbox-mail-bauhaus`, `inbox-mail-okq8`.

**Påminnelser:** `rem-karin` (Ring Karin…), `rem-slutgenomgang`, `rem-kapsag` (utan datum).

Also: bank (SEB …4512), expenses, supplier invoices, verifications, published website, payment files.

### Demo vs real accounts

| | Demo / JSON | Real Supabase |
|--|-------------|---------------|
| Auth | Cookie / no login | Email + password |
| Data | Isolated JSON clone | RLS tenant |
| Outbound mail | Simulated | Resend if configured |
| Quote accept | Simple accept (name + **Godkänn offert**), no e-mail to the carpenter | Same simple accept; carpenter notified via Resend if configured |
| Receipt file (**Lägg till kvitto**) | Inline `content_base64` (≤ 1,5 MB) | Private bucket `receipts` with `SUPABASE_SERVICE_ROLE_KEY`; inline fallback without it |
| Bank / payments | **MockBankProvider** (SEB ···· 4512, synthetic tx, zero HTTP to Tink); **Simulera betalning** | **LiveTinkProvider** if all `TINK_*` set, else honest *Bankkoppling är inte konfigurerad* — never fake success |
| Places (address autocomplete) | Local Swedish examples with **Demo** tag — **zero Google HTTP** even if a key is set | Google Places API (New) if `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` set; no key / Google failure → manual typing (local examples as fallback). Shared component — see [Address autocomplete](#address-autocomplete-shared) |
| AI | Optional; honest fallback if no key | Same |
| Trial | null | 14 days `trialing` |
| Fake money APIs | Allowed | `DemoModeError` |

---

## Public landing page

- **User-facing name:** (no product nav label — logged-out `/`)
- **Purpose:** Convert to trial or demo.
- **Routes:** `/` (rewrite to `/valkommen` when logged out). File: `src/app/valkommen/page.tsx`. Direct `/valkommen` → `/`.
- **How to get there:** Open live URL while logged out / no demo cookie. Header **Logga in**, **Testa gratis**.
- **Main actions:** **Testa gratis i 14 dagar** → `/signup`. **Se demo** → `/demo`. Header **Logga in** → `/login`.
- **Copy (live):** H1 *Driva ditt företag. Inte administrationen.* Steps: *Få jobbet / Gör jobbet / Få betalt / Slipp administrationen.* Features: ROT/RUT, Digitalt godkännande, Kvitton & bokföring, Egen hemsida. Price: *199 kr/mån efter provperioden · Inget kort krävs*.
- **Related:** `/villkor`, `/integritet` (Driva’s policy). Customer-site policy is `/integritetspolicy`.
- **Components:** `src/components/home-preview.tsx` (static preview of demo company — does **not** start a demo session).
- **DB:** none.
- **Invariants:** No prefetch of the app from landing (`<a>`, not `<Link>`). Demo cookie is created only on `/demo`.
- **Desktop/mobile:** stacked CTAs on small screens.
- **Verify:**
  1. Incognito → `https://driva-alpha.vercel.app/` → landing (not Hem). Title: *Driva – mindre administration, mer tid till jobbet*.
  2. Link *Se demo* → `/demo` → Hem titled *Hem · Driva*, `data-driva-demo="1"`, company *Södermalms Snickeri AB*.
  3. Protected URL without cookie (e.g. `/ekonomi`) → `/login?next=/ekonomi`.
  4. Script: `scripts/verify-logged-out-demo.ts`.

---

## Signup / login / email verification

- **User-facing names:** Logga in · Skapa konto · Verifiera din e-post · Glömt lösenord
- **Purpose:** Create/authenticate a real Supabase user. Demo does not use this.
- **Routes:**
  - `/login` — `src/app/(auth)/login/page.tsx` + `login-form.tsx`
  - `/signup` — `signup/page.tsx` + `signup-form.tsx`
  - `/verifiera-epost?email=` — post-signup “check your mail”
  - `/auth/bekrafta` — Supabase OTP/PKCE
  - `/glomt-losenord`, `/uppdatera-losenord`
- **How to get there:** Landing CTAs; login *Har du inget konto? Skapa konto*; signup *Har du redan ett konto? Logga in*; invite `/inbjudan/[token]` may send here with `?next=`.
- **Main actions:** Logga in / Skapa konto / Skicka igen / Skicka återställningslänk. Login also **Se demo**.
- **Fields / ids:** `auth-email`, `auth-password`, `signup-email`, `signup-phone`, `signup-password`, `reset-email`, `new-password`, `confirm-password`. Errors: `*-fel`.
- **Subflows:** Signup without session → `/verifiera-epost`. Confirm → `/` → `requireBusiness` → `/onboarding` if no membership. Reset → `/auth/bekrafta?next=/uppdatera-losenord`. Notices: `?bekraftelse=utgangen|ogiltig`, `?demo=upptagen`.
- **Actions:** `src/app/auth-actions.ts`.
- **Related:** Onboarding, invitations, demo convert-to-account.
- **DB:** `auth.users`; memberships created at onboarding.
- **Invariants:** Password never in URL. `safeAuthNext` blocks open redirects. JSON mode: login/signup return Swedish “requires Supabase” errors.
- **Desktop/mobile:** centered card, same form.
- **Live:** login and signup are reachable without auth. `/ekonomi` without session = login with `next`.
- **Verify:** fill `#auth-email` / `#auth-password`; submit *Logga in*. Signup: `#signup-email`, `#signup-phone`, `#signup-password`. Full signup→verify→onboarding needs real Supabase + email (`verify-logged-out-demo.ts` explicitly skips it). Tests: `src/lib/signup-flow.test.ts`.

---

## Onboarding

- **User-facing name:** Välkommen till Driva / Kom igång
- **Purpose:** Create the first company so the user can invoice.
- **Route:** `/onboarding` — `src/app/onboarding/page.tsx` + `onboarding-form.tsx`
- **How to get there:** Automatic after first login when `needsCompanyOnboarding(memberships.length)` (`membershipCount === 0`). Demo/JSON → redirect `/`.
- **Main actions:** submit **Kom igång**.
- **Fields / ids:** `ob-name`, `ob-orgnr`, `ob-vat`, `ob-address`, `ob-postal`, `ob-city`, `ob-payment-method`, `ob-bankgiro`, `ob-plusgiro`, `ob-bankkonto`, `ob-email`, `ob-phone`. Summary: `#ob-sammanfattning`. Sections: Företag, Adress, Betalning, Kontakt. **Adress** section is the shared `AddressFields` (autocomplete, `#ob-address` is a `role="combobox"`); ids unchanged.
- **Related:** Inställningar Företag / Fakturering (same company fields later).
- **DB:** `businesses`, `business_settings`, `business_sequences`, `business_memberships` (owner). Trial columns set on real businesses.
- **Invariants:** One company at create. Payment method required (bankgiro / plusgiro / bankkonto).
- **Verify:** only in Supabase. After submit → `/`. Tests: `src/lib/onboarding.test.ts`.

---

## Hem

- **User-facing name:** Hem
- **Purpose:** Command bar + prioritized work. Not a document register.
- **Route:** `/` (authenticated or demo). File: `src/app/(app)/page.tsx`. Title *Hem*.
- **How to get there:** Logo, nav **Hem**, `/assistent` redirect, post-login default.
- **Layout (live demo):** greeting (*God eftermiddag* etc.) → command bar → **Behöver din uppmärksamhet** (first 5, *Visa N till*) → **På gång** → **Påminnelser**.
- **Main actions:** type in command bar; click attention CTAs (Skicka påminnelse, Skapa bankfil, Öppna bokföring, **Lägg till kvitto** = file picker that stores the file — see [Utgifter & kvitton](#utgifter--kvitton-flikutgifter), …); reminder Klar / Snooza / Redigera / Ta bort.
- **Related:** same action engine as Bokföring (`src/lib/services/actions.ts`, `action-views.ts`). Hem shows a **projection** (`projectHomeAttention`), not a second queue.
- **Components:** `command-bar.tsx`, `attention-list.tsx`, `watching-list.tsx`, `home-reminders.tsx`.
- **DB:** derived from invoices, quotes, inbox, expenses, VAT, plus `reminders`, `attention_states`.
- **Invariants:** Hem has **no** nav badge. Attention ids match Bokföring. Snooze/dismiss writes `attention_states` only — overdue invoices stay overdue.
- **Desktop/mobile:** command bar full width; lists stack.
- **Live demo attention (examples):** late VAT Q2 2026; Faktura #1042 6 dagar sen; Fastighets AB Söderport missing payment details; Trygg-Hansa ready to pay; grouped *3 bokföringsfrågor*.
- **Verify:**
  1. `/demo` → Hem. Heading is a greeting, not “Hem”.
  2. Section title *Behöver din uppmärksamhet*.
  3. Click *Faktura #1042* row → `/ekonomi/fakturor/inv-1042` (or current id).
  4. Overflow *Fler alternativ* (`aria-label` starts with *Fler alternativ för*).
  5. Scripts: `scripts/verify-attention-browser.ts`, `scripts/verify-reminders-browser.ts`. Tests: `actions.test.ts`, `action-views.test.ts`.

---

## AI / command bar

- **User-facing name:** (no heading — field placeholder **Vad vill du göra?**; ⌘K hint)
- **Purpose:** Deterministic commands first; LLM only if configured and rules miss. **Not a chatbot** — no history.
- **Routes:** rendered on Hem (`variant="hem"`). `/assistent` → `/`. Accountant variant on `/redovisning`.
- **How to get there:** Hem. Focus field or ⌘K.
- **Owner commands (labels):** Skapa faktura, Skapa offert, Skapa uppdrag, Skapa påminnelse, Ny kund, Hitta kund, Visa obetalda/sena fakturor, Visa öppna offerter, Vad behöver jag göra idag?, Vad är på gång?, Visa fakturor, Ladda upp kvitto, Skapa en hemsida, Bjud in redovisningskonsult, Skicka betalningspåminnelse, Granska inför moms.
- **Accountant extras:** Vilka klienter behöver min hjälp?, Moms denna vecka, Saknade underlag, Bankavvikelser, Stäm av banken, …
- **Subflows:** slot-fill (customer → invoice target → …) then server `executeTool`. Confirm cards for `CONFIRM_REQUIRED` (send invoice, remind late, purchase domain, mark VAT declared). Reminders parse the **full sentence** — autocomplete never drops the rest.
- **Related:** docs/ai.md; tools in `src/lib/ai/tools.ts`; domain services under `src/lib/services/`.
- **Components:** `src/components/command-bar.tsx`, `src/lib/command-bar.ts`, `src/lib/services/command-bar.ts`, `src/lib/ai/loop.ts`.
- **DB:** `reminders` on create; `assistant_messages` / `pending_actions` for audit. Writes go through the same store as UI.
- **Invariants:** Risk classes enforced server-side. `FORBIDDEN_FOR_AI` not exposed. Personnummer never sent to LLM. No key → *Jag kan ännu inte tolka helt fri text. Välj en åtgärd nedan.*
- **Selectors:** `role="listbox"` `aria-label="Förslag"`; `aria-label="Påminnelsetext"`; `aria-label="Stäng resultatet"`. **No data-testid on the input.**
- **Verify:** type `Skapa offert` → suggestion list → pick customer. Or `Påminn mig att ringa Karin imorgon` → reminder on Hem. Scripts: `scripts/verify-command-bar.ts`, `npm run test:assistant`. Tests: `command-bar.test.ts`, `ai-loop.test.ts`.

---

## Attention items / reminders

Two different systems:

### Action-engine attention (*Behöver din uppmärksamhet*)

- Derived, not a table of todos. Snooze/dismiss: `attention_states` (`business_id`, `action_id`, `user_id`).
- Surfaces: Hem, Bokföring *Behöver lösas* (`#behover-losas`, `?visa=olosta`), accountant queue.
- Overflow can **Inte aktuell** a sent quote (→ `markQuoteNotRelevant`).
- Component: `src/components/attention-list.tsx`.

### User reminders (*Påminnelser*)

- **Purpose:** User/AI-created follow-ups (*Ring Karin…*).
- **Route:** Hem only (no dedicated page).
- **Groups:** Försenade, Idag, Kommande, Utan datum. First 3 then *Visa alla*.
- **Actions:** Klar, Snooza, Redigera, Ta bort (soft `DISMISSED`), Lägg till tid.
- **Components:** `home-reminders.tsx`. Actions: `completeReminderAction`, `dismissReminderAction`, `snoozeReminderAction`, `updateReminderAction`.
- **DB:** `reminders` — status `PENDING|COMPLETED|DISMISSED`; `due_at` nullable; `source` `assistant|user`; related `customer|quote|invoice|job`. **No DELETE grant.**
- **Invariants:** Completing a reminder does not change invoice/quote status.
- **Verify:** demo *Ring Karin Ek om bokhyllan imorgon* → Klar → row gone, DB `COMPLETED`. Script: `scripts/verify-reminders-browser.ts`. Tests: `reminders.test.ts`.

---

## Kunder

- **User-facing name:** Kunder
- **Purpose:** People/companies you work with. Jobs are a **tab** here, not a top-level nav item.
- **Routes:** `/kunder` (default `flik=kunder`), `/kunder/[id]`. Page: `src/app/(app)/kunder/page.tsx`.
- **How to get there:** Nav **Kunder**. Command *Ny kund* / *Hitta kund*. Attention/customer links.
- **Tabs:** **Kunder** `/kunder?flik=kunder` · **Uppdrag** `/kunder?flik=uppdrag`.
- **Subtitle:** *Alla du jobbar med eller pratar med – allt kopplas ihop automatiskt.*
- **Main actions:** **Ny kund** (`aria-label="Ny kund"`) → `NewCustomerModal`. Row → `/kunder/{id}` (`aria-label={name}`).
- **List filters:** Typ (Privat/Företag), Aktivitet, Betalning, sort Senast aktivitet / Kund / Att betala. Search: *Sök kund, företag, e-post eller telefon...*
- **Detail:** Företag / Privatperson. Header CTAs (`CustomerChainActions`): Starta uppdrag, Ny offert, Skapa faktura / Fristående faktura. ROT/RUT section (privat). Activity feed.
- **Personnummer:** `#kund-personnummer`. Masked in UI. Reveal via `revealCustomerPersonnummerAction`. Never in LLM, URLs, or logs.
- **Work locations:** on customer (not on quote). Types: Fastighet/småhus, Bostadsrätt.
- **Related:** Offerter, Fakturor, Uppdrag, ROT/RUT.
- **Components:** `customer-list.tsx`, `new-customer-modal.tsx` (`#ny-kund-namn`, `#ny-kund-epost`, …), `customer-details-form.tsx`, `customer-rot-section.tsx`, `customer-picker.tsx`.
- **Address fields:** Ny kund (privat + företag), Redigera kund and ROT-bostad all use the shared `AddressFields` autocomplete (`address-input.tsx`) — existing field ids unchanged; picking a suggestion fills gata + postnummer + ort only. See [Address autocomplete](#address-autocomplete-shared).
- **DB:** `customers` (`kind` `privat|foretag`), `work_locations`.
- **Invariants:** Kind is required. Org.nr for företag. Personnummer for privat ROT.
- **Desktop/mobile:** table vs cards.
- **Live demo customers:** Johan, Brf Eken, Eva, Karin, Anna, Nord Studio, Sara, Bertil, Gläntan.
- **Verify:** `/kunder` shows 9 rows. Click *Anna Andersson* → `/kunder/cust-anna`. Create via `aria-label="Ny kund"` + `#ny-kund-namn`. Tests: `customers.test.ts`, `customer-detail.test.ts`.

---

## Uppdrag

- **User-facing name:** Uppdrag
- **Purpose:** The work — dates, registered time/material, invoicing left. Economy status is **not** baked into “Klart”.
- **Routes:** list `/kunder?flik=uppdrag` (`UppdragList`). Detail `/uppdrag/[id]` (`src/app/(app)/uppdrag/[id]/page.tsx`). Alias `/jobb/[id]`. Standalone `/uppdrag` list file exists but canonical list is the Kunder tab.
- **How to get there:** Kunder → tab Uppdrag. Customer *Starta uppdrag*. Quote *Starta uppdrag*. Command *Skapa uppdrag*.
- **Subtitle:** *Vad som är beställt, när det sker, vad som är fakturerat och vad som är kvar.*
- **Stored status:** `kommande | pagar | klart`. **UI:** Planerat / Pågår / Klart / Arkiverat (`archivedAt`, not an enum).
- **Economy line:** *X kr kvar att fakturera* · *X kr väntar på betalning* · *Betalt ✓*
- **List chips:** Aktiva, Planerade, Klart, Alla, Arkiverade + Kvar att fakturera / Väntar på betalning / Betalt. Search: *Sök uppdrag, kund, företag eller adress …*
- **Detail actions** (`job-controls.tsx`): Skapa/Fortsätt/Visa offert; Skapa faktura / delfaktura / slutfaktura; Redigera; Markera som klart; Återöppna; **Ta bort uppdrag**.
- **Subflows:**
  - Invoice from job: `JobInvoiceModal` + `createInvoiceForJobAction`.
  - Work entries: `job_work_entries` planned vs actual; locked when invoiced.
  - Complete may warn if unbilled work remains.
  - **Delete vs archive** (`jobRemovalPolicy`): empty → hard delete; if signed quote / issued invoice / payments / posted books / invoiced work → **archive**. Same menu label *Ta bort uppdrag*; modal explains.
- **Related:** Kunder, Offerter, Fakturor, ROT card on job when relevant.
- **Components:** `uppdrag-list.tsx`, `uppdrag-form.tsx` (`#nytt-uppdrag-titel`, `#uppdrag-titel`), `job-controls.tsx`, `job-invoice-choice.tsx`, job work section.
- **Work address:** new uppdrag *ny adress* = shared `AddressFields` (names `newAddress` / `newPostalCode` / `newCity`); edit uppdrag address = single-line `AddressAutocomplete composeSelected="line"` (`gata, postnummer ort`). See [Address autocomplete](#address-autocomplete-shared).
- **DB:** `jobs`, `job_work_entries`. JSON: `housing`, `tax_reduction_application`, `checklist`.
- **Invariants:** Job describes **work**, not money. Quote/invoice linked to a job must share `customer_id`.
- **Desktop/mobile:** table vs cards; row `aria-label={title}`.
- **Live:** Aktiva includes Köksrenovering (Pågår, 59 500 kr kvar) and several Planerat. Klart jobs (fönster, etapp 1, …) under **Klart**.
- **Verify:** `/kunder?flik=uppdrag` → click *Köksrenovering* → `/uppdrag/job-kok`. Create from header **Uppdrag**. Tests: `job-lifecycle.test.ts`, `job-work.test.ts`.

---

## Offerter (Quotes)

- **User-facing name:** Offerter (tab). Detail: **Offert #{n}**
- **Purpose:** Price and scope the job; the customer accepts it on the public link by typing their name and pressing **Godkänn offert**. Accepting is not payment.
- **Feature key:** `offer.accept_simple` — **core / icp_loop**. One canonical service `acceptQuote(token, name)` (`src/lib/services/quote-accept.ts`), reached only via the public server action `acceptQuoteByTokenAction`. The AI has no accept tool; the owner cannot accept for the customer.
- **Tombstone:** customer-facing **BankID accept is removed** (`bankid-flow.tsx`, `/api/bankid/*`, `BankIDApproval`). `src/lib/services/bankid.ts` (MockBankIDProvider) remains as a dead hook: demo-gated, no route calls it, and its `finalizeApproval` delegates to the same `finalizeQuoteAcceptance`. Never re-add a BankID button, "e-legitimation", "avancerad underskrift", a drawn signature or a personnummer gate on the accept path.
- **Routes:**
  | Route | Page |
  |-------|------|
  | `/ekonomi?flik=offerter` (default Ekonomi tab) | `ekonomi/page.tsx` + `QuoteRegister` |
  | `/ekonomi/offerter/ny` | new |
  | `/ekonomi/offerter/[id]` | detail |
  | `/ekonomi/offerter/[id]/redigera` | edit |
  | `/offert/[token]` | public customer |
  | `/offert/[token]/pdf`, `/underlag` | PDF (shows *Godkänd {datum} av {namn}* once accepted) / acceptance evidence (*Underlag för godkännandet*) |
- **How to get there:**
  - Nav **Ekonomi** (lands on Offerter).
  - Header **Ny offert** (`aria-label="Ny offert"`).
  - Customer / job / command *Skapa offert*.
  - Query: `?kund=`, `?job=`, `?tillaggFran=`.
- **Statuses (domain → UI):**
  | Domain | Badge |
  |--------|-------|
  | `utkast` | Utkast |
  | `skickad` | Väntar på godkännande (list: *Öppnad · väntar på godkännande* if viewed) |
  | `godkand` | Godkänd (timeline/underlag: *Godkänd av {namn}* via `acceptedByLabel`) |
  | `avbojd` | Avböjd |
  | `utgangen` | Utgången (**derived** when sent + `validUntil` passed) |
- **Filters:** Alla, Utkast, Väntar på godkännande, Godkända, Avböjda, Utgångna.
- **Main actions — utkast:** Redigera · **Kasta utkast** · **Skicka offert**. Checklist `#quote-send-blockers` *Innan offerten kan skickas*.
- **Main actions — skickad:** Öppna kundvyn · Kopiera kundlänk · PDF · Skicka påminnelse · chain (Starta uppdrag / Skapa faktura). Owner dismiss from Hem: **Inte aktuell**.
- **Main actions — godkänd/avböjd:** Ny version (new version → utkast) · Öppna kundvyn. Godkänd also shows the acceptance card (who, when, customer, e-mail, link recipient, IP + device, method) + **Visa underlag**.
- **Public `/offert/[token]`:** utkast → **404**. Document ends with section **Godkänn offerten**: field **Ditt namn** (prefilled: person name, or company contact person; editable; button disabled while blank), one sentence *Genom att godkänna accepterar du offerten “{rubrik}” från {företag} daterad {datum} till ett totalt belopp om {totalt}.* (ROT/RUT adds *, varav … preliminärt ROT/RUT-avdrag*), primary **Godkänn offert** (`data-testid=public-quote-accept`), footnote *Godkännandet sparas tillsammans med offertens innehåll och tidpunkt.* Fixed bottom bar: Offertvärde, **Avböj offerten** (`public-quote-decline`), **Ställ en fråga**, **Godkänn offert** (anchor → `#godkann-offert`, focuses the name field if empty). No BankID button, no draw-to-sign, no checkbox. First open → `viewedAt` / *Öppnad av kunden*.
- **Accept states:** success → inline *Offerten är godkänd* + receipt (who, when, amount) then `router.refresh()` → server banner *Offerten är godkänd* / *Godkänd av {namn}, {tid} · {belopp}* + **Visa underlag för godkännandet**; document shows *Godkänd {datum} av {namn}*; **already accepted** = read-only, no second accept; **avbojd** / **expired** → Swedish explanation, no form; **utkast** → 404 (also for the action: `not_found`).
- **Accept service (`acceptQuote`):** rate limit (10/token, 40/IP per 10 min) → token lookup (utkast = not_found) → idempotent return if already accepted → `normalizeAcceptName` (trim, collapse, ≤120; empty → `name_required`) → status (`declined` / `expired` / `not_acceptable`) → `expectedContentHash` from the rendered page must equal `quoteVersionHash(version)` (`changed`) → `finalizeQuoteAcceptance`: sets seller/buyer snapshots, `lockedAt`, `contentHash`, pushes the `QuoteAcceptance` (`method: simple_accept`, `acceptedAt`, `acceptedByName`, `customerNameAtAccept`, `acceptedByEmail`, `contentHash`, `statement`, `ip`, `userAgent`, `linkSentTo`), `status = godkand`, `decidedAt`, `createJobFromQuote` (idempotent — never a second job), `logActivity`, one `save()`. Errors are `QuoteAcceptError` with Swedish `QUOTE_ACCEPT_TEXT`.
- **Carpenter notice:** `prepareQuoteAcceptedNotice` (null in demo / `is_demo` / no mail provider) → sent with `after()` so the customer never waits on Resend; failure never blocks the accept.
- **Delete rules (critical):**
  - **Kasta utkast** only if `status === "utkast"` and no issued invoices linked.
  - Sent: *Skickade offerter kan inte kastas. Markera dem som inte aktuella i stället.*
  - `discardQuote` unlinks draft invoices/jobs; deletes versions, acceptances (`signatures`), legacy bankid orders.
  - Redirect: `/ekonomi?flik=offerter&kastat=offert` (`DraftDiscardedToast`).
  - There is **no** hard delete for sent/signed quotes.
- **Related:** ROT on form; job link (`LinkedToBox`); invoices from payment plan.
- **Components:** `economy-register.tsx`, `doc-form.tsx` (QuoteForm), `discard-draft-button.tsx`, `quote-draft-send.tsx`, `send-checklist.tsx`, `quote-document.tsx` (`acceptance` record + `acceptForm` slot), `quote-chain-actions.tsx`, `quote-accept.tsx` (`QuoteAcceptForm`, `AcceptJumpButton`), `quote-public-actions.tsx` (Avböj / Ställ en fråga).
- **Form ids:** `#offert-saknas`, `#offert-kund`, `#offert-rubrik`, `#offert-rot-rut`, `#offert-betalplan`, `#prisrader`; public accept: `#godkann-offert`, `#godkann-namn`.
- **DB:** `quotes`, `quote_versions` (payload JSONB is hash-frozen), `signatures` (= acceptances; migration 28 adds `method`, makes `order_ref` / `signer_personal_number_masked` / `environment` nullable; `evidence` JSONB holds contentHash, statement, customerNameAtAccept, acceptedByEmail, ip, userAgent, linkSentTo; `signatures_quote_uq` keeps one per quote; `apply-pending-schema.ensureQuoteAcceptanceSchema` mirrors it), `bankid_orders` (legacy).
- **Invariants:** Locked versions immutable — a sent/accepted quote is a snapshot; later edits create a new version and never change what was accepted. Public only via unguessable `token`. Totals panel says **Offertvärde**, not Att betala. Quote↔job same customer. Accept never requires personnummer; ROT fields only when ROT/RUT is on the document. Demo/`is_demo` accept makes zero external HTTP.
- **Desktop/mobile:** register table + cards. Form: sticky save on mobile (`DocStickyActions`). Public: fixed bottom bar + safe-area.
- **Live draft:** Offert **#116** `/ekonomi/offerter/quote-bokhylla` — ROT blockers: personnummer + bostad. Public `/offert/demo-eva-bokhylla` is **not** viewable. Acceptable public: `/offert/demo-bertil-fasad`.

### How an agent verifies (quote delete / send / accept)

**Discard draft**

1. `/demo` → Ekonomi → Offerter.
2. Open **#116** / `quote-bokhylla`.
3. Button *Kasta utkast* `[data-testid=discard-draft-trigger]` (`aria-label` on icon variant: *Kasta offertutkast*).
4. Dialog *Kasta offertutkast?* → *Kasta utkast*.
5. Land on Offerter with toast; #116 gone. Sent rows still listed.

**Do not expect a delete control on #115 / #110.** Use Hem overflow **Inte aktuell** for sent, or public **Avböj offerten**.

**Send**

1. New offert or fix #116 blockers (add personnummer on Eva + bostad).
2. *Skicka offert* enabled only when `#quote-send-blockers` empty.
3. After send: status **Väntar på godkännande**; demo banner about simulated mail.

**Back from komplettera**

1. Open a draft quote from Ekonomi (Back on the quote is **Ekonomi** or **Offerter**).
2. Click *Lägg till e-post* / *Komplettera företagsuppgifter* in `#quote-send-blockers`.
3. Customer or Inställningar Back must be **Offert #{n}**, not Ekonomi.
4. After save, that Back still returns to the same quote.

**Accept (demo, ~3 minutes)**

1. `/demo` → open `/offert/demo-bertil-fasad` (or Ekonomi → Offerter → #115 → *Öppna kundvyn*).
2. Scroll to **Godkänn offerten** (or tap **Godkänn offert** in the bottom bar → jumps + focuses). **Ditt namn** is prefilled *Bertil Lindqvist* — clear it and the button disables; type a name again.
3. Read the sentence, press **Godkänn offert** → *Offerten är godkänd* + receipt; page reloads to the read-only state with *Godkänd av …* and **Visa underlag för godkännandet**. Reload → no form, no second accept.
4. Back in the app: `/ekonomi/offerter/quote-fasad` shows badge **Godkänd**, *Version 1 låst*, the acceptance card (name, time, kund, e-post, IP · device, method) and the timeline row *Godkänd av Bertil Lindqvist*. `/kunder/cust-bertil` chain: Offert → Uppdrag (`job-fasad`, no duplicate) → Faktura.
5. Negative checks: `/offert/demo-eva-bokhylla` (utkast) → 404. No request to any BankID host. Puppeteer: `[data-testid=public-quote-accept]`, `[data-quote-accepted-banner]`, `[data-quote-acceptance-line]`.

Scripts: `scripts/verify.mjs`, `verify-validation-ux.ts`, `verify-tax-reduction.ts`, `verify-attention-browser.ts`. Tests: `quote-accept.test.ts` (happy path, empty name, already accepted, declined/expired/changed hash, rate limit, demo isolation, mail notice, DB mapping), `draft-actions.test.ts`, `flows.test.ts`, `quote-terms.test.ts`.

---

## Fakturor

- **User-facing name:** Fakturor (Ekonomi tab). Detail: **Faktura #{n}** or Utkast.
- **Purpose:** Get paid. Issue is atomic (number + snapshot + books).
- **Routes:** `/ekonomi?flik=fakturor`, `/ekonomi/fakturor/ny`, `/[id]`, `/[id]/redigera`, public `/faktura/[token]`, `/pdf`.
- **How to get there:** Ekonomi → Fakturor. Header **Ny faktura**. From job/customer/quote/command. Query `?kund=`, `?job=`, `?fristaende=1`.
- **Statuses:** Utkast, Skickad, Delbetald, Betald, Krediterad. Overdue **derived:** *Förfallen* / *Förfallen N dagar*. Credit badge **Kreditfaktura** (never overdue). Types: faktura, delbetalning, slutfaktura, kredit.
- **Filters:** Alla, Utkast, Obetalda, Förfallna, Betalda, Krediterade.
- **Main actions — utkast:** Redigera · Kasta utkast · **Skicka faktura** (issues **then** emails — `issueInvoice` + `emailInvoice`). Checklist `#invoice-send-blockers`.
- **Issued:** Visa kundvy, påminnelse if overdue, overflow: Kreditera (full only), Kopiera kundlänk, PDF, Skicka igen, **Simulera inbetalning** (demo **and** an active mock bank connection — hidden after *Koppla från*).
- **Paid:** *Betald och bokförd.*
- **Public:** utkast 404. *Fakturan är betald* / *Fakturan har förfallit*. Ladda ner PDF.
- **Related:** ROT application card; `DeniedReductionCard`; quote deviation; payments / bank match.
- **Components:** `doc-form.tsx` (InvoiceForm), `invoice-document.tsx`, `invoice-draft-send.tsx`, `invoice-issue-checklist.tsx`, `money-widgets.tsx`, `denied-reduction-card.tsx`.
- **Form ids:** `#faktura-saknas`, `#faktura-kund`, `#faktura-rot-rut`, `#faktura-betalvillkor`.
- **DB:** `invoices` (`number` null until issue), `invoice_line_items`, `invoice_issued_snapshots` (immutable legal copy), `payments`.
- **Invariants:** Number only via atomic `app.issue_invoice`. Issued UI reads snapshot. Partial pay → `delbetald`. Credit = reversal verification, not new revenue. Rest-invoice after denied ROT: `deniedReductionOf`, no new revenue.
- **Desktop/mobile:** same register pattern as offerter.
- **Live:** `#1042` Förfallen 6 dagar (Brf Eken); `#1047` Skickad delbetalning; one Utkast Brf Eken (`inv-1048`).
- **Verify:** Ekonomi → Fakturor → open #1042. Discard: only the Utkast row / detail `[data-testid=discard-draft-trigger]`. Public: `/faktura/{token}` for a sent invoice. Tests: `payment-flows.test.ts`, `financial-invariants.test.ts`. Script: `scripts/verify-financial-browser.ts`.

---

## ROT / RUT

- **User-facing name:** ROT/RUT, Skattereduktion, Preliminärt ROT-avdrag / RUT-avdrag
- **Purpose:** 30% ROT / 50% RUT on **arbete** lines; apply to Skatteverket after work + customer share paid. V1 is **manual** (no SKV API).
- **Where it lives (not its own nav item):**
  - Customer (privat): *+ Lägg till ROT/RUT-uppgifter*, bostäder (`customer-rot-section.tsx`)
  - Quote/invoice form: **Skattereduktion** (`#offert-rot-rut`, `#faktura-rot-rut`)
  - Documents: deduction line + **ROT/RUT-avdrag** terms
  - Invoice/job: `TaxReductionApplicationCard`, `DeniedReductionCard` (`#nekat-belopp`)
- **How to get there:** Open a privat customer, or a quote/invoice with ROT (demo: #116, #115, #113).
- **Application statuses:** Preliminär → Redo att ansökas → Väntar på Skatteverket → Godkänd / Delvis godkänd / Nekad.
- **Main actions:** toggle ROT/RUT; pick bostad; *Skapa ansökningsunderlag*; mark Godkänt / Delvis / Nekat; on nekat create rest invoice.
- **Related:** customers.personnummer, work_locations, quote/invoice terms snapshot.
- **Components:** `tax-reduction-fields.tsx`, `tax-reduction-application.tsx` (missing `workAddress` fill = `AddressAutocomplete composeSelected="line"`), `denied-reduction-card.tsx`. Logic: `src/lib/services/tax-reduction.ts`, `tax-reduction-gaps.ts`, `tax-reduction-send.ts`. Bostad address on the customer uses `AddressFields` (`customer-rot-section.tsx`).
- **DB:** `customers.personal_identity_number`; `work_locations` (beteckning / BRF / lägenhet); `jobs.housing`, `jobs.tax_reduction_application`; `invoices.rot`, `tax_reduction_*` JSONB.
- **Invariants:** Personnummer on **customer only**. Only `arbete` lines reduce. Cap 50 000 kr/person/year (shown in “Hur räknas detta?”). Denied rest invoice is collection, not new sales. Send blockers if ROT selected but PIN/bostad missing.
- **Live:** #116 draft blocked on PIN + bostad. Public #115 shows *Preliminärt ROT-avdrag − 14 025 kr*, Offertvärde 58 350 kr.
- **Verify:** `npx tsx scripts/verify-tax-reduction.ts`. Open `#offert-rot-rut` on a new quote. Nekat path: `#nekat-belopp`. Tests: `tax-reduction.test.ts`, `tax-reduction-send.test.ts`.

---

## Inbox

- **User-facing name:** Inbox
- **Purpose:** Inbound supplier invoices, receipts, other economic docs. **Not** website contact forms.
- **Routes:** `/inbox`, `/inbox/[id]`, `/inbox/[id]/kontrollera`. Inbound `POST /api/inbox/inbound`. Attachments `/api/inbox/bilaga/...`. Payment file `/api/betalfil/[id]`.
- **How to get there:** Nav Inbox (badge). Hem attention. Ekonomi utgifter *Öppna utgifter*.
- **Subtitle:** *Leverantörsfakturor, kvitton och andra ekonomiska dokument samlas här.*
- **Main actions:** filter Öppna / Alla; search; **Lägg till dokument**; copy inbound address; detail: Kontrollera belopp, Godkänn uppgifter, Skapa bankfil, Visa PDF.
- **Types:** Leverantörsfaktura (ska betalas) · Kvitto (redan betalt) · ekonomiskt dokument.
- **Stored status:** `ny` → `behandlad` → `bokford`. UI may show richer lifecycle (*Kontrollera belopp*, *Bokförd · Redo att betala*, *Bankfil skapad*).
- **Related:** Utgifter & kvitton, Bank, Bokföring questions, payment files (pain.001).
- **Components:** `inbox-list.tsx`, `inbox-address.tsx`, `extraction-review.tsx`, `inbox-upload.tsx`, `payment-file-actions.tsx`.
- **DB:** `inbox_items`, `business_settings.inbound_mail_slug`, `payment_files`, `supplier_payments`. Bucket `inbox_attachments`.
- **Invariants:** Tenant from **To** slug (`{slug}@in.driva.se`), never From. **No DELETE** on inbox_items. Dedup `(business_id, external_id)`. Badge ≠ open filter. Autopilot books only at high amount confidence or after `reviewedAt`. Website forms → jobs, not inbox.
- **Kvitto pipeline vs receipt file:** a `kvitto` inbox item that books (`createExpenseFromKnownReceipt`, `src/lib/services/inbox.ts` → `expenses.ts`) creates `expenses` + a `receipts` row with **filename only** (`item.attachments[0]?.filename`) — the attachment stays on `inbox_items.attachments` (`/api/inbox/bilaga/...`) and is **not** copied to `receipts.storage_path` / `content_base64`. Such rows therefore read *Bokfört · kvittouppgifter utan fil* in Utgifter and have no **Visa kvitto** link (see [Utgifter & kvitton](#utgifter--kvitton-flikutgifter)). Only **Lägg till kvitto** (`uploadReceiptAction`) stores the file on the receipt.
- **Live:** address `demo@in.driva.se`. Open: Byggmax *Kontrollera belopp*, Beijer *Bokförd · Redo att betala*. Badge **1**.
- **Verify:** `/inbox` shows inbound card + Byggmax. Open row → `/inbox/inbox-mail-byggmax`. Script: `scripts/verify-nav-browser.ts` expects `demo@in.driva.se`. Tests: `inbox.test.ts`. `scripts/db-validate.ts` asserts DELETE denied.

---

## Bokföring

- **User-facing name:** Bokföring
- **Purpose:** Auto-posted ledger; user only answers exceptions + VAT/year-end.
- **Routes** (`BOKFORING_DETAIL_TABS`):
  | Tab | Route |
  |-----|-------|
  | Översikt | `/bokforing` |
  | Verifikationer | `/bokforing/verifikationer` |
  | Huvudbok | `/bokforing/huvudbok` |
  | Rapporter | `/bokforing/resultat` (sub: Saldobalans, Resultat, Balans) |
  | Moms | `/bokforing/moms` |
  | Bokslut | `/bokforing/bokslut` |
- Also `/bokforing/detaljer` (legacy → verifikationer), `GET /api/bokforing/export?typ=`.
- **How to get there:** Nav Bokföring (badge). Hem *Öppna bokföring*. VAT attention → `/bokforing/moms`.
- **Overview copy:** *Sköts automatiskt i bakgrunden – du behöver bara svara när något är oklart.* Headline *N bokföringsfrågor att lösa*. Section **Behöver lösas**.
- **Main actions:** answer category questions, add missing receipt, mark VAT declared, close year, generate annual report, export CSV.
- **VAT states:** Kommande, Pågår, Att deklarera, Deklarerad. Copy mentions quarterly VAT due the 12th.
- **Related:** same action ids as Hem. Supplier/customer money stays in Inbox/Ekonomi/Hem — badge **only** `accounting` + `vat`.
- **Components:** `bokforing-advanced-nav.tsx`, `verifikationer-view.tsx`, `moms-periods.tsx`, layout `bokforing/layout.tsx`.
- **DB:** `verifications`, `accounting_entries`, `fiscal_years`, `vat_reports`, `assets`, `accruals`, `annual_reports`.
- **Invariants:** Posted verifications locked; corrections = new verification (`corrected_by_verification_id`). Debit = credit (`app.post_verification`). VAT numbers = huvudbok. Routine exceptions group on Hem when ≥3.
- **Live:** 4 questions (late VAT 47 108 kr, Grand Hôtel 4 250 kr category, Byggmax amount, Clas Ohlson missing receipt). Resultat före skatt 229 783 kr.
- **Verify:** `/bokforing` shows *Behöver lösas · 4*. Tabs persist. Tests: `accounting.test.ts`, `verification-correction.test.ts`.

---

## Ekonomi — Utgifter & kvitton / Bank

Not separate nav items; tabs on `/ekonomi`.

### Utgifter & kvitton (`?flik=utgifter`)

- **Copy:** *Kvitton och leverantörsfakturor. Åtgärder som behövs dyker upp på Hem och Bokföring.*
- **Header CTA:** `UploadReceiptButton` without `expenseId` renders **Läs av exempelkvitto** with a **DEMO** tag (the `label="Ladda upp kvitto"` prop is only used when an `expenseId` is set); tooltip *Demo: ett exempelköp skapas och bokförs. Riktig kvittotolkning är inte inkopplad ännu.* Standalone path = `uploadStandaloneReceiptAction` → `uploadStandaloneReceipt` (`expenses.ts`), **demo-only** (`assertDemoMode("Exempelkvitto")` → `DemoModeError` for a real business), template expense, filename only — **no file stored**.
- **Receipt for a specific purchase (file is stored):** CTA **Lägg till kvitto** on the *Kvitto saknas – {leverantör}, {belopp}* attention item (Hem / Bokföring, `attention-list.tsx`, `cta.type === "uploadReceipt"`) or `UploadReceiptButton expenseId=…`. Client reads the file as a data URL (`receiptFileToDataUrl`, `src/lib/receipts/read-file.ts`, max **5 MB** → *Kvittot är för stort (max 5 MB).*) → `uploadReceiptAction(expenseId, filename, dataUrl)` → `src/lib/receipts/receipt-file.ts` validates (PDF/JPEG/PNG/WebP/HEIC, else *Kvittot måste vara en bild (JPEG/PNG/WebP/HEIC) eller PDF.*) and stores **before** the tenant write commits — storage failure → the action returns `{ ok: false, error }` (shown inline next to the button) and nothing is committed (no receipt row in Supabase / `/demo` sessions). Success copy: attention *Kvitto sparat och matchat*; button *Kvitto sparat*. One receipt per purchase (*Köpet hos {leverantör} har redan ett kvitto kopplat.*).
  - Supabase + `SUPABASE_SERVICE_ROLE_KEY` → private bucket **`receipts`** at `<business_id>/<receipt_id>/<filename>` (`storage_path`).
  - Otherwise (JSON/demo, or no service key) → inline `content_base64`, max **1,5 MB** (`MAX_INLINE_ATTACHMENT_BYTES`); larger → *Kvittot är för stort för att sparas utan fillagring (max 1,5 MB). Sätt SUPABASE_SERVICE_ROLE_KEY för att aktivera bucketen.*
- **Viewing the file:** `GET /api/kvitto/[receiptId]` — **protected** (`withBusinessRead`, not a public prefix), `Content-Disposition: inline` for PDF/JPEG/PNG/WebP, `attachment` (+ `application/octet-stream`) for HEIC; filename sanitised to `[\w.\-åäöÅÄÖ ]`; `Cache-Control: private, no-store`; `X-Content-Type-Options: nosniff`. 404 *Kvittot finns inte.* for an unknown id; 404 *Kvittofilen finns inte sparad – endast uppgifterna om köpet.* when the row has no stored file.
- **Register rows (`ExpenseRegister`, labels from `economy-list.ts`):** bokförd + receipt **with** file → *Kvitto · Bokfört* + link **Visa kvitto** (`<a href="/api/kvitto/{receiptId}" target="_blank">`, table and card view). bokförd + receipt **without** file (seed data, Inbox-booked kvitton, exempelkvitto, pre-PR #77 rows) → *Bokfört · kvittouppgifter utan fil*, no link. `ExpenseTableRow.receiptId` is only set when a file exists (`receiptFileStored`).
- **Filters:** Alla, Behöver åtgärd, Redo att betala, Klara.
- **Batch:** *N fakturor är redo att betalas* + **Skapa bankfil**.
- **Live (2026-09-04):** Telia Bankfil skapad; Beijer/Trygg-Hansa redo; Söderport *Betalningsuppgifter saknas*; Grand Hôtel *Välj kategori*; Clas Ohlson *Saknar kvitto*. Seeded receipts have no stored file, so all seeded bokförda rows read *Bokfört · kvittouppgifter utan fil*; header shows **Läs av exempelkvitto**.
- **DB:** `expenses`, `receipts` (`storage_path`, `content_type`, `size_bytes`, `content_base64` — migration `26_receipt_content`; check `receipts_one_storage_chk`: never both `storage_path` and `content_base64`), `supplier_invoices`, `supplier_payments`. Bucket `receipts`.
- **Verify:** `/demo` → `/bokforing` (*Behöver lösas*; on Hem it may sit inside the grouped *N bokföringsfrågor* item) → *Kvitto saknas – Clas Ohlson, 349 kr* (`exp-clas`) → **Lägg till kvitto** → pick a small PNG/PDF (< 1,5 MB) → row resolves with *Kvitto sparat och matchat* → Ekonomi → Utgifter → Clas Ohlson row shows *Kvitto · Bokfört* + **Visa kvitto** → link opens `/api/kvitto/<id>` with the file. Negative: `/api/kvitto/<id>` in incognito → `/login?next=…`. Tests: `src/lib/receipt-file.test.ts`; adapter round-trip (*kvitto med inline-fil rundresas*) in `scripts/adapter-validate.ts` (`npm run test:adapter`).

### Bank (`?flik=bank`) — Open Banking AIS via Tink

- **Purpose:** Fetch balance + transactions from the business account and run them through payment matching. **Account information only** — Driva never moves money (no PIS/VRP; payments are pain.001 files).
- **Empty:** *Ingen bank kopplad ännu* + existing explanation + primary **Koppla företagskonto** + line *Du loggar in hos banken via Tink. Driva hämtar saldo och transaktioner för att matcha fakturor. Vi kan inte föra över pengar.*
- **Connection states** (`BankConnectionStatus`, labels in `status-labels.ts` → `BANK_CONNECTION_STATUS`): `disconnected` *Ingen bank kopplad* · `pending` *Väntar på banken* · `connected` *Kopplad* · `error` *Kopplingen misslyckades* · `revoked` *Frånkopplad*. Card shows bank name + masked account (`SEB · ···· 4512`) + *Senast uppdaterad …* + balance. Demo adds badge *Demo-bank*.
- **Actions (connected):** **Uppdatera** (fetch new tx → `registerBankTransactions` → matching; shows *N nya transaktioner*; same `externalId` is not re-imported or re-matched but **Motpart/Beskrivning/referens are refreshed** from Tink). **Koppla från** (confirm modal → revokes Tink credentials; **transactions and verifications stay**, status `revoked`, list still visible, **Koppla företagskonto** offered again). Pending: *Fortsätt hos banken* / *Avbryt kopplingen*. Error: *Försök igen*.
- **Filters:** Alla, Behöver åtgärd, Bokförda. Tx: Ny / Bokförd / Behöver åtgärd (or concrete *Matcha betalning*).
- **Tx columns:** **Motpart** = `merchantInformation.merchantName` else payer/payee name else `descriptions.display`. **Beskrivning** = `descriptions.original` else `detailed.unstructured` else `display`, omitted when it equals Motpart (Demo Bank often only has one text). `reference` is appended when present. Mapping in `tink/transaction-labels.ts`.

**Three modes (`selectBankProvider`, `src/lib/banking/select.ts`):**

| Mode | When | Behaviour |
|--|--|--|
| **Mock** (`MockBankProvider`) | `/demo`, `is_demo` business, JSON store, or `DRIVA_DEMO=1` — regardless of env | Connect is instant, no redirect. Creates account *SEB ···· 4512* (opening balance 48 250 kr) + synthetic tx: OCR payment for the oldest open invoice (auto-booked), a payment without OCR (*Matcha betalning*), a card purchase without receipt (*Behöver åtgärd*). **Zero HTTP to tink.com / link.tink.com.** |
| **Sandbox / live** (`LiveTinkProvider`) | Real business **and** `TINK_CLIENT_ID`, `TINK_CLIENT_SECRET`, `TINK_REDIRECT_URI` all set (`TINK_MARKET` default `SE`, `TINK_ENV` default `sandbox`) | Server creates a permanent Tink user (`external_user_id` = business id), delegates, builds the Tink Link URL (Transactions · connect-accounts, `market=SE`, `locale=sv_SE`, `state`=nonce.businessFingerprint, `test=true` when sandbox), client does **`window.location.assign`** (full page, never iframe). Callback validates state, exchanges token, imports 90 days of booked tx. **No `financial_services_segments`** — `BUSINESS` routes Link to `business-transactions`, which breaks the permanent-user flow (`REQUEST_FAILED_CREATE_AUTHORIZATION_CODE` after bank login). If a consent already exists on the Tink user (bank approved but the callback never reached us → `INVALID_STATE_DUPLICATE_CREDENTIALS` on retry), **Koppla** adopts it via `GET /api/v1/credentials/list` instead of a new Link round. |
| **Production-not-enabled** (`UnconfiguredBankProvider`) | Real business, env missing/incomplete | Every action returns *Bankkoppling är inte konfigurerad*; nothing crashes, nothing is faked. `TINK_ENV=production` merely drops `test=true` — Tink production access is a separate commercial step, not enabled by this code. |

- **Routes:** server actions `src/app/bank-actions.ts` (`connectBankAction`, `refreshBankAction`, `disconnectBankAction`, `cancelBankConnectAction`); callback `GET /api/bank/tink/callback` (= `TINK_REDIRECT_URI`, **requires the session cookie** — not a public prefix; proxy bounces to `/login?next=` and back). Callback redirects to `/ekonomi?flik=bank&bank=kopplad|avbrutet|fel` → toast, param stripped.
- **Files:** `src/lib/banking/provider.ts` (interface + CSRF state), `providers/{mock,tink,unconfigured}.ts`, `select.ts`, `connection-state.ts` (`bankConnectionView()` — the only thing the UI reads; never tokens), `errors.ts` (Swedish texts, no raw Tink JSON), `tink/{config,client,amounts,transaction-labels}.ts` (15 s timeouts, injectable transport for tests, `unscaledValue/scale` → whole kronor at the boundary, ADR-1; Motpart/Beskrivning from distinct Tink fields). UI: `src/components/bank-connection.tsx`, card in `src/app/(app)/ekonomi/page.tsx`.
- **DB:** `bank_accounts` (+ `external_id` = Tink account id, idempotent re-import), `bank_transactions` (unique `external_id`), **`bank_connections`** (migration 27: status, `tink_user_id`, `credentials_id`, `access_token` + expiry, pending CSRF state, bank name, masked account, `last_sync_at`, `last_error`). RLS grants **`driva_app` only** — no `authenticated` policy, so tokens are unreachable via the Data API. Demo reset deletes the row.
- **Env:** `TINK_CLIENT_ID`, `TINK_CLIENT_SECRET`, `TINK_REDIRECT_URI` (byte-for-byte equal to the Console redirect URI), `TINK_MARKET`, `TINK_ENV`. Server-only; never `NEXT_PUBLIC_TINK_*`. Demo Bank usernames are never stored in env or repo.
- **Errors (user-facing only):** *Banken godkände inte kopplingen. Försök igen.* (auth/declined/401/403) · *Tillfälligt fel hos banken. Försök igen.* (network, timeout, 5xx, bad JSON) · *Bankkoppling är inte konfigurerad* · *Kopplingen kunde inte verifieras. Försök igen.* (state mismatch). `USER_CANCELLED` from Tink Link is **not** an error → *Kopplingen avbröts.*
- **Invariants:** production without bank must not fake payments; **Simulera inbetalning** / demo receipt tx require `hasConnectedBank()` (mock only); a demo business can never reach Tink even if the live provider were selected (`assertNotDemo`); a live business never gets mock data.

**Verify (mock, JSON dev on :3123):** `POST /api/dev/reset {"mode":"empty"}` → `/ekonomi?flik=bank` shows empty state with **Koppla företagskonto** + secondary line → click → card *SEB · ···· 4512* · *Kopplad* · *Senast uppdaterad* · Uppdatera / Koppla från; tx list has *Clas Ohlson* → **Uppdatera** shows *N nya transaktioner* → **Koppla från** → confirm → *Frånkopplad*, list still populated, **Koppla företagskonto** back. Puppeteer request listener: no request to `tink.com`. Tests: `src/lib/bank-connection.test.ts` (selection, CSRF, öre→kr, error mapping, mock + live via fake transport), `economy-list.test.ts`.

**Verify (sandbox, Vercel with env, real non-demo business):** Ekonomi → Bank → **Koppla företagskonto** → full-page redirect to `link.tink.com/1.0/transactions/connect-accounts?…&test=true` → choose **Demo Bank** → log in as Tink's *Demo Bank User 1* (credentials from Tink docs, not stored here) → approve → back on `/ekonomi?flik=bank` with toast *Banken är kopplad* and card *Demo Bank · ···· NNNN* · *Kopplad*. Transactions appear; Motpart and Beskrivning differ when Tink sent both. A matching OCR payment books an invoice. **Uppdatera** re-syncs (7-day overlap, idempotent) and refreshes labels on existing rows. **Koppla från** → `DELETE /api/v1/credentials/{id}` → *Frånkopplad*, history intact. Cancel in Tink Link → *Kopplingen avbröts. Inget har ändrats.*

---

## Hemsida

- **User-facing name:** Hemsida
- **Purpose:** Public marketing site + contact form + optional `.se` domain.
- **Routes:** `/hemsida` (editor), `/hemsida/doman`, public `/sajt` and `/sajt?preview=1`, customer policy `/integritetspolicy`.
- **How to get there:** Nav Hemsida (if feature on). Command *Skapa en hemsida*. Settings Funktioner **Aktivera Hemsida**. Disabled URL → `/installningar?flik=funktioner`.
- **Editor tabs:** Innehåll, Design, Inställningar (in `SiteEditorShell`).
- **Draft = safe workspace** ([PR #66](https://github.com/elialm94/driva/pull/66)): on a **published** site every edit lands in the draft layer - section text/images/CTA/hours, ordering, visibility, add/remove and primary CTA (`draftSections`, `draftPrimaryCta`, via `mutableSections` / `mutablePrimaryCta`) plus theme/accent, footer and privacy (`draftDesign`, `draftFooter`, `draftPrivacyPolicy`). Builder `/hemsida` and `/sajt?preview=1` render the draft (`websiteDraftView`); public `/sajt` stays on the published version until Publicera. A never-published site is a draft in its entirety (no draft layer). Edits autosave; **no leave confirmation** when navigating away from `/hemsida` - the draft survives leave/return. Reverting an edit back to the published content clears that draft automatically (`clearMatchingSectionDrafts` in `touchSite`), so no false *Opublicerade ändringar*.
- **Main actions:** AI generate (*Vad gör ditt företag?*, `#hemsida-ai-beskrivning`), edit sections, **Publicera hemsidan** / **Publicera ändringar** (`PublishWebsiteButton`), **Återställ** (`RestoreWebsiteDraftButton`, only when live **and** `hasUnpublishedWebsiteDrafts`), Öppna i ny flik (`/sajt` when live, else `/sajt?preview=1`), Kopiera länk, domain search (`#doman-sok`). Mobile: `StickyMobileActions` holds Återställ + Publicera when dirty.
- **Publicera (snapshot publish):** the client sends its current editor snapshot (`WebsiteEditorSyncProvider.getSnapshot()`: revision, design, footer, privacy, section order/visibility, pending section updates, primary CTA) in `publishWebsiteAction` → `publishWebsite(input)`; the server persists + publishes in the same commit, so Publicera never waits on a pending autosave. Button disabled/deduped while in flight (`beginPublish`). Confirm modal *Publicera hemsidan* → **Publicera**; the success view *Hemsidan är publicerad* + **Öppna sajten** is shown only after the server confirms (revision published, `hasUnpublishedDrafts` false) - otherwise it refreshes or shows *Publiceringen hann inte med senaste ändringen. Försök igen.* A failed publish keeps the editor state. Newer client edits than the snapshot survive as drafts (`keepNewerDrafts`).
- **Återställ:** lightweight confirm - title *Återställ ändringar?*, body *Alla opublicerade ändringar tas bort och hemsidan återställs till den publicerade versionen.*, buttons **Avbryt** / **Återställ**. `restoreWebsiteDraftAction` → `restorePublishedWebsiteDraft()` deletes every draft field and bumps `draftRevision` + `publishedRevision`, then `sync.resetToServer` + `router.refresh()`. After restore draft = published and the badge is gone. Requires `status === "publicerad"`. Not the same thing as the banner *Din tidigare hemsida är återställd* (`?aterstalld=1` / paused site after feature re-activation).
- **Revision guard:** `draftRevision` / `publishedRevision` (`src/lib/website-publish.ts`: `isStaleWebsiteWrite`, `acceptWebsiteWrite`). Every autosave carries `clientRevision` (`enqueueWebsiteMutation`); a write with revision ≤ `publishedRevision` or < `draftRevision` is a no-op, so late or stale autosaves after Publicera / Återställ cannot recreate a draft. A publish snapshot older than `publishedRevision` fails with *Utkastet är för gammalt. Ladda om sidan och försök igen.*
- **Statuses:** Utkast, Publicerad, Pausad, Opublicerade ändringar (badge next to the preview URL; `hasUnpublishedWebsiteDrafts` = published and design, footer, privacy, sections **or** primary CTA differ from published). Header subtitle *Publicerad {datum} · opublicerade ändringar*. `/sajt?preview=1` shows the banner *Förhandsvisning av opublicerade ändringar …* when any of `draftDesignPending` / `draftFooterPending` / `draftPrivacyPending` / `draftContentPending` (sections + CTA) is set (`public-site.ts`).
- **Related:** Inställningar company identity (logo/address reused). Form creates **jobs**.
- **Components:** `site-widgets.tsx` (`SectionList`, `PublishWebsiteButton`, `RestoreWebsiteDraftButton`), `website-editor-sync.tsx` (`WebsiteEditorSyncProvider`, `useWebsiteEditorSync`, `enqueueWebsiteMutation`), `site-editor-shell.tsx`, `site-section-builder.tsx`, `site-design-widgets.tsx`, `site-footer-settings.tsx`, `domain-widgets.tsx`, `website-form-recipient.tsx`, `privacy-policy-settings.tsx`. Logic: `src/lib/services/website.ts` (`publishWebsite`, `publishedWebsiteSnapshot`, `restorePublishedWebsiteDraft`), `website-drafts.ts` (`websiteDraftView`, `draftWebsiteSections`, `hasUnpublishedWebsiteDrafts`), `website-publish.ts`, `public-site.ts`.
- **DB:** `websites` - published `sections`, `primary_cta`, `design`, `footer`, privacy columns + draft layer `draft_sections`, `draft_primary_cta` (new in PR #66), `draft_design`, `draft_footer`, `draft_privacy_policy`, revisions `draft_revision`, `published_revision` (migrations `20260831140000_23_website_revisions.sql`, `20260831143000_23_website_draft_workspace.sql`; mirrored in `apply-pending-schema.ts` + `mappers.ts`). `domains`. Flags: `meta.features.website`, `meta.websitePausedAt`.
- **Invariants:** Deactivate **pauses** public site; does not delete. Live public = feature on + `status === "publicerad"` + not paused. Public `/sajt` never renders draft data - only `?preview=1` and the builder do. A draft is never dropped by navigation; only Publicera (promotes) or Återställ (discards) ends it. `websiteNotificationEmail` ≠ company email unless set.
- **Selectors:** no `data-testid` on Publicera / Återställ or their modals - use button text (**Publicera ändringar**, **Återställ**), modal titles and the badge text.
- **Live:** Published 3 juni 2026; URL `driva.site/sodermalms-snickeri`; no custom domain yet.
- **Verify (demo, seed site is published):**
  1. `/demo` → **Hemsida** → edit a section heading → badge **Opublicerade ändringar**, **Återställ** appears. `/sajt` unchanged; `/sajt?preview=1` shows the edit + the preview banner.
  2. Go to Hem and back to `/hemsida` → no leave modal, the edit is still there.
  3. **Återställ** → *Återställ ändringar?* → **Återställ** → badge gone, heading back to published.
  4. Edit again → **Publicera ändringar** → **Publicera** → *Hemsidan är publicerad*; `/sajt` updated, badge gone, no *Opublicerade ändringar* after reload.
  5. Form submit → new job, not inbox.
  Tests: `website-*.test.ts` - `website-publish-race.test.ts` (snapshot publish, late saves, draft workspace, Återställ, revision guard), `website-drafts.test.ts`, `website-schema.test.ts`. Script: `scripts/verify-privacy-browser.ts`.

---

## Inställningar

- **User-facing name:** Inställningar
- **Purpose:** Company identity, invoice/payment defaults, optional features, account.
- **Route:** `/installningar?flik=foretag|fakturering|funktioner|konto` (`src/lib/settings-routes.ts`). Legacy `flik=standardval` → fakturering. Deep-link `?falt=name|orgNumber|vatNumber|address|…`.
- **How to get there:** Sidebar/Mer **Inställningar**. Billing blockers and domain “complete company” deep-link here.
- **Tabs:** Företag · Fakturering & betalning · Funktioner · Konto.
- **Företag:** logo, name, org.nr, VAT, address, contact. Save *Spara ändringar*. `#installningar-saknas`. Address = shared `AddressFields` (label **Gatuadress**): `#installningar-address`, `#installningar-postalCode`, `#installningar-city`.
- **Fakturering:** payment details (bankgiro/plusgiro/bank/IBAN), invoice defaults, **billing readiness**. The *komplettera adress* form in `settings-billing-readiness.tsx` uses the same `AddressFields`: `#komplettera-address`, `#komplettera-postalCode`, `#komplettera-city`.
- **Funktioner:** Hemsida + Samarbeta toggles (`feature-settings.tsx`) — Aktiv/Avstängd, Aktivera/Stäng av.
- **Konto:** real user email + logout via menu. Demo: *Driva körs just nu utan inloggning…* no password.
- **Billing readiness testids:** `billing-readiness-banner` | `billing-readiness-ready` | `billing-readiness-success` | `billing-complete-{name|orgnr|vat|address|payment}`. Copy: *Redo att fakturera*.
- **Related:** `/foretag` is a parent crumb to settings (legacy). Onboarding fields overlap.
- **Components:** `settings-form.tsx`, `settings-billing-readiness.tsx`, `feature-settings.tsx`, `demo-reset-section.tsx`.
- **DB:** `business_settings`, `meta.features`.
- **Live:** *Redo att fakturera* (demo company complete). Demo reset section at bottom of Företag.
- **Verify:** `/installningar?flik=fakturering` + testids. Script: `scripts/verify-billing-readiness-browser.ts`. Tests: `billing-readiness.test.ts`, `settings-*.test.ts`.

---

## Samarbeta / redovisningskonsult

- **User-facing name:** Samarbeta (owner). **Redovisning** (consultant workspace).
- **Purpose:** Invite an accountant/auditor into the company. Separate chrome — not the owner sidebar.
- **Owner routes:** `/samarbeta` — **gated**. Live demo redirects to Funktioner until activated.
- **How to get there (owner):** Settings → Funktioner → **Aktivera Samarbeta** → nav appears. Or command *Bjud in redovisningskonsult*. Demo menu **Visa redovisningsvyn** jumps to accountant UI without enabling the nav item.
- **Owner UI:** *Låt din redovisningskonsult hjälpa till direkt i Driva.* CTA **Bjud in redovisningskonsult**. `#invite-form`, `#invite-email`. Statuses: Inbjudan skickad, Ansluten, Åtkomst borttagen, Inbjudan har gått ut.
- **Invite accept:** `/inbjudan/[token]` → Acceptera → `/redovisning`. Roles shown: Redovisningskonsult, Revisor, Ägare, Administratör, Medlem.
- **Consultant routes:**
  | Route | Label |
  |-------|-------|
  | `/redovisning` | portfolio |
  | `/redovisning/k/[businessId]` | Arbeta |
  | `.../verifikationer`, `/bank`, `/moms`, `/rapporter`, `/bokslut` | client tabs |
  | `/redovisning/installningar` | logout |
- `/redovisning/klienter` and `/att-gora` redirect into portfolio/client.
- **Filters:** Alla, Brådskande, Moms, Bank, Underlag, Granskning, Väntar. Empty: *✓ Allt klart — Inget behöver din hjälp just nu.*
- **Permissions:** consultant cannot send quotes/invoices, publish site, submit bank payments, or invite. Auditor = read + export.
- **Related:** owner Inställningar Funktioner; demo accountant Anna Svensson.
- **Components:** `samarbeta-view.tsx`, `redovisning-shell.tsx`, `accountant-workspace.tsx`.
- **DB:** `business_memberships` (extended roles), `collaboration_invitations`, `client_information_requests`.
- **Verify:** activate feature → `/samarbeta` shows invite form. Demo: company menu → *Visa redovisningsvyn* → `/redovisning`. Tests: `collaboration.test.ts`.

---

## Demo (product surface)

Covered in [Demo mode](#demo-mode). In the **product** UI, demo is not a page — it is a session + the company-row menu + Inställningar reset. Landing CTA **Se demo** is the public entry.

**Verify enter/exit:** `scripts/verify-logged-out-demo.ts`. After reset, Offert #116 exists again as Utkast.

---

## Hjälp & support (adjacent)

- **Hjälp & support** `/support` — *Beskriv vad du behöver hjälp med.* Submit **Skicka**. Creates `support_tickets`.
- **Driva Admin** `/admin` (separate dark shell): Översikt, Support, Företag, Användare, System, Admins. Not in customer nav. See `docs/admin.md`.

---

## Stable selectors / test IDs

The repo has **almost no** `data-testid`. No `data-cy` / `data-qa` / `getByTestId`.

### All `data-testid` values

| testid | File | Use |
|--------|------|-----|
| `discard-draft-trigger` | `src/components/discard-draft-button.tsx` | Quote/invoice **button** discard (not the icon-in-register variant) |
| `billing-readiness-banner` | `settings-billing-readiness.tsx` | Missing billing fields |
| `billing-readiness-ready` | same | Silent ready |
| `billing-readiness-success` | same | Just completed |
| `billing-complete-${id}` | same | Rows: `name`, `orgnr`, `vat`, `address`, `payment` |

### Other stable hooks (prefer these today)

**Auth / onboarding ids:** `auth-email`, `auth-password`, `signup-email`, `signup-phone`, `signup-password`, `reset-email`, `new-password`, `confirm-password`, `ob-*`.

**Document forms:** `offert-saknas`, `offert-kund`, `offert-rubrik`, `offert-rot-rut`, `offert-betalplan`, `quote-send-blockers`, `faktura-saknas`, `faktura-kund`, `faktura-rot-rut`, `invoice-send-blockers`, `prisrader`.

**Customers / jobs:** `ny-kund-namn`, `ny-kund-epost`, `ny-kund-telefon`, `ny-kund-personnummer`, `ny-kund-orgnr`, `kund-namn`, `kund-epost`, `kund-personnummer`, `nytt-uppdrag-titel`, `uppdrag-titel`.

**Settings:** `installningar-saknas`, `installningar-address`, `installningar-postalCode`, `installningar-city`, `installningar-bankgiro`, `komplettera-address`, `komplettera-postalCode`, `komplettera-city`.

**Address autocomplete (all surfaces):** street input `role="combobox"` (`aria-expanded`, `aria-autocomplete="list"`); suggestion menu `data-address-suggestions` (portaled — query from `document`, not the form); options `data-address-option={i}`; demo suggestions show a **Demo** tag.

**Other:** `nekat-belopp`, `invite-email`, `invite-form`, `hemsida-ai-beskrivning`, `doman-sok`, `webbformular-mottagare`, `data-nav="back"`, `data-driva-demo="1"`.

**Receipt file:** link text **Visa kvitto** with `href^="/api/kvitto/"` in `ExpenseRegister` (only when a file is stored). The **Lägg till kvitto** control is a `<label>` wrapping a hidden `input[type=file][accept="image/*,.pdf"]` — no `aria-label`, no testid; match on the label text.

**Aria / roles used by existing browser scripts:**

- Nav links: `aria-label` = Swedish section name (plus badge text).
- Create: `aria-label="Ny offert"|"Ny faktura"|"Ny kund"`.
- Discard icon: `aria-label="Kasta offertutkast"|"Kasta fakturautkast"`.
- Command bar: `role="listbox"` `aria-label="Förslag"`.
- Mer sheet: `role="dialog"` `aria-label="Mer"`.
- Demo menu: `aria-haspopup="menu"`.
- List rows: `aria-label={customer.name}` / `{job.title}`.
- Attention overflow: `aria-label` prefix *Fler alternativ för*.

**Demo fixtures (stable ids/tokens):** see [Demo mode](#demo-mode). Prefer these over brittle row indexes.

**Existing automated coverage:** `src/lib/*.test.ts` (domain, no DOM). Browser scripts in `scripts/verify-*.ts` expect **dev server :3123** and mostly use text/aria, not testids. **CI** (`.github/workflows/ci.yml`, every PR + push to main, no external services): `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:db` (PGlite), `npm run test:adapter` (PGlite), `npm run build`. Browser scripts are **not** in CI.

---

## Missing verification hooks

Important UI with **no** `data-testid` (agents must use text, href, or fragile CSS):

- Sidebar / bottom nav / Mer sheet items and badges
- Command bar input, suggestion rows, confirm cards
- Address suggestion list / pick flow (use `[data-address-suggestions]`, `[data-address-option]`, the `role="combobox"` input, or the **Demo** tag text instead)
- Hem attention rows, watching rows, reminder rows + Klar/Snooza
- Ekonomi / Kunder / Inbox / Bokföring **tabs and filter chips**
- Register rows (quote/invoice/customer/job/inbox) as clickable units
- Quote/invoice detail primary actions: Skicka, Redigera, Öppna kundvyn, Kopiera kundlänk (discard button is the exception)
- Public Godkänn offert (`public-quote-accept`) / Avböj (`public-quote-decline`) / Ställ en fråga
- Job detail: Skapa faktura, Markera som klart, Ta bort
- Inbox detail workflow + Skapa bankfil
- Receipt upload: **Lägg till kvitto** file input (attention item / `UploadReceiptButton`), *Kvitto sparat* / *Kvitto sparat och matchat* / error text, **Visa kvitto** link (only `href^="/api/kvitto/"` is stable)
- Hemsida: **Publicera hemsidan** / **Publicera ändringar**, **Återställ** and their confirm modals (*Publicera hemsidan*, *Återställ ändringar?*) - button text + modal title only; the **Opublicerade ändringar** badge is text only
- Bokföring overview question cards and VAT mark-declared
- Demo menu items (Återställ / Avsluta / Visa redovisningsvyn / Skapa konto)
- Settings tab strip and feature toggles
- Samarbeta invite submit (has `#invite-email` only)
- Support form submit
- Auth submit buttons (fields have ids; buttons do not)

---

## Highest-value missing verification hooks

Add **only** these. Enough to make the main Swedish flows automatable without a dump of one id per widget.

| Priority | Proposed `data-testid` | Where | Why |
|----------|------------------------|-------|-----|
| 1 | `nav-item-{hem,kunder,ekonomi,inbox,bokforing,hemsida,samarbeta,installningar}` | `nav.tsx` | Reach any area without depending on visible label/CSS. Include mobile Mer. |
| 2 | `command-bar-input` | `command-bar.tsx` | Hem’s primary control; every “do X from Hem” repro starts here. |
| 3 | `quote-row-{id}` / `invoice-row-{id}` | `economy-register.tsx` | Open #116 / #1042 without matching Swedish status text. |
| 4 | `quote-send` / `invoice-send` | draft send components | Pair with existing `discard-draft-trigger` + checklists. |
| 5 | `attention-item-{actionId}` | `attention-list.tsx` | Hem/Bokföring share ids; needed for “Inte aktuell”, remind, bankfil. |
| 6 | `public-quote-accept` / `public-quote-decline` (**added**) | `quote-accept.tsx` / `quote-public-actions.tsx` | Customer accept is the product’s signature moment. |
| 7 | `demo-menu` + `demo-reset` + `demo-end` | `demo-menu.tsx` | Every live/QA session enters and resets here. |
| 8 | `job-row-{id}` + `job-create-invoice` | uppdrag list + `job-controls.tsx` | Job → invoice is the core money path. |
| 9 | `inbox-row-{id}` + `inbox-create-payment-file` | inbox list/detail | Badge/open/pay path; today only address text is asserted. |
| 10 | `kunder-tab-uppdrag` / `ekonomi-tab-{offerter,fakturor,utgifter,bank}` | tab strips | Agents constantly miss that Offerter/Uppdrag are **tabs**. |

Do **not** add testids to every settings field or design token — those already have `id=` hooks (`ob-*`, `offert-*`, `installningar-*`).

---

## Reproduction recipes (quick)

**Always start from a clean demo:** `/demo` or Återställ demo. Seed ids above are valid after reset.

| Task | Steps |
|------|-------|
| Open Offerter | `/demo` → **Ekonomi** → tab Offerter (default) |
| Delete a quote | Only #116 → *Kasta utkast* → confirm. Sent quotes: Hem *Inte aktuell* or public *Avböj*. |
| Accept a quote | `/offert/demo-bertil-fasad` → **Godkänn offerten** → name → Godkänn offert |
| Overdue invoice | `/ekonomi/fakturor/inv-1042` |
| Inbox badge item | `/inbox/inbox-mail-byggmax` |
| Upload a receipt file | `/bokforing` → *Kvitto saknas – Clas Ohlson, 349 kr* → **Lägg till kvitto** (file < 1,5 MB) → Ekonomi → Utgifter → **Visa kvitto** |
| Address autocomplete (demo) | `/demo` → Kunder → **Ny kund** → type `Väd` in **Adress** → `[data-address-suggestions]` with **Demo** tag → pick → adress + postnummer + ort filled |
| Enable Samarbeta | `/installningar?flik=funktioner` → Aktivera Samarbeta |
| Accountant UI | Company row → Visa redovisningsvyn |
| Auth wall | Incognito `/kunder` → login with `next=/kunder` |

Local: `npm run dev` → http://localhost:3123 (JSON demo, no `/demo` needed). Do not kill a healthy process on 3123.
