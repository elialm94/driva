process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb, testCompany } from "./invoices/test-db";
import type { Website } from "./types";
import { generateWebsite, publishWebsite, updatePrivacyPolicySupplement } from "./services/website";
import {
  CONTACT_FORM_NOT_COLLECTED,
  CONTACT_FORM_PRIVACY_LINK_LABEL,
  CONTACT_FORM_STORED_FIELDS,
  PRIVACY_POLICY_PATH,
  buildPrivacyPolicy,
  contactFormPrivacyLead,
  controllerName,
  formatCompanyAddress,
  privacyPolicyHref,
  resolvePrivacyIntegrations,
  websiteHasEnabledIntegration,
} from "./website-privacy";

const demoCompany = testCompany({
  name: "Södermalms Snickeri AB",
  orgNumber: "559123-4567",
  email: "info@sodermalmssnickeri.se",
  phone: "08-410 245 30",
  address: "Renstiernas gata 12",
  postalCode: "116 28",
  city: "Stockholm",
});

function testSite(over: Partial<Website> = {}): Website {
  return {
    id: "site-privacy",
    slug: "sodermalms-snickeri",
    businessName: "Södermalms Snickeri",
    tagline: "Hantverk",
    city: "Stockholm",
    status: "publicerad",
    theme: "tra",
    createdAt: "2026-01-01T00:00:00.000Z",
    submissions: 0,
    sections: [
      { id: "s-hero", type: "hero", heading: "Hej", body: "Bygger kök.", visible: true },
      { id: "s-kontakt", type: "kontakt", heading: "Kontakt", body: "Hör av dig.", visible: true },
    ],
    ...over,
  };
}

function policyText(company = demoCompany, website?: Website) {
  const doc = buildPrivacyPolicy({ company, website });
  return [doc.intro, ...doc.sections.flatMap((s) => [s.heading, ...s.paragraphs])].join("\n");
}

describe("integritetspolicy från företagsuppgifter", () => {
  it("använder live företagsnamn, org.nr, adress, e-post och telefon", () => {
    const text = policyText();
    assert.match(text, /Södermalms Snickeri AB/);
    assert.match(text, /559123-4567/);
    assert.match(text, /Renstiernas gata 12/);
    assert.match(text, /116 28 Stockholm/);
    assert.match(text, /info@sodermalmssnickeri\.se/);
    assert.match(text, /08-410 245 30/);
  });

  it("följer ändrade företagsuppgifter utan en fryst kopia", () => {
    const website = testSite();
    const before = buildPrivacyPolicy({ company: demoCompany, website });
    const after = buildPrivacyPolicy({
      company: { ...demoCompany, name: "Nytt Bolag AB", address: "Ny gata 1" },
      website,
    });
    assert.match(before.controllerName, /Södermalms/);
    assert.equal(after.controllerName, "Nytt Bolag AB");
    assert.match(after.sections[0].paragraphs.join("\n"), /Ny gata 1/);
    assert.doesNotMatch(after.sections[0].paragraphs.join("\n"), /Renstiernas/);
  });

  it("använder demoföretagets uppgifter – ingen riktig persons data", () => {
    const text = policyText();
    assert.match(text, /Södermalms Snickeri AB/);
    assert.doesNotMatch(text, /Anna Andersson|Karin Testsson|personnummer|1985/);
  });

  it("beskriver bara det formuläret faktiskt sparar", () => {
    const text = policyText();
    assert.match(text, /namn/i);
    assert.match(text, /e-post/i);
    assert.match(text, /telefon/i);
    assert.match(text, /meddelandet/);
    for (const field of CONTACT_FORM_STORED_FIELDS) {
      assert.ok(field);
    }
    for (const banned of CONTACT_FORM_NOT_COLLECTED) {
      assert.doesNotMatch(text.toLowerCase(), new RegExp(`samlar in ${banned}`));
    }
    assert.match(text, /samlar inte in IP-adress/);
    assert.doesNotMatch(text, /Google Analytics|Meta Pixel|user-agent|användaragent/i);
  });

  it("påstår inte samtycke som rättslig grund", () => {
    const text = policyText();
    assert.match(text, /6\.1 b/);
    assert.match(text, /6\.1 f/);
    assert.match(text, /åtgärder innan ett avtal/);
    assert.match(text, /berättigat intresse/);
    assert.match(text, /inte samtycke/);
    assert.doesNotMatch(text, /rättslig grund är samtycke/i);
  });

  it("beskriver Driva som plattform, inte som företaget kunden kontaktar", () => {
    const text = policyText();
    assert.match(text, /Du skickar uppgifterna till Södermalms Snickeri AB, inte till Driva/);
    assert.match(text, /personuppgiftsbiträde/);
  });

  it("tar inte med Instagram förrän integrationen är på", () => {
    const website = testSite();
    assert.equal(websiteHasEnabledIntegration(website, "instagram"), false);
    assert.equal(resolvePrivacyIntegrations(website).instagram, false);
    const text = policyText(demoCompany, website);
    assert.doesNotMatch(text, /Instagram/);

    const enabled = buildPrivacyPolicy({
      company: demoCompany,
      website,
      integrations: { instagram: true },
    });
    assert.ok(enabled.sections.some((s) => s.id === "instagram"));
  });

  it("lägger tilläggstext som Övrigt utan att frysa företagsuppgifter", () => {
    const website = testSite({ privacyPolicySupplement: "Vi fotar aldrig inne hos kunden utan att fråga." });
    const doc = buildPrivacyPolicy({ company: demoCompany, website });
    const extra = doc.sections.find((s) => s.id === "tillägg");
    assert.ok(extra);
    assert.match(extra.paragraphs.join(" "), /fotar aldrig/);
    assert.equal(doc.controllerName, "Södermalms Snickeri AB");
  });

  it("formaterar adress från kanoniska fält", () => {
    assert.equal(formatCompanyAddress(demoCompany), "Renstiernas gata 12, 116 28 Stockholm");
    assert.equal(controllerName(demoCompany), "Södermalms Snickeri AB");
  });
});

