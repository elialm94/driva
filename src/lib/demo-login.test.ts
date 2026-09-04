process.env.DRIVA_TEST = "1";

/**
 * Publika demosessionen (JSON + cookie): sessionskakan, fil-storen med
 * isolering per session, rate limits, tenantgrindarna, den centrala
 * e-postgrinden och AI-budgeten.
 *
 * Demon rör aldrig riktiga företags data. Fil-lagret (JSON-läget) testas här
 * mot en tillfällig katalog; SQL-lagret (Supabase-läget, en jsonb-rad per
 * session delad mellan instanser) testas i storage/demo-session-sql.test.ts.
 */
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { db, replaceDb } from "./store";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import {
  __resetDemoRateLimitForTests,
  demoCookieValueNow,
  demoSessionIdFromCookie,
  demoSessionMaxAgeSeconds,
  isDemoCookieValueActive,
  isValidDemoSessionId,
  newDemoSessionId,
  rateLimitDemoReset,
  rateLimitDemoStart,
} from "./auth/demo-session";
import {
  __resetDemoSessionCacheForTests,
  buildDemoSessionSeed,
  cleanupExpiredDemoSessions,
  deleteDemoSessionState,
  demoSessionsDir,
  ensureDemoSessionState,
  loadDemoSessionState,
  persistDemoSessionState,
  resetDemoSessionState,
} from "./storage/demo-session-store";
import { DemoModeError, assertDemoMode, isDemoBusiness, isDemoMode } from "./demo";
import { BankIDUnavailableError, bankidProvider, bankidSigningAvailable } from "./services/bankid";
import { acceptQuote } from "./services/quote-accept";
import { sendMail, setMailTransportForTests, type MailMessage } from "./mail";
import { sendQuoteWithEmail } from "./services/document-mail";
import { createQuote, quoteDefaults, sendQuote } from "./services/quotes";
import { __resetDemoAiBudgetForTests, assertDemoAiBudget, demoAiDailyCap } from "./ai/demo-limit";
import { AiDemoLimitError, AiTransportError } from "./ai/provider";
import type { AssistantAuditEntry } from "./types";

const ENV_KEYS = [
  "DEMO_SESSION_HOURS",
  "DEMO_EMAIL_SINK",
  "DEMO_AI_DAILY_CAP",
  "DRIVA_DEMO",
  "DRIVA_DEMO_SESSIONS_DIR",
  "RESEND_API_KEY",
] as const;
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
  __resetDemoRateLimitForTests();
  __resetDemoAiBudgetForTests();
  __resetDemoSessionCacheForTests();
  replaceDb(emptyTestDb({ customers: [testCustomer({ email: "anna@test.se" })] }));
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  setMailTransportForTests(undefined);
});

function demoDb(over: Parameters<typeof emptyTestDb>[0] = {}) {
  return emptyTestDb({
    ...over,
    meta: { seededAt: new Date().toISOString(), demo: true, ...(over.meta ?? {}) },
  });
}

function draftQuote(customerId = "cust-1") {
  const defaults = quoteDefaults();
  return createQuote({
    customerId,
    title: "Altanbygge",
    lines: [labor({ unitPrice: 12_000 })],
    rot: null,
    paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
    paymentTermsDays: defaults.paymentTermsDays,
    validUntil: defaults.validUntil,
    terms: defaults.terms,
  });
}

describe("demosessionens kaka och livslängd", () => {
  it("standard är 24 timmar (spec) och klampas till 1–72", () => {
    assert.equal(demoSessionMaxAgeSeconds(), 24 * 3600);
    process.env.DEMO_SESSION_HOURS = "0.2";
    assert.equal(demoSessionMaxAgeSeconds(), 3600);
    process.env.DEMO_SESSION_HOURS = "500";
    assert.equal(demoSessionMaxAgeSeconds(), 72 * 3600);
    process.env.DEMO_SESSION_HOURS = "skräp";
    assert.equal(demoSessionMaxAgeSeconds(), 24 * 3600);
  });

  it("session-id:t är kryptografiskt slumpat, filnamnssäkert och unikt", () => {
    const id = newDemoSessionId();
    assert.equal(isValidDemoSessionId(id), true);
    assert.match(id, /^[a-z0-9]{26}$/);
    assert.notEqual(newDemoSessionId(), id);
  });

  it("nytt kakvärde är aktivt, bär utgångstiden och sitt session-id", () => {
    const id = newDemoSessionId();
    const value = demoCookieValueNow(id);
    assert.match(value, /^\d+\.[a-z0-9]+$/);
    assert.equal(isDemoCookieValueActive(value), true);
    assert.equal(demoSessionIdFromCookie(value), id);
    const expires = Number(value.split(".")[0]);
    const maxAge = demoSessionMaxAgeSeconds() * 1000;
    assert.ok(expires > Date.now() && expires <= Date.now() + maxAge + 1000);
  });

  it("utgångna, tomma och trasiga kakvärden är inaktiva och ger inget session-id", () => {
    assert.equal(isDemoCookieValueActive(undefined), false);
    assert.equal(isDemoCookieValueActive(""), false);
    assert.equal(isDemoCookieValueActive("inte-ett-tal"), false);
    assert.equal(isDemoCookieValueActive(`${Date.now() - 1000}.abcdefghijklmnopqrst12`), false);
    assert.equal(demoSessionIdFromCookie(undefined), null);
    assert.equal(demoSessionIdFromCookie(`${Date.now() - 1000}.abcdefghijklmnopqrst12`), null);
    // Aktiv utgångstid men trasigt/farligt id-format → ingen session.
    assert.equal(demoSessionIdFromCookie(`${Date.now() + 60_000}.`), null);
    assert.equal(demoSessionIdFromCookie(`${Date.now() + 60_000}.kort`), null);
    assert.equal(demoSessionIdFromCookie(`${Date.now() + 60_000}...%2Fetc%2Fpasswd`), null);
  });
});

