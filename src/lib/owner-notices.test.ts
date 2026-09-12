process.env.DRIVA_TEST = "1";

/**
 * Notiser till företagaren: regler (mottagare, av/på), lagring, och att varje
 * händelse utanför appen – kundens nej, dokument via mejl, orderbekräftelse,
 * förfrågan från hemsidan – bygger rätt mejl till rätt adress.
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import { setMailTransportForTests, type MailMessage } from "./mail";
import {
  OWNER_NOTICE_KINDS,
  normalizeOwnerNoticeSettings,
  ownerNoticeEnabled,
  ownerNoticeRecipient,
} from "./notices/owner-notices";
import {
  getOwnerNoticeSettings,
  prepareInboxArrivalNotice,
  prepareOwnerNoticeTest,
  prepareQuoteDeclinedNotice,
  sendOwnerNotices,
  updateOwnerNoticeSettings,
} from "./services/owner-notices";
import { createQuote, declineQuote, quoteDefaults, sendQuote } from "./services/quotes";
import { acceptQuote, prepareQuoteAcceptedNotices } from "./services/quote-accept";
import { getQuote } from "./services/data";
import { ingestInboundMail, ingestUploadedDocument } from "./services/inbox";
import { submitContactForm } from "./services/website";
import { settingsFromRow, settingsToRow } from "./storage/mappers";
import { parseSettingsFlik, SETTINGS_HREF, SETTINGS_TABS } from "./settings-routes";
import { kr } from "./format";
import type { PurchaseOrder } from "./types";

const savedDemo = process.env.DRIVA_DEMO;
const sent: MailMessage[] = [];

beforeEach(() => {
  process.env.DRIVA_DEMO = "0";
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
  sent.length = 0;
  setMailTransportForTests(async (m) => {
    sent.push(m);
    return { messageId: `m-${sent.length}` };
  });
  replaceDb(emptyTestDb({ customers: [testCustomer({ email: "anna@test.se" })] }));
  db().settings.inboundMailSlug = "test";
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env.DRIVA_DEMO;
  else process.env.DRIVA_DEMO = savedDemo;
  setMailTransportForTests(undefined);
});

function sentQuote() {
  const d = quoteDefaults();
  const quote = createQuote({
    customerId: "cust-1",
    title: "Altanbygge",
    lines: [labor({ unitPrice: 40_000 })],
    rot: null,
    paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
    paymentTermsDays: d.paymentTermsDays,
    validUntil: d.validUntil,
    terms: "Standardvillkor",
  });
  sendQuote(quote.id, { mode: "live", ok: true, messageId: "m-1", sentTo: "anna@test.se" });
  return getQuote(quote.id)!;
}

/* ---------------------------------- regler ---------------------------------- */

describe("notiser: regler", () => {
  it("allt är på och går till företagets e-post tills något ändras", () => {
    const s = db().settings;
    assert.equal(s.notices, undefined);
    for (const kind of OWNER_NOTICE_KINDS) assert.equal(ownerNoticeEnabled(s, kind), true);
    assert.equal(ownerNoticeRecipient(s), "info@test.se");
  });

  it("egen adress vinner; samma som företagets räknas inte som egen; ogiltig ger ingen mottagare", () => {
    assert.equal(ownerNoticeRecipient({ email: "info@test.se", notices: { email: "chef@test.se" } }), "chef@test.se");
    assert.equal(
      normalizeOwnerNoticeSettings({ email: "Info@test.se", off: [] }, { email: "info@test.se" }),
      undefined,
      "ingen override och inget avstängt ⇒ inget att lagra",
    );
    assert.equal(ownerNoticeRecipient({ email: "inte-en-adress", notices: undefined }), undefined);
    assert.equal(ownerNoticeRecipient({ email: "", notices: { email: "  " } }), undefined);
  });

  it("normaliseringen filtrerar okända händelser och dubbletter", () => {
    assert.deepEqual(
      normalizeOwnerNoticeSettings({ email: " chef@test.se ", off: ["inkorg", "påhitt", "inkorg"] }, { email: "info@test.se" }),
      { email: "chef@test.se", off: ["inkorg"] },
    );
  });

  it("sparas, läses tillbaka och rundresar genom business_settings-mappern", () => {
    updateOwnerNoticeSettings({ email: "chef@test.se", off: ["offert_avbojd"] });
    assert.deepEqual(db().settings.notices, { email: "chef@test.se", off: ["offert_avbojd"] });
    assert.deepEqual(getOwnerNoticeSettings(), { email: "chef@test.se", off: ["offert_avbojd"], recipient: "chef@test.se" });

    const row = settingsToRow(db().settings, "biz-1");
    assert.equal(row.notices, JSON.stringify({ email: "chef@test.se", off: ["offert_avbojd"] }));
    assert.deepEqual(settingsFromRow(row).notices, { email: "chef@test.se", off: ["offert_avbojd"] });

    updateOwnerNoticeSettings({ email: "", off: [] });
    assert.equal(db().settings.notices, undefined, "tillbaka till standard ⇒ fältet tas bort");
    assert.equal(settingsToRow(db().settings, "biz-1").notices, null);
    assert.equal("notices" in settingsFromRow(settingsToRow(db().settings, "biz-1")), false);
  });

  it("ogiltig egen adress avvisas utan att något sparas", () => {
    assert.throws(() => updateOwnerNoticeSettings({ email: "chef@", off: [] }), /giltig e-postadress/);
    assert.equal(db().settings.notices, undefined);
  });

  it("fliken Notiser finns mellan Fakturering och Funktioner", () => {
    const keys = SETTINGS_TABS.map((t) => t.key);
    assert.equal(keys.indexOf("notiser"), keys.indexOf("fakturering") + 1);
    assert.equal(keys.indexOf("funktioner"), keys.indexOf("notiser") + 1);
    assert.equal(parseSettingsFlik("notiser"), "notiser");
    assert.equal(SETTINGS_HREF.notiser, "/installningar?flik=notiser");
  });
});

