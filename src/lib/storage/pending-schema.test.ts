process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { settingsColumns } from "./mappers";

const here = dirname(fileURLToPath(import.meta.url));

describe("pending schema för settings och hemsida", () => {
  it("settings-upserten skriver payer-kolumner som måste finnas", () => {
    assert.ok(settingsColumns.includes("payer_bank_name"));
    assert.ok(settingsColumns.includes("payer_iban"));
    assert.ok(settingsColumns.includes("payer_bic"));
    assert.ok(settingsColumns.includes("default_hourly_rate"));
  });

  it("payer-kolumner läggs till även när payment_files redan finns", () => {
    const apply = readFileSync(join(here, "apply-pending-schema.ts"), "utf8");
    const payerBlock = apply.slice(apply.lastIndexOf("Oberoende av payment_files"));
    assert.match(payerBlock, /payer_bank_name/);
    assert.match(payerBlock, /payer_iban/);
    assert.match(payerBlock, /payer_bic/);
    assert.match(apply, /ensurePendingSchema/);
  });

  it("tenant-commit applicerar schema före skrivning och retrys vid saknad kolumn", () => {
    const adapter = readFileSync(join(here, "adapter-supabase.ts"), "utf8");
    assert.match(adapter, /ensurePendingSchema/);
    assert.match(adapter, /isUndefinedColumn/);
    assert.match(adapter, /commit-retry-schema/);
  });
});
