process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb } from "./invoices/test-db";
import type { Website } from "./types";
import { generateWebsite, publishWebsite, setWebsiteFooter } from "./services/website";
import {
  FOOTER_SERVICES_MAX,
  assertSocialUrl,
  draftWebsiteFooter,
  footerServiceTitles,
  footerSummaryRows,
  publishedWebsiteFooter,
  resolveWebsiteFooter,
  suggestFooterAbout,
  trySocialUrl,
} from "./website-footer";

function testWebsite(over: Partial<Website> = {}): Website {
  return {
    id: "site-footer",
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
      {
        id: "s-hero",
        type: "hero",
        heading: "Platsbyggt snickeri",
        body: "Vi bygger kök och altaner i Stockholm.",
        visible: true,
      },
      {
        id: "s-tjanster",
        type: "tjanster",
        heading: "Tjänster",
        body: "",
        visible: true,
        items: [
          { title: "Platsbyggda möbler", text: "Efter mått." },
          { title: "Kök", text: "Helhet." },
          { title: "Altaner", text: "Ute." },
          { title: "Renovering", text: "Inne." },
        ],
      },
      {
        id: "s-om",
        type: "om",
        heading: "Om oss",
        body: "Almqvist Snickeri hjälper privatpersoner i Stockholm med platsbyggt snickeri, renoveringar och specialanpassade lösningar.",
        visible: true,
      },
      { id: "s-kontakt", type: "kontakt", heading: "Kontakt", body: "Hör av dig.", visible: true },
    ],
    ...over,
  };
}

const company = {
  name: "Almqvist Snickarfirma",
  phone: "070-123 45 67",
  email: "almqvist94@hotmail.com",
  address: "Blekingegatan 34",
  postalCode: "118 56",
  city: "Stockholm",
  orgNumber: "556677-8899",
  logoDataUrl: "data:image/png;base64,AAA",
};

describe("sidfotens innehåll", () => {
  it("autopopulerar kontakt, tjänster, om-text och logotyp utan setup", () => {
    const view = resolveWebsiteFooter(testWebsite(), company);
    assert.equal(view.name, "Almqvist Snickarfirma");
    assert.equal(view.phone, "070-123 45 67");
    assert.equal(view.email, "almqvist94@hotmail.com");
    assert.match(view.address ?? "", /Blekingegatan 34/);
    assert.match(view.address ?? "", /118 56 Stockholm/);
    assert.equal(view.orgNumber, "556677-8899");
    assert.deepEqual(view.services, ["Platsbyggda möbler", "Kök", "Altaner", "Renovering"]);
    assert.match(view.about ?? "", /platsbyggt snickeri/);
    assert.equal(view.showLogo, true);
    assert.equal(view.logoSrc, company.logoDataUrl);
    assert.equal(view.social.length, 0);
  });

  it("döljer tomma sociala ikoner och visar bara ifyllda länkar", () => {
    const view = resolveWebsiteFooter(testWebsite(), company, {
      social: { instagram: "https://instagram.com/almqvist", facebook: "", tiktok: undefined },
    });
    assert.deepEqual(
      view.social.map((s) => s.network),
      ["instagram"],
    );
    assert.equal(view.social[0].href, "https://instagram.com/almqvist");
  });

  it("döljer tjänstekolumnen när sektionen saknas eller är tom", () => {
    const empty = testWebsite({
      sections: [
        { id: "s-hero", type: "hero", heading: "Hej", body: "Vi bygger.", visible: true },
        { id: "s-kontakt", type: "kontakt", heading: "Kontakt", body: "", visible: true },
      ],
    });
    assert.deepEqual(resolveWebsiteFooter(empty, company).services, []);
    assert.deepEqual(footerServiceTitles([]), []);
  });

  it("döljer tjänster, kontaktfält och logo när användaren stänger av dem", () => {
    const view = resolveWebsiteFooter(testWebsite(), company, {
      showPhone: false,
      showEmail: false,
      showAddress: false,
      showServices: false,
      showLogo: false,
    });
    assert.equal(view.phone, undefined);
    assert.equal(view.email, undefined);
    assert.equal(view.address, undefined);
    assert.deepEqual(view.services, []);
    assert.equal(view.showLogo, false);
    assert.equal(view.logoSrc, undefined);
  });

  it("använder egen footer-text när den är ifylld", () => {
    const view = resolveWebsiteFooter(testWebsite(), company, { aboutText: "Kort egen text om firman." });
    assert.equal(view.about, "Kort egen text om firman.");
  });

  it("föreslår om-text från innehåll, annars namn, ort och tjänster", () => {
    assert.match(
      suggestFooterAbout({
        businessName: "Almqvist Snickeri",
        city: "Stockholm",
        aboutBody: "Vi bygger kök. Vi lämnar snyggt efter oss.",
        services: ["Kök"],
      }),
      /Vi bygger kök/,
    );
    assert.match(
      suggestFooterAbout({
        businessName: "Almqvist Snickeri",
        city: "Stockholm",
        services: ["Kök", "Altaner", "Renovering"],
      }),
      /Almqvist Snickeri hjälper kunder i Stockholm med kök, altaner och renovering/,
    );
  });

  it("kapar tjänstelistan så footern inte blir lång", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ title: `Tjänst ${i + 1}`, text: "" }));
    const titles = footerServiceTitles([{ type: "tjanster", visible: true, items: many }]);
    assert.equal(titles.length, FOOTER_SERVICES_MAX);
    assert.equal(titles[0], "Tjänst 1");
  });
});