/* ------------------------------- offert avböjd ------------------------------ */

describe("notiser: kunden avböjer offerten", () => {
  it("mejlar företagaren med kund, belopp, skäl och länk till offerten", () => {
    const quote = sentQuote();
    declineQuote(quote.id, "För dyrt just nu");
    const notice = prepareQuoteDeclinedNotice(quote.id);
    assert.ok(notice);
    assert.equal(notice.kind, "offert_avbojd");
    assert.equal(notice.message.to, "info@test.se");
    assert.equal(notice.message.subject, `Offert #${quote.number} avböjdes av Anna Andersson`);
    assert.ok(notice.message.text.includes(`Anna Andersson avböjde offert #${quote.number} (Altanbygge) på ${kr(50_000)}.`));
    assert.match(notice.message.text, /Skäl: ”För dyrt just nu”/);
    assert.match(notice.message.text, new RegExp(`/ekonomi/offerter/${quote.id}`));
    assert.match(notice.message.html, /För dyrt just nu/);
    assert.equal(notice.meta.kind, "notis:offert_avbojd");
    assert.equal(notice.meta.documentId, quote.id);
  });

  it("utan skäl sägs det – och notisen går till den egna adressen om en är satt", () => {
    updateOwnerNoticeSettings({ email: "chef@test.se", off: [] });
    const quote = sentQuote();
    declineQuote(quote.id);
    const notice = prepareQuoteDeclinedNotice(quote.id);
    assert.ok(notice);
    assert.equal(notice.message.to, "chef@test.se");
    assert.match(notice.message.text, /Kunden lämnade inget skäl/);
  });

  it("avstängd händelse ⇒ ingen notis; demoföretaget ⇒ ingen notis", () => {
    updateOwnerNoticeSettings({ email: "", off: ["offert_avbojd"] });
    const quote = sentQuote();
    declineQuote(quote.id, "Nej tack");
    assert.equal(prepareQuoteDeclinedNotice(quote.id), undefined);

    updateOwnerNoticeSettings({ email: "", off: [] });
    db().meta.demo = true;
    assert.equal(prepareQuoteDeclinedNotice(quote.id), undefined);
  });

  it("sendOwnerNotices skickar via transporten och sväljer fel", async () => {
    const quote = sentQuote();
    declineQuote(quote.id);
    const notice = prepareQuoteDeclinedNotice(quote.id)!;
    await sendOwnerNotices([notice]);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "info@test.se");

    setMailTransportForTests(async () => {
      throw new Error("Resend nere");
    });
    await assert.doesNotReject(() => sendOwnerNotices([notice]));
    await assert.doesNotReject(() => sendOwnerNotices(undefined));
  });
});

/* ------------------------------ offert godkänd ------------------------------ */

