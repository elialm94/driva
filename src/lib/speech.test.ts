import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createVoiceController,
  joinTranscript,
  speechErrorMessage,
  type VoiceSnapshot,
  type VoiceStatus,
} from "./speech/controller";
import {
  createWebSpeechProvider,
  getSpeechRecognitionCtor,
  mapRecognitionError,
} from "./speech/web-speech";
import type {
  SpeechErrorCode,
  SpeechSessionHandlers,
  SpeechStartOptions,
  SpeechToTextProvider,
} from "./speech/types";

/* --------------------------- Mockad leverantör --------------------------- */

/** Deterministisk leverantör som testerna styr händelse för händelse. */
class MockProvider implements SpeechToTextProvider {
  starts = 0;
  stopped = 0;
  aborted = 0;
  lastOptions: SpeechStartOptions | null = null;
  handlers: SpeechSessionHandlers | null = null;

  start(options: SpeechStartOptions, handlers: SpeechSessionHandlers) {
    this.starts += 1;
    this.lastOptions = options;
    this.handlers = handlers;
    return {
      stop: () => {
        this.stopped += 1;
      },
      abort: () => {
        this.aborted += 1;
      },
    };
  }

  grant() {
    this.handlers?.onStart();
  }
  update(text: string, isFinal = false) {
    this.handlers?.onUpdate({ text, isFinal });
  }
  end() {
    this.handlers?.onEnd();
  }
  fail(code: SpeechErrorCode) {
    this.handlers?.onError({ code });
  }
}

function harness(initialText = "") {
  const provider = new MockProvider();
  let text = initialText;
  const snapshots: VoiceSnapshot[] = [];
  const controller = createVoiceController({
    provider,
    getText: () => text,
    setText: (t) => {
      text = t;
    },
    onSnapshot: (s) => snapshots.push(s),
  });
  return {
    provider,
    controller,
    snapshots,
    statuses: (): VoiceStatus[] => snapshots.map((s) => s.status),
    getText: () => text,
  };
}

/* ------------------------------ joinTranscript ---------------------------- */

describe("joinTranscript", () => {
  it("tom bas → bara transkriptet", () => {
    assert.equal(joinTranscript("", "hej på dig"), "hej på dig");
  });
  it("append med exakt ett mellanslag – aldrig överskrivning", () => {
    assert.equal(
      joinTranscript("Skapa offert till Anna", "för köksrenovering på 85 000 kronor"),
      "Skapa offert till Anna för köksrenovering på 85 000 kronor"
    );
  });
  it("dubbla mellanslag uppstår inte (bas med efterföljande blank)", () => {
    assert.equal(joinTranscript("bas ", "x"), "bas x");
  });
  it("tomt transkript lämnar basen orörd", () => {
    assert.equal(joinTranscript("bas", "   "), "bas");
  });
  it("bas med bara blanksteg → bara transkriptet", () => {
    assert.equal(joinTranscript("   ", "x"), "x");
  });
});

/* ------------------------------ Tillståndsmaskinen ------------------------ */

