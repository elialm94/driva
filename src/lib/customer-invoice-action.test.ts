process.env.DRIVA_TEST = "1";

import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const actions = readFileSync(new URL("../components/customer-chain-actions.tsx", import.meta.url), "utf8");

describe("kundsidans Skapa faktura", () => {
  it("har en Skapa faktura-knapp och ingen Fristående faktura-knapp", () => {
    assert.match(actions, /Skapa faktura/);
    assert.equal(actions.includes("Fristående faktura"), false);
    assert.match(actions, /Fristående/);
  });

  it("öppnar inte uppdragssidan från Skapa faktura", () => {
    // Tidigare: jobHref(ctas.openJobId) när det fanns ett öppet uppdrag.
    // Det öppnade Köksrenovering i stället för att skapa en faktura.
    assert.equal(actions.includes("jobHref(ctas.openJobId"), false);
    assert.match(actions, /standaloneInvoiceHref/);
    assert.match(actions, /showInvoicePicker/);
    assert.match(actions, /Från offert/);
    assert.match(actions, /Från uppdrag/);
  });
});

describe("kundsidans sidhuvudknappar", () => {
  it("återanvänder nav-ikonerna utan plus-prefix", () => {
    // Samma glypher som nav / objektytorna: Uppdrag=Hammer, Offerter=FileText, Fakturor=ReceiptText.
    assert.match(actions, /Hammer/);
    assert.match(actions, /FileText/);
    assert.match(actions, /ReceiptText/);
    assert.match(actions, /icon=\{Hammer\}/);
    assert.equal(actions.includes("Plus"), false);
    assert.doesNotMatch(actions, /\+\s*(Ny|Skapa)/);
  });

  it("håller hierarkin faktura fylld, offert outline, uppdrag ghost", () => {
    assert.match(actions, /variant="ghost"/);
    assert.match(actions, /buttonClasses\("ghost"/);
    assert.match(actions, /variant="secondary"/);
    assert.match(actions, /buttonClasses\("primary"/);
    assert.doesNotMatch(actions, /buttonClasses\("accent"/);
    assert.match(actions, /size-\[18px\]/);
  });
});
