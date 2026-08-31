process.env.DRIVA_TEST = "1";

import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  afterSignupDestination,
  decideSignupResult,
  isSilentExistingUser,
  loginHrefWithNext,
  mapLoginAuthError,
  mapSignupAuthError,
  parseLoginAuthSearch,
  safeAuthNext,
  sanitizeAuthEmail,
  signupHrefWithNext,
  validateLoginFields,
  validateSignupFields,
  verifyEmailUrl,
} from "./auth/signup-flow";

const EMAIL = "erik@foretaget.se";
const PHONE = "070-123 45 67";
const PASSWORD = "hemligt-lösen-123";

describe("sanitizeAuthEmail", () => {
  it("normaliserar giltig e-post och avvisar skräp", () => {
    assert.equal(sanitizeAuthEmail("  Erik@Foretaget.se "), EMAIL);
    assert.equal(sanitizeAuthEmail("inte-epost"), null);
    assert.equal(sanitizeAuthEmail("a@b"), null);
    assert.equal(sanitizeAuthEmail("erik@foretaget.se\ncc:andra@x.se"), null);
    assert.equal(sanitizeAuthEmail(""), null);
    assert.equal(sanitizeAuthEmail(undefined), null);
  });
});

describe("safeAuthNext", () => {
  it("släpper bara interna sökvägar och aldrig auth-sidorna", () => {
    assert.equal(safeAuthNext("/inbjudan/abc"), "/inbjudan/abc");
    assert.equal(safeAuthNext("/onboarding"), "/onboarding");
    assert.equal(safeAuthNext("https://evil.com"), "/");
    assert.equal(safeAuthNext("//evil.com"), "/");
    assert.equal(safeAuthNext("/login"), "/");
    assert.equal(safeAuthNext("/login?x=1"), "/");
    assert.equal(safeAuthNext("/signup"), "/");
    assert.equal(safeAuthNext("/signup?next=/"), "/");
  });
});

describe("lyckad signup som kräver e-postbekräftelse", () => {
  it("lämnar /signup till /verifiera-epost med e-post – aldrig lösenord", () => {
    const result = decideSignupResult({
      hasSession: false,
      email: "  Erik@Foretaget.se ",
      next: undefined,
    });
    assert.equal(result.kind, "leave");
    assert.equal(result.href, `/verifiera-epost?email=${encodeURIComponent(EMAIL)}`);
    assert.doesNotMatch(result.href, /password|lösen|hemligt/i);
    assert.equal(result.href.includes(PASSWORD), false);
  });

  it("bevarar next (t.ex. inbjudan) genom verifieringssidan", () => {
    const href = verifyEmailUrl(EMAIL, "/inbjudan/token-1");
    assert.match(href, /^\/verifiera-epost\?/);
    assert.equal(href.includes(encodeURIComponent("/inbjudan/token-1")), true);
    assert.equal(href.includes(PASSWORD), false);
  });
});

describe("auth-konfiguration vs runtime", () => {
  it("lokal supabase speglar produktionen: e-postbekräftelse krävs", () => {
    const toml = readFileSync(new URL("../../supabase/config.toml", import.meta.url), "utf8");
    const emailBlock = toml.split("[auth.email]")[1] ?? "";
    assert.match(emailBlock, /enable_confirmations = true/);
    // Sessionen från signUp är ändå sanningen (miljöer kan skilja sig):
    assert.equal(afterSignupDestination({ hasSession: true, email: EMAIL }).href, "/onboarding");
    assert.match(afterSignupDestination({ hasSession: false, email: EMAIL }).href, /^\/verifiera-epost\?/);
  });

  it("lokal supabase har anonyma inloggningar på – demons provisioneringsväg", () => {
    const toml = readFileSync(new URL("../../supabase/config.toml", import.meta.url), "utf8");
    assert.match(toml, /enable_anonymous_sign_ins = true/);
  });
});

describe("lyckad signup när e-postbekräftelse inte krävs", () => {
  it("skickar till onboarding när session finns – ingen bekräftelsecopy", () => {
    const dest = afterSignupDestination({ hasSession: true, email: EMAIL });
    assert.equal(dest.href, "/onboarding");
    const result = decideSignupResult({ hasSession: true, email: EMAIL });
    assert.deepEqual(result, { kind: "leave", href: "/onboarding" });
  });

  it("följer safe next (inbjudan) när session finns direkt", () => {
    assert.equal(
      afterSignupDestination({ hasSession: true, email: EMAIL, next: "/inbjudan/t" }).href,
      "/inbjudan/t"
    );
  });
});