describe("röstkontrollern: lyckat flöde", () => {
  it("idle → requesting → listening → transcribing → idle med texten i fältet", () => {
    const h = harness();
    h.controller.start();
    assert.deepEqual(h.statuses(), ["requesting"]);
    assert.equal(h.provider.lastOptions?.lang, "sv-SE"); // svensk språkhint

    h.provider.grant();
    assert.deepEqual(h.statuses(), ["requesting", "listening"]);

    h.provider.update("påminn mig", false);
    assert.equal(h.getText(), "påminn mig"); // live-interim i fältet

    h.controller.stop();
    assert.equal(h.provider.stopped, 1);
    assert.deepEqual(h.statuses(), ["requesting", "listening", "transcribing"]);

    h.provider.update("Påminn mig att ringa Göran på onsdag", true);
    h.provider.end();
    assert.equal(h.getText(), "Påminn mig att ringa Göran på onsdag");
    assert.deepEqual(h.statuses(), ["requesting", "listening", "transcribing", "idle"]);
  });

  it("append: befintlig text behålls och transkriptet läggs till med mellanslag", () => {
    const h = harness("Skapa offert till Anna");
    h.controller.start();
    h.provider.grant();
    h.provider.update("för köks", false);
    // Interim-förhandsvisningen skriver aldrig över basen.
    assert.equal(h.getText(), "Skapa offert till Anna för köks");
    h.provider.update("för köksrenovering på 85 000 kronor", true);
    h.provider.end();
    assert.equal(h.getText(), "Skapa offert till Anna för köksrenovering på 85 000 kronor");
  });

  it("motorns egen tystnadsstopp (onEnd utan manuellt stopp) committar texten", () => {
    const h = harness();
    h.controller.start();
    h.provider.grant();
    h.provider.update("visa obetalda fakturor", true);
    h.provider.end(); // t.ex. Safari slutar själv vid tystnad
    assert.equal(h.getText(), "visa obetalda fakturor");
    assert.equal(h.controller.getSnapshot().status, "idle");
  });

  it("stopp utan slutligt resultat använder senaste interim (användbar delvis text)", () => {
    const h = harness();
    h.controller.start();
    h.provider.grant();
    h.provider.update("ring anna", false);
    h.controller.stop();
    h.provider.end(); // inget final hann komma
    assert.equal(h.getText(), "ring anna");
    assert.equal(h.controller.getSnapshot().status, "idle");
  });
});

describe("röstkontrollern: avbryt", () => {
  it("cancel återställer fältet till exakt innehållet före inspelningen", () => {
    const h = harness("hej ");
    h.controller.start();
    h.provider.grant();
    h.provider.update("nu pratar jag", false);
    assert.equal(h.getText(), "hej nu pratar jag");
    h.controller.cancel();
    assert.equal(h.getText(), "hej "); // exakt, inklusive avslutande blanksteg
    assert.equal(h.provider.aborted, 1);
    assert.equal(h.controller.getSnapshot().status, "idle");
  });

  it("sena callbacks från en avbruten session ignoreras (ingen kapplöpning)", () => {
    const h = harness("bas");
    h.controller.start();
    h.provider.grant();
    const ghost = h.provider.handlers!;
    h.controller.cancel();
    ghost.onUpdate({ text: "spöktext", isFinal: false });
    ghost.onEnd();
    ghost.onError({ code: "network" });
    assert.equal(h.getText(), "bas");
    assert.equal(h.controller.getSnapshot().status, "idle");
  });

  it("dispose släpper sessionen tyst utan att röra fälttexten", () => {
    const h = harness();
    h.controller.start();
    h.provider.grant();
    h.provider.update("halvfärdig mening", false);
    h.controller.dispose();
    assert.equal(h.provider.aborted, 1);
    assert.equal(h.getText(), "halvfärdig mening"); // fältet ägs av UI:t vid unmount
  });
});

describe("röstkontrollern: fel och nytt försök", () => {
  it("nekad mikrofon → felstatus med vänligt svenskt meddelande, fältet återställt", () => {
    const h = harness("skriven text");
    h.controller.start();
    h.provider.update("skräp", false);
    h.provider.fail("permission-denied");
    const snap = h.controller.getSnapshot();
    assert.equal(snap.status, "error");
    assert.equal(snap.errorCode, "permission-denied");
    assert.equal(h.getText(), "skriven text");
    assert.equal(
      speechErrorMessage("permission-denied"),
      "Mikrofonåtkomst är avstängd. Tillåt mikrofonen i webbläsaren för att använda röst."
    );
  });

  it("inget tal hört → no-speech med 'Försök igen', och nytt försök fungerar", () => {
    const h = harness();
    h.controller.start();
    h.provider.grant();
    h.provider.fail("no-speech");
    assert.equal(h.controller.getSnapshot().status, "error");
    assert.equal(speechErrorMessage("no-speech"), "Jag kunde inte höra det tydligt. Försök igen.");

    h.controller.start(); // retry från felläget
    assert.equal(h.provider.starts, 2);
    h.provider.grant();
    assert.equal(h.controller.getSnapshot().status, "listening");
  });

  it("session som slutar utan någon text alls → no-speech-fel", () => {
    const h = harness("bas");
    h.controller.start();
    h.provider.grant();
    h.provider.end();
    const snap = h.controller.getSnapshot();
    assert.equal(snap.status, "error");
    assert.equal(snap.errorCode, "no-speech");
    assert.equal(h.getText(), "bas");
  });

  it("cancel i felläge avfärdar felet utan att röra texten", () => {
    const h = harness("bas");
    h.controller.start();
    h.provider.fail("network");
    h.controller.cancel();
    assert.equal(h.controller.getSnapshot().status, "idle");
    assert.equal(h.getText(), "bas");
  });
});

