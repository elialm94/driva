process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb } from "./invoices/test-db";
import type { Website } from "./types";
import { visibleNavItems } from "./nav";
import { parseSettingsFlik } from "./settings-routes";
import {
  activateWebsiteModule,
  hasWebsiteUsage,
  hideWebsiteFromNav,
  isWebsiteNavVisible,
  websiteModuleState,
} from "./services/modules";
import { generateWebsite, publishWebsite } from "./services/website";
import { confirmPendingAction, sendUserMessage } from "./services/assistant";
import { requestGenerateWebsite } from "./ai/domain";
import { executeTool } from "./ai/tools";
import { matchCommands, parseFreeText } from "./command-bar";

function publishedSite(over: Partial<Website> = {}): Website {
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
    sections: [{ id: "s-hero", type: "hero", heading: "Välkommen", body: "Vi bygger kök.", visible: true }],
    ...over,
  };
}

function navLabels(visible: boolean): string[] {
  return visibleNavItems({ websiteNavVisible: visible }).map((item) => item.label);
}

describe("nytt företag utan hemsida", () => {
  beforeEach(() => replaceDb(emptyTestDb()));

  it("visar inte Hemsida i menyn", () => {
    const data = db();
    assert.equal(hasWebsiteUsage(data), false);
    assert.equal(isWebsiteNavVisible(data.settings, data), false);
    assert.ok(!navLabels(false).includes("Hemsida"));
  });

  it("har Funktioner i Inställningar", () => {
    assert.equal(parseSettingsFlik("funktioner"), "funktioner");
  });

  it("Aktivera visar Hemsida direkt och öppnar buildern (ingen sajt skapas än)", () => {
    activateWebsiteModule();
    const data = db();
    assert.equal(data.settings.websiteNavVisible, true);
    assert.equal(isWebsiteNavVisible(data.settings, data), true);
    assert.equal(data.website, null);
    assert.ok(navLabels(true).includes("Hemsida"));
  });
});

describe("befintligt företag med publicerad hemsida", () => {
  beforeEach(() => replaceDb(emptyTestDb({ website: publishedSite() })));

  it("räknas som aktiverad efter migration (ingen explicit flagga)", () => {
    const data = db();
    assert.equal(data.settings.websiteNavVisible, undefined);
    assert.equal(hasWebsiteUsage(data), true);
    assert.equal(isWebsiteNavVisible(data.settings, data), true);
    assert.equal(websiteModuleState(data).published, true);
    assert.ok(navLabels(true).includes("Hemsida"));
  });

  it("Dölj från meny tar bort nav-item men lämnar sajten live", () => {
    const before = structuredClone(db().website);
    hideWebsiteFromNav();
    const data = db();
    assert.equal(data.settings.websiteNavVisible, false);
    assert.equal(isWebsiteNavVisible(data.settings, data), false);
    assert.ok(!navLabels(false).includes("Hemsida"));
    assert.deepEqual(data.website, before);
    assert.equal(data.website?.status, "publicerad");
    assert.equal(data.website?.publishedAt, "2026-01-01T08:00:00.000Z");
  });
});

describe("företag med domän men utan website-record", () => {
  it("räknas som website-användning och behåller Hemsida", () => {
    const usage = { website: null, domains: [{ id: "dom-1" }] } as Pick<
      ReturnType<typeof emptyTestDb>,
      "website" | "domains"
    >;
    assert.equal(hasWebsiteUsage(usage), true);
    assert.equal(isWebsiteNavVisible({}, usage), true);
  });
});

describe("command bar kan aktivera Hemsida", () => {
  beforeEach(() => replaceDb(emptyTestDb()));

  it("kommandofältet föreslår Aktivera Hemsida för ”Skapa en hemsida”", () => {
    const parsed = parseFreeText("Skapa en hemsida");
    assert.equal(parsed.confidence, "high");
    assert.equal(parsed.confidence === "high" && parsed.commandId, "activate_website");
    assert.equal(matchCommands("hemsida")[0]?.command.label, "Aktivera Hemsida");
  });

  it("kommandot aktiverar modulen och pekar mot buildern", async () => {
    const result = await executeTool("activate_website_module", {}, { origin: "user" });
    assert.equal(result.ok, true);
    assert.equal(result.href, "/hemsida");
    assert.equal(db().settings.websiteNavVisible, true);
    assert.equal(db().website, null);
  });

  it("Skapa en hemsida föreslår Aktivera Hemsida när modulen är dold", async () => {
    await sendUserMessage("Skapa en hemsida");
    const pending = db().pendingActions.find((a) => a.type === "aktivera_hemsida");
    assert.ok(pending);
    const last = db().assistantMessages.at(-1);
    assert.equal(last?.card?.kind, "confirm");
    assert.equal(last?.card && last.card.kind === "confirm" ? last.card.confirmLabel : "", "Aktivera Hemsida");
    assert.match(last?.text ?? "", /aktivera/i);

    await confirmPendingAction(pending.id);
    const data = db();
    assert.equal(data.settings.websiteNavVisible, true);
    assert.equal(isWebsiteNavVisible(data.settings, data), true);
    assert.equal(data.website, null);
    const done = db().assistantMessages.at(-1);
    assert.ok(done?.card?.kind === "links" && done.card.links.some((l) => l.href === "/hemsida"));
  });

  it("generera-hemsida går via aktivering när menyn är dold", () => {
    const result = requestGenerateWebsite("Skapa en hemsida för Test Snickeri");
    assert.equal(db().pendingActions[0]?.type, "aktivera_hemsida");
    assert.match(result.text, /aktivera/i);
  });

  it("när modulen är aktiv föreslås utkast som tidigare", () => {
    activateWebsiteModule();
    const result = requestGenerateWebsite("Skapa en hemsida för Test Snickeri");
    assert.equal(db().pendingActions.at(-1)?.type, "generera_hemsida");
    assert.match(result.text, /utkast/i);
  });
});

describe("generera hemsida aktiverar modulen", () => {
  it("sätter synlighet utan att kräva extra steg", () => {
    replaceDb(emptyTestDb({ settings: { ...emptyTestDb().settings, websiteNavVisible: false } }));
    generateWebsite("Skapa en hemsida för Almqvist Snickeri i Stockholm.");
    const data = db();
    assert.equal(data.settings.websiteNavVisible, true);
    assert.ok(data.website);
    publishWebsite();
    hideWebsiteFromNav();
    assert.equal(db().website?.status, "publicerad");
    assert.equal(isWebsiteNavVisible(db().settings, db()), false);
  });
});
