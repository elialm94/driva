process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb } from "./invoices/test-db";
import type { Website } from "./types";
import { hasUnpublishedWebsiteDrafts } from "./website-drafts";
import { publishWebsite, setWebsiteDesign, setWebsiteFooter } from "./services/website";

function testWebsite(over: Partial<Website> = {}): Website {
  return {
    id: "site-drafts",
    slug: "almqvist-snickeri",
    businessName: "Almqvist Snickarfirma",
    tagline: "Platsbyggt",
    city: "Stockholm",
    status: "publicerad",
    theme: "tra",
    publishedAt: "2026-01-01T08:00:00.000Z",
    createdAt: "2025-12-01T08:00:00.000Z",
    submissions: 0,
    sections: [
      { id: "s-hero", type: "hero", heading: "Platsbyggt", body: "Vi bygger kök.", visible: true },
    ],
    ...over,
  };
}

describe("hasUnpublishedWebsiteDrafts", () => {
  beforeEach(() => {
    replaceDb(emptyTestDb({ website: testWebsite() }));
  });

  it("är false när den publicerade sajten saknar utkast", () => {
    assert.equal(hasUnpublishedWebsiteDrafts(db().website!), false);
  });

  it("räknar inte en aldrig-publicerad sajt som opublicerade ändringar", () => {
    replaceDb(emptyTestDb({ website: testWebsite({ status: "utkast", publishedAt: undefined }) }));
    assert.equal(hasUnpublishedWebsiteDrafts(db().website!), false);
  });

  it("är true när sidfot eller utseende skiljer sig från det publicerade", () => {
    setWebsiteFooter({ showPhone: false });
    assert.equal(hasUnpublishedWebsiteDrafts(db().website!), true);
    publishWebsite();
    assert.equal(hasUnpublishedWebsiteDrafts(db().website!), false);
    setWebsiteDesign({ themeId: "modern", accent: "bla" });
    assert.equal(hasUnpublishedWebsiteDrafts(db().website!), true);
  });
});
