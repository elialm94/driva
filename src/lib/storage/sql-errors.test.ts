process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isUndefinedColumn, userFacingStorageError } from "./sql-errors";

describe("userFacingStorageError", () => {
  it("döljer saknad kolumn (payer_*, footer) bakom svensk text", () => {
    const err = Object.assign(new Error('column "payer_bank_name" of relation "business_settings" does not exist'), {
      code: "42703",
    });
    assert.equal(isUndefinedColumn(err), true);
    assert.equal(userFacingStorageError(err), "Kunde inte spara ändringen. Försök igen.");
    assert.equal(userFacingStorageError(err).includes("payer"), false);
    assert.equal(userFacingStorageError(err).includes("business_settings"), false);
  });

  it("behåller svenska domänfel", () => {
    assert.equal(userFacingStorageError(new Error("Företagsnamn saknas.")), "Företagsnamn saknas.");
  });
});
