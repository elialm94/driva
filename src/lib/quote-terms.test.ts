process.env.DRIVA_TEST = "1";

/**
 * Enade offertvillkor: företagets terms och ROT/RUT-snapshot är skilda fält
 * men en kundfacing Villkor-sektion. Inställningens default kopieras bara
 * till nya offerter.
 */

import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { replaceDb, db } from "./store";
import { emptyTestDb, labor, rotReadyCustomer, testCompany } from "./invoices/test-db";
import { createQuote, quoteDefaults, sendQuote, STANDARD_TERMS, updateQuote } from "./services/quotes";
import { currentVersion } from "./services/data";
import { getInvoiceDefaults, updateInvoiceDefaults } from "./services/settings";
import {
  getTaxReductionTerms,
  isCustomTaxReductionTerms,
  nextTaxReductionTerms,
  snapshotTaxReductionTerms,
} from "./tax-reduction-terms";
import { QuoteDocument } from "../components/quote-document";
import { DEFAULT_QUOTE_TERMS_MAX } from "./standard-quote-terms";
import { settingsDefaultsFieldErrors } from "./settings-validation";

function reset(over: Parameters<typeof emptyTestDb>[0] = {}) {
  replaceDb(emptyTestDb(over));
}

function plainQuoteInput(over: Partial<Parameters<typeof createQuote>[0]> = {}) {
  const defaults = quoteDefaults();
  return {
    customerId: "cust-1",
    title: "Altan",
    lines: [labor({ description: "Snickeriarbete-RADTEST", unitPrice: 8000 })],
    rot: null,
    paymentPlan: [{ label: "Allt", percent: 100 }],
    paymentTermsDays: defaults.paymentTermsDays,
    validUntil: defaults.validUntil,
    terms: defaults.terms,
    ...over,
  };
}

function renderQuote(quoteId: string) {
  const quote = db().quotes.find((q) => q.id === quoteId)!;
  return renderToStaticMarkup(
    createElement(QuoteDocument, {
      company: db().settings,
      customer: db().customers[0],
      quote,
      version: currentVersion(quote),
    })
  );
}

describe("nextTaxReductionTerms", () => {
  const standard = snapshotTaxReductionTerms("rot");
  const custom = {
    ...standard,
    heading: "ROT/RUT-avdrag",
    body: "Egen ROT-text som kunden ska se.",
    text: "ROT/RUT-avdrag\nEgen ROT-text som kunden ska se.",
  };

  it("ROT av: behåller tidigare snapshot", () => {
    assert.deepEqual(nextTaxReductionTerms({ rot: null, previous: custom }), custom);
    assert.equal(nextTaxReductionTerms({ rot: null, previous: null }), null);
  });

  it("första ROT-val utan previous snapshotar standard", () => {
    assert.deepEqual(nextTaxReductionTerms({ rot: { type: "rot" }, previous: null }), standard);
  });

  it("insänd heading/body från editorn sparas", () => {
    const next = nextTaxReductionTerms({
      rot: { type: "rot" },
      previous: standard,
      submitted: { heading: "ROT/RUT-avdrag", body: "Kundanpassad text." },
    });
    assert.equal(next?.body, "Kundanpassad text.");
    assert.equal(next?.type, "rot");
    assert.equal(next?.text, "ROT/RUT-avdrag\nKundanpassad text.");
    assert.equal(isCustomTaxReductionTerms(next, "rot"), true);
  });

  it("Återställ standardtext ersätter snapshoten", () => {
    const next = nextTaxReductionTerms({
      rot: { type: "rot" },
      previous: custom,
      resetToStandard: true,
    });
    assert.deepEqual(next, standard);
    assert.equal(isCustomTaxReductionTerms(next, "rot"), false);
  });

  it("ROT↔RUT med identisk text behåller anpassad brödtext och byter typ", () => {
    const next = nextTaxReductionTerms({
      rot: { type: "rut" },
      previous: custom,
    });
    assert.equal(next?.type, "rut");
    assert.equal(next?.body, custom.body);
  });

  it("ROT↔RUT utan anpassning tar ny typs standard (samma text idag)", () => {
    const next = nextTaxReductionTerms({
      rot: { type: "rut" },
      previous: snapshotTaxReductionTerms("rot"),
    });
    assert.deepEqual(next, snapshotTaxReductionTerms("rut"));
  });
});

