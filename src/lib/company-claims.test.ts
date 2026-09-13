process.env.DRIVA_TEST = "1";

/**
 * Sanna standardtexter (spec §8): Ferva påstår aldrig F-skatt eller
 * försäkring åt ett företag. Påståenden dyker bara upp när företaget själv
 * verifierat dem – och försvinner när verifieringen saknas eller gått ut.
 */

import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { db, replaceDb } from "./store";
import { emptyTestDb, labor, testCompany, testCustomer } from "./invoices/test-db";
import {
  claimSentences,
  claimSummary,
  fSkattVerified,
  insuranceStatus,
  normalizeCompanyClaims,
  parseCompanyClaimsInput,
} from "./company-claims";
import {
  isSystemQuoteTerms,
  LEGACY_STANDARD_TERMS,
  resolveQuoteTerms,
  STANDARD_TERMS,
  systemQuoteTerms,
} from "./standard-quote-terms";
import { getInvoiceDefaults, updateCompanyClaims, updateInvoiceDefaults } from "./services/settings";
import { quoteDefaults } from "./services/quotes";
import { sellerAsCompany, sellerSnapshot } from "./invoices/snapshot";
import { DocFooter } from "../components/quote-document";
import { createInvoice, issueInvoice } from "./services/invoices";
import { collectTotalsBlockers } from "./invoices/validate";
import { generateWebsite } from "./services/website";
import type { CompanyClaims } from "./types";

const TODAY = "2026-09-12";
const VERIFIED: CompanyClaims = {
  fSkatt: { confirmedAt: "2026-03-01", source: "Skatteverkets registerutdrag" },
  liabilityInsurance: { insurer: "Länsförsäkringar", validUntil: "2027-06-30", confirmedAt: "2026-03-01" },
};

function reset(over: Parameters<typeof emptyTestDb>[0] = {}) {
  replaceDb(emptyTestDb(over));
}

describe("Verifierade företagsuppgifter", () => {
  it("utan verifiering påstås ingenting", () => {
    assert.equal(fSkattVerified(undefined), false);
    assert.equal(fSkattVerified({ claims: undefined }), false);
    assert.equal(insuranceStatus({ claims: undefined }, TODAY), "saknas");
    assert.deepEqual(claimSentences({ claims: undefined }, TODAY), []);
    assert.equal(claimSummary({ claims: undefined }, TODAY), "");
  });

  it("aktuell verifiering ger exakt de påståenden som är sanna", () => {
    assert.equal(fSkattVerified({ claims: VERIFIED }), true);
    assert.equal(insuranceStatus({ claims: VERIFIED }, TODAY), "giltig");
    assert.deepEqual(claimSentences({ claims: VERIFIED }, TODAY), [
      "Vi är godkända för F-skatt.",
      "Vi har ansvarsförsäkring hos Länsförsäkringar.",
    ]);
    assert.equal(claimSummary({ claims: VERIFIED }, TODAY), "F-skatt och ansvarsförsäkring");
  });

  it("utgången försäkring tar bort påståendet – utan att röra F-skatten", () => {
    const claims = { claims: { ...VERIFIED, liabilityInsurance: { ...VERIFIED.liabilityInsurance!, validUntil: "2026-09-11" } } };
    assert.equal(insuranceStatus(claims, TODAY), "utgangen");
    assert.deepEqual(claimSentences(claims, TODAY), ["Vi är godkända för F-skatt."]);
    // Sista giltighetsdagen räknas fortfarande.
    assert.equal(insuranceStatus(claims, "2026-09-11"), "giltig");
  });

  it("normalisering släpper ofullständiga poster i stället för att gissa", () => {
    assert.equal(normalizeCompanyClaims(null), undefined);
    assert.equal(normalizeCompanyClaims({ fSkatt: { confirmedAt: "igår" } }), undefined);
    assert.equal(normalizeCompanyClaims({ liabilityInsurance: { insurer: "X", validUntil: "2027-01-01" } }), undefined);
    assert.deepEqual(normalizeCompanyClaims({ fSkatt: { confirmedAt: "2026-02-30" } }), undefined);
    assert.deepEqual(normalizeCompanyClaims({ fSkatt: { confirmedAt: "2026-03-01", source: "  " }, extra: 1 }), {
      fSkatt: { confirmedAt: "2026-03-01" },
    });
  });

  it("formulärtolkningen kräver aktiv bekräftelse och rimliga datum", () => {
    const off = parseCompanyClaimsInput(
      { fSkatt: { confirmed: false, confirmedAt: "2026-01-01" }, liabilityInsurance: { confirmed: false, insurer: "X", validUntil: "2027-01-01" } },
      TODAY
    );
    assert.deepEqual(off, { ok: true, claims: undefined });

    const future = parseCompanyClaimsInput(
      { fSkatt: { confirmed: true, confirmedAt: "2026-12-24" }, liabilityInsurance: { confirmed: false } },
      TODAY
    );
    assert.equal(future.ok, false);
    assert.match(!future.ok ? future.errors.join(" ") : "", /framtiden/);

    const expired = parseCompanyClaimsInput(
      { fSkatt: { confirmed: false }, liabilityInsurance: { confirmed: true, insurer: "If", validUntil: "2026-01-01" } },
      TODAY
    );
    assert.equal(expired.ok, false);
    assert.match(!expired.ok ? expired.errors.join(" ") : "", /gått ut/);

    const ok = parseCompanyClaimsInput(
      {
        fSkatt: { confirmed: true, confirmedAt: "", source: " Registerutdrag " },
        liabilityInsurance: { confirmed: true, insurer: " If ", validUntil: "2027-01-01", source: "" },
      },
      TODAY
    );
    assert.deepEqual(ok, {
      ok: true,
      claims: {
        fSkatt: { confirmedAt: TODAY, source: "Registerutdrag" },
        liabilityInsurance: { insurer: "If", validUntil: "2027-01-01", confirmedAt: TODAY },
      },
    });
  });
});

