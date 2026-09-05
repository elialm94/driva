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

**Unknowns** are marked `UNKNOWN`. Facts below are from code + the live demo on 2026-09-01 unless noted. Shared address autocomplete ([PR #79](https://github.com/elialm94/driva/pull/79), hardened in [PR #94](https://github.com/elialm94/driva/pull/94): loader timeout, street-only types, Enter-while-searching) verified against main code 2026-09-04. Receipt file storage ([PR #77](https://github.com/elialm94/driva/pull/77)) verified against main code and the live demo 2026-09-04. Customer e-mail subjects for quotes/invoices ([PR #101](https://github.com/elialm94/driva/pull/101)) verified against main code 2026-09-04.

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

- **Source:** Google Places API (New) when `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is set **and** the surface is not demo. Key is read via `googleMapsApiKey()` (trimmed; empty / whitespace = not configured). `[data-driva-demo]` → local Swedish example list only, no Google HTTP. Missing key / Google failure → manual typing still works; no raw Google errors, no dead dropdown. Demo suggestions carry a **Demo** tag.
- **Behaviour:** Sweden-only (`includedRegionCodes: ["se"]`) **and** street-only results — `includedPrimaryTypes` = `premise`, `subpremise`, `street_address`, `route` (`ADDRESS_PRIMARY_TYPES`), language `sv-SE`; no map/Street View. Search from **3 meaningful characters** after trim (`"va"` does not fire), debounce 250 ms (`ADDRESS_SEARCH_DEBOUNCE_MS`). One session token per typing session; `fetchFields(["addressComponents"])` only after the user picks a suggestion. Maps loader (`referrerPolicy="origin"`) gives up after **8 s** (`ADDRESS_PLACES_LOAD_TIMEOUT_MS`); invalid key / referer block / script failure clears the searching state — **no hung spinner**, field falls back to manual typing. Opening an edit form with a saved address does **not** call Places. Picking writes street + postal + city (or one composed line); name / e-mail / phone / personnummer untouched. `composeSelected="street"` (default) vs `"line"` (`gata, postnummer ort`) for single-field forms. Live key path (real Göteborg results etc.) is **not** verified in this environment — code only.
- **Keyboard:** Arrow moves highlight; Enter picks the highlighted row when the list is open; Enter never submits the parent form while the list is **open or a search is in flight** (`searching`), so Ny kund cannot submit early; Escape closes; Tab moves on.
- **Selectors:** input `role="combobox"` `aria-expanded` `aria-autocomplete="list"`, `aria-busy` while searching; menu is portaled + viewport-flipped with `data-address-suggestions`, `z-index` 400 (`ADDRESS_MENU_Z_INDEX`, above the Ny kund modal at z=50); options `data-address-option={i}`. No `data-testid`.

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

Config: `NAV_ITEMS` in `src/lib/nav.ts` (each item has `group: "primary" | "more"`; helpers `primaryNavItems` / `moreNavItems` apply the optional-feature filter). Icons in `src/components/nav.tsx` (`NAV_ICONS`, Uppdrag = `Hammer`).

**Main navigation = Hem · Uppdrag · Kunder · Ekonomi · Mer** — identical on desktop sidebar and mobile bottom bar. Uppdrag is the craftsman's workspace and therefore primary; Kunder is only the customer register.

| UI label | Route | Section | Group | Badge |
|----------|-------|---------|-------|-------|
| Hem | `/` | `hem` | primary | never |
| Uppdrag | `/uppdrag` | `uppdrag` | primary | never |
| Kunder | `/kunder` | `kunder` | primary | never |
| Ekonomi | `/ekonomi` | `ekonomi` | primary | never |
| Inbox | `/inbox` | `inbox` | Mer | open items (`countInboxBadge`) |
| Bokföring | `/bokforing` | `bokforing` | Mer | bookkeeping questions (`countBookkeepingBadge`) |
| Samarbeta | `/samarbeta` | `samarbeta` | Mer | never; **optional** |
| Hemsida | `/hemsida` | `hemsida` | Mer | never; **optional** |

**Mer** also holds (not sections): **Inställningar** `/installningar`, **Hjälp & support** `/support?fran=<path>`. Inbox/Bokföring keep their count badges inside Mer; on mobile the **Mer** tab shows the summed badge (`Mer, {n} att lösa`).

Active section: `sectionForPath` → `isSectionActive`. `/uppdrag` **and** `/uppdrag/[id]` (plus legacy `/jobb/[id]`, `/kunder/forfragningar/[id]`) light up **Uppdrag**; `/kunder` and `/kunder/[id]` light up **Kunder**. Active links carry `aria-current="page"`.

**Optional features** (`src/lib/features.ts`, `src/lib/optional-features.ts`): `website`, `collaboration`. Hidden from nav when off. Direct URL redirects to `/installningar?flik=funktioner`. Existing usage without a stored flag counts as on (backfill). Explicit `false` wins. Deactivate does **not** delete content.

**Demo (JSON mode):** sidebar shows Hem, Uppdrag, Kunder, Ekonomi, then the **Mer** group: Inbox (badge), Bokföring (badge), Hemsida, Inställningar, Hjälp & support. **Samarbeta is absent** (collaboration not activated). Company footer: **Södermalms Snickeri AB** + **Demo** badge.

Badge aria: `Inbox, {n} öppna` / `Bokföring, {n} bokföringsfrågor att lösa`. Counts from `src/lib/services/nav-counts.ts`.

### Desktop vs mobile

- **Desktop (`lg+`):** fixed 240px sidebar. Primary four rows, then a muted **Mer** heading (`#sidebar-mer-rubrik`) over the always-expanded group `[data-nav-group="mer"]` (Inbox, Bokföring, optional Samarbeta/Hemsida, Inställningar, Hjälp & support). Footer = company name / demo menu / workspace switcher / logout only.
- **Mobile:** bottom bar `nav[aria-label="Huvudnavigation"]` = **Hem · Uppdrag · Kunder · Ekonomi · Mer** (five equal tabs, icon + label, ≥44px). Mer sheet (`role="dialog"` `aria-label="Mer"`) holds Inbox, Bokföring, optional Samarbeta/Hemsida, Inställningar, support, demo/logout.
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
| `/kunder?flik=uppdrag` (old Kunder tab) | `/uppdrag` (q, visning, ekonomi, sortering, sida, tillbaka, tillbakaNamn preserved) |
| `/kunder?flik=forfragningar` | `/uppdrag` |
| `/kunder?flik=kunder` | `/kunder` |
| `/assistent` | `/` |
| `/kunder/forfragningar/:id` | `/uppdrag/:id` |

Server-side: `next.config.ts` `redirects()` (`/jobb*`, `/pengar*`, `/assistent`) plus page-level `redirect()` in `kunder/page.tsx` (`?flik=uppdrag|forfragningar` → `/uppdrag`, drops `flik`, keeps the list/back params), `jobb/page.tsx`, `jobb/[id]/page.tsx`, `kunder/forfragningar/[id]/page.tsx`. Client-side: `rewriteLegacyHref` / `sanitizeReturnTo` in `src/lib/nav.ts` normalise hrefs and `tillbaka=` chains the same way.

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
        ├── business_onboarding (1:1 – onboarding status + Kom igång profile/task choices)
        ├── data_imports (audit of file imports, hash-unique per kind); suppliers
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

Public **Se demo** does **not** use Supabase. `GET /demo` (`src/app/demo/route.ts`) sets httpOnly cookie `driva_demo` (`<expiresMs>.<sessionId>`), clones `buildSeed()` (`src/lib/seed.ts`) to `.data/demo-sessions/<id>.json` (or `/tmp` on serverless). Incognito = new clone.

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

**Södermalms Snickeri AB**, org `559123-4567`, address Renstiernas gata 12, 116 28 Stockholm, bankgiro `5678-1234`, inbound `demo@in.ferva.se`, site slug `sodermalms-snickeri`. Demo user: `demo@driva.local` / name **Du**. Accountant persona: **Anna Svensson**.

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

**Fakturor:** paid `#1033`–`#1041`/`#1045`; `#1042` slutfaktura Brf Eken **Förfallen**; `#1047` delbetalning Johan **Skickad**; `inv-1048` **Utkast** Brf Eken (list title is the first line “Lagning av portparti, entré Åsögatan 114”, no number — status chip stays Utkast). Two 0 kr **Utkast** for Eli (`inv-eli-luckor` “Luckor i ek”, `inv-eli-bankskiva` “Bänkskiva i ask”). Tokens e.g. `demo-f1048`.

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
| Places (address autocomplete) | Local Swedish examples with **Demo** tag — **zero Google HTTP** even if a key is set | Google Places API (New, Sweden + street types only) if `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` set; no key / Google failure / 8 s load timeout → manual typing (local examples only when no key). Shared component — see [Address autocomplete](#address-autocomplete-shared) |
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
- **Subflows:** Signup without session → `/verifiera-epost`. Confirm → `/` → `requireBusiness` → `/onboarding` if no membership **or** the owned company's onboarding is not complete (step 2 resumes). Reset → `/auth/bekrafta?next=/uppdatera-losenord`. Notices: `?bekraftelse=utgangen|ogiltig`, `?demo=upptagen`.
- **Actions:** `src/app/auth-actions.ts`.
- **Related:** Onboarding, invitations, demo convert-to-account.
- **DB:** `auth.users`; memberships created at onboarding.
- **Invariants:** Password never in URL. `safeAuthNext` blocks open redirects. JSON mode: login/signup return Swedish “requires Supabase” errors.
- **Desktop/mobile:** centered card, same form.
- **Live:** login and signup are reachable without auth. `/ekonomi` without session = login with `next`.
- **Verify:** fill `#auth-email` / `#auth-password`; submit *Logga in*. Signup: `#signup-email`, `#signup-phone`, `#signup-password`. Full signup→verify→onboarding needs real Supabase + email (`verify-logged-out-demo.ts` explicitly skips it). Tests: `src/lib/signup-flow.test.ts`.

---

## Onboarding

- **User-facing name:** Berätta om företaget (1 av 2) · Anpassa Ferva efter företaget (2 av 2)
- **Purpose:** Create the first company in a few minutes, asking only what is needed right away; personalize suggestions without locking anything.
- **Route:** `/onboarding` — `src/app/onboarding/page.tsx` (+ `onboarding-form.tsx` step 1, `personalize-form.tsx` step 2, `onboarding-shell.tsx`). Actions: `src/app/onboarding-actions.ts`. Local preview of both steps in JSON mode: `/dev/onboarding?steg=1|2` (Supabase mode → `/`).
- **How to get there:** After login, `requireBusiness()` redirects owners whose company has **no membership** (step 1) or whose `business_onboarding.status ≠ complete` (step 2) — `ownerNeedsOnboarding()` in `src/lib/setup/onboarding-state.ts`. `/onboarding` never calls `requireBusiness` → no loop. Consultant-only users and demo/JSON → `/`.
- **Step 1 fields / ids:** `ob-company-form` (Aktiebolag · Enskild firma · Annan företagsform → honest “stöds inte ännu”, Fortsätt disabled), `ob-orgnr` (label becomes *Personnummer* for enskild firma), `ob-name`, `ob-vat` (**read-only, derived** `SE + orgnr + 01`, “Uträknat automatiskt”; hidden input `vatNumber`), `ob-address`/`ob-postal`/`ob-city` (shared `AddressFields`), `ob-email`, `ob-phone`, `ob-payment-timing` (*Lägg till nu* / *Gör det senare*), `ob-payment-method` + `ob-bankgiro|ob-plusgiro|ob-bankkonto` only when “now”. Summary error `#ob-sammanfattning`. Button **Fortsätt** (`data-onboarding-continue`).
- **Step 2:** `ob-industries` (multi: El · VVS · Bygg och snickeri · Måleri · Mark och anläggning · Annat → `ob-otherIndustry`), `ob-payroll` (Nej, inte idag · Ja, till mig som ägare · Ja, till anställda · Jag tar det senare), `ob-bookkeeping` (Företaget har bokföring som ska flyttas hit · Företaget är nystartat · Min redovisningskonsult sköter bokföringen · Jag tar det senare). Button **Öppna Ferva** (`data-onboarding-open`) → `/`. No system names asked here.
- **State:** `OnboardingState` (`DB.onboarding`, table `business_onboarding`): `status` not_started | company_done | complete, `currentStep`, `startedAt`, `companyCompletedAt`, `personalizationCompletedAt`, `completedAt`, `industries`, `otherIndustry`, `payroll`, `bookkeeping`, `taskOverrides`. `membershipsForUser` joins `business_onboarding.status` into `MembershipInfo.onboardingStatus` (missing row = complete).
- **DB:** step 1 → `createBusinessWithOwner({ companyForm, onboardingStatus: "company_done" })` writes `businesses`, `business_settings.company_form`, `business_sequences`, `business_memberships`, `business_onboarding`. Step 2 → `applyPersonalization` in tenant context. Migration `31_onboarding_imports.sql` **backfills every existing business as complete**; `ensureOnboardingSchema` (pending schema) does the same where `db push` has not run.
- **Invariants:** Company form saved explicitly (no hidden AB default for new companies). VAT never typed — derived from org.nr; a mismatching value is rejected server-side. Payment details optional at create; the **same** `settingsBillingReadiness` blocks invoice sending, drives Kom igång *Lägg till betalningsuppgifter* and the settings banner. Existing companies are never sent back. Resume: an interrupted user lands on the remaining step at next login.
- **Verify:** JSON: `scripts/verify-onboarding-browser.ts` (forms on 390/320 px, derived VAT, payment later, honest company-form message). Supabase path: `scripts/adapter-validate.ts` (“steg 1 … company_done … steg 2 gör det klart”). Tests: `src/lib/onboarding.test.ts`, `src/lib/setup/setup.test.ts`.

---

## Kom igång (setup center)

- **User-facing name:** Gör Ferva redo (Hem card) · Kom igång (Inställningar tab)
- **Purpose:** Persistent, resumable list of what remains — derived from real data, never a blocking wizard.
- **Routes:** Hem card `src/components/setup/setup-home-card.tsx` (`data-setup-home-card`, max 3 open tasks, link *Alla steg*); `/installningar?flik=kom-igang` → `setup-center.tsx` (`data-setup-center`): profile (`setup-profile-form.tsx`, `data-setup-profile-edit|save`), *Att göra*, *Fler saker du kan göra*, *Gör senare*, *Behövs inte*, *Klart*, *Genomförda importer* (`data-setup-imports`), button **Ladda upp filer** → `/kom-igang/importera`.
- **Tasks (`src/lib/setup/tasks.ts`):** `move_bookkeeping` (done when a `bokforing` import is imported; hidden for *nystartat*), `invite_consultant` (done via `hasCollaborationUsage`), `first_customer`, `first_job`, `payment_details` (done when readiness has no payment blocker), `connect_bank` (done when `bankConnectionView().status === "connected"`), `articles_prices` (done when an active wholesaler price import exists; recommended for El/VVS; when the feature is off the CTA activates it via `activateOptionalFeatureAction` and lands on Grossister). `payroll` is **hidden** (no payroll product yet — the profile shows the honest note instead).
- **Status:** todo | in_progress | done | later | not_needed. Only `later` / `not_needed` are stored (`taskOverrides`); `done` always wins. Row selectors: `[data-setup-task=<id>][data-setup-status=…]`, actions *Senare*, *Behövs inte* (not for bank/payment/customer), *Ta upp igen* (`data-setup-reactivate`), *Visa*.
- **Priority:** bookkeeping=existing → *Flytta in bokföringen* first; consultant → *Bjud in din redovisningskonsult* first; new → customer/job; payment details jump first once quotes/invoices exist. Optional (non-recommended) tasks never show on Hem. Card disappears when no recommended task is open, and is never shown to backfilled existing companies without a profile that already have customers/jobs; center stays reachable.
- **Actions:** `setSetupTaskAction`, `updateSetupProfileAction` (`src/app/onboarding-actions.ts`).
- **Verify:** `scripts/verify-onboarding-browser.ts` (profile save, Senare/Ta upp igen, Hem card order). Tests: `src/lib/setup/setup.test.ts`.

---

## Flytta dina uppgifter till Ferva (import)

- **User-facing name:** Flytta dina uppgifter till Ferva
- **Purpose:** Upload what you have (SIE bookkeeping, customer/supplier registers, wholesaler price lists); Ferva identifies each file, previews exactly what will be created/omitted and imports only after an explicit confirmation.
- **Route:** `/kom-igang/importera` — `src/app/(app)/kom-igang/importera/page.tsx` + `src/components/imports/import-center.tsx`. API: `POST /api/kom-igang/import` (multipart, `mode=analyze|import`, `options` JSON; capability `import_data` = owner/admin; Origin check; max 25 MB; file never stored).
- **Flow:** dropzone (`data-import-dropzone`, `data-import-file-input`, *Vilka filer fungerar?*) → per-file card (`data-import-card[data-import-state=reading|checking|ready|importing|done|failed]`, `data-import-kind`) with real progress *Läser filen → Kontrollerar innehållet → Redo att granskas* → choices (SIE years `data-import-year`, register mapping “Vi tror att dessa kolumner hör ihop” `data-import-field=<field>`, article connection `data-import-connection`, unknown → `data-import-kind-select`) → **Importera** (`data-import-confirm-open`) → confirmation box (`data-import-confirm`, `data-import-run`) → done card (`data-import-state=done`, `data-import-summary`, link to next view). *Kontrollera detaljer* (`data-import-details`) lists unbalanced verifications, duplicates, review rows, unused columns.
- **Detection (`src/lib/services/data-imports.ts`):** SIE by content (`looksLikeSieBytes`/`parseSie`); PDF → unsupported (points to Inbox); tables via the wholesaler readers (`parsePriceFile`: CSV/TXT/XLSX/XML/ZIP) then `classifyRegisterTable` (kunder / leverantorer / artiklar / unknown). AI (`src/lib/imports/classify-ai.ts`) only **suggests** kind + mapping when deterministic detection fails and a key exists; result is badged *AI-förslag* and confirmed by the user. Without AI everything works manually.
- **Imports:** bokföring → `applySieImport` (see docs/onboarding-import.md); kunder → `Customer` rows (+ work locations for fastighetsbeteckning), suppliers → `suppliers` table (listed under Ekonomi → Utgifter, `data-supplier-register`); artiklar → **existing** `importPriceFile` of Grossistbeställningar (needs active feature + connection; no second catalog). Audit row `data_imports` per import (user, hash, counts, warnings, choices, summary); unique `(business, kind, hash)` for imported files → *redan inflyttad*.
- **Invariants:** nothing is written before confirmation; the confirmation upload must hash-match the analysis; one import per file+kind; SIE never imports an unbalanced verification; year conflicts default to skip; no file content is logged or stored.
- **Verify:** `scripts/verify-onboarding-browser.ts` (CSV upload → mapping → import → done → duplicate refused → Kunder list → Genomförda importer). Tests: `src/lib/imports/sie.test.ts`, `src/lib/imports/registers.test.ts`, `scripts/db-validate.ts` (import_verification, data_imports index, RLS), `scripts/adapter-validate.ts` (SIE through commit).

---

## Hem

- **User-facing name:** Hem
- **Purpose:** Command bar + prioritized work. Not a document register.
- **Route:** `/` (authenticated or demo). File: `src/app/(app)/page.tsx`. Title *Hem*.
- **How to get there:** Logo, nav **Hem**, `/assistent` redirect, post-login default.
- **Layout (live demo):** greeting (*God eftermiddag* etc.) → command bar → **Gör Ferva redo** (only while recommended Kom igång tasks remain — see [Kom igång](#kom-igång-setup-center)) → **Behöver din uppmärksamhet** (first 5, *Visa N till*) → **På gång** → **Påminnelser**.
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
- **Purpose:** People/companies you work with. **Only the customer register** — jobs live under the primary nav item **Uppdrag** (`/uppdrag`); the old Kunder/Uppdrag tab strip is gone.
- **Routes:** `/kunder`, `/kunder/[id]`. Page: `src/app/(app)/kunder/page.tsx`. `?flik=uppdrag|forfragningar` redirects to `/uppdrag`; `?flik=kunder` is ignored.
- **How to get there:** Nav **Kunder**. Command *Ny kund* / *Hitta kund*. Attention/customer links.
- **Tabs:** none.
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
- **Routes:** list `/uppdrag` (`src/app/(app)/uppdrag/page.tsx`, renders `UppdragList` — same filters/business logic as the former Kunder tab). Detail `/uppdrag/[id]` (`src/app/(app)/uppdrag/[id]/page.tsx`). Aliases `/jobb`, `/jobb/[id]`, `/kunder?flik=uppdrag` → redirect. Nav section `uppdrag` is active on both list and detail; crumbs *Uppdrag / {title}*; default back **Uppdrag** → `/uppdrag`.
- **How to get there:** Nav **Uppdrag** (primary, desktop + mobile). Customer *Starta uppdrag*. Quote *Starta uppdrag*. Command *Skapa uppdrag*.
- **Subtitle:** *Vad som är beställt, när det sker, vad som är fakturerat och vad som är kvar.*
- **Stored status:** `kommande | pagar | klart`. **UI:** Planerat / Pågår / Klart / Arkiverat (`archivedAt`, not an enum).
- **Economy line:** *X kr kvar att fakturera* · *X kr väntar på betalning* · *Betalt ✓*
- **List chips:** Aktiva, Planerade, Klart, Alla, Arkiverade + Kvar att fakturera / Väntar på betalning / Betalt. Search: *Sök uppdrag, kund, företag eller adress …*
- **Detail actions** (`job-controls.tsx`): Skapa/Fortsätt/Visa offert; Skapa faktura / delfaktura / slutfaktura; Redigera; Markera som klart; Återöppna; **Ta bort uppdrag**.
- **Subflows:**
  - Invoice from job: `JobInvoiceModal` + `createInvoiceForJobAction`.
  - Work entries: `job_work_entries` planned vs actual; locked when invoiced.
  - Complete may warn if unbilled work remains.
  - **Delete vs archive** (`jobRemovalPolicy`): empty → hard delete; if signed quote / issued invoice / payments / posted books / invoiced work / **sent wholesaler orders** → **archive**. Same menu label *Ta bort uppdrag*; modal explains.
  - **Materialbeställningar** (`purchase-orders-section.tsx`): compact list of carts/orders for the job, shown only when something exists (also historical orders after the feature is turned off). See [Grossistbeställningar](#grossistbeställningar-wholesale-orders).
- **Related:** Kunder, Offerter, Fakturor, ROT card on job when relevant.
- **Components:** `uppdrag-list.tsx`, `uppdrag-form.tsx` (`#nytt-uppdrag-titel`, `#uppdrag-titel`), `job-controls.tsx`, `job-invoice-choice.tsx`, job work section.
- **Work address:** new uppdrag *ny adress* = shared `AddressFields` (names `newAddress` / `newPostalCode` / `newCity`); edit uppdrag address = single-line `AddressAutocomplete composeSelected="line"` (`gata, postnummer ort`). See [Address autocomplete](#address-autocomplete-shared).
- **DB:** `jobs`, `job_work_entries`. JSON: `housing`, `tax_reduction_application`, `checklist`.
- **Invariants:** Job describes **work**, not money. Quote/invoice linked to a job must share `customer_id`.
- **Desktop/mobile:** table vs cards; row `aria-label={title}`.
- **Live:** Aktiva includes Köksrenovering (Pågår, 59 500 kr kvar) and several Planerat. Klart jobs (fönster, etapp 1, …) under **Klart**.
- **Verify:** `/uppdrag` → click *Köksrenovering* → `/uppdrag/job-kok`; sidebar/bottom **Uppdrag** has `aria-current="page"` on both. Create from header **Uppdrag**. Tests: `job-lifecycle.test.ts`, `job-work.test.ts`, `nav.test.ts` (huvudnavigation). Browser: `scripts/verify-nav-browser.ts`, `scripts/verify-origin-back.ts`.

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
  | `/offert/[token]/pdf` | Commercial offer PDF (A4). Once accepted: quiet line *Godkänd {datum} av {namn}* — no green box |
  | `/offert/[token]/underlag` | Evidence certificate *Intyg om godkännande av offert* (lawyer-readable; hashes in collapsed *Teknisk kontroll*) |
  | `/offert/[token]/underlag/pdf` | Certificate print/PDF (A4). Same facts; hashes only in a short footer |
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
- **Main actions — utkast:** Redigera · **Kasta utkast** · **Skicka offert**. Checklist `#quote-send-blockers` *Innan offerten kan skickas*. Existing draft rules stay (not forced into one primary + …).
- **Action bar matrix (sent / accepted / declined):** never two `…` menus. Visible = **one primary + one …**. Customer name in the subtitle is an `AppLink` to `/kunder/{id}` — **Öppna kundvyn is not in the bar**. **Ny version** and **Dra tillbaka offerten** are overflow-only.
  | State | Primary | Overflow |
  |-------|---------|----------|
  | `skickad` (not accepted) | **Skicka påminnelse** (existing) | Kopiera kundlänk · Skriv ut/PDF · Ny version · **Dra tillbaka offerten** |
  | `godkand`, no job | **Starta uppdrag** | Kopiera kundlänk · Skriv ut/PDF · Ny version · Visa intyg |
  | `godkand`, job linked | **Fakturera** (`createInvoiceFromQuote`; hidden when fully invoiced) | Kopiera kundlänk · Skriv ut/PDF · Ny version · Visa intyg |
  | `avbojd` | — | Kopiera kundlänk · Skriv ut/PDF · Ny version |
- Never show **Starta uppdrag** and **Skapa faktura/Fakturera** together. No **Nästa steg** card that repeats the job or a second invoice CTA. **Kopplat till** is the only job card (name + Planerat/Pågår/Klart). Unlinked draft: Inte kopplat + Koppla / Skapa uppdrag (`documentLinkView`).
- **Dra tillbaka** (`withdrawQuote`): allowed only when `status === "skickad"` (viewed or not) and not accepted. Reuses domain status **`avbojd`** with `declineReason = "Tillbakadragen"` (Hem **Inte aktuell** uses `"Inte längre aktuell"`). Confirm dialog; overflow item; idempotent if already owner-withdrawn. Does not delete versions/snapshots. No email required. Public: *Offerten är tillbakadragen* (not “Avböjd” — that word is the customer’s decline). Owner list leaves *Väntar på godkännande* (badge Avböjd). Accept blocked (`declined`). Not allowed on `godkand`.
- **Ny version / supersede-on-accept:** overflow when a sent or accepted version exists. Editing a **sent, not accepted** quote still reverts to utkast and must be resent (replacing the waiting snapshot is OK). Editing an **accepted** quote creates/updates a pending unlocked version **without** changing `currentVersionId`, `status`, or the acceptance — the locked snapshot stays governing (hash, job, intyg). Sending the pending draft snapshots it; public then shows that waiting version + one Godkänn form (not the old accepted banner). When the new version is accepted, `finalizeQuoteAcceptance` locks it, replaces the one `signatures` row, sets `currentVersionId`, `createJobFromQuote` (idempotent — no second job).
- **Acceptance banner (owner):** compact one line: *Godkänd av {namn} · {tid} · Visa intyg* (`/offert/[token]/underlag`). No IP, user-agent, SHA-256, method essay, emails, or “Version N är låst…” paragraph. Header may still show a small *Version N låst* badge. Forensics live on the intyg page / PDF.
- **Public `/offert/[token]`:** utkast → **404**. The A4 **QuoteDocument** is the commercial offer only (villkor + seller footer; once accepted a *quiet* line *Godkänd {datum} av {namn}* — **no green in-card Godkänd box**). **No CTA inside the card** — no **Godkänn offerten** block, no name field, no accept button. Accept chrome sits **below** the card: validity *Offerten är giltig till …*, **Ditt namn** (prefilled: person name, or company contact person; editable; button disabled while blank), one sentence *Genom att godkänna accepterar du offerten “{rubrik}” från {företag} daterad {datum} till ett totalt belopp om {totalt}.* (ROT/RUT adds *, varav … preliminärt ROT/RUT-avdrag*), primary **Godkänn offert** (`data-testid=public-quote-accept`) — real submit, **no chevron / no jump link**, footnote *Godkännandet sparas tillsammans med offertens innehåll och tidpunkt.*, quiet **Avböj offerten** (`public-quote-decline`). Mobile sticky (`md:hidden`, `data-quote-accept-bar`, `public-quote-accept-bar`) repeats only that submit (and the name field if empty) — same `acceptQuote` call, not a second form inside the card. Footer *Skriv ut eller spara som PDF* (`/pdf`, commercial offer) stays outside the document; once accepted also *Skriv ut intyg om godkännande* (`/underlag/pdf`). **No “Ställ en fråga”.** No BankID button, no draw-to-sign, no checkbox. First open → `viewedAt` / *Öppnad av kunden*.
- **Accept states:** success → inline *Offerten är godkänd* + receipt (who, when, amount) then `router.refresh()` → **one** server banner *Offerten är godkänd* / *Godkänd av {namn}, {tid} · {belopp}* + **Intyg om godkännande**; document shows the quiet *Godkänd {datum} av {namn}* line (not a second green box); **already accepted** = read-only, no second accept unless a newer sent version is waiting (then one Godkänn form for that version); **avbojd** → *Offerten är tillbakadragen* if owner-withdrawn (`isQuoteWithdrawnByOwner`) else *Offerten är avböjd*; **expired** → Swedish explanation, no form; **utkast** → 404 (also for the action: `not_found`).
- **Certificate `/offert/[token]/underlag`:** title *Intyg om godkännande av offert*. 4–6 sentence Swedish summary (who, offer number + rubrik, company, total, date/time, method = typed name + **Godkänn offert** on the sent link). Facts table in this order: Avsändare, Kund, Godkänd av, Tidpunkt, Offert, Belopp — hashes are not first. *Det kunden såg* = stored `statement`. Status *Dokumentet är oförändrat* / *har ändrats* (plain Swedish; `acceptance.contentHash` vs `quoteVersionHash(version)`). Native `<details>` **Teknisk kontroll** collapsed on web (version, SHA-256, hash now, method, send-to email, IP + device). Closing sentence: enkel elektronisk underskrift, ingen e-legitimation. Primary action **Skriv ut eller spara som PDF** → `/underlag/pdf`. Same stored evidence fields; presentation only. Owner detail does **not** repeat these forensics.
- **Certificate PDF `/offert/[token]/underlag/pdf`:** A4 `@page`, `PdfPrintBar`, no SaaS chrome. Same facts and summary; hashes only in a short footer. Demo generates the PDF view; no email.
- **Accept service (`acceptQuote`):** rate limit (10/token, 40/IP per 10 min) → token lookup (utkast = not_found) → idempotent return if already accepted → `normalizeAcceptName` (trim, collapse, ≤120; empty → `name_required`) → status (`declined` / `expired` / `not_acceptable`) → `expectedContentHash` from the rendered page must equal `quoteVersionHash(version)` (`changed`) → `finalizeQuoteAcceptance`: sets seller/buyer snapshots, `lockedAt`, `contentHash`, pushes the `QuoteAcceptance` (`method: simple_accept`, `acceptedAt`, `acceptedByName`, `customerNameAtAccept`, `acceptedByEmail`, `contentHash`, `statement`, `ip`, `userAgent`, `linkSentTo`), `status = godkand`, `decidedAt`, `createJobFromQuote` (idempotent — never a second job), `logActivity`, one `save()`. Errors are `QuoteAcceptError` with Swedish `QUOTE_ACCEPT_TEXT`.
- **Confirmation mail:** `prepareQuoteAcceptedNotices` returns 0–2 envelopes (customer `quote_accepted_customer` + business `quote_accepted`). Empty in demo / `is_demo` / no mail provider. Sent with `after()` so the customer never waits on Resend; **either mail failing never blocks the accept**. Customer copy: typed name + Godkänn offert; links to `/offert/[token]` and `/underlag`. No BankID language.
- **Customer e-mail subjects** ([PR #101](https://github.com/elialm94/driva/pull/101); `src/lib/email/rubrik.ts`, `templates.ts`, `services/document-mail.ts`): **Skicka offert** → `Offert från {företag} – {rubrik}`; **Skicka påminnelse** (`followUpQuoteByEmail`) → `Påminnelse: offert från {företag} – {rubrik}`. Rubrik = the current version's `title`. **No `#n` in the subject** — the offer number stays in the body. ` – {rubrik}` is dropped when the title is empty or only a document-type word (*Offert* / *Faktura* …) (`documentFromCompanySubject` / `reminderFromCompanySubject`). Demo / `is_demo` only simulates the send, but the prepared `MailMessage` has the same subject.
- **Delete rules (critical):**
  - **Kasta utkast** only if `status === "utkast"` and no issued invoices linked.
  - Sent: *Skickade offerter kan inte kastas. Markera dem som inte aktuella i stället.*
  - `discardQuote` unlinks draft invoices/jobs; deletes versions, acceptances (`signatures`), legacy bankid orders.
  - Redirect: `/ekonomi?flik=offerter&kastat=offert` (`DraftDiscardedToast`).
  - There is **no** hard delete for sent/signed quotes.
- **Related:** ROT on form; job link (`LinkedToBox` — **Kopplat till** is the only job card; do not add a second **Nästa steg** that repeats the job). Invoices from the quote appear under **Fakturor**. Next invoice is the header **Fakturera** (same `createInvoiceFromQuote` as the old per-part chip).
- **Components:** `economy-register.tsx`, `doc-form.tsx` (QuoteForm), `discard-draft-button.tsx`, `quote-draft-send.tsx`, `send-checklist.tsx`, `quote-document.tsx` (quiet acceptance line only — no `acceptForm` slot, no green Godkänd box), `acceptance-certificate.tsx` (web + A4 PDF), `quote-chain-actions.tsx` (`QuoteOwnerPageActions` = one primary + one overflow on owner detail), `quote-accept.tsx` (`QuoteAcceptForm` below the card + mobile sticky submit), `quote-public-actions.tsx` (Avböj only).
- **Form ids:** `#offert-saknas`, `#offert-kund`, `#offert-rubrik`, `#offert-rot-rut`, `#offert-betalplan`, `#prisrader`; public accept: `#godkann-offert`, `#godkann-namn`.
- **DB:** `quotes`, `quote_versions` (payload JSONB is hash-frozen), `signatures` (= acceptances; migration 28 adds `method`, makes `order_ref` / `signer_personal_number_masked` / `environment` nullable; `evidence` JSONB holds contentHash, statement, customerNameAtAccept, acceptedByEmail, ip, userAgent, linkSentTo; `signatures_quote_uq` keeps one per quote; `apply-pending-schema.ensureQuoteAcceptanceSchema` mirrors it), `bankid_orders` (legacy).
- **Invariants:** Locked versions immutable — a sent/accepted quote is a snapshot. Later edits of an **accepted** quote create a pending version and **never** change what was accepted until the new version is accepted (`pendingDraftQuoteVersion` / `publicQuoteVersion` / `governingQuoteVersion` in `data.ts`). Public only via unguessable `token`. Totals panel says **Offertvärde**, not Att betala. Quote↔job same customer. Accept never requires personnummer; ROT fields only when ROT/RUT is on the document. Demo/`is_demo` accept makes zero external HTTP.
- **Desktop/mobile:** register table + cards. Form: sticky save on mobile (`DocStickyActions`). Public: accept chrome below the document; mobile sticky repeats **Godkänn offert** (real submit, safe-area).
- **Live draft:** Offert **#116** `/ekonomi/offerter/quote-bokhylla` — ROT blockers: personnummer + bostad. Public `/offert/demo-eva-bokhylla` is **not** viewable. Acceptable public: `/offert/demo-bertil-fasad`.

### How an agent verifies (quote delete / send / accept)

**Discard draft**

1. `/demo` → Ekonomi → Offerter.
2. Open **#116** / `quote-bokhylla`.
3. Button *Kasta utkast* `[data-testid=discard-draft-trigger]` (`aria-label` on icon variant: *Kasta offertutkast*).
4. Dialog *Kasta offertutkast?* → *Kasta utkast*.
5. Land on Offerter with toast; #116 gone. Sent rows still listed.

**Do not expect a delete control on #115 / #110.** Use owner overflow **Dra tillbaka offerten**, Hem **Inte aktuell**, or public **Avböj offerten**. All three set `avbojd`; owner withdraw / Inte aktuell use carpenter `declineReason` so the public page does not claim the customer declined.

**Send**

1. New offert or fix #116 blockers (add personnummer on Eva + bostad).
2. *Skicka offert* enabled only when `#quote-send-blockers` empty.
3. After send: status **Väntar på godkännande**; demo banner about simulated mail.
4. Prepared subject is `Offert från Södermalms Snickeri AB – {rubrik}` (no `#n`); `#{n}` appears only in the body. Same shape for **Skicka påminnelse** with the `Påminnelse: offert från …` prefix. Domain test: `src/lib/email-subjects.test.ts`.

**Back from komplettera**

1. Open a draft quote from Ekonomi (Back on the quote is **Ekonomi** or **Offerter**).
2. Click *Lägg till e-post* / *Komplettera företagsuppgifter* in `#quote-send-blockers`.
3. Customer or Inställningar Back must be **Offert #{n}**, not Ekonomi.
4. After save, that Back still returns to the same quote.

**Accept (demo, ~3 minutes)**

1. `/demo` → open `/offert/demo-bertil-fasad` (or Ekonomi → Offerter → #115 → *Öppna kundvyn*).
2. Scroll **past the document card** to the accept chrome (or tap **Godkänn offert** in the mobile sticky — it submits, it does not jump). **Ditt namn** is prefilled *Bertil Lindqvist* — clear it and the button disables; type a name again. The card itself has no Godkänn block and no **Ställ en fråga**.
3. Read the sentence, press **Godkänn offert** → *Offerten är godkänd* + receipt; page reloads to the read-only state with **one** banner *Godkänd av …* and **Intyg om godkännande**; the card has only the quiet *Godkänd {datum} av {namn}* line. Reload → no form, no second accept.
4. Open **Intyg om godkännande** (`/offert/…/underlag`): readable certificate, hashes collapsed under *Teknisk kontroll*. **Skriv ut eller spara som PDF** → `/underlag/pdf`. From the accepted offer footer, *Skriv ut eller spara som PDF* is the commercial offer; *Skriv ut intyg om godkännande* is the certificate.
5. Back in the app: `/ekonomi/offerter/quote-fasad` shows badge **Godkänd**, optional small *Version 1 låst* badge, compact banner *Godkänd av Bertil Lindqvist* + time + **Visa intyg** (no IP/hash/method on this screen). Timeline row *Godkänd av Bertil Lindqvist*. `/kunder/cust-bertil` chain: Offert → Uppdrag (`job-fasad`, no duplicate) → Faktura.
6. Negative checks: `/offert/demo-eva-bokhylla` (utkast) → 404. No request to any BankID host. Puppeteer: `[data-testid=public-quote-accept]`, `[data-quote-accepted-banner]`, `[data-quote-acceptance-line]`, `[data-acceptance-certificate]`.

Scripts: `scripts/verify.mjs`, `verify-validation-ux.ts`, `verify-tax-reduction.ts`, `verify-attention-browser.ts`. Tests: `quote-accept.test.ts` (happy path, empty name, already accepted, declined/expired/changed hash, rate limit, demo isolation, customer+business mail, DB mapping), `quote-acceptance-certificate.test.ts` (summary/facts order, intact vs changed Swedish, web `<details>`, PDF footer hashes), `draft-actions.test.ts`, `flows.test.ts`, `quote-terms.test.ts`.

---

## Fakturor

- **User-facing name:** Fakturor (Ekonomi tab). Detail: **Faktura #{n}** or Utkast.
- **List first column** (`invoiceListTitle` in `src/lib/invoices/display.ts`): issued `#{n}` (+ type chip **Kredit** / **Delbetalning** / **Slutfaktura**). Draft: quote/job/invoice rubrik if set, else first non-empty line description, else `Faktura till {kund}`. Never the word **Utkast** as the name — that stays on the status chip. Drafts never get a number. **Delbetalning** only when `type === "delbetalning"`.
- **Purpose:** Get paid. Issue is atomic (number + snapshot + books).
- **Routes:** `/ekonomi?flik=fakturor`, `/ekonomi/fakturor/ny`, `/[id]`, `/[id]/redigera`, public `/faktura/[token]`, `/pdf`.
- **How to get there:** Ekonomi → Fakturor. Header **Ny faktura**. From job/customer/quote/command. Query `?kund=`, `?job=`, `?fristaende=1`.
- **Statuses:** Utkast, Skickad, Delbetald, Betald, Krediterad. Overdue **derived:** *Förfallen* / *Förfallen N dagar*. Credit badge **Kreditfaktura** (never overdue). Types: faktura, delbetalning, slutfaktura, kredit.
- **Filters:** Alla, Utkast, Obetalda, Förfallna, Betalda, Krediterade.
- **Main actions — utkast:** Redigera · Kasta utkast · **Skicka faktura** (issues **then** emails — `issueInvoice` + `emailInvoice`). Checklist `#invoice-send-blockers`.
- **Issued:** Visa kundvy, påminnelse if overdue, overflow: Kreditera (full only — after save, emails the **invoice customer**, never the carpenter inbox; demo / `is_demo` skips Resend; mail failure does not roll back the credit), Kopiera kundlänk, PDF, Skicka igen, **Simulera inbetalning** (demo **and** an active mock bank connection — hidden after *Koppla från*).
- **Paid:** *Betald och bokförd.*
- **Customer e-mail subjects** ([PR #101](https://github.com/elialm94/driva/pull/101)): **Skicka faktura** and **Skicka igen** (both `emailInvoice`) → `Faktura från {företag} – {rubrik}`; påminnelse (`remindInvoiceByEmail`) → `Påminnelse: faktura från {företag} – {rubrik}`. **No `#n` in the subject** — number, OCR, förfallodatum and bankgiro stay in the body. Rubrik from `invoiceEmailRubrik` (`src/lib/email/rubrik.ts`): linked quote version title → first non-empty line description → linked job title → first line of övrig information (rich text) → document-type label without number (which is then omitted, so the subject is just `Faktura från {företag}`). Credit notice (`creditInvoiceEmail`) is **not** part of this change — it still reads `Kreditfaktura från {företag} – Kreditfaktura #{n}` (`credit-invoice-mail.test.ts`). Demo / `is_demo` simulates the send with the same subject.
- **Public:** utkast 404. *Fakturan är betald* / *Fakturan har förfallit*. Ladda ner PDF.
- **Related:** ROT application card; `DeniedReductionCard`; quote deviation; payments / bank match.
- **Components:** `doc-form.tsx` (InvoiceForm), `invoice-document.tsx`, `invoice-draft-send.tsx`, `invoice-issue-checklist.tsx`, `money-widgets.tsx`, `denied-reduction-card.tsx`.
- **Form ids:** `#faktura-saknas`, `#faktura-kund`, `#faktura-rot-rut`, `#faktura-betalvillkor`.
- **DB:** `invoices` (`number` null until issue), `invoice_line_items`, `invoice_issued_snapshots` (immutable legal copy), `payments`.
- **Invariants:** Number only via atomic `app.issue_invoice`. Issued UI reads snapshot. Partial pay → `delbetald`. Credit = reversal verification, not new revenue. Full credit notifies the customer (`prepareCreditInvoiceNotice` + `after` + `sendMail`); partial credit is not a product path and does not email. Rest-invoice after denied ROT: `deniedReductionOf`, no new revenue. Issued OCR is Bankgirot **OCR-10 soft** (invoice-number digits + modulus-10 check, no length digit) via `ocrForInvoice` in `src/lib/ids.ts` — assigned once at `issueInvoice`, frozen on `issuedSnapshot`, reused on reminders/email/PDF. Drafts have no customer-facing OCR. SQL twin: `app.ocr_for_invoice`.
- **Desktop/mobile:** same register pattern as offerter.
- **Live:** `#1042` Förfallen 6 dagar (Brf Eken); `#1047` Skickad delbetalning; Utkast Brf Eken (`inv-1048`, list title from first line); two 0 kr Eli drafts (`Luckor i ek`, `Bänkskiva i ask`).
- **Verify:** Ekonomi → Fakturor → first column is document title (not “Utkast”). Open #1042. Discard: only the Utkast row / detail `[data-testid=discard-draft-trigger]`. Public: `/faktura/{token}` for a sent invoice. Tests: `src/lib/invoices/display.test.ts`, `economy-list.test.ts`, `payment-flows.test.ts`, `financial-invariants.test.ts`, `credit-invoice-mail.test.ts` (subject/body, demo null, send-throw isolation, customer not carpenter), `email-subjects.test.ts` (subject shapes without `#n`, `invoiceEmailRubrik` fallback order) + `email.test.ts` (same subjects through `emailInvoice` / `remindInvoiceByEmail` / `followUpQuoteByEmail`). Script: `scripts/verify-financial-browser.ts`.

---

## ROT / RUT

- **User-facing name:** ROT/RUT, Skattereduktion, Preliminärt ROT-avdrag / RUT-avdrag
- **Purpose:** 30% ROT / 50% RUT on **arbete** lines; apply to Skatteverket after work + customer share paid. V1 is **manual** (no SKV API). V1 does get a **HUS file export**: the carpenter downloads Skatteverket's Begäran-XML (schema v6) and imports it in the e-service *Rot och rut – företag* — Driva never submits anything.
- **Where it lives (not its own nav item):**
  - Customer (privat): *+ Lägg till ROT/RUT-uppgifter*, bostäder (`customer-rot-section.tsx`)
  - Quote/invoice form: **Skattereduktion** (`#offert-rot-rut`, `#faktura-rot-rut`)
  - Documents: deduction line + **ROT/RUT-avdrag** terms
  - Invoice/job: `TaxReductionApplicationCard`, `DeniedReductionCard` (`#nekat-belopp`)
- **How to get there:** Open a privat customer, or a quote/invoice with ROT (demo: #116, #115, #113).
- **Application statuses:** Preliminär → Redo att ansökas → Väntar på Skatteverket → Godkänd / Delvis godkänd / Nekad.
- **Main actions:** toggle ROT/RUT; pick bostad; *Skapa ansökningsunderlag*; **Ladda ner fil till Skatteverket** (HUS-XML, on the underlag card, `#hus-fil`); mark Godkänt / Delvis / Nekat; on nekat create rest invoice.
- **HUS file (Skatteverket Begäran v6):** section *Fil till Skatteverket* inside `TaxReductionApplicationCard` while status is *Väntar på Skatteverket*. `GET /api/skatteverket/hus?jobb=<id>|faktura=<id>` builds, schema-checks and downloads `rot-begaran-…xml` / `rut-begaran-…xml`; the download is noted (`hus.fileDownloadedAt`, audit `rot_fil_nedladdad`) but status stays `underlag_skapat` — never auto-Godkänt, no BankID, no SKV API. One `Arenden` per paid invoice: `Kopare` = customer personnummer as 12 digits, `BetalningsDatum` = last registered payment (bank match / manual), `PrisForArbete` = arbete incl. VAT, `BetaltBelopp` = arbete incl. VAT − avdrag, `BegartBelopp` = avdrag, `Ovrigkostnad` = resor + övrigt incl. VAT, `Materialkostnad` = material incl. VAT under the chosen **arbetsområde** (ROT default Bygg; RUT must be chosen; `#hus-arbetsomrade`). **Arbetade timmar** are read from hour-priced `arbete` lines (`tim`/`h`); fixed-price lines block the export until the user types the hours (`#hus-timmar-<invoiceId>`) — hours are never invented. Other blockers: missing payment date → link to the invoice; personnummer not 10/12 digits → `/kunder/{id}#kund-personnummer`; ROT without bostad → `#faktura-rot-rut`. ROT and RUT never share a file (`RotBegaran` vs `HushallBegaran`). Schema vendored under `docs/skatteverket/hus/` (see its README); the file carries no utförare — that is the logged-in company in the e-service.
- **Related:** customers.personnummer, work_locations, quote/invoice terms snapshot.
- **Components:** `tax-reduction-fields.tsx`, `tax-reduction-application.tsx` (missing `workAddress` fill = `AddressAutocomplete composeSelected="line"`; `HusExportSection` with `[data-testid=hus-download]`), `denied-reduction-card.tsx`. Logic: `src/lib/services/tax-reduction.ts`, `tax-reduction-gaps.ts`, `tax-reduction-send.ts`, `src/lib/hus-begaran.ts` (pure XML builder + rules), `src/lib/services/hus-export.ts` (case → file, blockers, `patchHusExportFields`, `markHusFileDownloaded`). Bostad address on the customer uses `AddressFields` (`customer-rot-section.tsx`).
- **DB:** `customers.personal_identity_number`; `work_locations` (beteckning / BRF / lägenhet); `jobs.housing`, `jobs.tax_reduction_application` (JSONB, now also `hus.{workCategory,laborHoursByInvoice,fileDownloadedAt}` — no migration); `invoices.rot`, `tax_reduction_*` JSONB.
- **Invariants:** Personnummer on **customer only**. Only `arbete` lines reduce. Cap 50 000 kr/person/year (shown in “Hur räknas detta?”). Denied rest invoice is collection, not new sales. Send blockers if ROT selected but PIN/bostad missing. HUS file never leaves Driva unless it passes `validateHusBegaran` (schema ranges + e-service rules: begärt ≤ betalt, begärt + betalt ≤ arbetskostnad, same payment year, ≤ 100 köpare).
- **Live:** #116 draft blocked on PIN + bostad. Public #115 shows *Preliminärt ROT-avdrag − 14 025 kr*, Offertvärde 58 350 kr.
- **Verify:** `npx tsx scripts/verify-tax-reduction.ts`. Open `#offert-rot-rut` on a new quote. Nekat path: `#nekat-belopp`. HUS: on a paid ROT job with underlag, `#hus-fil` shows arbetsområde + timmar and `[data-testid=hus-download]` is a link (or disabled with the gap list `#hus-luckor`); `xmllint --noout --schema docs/skatteverket/hus/begaran/V6/Begaran.xsd <fil>` validates. Tests: `tax-reduction.test.ts`, `tax-reduction-send.test.ts`, `hus-begaran.test.ts` (golden ROT småhus / bostadsrätt / RUT fixtures in `src/lib/__fixtures__/hus/`, XSD via xmllint when present, no ROT/RUT mixing), `hus-export.test.ts` (blockers for timmar / betalningsdatum / arbetsområde, status untouched on download).

---

## Inbox

- **User-facing name:** Inbox
- **Purpose:** Inbound supplier invoices, receipts, other economic docs. **Not** website contact forms.
- **Routes:** `/inbox`, `/inbox/[id]`, `/inbox/[id]/kontrollera`. Inbound HMAC `POST /api/inbox/inbound`. Resend Receiving `POST /api/inbox/inbound/resend` (Svix + `receiving.get`). Attachments `/api/inbox/bilaga/...`. Payment file `/api/betalfil/[id]`.
- **How to get there:** Nav Inbox (badge). Hem attention. Ekonomi utgifter *Öppna utgifter*.
- **Subtitle:** *Leverantörsfakturor, kvitton och andra ekonomiska dokument samlas här.*
- **Main actions:** filter Öppna / Alla; search; **Lägg till dokument**; copy inbound address; detail: Kontrollera belopp, Godkänn uppgifter, Skapa bankfil, Visa PDF.
- **Types:** Leverantörsfaktura (ska betalas) · Kvitto (redan betalt) · ekonomiskt dokument · **Orderbekräftelse** (`orderbekraftelse`, only when the company has sent wholesaler orders — never enters the invoice/receipt pipeline; see [Grossistbeställningar](#grossistbeställningar-wholesale-orders)).
- **Stored status:** `ny` → `behandlad` → `bokford`. UI may show richer lifecycle (*Kontrollera belopp*, *Bokförd · Redo att betala*, *Bankfil skapad*).
- **Related:** Utgifter & kvitton, Bank, Bokföring questions, payment files (pain.001).
- **Components:** `inbox-list.tsx`, `inbox-address.tsx`, `extraction-review.tsx`, `inbox-upload.tsx`, `payment-file-actions.tsx`.
- **DB:** `inbox_items`, `business_settings.inbound_mail_slug` (unique; allocated at company create, see below), `payment_files`, `supplier_payments`. Bucket `inbox_attachments`.
- **Invariants:** Tenant from **To** slug (`{slug}@in.ferva.se`, alias `in.driva.se`), never From. **No DELETE** on inbox_items. Dedup `(business_id, external_id)`. Badge ≠ open filter. Autopilot books only at high amount confidence or after `reviewedAt`. Website forms → jobs, not inbox.
- **Inbound address = slug + domain** ([PR #100](https://github.com/elialm94/driva/pull/100); `src/lib/inbox/inbound-slug.ts`, `inbound-mail.ts`): displayed domain is `INBOUND_MAIL_DOMAIN` (default `in.ferva.se`); the webhook also accepts alias `in.driva.se` (`INBOUND_MAIL_ALIAS_DOMAINS`) — tenant is resolved from the **local-part only**, never the domain.
  - **Allocation** (`slugFromCompanyName` → `allocateInboundMailSlug`): lowercase, å/ä→a, ö→o, drop the whole words `ab` `hb` `kb` `eftr` `aktiebolag`, keep `[a-z0-9]` only, max 24 chars; fewer than 3 chars → `foretag`. **Reserved** local-parts count as occupied: `demo`, `inbox`, `postmaster`, `noreply`, `support`, `admin`, `mail`, `www`, `root`, `ferva`, `driva` (so *Support AB* → `support2`). Collision → `bas`, `bas2`, `bas3`, …
  - **Where:** Supabase `insertSettingsWithAllocatedSlug` (`adapter-supabase.ts`) in the same transaction as the settings insert; a unique-violation race retries with the next number. JSON/onboarding: `src/lib/onboarding.ts`. Demo seed keeps `demo` (→ `demo@in.ferva.se`); a developer-seeded demo business in Supabase never gets `demo` (`demo-reset.ts` uses the company-name slug and keeps it across reset).
  - **Locked:** the customer never chooses or edits the address. `updateCompanySettings` (`services/settings.ts`) does **not** touch `inboundMailSlug` — renaming the company does not remint.
  - **Legacy hex remint (one-shot):** slugs matching `^[0-9a-f]{12}$` (migration 13 default) are reminted to a readable slug **only if the business has no inbound mail items yet** (`kind === "mail"` or `source` `email`/`vidarebefordrad`). If mail exists, the hex slug stays. Supabase: `remintHexInboundMailSlugs` in `apply-pending-schema.ts`; JSON: `normalize()` in `store.ts` (`shouldRemintHexInboundSlug`).
- **Kvitto pipeline vs receipt file:** a `kvitto` inbox item that books (`createExpenseFromKnownReceipt`, `src/lib/services/inbox.ts` → `expenses.ts`) creates `expenses` + a `receipts` row with **filename only** (`item.attachments[0]?.filename`) — the attachment stays on `inbox_items.attachments` (`/api/inbox/bilaga/...`) and is **not** copied to `receipts.storage_path` / `content_base64`. Such rows therefore read *Bokfört · kvittouppgifter utan fil* in Utgifter and have no **Visa kvitto** link (see [Utgifter & kvitton](#utgifter--kvitton-flikutgifter)). Only **Lägg till kvitto** (`uploadReceiptAction`) stores the file on the receipt.
- **Live:** address `demo@in.ferva.se`. Open: Byggmax *Kontrollera belopp*, Beijer *Bokförd · Redo att betala*. Badge **1**.
- **Verify:** `/inbox` shows inbound card + Byggmax. Open row → `/inbox/inbox-mail-byggmax`. Script: `scripts/verify-nav-browser.ts` expects `demo@in.ferva.se`. Tests: `inbox.test.ts`, `inbox-resend.test.ts`, `inbound-slug.test.ts` (normalisation, reserved → `2`, collision suffixes, hex remint, rename does not remint). `scripts/db-validate.ts` asserts DELETE denied. SMTP→Inbox requires verified Receiving MX on `in.ferva.se` (not claimed live from code alone).

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
- **Verifikationer overflow** (`verifikationer-view.tsx` → `verification-overflow.ts`): **Visa detaljer**. **Fakturan är fel** only on an uncredited customer-invoice verification (`source.type === kundfaktura`, invoice not `kredit` / not `krediterad`). Click starts the same full-credit confirm as invoice detail (`CreditInvoiceConfirmDialog` → `creditInvoice`) — not a dead-end “open document” modal. Hidden on credit-note verifications, already-credited originals, supplier/payment/moms/expense rows (those use **Rätta bokföring** or nothing). Posted verifications stay immutable; credit issues a credit note + new verification. Helper stays client-safe (no store/fs).
- **VAT states:** Kommande, Pågår, Att deklarera, Deklarerad. Copy mentions quarterly VAT due the 12th.
- **Related:** same action ids as Hem. Supplier/customer money stays in Inbox/Ekonomi/Hem — badge **only** `accounting` + `vat`.
- **Components:** `bokforing-advanced-nav.tsx`, `verifikationer-view.tsx`, `moms-periods.tsx`, layout `bokforing/layout.tsx`.
- **DB:** `verifications`, `accounting_entries`, `fiscal_years`, `vat_reports`, `assets`, `accruals`, `annual_reports`.
- **Invariants:** Posted verifications locked; corrections = new verification (`corrected_by_verification_id`). Debit = credit (`app.post_verification`). VAT numbers = huvudbok. Routine exceptions group on Hem when ≥3.
- **Live:** 4 questions (late VAT 47 108 kr, Grand Hôtel 4 250 kr category, Byggmax amount, Clas Ohlson missing receipt). Resultat före skatt 229 783 kr. Seed has **no** credited invoice pair — A1/A2 are the two oldest dated verifications (typically Faktura #1033 and its payment), not a credit-note pair.
- **Verify:** `/bokforing` shows *Behöver lösas · 4*. Tabs persist. Verifikationer: overflow on an uncredited kundfaktura (e.g. #1047 / #1042) opens *Kreditera faktura?*; after credit the original and the new credit-note verification hide **Fakturan är fel**. Tests: `accounting.test.ts`, `verification-correction.test.ts` (A1 uncredited / A1 credited / A2 credit note).

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
- **Route:** `/installningar?flik=kom-igang|foretag|fakturering|funktioner|konto` (`src/lib/settings-routes.ts`); `flik=grossister` exists **only** while Grossistbeställningar is active (otherwise → `flik=funktioner`). Legacy `flik=standardval` → fakturering. Deep-link `?falt=name|orgNumber|vatNumber|address|…`.
- **How to get there:** Sidebar/Mer **Inställningar**. Billing blockers and domain “complete company” deep-link here.
- **Tabs:** Kom igång · Företag · Fakturering & betalning · Funktioner · (Grossister) · Konto. `SETTINGS_TABS` is the feature-off list; `settingsTabsFor(features)` inserts **Grossister** after Funktioner when active. **Kom igång** = the permanent setup center (profile, tasks, imports) — see [Kom igång](#kom-igång-setup-center).
- **Företag:** logo, name, org.nr, VAT, address, contact. Save *Spara ändringar*. `#installningar-saknas`. Address = shared `AddressFields` (label **Gatuadress**): `#installningar-address`, `#installningar-postalCode`, `#installningar-city`. Renaming the company does **not** change the inbound mail address — `inbound_mail_slug` is locked at create and not editable here (see [Inbox](#inbox)).
- **Fakturering:** payment details (bankgiro/plusgiro/bank/IBAN), invoice defaults, **billing readiness**. *Komplettera för fakturering* is a plain form (moms + bankgiro always visible; address via `AddressFields` only if missing at open). Draft local state; persist only on **Spara** (`saveBillingCompletionAction`). **Stäng** discards the draft. **Använd förslaget** fills moms only. Modal visibility is user-controlled (`completeOpen`), not `readiness.ready` / send-blockers.
- **Funktioner:** Hemsida + Samarbeta + **Grossistbeställningar** toggles (`feature-settings.tsx`) — Aktiv/Avstängd, Aktivera/Stäng av. Activating Grossistbeställningar lands on `?flik=grossister`; in demo contexts it also seeds a fictional wholesaler + price list (see [Grossistbeställningar](#grossistbeställningar-wholesale-orders)).
- **Konto:** real user email + logout via menu. Demo: *Driva körs just nu utan inloggning…* no password.
- **Billing readiness testids:** `billing-readiness-banner` | `billing-readiness-ready` | `billing-readiness-success` | `billing-complete-modal` | `billing-complete-suggest-vat` | `billing-complete-{name|orgnr|vat|address|payment}`. Copy: *Redo att fakturera*. Persist only on Spara.
- **Related:** `/foretag` is a parent crumb to settings (legacy). Onboarding fields overlap.
- **Components:** `settings-form.tsx`, `settings-billing-readiness.tsx`, `feature-settings.tsx`, `demo-reset-section.tsx`.
- **DB:** `business_settings`, `meta.features`, `business_onboarding` (Kom igång).
- **Live:** *Redo att fakturera* (demo company complete). Demo reset section at bottom of Företag.
- **Verify:** `/installningar?flik=fakturering` + testids. Script: `scripts/verify-billing-readiness-browser.ts`. Tests: `billing-readiness.test.ts`, `settings-*.test.ts`.

---

## Grossistbeställningar (wholesale orders)

- **User-facing name:** Grossistbeställningar (feature) · Grossister (settings tab) · Materialbeställningar (job section).
- **Purpose:** Electricians/plumbers connect their wholesalers (Ahlsell, Dahl, Sonepar, Solar, Lundagrossisten, Rexel, Annan), upload price lists / discount letters, search articles with **their own purchase prices**, build a cart per job, e-mail the order to the wholesaler and get the order confirmation matched back in the Ferva inbox. Optional feature — **invisible when off**: no nav item, the job material UI is unchanged.
- **Feature flag:** `wholesalers` in `src/lib/optional-features.ts` / `features.ts` (`wholesalersEnabled(db)`, `hasWholesalerUsage` backfills for existing data). Copy: *Sök material med dina priser och skicka beställningar till grossisten.* Deactivation never deletes connections, price files, articles or order history.
- **Routes:** settings `/installningar?flik=grossister`; order detail `/uppdrag/[id]/bestallning/[orderId]` (parent crumb = the job, back label *Uppdraget*); price-file upload `POST /api/grossist/prisfil` (multipart, CSRF + size + type checks, `mode=preview|import`). Inbox items of type `orderbekraftelse` render `inbox-order-confirmation.tsx` (no invoice fields).
- **Settings (Grossister):** `wholesaler-settings.tsx`. Per connection: wholesaler, display name, customer number, order e-mail (user-entered — Ferva never guesses), CC self, default pickup/delivery + store/address, contact, phone, customer price rule (*utpris från fil* | *påslag %* | *ange senare*), active toggle. Price list card: *Dina priser uppdaterades {datum}* · *{n} artiklar importerades* · *Prisfilen kan behöva uppdateras* (> `PRICE_LIST_STALE_DAYS` = 90) · *Vi hittade rabatter men saknar artikelregistret…* · last failed import with reason · **Ersätt prisfilen** / **Ladda upp prisfil**.
- **Import engine (`src/lib/wholesalers/`):** `file-detect.ts` (CSV/TXT/TSV/XLSX/XML/ZIP, BOM/UTF-8/Windows-1252), `csv.ts` (delimiter sniffing, Swedish decimals), `xlsx.ts` + `zip.ts` (own minimal readers; zip-bomb/ratio/entry limits, no nested archives, path traversal rejected), `xml.ts`/`xml-table.ts` (no DTD/entities), `table.ts` (formula-injection neutralised, row/column limits), `column-mapping.ts` (Swedish/English header synonyms + content heuristics; mapping remembered per connection), `import-engine.ts` (preview → validate → build). **Price rules:** explicit net price wins; otherwise list price × (1 − discount group %) from a discount letter stored on the connection; sales price from file only if that rule is chosen; else markup; never invents a price. Money = integer öre (`money.ts`); customer prices are whole kronor. **Atomic:** import row `processing` → products written under new `import_id` → activate + supersede old in a separate commit; failure leaves the previous list active (`status=failed`, `failed_reason`, row-level `errors[]` with line numbers).
- **Catalog storage:** `wholesaler_products` live **outside** the tenant aggregate: Supabase → SQL (`catalog-store-sql.ts`, indexes on article/E/RSK/GTIN keys + trigram on `search_text`); JSON/demo sessions → file/memory store (`catalog-store.ts`, `.data/wholesaler-catalog/`). Selection via `catalog.ts` from the **server-side tenant context only**.
- **Job UI:** `job-work.tsx` → when active and ≥1 active connection, **Lägg till material** opens `wholesaler-material-sheet.tsx` (mobile bottom sheet / desktop modal): big search field *Sök artikel, E-nummer eller RSK-nummer*, wholesaler switcher, results (name · art.nr/E/RSK · unit/pack · own price · customer price / *Kundpris saknas*), qty + **Lägg i varukorg**, sticky footer **Visa varukorg (n)**, discreet **Lägg till manuellt** (opens the classic `MaterialSheet`). Cart: qty steppers (44 px), remove, customer price per line, free-text line, line comments, delivery (pickup/delivery, store/address, requested date), orderer name/e-mail/phone, CC self, message; totals for expected purchase cost and customer price (only when complete). One cart per (job, connection); several wholesalers → separate carts and separate orders. Cart lines are planned purchases — **not** `JobWorkEntry`.
- **Send:** review view shows To / CC / Reply-To (company Ferva inbox) / subject / text + attachments (`bestallning-{ref}.pdf`, `.csv`) and blockers; explicit **Skicka beställning**. From = Ferva verified sender with display name *{Företag} via Ferva* (`mailFromWithDisplayName`), never the user's domain. Subject *Beställning FV-1001 – {Företag} – kundnr {n}*. Idempotent via `sendKey` + per-order lock + rate limit; provider error keeps status *Utkast*; demo business / mock provider → `sentSnapshot.transport = "simulated"` (honest copy). After send: **Skickad – inväntar bekräftelse**, immutable `sent_snapshot` (DB triggers `purchase_orders_guard` / `purchase_order_lines_guard`).
- **Statuses (`PURCHASE_ORDER_STATUS`):** draft *Utkast* · sent *Skickad – inväntar bekräftelse* · confirmed *Bekräftad* · partially_confirmed *Delvis bekräftad* · needs_review *Avvikelse kräver kontroll* · rejected *Avvisad* · cancelled *Avbruten*. Channel enum `email | edi | api | punchout` (only e-mail implemented).
- **Confirmations via inbox:** `ingestInboundMail` classifies `orderbekraftelse` (`looksLikeOrderConfirmation`, never when invoice hints exist; only when the business has sent orders). Matching (`matchOrderForMail`): 1) Ferva reference in subject/text/attachment, 2) known wholesaler order number, 3) customer number + job title + sender domain, else **candidates only** (`purchaseOrderCandidateIds`) — user picks *Det är den här*. Deterministic parsing first (`confirmation-parse.ts`: CSV/XML attachment → HTML table → text lines); AI fallback (`confirmation-ai.ts`, `enrichConfirmationWithAi` after the webhook ingest) only yields candidates with confidence < AUTO and never sends/books. Reconciliation (`reconcileConfirmation`): qty / price / backorder / substitute / missing / added / delivery_date / total. Exact article match with matching qty is auto-applied; qty/price/substitute/missing/added/total → `needs_review` with **Godkänn ändringarna**. Backorders and delivery dates are shown, not blocking. Idempotent per `inbox_item_id` and external message id; partial confirmations accumulate.
- **Material to job:** `syncJobWorkEntriesForOrder` creates/updates **one** `JobWorkEntry` per confirmed order line (`source: "wholesaler"`, `wholesaler` provenance: connection, order, line, confirmation, article, `unitCostOre`) only when a customer price exists (explicit > file > markup); *Kundpris saknas* lines stay confirmed but are **not** invoiceable at 0 kr (**Ange kundpris** on the order page). Invoiced entries are never changed automatically — deviations are listed (`lockedInvoicedLineIds`).
- **Permissions:** `manage_wholesalers` (owner/admin: connections + price files), `order_materials` (members too); consultants get neither. All reads/writes go through `withBusiness`; `business_id` never comes from the client.
- **Demo:** activating the feature in a demo context seeds *Demogrossisten* + a small CSV price list through the real import engine (`wholesalers/demo.ts`); sending simulates (no external mail) and immediately ingests a deterministic demo confirmation (`demoConfirmationPayload`). Demo reset clears the tables (`app.reset_demo_business`) and the catalog file.
- **DB (migration `30_wholesalers`):** `wholesaler_connections`, `wholesaler_price_imports`, `wholesaler_products`, `purchase_orders`, `purchase_order_lines`, `purchase_order_confirmations` (+ `job_work_entries.wholesaler_provenance`, `source='wholesaler'`; `inbox_items.purchase_order_id/…_confirmation_id/…_candidates`, `document_type='orderbekraftelse'`). RLS on all; same-business triggers; unique `(business_id, reference)`. `ensureWholesalerSchema` in `apply-pending-schema.ts` applies the same DDL where the migration is not pushed yet.
- **Selectors:** `[data-job-add-material]`, `[data-wholesaler-search]`, `[data-wholesaler-result]`, `[data-wholesaler-add]`, `[data-wholesaler-cart-button]`, `[data-wholesaler-cart-lines]`, `[data-wholesaler-review-button]`, `[data-wholesaler-send]`, `[data-wholesaler-manual]`, `[data-purchase-orders-section]`, `[data-purchase-order-line]`, `[data-inbox-order-candidates]`, `[data-link-order]`, `[data-approve-confirmation]`, `[data-set-customer-price]`.
- **Verify:** `src/lib/wholesalers.test.ts` (feature gating, CSV/TXT/XLSX/XML/ZIP import, discount groups, net-price precedence, failed import keeps catalog, server-side search, carts, sending, idempotency, demo sink, confirmations, deviations, partial/idempotent, no duplicate work entries, missing customer price, cross-tenant); `scripts/db-validate.ts` (RLS, same-business, immutability, pending schema); `scripts/adapter-validate.ts` (SQL catalog + full flow through the adapter); browser: `scripts/verify-wholesalers-browser.ts`.

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
| `billing-complete-modal` | same | Komplettera-modal body (plain form) |
| `billing-complete-suggest-vat` | same | Använd förslaget (fills only) |
| `billing-complete-${id}` | same | Fields: `name`, `orgnr`, `vat`, `address`, `payment` |

### Other stable hooks (prefer these today)

**Auth / onboarding ids:** `auth-email`, `auth-password`, `signup-email`, `signup-phone`, `signup-password`, `reset-email`, `new-password`, `confirm-password`, `ob-*`.

**Document forms:** `offert-saknas`, `offert-kund`, `offert-rubrik`, `offert-rot-rut`, `offert-betalplan`, `quote-send-blockers`, `faktura-saknas`, `faktura-kund`, `faktura-rot-rut`, `invoice-send-blockers`, `prisrader`.

**Customers / jobs:** `ny-kund-namn`, `ny-kund-epost`, `ny-kund-telefon`, `ny-kund-personnummer`, `ny-kund-orgnr`, `kund-namn`, `kund-epost`, `kund-personnummer`, `nytt-uppdrag-titel`, `uppdrag-titel`.

**Settings:** `installningar-saknas`, `installningar-address`, `installningar-postalCode`, `installningar-city`, `installningar-bankgiro`, `komplettera-address`, `komplettera-postalCode`, `komplettera-city`.

**Address autocomplete (all surfaces):** street input `role="combobox"` (`aria-expanded`, `aria-autocomplete="list"`, `aria-busy` while a search is in flight — wait for it to clear before asserting the list); suggestion menu `data-address-suggestions` (portaled — query from `document`, not the form); options `data-address-option={i}`; demo suggestions show a **Demo** tag.

**Other:** `nekat-belopp`, `invite-email`, `invite-form`, `hemsida-ai-beskrivning`, `doman-sok`, `webbformular-mottagare`, `data-nav="back"`, `data-driva-demo="1"`.

**Receipt file:** link text **Visa kvitto** with `href^="/api/kvitto/"` in `ExpenseRegister` (only when a file is stored). The **Lägg till kvitto** control is a `<label>` wrapping a hidden `input[type=file][accept="image/*,.pdf"]` — no `aria-label`, no testid; match on the label text.

**Aria / roles used by existing browser scripts:**

- Nav links: `aria-label` = Swedish section name (plus badge text).
- Create: `aria-label="Ny offert"|"Ny faktura"|"Ny kund"`.
- Discard icon: `aria-label="Kasta offertutkast"|"Kasta fakturautkast"`.
- Command bar: `role="listbox"` `aria-label="Förslag"`.
- Mer sheet: `role="dialog"` `aria-label="Mer"`. Mobile bottom bar: `nav[aria-label="Huvudnavigation"]`. Desktop Mer group: `[data-nav-group="mer"]`. Active nav link: `aria-current="page"`.
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
- Ekonomi / Inbox / Bokföring **tabs** and Kunder / Uppdrag **filter chips**
- Register rows (quote/invoice/customer/job/inbox) as clickable units
- Quote/invoice detail primary actions: Skicka, Redigera, Öppna kundvyn, Kopiera kundlänk (discard button is the exception)
- Public Godkänn offert (`public-quote-accept` below the card; `public-quote-accept-bar` on mobile) / Avböj (`public-quote-decline`)
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
| 1 | `nav-item-{hem,uppdrag,kunder,ekonomi,inbox,bokforing,hemsida,samarbeta,installningar}` | `nav.tsx` | Reach any area without depending on visible label/CSS. Include mobile Mer. |
| 2 | `command-bar-input` | `command-bar.tsx` | Hem’s primary control; every “do X from Hem” repro starts here. |
| 3 | `quote-row-{id}` / `invoice-row-{id}` | `economy-register.tsx` | Open #116 / #1042 without matching Swedish status text. |
| 4 | `quote-send` / `invoice-send` | draft send components | Pair with existing `discard-draft-trigger` + checklists. |
| 5 | `attention-item-{actionId}` | `attention-list.tsx` | Hem/Bokföring share ids; needed for “Inte aktuell”, remind, bankfil. |
| 6 | `public-quote-accept` / `public-quote-decline` (**added**) | `quote-accept.tsx` / `quote-public-actions.tsx` | Customer accept is the product’s signature moment. |
| 7 | `demo-menu` + `demo-reset` + `demo-end` | `demo-menu.tsx` | Every live/QA session enters and resets here. |
| 8 | `job-row-{id}` + `job-create-invoice` | uppdrag list + `job-controls.tsx` | Job → invoice is the core money path. |
| 9 | `inbox-row-{id}` + `inbox-create-payment-file` | inbox list/detail | Badge/open/pay path; today only address text is asserted. |
| 10 | `ekonomi-tab-{offerter,fakturor,utgifter,bank}` | tab strips | Agents constantly miss that Offerter/Fakturor are **tabs** under Ekonomi (Uppdrag is its own nav item). |

Do **not** add testids to every settings field or design token — those already have `id=` hooks (`ob-*`, `offert-*`, `installningar-*`).

---

## Reproduction recipes (quick)

**Always start from a clean demo:** `/demo` or Återställ demo. Seed ids above are valid after reset.

| Task | Steps |
|------|-------|
| Open Offerter | `/demo` → **Ekonomi** → tab Offerter (default) |
| Delete a quote | Only #116 → *Kasta utkast* → confirm. Sent quotes: Hem *Inte aktuell* or public *Avböj*. |
| Accept a quote | `/offert/demo-bertil-fasad` → accept chrome **below** the document → name → Godkänn offert |
| Overdue invoice | `/ekonomi/fakturor/inv-1042` |
| Inbox badge item | `/inbox/inbox-mail-byggmax` |
| Upload a receipt file | `/bokforing` → *Kvitto saknas – Clas Ohlson, 349 kr* → **Lägg till kvitto** (file < 1,5 MB) → Ekonomi → Utgifter → **Visa kvitto** |
| Address autocomplete (demo) | `/demo` → Kunder → **Ny kund** → type `Väd` in **Adress** → `[data-address-suggestions]` with **Demo** tag → pick → adress + postnummer + ort filled |
| Enable Samarbeta | `/installningar?flik=funktioner` → Aktivera Samarbeta |
| Accountant UI | Company row → Visa redovisningsvyn |
| Auth wall | Incognito `/kunder` → login with `next=/kunder` |

Local: `npm run dev` → http://localhost:3123 (JSON demo, no `/demo` needed). Do not kill a healthy process on 3123.
