process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { customerShareText, smsShareHref } from "./customer-link-share";

describe("dela kundlänk", () => {
  it("bygger sms-länk med och utan nummer", () => {
    const href = smsShareHref("https://exempel.se/offert/abc", "070-123 45 67", "Offert #12");
    assert.match(href, /^sms:0701234567\?body=/);
    assert.match(decodeURIComponent(href), /Offert #12/);
    assert.equal(smsShareHref("https://x.se").startsWith("sms:?body="), true);
  });

  it("texten nämner dokumenttypen", () => {
    assert.equal(customerShareText("faktura", 44), "Faktura #44 från oss");
  });
});
