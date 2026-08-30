process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb } from "./invoices/test-db";
import type { Website, WebsiteTheme } from "./types";
import {
  DEFAULT_WEBSITE_DESIGN,
  WEBSITE_ACCENTS,
  WEBSITE_ACCENT_IDS,
  WEBSITE_THEMES,
  WEBSITE_THEME_IDS,
  contrastRatio,
  draftWebsiteDesign,
  publishedWebsiteDesign,
} from "./website-design";
import { generateWebsite, publishWebsite, setWebsiteDesign } from "./services/website";

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
        items: [
          { title: "Kök", text: "Helhetsansvar." },
          { title: "Garderober", text: "Platsbyggt.", image: "data:image/png;base64,AAA" },
        ],
      },
      { id: "s-om", type: "om", heading: "Om oss", body: "Två snickare.", visible: true },
      { id: "s-galleri", type: "galleri", heading: "Projekt", body: "Urval.", visible: false },
      { id: "s-kontakt", type: "kontakt", heading: "Kontakt", body: "Hör av dig.", visible: true },
    ],
    primaryCta: { label: "Begär offert" },
    ...over,
  };
}

/* ------------------------------- Definitioner ------------------------------- */

describe("utseendesystemets definitioner", () => {
  it("har exakt fyra teman: klassisk, modern, robust, minimal", () => {
    assert.deepEqual([...WEBSITE_THEME_IDS].sort(), ["klassisk", "minimal", "modern", "robust"]);
  });

  it("har en kuraterad accentlista (4–6 färger), ingen fri färgväljare", () => {
    assert.ok(WEBSITE_ACCENT_IDS.length >= 4 && WEBSITE_ACCENT_IDS.length <= 6);
    assert.deepEqual([...WEBSITE_ACCENT_IDS].sort(), ["bla", "gron", "sand", "svart", "tegel"]);
  });

  it("temana är strukturellt olika – inte bara färg/radie", () => {
    const axes = (["hero", "header", "cards", "gallery", "contact", "sections", "buttons"] as const).map((axis) => {
      const values = WEBSITE_THEME_IDS.map((id) => WEBSITE_THEMES[id][axis]);
      return new Set(values).size;
    });
    // Varje strukturaxel har fyra distinkta varianter – ett tema per uttryck.
    for (const distinct of axes) assert.equal(distinct, 4);
    // Typografin skiljer också: typsnitt eller vikt är aldrig identiska mellan två teman.
    const typo = WEBSITE_THEME_IDS.map((id) => `${WEBSITE_THEMES[id].headingFont}|${WEBSITE_THEMES[id].headingWeight}`);
    assert.equal(new Set(typo).size, 4);
  });
});

/* --------------------------- Kontrastgarantier (AA) -------------------------- */

describe("läsbarhetsgarantier – användaren kan aldrig skapa ljust-på-ljust", () => {
  const AA = 4.5;

  it("vit text på varje accentyta klarar AA (knappar, CTA)", () => {
    for (const id of WEBSITE_ACCENT_IDS) {
      const a = WEBSITE_ACCENTS[id];
      const ratio = contrastRatio(a.color, a.ink);
      assert.ok(ratio >= AA, `${id}: accent/ink ${ratio.toFixed(2)} < ${AA}`);
    }
  });

  it("accentfärgad text klarar AA mot varje temas ljusa ytor", () => {
    for (const themeId of WEBSITE_THEME_IDS) {
      const t = WEBSITE_THEMES[themeId];
      for (const accentId of WEBSITE_ACCENT_IDS) {
        const a = WEBSITE_ACCENTS[accentId];
        for (const surface of [t.bg, t.card]) {
          const ratio = contrastRatio(a.color, surface);
          assert.ok(ratio >= AA, `${themeId}/${accentId} mot ${surface}: ${ratio.toFixed(2)} < ${AA}`);
        }
        if (!t.darkBand) {
          const ratio = contrastRatio(a.color, t.band);
          assert.ok(ratio >= AA, `${themeId}/${accentId} mot band ${t.band}: ${ratio.toFixed(2)} < ${AA}`);
        }
      }
    }
  });

  it("accentens ljusa variant klarar AA på mörka band", () => {
    for (const themeId of WEBSITE_THEME_IDS) {
      const t = WEBSITE_THEMES[themeId];
      if (!t.darkBand) continue;
      for (const accentId of WEBSITE_ACCENT_IDS) {
        const a = WEBSITE_ACCENTS[accentId];
        const ratio = contrastRatio(a.tintText, t.band);
        assert.ok(ratio >= AA, `${themeId}/${accentId} tint mot band: ${ratio.toFixed(2)} < ${AA}`);
      }
    }
  });

  it("temats egna textfärger klarar AA på sina ytor", () => {
    for (const themeId of WEBSITE_THEME_IDS) {
      const t = WEBSITE_THEMES[themeId];
      for (const [text, surface, label] of [
        [t.ink, t.bg, "ink/bg"],
        [t.ink, t.card, "ink/card"],
        [t.soft, t.bg, "soft/bg"],
        [t.soft, t.card, "soft/card"],
        [t.bandInk, t.band, "bandInk/band"],
        [t.bandSoft, t.band, "bandSoft/band"],
      ] as const) {
        const ratio = contrastRatio(text, surface);
        assert.ok(ratio >= AA, `${themeId} ${label}: ${ratio.toFixed(2)} < ${AA}`);
      }
    }
  });
});

/* ------------------------------ Arv & standard ------------------------------- */

