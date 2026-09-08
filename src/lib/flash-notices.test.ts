import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BANK_ERROR_MESSAGE_MAX_CHARS, flashFromSearch, hrefWithoutFlash } from "./flash-notices";

describe("engångsnotiser i URL:en", () => {
  it("kastat utkast ger en neutral notis och tar bara bort sin egen parameter", () => {
    const params = new URLSearchParams("flik=offerter&kastat=offert&sida=2");
    const match = flashFromSearch(params);
    assert.ok(match);
    assert.equal(match.key, "kastat:offert");
    assert.equal(match.notice.title, "Offertutkastet är kastat");
    assert.equal(match.notice.tone, undefined);
    assert.deepEqual(match.strip, ["kastat"]);
    assert.equal(hrefWithoutFlash("/ekonomi", params, match.strip), "/ekonomi?flik=offerter&sida=2");
  });

  it("fakturautkast har sin egen text", () => {
    const match = flashFromSearch(new URLSearchParams("kastat=faktura"));
    assert.equal(match?.notice.title, "Fakturautkastet är kastat");
  });

  it("okända värden visar ingenting – fri text ur URL:en blir aldrig en notis", () => {
    assert.equal(flashFromSearch(new URLSearchParams("kastat=<script>")), null);
    assert.equal(flashFromSearch(new URLSearchParams("bank=whatever")), null);
    assert.equal(flashFromSearch(new URLSearchParams("meddelande=Grattis")), null);
    assert.equal(flashFromSearch(new URLSearchParams("flik=bank")), null);
  });

  it("bankkoppling: kopplad är grön, avbrutet neutral, fel rött", () => {
    assert.equal(flashFromSearch(new URLSearchParams("bank=kopplad"))?.notice.tone, "ok");
    assert.equal(flashFromSearch(new URLSearchParams("bank=avbrutet"))?.notice.tone, undefined);
    const fel = flashFromSearch(new URLSearchParams("bank=fel"));
    assert.equal(fel?.notice.tone, "danger");
    assert.equal(fel?.notice.text, "Försök igen.");
    assert.deepEqual(fel?.strip, ["bank", "meddelande"]);
  });

  it("bankens eget felmeddelande visas bara ihop med bank=fel och kapas", () => {
    const custom = flashFromSearch(new URLSearchParams("bank=fel&meddelande=Banken+svarade+inte"));
    assert.equal(custom?.notice.text, "Banken svarade inte");
    assert.equal(custom?.notice.title, "Banken godkände inte kopplingen");

    const ignored = flashFromSearch(new URLSearchParams("bank=kopplad&meddelande=Grattis"));
    assert.equal(ignored?.notice.text, "Transaktionerna hämtas och matchas mot dina fakturor.");

    const long = "x".repeat(BANK_ERROR_MESSAGE_MAX_CHARS + 50);
    const capped = flashFromSearch(new URLSearchParams(`bank=fel&meddelande=${long}`));
    assert.equal(capped?.notice.text?.length, BANK_ERROR_MESSAGE_MAX_CHARS);
  });

  it("städningen lämnar en ren sökväg när inget annat finns kvar", () => {
    const params = new URLSearchParams("bank=kopplad&meddelande=x");
    const match = flashFromSearch(params);
    assert.ok(match);
    assert.equal(hrefWithoutFlash("/ekonomi", params, match.strip), "/ekonomi");
  });
});
