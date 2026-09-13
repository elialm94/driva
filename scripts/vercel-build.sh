#!/usr/bin/env bash
# Vercel build step: apply migrations BEFORE building.
#
# Without this, `supabase db push` was a manual step a human had to remember,
# so a merge could ship code whose tables did not exist yet in production.
# That is what took ferva.se down: migration 53 created terms_acceptances,
# the deploy went live without it, and every page hit the root layout's
# terms gate and failed.
#
# Order matters: migrations run first and a failure aborts the build, so a
# deploy that cannot migrate never reaches traffic. The old code keeps serving.
#
# Needs SUPABASE_MIGRATION_DB_URL in Vercel (Production scope only): the
# direct Postgres connection string, not the pooler, with the password
# percent-encoded.
#
# A missing URL in production FAILS the build. It used to warn and build on,
# which left the migration-53 failure mode wide open: rotate the secret or
# change its Vercel scope and the next deploy ships code whose tables do not
# exist. A failed build means the previous deploy keeps serving, which is the
# safe outcome. There is deliberately no escape-hatch env var.
#
# Non-production (preview, local) is unchanged: skip with a note.
#
# Usage: set as buildCommand in vercel.json. Never runs locally.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

apply_migrations() {
  if [[ "${VERCEL_ENV:-}" != "production" ]]; then
    echo "[migrate] VERCEL_ENV=${VERCEL_ENV:-<unset>} - skipping (production only)."
    return 0
  fi

  if [[ -z "${SUPABASE_MIGRATION_DB_URL:-}" ]]; then
    echo "[migrate] FEL: SUPABASE_MIGRATION_DB_URL är inte satt - bygget avbryts." >&2
    echo "[migrate] Utan den kan migrationerna inte appliceras, och en deploy med kod" >&2
    echo "[migrate] vars tabeller saknas släcker sajten (det var migration 53 och" >&2
    echo "[migrate] terms_acceptances som tog ner ferva.se)." >&2
    echo "[migrate] Sätt den i Vercel: Project → Settings → Environment Variables," >&2
    echo "[migrate] scope Production, värdet = den DIREKTA Postgres-anslutningen" >&2
    echo "[migrate] (db.<ref>.supabase.co:5432, inte poolaren) med lösenordet" >&2
    echo "[migrate] procent-kodat. Deploya om därefter." >&2
    echo "[migrate] Den förra deployen fortsätter svara tills bygget går igenom." >&2
    # exit, inte return: bygget ska stanna här, före next build.
    exit 1
  fi

  echo "[migrate] Applying supabase/migrations to production..."
  # --yes: never prompt, a prompt would hang the build.
  # --include-all: apply anything missing from the remote history table even if
  #   its timestamp predates the last applied one. Two branches merging the same
  #   day produce out-of-order timestamps, and without this they are skipped.
  # --skip-vault: the migration role need not own Vault secrets.
  # Errors propagate (set -e), which fails the build before `next build`.
  npx --yes supabase db push \
    --db-url "$SUPABASE_MIGRATION_DB_URL" \
    --include-all \
    --skip-vault \
    --yes
  echo "[migrate] Migrations up to date."
}

apply_migrations

echo "[build] next build"
npm run build
