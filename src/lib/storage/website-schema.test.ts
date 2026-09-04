process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { websitesSpec } from "./mappers";

const here = dirname(fileURLToPath(import.meta.url));

describe("websites footer/design-schema", () => {
  it("upsert skriver footer och draft_footer som egna kolumner", () => {
    assert.ok(websitesSpec.columns.includes("footer"));
    assert.ok(websitesSpec.columns.includes("draft_footer"));
    assert.ok(websitesSpec.columns.includes("design"));
    assert.ok(websitesSpec.columns.includes("draft_design"));
    assert.ok(websitesSpec.columns.includes("draft_revision"));
    assert.ok(websitesSpec.columns.includes("published_revision"));
    assert.ok(websitesSpec.columns.includes("draft_sections"));
    assert.ok(websitesSpec.columns.includes("draft_primary_cta"));
  });

  it("pending schema och migrationen skapar websites.footer", () => {
    const apply = readFileSync(join(here, "apply-pending-schema.ts"), "utf8");
    const migration = readFileSync(
      join(here, "../../../supabase/migrations/20260831121000_22_website_footer.sql"),
      "utf8"
    );
    const revisionMigration = readFileSync(
      join(here, "../../../supabase/migrations/20260831140000_23_website_revisions.sql"),
      "utf8"
    );
    assert.match(apply, /ensureColumn\(\s*"websites",\s*"footer"/);
    assert.match(apply, /ensureColumn\(\s*"websites",\s*"draft_footer"/);
    assert.match(apply, /ensureColumn\(\s*"websites",\s*"draft_revision"/);
    assert.match(apply, /ensureColumn\(\s*"websites",\s*"published_revision"/);
    assert.match(apply, /ensurePendingSchema/);
    assert.match(migration, /add column if not exists footer jsonb/);
    assert.match(migration, /add column if not exists draft_footer jsonb/);
    assert.match(revisionMigration, /draft_revision/);
    assert.match(revisionMigration, /published_revision/);
    const workspaceMigration = readFileSync(
      join(here, "../../../supabase/migrations/20260831143000_23_website_draft_workspace.sql"),
      "utf8"
    );
    assert.match(workspaceMigration, /draft_sections/);
    assert.match(workspaceMigration, /draft_primary_cta/);
    assert.match(apply, /ensureColumn\(\s*"websites",\s*"draft_sections"/);
    assert.match(apply, /ensureColumn\(\s*"websites",\s*"draft_primary_cta"/);
  });

  it("tema-commit applicerar schema före skrivning", () => {
    const adapter = readFileSync(join(here, "adapter-supabase.ts"), "utf8");
    assert.match(adapter, /ensurePendingSchema/);
    assert.match(adapter, /isUndefinedColumn/);
  });
});
