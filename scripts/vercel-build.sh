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
# percent-encoded. A missing URL warns instead of failing, so deploys still
# work if the secret is rotated or unset.
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
    echo "[migrate] WARNING: SUPABASE_MIGRATION_DB_URL is not set - migrations NOT applied."
    echo "[migrate] Production schema may lag behind this build. See README, 'Databas och migrationer'."
    return 0
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
