process.env.DRIVA_TEST = "1";

import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const kunder = readFileSync(new URL("../components/kunder-header-actions.tsx", import.meta.url), "utf8");
const ekonomi = readFileSync(new URL("../app/(app)/ekonomi/page.tsx", import.meta.url), "utf8");

describe("page-header create-actions", () => {
  it("Kunder visar två direkta knappar utan + Skapa-dropdown", () => {
    assert.equal(kunder.includes("CreateMenu"), false);
    assert.match(kunder, /PageHeaderCreateActions/);
    assert.match(kunder, /NewCustomerButton/);
    assert.match(kunder, /label="Uppdrag"/);
  });

  it("Ekonomi behåller två direkta knappar, med kortare mobil-etiketter", () => {
    assert.equal(ekonomi.includes("CreateMenu"), false);
    assert.match(ekonomi, /PageHeaderCreateActions/);
    assert.match(ekonomi, /Ny faktura/);
    assert.match(ekonomi, /Ny offert/);
    assert.match(ekonomi, /shortLabel="Faktura"/);
    assert.match(ekonomi, /shortLabel="Offert"/);
    assert.match(ekonomi, /variant="secondary"/);
  });
});
