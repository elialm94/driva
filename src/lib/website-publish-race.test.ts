process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb } from "./invoices/test-db";
import type { Website } from "./types";
import { hasUnpublishedWebsiteDrafts } from "./website-drafts";
import { publishedWebsiteDesign, draftWebsiteDesign } from "./website-design";
import { publishedWebsiteFooter } from "./website-footer";
import { publishedPrivacyPolicyState } from "./website-privacy";
import {
  addWebsiteSection,
  publishWebsite,
  publishedWebsiteSnapshot,
  reorderSections,
  restorePublishedWebsiteDraft,
  setSectionVisible,
  setWebsiteDesign,
  setWebsiteFooter,
  updateSection,
  updateWebsitePrivacyPolicy,
} from "./services/website";
import { draftPrimaryCtaLabel, draftWebsiteSections, websiteDraftView } from "./website-drafts";
import { acceptWebsiteWrite, isStaleWebsiteWrite } from "./website-publish";

function testWebsite(over: Partial<Website> = {}): Website {
  return {
    id: "site-publish-race",
    slug: "test-snickeri",
    businessName: "Test Snickeri",
    tagline: "Hantverk som håller",
    city: "Stockholm",
    status: "publicerad",
    theme: "tra",
    design: { themeId: "modern", accent: "bla" },
    publishedAt: "2026-01-01T08:00:00.000Z",
    createdAt: "2025-12-01T08:00:00.000Z",
    submissions: 0,
    draftRevision: 0,
    publishedRevision: 0,
    sections: [
      { id: "s-hero", type: "hero", heading: "Hantverk som håller", body: "Vi bygger kök.", visible: true },
      { id: "s-om", type: "om", heading: "Om oss", body: "Två snickare.", visible: true },
      { id: "s-kontakt", type: "kontakt", heading: "Kontakt", body: "Hör av dig.", visible: true },
    ],
    primaryCta: { label: "Begär offert" },
    ...over,
  };
}

describe("hemsida: publicera synligt redigerarläge utan att vänta på autosave", () => {
  beforeEach(() => {
    replaceDb(emptyTestDb({ website: testWebsite() }));
  });

  it("publicerar nytt tema direkt – utan föregående setWebsiteDesign", () => {
    const before = db().website!;
    assert.equal(publishedWebsiteDesign(before).themeId, "modern");
    assert.equal(hasUnpublishedWebsiteDrafts(before), false);

    // Repro: byt tema i UI och klicka Publicera innan utkastet hunnit sparas.
    const published = publishWebsite({
      revision: 1,
      design: { themeId: "klassisk", accent: "bla" },
    });

    assert.equal(publishedWebsiteDesign(published).themeId, "klassisk");
    assert.equal(publishedWebsiteDesign(published).accent, "bla");
    assert.equal(published.draftDesign, undefined);
    assert.equal(hasUnpublishedWebsiteDrafts(published), false);
    assert.equal(published.publishedRevision, 1);
    assert.ok(published.publishedAt);
    assert.notEqual(published.publishedAt, "2026-01-01T08:00:00.000Z");
    const snap = publishedWebsiteSnapshot(published);
    assert.equal(snap.hasUnpublishedDrafts, false);
    assert.equal(snap.design.themeId, "klassisk");
  });

  it("en sen tema-save efter publicering skapar inte utkast igen", () => {
    publishWebsite({
      revision: 1,
      design: { themeId: "klassisk", accent: "tegel" },
    });
    assert.equal(hasUnpublishedWebsiteDrafts(db().website!), false);

    const afterLateSave = setWebsiteDesign({ themeId: "klassisk", accent: "tegel" }, { clientRevision: 1 });
    assert.equal(afterLateSave.themeId, "klassisk");
    assert.equal(db().website!.draftDesign, undefined);
    assert.equal(hasUnpublishedWebsiteDrafts(db().website!), false);

    setWebsiteDesign({ themeId: "minimal", accent: "svart" }, { clientRevision: 0 });
    assert.equal(hasUnpublishedWebsiteDrafts(db().website!), false);
    assert.equal(publishedWebsiteDesign(db().website!).themeId, "klassisk");
  });

  it("publicerar flera fält som ändrats snabbt utan att vänta på save", () => {
    const published = publishWebsite({
      revision: 4,
      design: { themeId: "robust", accent: "sand" },
      footer: { showPhone: false, showEmail: true, showAddress: true, showServices: true, showLogo: true },
      privacyPolicy: { mode: "standard", supplement: "Vi sparar bara det som behövs för offerten." },
      sectionOrder: ["s-hero", "s-kontakt", "s-om"],
      sectionVisibility: [
        { id: "s-hero", visible: true },
        { id: "s-om", visible: false },
        { id: "s-kontakt", visible: true },
      ],
      sectionUpdates: [{ id: "s-hero", heading: "Nytt kök på tre veckor", primaryCtaLabel: "Kontakta oss" }],
      primaryCtaLabel: "Kontakta oss",
    });

    assert.equal(publishedWebsiteDesign(published).themeId, "robust");
    assert.equal(publishedWebsiteDesign(published).accent, "sand");
    assert.equal(publishedWebsiteFooter(published).showPhone, false);
    assert.equal(publishedPrivacyPolicyState(published).supplement, "Vi sparar bara det som behövs för offerten.");
    assert.deepEqual(
      published.sections.map((s) => s.id),
      ["s-hero", "s-kontakt", "s-om"],
    );
    assert.equal(published.sections.find((s) => s.id === "s-om")?.visible, false);
    assert.equal(published.sections.find((s) => s.id === "s-hero")?.heading, "Nytt kök på tre veckor");
    assert.equal(published.primaryCta?.label, "Kontakta oss");
    assert.equal(hasUnpublishedWebsiteDrafts(published), false);
    assert.equal(published.publishedRevision, 4);
  });

  it("behåller nyare klientändringar om en äldre publicering landar först", () => {
    setWebsiteDesign({ themeId: "minimal", accent: "svart" }, { clientRevision: 2 });
    assert.equal(db().website!.draftRevision, 2);

    publishWebsite({
      revision: 1,
      design: { themeId: "klassisk", accent: "tegel" },
    });

    const site = db().website!;
    assert.equal(publishedWebsiteDesign(site).themeId, "klassisk");
    assert.equal(draftWebsiteDesign(site).themeId, "minimal");
    assert.equal(hasUnpublishedWebsiteDrafts(site), true);
    assert.equal(site.publishedRevision, 1);
    assert.equal(site.draftRevision, 2);
  });

  it("behåller utkast om publicering misslyckas", () => {
    setWebsiteDesign({ themeId: "robust", accent: "sand" }, { clientRevision: 1 });
    const before = structuredClone(db().website!);

    assert.throws(
      () =>
        publishWebsite({
          revision: 2,
          design: { themeId: "neon", accent: "tegel" } as unknown as { themeId: "modern"; accent: "tegel" },
        }),
      /Okänt tema/,
    );

    const after = db().website!;
    assert.deepEqual(draftWebsiteDesign(after), draftWebsiteDesign(before));
    assert.equal(publishedWebsiteDesign(after).themeId, "modern");
    assert.equal(hasUnpublishedWebsiteDrafts(after), true);
    assert.equal(after.publishedAt, before.publishedAt);
  });

  it("ignorerar sen sektions-save efter publicering av samma revision", () => {
    publishWebsite({
      revision: 3,
      design: { themeId: "klassisk", accent: "bla" },
      sectionUpdates: [{ id: "s-hero", heading: "Publicerad rubrik" }],
    });
    updateSection("s-hero", { heading: "Gammal sen save" }, { clientRevision: 3 });
    assert.equal(db().website!.sections.find((s) => s.id === "s-hero")?.heading, "Publicerad rubrik");
    setSectionVisible("s-om", false, { clientRevision: 2 });
    assert.equal(db().website!.sections.find((s) => s.id === "s-om")?.visible, true);
  });
});

