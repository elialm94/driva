process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb } from "./invoices/test-db";
import type { Website } from "./types";
import {
  addTestimonialItem,
  addWebsiteSection,
  generateWebsite,
  removeWebsiteSection,
  setSectionVisible,
  updateSection,
} from "./services/website";
import {
  ADDABLE_SECTION_TYPES,
  addableTypesFor,
  canDeleteSection,
  isTextSectionType,
  SECTION_LABELS,
  stripWebsiteSecrets,
} from "./website-sections";
import { formatAddressLine, resolveSiteContact, telHref } from "./website-contact";

function testWebsite(over: Partial<Website> = {}): Website {
  return {
    id: "site-test",
    slug: "test-snickeri",
    businessName: "Test Snickeri",
    tagline: "Hantverk som håller",
    city: "Stockholm",
    status: "publicerad",
    theme: "tra",
    publishedAt: "2026-01-01T08:00:00.000Z",
    createdAt: "2025-12-01T08:00:00.000Z",
    submissions: 0,
    sections: [
      { id: "s-hero", type: "hero", heading: "Hantverk som håller", body: "Vi bygger kök.", visible: true },
      {
        id: "s-tjanster",
        type: "tjanster",
        heading: "Tjänster",
        body: "",
        visible: true,
        items: [{ title: "Kök", text: "Helhetsansvar." }],
      },
      { id: "s-om", type: "om", heading: "Om oss", body: "Två snickare.", visible: true },
      { id: "s-galleri", type: "galleri", heading: "Projekt", body: "Urval.", visible: true },
      { id: "s-kontakt", type: "kontakt", heading: "Kontakt", body: "Hör av dig.", visible: true },
    ],
    primaryCta: { label: "Begär offert" },
    ...over,
  };
}

