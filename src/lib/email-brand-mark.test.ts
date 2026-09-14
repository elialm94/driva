process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { authEmail } from "./email/auth-templates";
import { ownerNoticeTestEmail } from "./email/owner-notice-templates";
import { fervaMarkImg, quoteEmail } from "./email/templates";
import { purchaseOrderHtml, type PurchaseOrderMailInput } from "./email/purchase-order-mail";

/**
 * Märket i mejlkromen (spec §6). Gmail och Outlook blockerar SVG, så mejlen
 * får PNG på absolut URL – och hellre ingen bild alls än en trasig.
 */
const ORIGIN_VARS = ["DRIVA_APP_URL", "APP_URL", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_URL"] as const;

const saved: Record<string, string | undefined> = {};

function setOrigin(url: string | undefined): void {
  for (const key of ORIGIN_VARS) delete process.env[key];
  if (url) process.env.DRIVA_APP_URL = url;
}

const purchaseOrder: PurchaseOrderMailInput = {
  reference: "FV-1001",
  replyTo: "order@example.se",
  companyName: "Södermalms Snickeri AB",
  orgNumber: "556677-8899",
  wholesalerName: "Demo-grossisten",
  customerNumber: "12345",
  orderer: { name: "Erik Ek", email: "erik@example.se", phone: "070-1234567" },
  jobTitle: "Köksrenovering",
  delivery: { mode: "pickup", store: "Årsta" },
  lines: [{ lineId: "l1", name: "Gipsskiva", qty: 10, unit: "st" }],
};

/** Alla mallar som ska bära kromen. */
function allHtml(): { name: string; html: string }[] {
  return [
    { name: "templates.ts (offert till kund)", html: quoteEmail({
      businessName: "Södermalms Snickeri AB",
      customerName: "Anna",
      quoteNumber: 7,
      title: "Altan",
      amount: 25_000,
      validUntil: "2026-12-31",
      url: "https://app.example/offert/abc",
      footer: "Ferva · automatiskt meddelande",
    }).html },
    { name: "auth-templates.ts", html: authEmail({
      kind: "signup",
      confirmUrl: "https://app.example/bekrafta",
      token: "123456",
    }).html },
    { name: "owner-notice-templates.ts", html: ownerNoticeTestEmail({
      businessName: "Södermalms Snickeri AB",
      footer: "Ferva · automatiskt meddelande",
      url: "https://app.example",
    }).html },
    { name: "purchase-order-mail.ts", html: purchaseOrderHtml(purchaseOrder) },
  ];
}

describe("mejl: Fervas märke i den gemensamma mallkromen", () => {
  beforeEach(() => {
    for (const key of ORIGIN_VARS) saved[key] = process.env[key];
  });
  afterEach(() => {
    for (const key of ORIGIN_VARS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("bilden är PNG på absolut URL – inte SVG, som Gmail och Outlook blockerar", () => {
    setOrigin("https://ferva.se");
    for (const { name, html } of allHtml()) {
      assert.match(html, /<img[^>]+src="https:\/\/ferva\.se\/icons\/icon-192\.png"/, name);
      assert.doesNotMatch(html, /<img[^>]+\.svg/, `${name}: ingen SVG i mejl`);
    }
  });

  it("width och height sätts som attribut, annars kollapsar bilden i Outlook", () => {
    setOrigin("https://ferva.se");
    for (const { name, html } of allHtml()) {
      const img = /<img[^>]+alt="Ferva"[^>]*>/.exec(html)?.[0];
      assert.ok(img, `${name}: märket finns`);
      assert.match(img, /\swidth="36"/, `${name}: width som attribut`);
      assert.match(img, /\sheight="36"/, `${name}: height som attribut`);
      assert.match(img, /\salt="Ferva"/, `${name}: alt-text`);
    }
  });

  it("utan konfigurerad adress renderas mallen utan bild – ingen låtsas-URL", () => {
    setOrigin(undefined);
    assert.equal(fervaMarkImg(), "");
    for (const { name, html } of allHtml()) {
      assert.doesNotMatch(html, /<img/, `${name}: ingen bild utan adress`);
      assert.doesNotMatch(html, /localhost/, `${name}: aldrig localhost i ett mejl`);
      // Innehållet ska fortfarande vara komplett.
      assert.match(html, /Ferva|Beställning/, `${name}: mallen renderar ändå`);
    }
  });

  it("efterföljande snedstreck i adressen ger inte dubbla snedstreck", () => {
    setOrigin("https://ferva.se/");
    assert.match(fervaMarkImg(), /src="https:\/\/ferva\.se\/icons\/icon-192\.png"/);
  });
});
