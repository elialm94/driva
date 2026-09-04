process.env.DRIVA_TEST = "1";

/**
 * Offertgodkännande via offertlänken (namn + knapp).
 *
 *   * Lyckat godkännande låser versionen, sparar beviset (hash, namn, tid,
 *     kund, e-post, varifrån, meningen som godkändes) och skapar uppdraget.
 *   * Tomt namn kan aldrig godkänna. Utkast är inte publika. Avböjd/utgången
 *     kan inte godkännas. Ändrat dokument (hash) avvisas.
 *   * Idempotent: dubbeltryck ger samma godkännande, aldrig två uppdrag.
 *   * Demo: inget mejl lämnar appen. Riktigt företag: kund + företagare.
 *   * Grundläggande rate limit per token.
 *   * Ordförrådet påstår aldrig BankID/e-legitimation för simple_accept.
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { db, normalize, replaceDb } from "./store";
import { emptyTestDb, labor, rotReadyCustomer, testCustomer } from "./invoices/test-db";
import {
  createQuote,
  isQuoteWithdrawnByOwner,
  quoteDefaults,
  QUOTE_WITHDRAW_REASON,
  sendQuote,
  updateQuote,
  withdrawQuote,
} from "./services/quotes";
import { currentVersion, getQuote, pendingDraftQuoteVersion, quoteAcceptance, quoteTotals } from "./services/data";
import { quoteVersionHash } from "./hash";
import {
  __resetQuoteAcceptRateLimitForTests,
  acceptQuote,
  prepareQuoteAcceptedNotices,
  QuoteAcceptError,
  quoteAcceptanceStatement,
} from "./services/quote-accept";
import { acceptanceStatement, describeUserAgent, normalizeAcceptName } from "./quote-acceptance";
import { QUOTE_ACCEPT_METHOD, QUOTE_STATUS, QUOTE_TIMELINE, acceptedByLabel } from "./status-labels";
import { setMailTransportForTests, type MailMessage } from "./mail";
import { signaturesSpec } from "./storage/mappers";
import type { QuoteAcceptance } from "./types";
import { bankidProvider } from "./services/bankid";
import { kr } from "./format";

const savedDemo = process.env.DRIVA_DEMO;

beforeEach(() => {
  __resetQuoteAcceptRateLimitForTests();
  delete process.env.RESEND_API_KEY;
  replaceDb(emptyTestDb({ customers: [rotReadyCustomer({ email: "anna@test.se" })] }));
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env.DRIVA_DEMO;
  else process.env.DRIVA_DEMO = savedDemo;
  setMailTransportForTests(undefined);
});

function sentQuote(over: { rot?: { type: "rot" | "rut" } | null; customerId?: string } = {}) {
  const defaults = quoteDefaults();
  const quote = createQuote({
    customerId: over.customerId ?? "cust-1",
    title: "Altanbygge",
    lines: [labor({ unitPrice: 40_000 })],
    rot: over.rot ?? null,
    paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
    paymentTermsDays: defaults.paymentTermsDays,
    validUntil: defaults.validUntil,
    terms: "Standardvillkor",
  });
  sendQuote(quote.id, { mode: "live", ok: true, messageId: "m-1", sentTo: "anna@test.se" });
  return getQuote(quote.id)!;
}

function expectAcceptError(fn: () => unknown, code: QuoteAcceptError["code"]) {
  assert.throws(fn, (e: unknown) => e instanceof QuoteAcceptError && e.code === code, `väntade ${code}`);
}

describe("acceptQuote: lyckat godkännande", () => {
  it("låser versionen, sparar beviset och skapar uppdraget – utan personnummer", () => {
    const quote = sentQuote();
    const version = currentVersion(quote);
    assert.equal(version.lockedAt, undefined, "skickad version är inte låst förrän kunden godkänt");
    const shownHash = quoteVersionHash(version);

    const result = acceptQuote({
      token: quote.token,
      name: "  Anna   Andersson  ",
      expectedContentHash: shownHash,
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/604.1",
    });

    assert.equal(result.outcome, "accepted");
    const approved = getQuote(quote.id)!;
    assert.equal(approved.status, "godkand");
    assert.ok(approved.decidedAt);

    const locked = currentVersion(approved);
    assert.ok(locked.lockedAt, "versionen låstes");
    assert.equal(locked.contentHash, shownHash, "hashen är den kunden såg");
    assert.equal(locked.contentHash, quoteVersionHash(locked), "snapshot-hashen är stabil efter låsningen");
    assert.ok(locked.sellerSnapshot && locked.buyerSnapshot, "företags- och kunduppgifter frystes");

    const a = quoteAcceptance(quote.id)!;
    assert.equal(a.method, "simple_accept");
    assert.equal(a.quoteId, quote.id);
    assert.equal(a.quoteVersionId, locked.id);
    assert.equal(a.acceptedByName, "Anna Andersson", "namnet trimmas och inre blanksteg slås ihop");
    assert.equal(a.customerNameAtAccept, "Anna Andersson");
    assert.equal(a.acceptedByEmail, "anna@test.se");
    assert.equal(a.linkSentTo, "anna@test.se", "länkens mottagare kopplar godkännandet till kundens e-post");
    assert.equal(a.contentHash, shownHash);
    assert.equal(a.ip, "203.0.113.7");
    assert.match(a.userAgent ?? "", /iPhone/);
    assert.ok(a.acceptedAt && !Number.isNaN(Date.parse(a.acceptedAt)));
    assert.equal(a.statement, quoteAcceptanceStatement(approved, locked));
    assert.match(a.statement, /Genom att godkänna accepterar du offerten “Altanbygge” från Test Snickeri AB daterad/);
    assert.match(a.statement, new RegExp(kr(50_000).replace(/\s/g, "\\s")), "avtalspriset inkl. moms ingår");
    assert.equal("bankid" in a, false, "inga BankID-fält på ett enkelt godkännande");

    const job = db().jobs.find((j) => j.quoteId === quote.id);
    assert.ok(job, "uppdraget skapades av godkännandet");
    assert.equal(approved.jobId, job.id);
    assert.equal(job.customerId, quote.customerId);
    assert.doesNotMatch(job.description, /BankID/);

    const activity = db().activity[0];
    assert.match(activity.text, /Anna Andersson godkände offert #\d+\. Uppdraget Altanbygge skapades\./);
    assert.doesNotMatch(activity.text, /BankID/);
  });

  it("ROT-offert: meningen nämner det preliminära avdraget och avtalspriset", () => {
    const quote = sentQuote({ rot: { type: "rot" } });
    const t = quoteTotals(quote);
    assert.ok(t.deduction > 0);
    const statement = quoteAcceptanceStatement(quote);
    assert.match(statement, /preliminärt ROT\/RUT-avdrag/);
    assert.match(statement, new RegExp(kr(t.total).replace(/\s/g, "\\s")));
  });

  it("företagskund: kontaktpersonen skriver sitt namn, bolaget är kunden", () => {
    replaceDb(
      emptyTestDb({
        customers: [
          testCustomer({ id: "cust-ab", kind: "foretag", name: "Nord Studio AB", contactPerson: "Elin Nord", email: "elin@nord.se" }),
        ],
      })
    );
    const quote = sentQuote({ customerId: "cust-ab" });
    acceptQuote({ token: quote.token, name: "Elin Nord" });
    const a = quoteAcceptance(quote.id)!;
    assert.equal(a.acceptedByName, "Elin Nord");
    assert.equal(a.customerNameAtAccept, "Nord Studio AB");
  });
});

describe("acceptQuote: spärrar", () => {
  it("tomt eller blanksteg som namn kan inte godkänna – ingenting ändras", () => {
    const quote = sentQuote();
    for (const bad of ["", "   ", "\n\t", undefined as unknown as string, 42 as unknown as string]) {
      expectAcceptError(() => acceptQuote({ token: quote.token, name: bad }), "name_required");
    }
    assert.equal(getQuote(quote.id)!.status, "skickad");
    assert.equal(currentVersion(getQuote(quote.id)!).lockedAt, undefined);
    assert.equal(db().signatures.length, 0);
    assert.equal(db().jobs.length, 0);
  });

  it("utkast och okända länkar svarar likadant: finns inte", () => {
    const defaults = quoteDefaults();
    const draft = createQuote({
      customerId: "cust-1",
      title: "Utkast",
      lines: [labor()],
      rot: null,
      paymentPlan: [],
      paymentTermsDays: defaults.paymentTermsDays,
      validUntil: defaults.validUntil,
      terms: "",
    });
    expectAcceptError(() => acceptQuote({ token: draft.token, name: "Anna" }), "not_found");
    expectAcceptError(() => acceptQuote({ token: "finns-inte", name: "Anna" }), "not_found");
    expectAcceptError(() => acceptQuote({ token: "", name: "Anna" }), "not_found");
    assert.equal(getQuote(draft.id)!.status, "utkast");
  });

  it("avböjd offert kan inte godkännas", () => {
    const quote = sentQuote();
    getQuote(quote.id)!.status = "avbojd";
    expectAcceptError(() => acceptQuote({ token: quote.token, name: "Anna" }), "declined");
    assert.equal(db().signatures.length, 0);
    assert.equal(db().jobs.length, 0);
  });

  it("utgången offert kan inte godkännas", () => {
    const quote = sentQuote();
    currentVersion(quote).validUntil = "2020-01-01";
    expectAcceptError(() => acceptQuote({ token: quote.token, name: "Anna" }), "expired");
    assert.equal(getQuote(quote.id)!.status, "skickad");
  });

  it("dokumentet ändrades efter att kunden öppnade det → godkännandet avvisas", () => {
    const quote = sentQuote();
    const staleHash = quoteVersionHash(currentVersion(quote));
    // Företagaren redigerar en skickad offert → ny status utkast → inte längre godkännbar.
    const v = currentVersion(quote);
    updateQuote(quote.id, {
      title: "Altanbygge – ändrad",
      lines: v.lines,
      rot: v.rot,
      paymentPlan: v.paymentPlan,
      paymentTermsDays: v.paymentTermsDays,
      validUntil: v.validUntil,
      terms: v.terms,
    });
    expectAcceptError(
      () => acceptQuote({ token: quote.token, name: "Anna", expectedContentHash: staleHash }),
      "not_found"
    );

    // Skickad igen: hash från den gamla vyn matchar inte → "changed", rätt hash går igenom.
    sendQuote(quote.id);
    expectAcceptError(
      () => acceptQuote({ token: quote.token, name: "Anna", expectedContentHash: staleHash }),
      "changed"
    );
    assert.equal(db().signatures.length, 0);
    const fresh = quoteVersionHash(currentVersion(getQuote(quote.id)!));
    assert.equal(acceptQuote({ token: quote.token, name: "Anna", expectedContentHash: fresh }).outcome, "accepted");
  });

  it("rate limit: många försök på samma länk stoppas tillfälligt", () => {
    const quote = sentQuote();
    for (let i = 0; i < 10; i++) {
      expectAcceptError(() => acceptQuote({ token: quote.token, name: "" }), "name_required");
    }
    expectAcceptError(() => acceptQuote({ token: quote.token, name: "Anna" }), "too_many");
    __resetQuoteAcceptRateLimitForTests();
    assert.equal(acceptQuote({ token: quote.token, name: "Anna" }).outcome, "accepted");
  });
});

describe("acceptQuote: idempotens", () => {
  it("dubbeltryck ger samma godkännande – aldrig två uppdrag eller två bevis", () => {
    const quote = sentQuote();
    const first = acceptQuote({ token: quote.token, name: "Anna Andersson" });
    const second = acceptQuote({ token: quote.token, name: "Anna Andersson" });
    const third = acceptQuote({ token: quote.token, name: "" }); // tomt namn efteråt spelar ingen roll
    assert.equal(first.outcome, "accepted");
    assert.equal(second.outcome, "already_accepted");
    assert.equal(third.outcome, "already_accepted");
    assert.equal(second.acceptance.id, first.acceptance.id);
    assert.equal(db().signatures.filter((s) => s.quoteId === quote.id).length, 1);
    assert.equal(db().jobs.filter((j) => j.quoteId === quote.id).length, 1);
    assert.equal(currentVersion(getQuote(quote.id)!).lockedAt, first.acceptance.acceptedAt);
  });

  it("offert kopplad till ett befintligt uppdrag skapar inte ett andra", () => {
    const quote = sentQuote();
    const defaults = quoteDefaults();
    // En första offert godkänns och skapar uppdraget; tilläggsoffert mot samma uppdrag.
    acceptQuote({ token: quote.token, name: "Anna" });
    const job = db().jobs.find((j) => j.quoteId === quote.id)!;
    const extra = createQuote({
      customerId: "cust-1",
      jobId: job.id,
      title: "Tillägg",
      lines: [labor({ unitPrice: 5_000 })],
      rot: null,
      paymentPlan: [],
      paymentTermsDays: defaults.paymentTermsDays,
      validUntil: defaults.validUntil,
      terms: "",
    });
    sendQuote(extra.id);
    acceptQuote({ token: extra.token, name: "Anna" });
    assert.equal(db().jobs.length, 1, "tillägget kopplas till det befintliga uppdraget");
    assert.match(db().activity[0].text, /godkände offert #\d+\.$/, "ingen 'Uppdraget skapades' andra gången");
  });
});

describe("acceptQuote: demo-isolering och notifiering", () => {
  it("demoföretaget: godkännandet fungerar men inget mejl förbereds", () => {
    process.env.DRIVA_DEMO = "0";
    replaceDb(
      emptyTestDb({
        customers: [rotReadyCustomer({ email: "anna@test.se" })],
        meta: { seededAt: new Date().toISOString(), demo: true },
      })
    );
    const sent: MailMessage[] = [];
    setMailTransportForTests(async (m) => {
      sent.push(m);
    });
    const quote = sentQuote();
    const result = acceptQuote({ token: quote.token, name: "Anna Andersson" });
    assert.equal(result.outcome, "accepted");
    assert.equal(getQuote(quote.id)!.status, "godkand");
    assert.deepEqual(prepareQuoteAcceptedNotices(result.acceptance), [], "demo: ingen Resend");
    assert.equal(sent.length, 0);
    assert.equal(db().bankidOrders.length, 0, "mock-BankID rörs aldrig av godkännandet");
  });

  it("demoläge (miljö): inget mejl förbereds", () => {
    process.env.DRIVA_DEMO = "1";
    setMailTransportForTests(async () => undefined);
    const quote = sentQuote();
    const result = acceptQuote({ token: quote.token, name: "Anna" });
    assert.deepEqual(prepareQuoteAcceptedNotices(result.acceptance), []);
  });

  it("riktigt företag med e-posttjänst: kund och företagare får var sitt mejl", () => {
    process.env.DRIVA_DEMO = "0";
    setMailTransportForTests(async () => ({ messageId: "resend-1" }));
    const quote = sentQuote();
    const result = acceptQuote({ token: quote.token, name: "Anna Andersson" });
    const notices = prepareQuoteAcceptedNotices(result.acceptance);
    assert.equal(notices.length, 2, "två bekräftelsemejl");
    const customer = notices.find((n) => n.meta.kind === "quote_accepted_customer");
    const business = notices.find((n) => n.meta.kind === "quote_accepted");
    assert.ok(customer && business);
    assert.equal(customer.message.to, "anna@test.se");
    assert.match(customer.message.subject, /Bekräftelse: du har godkänt offert #\d+/);
    assert.match(customer.message.text, /skrev ditt namn och tryckte Godkänn offert/);
    assert.match(customer.message.text, /\/offert\/.+/);
    assert.match(customer.message.text, /\/underlag/);
    assert.doesNotMatch(customer.message.text, /BankID|e-legitimation|Ställ en fråga/i);
    assert.equal(business.message.to, "info@test.se", "till företagets e-post");
    assert.match(business.message.subject, /Offert #\d+ är godkänd av Anna Andersson/);
    assert.match(business.message.text, /godkände offert/);
    assert.doesNotMatch(business.message.text, /BankID/);
  });

  it("utan kundens e-post: bara företagaren får mejl", () => {
    process.env.DRIVA_DEMO = "0";
    setMailTransportForTests(async () => ({ messageId: "resend-1" }));
    replaceDb(emptyTestDb({ customers: [rotReadyCustomer({ email: "" })] }));
    const quote = sentQuote();
    getQuote(quote.id)!.lastEmail = undefined;
    const result = acceptQuote({ token: quote.token, name: "Anna Andersson" });
    const notices = prepareQuoteAcceptedNotices(result.acceptance);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].meta.kind, "quote_accepted");
    assert.equal(notices[0].message.to, "info@test.se");
  });

  it("riktigt företag utan e-posttjänst: godkännandet blockeras inte", () => {
    process.env.DRIVA_DEMO = "0";
    const quote = sentQuote();
    const result = acceptQuote({ token: quote.token, name: "Anna" });
    assert.equal(result.outcome, "accepted");
    assert.deepEqual(prepareQuoteAcceptedNotices(result.acceptance), []);
  });

  it("mock-BankID-providern är spärrad för riktiga företag och ligger inte på godkännandevägen", () => {
    process.env.DRIVA_DEMO = "0";
    const quote = sentQuote();
    assert.throws(() =>
      bankidProvider.startSign({ quoteId: quote.id, quoteVersionId: quote.currentVersionId, method: "qr" })
    );
    assert.equal(acceptQuote({ token: quote.token, name: "Anna" }).outcome, "accepted");
    assert.equal(db().bankidOrders.length, 0);
  });
});

describe("ordförråd och hjälpfunktioner", () => {
  it("statusar och etiketter påstår aldrig BankID för det enkla godkännandet", () => {
    assert.equal(QUOTE_STATUS.skickad.label, "Väntar på godkännande");
    assert.equal(QUOTE_STATUS.godkand.label, "Godkänd");
    assert.equal(QUOTE_TIMELINE.godkand, "Godkänd av kunden");
    assert.equal(acceptedByLabel({ method: "simple_accept", acceptedByName: "Sara Nilsson" }), "Godkänd av Sara Nilsson");
    assert.doesNotMatch(QUOTE_ACCEPT_METHOD.simple_accept, /BankID|legitimation|avancerad/i);
    assert.match(acceptedByLabel({ method: "bankid_mock", acceptedByName: "X" }), /demo/);
  });

  it("normalizeAcceptName trimmar, slår ihop blanksteg och kapar", () => {
    assert.equal(normalizeAcceptName("  Anna \n Andersson "), "Anna Andersson");
    assert.equal(normalizeAcceptName("   "), "");
    assert.equal(normalizeAcceptName(null), "");
    assert.equal(normalizeAcceptName("a".repeat(200)).length, 120);
  });

  it("acceptanceStatement är en mening med rubrik, företag, datum och belopp", () => {
    const s = acceptanceStatement({ title: "Altan", companyName: "Bolaget AB", datedIso: "2026-09-01T10:00:00.000Z", total: 50_000 });
    assert.equal(
      s,
      `Genom att godkänna accepterar du offerten “Altan” från Bolaget AB daterad 1 september 2026 till ett totalt belopp om ${kr(50_000)}.`
    );
  });

  it("describeUserAgent ger en kort enhetsbeskrivning", () => {
    assert.equal(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1"), "Safari på iPhone");
    assert.equal(describeUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile Safari/537.36"), "Chrome på Android");
    assert.equal(describeUserAgent(undefined), undefined);
  });

  it("JSON-lagret migrerar äldre BankID-formade signaturer till bankid_mock-godkännanden", () => {
    const legacy = {
      id: "sig-old",
      quoteId: "q",
      quoteVersionId: "v",
      orderRef: "mock-order-1",
      signerName: "Elin Nord",
      signerPersonalNumberMasked: "198104••-••••",
      signedAt: "2026-01-01T10:00:00.000Z",
      environment: "mock",
      evidence: { contentHash: "abc", note: "Demosignatur" },
    };
    const state = normalize(emptyTestDb({ signatures: [legacy as unknown as QuoteAcceptance] }), {
      persistIfDirty: false,
    });
    const a = state.signatures[0];
    assert.equal(a.method, "bankid_mock");
    assert.equal(a.acceptedByName, "Elin Nord");
    assert.equal(a.acceptedAt, "2026-01-01T10:00:00.000Z");
    assert.equal(a.contentHash, "abc");
    assert.equal(a.bankid?.orderRef, "mock-order-1");
    assert.equal("signerName" in a, false);
    // Redan migrerade poster lämnas orörda.
    const again = normalize(state, { persistIfDirty: false });
    assert.deepEqual(again.signatures[0], a);
  });

  it("databasmappningen gör en exakt rundresa och läser äldre BankID-rader", () => {
    const quote = sentQuote();
    const { acceptance } = acceptQuote({ token: quote.token, name: "Anna", ip: "1.2.3.4", userAgent: "UA" });
    const row = signaturesSpec.toRow(acceptance, "00000000-0000-0000-0000-000000000001");
    assert.equal(row.method, "simple_accept");
    assert.equal(row.order_ref, null);
    assert.equal(row.environment, null);
    assert.equal(row.signer_personal_number_masked, null);
    const back = signaturesSpec.fromRow({ ...row, signed_at: new Date(acceptance.acceptedAt) });
    assert.deepEqual(back, acceptance);

    const legacy = signaturesSpec.fromRow({
      id: "sig-old",
      quote_id: "q",
      quote_version_id: "v",
      order_ref: "mock-1",
      signer_name: "Elin Nord",
      signer_personal_number_masked: "1981••",
      signed_at: new Date("2026-01-01T10:00:00.000Z"),
      environment: "mock",
      evidence: { contentHash: "abc", note: "Demosignatur" },
    });
    assert.equal(legacy.method, "bankid_mock");
    assert.equal(legacy.acceptedByName, "Elin Nord");
    assert.equal(legacy.customerNameAtAccept, "Elin Nord");
    assert.equal(legacy.contentHash, "abc");
    assert.equal(legacy.bankid?.orderRef, "mock-1");
    assert.equal(legacy.bankid?.note, "Demosignatur");
  });
});

function versionFields(quoteId: string) {
  const v = currentVersion(getQuote(quoteId)!);
  return {
    title: v.title,
    lines: v.lines,
    rot: v.rot,
    paymentPlan: v.paymentPlan,
    paymentTermsDays: v.paymentTermsDays,
    validUntil: v.validUntil,
    terms: v.terms,
  };
}

describe("Ny version efter godkännande: supersede-on-accept", () => {
  it("Ny version lämnar den godkända snapshoten styrande", () => {
    const quote = sentQuote();
    const first = acceptQuote({ token: quote.token, name: "Anna Andersson" });
    const acceptedId = currentVersion(getQuote(quote.id)!).id;
    updateQuote(quote.id, { ...versionFields(quote.id), title: "Altanbygge v2" });
    const after = getQuote(quote.id)!;
    assert.equal(after.status, "godkand");
    assert.equal(after.currentVersionId, acceptedId);
    assert.equal(quoteAcceptance(after.id)!.id, first.acceptance.id);
    assert.equal(quoteAcceptance(after.id)!.quoteVersionId, acceptedId);
    const pending = pendingDraftQuoteVersion(after);
    assert.ok(pending);
    assert.equal(pending.title, "Altanbygge v2");
    assert.equal(pending.version, 2);
    assert.equal(acceptQuote({ token: quote.token, name: "Anna" }).outcome, "already_accepted");
  });

  it("andra sparningen skriver i samma utkast, inte en tredje version", () => {
    const quote = sentQuote();
    acceptQuote({ token: quote.token, name: "Anna" });
    updateQuote(quote.id, { ...versionFields(quote.id), title: "v2" });
    updateQuote(quote.id, { ...versionFields(quote.id), title: "v2b" });
    assert.equal(db().quoteVersions.filter((v) => v.quoteId === quote.id).length, 2);
    assert.equal(pendingDraftQuoteVersion(getQuote(quote.id)!)!.title, "v2b");
  });

  it("skickad ny version: ny accept ersätter beviset, inget andra uppdrag", () => {
    const quote = sentQuote();
    const first = acceptQuote({ token: quote.token, name: "Anna Andersson" });
    const jobsBefore = db().jobs.length;
    updateQuote(quote.id, { ...versionFields(quote.id), title: "Altanbygge v2" });
    sendQuote(quote.id);
    const mid = getQuote(quote.id)!;
    assert.equal(mid.status, "godkand");
    assert.equal(mid.currentVersionId, first.acceptance.quoteVersionId);
    const pending = pendingDraftQuoteVersion(mid)!;
    assert.ok(pending.sellerSnapshot);
    const hash = quoteVersionHash(pending);
    const second = acceptQuote({ token: quote.token, name: "Anna Andersson", expectedContentHash: hash });
    assert.equal(second.outcome, "accepted");
    const done = getQuote(quote.id)!;
    assert.equal(done.currentVersionId, pending.id);
    assert.equal(quoteAcceptance(done.id)!.quoteVersionId, pending.id);
    assert.equal(db().signatures.filter((s) => s.quoteId === quote.id).length, 1);
    assert.equal(db().jobs.length, jobsBefore);
  });
});

describe("Dra tillbaka offerten", () => {
  it("skickad offert kan dras tillbaka – public kan inte godkänna; idempotent", () => {
    const quote = sentQuote();
    const result = withdrawQuote(quote.id);
    assert.equal(result.status, "avbojd");
    assert.equal(result.declineReason, QUOTE_WITHDRAW_REASON);
    assert.equal(isQuoteWithdrawnByOwner(result), true);
    expectAcceptError(() => acceptQuote({ token: quote.token, name: "Anna" }), "declined");
    assert.equal(withdrawQuote(quote.id).declineReason, QUOTE_WITHDRAW_REASON);
    assert.equal(db().quoteVersions.filter((v) => v.quoteId === quote.id).length, 1);
  });

  it("godkänd offert kan inte dras tillbaka", () => {
    const quote = sentQuote();
    acceptQuote({ token: quote.token, name: "Anna" });
    assert.throws(() => withdrawQuote(quote.id), /godkänd/);
    assert.equal(getQuote(quote.id)!.status, "godkand");
  });
});