describe("fil-storen: en JSON-fil per demosession", () => {
  let dir = "";

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "driva-demo-test-"));
    process.env.DRIVA_DEMO_SESSIONS_DIR = dir;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("seedklonen är märkt som demo (servergrindarna gäller)", () => {
    const seed = buildDemoSessionSeed();
    assert.equal(seed.meta.demo, true);
    assert.ok(seed.customers.length > 0);
  });

  it("första träffen klonar seedet till sessionens fil; reload läser samma fil", async () => {
    const id = newDemoSessionId();
    const state = await ensureDemoSessionState(id);
    assert.ok(fs.existsSync(path.join(demoSessionsDir(), `${id}.json`)));
    // Samma objekt inom instansen (parallella requests delar tillstånd).
    assert.equal(await ensureDemoSessionState(id), state);
    // Kall instans (tom cache) läser filen – ändringar överlever.
    state.customers.push(testCustomer({ id: "cust-e2e", name: "Fil-Kund" }));
    await persistDemoSessionState(id, state);
    __resetDemoSessionCacheForTests();
    const reloaded = await ensureDemoSessionState(id);
    assert.ok(reloaded.customers.some((c) => c.name === "Fil-Kund"));
  });

  it("två sessioner är helt isolerade: egna filer, egna kloner", async () => {
    const a = newDemoSessionId();
    const b = newDemoSessionId();
    const stateA = await ensureDemoSessionState(a);
    await ensureDemoSessionState(b);
    stateA.customers.push(testCustomer({ id: "cust-a", name: "Bara hos A" }));
    await persistDemoSessionState(a, stateA);
    __resetDemoSessionCacheForTests();
    assert.ok((await ensureDemoSessionState(a)).customers.some((c) => c.name === "Bara hos A"));
    assert.ok(!(await ensureDemoSessionState(b)).customers.some((c) => c.name === "Bara hos A"));
  });

  it("återställning skriver över sessionens fil med färskt seed", async () => {
    const id = newDemoSessionId();
    const state = await ensureDemoSessionState(id);
    state.customers.push(testCustomer({ id: "cust-x", name: "Försvinner" }));
    await persistDemoSessionState(id, state);
    const fresh = await resetDemoSessionState(id);
    assert.ok(!fresh.customers.some((c) => c.name === "Försvinner"));
    __resetDemoSessionCacheForTests();
    assert.ok(!(await ensureDemoSessionState(id)).customers.some((c) => c.name === "Försvinner"));
  });

  it("avsluta tar bort sessionens fil – och bara den", async () => {
    const a = newDemoSessionId();
    const b = newDemoSessionId();
    await ensureDemoSessionState(a);
    await ensureDemoSessionState(b);
    await deleteDemoSessionState(a);
    assert.equal(await loadDemoSessionState(a), null);
    assert.equal(fs.existsSync(path.join(demoSessionsDir(), `${a}.json`)), false);
    assert.equal(fs.existsSync(path.join(demoSessionsDir(), `${b}.json`)), true);
  });

  it("katalogstädningen tar utgångna filer men rör inte färska", async () => {
    const gammal = newDemoSessionId();
    const farsk = newDemoSessionId();
    await ensureDemoSessionState(gammal);
    await ensureDemoSessionState(farsk);
    const old = new Date(Date.now() - 26 * 3_600_000);
    fs.utimesSync(path.join(demoSessionsDir(), `${gammal}.json`), old, old);
    const removed = await cleanupExpiredDemoSessions();
    assert.equal(removed, 1);
    assert.equal(fs.existsSync(path.join(demoSessionsDir(), `${gammal}.json`)), false);
    assert.equal(fs.existsSync(path.join(demoSessionsDir(), `${farsk}.json`)), true);
  });

  it("ogiltiga session-id:n blir aldrig filnamn", async () => {
    await assert.rejects(() => ensureDemoSessionState("../../../etc/passwd"), /Ogiltigt/);
    await assert.rejects(() => ensureDemoSessionState("KORT"), /Ogiltigt/);
    assert.equal(isValidDemoSessionId("abc"), false);
    assert.equal(isValidDemoSessionId("a".repeat(65)), false);
  });
});

