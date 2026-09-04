process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isUndefinedColumn, isUniqueViolation, userFacingStorageError } from "./sql-errors";

describe("userFacingStorageError", () => {
  it("döljer saknad kolumn (payer_*, footer) bakom svensk text", () => {
    const payer = Object.assign(new Error('column "payer_bank_name" of relation "business_settings" does not exist'), {
      code: "42703",
    });
    assert.equal(isUndefinedColumn(payer), true);
    assert.equal(userFacingStorageError(payer), "Kunde inte spara ändringen. Försök igen.");
    assert.equal(userFacingStorageError(payer).includes("payer"), false);
    assert.equal(userFacingStorageError(payer).includes("business_settings"), false);

    const footer = Object.assign(new Error('column "footer" of relation "websites" does not exist'), {
      code: "42703",
    });
    assert.equal(userFacingStorageError(footer).includes("footer"), false);
    assert.equal(userFacingStorageError(footer).includes("websites"), false);
  });

  it("behåller svenska domänfel", () => {
    assert.equal(userFacingStorageError(new Error("Företagsnamn saknas.")), "Företagsnamn saknas.");
    assert.equal(userFacingStorageError(new Error("Okänt tema.")), "Okänt tema.");
  });

  it("känner igen unique_violation", () => {
    const err = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
    assert.equal(isUniqueViolation(err), true);
    assert.equal(isUniqueViolation(new Error("nope")), false);
  });

  it("döljer relationsfel", () => {
    const err = Object.assign(new Error('relation "websites" does not exist'), { code: "42P01" });
    assert.equal(userFacingStorageError(err), "Kunde inte spara ändringen. Försök igen.");
  });
});