describe("footerSummaryRows", () => {
  it("visar På när någon kontaktuppgift är synlig, och Automatisk om-text", () => {
    assert.deepEqual(footerSummaryRows({}, { phone: "070-123 45 67", email: "a@b.se", address: "Gatan 1" }), [
      { label: "Kontaktuppgifter", value: "På" },
      { label: "Tjänster", value: "På" },
      { label: "Sociala länkar", value: "Inga" },
      { label: "Kort om företaget", value: "Automatisk" },
    ]);
  });

  it("visar Av när kontakt och tjänster är avstängda", () => {
    const rows = footerSummaryRows(
      {
        showPhone: false,
        showEmail: false,
        showAddress: false,
        showServices: false,
        aboutText: "Kort egen text.",
        social: { instagram: "https://instagram.com/almqvist" },
      },
      { phone: "070-123 45 67", email: "a@b.se", address: "Gatan 1" },
    );
    assert.equal(rows[0].value, "Av");
    assert.equal(rows[1].value, "Av");
    assert.equal(rows[2].value, "1");
    assert.equal(rows[3].value, "Angivet");
  });

  it("räknar ifyllda sociala länkar och döljer kontakt när uppgifterna saknas", () => {
    const rows = footerSummaryRows(
      { social: { instagram: "https://instagram.com/x", facebook: "https://facebook.com/x" } },
      {},
    );
    assert.equal(rows.find((r) => r.label === "Sociala länkar")?.value, "2");
    assert.equal(rows.find((r) => r.label === "Kontaktuppgifter")?.value, "Av");
  });
});

describe("sociala länkar är bara URL:er", () => {
  it("godkänner https och lägger till protokoll", () => {
    assert.equal(trySocialUrl("https://instagram.com/firma"), "https://instagram.com/firma");
    assert.equal(trySocialUrl("www.facebook.com/firma"), "https://www.facebook.com/firma");
    assert.equal(assertSocialUrl("tiktok.com/@firma", "tiktok"), "https://tiktok.com/@firma");
  });

  it("avvisar tomt, javascript och ogiltiga värden", () => {
    assert.equal(trySocialUrl(""), undefined);
    assert.equal(trySocialUrl("javascript:alert(1)"), undefined);
    assert.throws(() => assertSocialUrl("inte en länk", "instagram"), /giltig Instagram-länk/);
  });
});

describe("sidfot: utkast → publicera", () => {
  beforeEach(() => {
    replaceDb(emptyTestDb({ website: testWebsite() }));
  });

  it("sparar ändringar som utkast utan att röra den publicerade sajten", () => {
    setWebsiteFooter({
      showPhone: true,
      social: { instagram: "https://instagram.com/almqvist" },
      aboutText: "Ny footer-text.",
    });
    const site = db().website!;
    assert.equal(site.footer, undefined);
    assert.equal(draftWebsiteFooter(site).social?.instagram, "https://instagram.com/almqvist");
    assert.equal(publishedWebsiteFooter(site).social?.instagram, undefined);
    const publicView = resolveWebsiteFooter(site, company, publishedWebsiteFooter(site));
    assert.equal(publicView.social.length, 0);
    const preview = resolveWebsiteFooter(site, company, draftWebsiteFooter(site));
    assert.equal(preview.social[0]?.network, "instagram");
    assert.equal(preview.about, "Ny footer-text.");
  });

  it("Publicera ändringar tar utkastet i produktion", () => {
    setWebsiteFooter({ social: { facebook: "https://facebook.com/almqvist" } });
    publishWebsite();
    const site = db().website!;
    assert.equal(site.draftFooter, undefined);
    assert.equal(site.footer?.social?.facebook, "https://facebook.com/almqvist");
    assert.equal(publishedWebsiteFooter(site).social?.facebook, "https://facebook.com/almqvist");
  });

  it("tillbaka till default rensar utkastet", () => {
    setWebsiteFooter({ showPhone: false });
    assert.ok(db().website!.draftFooter);
    setWebsiteFooter({ showPhone: true, showEmail: true, showAddress: true, showServices: true, showLogo: true });
    assert.equal(db().website!.draftFooter, undefined);
  });

  it("ny sajt behöver ingen footer-setup", () => {
    replaceDb(emptyTestDb({ website: null }));
    const site = generateWebsite("Hemsida för Almqvist Snickeri i Stockholm. Vi bygger kök.");
    const view = resolveWebsiteFooter(site, {
      name: "Almqvist Snickeri",
      phone: "070-123 45 67",
      email: "info@example.se",
      address: "Gatan 1",
      postalCode: "118 56",
      city: "Stockholm",
      orgNumber: "556677-8899",
    });
    assert.ok(view.phone);
    assert.ok(view.services.length > 0);
    assert.ok(view.about);
    assert.equal(site.footer, undefined);
    assert.equal(site.draftFooter, undefined);
  });
});

