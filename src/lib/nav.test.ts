process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BOKFORING_PREFETCH_HREFS,
  bokforingDetailTabForPath,
  defaultBack,
  jobHref,
  isBackAwarePath,
  isInternalAppPath,
  isSectionActive,
  isSettingsPath,
  isSupportPath,
  labelForHref,
  locationHref,
  originNodeMatching,
  resolveAppHref,
  resolveBack,
  sanitizeReturnTo,
  scrollKeyForHref,
  shouldStampOrigin,
  structuralCrumbs,
  hrefFromOrigin,
  hrefWithNav,
  pageOrigin,
  returnNavFromSearch,
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

describe("bokföring tab paths", () => {
  it("maps each accounting URL to its workspace tab", () => {
    assert.equal(bokforingDetailTabForPath("/bokforing"), "oversikt");
    assert.equal(bokforingDetailTabForPath("/bokforing/verifikationer"), "verifikationer");
    assert.equal(bokforingDetailTabForPath("/bokforing/huvudbok"), "huvudbok");
    assert.equal(bokforingDetailTabForPath("/bokforing/resultat"), "rapporter");
    assert.equal(bokforingDetailTabForPath("/bokforing/saldobalans"), "rapporter");
    assert.equal(bokforingDetailTabForPath("/bokforing/balans"), "rapporter");
    assert.equal(bokforingDetailTabForPath("/bokforing/moms"), "moms");
    assert.equal(bokforingDetailTabForPath("/bokforing/bokslut"), "bokslut");
    assert.equal(bokforingDetailTabForPath("/bokforing/detaljer"), "verifikationer");
    assert.equal(bokforingDetailTabForPath("/kunder"), null);
  });

  it("prefetches overview, detail tabs and report subviews", () => {
    assert.ok(BOKFORING_PREFETCH_HREFS.includes("/bokforing"));
    assert.ok(BOKFORING_PREFETCH_HREFS.includes("/bokforing/verifikationer"));
    assert.ok(BOKFORING_PREFETCH_HREFS.includes("/bokforing/moms"));
    assert.ok(BOKFORING_PREFETCH_HREFS.includes("/bokforing/saldobalans"));
    assert.ok(BOKFORING_PREFETCH_HREFS.includes("/bokforing/balans"));
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

  it("marks footer routes without treating them as primary sections", () => {
    assert.equal(isSettingsPath("/installningar"), true);
    assert.equal(isSettingsPath("/installningar?flik=konto"), true);
    assert.equal(isSettingsPath("/foretag"), true);
    assert.equal(isSettingsPath("/kunder"), false);
    assert.equal(isSupportPath("/support"), true);
    assert.equal(isSupportPath("/support?fran=%2Fkunder"), true);
    assert.equal(isSupportPath("/installningar"), false);
    assert.equal(isSectionActive("/support", "/kunder"), false);
    assert.equal(isSectionActive("/installningar", "/kunder"), false);
  });

  it("keeps sidebar and footer selected styles on the same soft fill", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const nav = readFileSync(join(here, "../components/nav.tsx"), "utf8");
    const settings = readFileSync(join(here, "../components/settings-form.tsx"), "utf8");
    assert.match(nav, /SIDEBAR_LINK_ACTIVE = "bg-ink\/5 font-medium text-ink"/);
    assert.match(nav, /SHEET_LINK_ACTIVE = "bg-ink\/5 font-medium text-ink"/);
    assert.doesNotMatch(nav, /bg-ink text-white font-medium shadow-sm/);
    assert.match(settings, /rounded-2xl bg-ink\/4 p-1/);
    assert.match(settings, /active \? "bg-card text-ink shadow-sm"/);
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

describe("komplettera from a document returns to that document", () => {
  function pathOf(href: string): string {
    return href.split("?")[0] ?? href;
  }

  it("customer email from a quote opened via Ekonomi goes back to the quote", () => {
    const quote = pageOrigin(
      "/ekonomi/offerter/q1",
      new URLSearchParams("tillbaka=/ekonomi&tillbakaNamn=Ekonomi"),
      "Offert #6"
    );
    const href = hrefFromOrigin("/kunder/cust-eli#kund-epost", quote);
    assert.match(href, /#kund-epost$/);
    const back = resolveBack(
      "/kunder/cust-eli",
      new URLSearchParams(href.slice(href.indexOf("?") + 1).replace(/#.*$/, "")),
      defaultBack("/kunder/cust-eli")!
    );
    assert.equal(back?.label, "Offert #6");
    assert.equal(pathOf(back?.href ?? ""), "/ekonomi/offerter/q1");
  });

  it("stamps Inställningar from a quote so company blockers return here", () => {
    const origin = "/ekonomi/offerter/q1?tillbaka=/ekonomi&tillbakaNamn=Ekonomi";
    assert.equal(shouldStampOrigin(origin, "/installningar?flik=foretag"), true);
    assert.equal(isBackAwarePath("/installningar"), true);
    const href = resolveAppHref("/installningar?flik=foretag", origin, "Offert #6");
    const back = resolveBack("/installningar", new URLSearchParams(href.slice(href.indexOf("?") + 1)), {
      href: "/",
      label: "Tillbaka",
    });
    assert.equal(pathOf(back?.href ?? ""), "/ekonomi/offerter/q1");
    assert.equal(back?.label, "Offert #6");
  });

  it("keeps hash when stamping tillbaka", () => {
    const href = withReturnTo("/kunder/cust-1#kund-epost", "/ekonomi/offerter/q1", "Offert #6");
    assert.match(href, /^\/kunder\/cust-1\?tillbaka=/);
    assert.match(href, /#kund-epost$/);
  });

  it("does not leak the dest hash into the back label after AppLink rewrite", () => {
    const quote = pageOrigin(
      "/ekonomi/offerter/q1",
      new URLSearchParams("tillbaka=/ekonomi&tillbakaNamn=Ekonomi"),
      "Offert #6"
    );
    const stamped = hrefFromOrigin("/kunder/cust-eva#kund-personnummer", quote);
    const rewritten = resolveAppHref(stamped, "/ekonomi", "Ekonomi");
    assert.match(rewritten, /#kund-personnummer$/);
    assert.equal(rewritten.includes("kund-personnummer&"), false);
    const back = resolveBack(
      "/kunder/cust-eva",
      new URLSearchParams(rewritten.slice(rewritten.indexOf("?") + 1).replace(/#.*$/, "")),
      defaultBack("/kunder/cust-eva")!
    );
    assert.equal(back?.label, "Offert #6");
  });

  it("edit href keeps the quote parent so Back after redigera is still Ekonomi", () => {
    const incoming = returnNavFromSearch(new URLSearchParams("tillbaka=/ekonomi&tillbakaNamn=Ekonomi"));
    const edit = hrefWithNav("/ekonomi/offerter/q1/redigera", incoming);
    const quoteAgain = hrefWithNav(
      "/ekonomi/offerter/q1",
      returnNavFromSearch(new URLSearchParams(edit.slice(edit.indexOf("?") + 1)))
    );
    const back = resolveBack(
      "/ekonomi/offerter/q1",
      new URLSearchParams(quoteAgain.slice(quoteAgain.indexOf("?") + 1)),
      defaultBack("/ekonomi/offerter/q1")!
    );
    assert.equal(back?.href, "/ekonomi");
    assert.equal(back?.label, "Ekonomi");
  });

  it("maps inbox kontrollera to the inbox item", () => {
    assert.deepEqual(defaultBack("/inbox/mail-1/kontrollera"), {
      href: "/inbox/mail-1",
      label: "Inkorgspost",
    });
    assert.equal(shouldStampOrigin("/inbox/mail-1", "/inbox/mail-1/kontrollera"), true);
  });
});
