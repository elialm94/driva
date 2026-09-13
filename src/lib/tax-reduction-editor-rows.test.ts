process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TaxReductionFields, type TaxReductionFormValue } from "../components/tax-reduction-fields";
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
      propertyFieldId: "faktura-fastighet-ny",
    })
  );
}

/**
 * Målbilden: känd kund och uppdrag med datum ger tre sammanfattade rader, noll
 * öppna fält och ingen saknad uppgift.
 */
describe("ROT-editorn börjar sammanfattad", () => {
  it("tre kända rader, inga öppna fält och inga luckor", () => {
    const html = render("rot");
    assert.match(html, /Personnummer 1985••••-1234/);
    assert.match(html, /Arbetsperiod: 12–19 augusti 2026/);
    assert.match(html, /Bostadstyp Fastighet\/småhus - Eken 1:23/);
    assert.equal(html.includes('id="rot-arbetsperiod"'), false, "inga öppna datumfält");
    assert.equal(html.includes('id="rot-bostadstyp"'), false, "ingen öppen bostadstypsväljare");
    assert.equal(/uppgift(er)? saknas/.test(html), false);
    assert.match(html, /Alla uppgifter finns/);
    assert.equal((html.match(/Ändra/g) ?? []).length, 3, "tre Ändra-knappar, en per rad");
  });

  it("fastighetsbeteckningen har ett fält, och det ligger i bostadsblocket", () => {
    const html = render("rot", { housing: { dwellingType: "smahus" } });
    assert.equal(html.includes("Fastighetsbeteckning</label"), false, "inget andra inmatningsfält här");
    // Luckan finns kvar och pekar (via propertyFieldId) på fältet i bostadsblocket.
    assert.match(html, /1 uppgift saknas för ROT-ansökan/);
    assert.match(html, />Fastighetsbeteckning<\/button>/);
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
