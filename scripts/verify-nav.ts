import assert from "node:assert/strict";
import {
  isSectionActive,
  labelForHref,
  matchRoute,
  resolveBack,
  sanitizeReturnTo,
  withReturnTo,
} from "../src/lib/nav";

assert.equal(sanitizeReturnTo("https://evil.com"), null);
assert.equal(sanitizeReturnTo("//evil.com"), null);
assert.equal(sanitizeReturnTo("/\\evil"), null);
assert.equal(sanitizeReturnTo("/pengar?flik=fakturor"), "/pengar?flik=fakturor");
assert.equal(sanitizeReturnTo("/jobb/job-kok"), "/uppdrag/job-kok");
assert.equal(sanitizeReturnTo("/uppdrag/job-kok"), "/uppdrag/job-kok");

const nested = withReturnTo("/pengar/fakturor/inv-1", "/pengar/offerter/q1?tillbaka=/uppdrag/job-kok&tillbakaNamn=Köksrenovering", "Offert #110");
assert.match(nested, /tillbaka=/);
assert.equal(isSectionActive("/pengar/fakturor/inv-1045", "/pengar"), true);
assert.equal(isSectionActive("/uppdrag/job-kok", "/uppdrag"), true);
assert.equal(isSectionActive("/pengar/fakturor/inv-1045", "/"), false);
assert.equal(isSectionActive("/", "/"), true);
assert.equal(matchRoute("/pengar/fakturor/abc")?.meta.backLabel, "Fakturor");
assert.equal(labelForHref("/pengar?flik=offerter"), "Offerter");

const backFromInvoice = resolveBack(
  "/pengar/fakturor/inv-1",
  new URLSearchParams("tillbaka=/uppdrag/job-kok&tillbakaNamn=Köksrenovering"),
  { href: "/pengar?flik=fakturor", label: "Fakturor" }
);
assert.equal(backFromInvoice?.href, "/uppdrag/job-kok");
assert.equal(backFromInvoice?.label, "Köksrenovering");

const backFromNewQuote = resolveBack(
  "/pengar/offerter/ny",
  new URLSearchParams("job=job-kok"),
  { href: "/pengar?flik=offerter", label: "Offerter" }
);
assert.equal(backFromNewQuote?.href, "/uppdrag/job-kok");

console.log("nav checks ok");