describe("äldre sajter och standardutseende", () => {
  it("äldre sajter utan design blir Klassisk med närmast matchande accent", () => {
    const expected: Record<WebsiteTheme, string> = {
      tra: "tegel",
      studio: "svart",
      ren: "gron",
      el: "sand",
      konsult: "bla",
    };
    for (const [legacy, accent] of Object.entries(expected) as [WebsiteTheme, string][]) {
      const design = publishedWebsiteDesign({ theme: legacy });
      assert.equal(design.themeId, "klassisk", `${legacy} ska bli klassisk`);
      assert.equal(design.accent, accent, `${legacy} ska få accenten ${accent}`);
    }
  });

  it("standardutseendet är Klassisk (≈ ursprungliga Driva-utseendet)", () => {
    assert.equal(DEFAULT_WEBSITE_DESIGN.themeId, "klassisk");
  });

  it("explicit design vinner över det äldre palettfältet", () => {
    const design = publishedWebsiteDesign({ theme: "tra", design: { themeId: "modern", accent: "bla" } });
    assert.deepEqual(design, { themeId: "modern", accent: "bla" });
  });
});

/* --------------------------- Utkast → publicera ------------------------------ */

describe("temabyte: utkast → publicera, innehållet orört", () => {
  beforeEach(() => {
    replaceDb(emptyTestDb({ website: testWebsite() }));
  });

  it("val sparas som utkast: förhandsvisningen byter, publicerade sajten ligger kvar", () => {
    setWebsiteDesign({ themeId: "modern", accent: "bla" });
    const site = db().website!;
    assert.deepEqual(site.draftDesign, { themeId: "modern", accent: "bla" });
    assert.deepEqual(draftWebsiteDesign(site), { themeId: "modern", accent: "bla" });
    // Publicerade utseendet härleds fortfarande från tra → klassisk/tegel.
    assert.deepEqual(publishedWebsiteDesign(site), { themeId: "klassisk", accent: "tegel" });
    assert.equal(site.status, "publicerad");
  });

  it("temabyte rör ALDRIG innehållet: texter, tjänster, bilder, ordning, synlighet, CTA", () => {
    const before = JSON.stringify({
      sections: db().website!.sections,
      primaryCta: db().website!.primaryCta,
      slug: db().website!.slug,
      businessName: db().website!.businessName,
      tagline: db().website!.tagline,
      submissions: db().website!.submissions,
    });
    for (const themeId of WEBSITE_THEME_IDS) {
      for (const accent of WEBSITE_ACCENT_IDS) {
        setWebsiteDesign({ themeId, accent });
      }
    }
    const after = JSON.stringify({
      sections: db().website!.sections,
      primaryCta: db().website!.primaryCta,
      slug: db().website!.slug,
      businessName: db().website!.businessName,
      tagline: db().website!.tagline,
      submissions: db().website!.submissions,
    });
    assert.equal(after, before);
  });

  it("tillbaka till publicerat utseende rensar utkastet (inga falska 'opublicerade ändringar')", () => {
    setWebsiteDesign({ themeId: "robust", accent: "sand" });
    assert.ok(db().website!.draftDesign);
    setWebsiteDesign(publishedWebsiteDesign(db().website!));
    assert.equal(db().website!.draftDesign, undefined);
  });

  it("Publicera ändringar tar utkastet i produktion och tömmer det", () => {
    setWebsiteDesign({ themeId: "minimal", accent: "svart" });
    publishWebsite();
    const site = db().website!;
    assert.deepEqual(site.design, { themeId: "minimal", accent: "svart" });
    assert.equal(site.draftDesign, undefined);
    assert.deepEqual(publishedWebsiteDesign(site), { themeId: "minimal", accent: "svart" });
  });

  it("okänt tema eller accent avvisas", () => {
    assert.throws(() => setWebsiteDesign({ themeId: "neon", accent: "tegel" }), /Okänt tema/);
    assert.throws(() => setWebsiteDesign({ themeId: "modern", accent: "rosa" }), /Okänd accentfärg/);
    assert.equal(db().website!.draftDesign, undefined);
  });

  it("publicering utan väntande utkast behåller det publicerade utseendet", () => {
    db().website!.design = { themeId: "robust", accent: "gron" };
    publishWebsite();
    assert.deepEqual(db().website!.design, { themeId: "robust", accent: "gron" });
  });
});

/* ------------------------------- AI-generatorn ------------------------------- */

describe("AI-generatorn föreslår ett tema per bransch", () => {
  beforeEach(() => {
    replaceDb(emptyTestDb({ website: null }));
  });

  it("nya sajter får ett explicit utseende (aldrig arvsberoende)", () => {
    const site = generateWebsite("Skapa en hemsida för Almqvist Snickeri i Stockholm. Vi bygger kök.");
    assert.deepEqual(site.design, { themeId: "klassisk", accent: "tegel" });
    assert.equal(site.draftDesign, undefined);
  });

  it("elektriker → robust, konsult → modern, foto → minimal", () => {
    assert.equal(generateWebsite("Elinstallationer och laddboxar i Uppsala").design?.themeId, "robust");
    replaceDb(emptyTestDb({ website: null }));
    assert.equal(generateWebsite("Konsultbolag inom strategi i Malmö").design?.themeId, "modern");
    replaceDb(emptyTestDb({ website: null }));
    assert.equal(generateWebsite("Fotograf för bröllop och porträtt i Göteborg").design?.themeId, "minimal");
  });
});
