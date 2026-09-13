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