describe("quoteDefaults snapshot-isolering", () => {
  beforeEach(() => reset());

  it("CASE A: inställningens default förifylls, dokumentet har ingen ROT-text", () => {
    assert.equal(quoteDefaults().terms, STANDARD_TERMS);
    const quote = createQuote(plainQuoteInput());
    const version = currentVersion(quote);
    assert.equal(version.terms, STANDARD_TERMS);
    assert.equal(version.rot, null);
    const html = renderQuote(quote.id);
    assert.match(html, /Villkor/i);
    assert.ok(html.includes(STANDARD_TERMS));
    assert.equal(html.includes("ROT/RUT-avdrag"), false);
    assert.equal(html.includes("Skatteverket"), false);
  });

  it("CASE B: ROT ger VILLKOR + ROT/RUT-avdrag som underrubrik, inte eget kort", () => {
    const quote = createQuote(plainQuoteInput({ rot: { type: "rot" } }));
    const version = currentVersion(quote);
    assert.equal(version.terms, STANDARD_TERMS);
    assert.equal(version.taxReductionTerms?.body, getTaxReductionTerms("rot").body);
    const html = renderQuote(quote.id);
    const villkor = html.indexOf("Villkor");
    const heading = html.indexOf("ROT/RUT-avdrag");
    const body = html.indexOf("Skatteverket");
    assert.ok(villkor !== -1 && heading !== -1 && body !== -1);
    assert.ok(villkor < heading && heading < body);
    assert.equal(html.includes("rounded-xl border border-line bg-canvas/50"), false);
  });

  it("CASE C: anpassad ROT-text överlever save/reload", () => {
    const quote = createQuote(
      plainQuoteInput({
        rot: { type: "rot" },
        taxReductionTerms: { body: "Egen sparad ROT-text." },
      })
    );
    const created = currentVersion(quote);
    assert.equal(created.taxReductionTerms?.body, "Egen sparad ROT-text.");

    updateQuote(quote.id, {
      title: created.title,
      lines: created.lines,
      rot: created.rot,
      paymentPlan: created.paymentPlan,
      paymentTermsDays: created.paymentTermsDays,
      lateInterestRate: created.lateInterestRate,
      validUntil: created.validUntil,
      terms: created.terms,
      taxReductionTerms: { heading: created.taxReductionTerms?.heading, body: "Egen sparad ROT-text." },
    });
    replaceDb(structuredClone(db()));
    const reloaded = currentVersion(db().quotes[0]);
    assert.equal(reloaded.taxReductionTerms?.body, "Egen sparad ROT-text.");
    assert.ok(renderQuote(db().quotes[0].id).includes("Egen sparad ROT-text."));
  });

  it("CASE D: ändrad inställning rör inte gamla offerter, ny offert får ny default", () => {
    const old = createQuote(plainQuoteInput({ terms: quoteDefaults().terms }));
    assert.equal(currentVersion(old).terms, STANDARD_TERMS);

    updateInvoiceDefaults({ ...getInvoiceDefaults(), defaultQuoteTerms: "Nya standardvillkor från inställningar." });
    assert.equal(quoteDefaults().terms, "Nya standardvillkor från inställningar.");
    assert.equal(currentVersion(old).terms, STANDARD_TERMS);

    const next = createQuote(plainQuoteInput({ terms: quoteDefaults().terms }));
    assert.equal(currentVersion(next).terms, "Nya standardvillkor från inställningar.");
    assert.equal(currentVersion(old).terms, STANDARD_TERMS);
  });

  it("CASE E: PDF använder samma QuoteDocument – båda villkorstexterna syns", () => {
    const quote = createQuote(
      plainQuoteInput({
        rot: { type: "rot" },
        taxReductionTerms: { body: "PDF-synlig ROT-text." },
      })
    );
    const html = renderQuote(quote.id);
    assert.ok(html.includes(STANDARD_TERMS));
    assert.ok(html.includes("ROT/RUT-avdrag"));
    assert.ok(html.includes("PDF-synlig ROT-text."));
    assert.match(html, /Villkor/i);
  });

  it("tom defaultQuoteTerms faller tillbaka till STANDARD_TERMS", () => {
    replaceDb(emptyTestDb({ settings: testCompany({ defaultQuoteTerms: "   " }) }));
    assert.equal(quoteDefaults().terms, STANDARD_TERMS);
    replaceDb(emptyTestDb({ settings: testCompany({ defaultQuoteTerms: undefined }) }));
    db().settings.defaultQuoteTerms = undefined;
    assert.equal(quoteDefaults().terms, STANDARD_TERMS);
  });

  it("sendQuote skriver inte över en befintlig snapshot", () => {
    replaceDb(emptyTestDb({ customers: [rotReadyCustomer()] }));
    const quote = createQuote(
      plainQuoteInput({
        rot: { type: "rot" },
        workLocationId: "loc-1",
        taxReductionTerms: { body: "Ska överleva utskick." },
      })
    );
    sendQuote(quote.id);
    assert.equal(currentVersion(quote).taxReductionTerms?.body, "Ska överleva utskick.");
  });

  it("ROT av i utkast rensar inte snapshoten", () => {
    const quote = createQuote(
      plainQuoteInput({
        rot: { type: "rot" },
        taxReductionTerms: { body: "Behålls i utkast." },
      })
    );
    const created = currentVersion(quote);
    updateQuote(quote.id, {
      title: created.title,
      lines: created.lines,
      rot: null,
      paymentPlan: created.paymentPlan,
      paymentTermsDays: created.paymentTermsDays,
      lateInterestRate: created.lateInterestRate,
      validUntil: created.validUntil,
      terms: created.terms,
    });
    const v = currentVersion(quote);
    assert.equal(v.rot, null);
    assert.equal(v.taxReductionTerms?.body, "Behålls i utkast.");
    assert.equal(renderQuote(quote.id).includes("Behålls i utkast."), false);
  });
});

