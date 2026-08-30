process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DocLine } from "./types";
import {
  hasCompleteLine,
  invoiceMissingRequirements,
  lineIsBlank,
  lineMissingParts,
  lineRequirements,
  prunedLines,
  quoteMissingRequirements,
  radLabel,
} from "./form-requirements";
import { settingsFieldErrors } from "./settings-validation";

function line(over: Partial<DocLine> = {}): DocLine {
  return {
    id: "l1",
    kind: "arbete",
    description: "Montering",
    qty: 1,
    unit: "st",
    unitPrice: 500_00,
    vatRate: 25,
    ...over,
  };
}

describe("rader", () => {
  it("helt tomma rader räknas som blanka och rensas bort", () => {
    const blank = line({ id: "b", description: "", unitPrice: 0 });
    const full = line({ id: "f" });
    assert.equal(lineIsBlank(blank), true);
    assert.equal(lineIsBlank(full), false);
    assert.deepEqual(
      prunedLines([blank, full]).map((l) => l.id),
      ["f"]
    );
  });

  it("blank rad kräver ingenting; påbörjad rad kräver det som fattas", () => {
    assert.deepEqual(lineMissingParts(line({ description: "", unitPrice: 0 })), { description: false, price: false });
    assert.deepEqual(lineMissingParts(line({ description: "Montör", unitPrice: 0 })), { description: false, price: true });
    assert.deepEqual(lineMissingParts(line({ description: "", unitPrice: 100_00 })), { description: true, price: false });
  });

  it("bara blanka rader ⇒ ett samlat krav på första radens beskrivning", () => {
    const reqs = lineRequirements([line({ id: "a", description: "", unitPrice: 0 })]);
    assert.equal(reqs.length, 1);
    assert.equal(reqs[0].label, "Minst en prisrad med beskrivning och pris");
    assert.equal(reqs[0].fieldId, "rad-a-beskrivning");
  });

  it("mänskliga etiketter: namn på raden när det finns, annars ordningstal", () => {
    const reqs = lineRequirements([
      line({ id: "a", description: "Montör", unitPrice: 0 }),
      line({ id: "b", description: "", unitPrice: 200_00 }),
    ]);
    assert.deepEqual(
      reqs.map((r) => r.label),
      ["Pris på raden ”Montör”", "Beskrivning på andra raden"]
    );
    assert.equal(radLabel(0), "första raden");
    assert.equal(radLabel(11), "rad 12");
  });

  it("hasCompleteLine kräver både beskrivning och pris", () => {
    assert.equal(hasCompleteLine([line({ description: "Montör", unitPrice: 0 })]), false);
    assert.equal(hasCompleteLine([line()]), true);
  });
});

describe("offert", () => {
  const base = {
    customerId: "c1",
    title: "Altanbygge",
    lines: [line()],
    planPercentTotal: 100,
    validUntil: "2026-09-30",
    paymentTermsDays: 14,
    customerEmail: "kund@example.se",
  };

  it("komplett utkast ⇒ inga krav", () => {
    assert.deepEqual(quoteMissingRequirements(base), []);
  });

  it("tomt formulär listar kund, rubrik och rader", () => {
    const missing = quoteMissingRequirements({
      ...base,
      customerId: "",
      title: "",
      lines: [line({ description: "", unitPrice: 0 })],
    });
    assert.deepEqual(
      missing.map((m) => m.id),
      ["kund", "rubrik", "rader"]
    );
    assert.equal(missing[1].label, "Rubrik");
    assert.equal(missing[1].fieldId, "offert-rubrik");
  });

  it("betalplan som inte summerar till 100 % blockerar", () => {
    const missing = quoteMissingRequirements({ ...base, planPercentTotal: 70 });
    assert.equal(missing.length, 1);
    assert.match(missing[0].label, /100 %/);
    assert.match(missing[0].label, /70 %/);
  });

  it("skicka kräver kundens e-post, utkast gör det inte", () => {
    const state = { ...base, customerEmail: "" };
    assert.deepEqual(quoteMissingRequirements(state, "draft"), []);
    const send = quoteMissingRequirements(state, "send");
    assert.equal(send.length, 1);
    assert.equal(send[0].id, "kund-epost");
  });
});

describe("faktura", () => {
  const base = { customerId: "c1", lines: [line()], dueInDays: 14, customerEmail: "kund@example.se" };

  it("komplett utkast ⇒ inga krav", () => {
    assert.deepEqual(invoiceMissingRequirements(base), []);
  });

  it("betalningsvillkor under 1 dag blockerar", () => {
    const missing = invoiceMissingRequirements({ ...base, dueInDays: 0 });
    assert.equal(missing.length, 1);
    assert.equal(missing[0].id, "betalvillkor");
    assert.equal(missing[0].fieldId, "faktura-betalvillkor");
  });

  it("skicka kräver kundens e-post", () => {
    const send = invoiceMissingRequirements({ ...base, customerEmail: " " }, "send");
    assert.deepEqual(
      send.map((m) => m.id),
      ["kund-epost"]
    );
  });
});

describe("inställningar", () => {
  const ok = {
    name: "Almqvist Snickeri AB",
    orgNumber: "559123-4567",
    vatNumber: "SE559123456701",
    email: "hej@snickeri.se",
    websiteNotificationEmail: "hej@snickeri.se",
    bankgiro: "5678-1234",
    plusgiro: "",
    iban: "",
    bic: "",
    logoDataUrl: "",
    paymentTermsDays: 14,
    lateInterestRate: 8,
    quoteValidityDays: 30,
    defaultVatRate: 25 as const,
  };

  it("giltiga uppgifter ⇒ inga fel", () => {
    assert.deepEqual(settingsFieldErrors(ok), []);
  });

  it("trasigt orgnr ger fältfel på företagsfliken", () => {
    const errors = settingsFieldErrors({ ...ok, orgNumber: "123" });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].field, "orgNumber");
    assert.equal(errors[0].tab, "foretag");
    assert.match(errors[0].message, /10 siffror/);
  });

  it("tomma valfria fält validerar inte format", () => {
    const errors = settingsFieldErrors({ ...ok, orgNumber: "", vatNumber: "", bankgiro: "" });
    assert.deepEqual(errors, []);
  });

  it("standardval: betalningsvillkor och giltighetstid kräver minst 1 dag", () => {
    const errors = settingsFieldErrors({ ...ok, paymentTermsDays: 0, quoteValidityDays: 0 });
    assert.deepEqual(
      errors.map((e) => e.field),
      ["paymentTermsDays", "quoteValidityDays"]
    );
    assert.ok(errors.every((e) => e.tab === "standardval"));
  });

  it("företagsnamn krävs alltid", () => {
    const errors = settingsFieldErrors({ ...ok, name: "  " });
    assert.equal(errors[0]?.field, "name");
  });
});
