process.env.DRIVA_TEST = "1";

/**
 * Publika demoinloggningen: sessionskakan, rate limits, tenantgrindarna,
 * den centrala e-postgrinden och AI-budgeten.
 *
 * Själva Supabase-vägarna (inloggning, medlemskap, RLS, återställningens
 * SQL) verifieras i scripts/adapter-validate.ts mot PGlite.
 */
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import {
  __resetDemoRateLimitForTests,
  demoCookieValueNow,
  demoSessionMaxAgeSeconds,
  isDemoCookieValueActive,
  isDemoLoginConfigured,
  isDemoUserEmail,
  rateLimitDemoReset,
  rateLimitDemoStart,
} from "./auth/demo-session";
import { DemoModeError, assertDemoMode, isDemoBusiness, isDemoMode } from "./demo";
import { sendMail, setMailTransportForTests, type MailMessage } from "./mail";
import { sendQuoteWithEmail } from "./services/document-mail";
import { createQuote, quoteDefaults } from "./services/quotes";
import { __resetDemoAiBudgetForTests, assertDemoAiBudget, demoAiDailyCap } from "./ai/demo-limit";
import { AiDemoLimitError, AiTransportError } from "./ai/provider";
import type { AssistantAuditEntry } from "./types";

const ENV_KEYS = [
  "DEMO_USER_EMAIL",
  "DEMO_USER_PASSWORD",
  "DEMO_SESSION_HOURS",
  "DEMO_EMAIL_SINK",
  "DEMO_AI_DAILY_CAP",
  "DRIVA_DEMO",
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
    intro: "",
    lines: [labor({ unitPrice: 12_000 })],
    rot: null,
    paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
    paymentTermsDays: defaults.paymentTermsDays,
    validUntil: defaults.validUntil,
    terms: defaults.terms,
  });
}

describe("demosessionens kaka och livslängd", () => {
  it("standard är 8 timmar och klampas till 1–72", () => {
    assert.equal(demoSessionMaxAgeSeconds(), 8 * 3600);
    process.env.DEMO_SESSION_HOURS = "0.2";
    assert.equal(demoSessionMaxAgeSeconds(), 3600);
    process.env.DEMO_SESSION_HOURS = "500";
    assert.equal(demoSessionMaxAgeSeconds(), 72 * 3600);
    process.env.DEMO_SESSION_HOURS = "skräp";
    assert.equal(demoSessionMaxAgeSeconds(), 8 * 3600);
  });

  it("nytt kakvärde är aktivt, unikt per besökare och bär utgångstiden", () => {
    const value = demoCookieValueNow();
    assert.match(value, /^\d+\.[a-z0-9]+$/);
    assert.equal(isDemoCookieValueActive(value), true);
    assert.notEqual(demoCookieValueNow(), value);
    const expires = Number(value.split(".")[0]);
    const maxAge = demoSessionMaxAgeSeconds() * 1000;
    assert.ok(expires > Date.now() && expires <= Date.now() + maxAge + 1000);
  });

  it("utgångna, tomma och trasiga kakvärden är inaktiva", () => {
    assert.equal(isDemoCookieValueActive(undefined), false);
    assert.equal(isDemoCookieValueActive(""), false);
    assert.equal(isDemoCookieValueActive("inte-ett-tal"), false);
    assert.equal(isDemoCookieValueActive(`${Date.now() - 1000}.abc123`), false);
    // Äldre format utan slumpdel accepteras fortfarande.
    assert.equal(isDemoCookieValueActive(String(Date.now() + 60_000)), true);
  });
});

describe("demoanvändarens identitet", () => {
  it("utan DEMO_USER_EMAIL matchar ingen e-post", () => {
    assert.equal(isDemoUserEmail("demo@driva.test"), false);
    assert.equal(isDemoUserEmail(""), false);
    assert.equal(isDemoUserEmail(undefined), false);
  });

  it("matchar demo-adressen skiftlägesokänsligt och bara den", () => {
    process.env.DEMO_USER_EMAIL = "Demo@Driva.test";
    assert.equal(isDemoUserEmail("demo@driva.test"), true);
    assert.equal(isDemoUserEmail("  DEMO@DRIVA.TEST  "), true);
    assert.equal(isDemoUserEmail("agare@driva.test"), false);
  });

  it("demoinloggningen är avstängd utan Supabase-läge", () => {
    // Testmiljön kör JSON-läget – även med båda variablerna satta är den
    // publika demoinloggningen bara aktuell där riktiga sessioner finns.
    process.env.DEMO_USER_EMAIL = "demo@driva.test";
    process.env.DEMO_USER_PASSWORD = "hemligt";
    assert.equal(isDemoLoginConfigured(), false);
  });
});

describe("rate limit för demostart och återställning", () => {
  it("tillåter 10 starter per IP inom fönstret, sedan stopp", () => {
    const now = Date.now();
    for (let i = 0; i < 10; i++) assert.equal(rateLimitDemoStart("1.2.3.4", now + i), true);
    assert.equal(rateLimitDemoStart("1.2.3.4", now + 100), false);
    // Annan besökare påverkas inte av den första IP:ns tak.
    assert.equal(rateLimitDemoStart("5.6.7.8", now + 100), true);
  });

  it("släpper igenom samma IP igen när fönstret passerat", () => {
    const now = Date.now();
    for (let i = 0; i < 10; i++) rateLimitDemoStart("1.2.3.4", now);
    assert.equal(rateLimitDemoStart("1.2.3.4", now + 1000), false);
    assert.equal(rateLimitDemoStart("1.2.3.4", now + 11 * 60_000), true);
  });

  it("har ett globalt tak per instans", () => {
    const now = Date.now();
    let allowed = 0;
    for (let i = 0; i < 130; i++) {
      if (rateLimitDemoStart(`ip-${i}`, now)) allowed++;
    }
    assert.equal(allowed, 120);
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
