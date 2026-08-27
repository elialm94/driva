process.env.DRIVA_TEST = "1";
process.env.DOMAIN_PROVIDER_MODE = "mock";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb } from "../store";
import { emptyTestDb, testCompany } from "../invoices/test-db";
import type { Domain, Website } from "../types";
import { searchDomain } from "./availability";
import { purchaseDomain, purchaseIdempotencyKey } from "./purchase";
import { advanceProvisioning, retryProvisioning } from "./provisioning";
import { startExistingDomain, verifyExistingDomain } from "./connect";
import { setAutoRenew, processRenewal, markRenewalFailed } from "./renewal";
import { resolvePublicSite, lookupHostname } from "./lookup";
import { parseHostnameInput } from "./hostname";
import { missingRegistrantFields } from "./profile";
import { DomainError } from "./errors";
import { CURRENT_BUSINESS_ID } from "./config";
import { resetMockRegistrar } from "./registrar/mock";
import { resetMockHosting } from "./hosting/mock";
import { resetMockBilling } from "./billing";
import { resetRegistrarCache } from "./registrar";
import { resetHostingCache } from "./hosting";
import { resetBillingCache } from "./billing";
import { enrichDomainView } from "./view";
import { normalizeDomains } from "./normalize";

const site: Website = {
  id: "site-test",
  slug: "test-snickeri",
  businessName: "Test Snickeri",
  tagline: "Test",
  status: "publicerad",
  theme: "tra",
  sections: [],
  createdAt: new Date().toISOString(),
  submissions: 0,
};

function reset(over: Parameters<typeof emptyTestDb>[0] = {}) {
  resetRegistrarCache();
  resetHostingCache();
  resetBillingCache();
  resetMockRegistrar();
  resetMockHosting();
  resetMockBilling();
  replaceDb(emptyTestDb({ website: site, ...over }));
}

async function pump(id: string, n = 8): Promise<Domain> {
  let d: Domain | undefined;
  for (let i = 0; i < n; i++) d = await advanceProvisioning(id);
  return d!;
}

describe("domän: sök", () => {
  beforeEach(() => reset());

  it("ledig .se med pris", async () => {
    const r = await searchDomain("sodermalmssnickeri");
    assert.equal(r.hostname, "sodermalmssnickeri.se");
    assert.equal(r.available, true);
    assert.equal(r.price?.customerPrice, 99);
  });

  it("upptagen .se med alternativ", async () => {
    const r = await searchDomain("google");
    assert.equal(r.available, false);
    assert.ok(r.alternatives.length >= 1);
    assert.ok(r.alternatives.every((a) => a.endsWith(".se")));
  });

  it("ogiltig tld och kort namn", async () => {
    await assert.rejects(() => searchDomain("foretag.com"), DomainError);
    await assert.rejects(() => searchDomain("a"), DomainError);
  });

  it("normaliserar www och sökväg", async () => {
    const p = parseHostnameInput("https://www.sodermalmssnickeri.se/om");
    assert.equal(p.hostname, "sodermalmssnickeri.se");
  });
});

describe("domän: köp", () => {
  beforeEach(() => reset());

  it("happy path till live", async () => {
    const d = await purchaseDomain("sodermalmssnickeri");
    assert.equal(d.billing.status, "paid");
    assert.equal(d.hostname, "sodermalmssnickeri.se");
    const live = await pump(d.id);
    assert.equal(live.status, "active");
    assert.equal(live.sslStatus, "active");
    assert.equal(live.autoRenew, true);
    assert.equal(live.isPrimary, true);
    const view = await enrichDomainView(live, testCompany());
    assert.equal(view.dnsChanges.length, 0);
  });

  it("idempotens: dubbelklick köper inte två gånger", async () => {
    const a = await purchaseDomain("samma");
    const b = await purchaseDomain("samma");
    assert.equal(a.id, b.id);
    assert.equal(a.idempotencyKey, purchaseIdempotencyKey("samma.se"));
    const { db } = await import("../store");
    assert.equal(db().domains.filter((x) => x.hostname === "samma.se").length, 1);
  });

  it("registrarfel efter betalning – inget andraköp", async () => {
    const d = await purchaseDomain("fail-register");
    assert.equal(d.billing.status, "paid");
    assert.equal(d.provisioning.registered, false);
    const again = await purchaseDomain("fail-register");
    assert.equal(again.id, d.id);
    const { db } = await import("../store");
    assert.equal(db().domains.length, 1);
  });

  it("betalningsfel köper inte", async () => {
    await assert.rejects(() => purchaseDomain("fail-betala"), DomainError);
    const { db } = await import("../store");
    const d = db().domains.find((x) => x.hostname === "fail-betala.se");
    assert.ok(d);
    assert.equal(d!.billing.status, "failed");
    assert.equal(d!.provisioning.registered, false);
  });

  it("saknad företagsuppgift stoppar köp", async () => {
    reset({ settings: testCompany({ orgNumber: "" }) });
    assert.ok(missingRegistrantFields().length > 0);
    await assert.rejects(() => purchaseDomain("nyttnamn"), (e: DomainError) => {
      assert.equal(e.category, "profile_incomplete");
      return true;
    });
  });
});