describe("formulärsnotis utan samtyckesruta", () => {
  it("informerar med företagsnamnet och länkar till policyn", () => {
    const lead = contactFormPrivacyLead("Södermalms Snickeri AB");
    assert.equal(
      lead,
      "Genom att skicka formuläret behandlar Södermalms Snickeri AB dina uppgifter för att hantera din förfrågan."
    );
    assert.equal(CONTACT_FORM_PRIVACY_LINK_LABEL, "integritetspolicyn");
    assert.equal(PRIVACY_POLICY_PATH, "/integritetspolicy");
    assert.equal(privacyPolicyHref(false), "/integritetspolicy");
    assert.equal(privacyPolicyHref(true), "/integritetspolicy?preview=1");
    assert.doesNotMatch(lead, /godkänner|samtycke|checkbox/i);
  });
});

describe("redigerbart tillägg på hemsidan", () => {
  beforeEach(() => {
    replaceDb(emptyTestDb({ settings: demoCompany }));
  });

  it("sparar tillägg och lämnar företagsnamnet dynamiskt", () => {
    generateWebsite("Hemsida för Södermalms Snickeri i Stockholm");
    publishWebsite();
    updatePrivacyPolicySupplement("Vi ringer bara på dagtid.");
    const site = db().website;
    assert.ok(site);
    assert.equal(site.privacyPolicySupplement, "Vi ringer bara på dagtid.");
    const doc = buildPrivacyPolicy({ company: db().settings, website: site });
    assert.equal(doc.controllerName, "Södermalms Snickeri AB");
    assert.match(doc.sections.find((s) => s.id === "tillägg")?.paragraphs.join(" ") ?? "", /dagtid/);

    db().settings.name = "Annat Demo AB";
    const afterRename = buildPrivacyPolicy({ company: db().settings, website: db().website });
    assert.equal(afterRename.controllerName, "Annat Demo AB");
  });

  it("tömmer tillägget när texten rensas", () => {
    generateWebsite("Hemsida för Test i Stockholm");
    updatePrivacyPolicySupplement("Tillfälligt tillägg");
    updatePrivacyPolicySupplement("  ");
    assert.equal(db().website?.privacyPolicySupplement, undefined);
  });
});
