<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Ferva - project rules for agents

English here by design. Everything else you write is Swedish: user-visible strings AND code comments.

## What this is

Ferva is an AI-native "business in a box" for Swedish one-person trade and service companies
(carpenter, painter, electrician, plumber, excavation contractor). The owner does the job; Ferva does
the administration. Product name is **Ferva**. Live: https://driva-alpha.vercel.app/

The core chain is the spine of the product. Everything else hangs off it:

    Kund -> Uppdrag -> Offert -> kundens godkännande -> Faktura -> Betalning -> Bokföring

The customer approves a quote on a public link (`/offert/[token]`) by typing their name and pressing
**Godkänn offert**. No BankID, no login, and it is never called BankID, e-legitimation or avancerad
underskrift. Approval locks the quote version, stores a SHA-256 hash as evidence and creates the job.

## Read this before changing anything

| Question | File |
| --- | --- |
| Where does this feature live, how does a user reach it, how do I verify a fix? | `docs/agent/FEATURE_MAP.md` (1400 lines; read the intro plus the sections you touch) |
| Why is the money modelled this way? | `README.md`, the four ADRs at the end |
| How does the assistant work, what may a model do? | `docs/ai.md` |
| What is NOT verifiable from the repo (Stripe live, TOTP, PITR, DNS, filing provider, app stores)? | `GO_LIVE_CHECKLIST.md` |
| What does the product support at all? | `src/lib/support/matrix.ts` and `/omfattning` |

Do not rediscover the app by grepping. FEATURE_MAP answers "where and how do I verify" for every
surface, and it is kept current with a residual note per PR. If you change behaviour it describes,
update it in the same PR.

## The six gates

    npm run typecheck && npm run lint && npm test && npm run test:db && npm run test:adapter && npm run build

`.github/workflows/ci.yml` runs exactly these on every PR and push to `main`. A change is not done
until all six pass. `npm test` discovers every `*.test.ts(x)` under `src/` recursively;
`src/lib/test-discovery.test.ts` fails if a test file ever falls outside the patterns.
`test:db` validates SQL invariants in PGlite (RLS, atomic RPCs, immutability, concurrency) and
`test:adapter` runs the real domain services through diff, commit and validation. Neither needs
Docker or Supabase credentials.

## Hard rules

Each rule names the file that owns or enforces it.

- **Never fake an integration.** No key, no provider, no verified DNS means an honest Swedish
  "inte konfigurerad" in the UI, never a simulated success. Mock BankID is server-gated to demo
  (`src/lib/services/bankid.ts`), the assistant answers "not configured" without a key
  (`src/lib/ai/intent.ts`), mail without `RESEND_API_KEY` + From leaves the quote as a draft
  (`src/lib/email/`). Never invent a legal value, an org number or a credential.
- **No visible "Driva" anywhere.** The old name survives only as technical identifiers (`DRIVA_*`
  env, `driva_*` cookies, DB role `driva_app`, log prefixes, the Vercel project name). Enforced by
  `src/lib/brand-scan.test.ts` across source, manifest, PDF, mail and file names.
- **Status labels come from `src/lib/status-labels.ts`.** Never render a raw enum (`skickad`,
  `POSTED`, `pending`) as primary UI. The accept method is not a status.
- **Hela kronor in the domain** (ADR-1). Everything in the domain and the database is integer
  kronor. Ören exist only at the boundary: rounded on bank import, 1 kr tolerance booked to BAS 3740
  (`ORE_TOLERANS_KR` in `src/lib/autopilot.ts`), wholesaler prices stored as `*_ore` and rounded once
  when a line enters a document (`src/lib/wholesalers/agreement-pricing.ts`).
- **Autopilot thresholds live only in `src/lib/autopilot.ts`** (ADR-4): `>= 0.98` auto,
  `0.80-0.98` suggest, `< 0.80` human, plus the outcomes `AUTO_EXECUTE / SUGGEST / REQUIRES_USER /
  BLOCKED`. No magic confidence numbers in services. Overpayments and partial ROT/RUT payouts are
  never booked automatically, whatever the confidence.
- **All bookkeeping goes through `postVerification`** in `src/lib/accounting/engine.ts`. Never write
  the `verifications` table directly. Never delete or shorten an `explanation` on a verification or
  an attention row: it is the plain-language reason a machine booked something.
- **Do not change `src/lib/accounting/` or `src/lib/bas.ts`** without first adding a test that shows
  the bug and fails.
- **AI risk classes are enforced server-side**, not just declared: `READ_ONLY`, `SAFE_WRITE`,
  `CONFIRM_REQUIRED`, `FORBIDDEN_FOR_AI` in `src/lib/ai/tools.ts`, checked again in `executeTool` for
  `origin: "ai"`. **The model never confirms an action.** Free text produces drafts; sending,
  crediting, booking, publishing and domain purchases stop at the existing confirmation card and only
  the user's button press executes. Raw ledger mutation, manual invoice numbering, deletion of posted
  entries, SQL and auth/admin operations are not tools at all.
- **Personnummer never leave the server.** The model sees only
  `hasPersonalIdentityNumber: true/false` (`src/lib/ai/domain.ts`). They never enter audit metadata
  and never reach Sentry (`src/lib/observability/scrub.ts`). In the UI they are masked; revealing one
  is a dedicated server action.
- **Swedish UI and Swedish code comments.** English only in this file.
- **No em dash in prose.** Use a hyphen, or restructure the sentence. Enforced by
  `src/lib/em-dash-scan.test.ts`, which fails on an em dash (U+2014) with whitespace on either side
  inside a string literal or JSX text under `src/`. The standalone table placeholder `"—"` (an em dash
  that is the whole string, meaning "no value") is correct typography, is exempt, and must keep
  working. Comments are outside the guard; do not rewrite existing ones on your own initiative.
- **No `as any`, no `@ts-ignore`, no `console.log`.**
- **Tests are additive.** Never edit an existing test to make it green. If an existing test genuinely
  encodes behaviour you are asked to change, say so and ask first.

## Storage: two modes, one domain

- **Supabase/Postgres** in production: real auth, one business per customer, RLS on every tenant
  table, atomic RPCs (`app.issue_invoice`, `app.post_verification`, `app.match_payment`), immutability
  triggers and an audit log written in the same transaction as the change.
- **Local JSON** (`.data/db.json`) for development, the public demo and tests. `DRIVA_TEST=1` uses an
  in-memory store. In production JSON mode is off: incomplete env stops the app with an honest error
  instead of falling back silently.

Both go through `src/lib/store.ts` + `src/lib/storage/`. Schema changes are additive SQL files in
`supabase/migrations/` **and** a twin in `src/lib/storage/apply-pending-schema.ts`. The production
build applies migrations before `next build` (`scripts/vercel-build.sh`) and fails if it cannot.

**Business logic belongs in `src/lib/services/`.** The UI (server actions in `src/app/`) and the
assistant call the same functions, so a rule cannot exist in one path and be missing in the other.
Route handlers and pages orchestrate; they do not hold domain rules.
