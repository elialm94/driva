import { test } from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_TAGS, scrubBreadcrumb, scrubEvent, scrubText, scrubUrl, scrubValue } from "./scrub";
import { appRelease, isSentryConfigured, newCorrelationId, sentryEnvironment, sentrySourceMapsEnabled } from "./config";

test("scrubText maskar personnummer i alla vanliga format", () => {
  assert.equal(scrubText("Kund 19850315-1234 betalade"), "Kund [personnummer] betalade");
  assert.equal(scrubText("pnr 8503151234"), "pnr [personnummer]");
  assert.equal(scrubText("850315+1234"), "[personnummer]");
  assert.equal(scrubText("orgnr 556677-8899"), "orgnr [personnummer]");
});

test("scrubText maskar tokens, nycklar och anslutningssträngar", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz012345";
  assert.equal(scrubText(`Authorization: Bearer ${jwt}`), "Authorization: Bearer [token]");
  assert.equal(scrubText("nyckel sk_live_abcdef123456 och whsec_ABCDEF0123456"), "nyckel [stripe-nyckel] och [webhook-secret]");
  assert.equal(scrubText("re_AbCdEf123456789"), "[resend-nyckel]");
  assert.equal(
    scrubText("postgresql://driva_app:hemligt@db.example.supabase.co:6543/postgres"),
    "postgres://[dold]"
  );
});

test("scrubText maskar e-post, IBAN, långa nummer och base64-blobbar", () => {
  assert.equal(scrubText("Skickat till anna.svensson@example.se"), "Skickat till [e-post]");
  assert.equal(scrubText("SE4550000000058398257466"), "[iban]");
  assert.equal(scrubText("bankgiro 5050-1055 och konto 1234 5678 9012 3456"), "bankgiro 5050-1055 och konto [nummer]");
  const blob = "A".repeat(300);
  assert.equal(scrubText(`PDF ${blob}==`), "PDF [blob]");
});

test("scrubText avkortar mycket långa strängar", () => {
  const out = scrubText("x".repeat(5000));
  assert.ok(out.length < 2100);
  assert.ok(out.endsWith("[avkortad]"));
});

test("scrubValue döljer känsliga nycklar och skrubbar rekursivt", () => {
  const out = scrubValue({
    password: "abc",
    Authorization: "Bearer x",
    nested: { note: "pnr 19850315-1234", ok: 3, list: ["a@b.se"] },
    attachment: "JVBERi0...",
  }) as Record<string, unknown>;
  assert.equal(out.password, "[dold]");
  assert.equal(out.Authorization, "[dold]");
  assert.equal(out.attachment, "[dold]");
  const nested = out.nested as Record<string, unknown>;
  assert.equal(nested.note, "pnr [personnummer]");
  assert.equal(nested.ok, 3);
  assert.deepEqual(nested.list, ["[e-post]"]);
});

test("scrubUrl tar bort query/fragment och maskar publika tokenlänkar", () => {
  assert.equal(scrubUrl("https://app.ferva.se/installningar?flik=konto&token=abc#x"), "https://app.ferva.se/installningar");
  assert.equal(scrubUrl("/offert/abcdef123456?x=1"), "/offert/[token]");
  assert.equal(scrubUrl("https://app.ferva.se/inbjudan/tok-123"), "https://app.ferva.se/inbjudan/[token]");
  assert.equal(scrubUrl(undefined), undefined);
});