describe("röstkontrollern: inga dubbelinspelningar", () => {
  it("start under pågående session ignoreras", () => {
    const h = harness();
    h.controller.start();
    h.controller.start();
    assert.equal(h.provider.starts, 1);
    h.provider.grant();
    h.controller.start();
    assert.equal(h.provider.starts, 1);
  });

  it("toggle: idle→starta, requesting→avbryt, listening→stoppa, transcribing→ignorera", () => {
    const h = harness();
    h.controller.toggle();
    assert.equal(h.provider.starts, 1);
    assert.equal(h.controller.getSnapshot().status, "requesting");

    h.controller.toggle(); // före beviljad behörighet = avbryt
    assert.equal(h.provider.aborted, 1);
    assert.equal(h.controller.getSnapshot().status, "idle");

    h.controller.toggle();
    assert.equal(h.provider.starts, 2);
    h.provider.grant();
    h.controller.toggle(); // lyssnar = stoppa
    assert.equal(h.provider.stopped, 1);
    assert.equal(h.controller.getSnapshot().status, "transcribing");

    h.controller.toggle(); // under transkribering: inget nytt
    assert.equal(h.provider.starts, 2);
  });
});

/* --------------------------- Web Speech-leverantören ---------------------- */

/** Fejkad SpeechRecognition som fångar konfiguration och händelser. */
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = "";
  interimResults = false;
  continuous = false;
  maxAlternatives = 0;
  onstart: (() => void) | null = null;
  onresult: ((event: { results: { isFinal: boolean; length: number; 0: { transcript: string } }[] }) => void) | null =
    null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = 0;
  stopCalls = 0;
  abortCalls = 0;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.started += 1;
  }
  stop() {
    this.stopCalls += 1;
  }
  abort() {
    this.abortCalls += 1;
  }
}

function recognitionEvent(parts: { text: string; final: boolean }[]) {
  return {
    results: parts.map((p) => ({ isFinal: p.final, length: 1, 0: { transcript: p.text } })),
  };
}

function collectingHandlers() {
  const events: string[] = [];
  const updates: { text: string; isFinal: boolean }[] = [];
  const errors: SpeechErrorCode[] = [];
  const handlers: SpeechSessionHandlers = {
    onStart: () => events.push("start"),
    onUpdate: (u) => {
      events.push("update");
      updates.push(u);
    },
    onEnd: () => events.push("end"),
    onError: (e) => {
      events.push("error");
      errors.push(e.code);
    },
  };
  return { handlers, events, updates, errors };
}