describe("domän: provisionering", () => {
  beforeEach(() => reset());

  it("hostingfel lämnar registrerad adress, retry köper inte igen", async () => {
    const d = await purchaseDomain("fail-hosting");
    const after = await pump(d.id, 4);
    assert.equal(after.provisioning.registered, true);
    assert.notEqual(after.status, "active");
    const { db } = await import("../store");
    const charges = db().domains[0].billing.chargeId;
    await retryProvisioning(d.id);
    assert.equal(db().domains.length, 1);
    assert.equal(db().domains[0].billing.chargeId, charges);
    assert.equal(db().domains[0].provisioning.registered, true);
  });

  it("pending dns blir inte live", async () => {
    const d = await purchaseDomain("pending-dns");
    const after = await pump(d.id, 6);
    assert.notEqual(after.status, "active");
    assert.equal(after.verificationStatus, "pending");
  });

  it("pending https väntar på ssl", async () => {
    const d = await purchaseDomain("pending-https");
    const after = await pump(d.id, 6);
    assert.equal(after.provisioning.dnsVerified, true);
    assert.notEqual(after.status, "active");
    assert.equal(after.sslStatus, "pending");
  });
});

describe("domän: multi-tenant och unik hostname", () => {
  beforeEach(() => reset());

  it("hostname är unik och blockerar takeover", async () => {
    const d = await purchaseDomain("unikt");
    await pump(d.id);
    const { db } = await import("../store");
    db().domains[0].businessId = "other-biz";
    await assert.rejects(() => purchaseDomain("unikt"), DomainError);
    assert.equal(db().domains.length, 1);
  });

  it("host-uppslagning ger sajt + företag", async () => {
    const d = await purchaseDomain("sodermalmssnickeri");
    await pump(d.id);
    const hit = resolvePublicSite("sodermalmssnickeri.se");
    assert.ok(hit);
    assert.equal(hit!.website.id, "site-test");
    assert.equal(hit!.canonicalHostname, "sodermalmssnickeri.se");
    assert.equal(lookupHostname("www.sodermalmssnickeri.se")?.id, d.id);
    assert.equal(resolvePublicSite("localhost"), null);
  });
});

describe("domän: förnyelse", () => {
  beforeEach(() => reset());

  it("auto-förnyelse av och på", async () => {
    const d = await purchaseDomain("fornya");
    await pump(d.id);
    const off = await setAutoRenew(d.id, false);
    assert.equal(off.autoRenew, false);
    const on = await setAutoRenew(d.id, true);
    assert.equal(on.autoRenew, true);
  });

  it("förnyelsefel sätter varning", async () => {
    const d = await purchaseDomain("fail-fornya");
    await pump(d.id);
    await assert.rejects(() => processRenewal(d.id), DomainError);
    const { db } = await import("../store");
    assert.equal(db().domains[0].billing.status, "renewal_failed");
    markRenewalFailed(d.id);
    assert.equal(db().domains[0].billing.status, "renewal_failed");
  });
});

describe("domän: befintlig adress", () => {
  beforeEach(() => reset());

  it("visar CNAME och kan verifieras", async () => {
    const setup = await startExistingDomain("mittforetag.se");
    assert.ok(setup.dnsChanges.some((r) => r.type === "CNAME"));
    const view = await enrichDomainView(setup.domain, testCompany());
    assert.ok(view.dnsChanges.some((r) => r.type === "CNAME"));
    assert.equal(view.live, false);
    const live = await verifyExistingDomain(setup.domain.id);
    assert.equal(live.status, "active");
    const liveView = await enrichDomainView(live, testCompany());
    assert.equal(liveView.dnsChanges.length, 0);
  });

  it("misslyckad verify på pending-dns", async () => {
    const setup = await startExistingDomain("pending-dns.se");
    await assert.rejects(() => verifyExistingDomain(setup.domain.id), DomainError);
  });
});

describe("domän: business id", () => {
  it("använder current business", () => {
    assert.equal(CURRENT_BUSINESS_ID, "biz-current");
  });
});

describe("domän: normalize", () => {
  it("skapar tomma domains om fältet saknas", () => {
    const data: { domains?: unknown; domainAudit?: unknown } = {};
    const changed = normalizeDomains(data);
    assert.equal(changed, true);
    assert.deepEqual(data.domains, []);
    assert.deepEqual(data.domainAudit, []);
  });
});
