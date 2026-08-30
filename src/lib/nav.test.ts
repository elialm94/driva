process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  defaultBack,
  jobHref,
  isBackAwarePath,
  isInternalAppPath,
  isSectionActive,
  labelForHref,
  locationHref,
  originNodeMatching,
  resolveAppHref,
  resolveBack,
  sanitizeReturnTo,
  scrollKeyForHref,
  shouldStampOrigin,
  structuralCrumbs,
  visibleNavItems,
  withReturnTo,
} from "./nav";

describe("sanitizeReturnTo allowlist", () => {
  it("rejects external, protocol-relative and javascript URLs", () => {
    assert.equal(sanitizeReturnTo("https://evil.com"), null);
    assert.equal(sanitizeReturnTo("//evil.com"), null);
    assert.equal(sanitizeReturnTo("/\\evil"), null);
    assert.equal(sanitizeReturnTo("javascript:alert(1)"), null);
    assert.equal(sanitizeReturnTo("https://example.com/kunder"), null);
  });

  it("accepts app prefixes and rewrites legacy paths", () => {
    assert.equal(sanitizeReturnTo("/"), "/");
    assert.equal(sanitizeReturnTo("/kunder?flik=forfragningar&q=karin&sida=3"), "/kunder?flik=uppdrag&q=karin&sida=3");
    assert.equal(sanitizeReturnTo("/ekonomi?flik=fakturor"), "/ekonomi?flik=fakturor");
    assert.equal(sanitizeReturnTo("/pengar?flik=fakturor"), "/ekonomi?flik=fakturor");
    assert.equal(sanitizeReturnTo("/jobb/job-kok"), "/uppdrag/job-kok");
    assert.equal(sanitizeReturnTo("/uppdrag"), "/kunder?flik=uppdrag");
    assert.equal(sanitizeReturnTo("/uppdrag?q=kok"), "/kunder?q=kok&flik=uppdrag");
    assert.equal(sanitizeReturnTo("/assistent"), "/");
    assert.equal(sanitizeReturnTo("/kunder/forfragningar/req-karin"), "/uppdrag/req-karin");
    assert.equal(sanitizeReturnTo("/hemsida/doman"), "/hemsida/doman");
    assert.equal(sanitizeReturnTo("/installningar"), "/installningar");
    assert.equal(sanitizeReturnTo("/inbox"), "/inbox");
  });

  it("rejects unknown prefixes", () => {
    assert.equal(sanitizeReturnTo("/admin"), null);
    assert.equal(isInternalAppPath("/admin"), false);
    assert.equal(isInternalAppPath("/"), true);
    assert.equal(isInternalAppPath("/kunder"), true);
    assert.equal(isInternalAppPath("/inbox"), true);
  });
});

describe("canonical fallback", () => {
  it("maps detail routes to list parents", () => {
    assert.deepEqual(defaultBack("/inbox/req-karin"), {
      href: "/inbox",
      label: "Inbox",
    });
    assert.deepEqual(defaultBack("/kunder/forfragningar/req-karin"), {
      href: "/kunder?flik=uppdrag",
      label: "Uppdrag",
    });
    assert.deepEqual(defaultBack("/kunder/cust-karin"), {
      href: "/kunder?flik=kunder",
      label: "Kunder",
    });
    assert.deepEqual(defaultBack("/uppdrag/job-kok"), { href: "/kunder?flik=uppdrag", label: "Uppdrag" });
    assert.deepEqual(defaultBack("/ekonomi/fakturor/inv-1"), {
      href: "/ekonomi?flik=fakturor",
      label: "Fakturor",
    });
    assert.deepEqual(defaultBack("/ekonomi/offerter/q1"), {
      href: "/ekonomi?flik=offerter",
      label: "Offerter",
    });
    assert.deepEqual(defaultBack("/bokforing/moms"), { href: "/bokforing", label: "Bokföring" });
    assert.deepEqual(defaultBack("/hemsida/doman"), { href: "/hemsida", label: "Hemsida" });
    assert.deepEqual(defaultBack("/redovisning/k/biz-a"), { href: "/redovisning", label: "Arbeta" });
    assert.deepEqual(defaultBack("/redovisning/k/biz-a/bank"), { href: "/redovisning/k/biz-a", label: "Arbeta" });
    assert.equal(defaultBack("/"), null);
    assert.equal(defaultBack("/kunder"), null);
  });
});

