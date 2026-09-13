process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  TaxReductionAmountPanel,
  TaxReductionFields,
  type TaxReductionFormValue,
} from "../components/tax-reduction-fields";
import { currentMonthPeriod } from "./tax-reduction-gaps";
import { todayDate } from "./accounting/dates";

function render(type: "rot" | "rut", over: Partial<TaxReductionFormValue> = {}): string {
  const value: TaxReductionFormValue = {
    personalIdentityNumber: "19850515-1234",
    workAddress: "Folkungagatan 1, Stockholm",
    workPeriodStart: "2026-08-12",
    workPeriodEnd: "2026-08-19",
    workPeriodSource: "job",
    housing: { dwellingType: "smahus", propertyDesignation: "Eken 1:23" },
    ...over,
  };
  return renderToStaticMarkup(
    createElement(TaxReductionFields, {
      type,
      value,
      onChange: () => {},
    })
  );
}

/**
 * Personnummer och arbetsperiod bor här. Fastighet ägs av Bostad-väljaren.
 */
describe("ROT-editorn börjar sammanfattad", () => {
  it("personnummer och arbetsperiod, ingen andra bostadsrad", () => {
    const html = render("rot");
    assert.match(html, /Personnummer 1985••••-1234/);
    assert.match(html, /Arbetsperiod: 12–19 augusti 2026/);
    assert.doesNotMatch(html, /Bostadstyp Fastighet/);
    assert.equal(html.includes('id="rot-arbetsperiod"'), false, "inga öppna datumfält");
    assert.equal(html.includes('id="rot-bostadstyp"'), false, "ingen öppen bostadstypsväljare");
    assert.equal(/uppgift(er)? saknas/.test(html), false);
    assert.match(html, /Alla uppgifter finns/);
    assert.equal((html.match(/Ändra/g) ?? []).length, 2, "två Ändra-knappar: personnummer och period");
  });

  it("fastighet redigeras inte här - Bostad-väljaren är ensam ägare", () => {
    const html = render("rot", { housing: { dwellingType: "smahus" } });
    assert.equal(html.includes("Fastighetsbeteckning"), false);
    assert.equal(html.includes("Bostadstyp"), false);
    assert.equal(/uppgift(er)? saknas/.test(html), false);
  });

  it("en härledd period utan uppdragsdatum visas som aktuell månad, inte som lucka", () => {
    const month = currentMonthPeriod(todayDate());
    const html = render("rot", {
      workPeriodStart: month.start,
      workPeriodEnd: month.end,
      workPeriodSource: "derived",
    });
    assert.equal(html.includes('id="rot-arbetsperiod"'), false);
    assert.match(html, /Arbetsperiod: /);
    assert.equal(/uppgift(er)? saknas/.test(html), false);
  });

  it("RUT frågar varken om bostad eller fastighetsbeteckning", () => {
    const html = render("rut", { housing: {} });
    assert.equal(html.includes("Fastighetsbeteckning"), false);
    assert.equal(html.includes("Bostadstyp"), false);
    assert.equal(/uppgift(er)? saknas/.test(html), false);
    assert.match(html, /Alla uppgifter finns/);
  });

  it("saknat personnummer är fortfarande ett öppet fält, annars går luckan inte att fylla", () => {
    const html = render("rot", { personalIdentityNumber: "" });
    assert.match(html, /id="rot-personnummer"/);
    assert.match(html, /1 uppgift saknas för ROT-ansökan/);
    assert.match(html, />Personnummer<\/button>/);
  });
});

function renderAmount(over: { applied?: number; manuallyAdjusted?: boolean } = {}): string {
  return renderToStaticMarkup(
    createElement(TaxReductionAmountPanel, {
      type: "rot",
      documentKind: "faktura",
      laborInclVat: 100_000,
      calculated: 30_000,
      applied: over.applied ?? 30_000,
      toPay: 70_000,
      manuallyAdjusted: over.manuallyAdjusted ?? false,
      onApply: () => {},
      onUseMax: () => {},
    })
  );
}

describe("Preliminärt avdrag har en Ändra", () => {
  it("beloppet är inte en extra länk, Ändra öppnar fältet, Använd max finns kvar", () => {
    const html = renderAmount();
    assert.match(html, /Preliminärt ROT-avdrag/);
    assert.equal((html.match(/Ändra/g) ?? []).length, 1);
    const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
    assert.equal(buttons.length, 1, "bara Ändra, inte beloppstexten");
    assert.match(buttons[0]!, />Ändra</);
    assert.doesNotMatch(buttons[0]!, /30[\s\u00a0]?000/);
    assert.match(html, /−30[\s\u00a0]000\s*kr/);
    assert.doesNotMatch(html, /ROT-avdrag att använda/);

    const lowered = renderAmount({ applied: 2_000, manuallyAdjusted: true });
    assert.match(lowered, /Använd max/);
    assert.equal((lowered.match(/Ändra/g) ?? []).length, 1);
    const loweredButtons = lowered.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
    assert.equal(loweredButtons.length, 2, "Ändra plus Använd max");
    assert.match(loweredButtons[0]!, />Ändra</);
    assert.match(loweredButtons[1]!, />Använd max</);
  });
});
