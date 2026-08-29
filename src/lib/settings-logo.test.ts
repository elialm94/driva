process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb, db } from "./store";
import { emptyTestDb } from "./invoices/test-db";
import { applyBusinessProfilePatch } from "./services/settings";

/**
 * Logotypens autospar (Inställningar → Företag) går via applyBusinessProfilePatch
 * med ENBART logoDataUrl – resten av ett eventuellt halvredigerat formulär får
 * aldrig följa med. Testerna låser den partiella semantiken.
 */

const PNG_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAA=";

describe("logotyp via applyBusinessProfilePatch", () => {
  beforeEach(() => {
    replaceDb(emptyTestDb());
  });

  it("sparar logotypen utan att röra andra fält", () => {
    const before = { ...db().settings };
    const s = applyBusinessProfilePatch({ logoDataUrl: PNG_URL });
    assert.equal(s.logoDataUrl, PNG_URL);
    assert.equal(s.name, before.name);
    assert.equal(s.email, before.email);
    assert.equal(s.bankgiro, before.bankgiro);
    assert.equal(s.logoInitials, before.logoInitials);
    assert.equal(s.paymentTermsDays, before.paymentTermsDays);
  });

  it("null tar bort logotypen", () => {
    applyBusinessProfilePatch({ logoDataUrl: PNG_URL });
    const s = applyBusinessProfilePatch({ logoDataUrl: null });
    assert.equal(s.logoDataUrl, undefined);
  });

  it("tom sträng tar bort logotypen", () => {
    applyBusinessProfilePatch({ logoDataUrl: PNG_URL });
    const s = applyBusinessProfilePatch({ logoDataUrl: "" });
    assert.equal(s.logoDataUrl, undefined);
  });

  it("avvisar värden som inte är bilddata", () => {
    assert.throws(
      () => applyBusinessProfilePatch({ logoDataUrl: "https://example.se/logo.png" }),
      /Logotypen måste vara en bild/
    );
    // Misslyckad patch lämnar sparat läge orört.
    assert.equal(db().settings.logoDataUrl, undefined);
  });

  it("patch utan logoDataUrl lämnar en sparad logotyp i fred", () => {
    applyBusinessProfilePatch({ logoDataUrl: PNG_URL });
    const s = applyBusinessProfilePatch({ phone: "070-123 45 67" });
    assert.equal(s.logoDataUrl, PNG_URL);
    assert.equal(s.phone, "070-123 45 67");
  });
});
