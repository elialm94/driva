import assert from "node:assert/strict";
import {
  isSectionActive,
  KUNDER_TABS,
  labelForHref,
  matchRoute,
  resolveBack,
  sanitizeReturnTo,
  withReturnTo,
} from "../src/lib/nav";

assert.equal(sanitizeReturnTo("https://evil.com"), null);
assert.equal(sanitizeReturnTo("//evil.com"), null);
assert.equal(sanitizeReturnTo("/\\evil"), null);
assert.equal(sanitizeReturnTo("/ekonomi?flik=fakturor"), "/ekonomi?flik=fakturor");
assert.equal(sanitizeReturnTo("/pengar?flik=fakturor"), "/ekonomi?flik=fakturor");
assert.equal(sanitizeReturnTo("/pengar/fakturor/inv-1"), "/ekonomi/fakturor/inv-1");
assert.equal(sanitizeReturnTo("/jobb/job-kok"), "/uppdrag/job-kok");
assert.equal(sanitizeReturnTo("/uppdrag/job-kok"), "/uppdrag/job-kok");
assert.equal(sanitizeReturnTo("/uppdrag"), "/kunder?flik=uppdrag");
assert.equal(sanitizeReturnTo("/assistent"), "/");
assert.equal(sanitizeReturnTo("/kunder?flik=forfragningar"), "/inbox");
assert.equal(sanitizeReturnTo("/kunder/forfragningar/req-karin"), "/inbox/req-karin");

const nested = withReturnTo("/ekonomi/fakturor/inv-1", "/ekonomi/offerter/q1?tillbaka=/uppdrag/job-kok&tillbakaNamn=Köksrenovering", "Offert #110");
assert.match(nested, /tillbaka=/);
assert.equal(isSectionActive("/ekonomi/fakturor/inv-1045", "/ekonomi"), true);
assert.equal(isSectionActive("/pengar/fakturor/inv-1045", "/ekonomi"), true);
assert.equal(isSectionActive("/uppdrag/job-kok", "/kunder"), true);
assert.equal(isSectionActive("/inbox/req-karin", "/inbox"), true);
assert.equal(isSectionActive("/ekonomi/fakturor/inv-1045", "/"), false);
assert.equal(isSectionActive("/", "/"), true);
assert.equal(matchRoute("/ekonomi/fakturor/abc")?.meta.backLabel, "Fakturor");
assert.equal(matchRoute("/inbox/req-karin")?.meta.backLabel, "Inbox");
assert.equal(isSectionActive("/inbox/req-karin", "/kunder"), false);
assert.equal(labelForHref("/inbox"), "Inbox");
assert.equal(labelForHref("/kunder?flik=forfragningar"), "Inbox");
assert.equal(KUNDER_TABS[0].href, "/kunder?flik=kunder");
assert.equal(KUNDER_TABS[1].href, "/kunder?flik=uppdrag");
assert.equal(KUNDER_TABS.length, 2);
assert.equal(matchRoute("/kunder/cust-anna")?.meta.parent, "/kunder?flik=kunder");
assert.equal(matchRoute("/pengar/fakturor/abc")?.meta.backLabel, "Fakturor");
assert.equal(labelForHref("/ekonomi?flik=offerter"), "Offerter");
assert.equal(labelForHref("/pengar?flik=offerter"), "Offerter");
assert.equal(labelForHref("/ekonomi"), "Ekonomi");
assert.equal(labelForHref("/kunder?flik=uppdrag"), "Uppdrag");

const backFromInvoice = resolveBack(
  "/ekonomi/fakturor/inv-1",
  new URLSearchParams("tillbaka=/uppdrag/job-kok&tillbakaNamn=Köksrenovering"),
  { href: "/ekonomi?flik=fakturor", label: "Fakturor" }
);
assert.equal(backFromInvoice?.href, "/uppdrag/job-kok");
assert.equal(backFromInvoice?.label, "Köksrenovering");

const backFromNewQuote = resolveBack(
  "/ekonomi/offerter/ny",
  new URLSearchParams("job=job-kok"),
  { href: "/ekonomi?flik=offerter", label: "Offerter" }
);
assert.equal(backFromNewQuote?.href, "/uppdrag/job-kok");

console.log("nav checks ok");