describe("Standardvillkor för offerter", () => {
  beforeEach(() => reset());

  it("systemtexten är neutral och den gamla texten räknas som orörd default", () => {
    assert.doesNotMatch(STANDARD_TERMS, /F-skatt|försäkring/i);
    assert.match(LEGACY_STANDARD_TERMS, /F-skattsedel och full ansvarsförsäkring/);
    assert.equal(isSystemQuoteTerms(LEGACY_STANDARD_TERMS, { claims: undefined }), true);
    assert.equal(isSystemQuoteTerms(`  ${STANDARD_TERMS.replace(/ /g, "  ")} `, { claims: undefined }), true);
    assert.equal(isSystemQuoteTerms("Betalning inom 10 dagar.", { claims: undefined }), false);
  });

  it("systemtexten får bara de påståenden som är verifierade", () => {
    assert.equal(systemQuoteTerms({ claims: undefined }, TODAY), STANDARD_TERMS);
    assert.equal(
      systemQuoteTerms({ claims: VERIFIED }, TODAY),
      `${STANDARD_TERMS} Vi är godkända för F-skatt. Vi har ansvarsförsäkring hos Länsförsäkringar.`
    );
    assert.equal(systemQuoteTerms({ claims: VERIFIED }, "2027-07-01"), `${STANDARD_TERMS} Vi är godkända för F-skatt.`);
  });

  it("företagets egen text skrivs aldrig över", () => {
    const own = "Våra egna villkor. Vi innehar F-skattsedel.";
    assert.equal(resolveQuoteTerms({ claims: undefined, defaultQuoteTerms: own }, TODAY), own);
    assert.equal(resolveQuoteTerms({ claims: VERIFIED, defaultQuoteTerms: own }, TODAY), own);
    // Den gamla systemtexten är ingen egen text – den ersätts av dagens läge.
    assert.equal(resolveQuoteTerms({ claims: undefined, defaultQuoteTerms: LEGACY_STANDARD_TERMS }, TODAY), STANDARD_TERMS);
  });

  it("sparformuläret lagrar aldrig systemtexten som egen text", () => {
    const base = getInvoiceDefaults();
    updateInvoiceDefaults({ ...base, defaultQuoteTerms: LEGACY_STANDARD_TERMS });
    assert.equal(db().settings.defaultQuoteTerms, undefined);
    updateInvoiceDefaults({ ...base, defaultQuoteTerms: STANDARD_TERMS });
    assert.equal(db().settings.defaultQuoteTerms, undefined);
    updateInvoiceDefaults({ ...base, defaultQuoteTerms: "Egna villkor." });
    assert.equal(db().settings.defaultQuoteTerms, "Egna villkor.");
  });

  it("nya offerter följer företagets verifieringar", () => {
    assert.equal(quoteDefaults().terms, STANDARD_TERMS);
    updateCompanyClaims({
      fSkatt: { confirmed: true },
      liabilityInsurance: { confirmed: true, insurer: "Trygg-Hansa", validUntil: "2999-12-31" },
    });
    assert.match(quoteDefaults().terms, /Vi är godkända för F-skatt\. Vi har ansvarsförsäkring hos Trygg-Hansa\./);
    updateCompanyClaims({ fSkatt: { confirmed: false }, liabilityInsurance: { confirmed: false } });
    assert.equal(db().settings.claims, undefined);
    assert.equal(quoteDefaults().terms, STANDARD_TERMS);
  });

  it("ogiltig bekräftelse avvisas med tydligt fel", () => {
    assert.throws(
      () => updateCompanyClaims({ fSkatt: { confirmed: false }, liabilityInsurance: { confirmed: true, insurer: "", validUntil: "2999-12-31" } }),
      /försäkringsbolaget/
    );
  });
});

