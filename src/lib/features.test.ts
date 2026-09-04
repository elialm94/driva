process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb } from "./invoices/test-db";
import { LOCAL_JSON_BUSINESS_ID } from "./collaboration/actor";
import { putInvitation, putMembership, resetCollaborationRegistry, activeMembershipFor, invitationById, upsertUser } from "./collaboration/registry";
import { generateWebsite, publishWebsite, submitContactForm } from "./services/website";
import { visibleNavItems } from "./nav";
import { executeTool } from "./ai/tools";
import {
  activateOptionalFeature,
  deactivateOptionalFeature,
  hasCollaborationUsage,
  hasWebsiteUsage,
  isWebsitePubliclyLive,
  resolveOptionalFeatures,
  shouldShowWebsiteRestoreNotice,
} from "./features";
import {
  listFormerSamarbetaPeople,
  logCollaborationFeatureEnabled,
  restoreCollaboratorAccess,
  revokeCollaborationAccessForFeatureOff,
} from "./collaboration/service";
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
      ["Hem", "Uppdrag", "Kunder", "Ekonomi", "Inbox", "Bokföring"],
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
    upsertUser({ id: "acc-1", email: "anna@revisorn.se", name: "Anna Andersson" });
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

describe("valfria funktioner: stäng av och aktivera igen", () => {
  beforeEach(() => {
    resetCollaborationRegistry();
    replaceDb(emptyTestDb());
  });

  it("explicit avstängd hemsida döljer nav trots att data finns", () => {
    replaceDb(emptyTestDb({ website: draftSite() }));
    assert.equal(resolveOptionalFeatures().website, true);
    deactivateOptionalFeature("website");
    assert.equal(resolveOptionalFeatures().website, false);
    assert.equal(db().website?.id, "s1");
    assert.equal(db().website?.status, "utkast");
    assert.ok(db().meta.websitePausedAt);
    assert.ok(!visibleNavItems(resolveOptionalFeatures()).some((i) => i.section === "hemsida"));
  });

  it("stäng av publicerad hemsida pausar den publika sajten utan att avpublicera", () => {
    const published: Website = { ...draftSite(), status: "publicerad", publishedAt: new Date().toISOString() };
    replaceDb(emptyTestDb({ website: published }));
    activateOptionalFeature("website");
    assert.equal(isWebsitePubliclyLive(), true);
    deactivateOptionalFeature("website");
    assert.equal(db().website?.status, "publicerad");
    assert.equal(db().website?.publishedAt, published.publishedAt);
    assert.equal(isWebsitePubliclyLive(), false);
    assert.ok(db().meta.websitePausedAt);
  });

  it("aktivera igen återställer menyn men publicerar inte automatiskt", () => {
    const published: Website = { ...draftSite(), status: "publicerad", publishedAt: "2026-01-01T00:00:00.000Z" };
    replaceDb(emptyTestDb({ website: published }));
    deactivateOptionalFeature("website");
    activateOptionalFeature("website");
    assert.equal(resolveOptionalFeatures().website, true);
    assert.ok(visibleNavItems(resolveOptionalFeatures()).some((i) => i.section === "hemsida"));
    assert.equal(isWebsitePubliclyLive(), false);
    assert.ok(shouldShowWebsiteRestoreNotice());
    assert.equal(db().website?.status, "publicerad");
  });

  it("publicera tar bort pausen så sajten blir live", () => {
    const published: Website = { ...draftSite(), status: "publicerad", publishedAt: new Date().toISOString() };
    replaceDb(emptyTestDb({ website: published }));
    deactivateOptionalFeature("website");
    activateOptionalFeature("website");
    publishWebsite();
    assert.equal(isWebsitePubliclyLive(), true);
    assert.equal(db().meta.websitePausedAt, undefined);
  });

  it("stäng av Samarbeta återkallar konsult och pending inbjudan men raderar inte historik", async () => {
    const pending = invite();
    replaceDb(emptyTestDb({ collaborationInvitations: [pending] }));
    putInvitation(pending);
    putMembership({
      businessId: LOCAL_JSON_BUSINESS_ID,
      businessName: "Test",
      userId: "acc-1",
      role: "accounting_consultant",
      acceptedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    upsertUser({ id: "acc-1", email: "anna@revisorn.se", name: "Anna Andersson" });
    activateOptionalFeature("collaboration");
    deactivateOptionalFeature("collaboration");
    await revokeCollaborationAccessForFeatureOff({
      businessId: LOCAL_JSON_BUSINESS_ID,
      revokedByUserId: "owner-1",
      revokedByName: "Ägaren",
    });
    assert.equal(resolveOptionalFeatures().collaboration, false);
    assert.ok(!visibleNavItems(resolveOptionalFeatures()).some((i) => i.section === "samarbeta"));
    assert.equal(activeMembershipFor("acc-1", LOCAL_JSON_BUSINESS_ID), undefined);
    const storedInvite = invitationById(pending.id);
    assert.ok(storedInvite?.revokedAt);
    assert.equal(listFormerSamarbetaPeople(LOCAL_JSON_BUSINESS_ID).some((p) => p.userId === "acc-1"), true);
    const actions = db().auditTrail.map((e) => e.action);
    assert.ok(actions.includes("samarbete_avstangd"));
    assert.ok(actions.includes("samarbete_aterkallad"));
  });

  it("aktivera Samarbeta återställer inte åtkomst tyst", async () => {
    putMembership({
      businessId: LOCAL_JSON_BUSINESS_ID,
      businessName: "Test",
      userId: "acc-1",
      role: "accounting_consultant",
      acceptedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    upsertUser({ id: "acc-1", email: "anna@revisorn.se", name: "Anna Andersson" });
    deactivateOptionalFeature("collaboration");
    await revokeCollaborationAccessForFeatureOff({
      businessId: LOCAL_JSON_BUSINESS_ID,
      revokedByUserId: "owner-1",
      revokedByName: "Ägaren",
    });
    activateOptionalFeature("collaboration");
    logCollaborationFeatureEnabled("Ägaren", "owner-1");
    assert.equal(resolveOptionalFeatures().collaboration, true);
    assert.equal(activeMembershipFor("acc-1", LOCAL_JSON_BUSINESS_ID), undefined);
    const restored = await restoreCollaboratorAccess({
      businessId: LOCAL_JSON_BUSINESS_ID,
      targetUserId: "acc-1",
      restoredByUserId: "owner-1",
      restoredByName: "Ägaren",
    });
    assert.equal(restored.name.length > 0, true);
    assert.ok(activeMembershipFor("acc-1", LOCAL_JSON_BUSINESS_ID));
    assert.ok(db().auditTrail.some((e) => e.action === "samarbete_aterstalld"));
    assert.ok(db().auditTrail.some((e) => e.action === "samarbete_aktiverad"));
  });

  it("öppna hemsida när funktionen är avstängd aktiverar inte tyst", async () => {
    activateOptionalFeature("website");
    deactivateOptionalFeature("website");
    const result = await executeTool("activate_website", {}, { origin: "user" });
    assert.equal(result.ok, true);
    assert.equal(result.activateFeature?.id, "website");
    assert.match(result.text ?? "", /avstängd/i);
    assert.equal(result.href, undefined);
    assert.equal(resolveOptionalFeatures().website, false);
  });

  it("bjuda in revisor när Samarbeta är avstängt aktiverar inte tyst", async () => {
    activateOptionalFeature("collaboration");
    deactivateOptionalFeature("collaboration");
    const result = await executeTool("activate_collaboration", {}, { origin: "user" });
    assert.equal(result.ok, true);
    assert.equal(result.activateFeature?.id, "collaboration");
    assert.match(result.text ?? "", /avstängd/i);
    assert.equal(resolveOptionalFeatures().collaboration, false);
  });

  it("kontaktformuläret tar inte emot när Hemsida är avstängd", async () => {
    const published: Website = { ...draftSite(), status: "publicerad", publishedAt: new Date().toISOString() };
    replaceDb(emptyTestDb({ website: published }));
    deactivateOptionalFeature("website");
    await assert.rejects(
      () => submitContactForm({ name: "K", email: "k@test.se", message: "Hej vi vill bygga altan." }),
      /inte emot/,
    );
  });
});