describe("notiser: kunden godkänner offerten", () => {
  it("företagarens bekräftelse följer notisinställningarna", () => {
    updateOwnerNoticeSettings({ email: "chef@test.se", off: [] });
    const quote = sentQuote();
    const result = acceptQuote({ token: quote.token, name: "Anna Andersson" });
    const notices = prepareQuoteAcceptedNotices(result.acceptance);
    const business = notices.find((n) => n.meta.kind === "quote_accepted");
    assert.ok(business);
    assert.equal(business.message.to, "chef@test.se");
    assert.ok(notices.some((n) => n.meta.kind === "quote_accepted_customer"), "kundens bekräftelse påverkas inte");
  });

  it("avstängd ⇒ bara kunden får sitt mejl", () => {
    updateOwnerNoticeSettings({ email: "", off: ["offert_godkand"] });
    const quote = sentQuote();
    const result = acceptQuote({ token: quote.token, name: "Anna Andersson" });
    const notices = prepareQuoteAcceptedNotices(result.acceptance);
    assert.deepEqual(
      notices.map((n) => n.meta.kind),
      ["quote_accepted_customer"],
    );
  });
});

/* ----------------------------- dokument via mejl ---------------------------- */

describe("notiser: dokument kommer in via mejl", () => {
  it("kvitto som bokförs automatiskt ⇒ ”är bokfört” med belopp och länk till posten", () => {
    const result = ingestInboundMail({
      externalId: "auto-1",
      to: "test@in.ferva.se",
      from: "kvitto@bauhaus.se",
      subject: "Kvitto Bauhaus",
      text: "Tack för köpet.",
      parsed: { amount: 1240, vatAmount: 248, supplier: "Bauhaus", confidence: 0.99 },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.item.status, "bokford");
    const notice = prepareInboxArrivalNotice(result.item, { created: true });
    assert.ok(notice);
    assert.equal(notice.kind, "inkorg");
    assert.equal(notice.message.to, "info@test.se");
    assert.equal(notice.message.subject, `Kvitto från Bauhaus är bokfört – ${kr(1240)}`);
    assert.ok(notice.message.text.includes(`Ett kvitto från Bauhaus på ${kr(1240)} kom in via mejl och är bokfört`));
    assert.match(notice.message.text, new RegExp(`/bokforing/underlag/${result.item.id}$`, "m"));
    assert.equal(notice.meta.kind, "notis:inkorg");
  });

  it("osäker läsning ⇒ ”behöver kontrolleras” och länk till Kontrollera", () => {
    const result = ingestInboundMail({
      externalId: "low-1",
      to: "test@in.ferva.se",
      from: "okand@example.com",
      subject: "Kvitto",
      text: "Något köp",
      parsed: { amount: 500, vatAmount: 100, supplier: "Okänd AB", confidence: 0.5 },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.item.status, "ny");
    const notice = prepareInboxArrivalNotice(result.item, { created: true });
    assert.ok(notice);
    assert.equal(notice.message.subject, "Kvitto från Okänd AB behöver kontrolleras");
    assert.match(notice.message.text, /kunde inte läsas säkert – kontrollera dem mot dokumentet/);
    assert.match(notice.message.text, new RegExp(`/bokforing/underlag/${result.item.id}/kontrollera`));
  });

  it("faktura utan uppgifter ⇒ ”nytt dokument i inkorgen” – aldrig påhittat belopp", () => {
    const result = ingestInboundMail({
      externalId: "plain-1",
      to: "test@in.ferva.se",
      from: "faktura@okand.se",
      subject: "Faktura 4711",
      text: "Se bilaga.",
      attachments: [{ filename: "faktura.pdf", contentType: "application/pdf", size: 1200 }],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const notice = prepareInboxArrivalNotice(result.item, { created: true });
    assert.ok(notice);
    assert.equal(notice.message.subject, "Nytt dokument i inkorgen");
    assert.doesNotMatch(notice.message.text, /\d+ kr/);
    assert.match(notice.message.text, /väntar i inkorgen tills du tittat på det/);
  });

  it("dubblett (created=false), egen uppladdning och avstängd händelse ⇒ ingen notis", () => {
    const mail = ingestInboundMail({
      externalId: "dup-1",
      to: "test@in.ferva.se",
      from: "a@x.se",
      subject: "Ett",
      text: "hej",
    });
    assert.equal(mail.ok, true);
    if (!mail.ok) return;
    assert.equal(prepareInboxArrivalNotice(mail.item, { created: false }), undefined);

    const upload = ingestUploadedDocument({ filename: "kvitto.pdf", contentType: "application/pdf" });
    assert.equal(upload.ok, true);
    if (!upload.ok) return;
    assert.equal(upload.item.source, "uppladdning");
    assert.equal(prepareInboxArrivalNotice(upload.item, { created: true }), undefined);

    updateOwnerNoticeSettings({ email: "", off: ["inkorg"] });
    assert.equal(prepareInboxArrivalNotice(mail.item, { created: true }), undefined);
  });

  it("utan e-posttjänst förbereds ingen notis", () => {
    setMailTransportForTests(undefined);
    const mail = ingestInboundMail({
      externalId: "nomail-1",
      to: "test@in.ferva.se",
      from: "a@x.se",
      subject: "Ett",
      text: "hej",
    });
    assert.equal(mail.ok, true);
    if (!mail.ok) return;
    assert.equal(prepareInboxArrivalNotice(mail.item, { created: true }), undefined);
  });

  it("orderbekräftelse som inte matchar någon beställning ⇒ ”kunde inte kopplas” med länk till inboxen", () => {
    // Mejlet känns bara igen som orderbekräftelse när det finns skickade beställningar.
    const now = new Date().toISOString();
    const sentOrder: PurchaseOrder = {
      id: "po-1",
      reference: "FV-1001",
      jobId: "job-x",
      connectionId: "conn-x",
      status: "sent",
      channel: "email",
      delivery: { mode: "pickup" },
      ordererName: "Test",
      ordererEmail: "info@test.se",
      ordererPhone: "",
      ccSelf: false,
      sentAt: now,
      createdAt: now,
      updatedAt: now,
    };
    db().purchaseOrders = [sentOrder];
    const result = ingestInboundMail({
      externalId: "oc-1",
      to: "test@in.ferva.se",
      from: "order@ahlsell.se",
      subject: "Orderbekräftelse 998877",
      text: "Tack för din beställning. Vi bekräftar följande rader.",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.item.documentType, "orderbekraftelse");
    const notice = prepareInboxArrivalNotice(result.item, { created: true });
    assert.ok(notice);
    assert.equal(notice.kind, "orderbekraftelse");
    assert.match(notice.message.subject, /^Orderbekräftelse från .+ kunde inte kopplas till en beställning$/);
    assert.match(notice.message.text, /Välj beställning:/);
    assert.match(notice.message.text, new RegExp(`/bokforing/underlag/${result.item.id}`));
    assert.equal(notice.meta.kind, "notis:orderbekraftelse");
  });
});

/* --------------------------- förfrågan från hemsidan ------------------------ */

describe("notiser: förfrågan från hemsidan", () => {
  const visitor = {
    name: "Karin Testsson",
    email: "karin-test@example.se",
    phone: "070-111 22 33",
    message: "Hej! Vi vill ha hjälp med en ny altan på ca 30 kvm.",
  };

  it("går till notismottagaren när hemsidan inte har en egen", async () => {
    updateOwnerNoticeSettings({ email: "chef@test.se", off: [] });
    const result = await submitContactForm({ ...visitor, idempotencyKey: "n1" });
    assert.equal("skipped" in result, false);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "chef@test.se");
  });

  it("hemsidans egen mottagare vinner", async () => {
    updateOwnerNoticeSettings({ email: "chef@test.se", off: [] });
    db().settings.websiteNotificationEmail = "webb@test.se";
    await submitContactForm({ ...visitor, idempotencyKey: "n2" });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "webb@test.se");
  });

  it("avstängd ⇒ uppdraget skapas, inget mejl, status off (ingen omsändning)", async () => {
    updateOwnerNoticeSettings({ email: "", off: ["forfragan"] });
    const result = await submitContactForm({ ...visitor, idempotencyKey: "n3" });
    assert.equal("skipped" in result, false);
    if ("skipped" in result) return;
    assert.equal(result.created, true);
    assert.equal(result.mailed, false);
    assert.equal(sent.length, 0);
    const job = db().jobs.find((j) => j.id === result.jobId);
    assert.equal(job?.notification?.status, "off");
  });
});

/* ---------------------------------- testmejl --------------------------------- */

describe("notiser: testmejl", () => {
  it("går till mottagaren och förklarar vad notiser är", () => {
    const prepared = prepareOwnerNoticeTest();
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    assert.equal(prepared.to, "info@test.se");
    assert.equal(prepared.notice.message.subject, "Så här ser notiser från Driva ut");
    assert.match(prepared.notice.message.text, /Inställningar → Notiser/);
  });

  it("utan giltig adress eller i demoföretaget ges ett ärligt fel", () => {
    db().settings.email = "";
    assert.deepEqual(prepareOwnerNoticeTest(), { ok: false, error: "Ange en giltig e-postadress först – under Företag eller här." });
    db().settings.email = "info@test.se";
    db().meta.demo = true;
    assert.equal(prepareOwnerNoticeTest().ok, false);
  });
});
