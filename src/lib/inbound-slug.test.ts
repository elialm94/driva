process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  allocateInboundMailSlug,
  isLegacyHexInboundSlug,
  shouldRemintHexInboundSlug,
  slugFromCompanyName,
} from "./inbox/inbound-slug";
import { inboundMailAddress, inboundMailDomain, inboundSlugFromTo } from "./inbox/inbound-mail";
import { resetDemoData, db } from "./store";
import { updateCompanySettings, getBusinessProfile } from "./services/settings";
import type { CompanySettingsInput } from "./services/settings";
import { ingestInboundMail } from "./services/inbox";

function settingsInput(over: Partial<CompanySettingsInput> = {}): CompanySettingsInput {
  const s = getBusinessProfile();
  return {
    name: s.name,
    orgNumber: s.orgNumber,
    vatNumber: s.vatNumber,
    email: s.email,
    phone: s.phone,
    websiteUrl: s.websiteUrl,
    address: s.address,
    postalCode: s.postalCode,
    city: s.city,
    sate: s.sate,
    country: s.country,
    bankgiro: s.bankgiro,
    plusgiro: s.plusgiro,
    bankAccount: s.bankAccount,
    iban: s.iban,
    bic: s.bic,
    logoInitials: s.logoInitials,
    logoDataUrl: s.logoDataUrl,
    paymentTermsDays: s.paymentTermsDays,
    lateInterestRate: s.lateInterestRate,
    quoteValidityDays: s.quoteValidityDays ?? 30,
    defaultVatRate: s.defaultVatRate ?? 25,
    defaultHourlyRate: s.defaultHourlyRate,
    defaultQuoteTerms: s.defaultQuoteTerms,
    ...over,
  };
}

describe("slugFromCompanyName", () => {
  it("bygger läsbara slugs från företagsnamn", () => {
    assert.equal(slugFromCompanyName("Calles Bygg AB"), "callesbygg");
    assert.equal(slugFromCompanyName("Elias Snickarfirma"), "eliassnickarfirma");
    assert.equal(slugFromCompanyName("Södermalms Snickeri AB"), "sodermalmssnickeri");
  });

  it("foldar åäö och tar bort bolagsform som hela ord", () => {
    assert.equal(slugFromCompanyName("ÅÄÖ-Bygg"), "aaobygg");
    assert.equal(slugFromCompanyName("Calles Bygg Aktiebolag"), "callesbygg");
    assert.equal(slugFromCompanyName("Andersson Eftr"), "andersson");
    assert.equal(slugFromCompanyName("Kablar AB"), "kablar");
    assert.equal(slugFromCompanyName("Support AB"), "support");
  });

  it("tomt eller för kort namn blir foretag", () => {
    assert.equal(slugFromCompanyName(""), "foretag");
    assert.equal(slugFromCompanyName("   "), "foretag");
    assert.equal(slugFromCompanyName("AB"), "foretag");
    assert.equal(slugFromCompanyName("ÅÄ"), "foretag");
  });

  it("kapar basen till 24 tecken utan bindestreck", () => {
    const long = slugFromCompanyName("Supercalifragilisticexpialidocious Byggfirma Norden");
    assert.equal(long.includes("-"), false);
    assert.ok(long.length <= 24);
    assert.equal(long, "supercalifragilisticexpi");
  });
});

describe("allocateInboundMailSlug", () => {
  it("suffixar när samma normaliserade namn redan är upptaget", () => {
    const taken = new Set<string>();
    const first = allocateInboundMailSlug("Calles Bygg AB", (s) => taken.has(s));
    taken.add(first);
    const second = allocateInboundMailSlug("Calles Bygg AB", (s) => taken.has(s));
    taken.add(second);
    const third = allocateInboundMailSlug("Calles Bygg AB", (s) => taken.has(s));
    assert.equal(first, "callesbygg");
    assert.equal(second, "callesbygg2");
    assert.equal(third, "callesbygg3");
  });

  it("behandlar reserverade local-parts som upptagna", () => {
    assert.equal(allocateInboundMailSlug("Support AB", () => false), "support2");
    assert.equal(allocateInboundMailSlug("Demo AB", () => false), "demo2");
    assert.equal(allocateInboundMailSlug("Ferva HB", () => false), "ferva2");
  });

  it("tomt namn blir foretag, annars foretag2 om upptaget", () => {
    assert.equal(allocateInboundMailSlug("", () => false), "foretag");
    assert.equal(allocateInboundMailSlug("", (s) => s === "foretag"), "foretag2");
  });
});

describe("inboundMailAddress", () => {
  it("använder kanonisk domän in.ferva.se eller env", () => {
    const prev = process.env.INBOUND_MAIL_DOMAIN;
    try {
      delete process.env.INBOUND_MAIL_DOMAIN;
      assert.equal(inboundMailDomain(), "in.ferva.se");
      assert.equal(inboundMailAddress("callesbygg"), "callesbygg@in.ferva.se");
      process.env.INBOUND_MAIL_DOMAIN = "in.example.test";
      assert.equal(inboundMailAddress("callesbygg"), "callesbygg@in.example.test");
    } finally {
      if (prev === undefined) delete process.env.INBOUND_MAIL_DOMAIN;
      else process.env.INBOUND_MAIL_DOMAIN = prev;
    }
  });
});

describe("hex-remint", () => {
  it("remintar 12-teckens hex utan inbound-mejl, lämnar hex om mejl finns", () => {
    assert.equal(isLegacyHexInboundSlug("1e469d64b31a"), true);
    assert.equal(isLegacyHexInboundSlug("callesbygg"), false);
    assert.equal(isLegacyHexInboundSlug("demo"), false);
    assert.equal(shouldRemintHexInboundSlug("1e469d64b31a", []), true);
    assert.equal(shouldRemintHexInboundSlug("1e469d64b31a", [{ kind: "uppladdning", source: "uppladdning" }]), true);
    assert.equal(shouldRemintHexInboundSlug("1e469d64b31a", [{ kind: "mail", source: "email" }]), false);
    assert.equal(shouldRemintHexInboundSlug("demo", []), false);
  });
});

describe("namnbyte låser inbound-slug", () => {
  beforeEach(() => {
    resetDemoData();
  });

  it("updateCompanySettings skriver inte om inboundMailSlug", () => {
    const before = db().settings.inboundMailSlug;
    assert.equal(before, "demo");
    updateCompanySettings(settingsInput({ name: "Helt Nytt Namn AB" }));
    assert.equal(db().settings.name, "Helt Nytt Namn AB");
    assert.equal(db().settings.inboundMailSlug, before);
  });
});

describe("ingest till kanonisk och alias-domän", () => {
  beforeEach(() => {
    resetDemoData();
  });

  it("samma slug på in.ferva.se och in.driva.se lyckas", () => {
    const a = ingestInboundMail({
      externalId: "ferva-1",
      to: "demo@in.ferva.se",
      from: "a@x.se",
      subject: "Ett",
      text: "hej",
    });
    const b = ingestInboundMail({
      externalId: "driva-alias-1",
      to: "demo@in.driva.se",
      from: "a@x.se",
      subject: "Två",
      text: "hej",
    });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    if (a.ok) assert.equal(a.created, true);
    if (b.ok) assert.equal(b.created, true);
    assert.equal(inboundSlugFromTo("demo@in.ferva.se"), "demo");
    assert.equal(inboundSlugFromTo("demo@in.driva.se"), "demo");
  });
});
