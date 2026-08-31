process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb, testCompany } from "./invoices/test-db";
import type { Website } from "./types";
import {
  generateWebsite,
  publishWebsite,
  updatePrivacyPolicySupplement,
  updateWebsitePrivacyPolicy,
} from "./services/website";
import { richTextToPlain } from "./richtext";
import {
  CONTACT_FORM_NOT_COLLECTED,
  CONTACT_FORM_PRIVACY_LINK_LABEL,
  CONTACT_FORM_STORED_FIELDS,
  PRIVACY_COMPANY_TOKENS,
  PRIVACY_POLICY_PATH,
  applyPrivacyTokens,
  buildPrivacyPolicy,
  capturePrivacyTokens,
  contactFormPrivacyLead,
  controllerName,
  draftPrivacyPolicyState,
  formatCompanyAddress,
  privacyPolicyHref,
  publishedPrivacyPolicyState,
  resolvePrivacyIntegrations,
  resolvePrivacyPolicyView,
  seedCustomPrivacyPolicy,
  websiteHasEnabledIntegration,
  websiteWithResolvedPrivacy,
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

  it("nämner inte Instagram", () => {
    const website = testSite();
    assert.equal(websiteHasEnabledIntegration(website, "instagram"), false);
    assert.deepEqual(resolvePrivacyIntegrations(website), {});
    const text = policyText(demoCompany, website);
    assert.doesNotMatch(text, /Instagram/);
    assert.ok(!buildPrivacyPolicy({ company: demoCompany, website }).sections.some((s) => s.id === "instagram"));
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
    replaceDb(emptyTestDb({ settings: { ...demoCompany } }));
  });

  it("sparar tillägg som utkast och lämnar företagsnamnet dynamiskt", () => {
    generateWebsite("Hemsida för Södermalms Snickeri i Stockholm");
    publishWebsite();
    updatePrivacyPolicySupplement("Vi ringer bara på dagtid.");
    const site = db().website;
    assert.ok(site);
    assert.equal(site.privacyPolicySupplement, undefined);
    assert.equal(draftPrivacyPolicyState(site).supplement, "Vi ringer bara på dagtid.");
    const preview = websiteWithResolvedPrivacy(site, true);
    const doc = buildPrivacyPolicy({ company: db().settings, website: preview });
    assert.equal(doc.controllerName, "Södermalms Snickeri AB");
    assert.match(doc.sections.find((s) => s.id === "tillägg")?.paragraphs.join(" ") ?? "", /dagtid/);

    const renamed = { ...db().settings, name: "Annat Demo AB" };
    const afterRename = buildPrivacyPolicy({
      company: renamed,
      website: websiteWithResolvedPrivacy(db().website!, true),
    });
    assert.equal(afterRename.controllerName, "Annat Demo AB");
  });

  it("tömmer tillägget när texten rensas", () => {
    generateWebsite("Hemsida för Test i Stockholm");
    updatePrivacyPolicySupplement("Tillfälligt tillägg");
    updatePrivacyPolicySupplement("  ");
    assert.equal(db().website?.privacyPolicySupplement, undefined);
    assert.equal(db().website?.draftPrivacyPolicy, undefined);
  });
});

