process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isUndefinedColumn, userFacingStorageError } from "./sql-errors";

describe("userFacingStorageError", () => {
  it("döljer rå Postgres-text om websites.footer saknas", () => {
    const err = Object.assign(new Error('column "footer" of relation "websites" does not exist'), {
      code: "42703",
    });
    assert.equal(isUndefinedColumn(err), true);
    assert.equal(userFacingStorageError(err), "Kunde inte spara ändringen. Försök igen.");
    assert.equal(userFacingStorageError(err).includes("footer"), false);
    assert.equal(userFacingStorageError(err).includes("websites"), false);
  });

  it("behåller svenska domänfel", () => {
    assert.equal(userFacingStorageError(new Error("Okänt tema.")), "Okänt tema.");
  });

  it("döljer relationsfel", () => {
    const err = Object.assign(new Error('relation "websites" does not exist'), { code: "42P01" });
    assert.equal(userFacingStorageError(err), "Kunde inte spara ändringen. Försök igen.");
  });
});
