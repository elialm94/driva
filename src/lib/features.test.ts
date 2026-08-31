process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb } from "./invoices/test-db";
import { LOCAL_JSON_BUSINESS_ID } from "./collaboration/actor";
import { putInvitation, putMembership, resetCollaborationRegistry } from "./collaboration/registry";
import { generateWebsite } from "./services/website";
import { visibleNavItems } from "./nav";
import {
  activateOptionalFeature,
  hasCollaborationUsage,
  hasWebsiteUsage,
  resolveOptionalFeatures,
} from "./features";
import type { CollaborationInvitation, Website } from "./types";

function draftSite(): Website {
  return {
    id: "s1",
    slug: "x",
    businessName: "X",
    tagline: "",
    status: "utkast",
    theme: "tra",
    sections: [],
    createdAt: new Date().toISOString(),
    submissions: 0,
  };
}

function invite(over: Partial<CollaborationInvitation> = {}): CollaborationInvitation {
  return {
    id: over.id ?? "inv-1",
    businessId: over.businessId ?? LOCAL_JSON_BUSINESS_ID,
    email: over.email ?? "anna@revisorn.se",
    role: over.role ?? "accounting_consultant",
    invitedByUserId: "owner-1",
    invitedByName: "Ägaren",
    tokenHash: "hash",
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    status: over.status ?? "pending",
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe("valfria funktioner: visibility", () => {
  beforeEach(() => {
    resetCollaborationRegistry();
    replaceDb(emptyTestDb());
  });

  it("nytt företag utan data döljer Hemsida och Samarbeta", () => {
    const features = resolveOptionalFeatures();
    assert.equal(features.website, false);
    assert.equal(features.collaboration, false);
    assert.deepEqual(
      visibleNavItems(features).map((i) => i.label),
      ["Hem", "Kunder", "Ekonomi", "Inbox", "Bokföring"],
    );
  });

  it("befintlig hemsida (utkast) visar Hemsida", () => {
    replaceDb(emptyTestDb({ website: draftSite() }));
    assert.equal(resolveOptionalFeatures().website, true);
    assert.ok(visibleNavItems(resolveOptionalFeatures()).some((i) => i.section === "hemsida"));
  });

  it("kopplad domän räknas som hemsideanvändning även utan website-rad", () => {
    assert.equal(hasWebsiteUsage({ website: null, domains: [{ hostname: "firma.se" } as never] }), true);
  });

  it("pending inbjudan eller ansluten konsult visar Samarbeta", () => {
    replaceDb(emptyTestDb({ collaborationInvitations: [invite()] }));
    assert.equal(resolveOptionalFeatures().collaboration, true);
    resetCollaborationRegistry();
    replaceDb(emptyTestDb());
    putMembership({
      businessId: LOCAL_JSON_BUSINESS_ID,
      businessName: "Test",
      userId: "acc-1",
      role: "accounting_consultant",
      acceptedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    assert.equal(hasCollaborationUsage({}, LOCAL_JSON_BUSINESS_ID), true);
    assert.equal(resolveOptionalFeatures().collaboration, true);
  });

  it("återkallad inbjudan utan konsult döljer Samarbeta", () => {
    replaceDb(
      emptyTestDb({
        collaborationInvitations: [invite({ status: "revoked", revokedAt: new Date().toISOString() })],
      }),
    );
    assert.equal(resolveOptionalFeatures().collaboration, false);
  });

  it("Aktivera visar nav utan att skapa hemsida eller inbjudan", () => {
    activateOptionalFeature("website");
    activateOptionalFeature("collaboration");
    const live = resolveOptionalFeatures();
    assert.equal(live.website, true);
    assert.equal(live.collaboration, true);
    assert.equal(db().website, null);
    assert.deepEqual(db().collaborationInvitations, []);
    assert.ok(visibleNavItems(live).some((i) => i.section === "hemsida"));
    assert.ok(visibleNavItems(live).some((i) => i.section === "samarbeta"));
  });

  it("genererad hemsida aktiverar Hemsida utan att röra Samarbeta", () => {
    generateWebsite("Hemsida för Test Stam i Stockholm. Vi bygger kök.");
    const features = resolveOptionalFeatures();
    assert.equal(features.website, true);
    assert.equal(features.collaboration, false);
    assert.ok(db().website);
  });

  it("Aktivera raderar inte befintlig hemsida", () => {
    generateWebsite("Hemsida för Test Stam i Stockholm. Vi bygger kök.");
    const before = db().website?.id;
    activateOptionalFeature("website");
    assert.equal(db().website?.id, before);
    assert.equal(db().website?.status, "utkast");
  });

  it("registry-inbjudan utan tenant-rad räknas som användning", () => {
    putInvitation(invite({ id: "reg-1" }));
    assert.equal(resolveOptionalFeatures().collaboration, true);
  });
});