describe("web speech-leverantören", () => {
  it("kapabilitet: utan API → null (mikrofonen döljs), med webkit-prefix → leverantör", () => {
    assert.equal(createWebSpeechProvider({}), null);
    assert.equal(createWebSpeechProvider(null), null);
    assert.equal(createWebSpeechProvider({ SpeechRecognition: 42 }), null);
    assert.notEqual(createWebSpeechProvider({ webkitSpeechRecognition: FakeRecognition }), null);
    assert.notEqual(getSpeechRecognitionCtor({ SpeechRecognition: FakeRecognition }), null);
  });

  it("konfigurerar sv-SE, interimresultat och kontinuerligt läge, och lazy-skapar motorn", () => {
    FakeRecognition.instances = [];
    const provider = createWebSpeechProvider({ webkitSpeechRecognition: FakeRecognition })!;
    assert.equal(FakeRecognition.instances.length, 0); // inget objekt före första trycket
    const { handlers } = collectingHandlers();
    provider.start({ lang: "sv-SE" }, handlers);
    const rec = FakeRecognition.instances[0]!;
    assert.equal(rec.lang, "sv-SE");
    assert.equal(rec.interimResults, true);
    assert.equal(rec.continuous, true);
    assert.equal(rec.started, 1);
  });

  it("bygger om hela transkriptet per händelse; isFinal när inga interim finns", () => {
    FakeRecognition.instances = [];
    const provider = createWebSpeechProvider({ webkitSpeechRecognition: FakeRecognition })!;
    const { handlers, updates } = collectingHandlers();
    provider.start({ lang: "sv-SE" }, handlers);
    const rec = FakeRecognition.instances[0]!;

    rec.onresult!(recognitionEvent([{ text: "påminn mig", final: false }]));
    rec.onresult!(
      recognitionEvent([
        { text: "påminn mig att ringa", final: true },
        { text: " Göran på onsdag", final: false },
      ])
    );
    rec.onresult!(
      recognitionEvent([
        { text: "påminn mig att ringa", final: true },
        { text: "Göran på onsdag", final: true },
      ])
    );
    assert.deepEqual(updates, [
      { text: "påminn mig", isFinal: false },
      { text: "påminn mig att ringa Göran på onsdag", isFinal: false },
      { text: "påminn mig att ringa Göran på onsdag", isFinal: true },
    ]);
  });

  it("not-allowed → permission-denied, och onend efter fel vidarebefordras inte", () => {
    FakeRecognition.instances = [];
    const provider = createWebSpeechProvider({ webkitSpeechRecognition: FakeRecognition })!;
    const { handlers, events, errors } = collectingHandlers();
    provider.start({ lang: "sv-SE" }, handlers);
    const rec = FakeRecognition.instances[0]!;
    rec.onerror!({ error: "not-allowed" });
    rec.onend!();
    assert.deepEqual(events, ["error"]);
    assert.deepEqual(errors, ["permission-denied"]);
  });

  it("abort tystar sessionen: inga callbacks efteråt, 'aborted'-felet sväljs", () => {
    FakeRecognition.instances = [];
    const provider = createWebSpeechProvider({ webkitSpeechRecognition: FakeRecognition })!;
    const { handlers, events } = collectingHandlers();
    const session = provider.start({ lang: "sv-SE" }, handlers);
    const rec = FakeRecognition.instances[0]!;
    session.abort();
    assert.equal(rec.abortCalls, 1);
    rec.onerror!({ error: "aborted" });
    rec.onresult!(recognitionEvent([{ text: "spök", final: false }]));
    rec.onend!();
    assert.deepEqual(events, []);
  });

  it("start() som kastar → vänligt 'unknown'-fel i stället för krasch", () => {
    class ThrowingRecognition extends FakeRecognition {
      override start(): void {
        throw new Error("InvalidStateError");
      }
    }
    const provider = createWebSpeechProvider({ webkitSpeechRecognition: ThrowingRecognition })!;
    const { handlers, errors } = collectingHandlers();
    provider.start({ lang: "sv-SE" }, handlers);
    assert.deepEqual(errors, ["unknown"]);
  });

  it("felkoder normaliseras leverantörsoberoende", () => {
    assert.equal(mapRecognitionError("service-not-allowed"), "permission-denied");
    assert.equal(mapRecognitionError("no-speech"), "no-speech");
    assert.equal(mapRecognitionError("audio-capture"), "audio-capture");
    assert.equal(mapRecognitionError("network"), "network");
    assert.equal(mapRecognitionError("språkfel"), "unknown");
    assert.equal(mapRecognitionError(undefined), "unknown");
  });
});