describe("sektionsbyggaren", () => {
  beforeEach(() => {
    replaceDb(emptyTestDb({ website: testWebsite() }));
  });

  it("ny sajt får Start, Tjänster, Text (Om oss), Galleri och Kontakt – inte Instagram/CTA/Omdömen", () => {
    replaceDb(emptyTestDb({ website: null }));
    const site = generateWebsite("Skapa en hemsida för Almqvist Snickeri i Stockholm. Vi bygger kök.");
    assert.deepEqual(
      site.sections.map((s) => s.type),
      ["hero", "tjanster", "text", "galleri", "kontakt"],
    );
    assert.equal(site.sections.filter((s) => s.type === "hero").length, 1);
    assert.equal(site.sections.find((s) => s.type === "text")?.heading, "Om oss");
  });

  it("kan lägga till flera textsektioner", () => {
    const a = addWebsiteSection("text");
    const b = addWebsiteSection("text");
    assert.equal(a.type, "text");
    assert.equal(b.type, "text");
    assert.equal(db().website!.sections.filter((s) => s.type === "text" || s.type === "om").length, 3);
  });

  it("äldres Om oss räknas som text och kan redigeras som text", () => {
    assert.equal(isTextSectionType("om"), true);
    assert.equal(SECTION_LABELS.om, "Text");
    updateSection("s-om", { heading: "Vår historia", imagePosition: "left" });
    const om = db().website!.sections.find((s) => s.id === "s-om")!;
    assert.equal(om.heading, "Vår historia");
    assert.equal(om.imagePosition, "left");
  });

  it("Start kan inte läggas till, döljas eller tas bort", () => {
    assert.throws(() => addWebsiteSection("hero" as never), /redan|kan inte/);
    assert.throws(() => setSectionVisible("s-hero", false), /Startsektionen/);
    assert.throws(() => removeWebsiteSection("s-hero"), /Startsektionen/);
    assert.equal(canDeleteSection({ type: "hero" }), false);
  });

  it("unika typer döljs i väljaren och kan inte dupliceras", () => {
    const types = addableTypesFor(db().website!.sections).map((o) => o.type);
    assert.ok(types.includes("text"));
    assert.ok(!types.includes("instagram"));
    assert.ok(types.includes("omdomen"));
    assert.ok(types.includes("cta"));
    assert.ok(types.includes("kontaktuppgifter"));
    assert.ok(!types.includes("tjanster"));
    assert.ok(!types.includes("galleri"));
    assert.ok(!types.includes("kontakt"));
    assert.throws(() => addWebsiteSection("tjanster"), /redan/);
  });

  it("kan lägga till, dölja och ta bort valfria sektioner", () => {
    const quotes = addWebsiteSection("omdomen");
    const details = addWebsiteSection("kontaktuppgifter");
    const cta = addWebsiteSection("cta");
    setSectionVisible(quotes.id, false);
    assert.equal(db().website!.sections.find((s) => s.id === quotes.id)?.visible, false);
    removeWebsiteSection(quotes.id);
    assert.equal(db().website!.sections.some((s) => s.id === quotes.id), false);
    assert.ok(db().website!.sections.some((s) => s.id === details.id));
    assert.ok(db().website!.sections.some((s) => s.id === cta.id));
  });

  it("CTA tillåter bara formulär, telefon och e-post", () => {
    const cta = addWebsiteSection("cta");
    updateSection(cta.id, { ctaDestination: "phone", ctaLabel: "Ring oss" });
    assert.equal(db().website!.sections.find((s) => s.id === cta.id)?.cta?.destination, "phone");
    assert.throws(() => updateSection(cta.id, { ctaDestination: "https://evil" as never }), /formuläret|telefon|e-post/);
  });

  it("omdömen är manuella och redo för Google senare", () => {
    const section = addWebsiteSection("omdomen");
    addTestimonialItem(section.id, { title: "Anna", text: "Superjobb.", rating: 5, location: "Stockholm" });
    const item = db().website!.sections.find((s) => s.id === section.id)!.items![0];
    assert.equal(item.source, "manual");
    assert.equal(item.rating, 5);
    assert.equal(item.location, "Stockholm");
    assert.throws(() => addTestimonialItem(section.id, { title: "Bo", text: "Ok", rating: 9 }), /1–5/);
  });

  it("sektionsändringar rör inte temautkastet", () => {
    const site = db().website!;
    site.draftDesign = { themeId: "modern", accent: "bla" };
    addWebsiteSection("cta");
    assert.deepEqual(db().website!.draftDesign, { themeId: "modern", accent: "bla" });
  });

  it("nya sektioner läggs in före kontaktformuläret", () => {
    const quotes = addWebsiteSection("omdomen");
    const types = db().website!.sections.map((s) => s.type);
    assert.equal(types.at(-1), "kontakt");
    assert.ok(types.indexOf(quotes.type) < types.lastIndexOf("kontakt"));
  });

  it("kontaktuppgifter kommer från företagets kontakt, inte om-skrivning", () => {
    const section = addWebsiteSection("kontaktuppgifter");
    updateSection(section.id, { hours: "Vardagar 7–16" });
    const contact = resolveSiteContact(db().settings, db().website, db().website!.sections.find((s) => s.id === section.id));
    assert.equal(contact.phone, db().settings.phone);
    assert.equal(contact.email, db().settings.email);
    assert.equal(contact.hours, "Vardagar 7–16");
    assert.match(formatAddressLine(contact), /Gatan 1/);
  });

  it("telefon blir tel-länk utan att tappa plus", () => {
    assert.equal(telHref("08-123 45 67"), "tel:081234567");
    assert.equal(telHref("+46 8 123 45 67"), "tel:+4681234567");
    assert.equal(telHref("   "), "");
  });
});

describe("borttagna sektionstyper", () => {
  it("Instagram går inte att lägga till", () => {
    assert.throws(() => addWebsiteSection("instagram" as never), /redan|kan inte/);
    assert.ok(!ADDABLE_SECTION_TYPES.some((o) => o.type === "instagram"));
  });

  it("släpper gamla Instagram-sektioner så publika sajter inte kraschar", () => {
    const retired = {
      id: "ig",
      type: "instagram",
      heading: "Följ våra projekt",
      body: "",
      visible: true,
    } as unknown as Website["sections"][number];
    const site = testWebsite({
      sections: [
        { id: "s-hero", type: "hero", heading: "Hej", body: "Bygger kök.", visible: true },
        retired,
      ],
    });
    const publicSite = stripWebsiteSecrets(site);
    assert.deepEqual(
      publicSite.sections.map((s) => s.type),
      ["hero"],
    );

    replaceDb(emptyTestDb({ website: site }));
    assert.deepEqual(
      db().website!.sections.map((s) => s.type),
      ["hero"],
    );
  });
});
