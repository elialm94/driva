process.env.DRIVA_TEST = "1";

/**
 * demoSeedFor: exempeldatat anpassat till EN isolerad demosession.
 *
 * Entiteters id är globala primärnycklar och offert-/fakturatokens är globalt
 * unika i databasen – två samtidiga sessioner får därför aldrig dela någon av
 * dem. Själva DB-vägarna (provisionering, RLS, städning) verifieras i
 * scripts/adapter-validate.ts mot PGlite; här testas den rena transformen.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSeed } from "./seed";
import { demoSeedFor } from "./storage/demo-reset";
import { quoteVersionHash } from "./hash";
import type { DB } from "./types";

const BIZ_A = "aaaaaaaa-1111-4111-8111-aaaaaaaa1111";
const BIZ_B = "bbbbbbbb-2222-4222-8222-bbbbbbbb2222";

function idsOf(state: DB): Set<string> {
  return new Set(
    [
      ...state.customers,
      ...state.quotes,
      ...state.quoteVersions,
      ...state.jobs,
      ...state.invoices,
      ...state.verifications,
      ...state.expenses,
      ...state.receipts,
      ...state.reminders,
    ].map((e) => e.id)
  );
}

describe("demoSeedFor – isolerade sessioner ur samma canonical seed", () => {
  it("två sessioner delar varken id-rymd, tokens eller sajtslug", () => {
    const a = demoSeedFor(BIZ_A);
    const b = demoSeedFor(BIZ_B);

    const aIds = idsOf(a);
    for (const id of idsOf(b)) {
      assert.equal(aIds.has(id), false, `id ${id} delas mellan sessionerna`);
    }

    const aTokens = new Set([...a.quotes, ...a.invoices].map((d) => d.token));
    for (const doc of [...b.quotes, ...b.invoices]) {
      assert.equal(aTokens.has(doc.token), false, `token ${doc.token} delas mellan sessionerna`);
    }

    assert.ok(a.website && b.website);
    assert.notEqual(a.website.slug, b.website.slug);
    assert.notEqual(a.settings.inboundMailSlug, b.settings.inboundMailSlug);
  });

  it("tokens slumpas om även mot canonical-seedens ursprungsvärden", () => {
    const canonicalTokens = new Set([...buildSeed().quotes, ...buildSeed().invoices].map((d) => d.token));
    const session = demoSeedFor(BIZ_A);
    for (const doc of [...session.quotes, ...session.invoices]) {
      assert.equal(canonicalTokens.has(doc.token), false, `token ${doc.token} återanvänder seedens`);
    }
  });

  it("interna referenser förblir konsistenta efter remappningen", () => {
    const session = demoSeedFor(BIZ_A);
    const customerIds = new Set(session.customers.map((c) => c.id));
    const jobIds = new Set(session.jobs.map((j) => j.id));
    const quoteIds = new Set(session.quotes.map((q) => q.id));

    for (const quote of session.quotes) {
      assert.ok(customerIds.has(quote.customerId), `offert ${quote.id} pekar på okänd kund`);
      if (quote.jobId) assert.ok(jobIds.has(quote.jobId), `offert ${quote.id} pekar på okänt uppdrag`);
    }
    for (const invoice of session.invoices) {
      assert.ok(customerIds.has(invoice.customerId), `faktura ${invoice.id} pekar på okänd kund`);
      if (invoice.jobId) assert.ok(jobIds.has(invoice.jobId), `faktura ${invoice.id} pekar på okänt uppdrag`);
      if (invoice.quoteId) assert.ok(quoteIds.has(invoice.quoteId), `faktura ${invoice.id} pekar på okänd offert`);
    }
    for (const version of session.quoteVersions) {
      assert.ok(quoteIds.has(version.quoteId), `offertversion ${version.id} pekar på okänd offert`);
    }
  });

  it("utfärdade fakturor hydreras med sin juridiska snapshot (import-RPC:n kräver den)", () => {
    const session = demoSeedFor(BIZ_A);
    const issued = session.invoices.filter((i) => i.status !== "utkast");
    assert.ok(issued.length > 0, "seeden ska innehålla utfärdade fakturor");
    for (const inv of issued) {
      assert.ok(inv.issuedSnapshot, `faktura ${inv.id} saknar issuedSnapshot`);
      assert.equal(inv.issuedSnapshot?.number, inv.number);
      assert.equal(inv.issuedSnapshot?.ocr, inv.ocr);
    }
    // Utkast fryser aldrig något dokument.
    for (const inv of session.invoices.filter((i) => i.status === "utkast")) {
      assert.equal(inv.issuedSnapshot, undefined, `utkast ${inv.id} ska inte ha snapshot`);
    }
  });

  it("BankID-låsta versioner hashar om efter remappningen och beviset följer med", () => {
    const session = demoSeedFor(BIZ_A);
    const locked = session.quoteVersions.filter((v) => v.lockedAt);
    assert.ok(locked.length > 0, "seeden ska innehålla låsta offertversioner");
    for (const version of locked) {
      assert.equal(version.contentHash, quoteVersionHash(version), `versionen ${version.id} hashar fel`);
    }
    assert.ok(session.signatures.length > 0, "seeden ska innehålla signaturer");
    for (const signature of session.signatures) {
      const version = session.quoteVersions.find((v) => v.id === signature.quoteVersionId);
      assert.ok(version, `signaturen ${signature.id} pekar på okänd version`);
      assert.equal(signature.evidence.contentHash, version?.contentHash, "beviskedjan bruten efter remap");
    }
  });

  it("sessionen är canonical-seedens innehåll – inget tappas eller dubbleras", () => {
    const canonical = buildSeed();
    const session = demoSeedFor(BIZ_A);
    assert.equal(session.customers.length, canonical.customers.length);
    assert.equal(session.quotes.length, canonical.quotes.length);
    assert.equal(session.invoices.length, canonical.invoices.length);
    assert.equal(session.jobs.length, canonical.jobs.length);
    assert.equal(session.verifications.length, canonical.verifications.length);
    assert.equal(session.reminders.length, canonical.reminders.length);
  });
});