test("scrubEvent tar bort request-innehåll, PII och otillåtna taggar", () => {
  const event = scrubEvent({
    type: undefined,
    message: "Fel för 19850315-1234",
    exception: {
      values: [
        {
          type: "Error",
          value: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz012345",
          stacktrace: { frames: [{ filename: "a.ts", vars: { pnr: "19850315-1234" } }] },
        },
      ],
    },
    request: {
      url: "https://app.ferva.se/bokforing?q=hemligt",
      method: "POST",
      headers: { cookie: "sb-token=abc", authorization: "Bearer x" },
      cookies: { a: "b" },
      data: '{"personnummer":"19850315-1234"}',
      query_string: "q=hemligt",
    },
    user: { id: "u-1", email: "anna@example.se", ip_address: "1.2.3.4" },
    tags: { route: "/bokforing", integration: "stripe", customer_email: "anna@example.se", tenant: "abcd" },
    extra: { bankText: "SWISH 19850315-1234", note: "SWISH 19850315-1234", count: 2 },
    contexts: { response: { body: "x" }, app: { note: "a@b.se" } },
    breadcrumbs: [
      { category: "console", message: "loggade 19850315-1234" },
      { category: "fetch", message: "GET", data: { url: "/api/x?token=1", method: "GET", status_code: 200, body: "hemligt" } },
    ],
  });
  assert.equal(event.message, "Fel för [personnummer]");
  assert.equal(event.exception?.values?.[0].value, "Bearer [token]");
  assert.equal("vars" in (event.exception?.values?.[0].stacktrace?.frames?.[0] ?? {}), false);
  assert.deepEqual(event.request, { url: "https://app.ferva.se/bokforing", method: "POST" });
  assert.deepEqual(event.user, { id: "u-1" });
  assert.deepEqual(event.tags, { route: "/bokforing", integration: "stripe", tenant: "abcd" });
  assert.deepEqual(event.extra, { bankText: "[dold]", note: "SWISH [personnummer]", count: 2 });
  assert.equal("response" in (event.contexts ?? {}), false);
  assert.deepEqual((event.contexts as Record<string, unknown>).app, { note: "[e-post]" });
  assert.equal(event.breadcrumbs?.length, 1);
  assert.deepEqual(event.breadcrumbs?.[0].data, { url: "/api/x", method: "GET", status_code: 200 });
});

test("scrubBreadcrumb kastar console/ui-smulor och behåller bara säkra fält", () => {
  assert.equal(scrubBreadcrumb({ category: "console", message: "x" }), null);
  assert.equal(scrubBreadcrumb({ category: "ui.click", message: "x" }), null);
  const kept = scrubBreadcrumb({ category: "xhr", message: "till anna@example.se", data: { url: "/a?b=1", body: "x" } });
  assert.deepEqual(kept, { category: "xhr", message: "till [e-post]", data: { url: "/a" } });
});

test("tillåtna taggar innehåller korrelations-id, route, integration och tenant-hash", () => {
  for (const t of ["correlationId", "route", "integration", "tenant", "release"]) assert.ok(ALLOWED_TAGS.has(t));
  assert.equal(ALLOWED_TAGS.has("email"), false);
});

test("config: Sentry räknas som konfigurerad bara med DSN; release från commit eller version", () => {
  assert.equal(isSentryConfigured({}), false);
  assert.equal(isSentryConfigured({ SENTRY_DSN: "https://k@o.ingest.sentry.io/1" }), true);
  assert.equal(isSentryConfigured({ NEXT_PUBLIC_SENTRY_DSN: "https://k@o.ingest.sentry.io/1" }), true);
  assert.equal(appRelease({ VERCEL_GIT_COMMIT_SHA: "0123456789abcdef" }), "ferva@0123456789ab");
  assert.equal(appRelease({ npm_package_version: "0.1.0" }), "ferva@0.1.0");
  assert.equal(appRelease({}), "ferva@dev");
  assert.equal(sentryEnvironment({ VERCEL_ENV: "preview" }), "preview");
  assert.equal(sentryEnvironment({ SENTRY_ENVIRONMENT: "staging", VERCEL_ENV: "production" }), "staging");
  assert.equal(sentrySourceMapsEnabled({ SENTRY_ORG: "o", SENTRY_PROJECT: "p" }), false);
  assert.equal(sentrySourceMapsEnabled({ SENTRY_ORG: "o", SENTRY_PROJECT: "p", SENTRY_AUTH_TOKEN: "t" }), true);
});

test("korrelations-id är 12 hex-tecken och unikt", () => {
  const a = newCorrelationId();
  const b = newCorrelationId();
  assert.match(a, /^[0-9a-f]{12}$/);
  assert.notEqual(a, b);
});
