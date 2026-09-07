process.env.DRIVA_TEST = "1";

/**
 * Ägarens flik läser om när kundens godkännande skett utanför fliken: Bakåt/
 * Framåt ur App Routerns klientcache och en flik som legat öppen visade #115
 * som "Väntar på godkännande" fast servern hade Godkänd. Grinden här avgör
 * när router.refresh() får köras; kanalen bär kundens signal mellan flikar.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_REFRESH_CHANNEL,
  LIVE_REFRESH_MIN_AWAY_MS,
  LIVE_REFRESH_MIN_INTERVAL_MS,
  announceLiveRefresh,
  createLiveRefreshGate,
  isLiveRefreshMessage,
} from "./live-refresh";

describe("live-refresh: grinden för router.refresh()", () => {
  it("Bakåt/Framåt (popstate) och bfcache (pageshow) uppdaterar alltid – med tröskel emellan", () => {
    const gate = createLiveRefreshGate();
    assert.equal(gate.shouldRefresh("popstate", 10_000), true);
    // Snabbt bakåt-bakåt inom tröskeln: en uppdatering räcker.
    assert.equal(gate.shouldRefresh("popstate", 10_000 + LIVE_REFRESH_MIN_INTERVAL_MS - 1), false);
    assert.equal(gate.shouldRefresh("pageshow", 10_000 + LIVE_REFRESH_MIN_INTERVAL_MS), true);
  });

  it("kundens signal från en annan flik uppdaterar direkt – utan krav på frånvaro", () => {
    const gate = createLiveRefreshGate();
    assert.equal(gate.shouldRefresh("broadcast", 5_000), true);
    assert.equal(gate.shouldRefresh("broadcast", 5_100), false, "storm av meddelanden ger EN uppdatering");
    assert.equal(gate.shouldRefresh("broadcast", 5_000 + LIVE_REFRESH_MIN_INTERVAL_MS), true);
  });

  it("flik synlig igen efter frånvaro uppdaterar; utan registrerad frånvaro inte", () => {
    const gate = createLiveRefreshGate();
    // Initial fokus / visibilitychange utan att fliken varit dold: ingen uppdatering.
    assert.equal(gate.shouldRefresh("visible", 1_000), false);
    assert.equal(gate.shouldRefresh("focus", 1_001), false);

    gate.away(2_000);
    assert.equal(gate.shouldRefresh("visible", 2_000 + LIVE_REFRESH_MIN_AWAY_MS), true);
    // Fönstret får fokus strax efter – frånvaron är redan förbrukad.
    assert.equal(gate.shouldRefresh("focus", 2_000 + LIVE_REFRESH_MIN_AWAY_MS + 10), false);
  });

  it("fokusflimmer (kort frånvaro) räknas inte som återkomst", () => {
    const gate = createLiveRefreshGate();
    gate.away(3_000);
    assert.equal(gate.shouldRefresh("focus", 3_000 + LIVE_REFRESH_MIN_AWAY_MS - 1), false);
    // Flimret förbrukade frånvaron: en senare återkomst utan ny frånvaro ger inget.
    assert.equal(gate.shouldRefresh("visible", 10_000), false);
    // Ny riktig frånvaro → uppdatering.
    gate.away(11_000);
    assert.equal(gate.shouldRefresh("visible", 11_000 + LIVE_REFRESH_MIN_AWAY_MS), true);
  });

  it("dold + blur: första frånvaron gäller, återkomsten ger exakt en uppdatering", () => {
    const gate = createLiveRefreshGate({ minAwayMs: 500, minIntervalMs: 200 });
    gate.away(1_000); // visibilitychange → hidden
    gate.away(1_050); // window blur strax efter
    assert.equal(gate.shouldRefresh("visible", 1_600), true);
    assert.equal(gate.shouldRefresh("focus", 1_650), false);
  });

  it("tröskeln gäller även återkomster: precis uppdaterad via broadcast → ingen dubbel", () => {
    const gate = createLiveRefreshGate();
    gate.away(1_000);
    assert.equal(gate.shouldRefresh("broadcast", 4_000), true);
    assert.equal(gate.shouldRefresh("visible", 4_200), false);
  });
});

describe("live-refresh: meddelandet mellan flikar", () => {
  it("känner igen sitt eget meddelande och inget annat", () => {
    assert.equal(isLiveRefreshMessage({ kind: "data-changed", source: "quote-accepted", at: 1 }), true);
    assert.equal(isLiveRefreshMessage({ kind: "data-changed", source: "quote-declined", at: 1 }), true);
    assert.equal(isLiveRefreshMessage({ kind: "other", source: "quote-accepted", at: 1 }), false);
    assert.equal(isLiveRefreshMessage({ kind: "data-changed", at: 1 }), false);
    assert.equal(isLiveRefreshMessage(null), false);
    assert.equal(isLiveRefreshMessage("data-changed"), false);
  });

  it("kundens godkännande når en lyssnande flik på samma kanal", async () => {
    const listener = new BroadcastChannel(LIVE_REFRESH_CHANNEL);
    try {
      const received = new Promise<unknown>((resolve) => {
        listener.onmessage = (event) => resolve(event.data);
      });
      assert.equal(announceLiveRefresh("quote-accepted", 123), true);
      const data = await received;
      assert.equal(isLiveRefreshMessage(data), true);
      assert.deepEqual(data, { kind: "data-changed", source: "quote-accepted", at: 123 });
    } finally {
      listener.close();
    }
  });
});