describe("hemsida: utkast är en trygg arbetsyta", () => {
  beforeEach(() => {
    replaceDb(emptyTestDb({ website: testWebsite() }));
  });

  it("sektionsändringar på publicerad sajt rör inte den publika sajten", () => {
    updateSection("s-hero", { heading: "Nytt kök på tre veckor" }, { clientRevision: 1 });
    reorderSections(["s-kontakt", "s-hero", "s-om"], { clientRevision: 2 });
    const site = db().website!;
    // Publikt: orört. Utkast: ändrat.
    assert.equal(site.sections.find((s) => s.id === "s-hero")?.heading, "Hantverk som håller");
    assert.deepEqual(site.sections.map((s) => s.id), ["s-hero", "s-om", "s-kontakt"]);
    const draft = draftWebsiteSections(site);
    assert.equal(draft.find((s) => s.id === "s-hero")?.heading, "Nytt kök på tre veckor");
    assert.deepEqual(draft.map((s) => s.id), ["s-kontakt", "s-hero", "s-om"]);
    assert.equal(hasUnpublishedWebsiteDrafts(site), true);
  });

  it("Publicera utan snapshot tar sektionsutkastet i produktion", () => {
    updateSection("s-hero", { heading: "Publicera mig" }, { clientRevision: 1 });
    addWebsiteSection("cta", { clientRevision: 2 });
    const published = publishWebsite();
    assert.equal(published.sections.find((s) => s.id === "s-hero")?.heading, "Publicera mig");
    assert.ok(published.sections.some((s) => s.type === "cta"));
    assert.equal(published.draftSections, undefined);
    assert.equal(hasUnpublishedWebsiteDrafts(published), false);
  });

  it("återgång till publicerat innehåll lämnar inga falska utkast", () => {
    updateSection("s-hero", { heading: "Tillfälligt" }, { clientRevision: 1 });
    assert.equal(hasUnpublishedWebsiteDrafts(db().website!), true);
    updateSection("s-hero", { heading: "Hantverk som håller" }, { clientRevision: 2 });
    assert.equal(db().website!.draftSections, undefined);
    assert.equal(hasUnpublishedWebsiteDrafts(db().website!), false);
  });
});