describe("”Godkänd för F-skatt” på dokument", () => {
  beforeEach(() => reset());

  it("fryses i säljarsnapshoten bara när det är verifierat", () => {
    assert.equal(sellerSnapshot(testCompany()).fSkattConfirmedAt, undefined);
    const snap = sellerSnapshot(testCompany({ claims: VERIFIED }));
    assert.equal(snap.fSkattConfirmedAt, "2026-03-01");
    assert.equal(fSkattVerified(sellerAsCompany(snap)), true);
    assert.equal(fSkattVerified(sellerAsCompany(sellerSnapshot(testCompany()))), false);
    // Äldre snapshot utan flaggan: påståendet visas inte även om företaget verifierat i dag.
    assert.equal(fSkattVerified(sellerAsCompany(sellerSnapshot(testCompany()), testCompany({ claims: VERIFIED }))), false);
  });

  it("offertens sidfot visar raden bara med verifiering", () => {
    const without = renderToStaticMarkup(createElement(DocFooter, { company: testCompany() }));
    assert.doesNotMatch(without, /F-skatt/);
    const withClaim = renderToStaticMarkup(createElement(DocFooter, { company: testCompany({ claims: VERIFIED }) }));
    assert.match(withClaim, /Godkänd för F-skatt/);
  });
});

describe("Nollkronorsfaktura", () => {
  beforeEach(() => reset({ customers: [testCustomer()] }));

  it("kan varken utfärdas eller skickas", () => {
    const inv = createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({ unitPrice: 0 })], rot: null });
    const codes = collectTotalsBlockers(inv).map((b) => b.code);
    assert.ok(codes.includes("zero_total"));
    assert.throws(() => issueInvoice(inv.id), /0 kr/);
  });

  it("kreditfaktura och vanlig faktura med belopp blockeras inte", () => {
    const ok = createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor()], rot: null });
    assert.equal(collectTotalsBlockers(ok).some((b) => b.code === "zero_total"), false);
    const credit = createInvoice({ customerId: "cust-1", type: "kredit", lines: [labor({ unitPrice: 0 })], rot: null });
    assert.equal(collectTotalsBlockers(credit).some((b) => b.code === "zero_total"), false);
  });
});

describe("Hemsidegeneratorn", () => {
  it("nämner F-skatt/försäkring bara när företaget verifierat det", () => {
    reset();
    const plain = generateWebsite("Snickeri i Uppsala");
    const about = plain.sections.find((s) => s.type === "text")!.body;
    assert.doesNotMatch(about, /F-skatt|försäkr/i);

    reset({ settings: testCompany({ claims: VERIFIED }) });
    const verified = generateWebsite("Snickeri i Uppsala");
    assert.match(verified.sections.find((s) => s.type === "text")!.body, /Vi har F-skatt och ansvarsförsäkring\./);

    reset({ settings: testCompany({ claims: { fSkatt: VERIFIED.fSkatt } }) });
    const onlyFskatt = generateWebsite("Städfirma i Malmö – städ");
    const body = onlyFskatt.sections.find((s) => s.type === "text")!.body;
    assert.match(body, /Vi har F-skatt\./);
    assert.doesNotMatch(body, /försäkr/i);
  });
});
