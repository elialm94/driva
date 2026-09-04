process.env.DRIVA_TEST = "1";

/**
 * Intyg om godkännande: samma sparade fält, presentation som ett
 * tvistunderlag – inte en adminpanel med hashar först.
 */

import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { db, replaceDb } from "./store";
import { emptyTestDb, labor, rotReadyCustomer } from "./invoices/test-db";
import { createQuote, quoteDefaults, sendQuote } from "./services/quotes";
import { getQuote, quoteAcceptance } from "./services/data";
import { acceptQuote } from "./services/quote-accept";
import {
  CERTIFICATE_TITLE,
  SIMPLE_SIGNATURE_DISCLAIMER,
  buildAcceptanceCertificate,
  getAcceptanceCertificateByToken,
} from "./quote-acceptance-certificate";
import { AcceptanceCertificate } from "../components/acceptance-certificate";

beforeEach(() => {
  replaceDb(emptyTestDb({ customers: [rotReadyCustomer({ email: "anna@test.se" })] }));
});

function acceptedQuote() {
  const defaults = quoteDefaults();
  const quote = createQuote({
    customerId: "cust-1",
    title: "Altanbygge",
    lines: [labor({ unitPrice: 40_000 })],
    rot: null,
    paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
    paymentTermsDays: defaults.paymentTermsDays,
    validUntil: defaults.validUntil,
    terms: "Standardvillkor",
  });
  sendQuote(quote.id, { mode: "live", ok: true, messageId: "m-1", sentTo: "anna@test.se" });
  acceptQuote({ token: getQuote(quote.id)!.token, name: "Anna Andersson" });
  return getQuote(quote.id)!;
}

function versionOf(quoteId: string) {
  return db().quoteVersions.find((v) => v.quoteId === quoteId)!;
}

function indexOf(html: string, needle: string): number {
  const i = html.indexOf(needle);
  assert.ok(i >= 0, `saknas: ${needle}`);
  return i;
}

describe("intyg om godkännande", () => {
  it("sammanfattning och faktatabell leder med vem/vad – inte hashar", () => {
    const quote = acceptedQuote();
    const acceptance = quoteAcceptance(quote.id)!;
    const cert = getAcceptanceCertificateByToken(quote.token)!;
    assert.equal(cert.acceptedByName, "Anna Andersson");
    assert.equal(cert.customerName, "Anna Andersson");
    assert.match(cert.summary, /Anna Andersson godkände offert #\d+ “Altanbygge” från Test Snickeri AB/);
    assert.match(cert.summary, /skrev sitt namn och tryckte Godkänn offert/);
    assert.doesNotMatch(cert.summary, /SHA-256|hash/i);
    assert.doesNotMatch(cert.summary, /BankID|e-legitimation/i);
    assert.deepEqual(
      cert.facts.map((f) => f.label),
      ["Avsändare", "Kund", "Godkänd av", "Tidpunkt", "Offert", "Belopp"]
    );
    assert.match(cert.facts[0].value, /Test Snickeri AB/);
    assert.match(cert.statusText, /Dokumentet är oförändrat/);
    assert.equal(cert.statement, acceptance.statement);
    assert.equal(cert.storedHash, acceptance.contentHash);
    assert.doesNotMatch(cert.methodText, /BankID/);
  });

  it("ändrat dokument får vanlig svenska – inte hash mismatch", () => {
    const quote = acceptedQuote();
    const acceptance = { ...quoteAcceptance(quote.id)!, contentHash: "inte-samma" };
    const cert = buildAcceptanceCertificate({
      quote,
      version: versionOf(quote.id),
      acceptance,
    });
    assert.match(cert.statusText, /Dokumentet har ändrats/);
    assert.doesNotMatch(cert.statusText, /hash|SHA/i);
    assert.equal(cert.intact, false);
  });

  it("webmarkup: titel, fakta före hash, hopfälld teknisk kontroll", () => {
    const quote = acceptedQuote();
    const cert = getAcceptanceCertificateByToken(quote.token)!;
    const html = renderToStaticMarkup(createElement(AcceptanceCertificate, { cert, variant: "web" }));
    assert.ok(html.includes(CERTIFICATE_TITLE));
    assert.ok(html.includes("Det kunden såg"));
    assert.ok(html.includes(cert.statement));
    assert.ok(html.includes(SIMPLE_SIGNATURE_DISCLAIMER));
    assert.ok(html.includes("<details"));
    assert.ok(html.includes("Teknisk kontroll"));
    assert.ok(!/\<details[^>]*\sopen/.test(html));
    assert.ok(indexOf(html, "Avsändare") < indexOf(html, "SHA-256"));
    assert.ok(indexOf(html, CERTIFICATE_TITLE) < indexOf(html, "SHA-256"));
    assert.doesNotMatch(html, /BankID|Ställ en fråga/);
    assert.doesNotMatch(html, /Godkänd offert/);
  });

  it("PDF: samma fakta, hashar bara i sidfot, ingen app-chrome", () => {
    const quote = acceptedQuote();
    const cert = getAcceptanceCertificateByToken(quote.token)!;
    const html = renderToStaticMarkup(createElement(AcceptanceCertificate, { cert, variant: "pdf" }));
    assert.ok(html.includes(CERTIFICATE_TITLE));
    assert.ok(html.includes("data-acceptance-certificate-pdf"));
    assert.ok(html.includes("Avsändare"));
    assert.ok(html.includes("Det kunden såg"));
    assert.ok(html.includes(SIMPLE_SIGNATURE_DISCLAIMER));
    assert.ok(!html.includes("<details"));
    assert.ok(html.includes("<footer"));
    assert.ok(indexOf(html, "Avsändare") < indexOf(html, "SHA-256"));
    assert.ok(indexOf(html, "Dokumentet är oförändrat") < indexOf(html, cert.storedHash));
    assert.doesNotMatch(html, /Skriv ut|Driva|Ställ en fråga|BankID/);
  });
});