describe("section active", () => {
  it("keeps uppdrag detail under Kunder and inbox as its own section", () => {
    assert.equal(isSectionActive("/uppdrag/job-kok", "/kunder"), true);
    assert.equal(isSectionActive("/uppdrag/job-kok", "/inbox"), false);
    assert.equal(isSectionActive("/inbox/req-karin", "/inbox"), true);
    assert.equal(isSectionActive("/inbox/req-karin", "/kunder"), false);
    assert.equal(isSectionActive("/kunder", "/kunder"), true);
  });
});

describe("origin labels", () => {
  it("uses tab labels for list origins", () => {
    assert.equal(labelForHref("/"), "Hem");
    assert.equal(labelForHref("/kunder?flik=forfragningar"), "Uppdrag");
    assert.equal(labelForHref("/kunder?flik=kunder"), "Kunder");
    assert.equal(labelForHref("/kunder?flik=uppdrag"), "Uppdrag");
    assert.equal(labelForHref("/ekonomi?flik=offerter"), "Offerter");
    assert.equal(labelForHref("/ekonomi?flik=fakturor"), "Fakturor");
    assert.equal(labelForHref("/inbox/req-karin"), "Inkorgspost");
    assert.equal(labelForHref("/kunder/cust-karin"), "Kund");
    assert.equal(labelForHref("/assistent"), "Hem");
    assert.equal(labelForHref("/inbox"), "Inbox");
  });
});

describe("stamp origin", () => {
  it("stamps Hem onto an enquiry opened from home", () => {
    const href = resolveAppHref("/inbox/req-karin", "/");
    assert.equal(href, withReturnTo("/inbox/req-karin", "/", "Hem"));
    assert.equal(shouldStampOrigin("/", "/inbox/req-karin"), true);
    const back = resolveBack("/inbox/req-karin", new URLSearchParams(href.split("?")[1]), defaultBack("/inbox/req-karin")!);
    assert.equal(back?.href, "/");
    assert.equal(back?.label, "Hem");
  });

  it("rewrites old enquiry paths when stamping", () => {
    const href = resolveAppHref("/kunder/forfragningar/req-karin", "/");
    assert.equal(shouldStampOrigin("/", "/kunder/forfragningar/req-karin"), true);
    const back = resolveBack(
      "/uppdrag/req-karin",
      new URLSearchParams(href.slice(href.indexOf("?") + 1)),
      defaultBack("/uppdrag/req-karin")!
    );
    assert.equal(back?.href, "/");
  });

  it("keeps inbox query state as origin", () => {
    const origin = "/inbox?q=karin&sida=2";
    const href = resolveAppHref("/inbox/req-karin", origin);
    assert.match(href, /tillbaka=/);
    const back = resolveBack(
      "/inbox/req-karin",
      new URLSearchParams(href.slice(href.indexOf("?") + 1)),
      defaultBack("/inbox/req-karin")!
    );
    assert.equal(back?.href, origin);
    assert.equal(back?.label, "Inbox");
  });

  it("rewrites old inbox query origin through tillbaka", () => {
    const origin = "/kunder?flik=forfragningar&q=karin&sida=2";
    const href = resolveAppHref("/inbox/req-karin", origin);
    const back = resolveBack(
      "/inbox/req-karin",
      new URLSearchParams(href.slice(href.indexOf("?") + 1)),
      defaultBack("/inbox/req-karin")!
    );
    assert.equal(back?.href, "/kunder?flik=uppdrag&q=karin&sida=2");
  });

  it("does not stamp list destinations or already-stamped hrefs", () => {
    assert.equal(shouldStampOrigin("/", "/inbox"), false);
    assert.equal(shouldStampOrigin("/", "/kunder?flik=forfragningar"), false);
    assert.equal(shouldStampOrigin("/", "/ekonomi?flik=fakturor"), false);
    const stamped = withReturnTo("/kunder/cust-1", "/", "Hem");
    assert.equal(shouldStampOrigin("/kunder?flik=kunder", stamped), false);
    assert.equal(resolveAppHref(stamped, "/kunder?flik=kunder"), stamped);
  });

  it("does not stamp invalid or external origins", () => {
    assert.equal(shouldStampOrigin("https://evil.com", "/kunder/cust-1"), false);
    assert.equal(resolveAppHref("/kunder/cust-1", "https://evil.com"), "/kunder/cust-1");
    assert.equal(resolveAppHref("/kunder/cust-1", "//evil.com"), "/kunder/cust-1");
  });

  it("breaks A→B→A by reusing the chain node", () => {
    const enquiryFromHome = resolveAppHref("/inbox/req-karin", "/");
    const customerFromEnquiry = resolveAppHref("/kunder/cust-karin", enquiryFromHome, "Inkorgspost");
    const backToEnquiry = resolveAppHref("/inbox/req-karin", customerFromEnquiry);
    assert.match(backToEnquiry, /^\/inbox\/req-karin\?tillbaka=/);
    const back = resolveBack(
      "/inbox/req-karin",
      new URLSearchParams(backToEnquiry.slice(backToEnquiry.indexOf("?") + 1)),
      defaultBack("/inbox/req-karin")!
    );
    assert.equal(back?.href, "/");
    assert.equal(originNodeMatching(customerFromEnquiry, "/inbox/req-karin"), backToEnquiry);
  });
});

