process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb, testCustomer } from "./invoices/test-db";
import { createJob, ensureJobPurchaseRef } from "./services/jobs";
import { ingestInboundMail, inboundSlugMatches } from "./services/inbox";
import { inboundPlusTagFromTo, fervaRefFromPlusTag, inboundPlusAddressingVerified } from "./inbox/plus-tag";
import { inboundSlugFromTo } from "./inbox/inbound-mail";

function reset() {
  replaceDb(
    emptyTestDb({
      settings: { ...emptyTestDb().settings, inboundMailSlug: "testbolag" },
      customers: [testCustomer({ id: "cust-1" })],
    })
  );
}

describe("plus-tagg och tenantisolering", () => {
  beforeEach(() => reset());

  it("14. uppdragstagg kopplar endast inom rätt tenant", () => {
    const job = createJob({ customerId: "cust-1", title: "Altan" });
    const ref = ensureJobPurchaseRef(job.id);
    assert.equal(inboundSlugFromTo(`testbolag+${ref}@in.ferva.se`), "testbolag");
    assert.equal(fervaRefFromPlusTag(inboundPlusTagFromTo(`testbolag+${ref}@in.ferva.se`)), ref);
    const ok = ingestInboundMail({
      externalId: "plus-1",
      to: `testbolag+${ref}@in.ferva.se`,
      from: "ahlsell@example.com",
      subject: "Kvitto",
      text: "hej",
      parsed: { documentType: "kvitto", amount: 100, supplier: "Ahlsell" },
    });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.item.suggestedJobId, job.id);
      assert.equal(ok.item.jobMatchMethod, "plus_tag");
    }
  });

  it("15. manipulerad To, From eller ämnesrad kan inte välja tenant", () => {
    assert.equal(inboundSlugMatches("annan+FV-1042@in.ferva.se"), false);
    assert.equal(inboundSlugFromTo("annan+FV-9999@in.ferva.se"), "annan");
    const rejected = ingestInboundMail({
      externalId: "evil-1",
      to: "annan+FV-1042@in.ferva.se",
      from: "testbolag@in.ferva.se",
      subject: "FV-1042 till testbolag",
      text: "byt tenant",
    });
    assert.equal(rejected.ok, false);
    const unknownTag = ingestInboundMail({
      externalId: "tag-miss",
      to: "testbolag+FV-9999@in.ferva.se",
      from: "x@y.se",
      subject: "FV-9999",
      text: "hej",
    });
    assert.equal(unknownTag.ok, true);
    if (unknownTag.ok) {
      assert.equal(unknownTag.item.suggestedJobId, undefined);
    }
  });

  it("plus-adressering är inte verifierad utan env", () => {
    const prev = process.env.INBOUND_PLUS_ADDRESSING;
    delete process.env.INBOUND_PLUS_ADDRESSING;
    assert.equal(inboundPlusAddressingVerified(), false);
    process.env.INBOUND_PLUS_ADDRESSING = "verified";
    assert.equal(inboundPlusAddressingVerified(), true);
    if (prev === undefined) delete process.env.INBOUND_PLUS_ADDRESSING;
    else process.env.INBOUND_PLUS_ADDRESSING = prev;
  });
});