describe("integritetspolicy STANDARD och CUSTOM", () => {
  beforeEach(() => {
    replaceDb(emptyTestDb({ settings: { ...demoCompany } }));
  });

  it("defaultar till STANDARD utan mode-fält – befintligt tillägg bevaras", () => {
    const website = testSite({ privacyPolicySupplement: "Vi fotar aldrig inne hos kunden utan att fråga." });
    const published = publishedPrivacyPolicyState(website);
    const draft = draftPrivacyPolicyState(website);
    assert.equal(published.mode, "standard");
    assert.equal(draft.mode, "standard");
    assert.equal(published.supplement, "Vi fotar aldrig inne hos kunden utan att fråga.");
    const doc = buildPrivacyPolicy({ company: demoCompany, website });
    assert.match(doc.sections.find((s) => s.id === "tillägg")?.paragraphs.join(" ") ?? "", /fotar aldrig/);
  });

  it("custom börjar från genererad standard, inte tomt, med tokens", () => {
    const website = testSite({ privacyPolicySupplement: "Vi ringer bara på dagtid." });
    const seed = seedCustomPrivacyPolicy({ company: demoCompany, website });
    const plain = richTextToPlain(seed);
    assert.match(plain, /Integritetspolicy/);
    assert.match(plain, /Personuppgiftsansvarig/);
    assert.match(plain, /6\.1 b/);
    assert.match(plain, /dagtid/);
    assert.match(plain, new RegExp(PRIVACY_COMPANY_TOKENS.name.replace(/[{}]/g, "\\$&")));
    assert.match(plain, new RegExp(PRIVACY_COMPANY_TOKENS.email.replace(/[{}]/g, "\\$&")));
    assert.doesNotMatch(plain, /Södermalms Snickeri AB/);
    assert.doesNotMatch(plain, /info@sodermalmssnickeri\.se/);
    assert.ok(plain.length > 400, "seed ska vara hela policyn");
  });

  it("custom skrivs inte över av malluppdateringar", () => {
    generateWebsite("Hemsida för Södermalms Snickeri i Stockholm");
    publishWebsite();
    const seed = seedCustomPrivacyPolicy({ company: demoCompany, website: db().website });
    const edited = {
      ...seed,
      content: [
        ...seed.content,
        { type: "paragraph" as const, content: [{ type: "text" as const, text: "Egen mening som inte finns i mallen." }] },
      ],
    };
    updateWebsitePrivacyPolicy({ mode: "custom", customBody: edited });
    publishWebsite();
    const saved = db().website!.privacyPolicyCustomBody;
    assert.ok(saved);
    assert.match(richTextToPlain(saved), /Egen mening som inte finns i mallen/);
    const regenerated = seedCustomPrivacyPolicy({ company: demoCompany, website: db().website });
    assert.doesNotMatch(richTextToPlain(regenerated), /Egen mening som inte finns i mallen/);
    assert.deepEqual(db().website!.privacyPolicyCustomBody, saved);
    assert.equal(publishedPrivacyPolicyState(db().website!).mode, "custom");
  });

  it("återställ till STANDARD använder aktuell mall och släpper custom", () => {
    generateWebsite("Hemsida för Södermalms Snickeri i Stockholm");
    publishWebsite();
    const seed = seedCustomPrivacyPolicy({ company: demoCompany, website: db().website });
    updateWebsitePrivacyPolicy({ mode: "custom", customBody: seed });
    publishWebsite();
    updateWebsitePrivacyPolicy({ mode: "standard" });
    const draft = draftPrivacyPolicyState(db().website!);
    assert.equal(draft.mode, "standard");
    assert.equal(draft.customBody, undefined);
    publishWebsite();
    assert.equal(publishedPrivacyPolicyState(db().website!).mode, "standard");
    assert.equal(db().website!.privacyPolicyCustomBody, undefined);
    const view = resolvePrivacyPolicyView({
      company: demoCompany,
      website: websiteWithResolvedPrivacy(db().website!, false),
    });
    assert.equal(view.kind, "standard");
    assert.match(view.document.intro, /Södermalms Snickeri AB/);
  });

  it("utkast syns i preview men inte på publicerad sida förrän publicering", () => {
    generateWebsite("Hemsida för Södermalms Snickeri i Stockholm");
    publishWebsite();
    const seed = seedCustomPrivacyPolicy({ company: demoCompany, website: db().website });
    updateWebsitePrivacyPolicy({ mode: "custom", customBody: seed });
    const site = db().website!;
    assert.equal(publishedPrivacyPolicyState(site).mode, "standard");
    assert.equal(draftPrivacyPolicyState(site).mode, "custom");
    const publicView = resolvePrivacyPolicyView({
      company: demoCompany,
      website: websiteWithResolvedPrivacy(site, false),
    });
    const previewView = resolvePrivacyPolicyView({
      company: demoCompany,
      website: websiteWithResolvedPrivacy(site, true),
    });
    assert.equal(publicView.kind, "standard");
    assert.equal(previewView.kind, "custom");
    publishWebsite();
    const live = resolvePrivacyPolicyView({
      company: demoCompany,
      website: websiteWithResolvedPrivacy(db().website!, false),
    });
    assert.equal(live.kind, "custom");
    assert.equal(db().website!.draftPrivacyPolicy, undefined);
  });

  it("ändrad e-post syns i STANDARD och CUSTOM via tokens", () => {
    generateWebsite("Hemsida för Södermalms Snickeri i Stockholm");
    publishWebsite();
    const seed = seedCustomPrivacyPolicy({ company: demoCompany, website: db().website });
    assert.match(richTextToPlain(seed), /{{company\.email}}/);
    updateWebsitePrivacyPolicy({ mode: "custom", customBody: seed });
    publishWebsite();

    const renamed = { ...demoCompany, email: "ny@sodermalmssnickeri.se" };
    const standard = buildPrivacyPolicy({ company: renamed, website: db().website });
    assert.match(standard.sections.map((s) => s.paragraphs.join(" ")).join(" "), /ny@sodermalmssnickeri\.se/);
    assert.doesNotMatch(standard.sections.map((s) => s.paragraphs.join(" ")).join(" "), /info@sodermalmssnickeri\.se/);

    const custom = resolvePrivacyPolicyView({
      company: renamed,
      website: websiteWithResolvedPrivacy(db().website!, false),
    });
    assert.equal(custom.kind, "custom");
    const customText = richTextToPlain(custom.doc);
    assert.match(customText, /ny@sodermalmssnickeri\.se/);
    assert.doesNotMatch(customText, /info@sodermalmssnickeri\.se/);
    assert.doesNotMatch(customText, /{{company\.email}}/);
  });

  it("editorn visar live värden men sparar tokens", () => {
    const seed = seedCustomPrivacyPolicy({ company: demoCompany, website: testSite() });
    const shown = applyPrivacyTokens(seed, demoCompany, { businessName: "Södermalms Snickeri" });
    assert.match(richTextToPlain(shown), /Södermalms Snickeri AB/);
    assert.match(richTextToPlain(shown), /info@sodermalmssnickeri\.se/);
    const stored = capturePrivacyTokens(shown, demoCompany, { businessName: "Södermalms Snickeri" });
    assert.match(richTextToPlain(stored), /{{company\.name}}/);
    assert.match(richTextToPlain(stored), /{{company\.email}}/);
    assert.doesNotMatch(richTextToPlain(stored), /info@sodermalmssnickeri\.se/);
  });
});