describe("rate limit för demostart och återställning", () => {
  it("tillåter 6 provisioneringar per IP inom fönstret, sedan stopp", () => {
    const now = Date.now();
    for (let i = 0; i < 6; i++) assert.equal(rateLimitDemoStart("1.2.3.4", now + i), true);
    assert.equal(rateLimitDemoStart("1.2.3.4", now + 100), false);
    // Annan besökare påverkas inte av den första IP:ns tak.
    assert.equal(rateLimitDemoStart("5.6.7.8", now + 100), true);
  });

  it("släpper igenom samma IP igen när fönstret passerat", () => {
    const now = Date.now();
    for (let i = 0; i < 6; i++) rateLimitDemoStart("1.2.3.4", now);
    assert.equal(rateLimitDemoStart("1.2.3.4", now + 1000), false);
    assert.equal(rateLimitDemoStart("1.2.3.4", now + 11 * 60_000), true);
  });

  it("har ett globalt tak per instans", () => {
    const now = Date.now();
    let allowed = 0;
    for (let i = 0; i < 70; i++) {
      if (rateLimitDemoStart(`ip-${i}`, now)) allowed++;
    }
    assert.equal(allowed, 60);
  });

  it("återställningen är strypt till en per instans per 20 sekunder", () => {
    const now = Date.now();
    assert.equal(rateLimitDemoReset(now), true);
    assert.equal(rateLimitDemoReset(now + 5_000), false);
    assert.equal(rateLimitDemoReset(now + 21_000), true);
  });
});

describe("tenantgrindarna för demoläget", () => {
  it("demoföretaget öppnar demogrinden även när miljön inte är demo", () => {
    process.env.DRIVA_DEMO = "0";
    replaceDb(demoDb());
    assert.equal(isDemoMode(), false);
    assert.equal(isDemoBusiness(), true);
    assert.doesNotThrow(() => assertDemoMode("Simulerad inbetalning"));
  });

  it("riktiga företag är spärrade när miljön inte är demo", () => {
    process.env.DRIVA_DEMO = "0";
    replaceDb(emptyTestDb());
    assert.equal(isDemoBusiness(), false);
    assert.throws(() => assertDemoMode("Simulerad inbetalning"), DemoModeError);
  });

  it("kvarvarande mock-BankID är spärrad för riktiga företag utanför demo – och ligger inte på kundens godkännandeväg", () => {
    process.env.DRIVA_DEMO = "0";
    replaceDb(emptyTestDb());
    assert.equal(bankidSigningAvailable(), false);
    assert.throws(
      () => bankidProvider.startSign({ quoteId: "q1", quoteVersionId: "v1", method: "qr" }),
      BankIDUnavailableError
    );
    assert.throws(() => bankidProvider.advance("mock-x", "complete"), BankIDUnavailableError);

    replaceDb(demoDb());
    assert.equal(bankidSigningAvailable(), true);
    const order = bankidProvider.startSign({ quoteId: "q1", quoteVersionId: "v1", method: "qr" });
    assert.equal(order.status, "pending");

    process.env.DRIVA_DEMO = "1";
    replaceDb(emptyTestDb());
    assert.equal(bankidSigningAvailable(), true);
  });

  it("kundens godkännande (namn + knapp) fungerar för riktiga företag utanför demo och för demoföretaget", () => {
    process.env.DRIVA_DEMO = "0";
    replaceDb(emptyTestDb({ customers: [testCustomer({ email: "anna@test.se" })] }));
    const real = draftQuote();
    sendQuote(real.id);
    assert.equal(acceptQuote({ token: real.token, name: "Anna Andersson" }).outcome, "accepted");
    assert.equal(db().quotes[0].status, "godkand");
    assert.equal(db().bankidOrders.length, 0, "ingen BankID-order skapas av godkännandet");

    replaceDb(demoDb({ customers: [testCustomer({ email: "anna@test.se" })] }));
    const demo = draftQuote();
    sendQuote(demo.id);
    assert.equal(acceptQuote({ token: demo.token, name: "Anna Andersson" }).outcome, "accepted");
    assert.equal(db().bankidOrders.length, 0);
  });
});