describe("optional Hemsida in sidebar", () => {
  it("hides Hemsida when the website module is not visible", () => {
    const labels = visibleNavItems({ websiteNavVisible: false }).map((item) => item.label);
    assert.deepEqual(labels, ["Hem", "Kunder", "Ekonomi", "Inbox", "Bokföring", "Samarbeta"]);
  });

  it("keeps Hemsida after the module is activated", () => {
    const labels = visibleNavItems({ websiteNavVisible: true }).map((item) => item.label);
    assert.deepEqual(labels, ["Hem", "Kunder", "Ekonomi", "Inbox", "Bokföring", "Samarbeta", "Hemsida"]);
  });
});

describe("scroll keys", () => {
  it("keys to path+list query, not origin params", () => {
    assert.equal(scrollKeyForHref("/inbox?q=karin"), "driva:scroll:/inbox?q=karin");
    assert.equal(scrollKeyForHref("/kunder?flik=forfragningar&q=karin"), "driva:scroll:/kunder?flik=uppdrag&q=karin");
    assert.equal(scrollKeyForHref("/inbox?q=karin&tillbaka=/&tillbakaNamn=Hem"), "driva:scroll:/inbox?q=karin");
    assert.equal(scrollKeyForHref(locationHref("/", "")), "driva:scroll:/");
  });
});

describe("structural crumbs stay hierarchical", () => {
  it("does not follow origin history", () => {
    assert.deepEqual(structuralCrumbs("/inbox/req-karin", "Platsbyggd bokhylla i ek"), [
      { href: "/inbox", label: "Inbox" },
      { label: "Platsbyggd bokhylla i ek" },
    ]);
    assert.deepEqual(structuralCrumbs("/uppdrag/job-kok", "Köksrenovering"), [
      { href: "/kunder?flik=kunder", label: "Kunder" },
      { href: "/kunder?flik=uppdrag", label: "Uppdrag" },
      { label: "Köksrenovering" },
    ]);
    assert.equal(isBackAwarePath("/inbox/req-karin"), true);
    assert.equal(jobHref("job-karin"), "/uppdrag/job-karin");
  });
});