describe("hydrateTaxReductionTerms", () => {
  it("backfyller olåst ROT utan snapshot, rensar inte när ROT är av, rör inte låsta", () => {
    const draftRot = {
      id: "qv-draft-rot",
      quoteId: "q-draft-rot",
      version: 1,
      title: "Draft ROT",
      lines: [labor()],
      rot: { type: "rot" as const },
      paymentPlan: [],
      paymentTermsDays: 30,
      validUntil: "2099-01-01",
      terms: STANDARD_TERMS,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const draftOff = {
      ...draftRot,
      id: "qv-draft-off",
      quoteId: "q-draft-off",
      title: "Draft av",
      rot: null,
      taxReductionTerms: snapshotTaxReductionTerms("rot"),
    };
    const locked = {
      ...draftRot,
      id: "qv-locked",
      quoteId: "q-locked",
      title: "Låst",
      lockedAt: "2026-01-02T00:00:00.000Z",
      contentHash: "abc",
      rot: { type: "rot" as const },
    };
    replaceDb(
      emptyTestDb({
        quoteVersions: [draftRot, draftOff, locked],
      })
    );
    const versions = db().quoteVersions;
    assert.ok(versions.find((v) => v.id === "qv-draft-rot")?.taxReductionTerms);
    assert.equal(versions.find((v) => v.id === "qv-draft-off")?.taxReductionTerms?.body, getTaxReductionTerms("rot").body);
    assert.equal(versions.find((v) => v.id === "qv-locked")?.taxReductionTerms, undefined);
  });
});

describe("settings-validering defaultQuoteTerms", () => {
  it("tomt är tillåtet, för lång text är det inte", () => {
    const ok = settingsDefaultsFieldErrors({
      paymentTermsDays: 30,
      lateInterestRate: 10,
      quoteValidityDays: 30,
      defaultVatRate: 25,
      defaultQuoteTerms: "",
    });
    assert.equal(ok.length, 0);
    const tooLong = settingsDefaultsFieldErrors({
      paymentTermsDays: 30,
      lateInterestRate: 10,
      quoteValidityDays: 30,
      defaultVatRate: 25,
      defaultQuoteTerms: "x".repeat(DEFAULT_QUOTE_TERMS_MAX + 1),
    });
    assert.equal(tooLong[0]?.field, "defaultQuoteTerms");
  });
});