describe("central e-postgrind för demoföretaget", () => {
  const message: MailMessage = {
    to: "extern@kund.se",
    from: "Driva <no-reply@driva.test>",
    subject: "Offert #1",
    text: "Hej",
    html: "<p>Hej</p>",
  };

  it("simulerar leveransen utan sink – inget lämnar appen", async () => {
    replaceDb(demoDb());
    const sent: MailMessage[] = [];
    setMailTransportForTests(async (msg) => {
      sent.push(msg);
      return { messageId: "msg_x" };
    });
    const result = await sendMail(message);
    assert.deepEqual(result, { ok: true, mode: "demo" });
    // Även med en fungerande transport skickas inget till kundens adress.
    assert.equal(sent.length, 0);
  });

  it("skickar till DEMO_EMAIL_SINK i stället för mottagaren när sink finns", async () => {
    replaceDb(demoDb());
    process.env.DEMO_EMAIL_SINK = "demo-sink@driva.test";
    const sent: MailMessage[] = [];
    setMailTransportForTests(async (msg) => {
      sent.push(msg);
      return { messageId: "msg_sink" };
    });
    const result = await sendMail(message);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.mode, "demo");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "demo-sink@driva.test");
    assert.match(sent[0].subject, /^\[Demo\] /);
  });

  it("sink utan konfigurerad transport simuleras ändå – aldrig ett fel", async () => {
    replaceDb(demoDb());
    process.env.DEMO_EMAIL_SINK = "demo-sink@driva.test";
    const result = await sendMail(message);
    assert.deepEqual(result, { ok: true, mode: "demo" });
  });

  it("riktiga företag skickar som vanligt till mottagaren", async () => {
    replaceDb(emptyTestDb());
    const sent: MailMessage[] = [];
    setMailTransportForTests(async (msg) => {
      sent.push(msg);
      return { messageId: "msg_live" };
    });
    const result = await sendMail(message);
    assert.equal(result.ok, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "extern@kund.se");
    assert.equal(sent[0].subject, "Offert #1");
  });

  it("offertflödet i demon: skickad status med demoutfall, inget externt mejl", async () => {
    replaceDb(demoDb({ customers: [testCustomer({ email: "anna@test.se" })] }));
    const sent: MailMessage[] = [];
    setMailTransportForTests(async (msg) => {
      sent.push(msg);
      return { messageId: "msg_y" };
    });
    const quote = draftQuote();
    const { outcome } = await sendQuoteWithEmail(quote.id);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.mode, "demo");
    assert.equal(sent.length, 0);
    assert.equal(db().quotes.find((q) => q.id === quote.id)?.status, "skickad");
  });
});

describe("AI-budget för demoföretaget", () => {
  function llmEntry(at: string): AssistantAuditEntry {
    return { id: `a-${Math.random().toString(36).slice(2, 8)}`, at, tool: "llm_request", params: {}, success: true, ms: 1 };
  }

  it("riktiga företag har ingen demobudget", async () => {
    replaceDb(emptyTestDb());
    for (let i = 0; i < 50; i++) await assertDemoAiBudget();
  });

  it("dygnstaket räknar tenantens llm-logg och åldras ut efter 24 h", async () => {
    const now = Date.now();
    const fresh = Array.from({ length: demoAiDailyCap() }, () => llmEntry(new Date(now - 60_000).toISOString()));
    replaceDb(demoDb({ assistantAudit: fresh }));
    await assert.rejects(() => assertDemoAiBudget(now), AiDemoLimitError);

    const old = Array.from({ length: demoAiDailyCap() }, () => llmEntry(new Date(now - 25 * 3_600_000).toISOString()));
    replaceDb(demoDb({ assistantAudit: old }));
    __resetDemoAiBudgetForTests();
    await assertDemoAiBudget(now);
  });

  it("dygnstaket kan justeras med DEMO_AI_DAILY_CAP", async () => {
    process.env.DEMO_AI_DAILY_CAP = "2";
    const now = Date.now();
    replaceDb(demoDb({ assistantAudit: [llmEntry(new Date(now).toISOString()), llmEntry(new Date(now).toISOString())] }));
    await assert.rejects(() => assertDemoAiBudget(now), AiDemoLimitError);
  });

  it("per-sessionsfönstret stoppar snabba skurar", async () => {
    replaceDb(demoDb());
    const now = Date.now();
    for (let i = 0; i < 20; i++) await assertDemoAiBudget(now + i);
    await assert.rejects(() => assertDemoAiBudget(now + 100), AiDemoLimitError);
    // Fönstret glider: efter tio minuter släpps sessionen in igen.
    await assertDemoAiBudget(now + 11 * 60_000);
  });

  it("gränsfelet ärver transportfelet så alla anropsvägar degraderar snyggt", () => {
    const error = new AiDemoLimitError();
    assert.ok(error instanceof AiTransportError);
    assert.equal(error.status, 429);
    assert.match(error.message, /demo/i);
  });
});