describe("hemsida: Återställ slänger alla opublicerade ändringar", () => {
  beforeEach(() => {
    replaceDb(emptyTestDb({ website: testWebsite() }));
  });

  it("återställer tema, sidfot, policy, sektioner och CTA till publicerat", () => {
    const before = structuredClone(db().website!);
    setWebsiteDesign({ themeId: "minimal", accent: "svart" }, { clientRevision: 1 });
    setWebsiteFooter({ showPhone: false }, { clientRevision: 2 });
    updateWebsitePrivacyPolicy({ mode: "standard", supplement: "Utkast." }, { clientRevision: 3 });
    updateSection("s-hero", { heading: "Utkastrubrik", primaryCtaLabel: "Ring oss" }, { clientRevision: 4 });
    assert.equal(hasUnpublishedWebsiteDrafts(db().website!), true);

    const restored = restorePublishedWebsiteDraft();

    assert.equal(hasUnpublishedWebsiteDrafts(restored), false);
    assert.equal(restored.draftDesign, undefined);
    assert.equal(restored.draftFooter, undefined);
    assert.equal(restored.draftPrivacyPolicy, undefined);
    assert.equal(restored.draftSections, undefined);
    assert.equal(restored.draftPrimaryCta, undefined);
    // Utkastvyn == publicerade sajten, och publicerat innehåll är orört.
    assert.deepEqual(websiteDraftView(restored).sections, before.sections);
    assert.equal(draftPrimaryCtaLabel(restored), "Begär offert");
    assert.equal(publishedWebsiteDesign(restored).themeId, "modern");
    assert.equal(restored.publishedAt, before.publishedAt);
  });

  it("en sen autosave efter Återställ kan inte återskapa utkastet", () => {
    setWebsiteDesign({ themeId: "minimal", accent: "svart" }, { clientRevision: 1 });
    updateSection("s-hero", { heading: "Utkastrubrik" }, { clientRevision: 2 });
    const restored = restorePublishedWebsiteDraft();
    const staleRevision = restored.publishedRevision!; // äldre eller samma som spärren

    setWebsiteDesign({ themeId: "minimal", accent: "svart" }, { clientRevision: staleRevision });
    updateSection("s-hero", { heading: "Sen save" }, { clientRevision: staleRevision - 1 });
    setWebsiteFooter({ showPhone: false }, { clientRevision: 1 });

    const site = db().website!;
    assert.equal(hasUnpublishedWebsiteDrafts(site), false);
    assert.equal(site.sections.find((s) => s.id === "s-hero")?.heading, "Hantverk som håller");
    assert.equal(publishedWebsiteDesign(site).themeId, "modern");
  });

  it("nya ändringar EFTER Återställ fungerar som vanligt", () => {
    restorePublishedWebsiteDraft();
    const next = (db().website!.publishedRevision ?? 0) + 1;
    setWebsiteDesign({ themeId: "robust", accent: "sand" }, { clientRevision: next });
    assert.equal(hasUnpublishedWebsiteDrafts(db().website!), true);
  });

  it("kräver en publicerad version att återställa till", () => {
    replaceDb(emptyTestDb({ website: testWebsite({ status: "utkast", publishedAt: undefined }) }));
    assert.throws(() => restorePublishedWebsiteDraft(), /publicerad version/);
  });
});

describe("hemsida: revisionsvakt", () => {
  it("räknar en skrivning som sen när revisionen redan är publicerad", () => {
    const site = testWebsite({ draftRevision: 2, publishedRevision: 2 });
    assert.equal(isStaleWebsiteWrite(site, 2), true);
    assert.equal(isStaleWebsiteWrite(site, 1), true);
    assert.equal(isStaleWebsiteWrite(site, 3), false);
    assert.equal(isStaleWebsiteWrite(site, undefined), false);
    assert.equal(acceptWebsiteWrite(site, 2), false);
    assert.equal(acceptWebsiteWrite(site, 3), true);
    assert.equal(site.draftRevision, 3);
  });

  it("sidfot-save efter publicering med samma revision lämnar inget utkast", () => {
    replaceDb(emptyTestDb({ website: testWebsite() }));
    publishWebsite({
      revision: 1,
      footer: { showPhone: false, showEmail: true, showAddress: true, showServices: true, showLogo: false },
    });
    setWebsiteFooter(
      { showPhone: false, showEmail: true, showAddress: true, showServices: true, showLogo: false },
      { clientRevision: 1 },
    );
    assert.equal(db().website!.draftFooter, undefined);
    assert.equal(hasUnpublishedWebsiteDrafts(db().website!), false);
  });

  it("policy-save efter publicering med samma revision lämnar inget utkast", () => {
    replaceDb(emptyTestDb({ website: testWebsite() }));
    publishWebsite({
      revision: 1,
      privacyPolicy: { mode: "standard", supplement: "Eget tillägg." },
    });
    updateWebsitePrivacyPolicy({ mode: "standard", supplement: "Eget tillägg." }, { clientRevision: 1 });
    assert.equal(db().website!.draftPrivacyPolicy, undefined);
    assert.equal(hasUnpublishedWebsiteDrafts(db().website!), false);
  });
});