describe("signup-fel stannar på /signup", () => {
  it("valideringsfel, redan använd e-post, svagt lösenord och nätverksfel ger stay", () => {
    assert.deepEqual(decideSignupResult({ fieldError: "Fyll i e-post och lösenord.", hasSession: false, email: "" }), {
      kind: "stay",
      error: "Fyll i e-post och lösenord.",
    });
    assert.deepEqual(
      decideSignupResult({
        authError: { code: "user_already_exists" },
        hasSession: false,
        email: EMAIL,
      }),
      { kind: "stay", error: "Det finns redan ett konto med den e-posten. Logga in i stället." }
    );
    assert.deepEqual(
      decideSignupResult({
        authError: { code: "weak_password" },
        hasSession: false,
        email: EMAIL,
      }),
      { kind: "stay", error: "Lösenordet är för svagt – välj ett längre." }
    );
    assert.deepEqual(
      decideSignupResult({
        authError: { message: "fetch failed" },
        hasSession: false,
        email: EMAIL,
      }),
      { kind: "stay", error: "Kontot kunde inte skapas: fetch failed" }
    );
  });

  it("tyst redan-registrerad (tom identities, ingen session) redirectar inte", () => {
    assert.equal(isSilentExistingUser({ session: null, user: { identities: [] } }), true);
    assert.equal(isSilentExistingUser({ session: { access_token: "x" }, user: { identities: [] } }), false);
    assert.equal(isSilentExistingUser({ session: null, user: { identities: [{ id: "1" }] } }), false);
    const result = decideSignupResult({
      silentExistingUser: true,
      hasSession: false,
      email: EMAIL,
    });
    assert.equal(result.kind, "stay");
    assert.match(result.error, /redan ett konto/);
  });
});

describe("fältvalidering", () => {
  it("signup kräver e-post, telefon och minst 8 tecken; login kräver båda fälten", () => {
    assert.equal(validateSignupFields("", "", ""), "Fyll i e-post, telefonnummer och lösenord.");
    assert.equal(validateSignupFields(EMAIL, "", PASSWORD), "Fyll i e-post, telefonnummer och lösenord.");
    assert.equal(validateSignupFields("inte-epost", PHONE, "abcdefgh"), "Ange en giltig e-postadress.");
    assert.equal(validateSignupFields(EMAIL, "abc", PASSWORD), "Ange ett giltigt telefonnummer.");
    assert.equal(validateSignupFields(EMAIL, "12", PASSWORD), "Ange ett giltigt telefonnummer.");
    assert.equal(validateSignupFields(EMAIL, PHONE, "kort"), "Lösenordet behöver minst 8 tecken.");
    assert.equal(validateSignupFields(EMAIL, PHONE, PASSWORD), null);
    assert.equal(validateSignupFields(EMAIL, "+46 70 123 45 67", PASSWORD), null);
    assert.equal(validateLoginFields("", "x"), "Fyll i e-post och lösenord.");
    assert.equal(validateLoginFields(EMAIL, PASSWORD), null);
  });
});

describe("inloggning: verifierad / overifierad", () => {
  it("verifierad användare har ingen verification-flagga (actions redirectar vidare)", () => {
    const mapped = mapLoginAuthError(undefined);
    assert.equal(mapped.needsVerification, false);
  });

  it("overifierad inloggning ger tydligt fel och resend-yta", () => {
    const mapped = mapLoginAuthError("email_not_confirmed");
    assert.equal(mapped.error, "Bekräfta din e-postadress innan du loggar in.");
    assert.equal(mapped.needsVerification, true);
  });

  it("fel lösenord är inte ett verifieringsfel", () => {
    const mapped = mapLoginAuthError("invalid_credentials");
    assert.equal(mapped.error, "Fel e-post eller lösenord.");
    assert.equal(mapped.needsVerification, false);
  });
});

describe("login-query och tillbaka-navigering", () => {
  it("query-parsning: e-post saneras och next hålls intern", () => {
    assert.deepEqual(parseLoginAuthSearch({}), { email: null, next: "/" });
    assert.deepEqual(parseLoginAuthSearch({ email: EMAIL }), { email: EMAIL, next: "/" });
    assert.equal(parseLoginAuthSearch({ email: "javascript:alert(1)" }).email, null);
    assert.equal(parseLoginAuthSearch({ next: "https://evil.com" }).next, "/");
  });

  it("lösenord kan inte smyga med i query-byggaren", () => {
    const href = verifyEmailUrl(`${EMAIL}&password=${PASSWORD}`, `/?password=${PASSWORD}`);
    assert.equal(href.includes(PASSWORD), false);
    assert.doesNotMatch(href, /[?&]password=/);
  });

  it("tillbaka till /signup är en ren GET: helpers returnerar aldrig success-notice att stanna på", () => {
    const ok = decideSignupResult({ hasSession: false, email: EMAIL });
    assert.equal(ok.kind, "leave");
    const fail = decideSignupResult({ fieldError: "nåt gick fel", hasSession: false, email: EMAIL });
    assert.equal(fail.kind, "stay");
    assert.ok(!("notice" in fail));
  });
});

describe("länkar mellan login och signup", () => {
  it("bevarar next och faller tillbaka till rena sökvägar", () => {
    assert.equal(loginHrefWithNext("/"), "/login");
    assert.equal(signupHrefWithNext("/"), "/signup");
    assert.equal(signupHrefWithNext("/inbjudan/x"), "/signup?next=%2Finbjudan%2Fx");
    assert.equal(loginHrefWithNext("/inbjudan/x"), "/login?next=%2Finbjudan%2Fx");
  });

  it("signup-felcopy för redan använd e-post pekar mot inloggning, inte ny redirect", () => {
    assert.match(mapSignupAuthError("user_already_exists"), /Logga in/);
  });
});
