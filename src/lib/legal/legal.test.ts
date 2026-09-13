import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidOrgNumber, legalEntityStatus, legalEntityLabel, LEGAL_ENTITY_PLACEHOLDER } from "./entity";
import { activeProviders, providerRegister } from "./providers";
import { LEGAL_DOCUMENTS, needsReacceptance, privacySections, termsSections, TERMS_VERSION } from "./documents";
import { termsGateDecision } from "./acceptance";
import { termsAccepted } from "../auth/signup-flow";

const ENTITY_OK = {
  LEGAL_ENTITY_NAME: "Testbolaget AB",
  LEGAL_ENTITY_ORG_NUMBER: "5560160680",
  LEGAL_ENTITY_ADDRESS: "Testgatan 1, 123 45 Teststad",
  LEGAL_CONTACT_EMAIL: "avtal@example.com",
};

test("organisationsnummer valideras med kontrollsiffra", () => {
  assert.equal(isValidOrgNumber("556016-0680"), true);
  assert.equal(isValidOrgNumber("5560160680"), true);
  assert.equal(isValidOrgNumber("556016-0681"), false);
  assert.equal(isValidOrgNumber("12345"), false);
});

test("avtalspart: komplett env ger entity, saknade variabler listas i ordning", () => {
  const ok = legalEntityStatus(ENTITY_OK);
  assert.equal(ok.complete, true);
  assert.equal(ok.entity?.orgNumber, "556016-0680");
  assert.equal(ok.entity?.privacyEmail, "avtal@example.com");

  const missing = legalEntityStatus({});
  assert.equal(missing.complete, false);
  assert.deepEqual(missing.missing, ["LEGAL_ENTITY_NAME", "LEGAL_ENTITY_ORG_NUMBER", "LEGAL_ENTITY_ADDRESS", "LEGAL_CONTACT_EMAIL"]);
  assert.equal(missing.entity, null);
  assert.equal(legalEntityLabel(missing), LEGAL_ENTITY_PLACEHOLDER);

  const badOrg = legalEntityStatus({ ...ENTITY_OK, LEGAL_ENTITY_ORG_NUMBER: "556016-0681" });
  assert.equal(badOrg.complete, false);
  assert.deepEqual(badOrg.missing, ["LEGAL_ENTITY_ORG_NUMBER"]);
});

test("dokumenten hittar aldrig på ett bolagsnamn när avtalsparten saknas", () => {
  const status = legalEntityStatus({});
  const text = termsSections(status).flatMap((s) => s.body).join("\n");
  assert.ok(text.includes(LEGAL_ENTITY_PLACEHOLDER));
  assert.ok(!/Ferva AB/.test(text));
  const privacy = privacySections(status, []).flatMap((s) => [...s.body, ...(s.bullets ?? [])]).join("\n");
  assert.ok(privacy.includes("IMY"));
  assert.ok(/sju år|7 år/.test(privacy));
});

test("villkoren beskriver skrivskydd, provperiod, export och bevarandetid", () => {
  const text = termsSections(legalEntityStatus(ENTITY_OK)).flatMap((s) => [s.title, ...s.body]).join("\n");
  for (const needle of ["skrivskyddat", "provperiod", "exportera", "bokföringslagen", "sju år", "Ansvarsbegränsning", "Testbolaget AB"]) {
    assert.ok(text.includes(needle), `saknar "${needle}"`);
  }
});

test("underbiträdeslistan omfattar bara aktiva leverantörer", () => {
  assert.deepEqual(activeProviders({}).map((p) => p.id), []);
  const withStripe = activeProviders({
    NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    RESEND_API_KEY: "re_x",
    STRIPE_SECRET_KEY: "sk_test_abc",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
    STRIPE_PRICE_ID: "price_x",
    NODE_ENV: "test",
  });
  assert.deepEqual(withStripe.map((p) => p.id), ["supabase", "resend", "stripe"]);
  for (const p of withStripe) {
    assert.ok(p.purpose && p.region && p.termsUrl, `${p.id} saknar uppgifter`);
  }
  const ai = activeProviders({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "sk-or-v1-x" });
  assert.deepEqual(ai.map((p) => p.id), ["openrouter"]);
  const filing = activeProviders({
    FILING_API_BASE_URL: "https://inlamning.example.se",
    FILING_API_TOKEN: "t",
    FILING_PROVIDER_NAME: "Exempel Inlämning AB",
  });
  assert.equal(filing[0]?.name, "Exempel Inlämning AB");
  assert.equal(providerRegister({}).every((p) => p.active === false), true);
});

test("ny huvudversion kräver nytt godkännande, minor gör det inte", () => {
  assert.equal(needsReacceptance(null), true);
  assert.equal(needsReacceptance("1.0", "2.0"), true);
  assert.equal(needsReacceptance("2.0", "2.3"), false);
  assert.equal(needsReacceptance("2.1", "2.0"), false);
  assert.equal(LEGAL_DOCUMENTS.villkor.version, TERMS_VERSION);
});

test("grindbeslutet: tabellrad vinner, registreringsbevis flyttas, annars krävs godkännande", () => {
  assert.deepEqual(termsGateDecision({ recorded: "2.0", signupHint: null, current: "2.0" }), {
    required: false,
    acceptedVersion: "2.0",
    persistFromSignup: false,
  });
  assert.deepEqual(termsGateDecision({ recorded: null, signupHint: "2.0", current: "2.0" }), {
    required: false,
    acceptedVersion: "2.0",
    persistFromSignup: true,
  });
  assert.deepEqual(termsGateDecision({ recorded: "1.0", signupHint: "1.0", current: "2.0" }), {
    required: true,
    acceptedVersion: "1.0",
    persistFromSignup: false,
  });
  assert.equal(termsGateDecision({ recorded: null, signupHint: null, current: "2.0" }).required, true);
});

test("kryssrutan är ett aktivt val", () => {
  assert.equal(termsAccepted("on"), true);
  assert.equal(termsAccepted("true"), true);
  assert.equal(termsAccepted(""), false);
  assert.equal(termsAccepted(null), false);
  assert.equal(termsAccepted("ja"), false);
});
