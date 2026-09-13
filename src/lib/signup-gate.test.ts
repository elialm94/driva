process.env.DRIVA_TEST = "1";

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import { SIGNUP_CLOSED_MESSAGE, signupClosedForLegalEntity } from "./auth/signup-gate";
import { isProductionRuntime } from "./deployment";

/** Komplett avtalspart, samma form som legal.test.ts använder. */
const LEGAL_OK = {
  LEGAL_ENTITY_NAME: "Testbolaget AB",
  LEGAL_ENTITY_ORG_NUMBER: "5560160680",
  LEGAL_ENTITY_ADDRESS: "Testgatan 1, 123 45 Teststad",
  LEGAL_CONTACT_EMAIL: "avtal@example.com",
};

const root = process.cwd();
const authActions = readFileSync(path.join(root, "src", "app", "auth-actions.ts"), "utf8");
const signupPage = readFileSync(path.join(root, "src", "app", "(auth)", "signup", "page.tsx"), "utf8");

describe("registreringsspärr när avtalsparten saknas", () => {
  it("släpper igenom registrering när avtalsparten är komplett i produktion", () => {
    assert.equal(signupClosedForLegalEntity({ ...LEGAL_OK, VERCEL_ENV: "production" }), false);
  });

  it("stänger registreringen när avtalsparten är ofullständig i produktion", () => {
    assert.equal(signupClosedForLegalEntity({ VERCEL_ENV: "production" }), true);
    // Ett enda saknat fält räcker: utan organisationsnummer finns ingen avtalspart.
    const utanOrgNr = { ...LEGAL_OK, VERCEL_ENV: "production", LEGAL_ENTITY_ORG_NUMBER: "" };
    assert.equal(signupClosedForLegalEntity(utanOrgNr), true);
  });

  it("lämnar preview, lokal utveckling och JSON-läget orörda", () => {
    assert.equal(signupClosedForLegalEntity({ VERCEL_ENV: "preview" }), false);
    assert.equal(signupClosedForLegalEntity({ VERCEL_ENV: "development" }), false);
    assert.equal(signupClosedForLegalEntity({}), false);
    assert.equal(signupClosedForLegalEntity({ NODE_ENV: "production" }), false);
  });

  it("använder samma produktionsbedömning som /api/health", () => {
    assert.equal(isProductionRuntime({ VERCEL_ENV: "production" }), true);
    assert.equal(isProductionRuntime({ VERCEL_ENV: "preview" }), false);
    assert.equal(isProductionRuntime({ NODE_ENV: "production" }), false);
    assert.equal(isProductionRuntime({}), false);
  });

  it("beskedet är svenskt och nämner inget bolagsnamn", () => {
    assert.match(SIGNUP_CLOSED_MESSAGE, /kan inte skapa nya konton/i);
    assert.doesNotMatch(SIGNUP_CLOSED_MESSAGE, /FERVA AB/);
  });
});

test("spärren körs innan någon auth-användare skapas", () => {
  const gate = authActions.indexOf("signupClosedForLegalEntity()");
  const signUp = authActions.indexOf("supabase.auth.signUp");
  assert.ok(gate > 0, "signupAction ska kontrollera registreringsspärren");
  assert.ok(signUp > 0, "signupAction ska fortfarande skapa användaren via Supabase");
  assert.ok(gate < signUp, "spärren måste ligga före signUp – annars skapas kontot ändå");
});

test("/signup visar inget formulär när registreringen är stängd", () => {
  assert.match(signupPage, /signupClosedForLegalEntity\(\)/);
  // Formuläret får bara renderas i den öppna grenen.
  const closed = signupPage.indexOf("SIGNUP_CLOSED_HEADING}");
  const form = signupPage.indexOf("<SignupForm");
  assert.ok(closed > 0 && form > 0);
  assert.ok(closed < form, "det stängda kortet ska vara den första grenen");
  assert.match(signupPage, /loginHrefWithNext\(next\)/, "kortet ska länka till inloggningen");
});

test("inget bolagsnamn är hårdkodat i registreringsvägen", () => {
  for (const source of [authActions, signupPage, readFileSync(path.join(root, "src", "lib", "auth", "signup-gate.ts"), "utf8")]) {
    assert.doesNotMatch(source, /FERVA AB/i);
    assert.doesNotMatch(source, /\d{6}-\d{4}/);
  }
});
