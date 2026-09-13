import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatPersonnummer, maskPersonnummer, personnummerInputChange } from "./personnummer";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../..");

function source(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8");
}

/** Påhittat nummer. Riktiga personnummer hör inte hemma i tester. */
const PAHITTAT = "19991231-9999";

/** Skriver tecken för tecken i ett fält som formaterar vid varje ändring. */
function skrivIn(chars: string, start = ""): string[] {
  let value = start;
  return [...chars].map((ch) => {
    value = personnummerInputChange(value, value + ch);
    return value;
  });
}

/** Backsteg: webbläsaren tar bort tecknet före markören innan onChange. */
function backsteg(value: string, caret = value.length): string {
  const next = value.slice(0, caret - 1) + value.slice(caret);
  return personnummerInputChange(value, next);
}

describe("personnummer i inmatningsfält", () => {
  it("sätter bindestrecket medan man skriver första gången", () => {
    const steps = skrivIn("199912319999");
    assert.equal(steps[7], "19991231");
    assert.equal(steps[8], "19991231-9");
    assert.equal(steps.at(-1), PAHITTAT);
  });

  it("sätter bindestrecket efter sex siffror för tiosiffriga nummer", () => {
    const steps = skrivIn("9912319999");
    assert.equal(steps[5], "991231");
    assert.equal(steps[6], "991231-9");
    assert.equal(steps.at(-1), "991231-9999");
  });

  it("backsteg över bindestrecket tar siffran före och lägger inte tillbaka strecket", () => {
    // Markören står efter bindestrecket: backsteg tar bort just bindestrecket.
    const efter = personnummerInputChange(PAHITTAT, "199912319999");
    assert.notEqual(efter, PAHITTAT);
    assert.equal(efter, "19991239-999");

    // Nästa backsteg måste fortsätta krympa, annars sitter markören fast.
    const igen = personnummerInputChange(efter, "19991239999");
    assert.equal(igen, "19991239-99");
  });

  it("backsteg från slutet tar bort bindestrecket när siffrorna efter det tar slut", () => {
    let value = PAHITTAT;
    value = backsteg(value);
    value = backsteg(value);
    value = backsteg(value);
    assert.equal(value, "19991231-9");
    value = backsteg(value);
    assert.equal(value, "19991231");
    value = backsteg(value);
    assert.equal(value, "1999123");
  });

  it("inklistrat nummer landar formaterat, med eller utan bindestreck och mellanslag", () => {
    assert.equal(personnummerInputChange("", "199912319999"), PAHITTAT);
    assert.equal(personnummerInputChange("", PAHITTAT), PAHITTAT);
    assert.equal(personnummerInputChange("", " 19991231 9999 "), PAHITTAT);
    assert.equal(personnummerInputChange("", "991231 9999"), "991231-9999");
  });

  it("tomt fält blir tomt och siffror blockeras aldrig", () => {
    assert.equal(personnummerInputChange("1999", ""), "");
    assert.equal(personnummerInputChange(PAHITTAT, `${PAHITTAT}a`), PAHITTAT);
    assert.equal(personnummerInputChange(PAHITTAT, `${PAHITTAT}7`), PAHITTAT);
  });

  it("visar samma sak som formatPersonnummer och rör inte maskningen", () => {
    assert.equal(personnummerInputChange("", "199912319999"), formatPersonnummer("199912319999"));
    assert.equal(maskPersonnummer(PAHITTAT), "1999••••-9999");
    assert.equal(maskPersonnummer("991231-9999"), "99••••-9999");
  });
});

describe("personnummerfält i gränssnittet", () => {
  it("ROT/RUT-fälten formaterar vid ändring och behåller maskningen", () => {
    const src = source("src/components/tax-reduction-fields.tsx");
    assert.match(src, /personalIdentityNumber: personnummerInputChange\(/);
    assert.match(src, /maskPersonnummer\(value\.personalIdentityNumber\)/);
  });

  it("ROT/RUT-blocket på kunden formaterar vid ändring - inte identiteten eller ny kund", () => {
    // Personnummer hör till ROT/RUT, inte till kundens identitetsfält.
    assert.match(source("src/components/customer-rot-section.tsx"), /personnummerInputChange\(/);
    assert.match(source("src/components/customer-rot-section.tsx"), /id="kund-personnummer"/);
    assert.doesNotMatch(source("src/components/customer-details-form.tsx"), /personnummerInputChange/);
    assert.doesNotMatch(source("src/components/new-customer-modal.tsx"), /personnummerInputChange/);
    assert.doesNotMatch(source("src/components/new-customer-modal.tsx"), /ny-kund-personnummer/);
  });

  it("anställdfältet under Lön formaterar vid ändring", () => {
    assert.match(source("src/components/lon-widgets.tsx"), /setPersonnummer\(personnummerInputChange\(/);
  });
});
