import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EXPECTED_MIGRATION_VERSION, migrationVersionFromFilename } from "./schema-version";

test("EXPECTED_MIGRATION_VERSION matchar senaste filen i supabase/migrations", () => {
  const dir = path.join(process.cwd(), "supabase", "migrations");
  const versions = fs
    .readdirSync(dir)
    .map(migrationVersionFromFilename)
    .filter((v): v is string => v !== null)
    .sort();
  assert.ok(versions.length > 0);
  assert.equal(EXPECTED_MIGRATION_VERSION, versions[versions.length - 1]);
});

test("migrationVersionFromFilename", () => {
  assert.equal(migrationVersionFromFilename("20260912150000_52_platform_ops_records.sql"), "20260912150000");
  assert.equal(migrationVersionFromFilename("README.md"), null);
});
