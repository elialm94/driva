process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "crypto";
import { resetDemoData } from "./store";
import { db } from "./store";
import {
  inboundMailMode,
  parseInboundPayload,
  verifyInboundSignature,
  inboundSlugFromTo,
  inboundMailAddress,
} from "./inbox/inbound-mail";
import { countInboxBadge, ingestInboundMail, inboundSlugMatches, listInbox } from "./services/inbox";
import { countsTowardInboxBadge } from "./inbox/workflow";

describe("inbound signature", () => {
  it("rejects unsigned and invalid in live mode", () => {
    const prevMode = process.env.INBOUND_MAIL_MODE;
    const prevSecret = process.env.INBOUND_MAIL_WEBHOOK_SECRET;
    process.env.INBOUND_MAIL_MODE = "live";
    process.env.INBOUND_MAIL_WEBHOOK_SECRET = "test-secret";
    try {
      assert.equal(verifyInboundSignature("{}", null), false);
      assert.equal(verifyInboundSignature("{}", ""), false);
      assert.equal(verifyInboundSignature("{}", "sha256=deadbeef"), false);
      const good = createHmac("sha256", "test-secret").update("{}", "utf8").digest("hex");
      assert.equal(verifyInboundSignature("{}", `sha256=${good}`), true);
      assert.equal(verifyInboundSignature("{}", good), true);
    } finally {
      if (prevMode === undefined) delete process.env.INBOUND_MAIL_MODE;
      else process.env.INBOUND_MAIL_MODE = prevMode;
      if (prevSecret === undefined) delete process.env.INBOUND_MAIL_WEBHOOK_SECRET;
      else process.env.INBOUND_MAIL_WEBHOOK_SECRET = prevSecret;
    }
  });

  it("allows unsigned only in mock mode", () => {
    const prevMode = process.env.INBOUND_MAIL_MODE;
    process.env.INBOUND_MAIL_MODE = "mock";
    try {
      assert.equal(inboundMailMode(), "mock");
      assert.equal(verifyInboundSignature("{}", null), true);
    } finally {
      if (prevMode === undefined) delete process.env.INBOUND_MAIL_MODE;
      else process.env.INBOUND_MAIL_MODE = prevMode;
    }
  });
});

describe("tenant from To, never From", () => {
  it("reads local-part and strips plus-tag", () => {
    assert.equal(inboundSlugFromTo("demo@in.ferva.se"), "demo");
    assert.equal(inboundSlugFromTo("Demo+kvitto@in.ferva.se"), "demo");
    assert.equal(inboundSlugFromTo("callesbygg@in.driva.se"), "callesbygg");
    assert.equal(inboundSlugFromTo("Byggmax <faktura@byggmax.se>"), "faktura");
    assert.equal(inboundMailAddress("demo"), `demo@${process.env.INBOUND_MAIL_DOMAIN?.trim() || "in.ferva.se"}`);
  });
});

describe("ingest inbound mail", () => {
  beforeEach(() => {
    resetDemoData();
  });

  it("creates an item from mock payload", () => {
    const before = (db().inboxItems ?? []).length;
    const result = ingestInboundMail({
      externalId: "test-msg-1",
      to: "demo@in.ferva.se",
      from: "faktura@okand.se",
      subject: "Faktura utan belopp",
      text: "Se bilaga.",
      attachments: [{ filename: "faktura.pdf", contentType: "application/pdf", size: 1200 }],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.created, true);
    assert.equal(result.autoBooked, false);
    assert.equal(result.item.status, "ny");
    assert.equal((db().inboxItems ?? []).length, before + 1);
    assert.equal(inboundSlugMatches("andra@in.ferva.se"), false);
  });

  it("second post with same external_id is a no-op", () => {
    const first = ingestInboundMail({
      externalId: "dup-1",
      to: "demo@in.ferva.se",
      from: "a@x.se",
      subject: "Ett",
      text: "hej",
    });
    const count = (db().inboxItems ?? []).length;
    const second = ingestInboundMail({
      externalId: "dup-1",
      to: "demo@in.ferva.se",
      from: "a@x.se",
      subject: "Två",
      text: "igen",
    });
    assert.equal(first.ok && first.created, true);
    assert.equal(second.ok && second.created, false);
    if (second.ok) assert.equal(second.item.subject, "Ett");
    assert.equal((db().inboxItems ?? []).length, count);
  });

  it("rejects unknown inbound slug", () => {
    const result = ingestInboundMail({
      externalId: "other-tenant",
      to: "annan@in.ferva.se",
      from: "a@x.se",
      subject: "Nej",
      text: "fel företag",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 404);
  });

  it("high-confidence path books via existing services without inventing amounts", () => {
    const expensesBefore = db().expenses.length;
    const versBefore = db().verifications.length;
    const result = ingestInboundMail({
      externalId: "auto-bauhaus",
      to: "demo@in.ferva.se",
      from: "faktura@bauhaus.se",
      subject: "Kvitto Bauhaus",
      text: "Tack för köpet.",
      parsed: { amount: 1240, vatAmount: 248, supplier: "Bauhaus", confidence: 0.99 },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.autoBooked, true);
    assert.equal(result.item.status, "bokford");
    assert.equal(result.item.parsedAmount, 1240);
    assert.equal(db().expenses.length, expensesBefore + 1);
    assert.equal(db().verifications.length, versBefore + 1);
    const expense = db().expenses.find((e) => e.id === result.item.expenseId);
    assert.ok(expense);
    assert.equal(expense?.amount, 1240);
    assert.equal(expense?.status, "bokford");
  });

  it("low-confidence stays in inbox and does not invent a booking", () => {
    const expensesBefore = db().expenses.length;
    const result = ingestInboundMail({
      externalId: "low-conf",
      to: "demo@in.ferva.se",
      from: "okand@example.com",
      subject: "Kvitto",
      text: "Något köp",
      parsed: { amount: 500, vatAmount: 100, supplier: "Okänd AB", confidence: 0.5 },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.autoBooked, false);
    assert.equal(result.item.status, "ny");
    assert.equal(db().expenses.length, expensesBefore);
  });

  it("lists economic documents, not inquiries", () => {
    const page = listInbox({ filter: "oppna" });
    assert.ok(!page.rows.some((r) => r.id === "req-karin"));
    assert.ok(page.rows.some((r) => r.id === "inbox-mail-byggmax"));
    assert.ok(!page.rows.some((r) => r.id === "inbox-mail-okq8"));
  });
});

describe("Inbox-räknaren: väntar på användaren", () => {
  beforeEach(() => {
    resetDemoData();
  });

  it("badge = countInboxBadge = countsTowardInboxBadge, inte hela historiken", () => {
    const badge = countInboxBadge();
    const alla = listInbox({ filter: "alla" });
    assert.ok(alla.total >= badge);
    assert.ok(badge >= 0);

    const ny = (db().inboxItems ?? []).find((item) => item.status === "ny");
    assert.ok(ny, "demo har minst en ny inbox-post");
    assert.equal(
      countsTowardInboxBadge({ item: ny }),
      true,
      "ny post som inte är bokförd räknas mot badgen"
    );
    assert.equal(
      countsTowardInboxBadge({ item: { ...ny, status: "bokford" } }),
      false,
      "bokförd historik räknas inte"
    );
  });
});

describe("payload parse", () => {
  it("requires externalId, to and from", () => {
    assert.equal("error" in parseInboundPayload({}), true);
    const ok = parseInboundPayload({
      externalId: "x",
      to: "demo@in.ferva.se",
      from: "a@b.se",
      subject: "S",
      text: "T",
    });
    assert.equal("error" in ok, false);
  });
});
