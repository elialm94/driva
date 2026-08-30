import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createVoiceController,
  joinTranscript,
  speechErrorMessage,
  VOICE_END_SILENCE_MS,
  VOICE_INITIAL_SILENCE_MS,
  VOICE_MAX_DURATION_MS,
  type VoiceClock,
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
  speechStart() {
    this.handlers?.onSpeechStart?.();
  }
  speechEnd() {
    this.handlers?.onSpeechEnd?.();
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

/** Styrbar klocka – tystnad/maxtid utan riktig mikrofon eller väntan. */
class FakeClock implements VoiceClock {
  nowMs = 0;
  private nextId = 1;
  private timers = new Map<number, { fn: () => void; at: number }>();

  now() {
    return this.nowMs;
  }
  setTimeout(fn: () => void, ms: number) {
    const id = this.nextId++;
    this.timers.set(id, { fn, at: this.nowMs + ms });
    return id;
  }
  clearTimeout(id: unknown) {
    this.timers.delete(id as number);
  }
  get pending() {
    return this.timers.size;
  }
  advance(ms: number) {
    this.nowMs += ms;
    const due = [...this.timers.entries()].filter(([, t]) => t.at <= this.nowMs);
    for (const [id, t] of due) {
      this.timers.delete(id);
      t.fn();
    }
  }
}

function harness(initialText = "") {
  const provider = new MockProvider();
  const clock = new FakeClock();
  const commits: string[] = [];
  let text = initialText;
  const snapshots: VoiceSnapshot[] = [];
  const controller = createVoiceController({
    provider,
    clock,
    getText: () => text,
    setText: (t) => {
      text = t;
    },
    onSnapshot: (s) => snapshots.push(s),
    onCommit: (t) => commits.push(t),
  });
  return {
    provider,
    controller,
    clock,
    commits,
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
    assert.deepEqual(h.commits, ["Påminn mig att ringa Göran på onsdag"]);
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
    assert.deepEqual(h.commits, ["Skapa offert till Anna för köksrenovering på 85 000 kronor"]);
  });

  it("motorns egen tystnadsstopp (onEnd utan manuellt stopp) committar texten", () => {
    const h = harness();
    h.controller.start();
    h.provider.grant();
    h.provider.update("visa obetalda fakturor", true);
    h.provider.end(); // t.ex. Safari slutar själv vid tystnad
    assert.equal(h.getText(), "visa obetalda fakturor");
    assert.equal(h.controller.getSnapshot().status, "idle");
    assert.deepEqual(h.commits, ["visa obetalda fakturor"]);
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
    assert.deepEqual(h.commits, []);
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
    assert.deepEqual(h.commits, []);
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
    assert.equal(speechErrorMessage("permission-denied"), "Tillåt mikrofonåtkomst för att använda röstkommandon.");
    assert.deepEqual(h.commits, []);
  });

  it("inget tal hört → no-speech med 'Försök igen', och nytt försök fungerar", () => {
    const h = harness();
    h.controller.start();
    h.provider.grant();
    h.provider.fail("no-speech");
    assert.equal(h.controller.getSnapshot().status, "error");
    assert.equal(speechErrorMessage("no-speech"), "Jag hörde inget. Försök igen.");

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
    assert.deepEqual(h.commits, []);
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

/* --------------------- Auto-stopp: tystnad, maxtid, commit --------------------- */

describe("röstkontrollern: auto-stopp efter tystnad", () => {
  it("kort kommando: speechend + end-silence → stopp, Tolkar-väg, onCommit en gång", () => {
    const h = harness();
    h.controller.start();
    h.provider.grant();
    h.provider.speechStart();
    h.provider.update("Skapa en faktura till Carina Johansson", false);
    assert.deepEqual(h.commits, []); // interim kör aldrig åtgärd
    h.provider.update("Skapa en faktura till Carina Johansson", true);
    h.provider.speechEnd();
    h.clock.advance(VOICE_END_SILENCE_MS - 1);
    assert.equal(h.provider.stopped, 0);
    assert.equal(h.controller.getSnapshot().status, "listening");
    h.clock.advance(1);
    assert.equal(h.provider.stopped, 1);
    assert.equal(h.controller.getSnapshot().status, "transcribing");
    h.provider.end();
    assert.equal(h.getText(), "Skapa en faktura till Carina Johansson");
    assert.deepEqual(h.commits, ["Skapa en faktura till Carina Johansson"]);
    assert.equal(h.controller.getSnapshot().status, "idle");
  });

  it("påminnelsetranskript lämnas till samma pipeline (onCommit), ingen egen guide", () => {
    const h = harness();
    const phrase = "Påminn mig att ringa Göran imorgon klockan tolv";
    h.controller.start();
    h.provider.grant();
    h.provider.speechStart();
    h.provider.update(phrase, true);
    h.provider.speechEnd();
    h.clock.advance(VOICE_END_SILENCE_MS);
    h.provider.end();
    assert.deepEqual(h.commits, [phrase]);
    assert.equal(h.getText(), phrase);
  });

  it("inledande tystnad → timeout, inget kommando, 'Jag hörde inget'", () => {
    const h = harness();
    h.controller.start();
    h.provider.grant();
    h.clock.advance(VOICE_INITIAL_SILENCE_MS - 1);
    assert.equal(h.controller.getSnapshot().status, "listening");
    h.clock.advance(1);
    assert.equal(h.controller.getSnapshot().status, "error");
    assert.equal(h.controller.getSnapshot().errorCode, "no-speech");
    assert.equal(h.provider.aborted, 1);
    assert.deepEqual(h.commits, []);
    assert.equal(speechErrorMessage("no-speech"), "Jag hörde inget. Försök igen.");
  });

  it("manuellt stopp committar slutlig text (fallback när VAD inte triggar)", () => {
    const h = harness();
    h.controller.start();
    h.provider.grant();
    h.provider.update("visa obetalda fakturor", true);
    h.controller.stop();
    assert.equal(h.provider.stopped, 1);
    assert.equal(h.controller.getSnapshot().status, "transcribing");
    h.provider.end();
    assert.deepEqual(h.commits, ["visa obetalda fakturor"]);
  });

  it("avbryt (Esc-väg) slänger sessionen och kör inget kommando", () => {
    const h = harness("befintlig");
    h.controller.start();
    h.provider.grant();
    h.provider.update("halvfärdigt", false);
    h.controller.cancel();
    h.clock.advance(VOICE_END_SILENCE_MS);
    h.clock.advance(VOICE_MAX_DURATION_MS);
    assert.equal(h.getText(), "befintlig");
    assert.deepEqual(h.commits, []);
    assert.equal(h.clock.pending, 0);
  });

  it("maxtid tvingar stopp och committar det som finns", () => {
    const h = harness();
    h.controller.start();
    h.provider.grant();
    h.provider.speechStart();
    h.provider.update("långt pågående kommando", false);
    h.provider.speechEnd();
    h.provider.speechStart(); // motorn säger fortfarande pågående yttrande
    h.clock.advance(VOICE_MAX_DURATION_MS - 1);
    assert.equal(h.provider.stopped, 0);
    h.clock.advance(1);
    assert.equal(h.provider.stopped, 1);
    assert.equal(h.controller.getSnapshot().status, "transcribing");
    h.provider.end();
    assert.deepEqual(h.commits, ["långt pågående kommando"]);
  });

  it("nekad mikrofon → svensk copy, inget kommando", () => {
    const h = harness();
    h.controller.start();
    h.provider.fail("permission-denied");
    assert.equal(h.controller.getSnapshot().errorCode, "permission-denied");
    assert.equal(speechErrorMessage("permission-denied"), "Tillåt mikrofonåtkomst för att använda röstkommandon.");
    assert.deepEqual(h.commits, []);
  });

  it("transkriptionsfel efter tal → ingen delåtgärd, fältet återställt", () => {
    const h = harness("kvar");
    h.controller.start();
    h.provider.grant();
    h.provider.speechStart();
    h.provider.update("Skapa en faktura till", false);
    h.provider.fail("network");
    assert.equal(h.controller.getSnapshot().errorCode, "transcription-failed");
    assert.equal(speechErrorMessage("transcription-failed"), "Kunde inte tolka det du sa. Försök igen.");
    assert.equal(h.getText(), "kvar");
    assert.deepEqual(h.commits, []);
  });

  it("interim uppdateringar kör aldrig onCommit, även när isFinal saknas", () => {
    const h = harness();
    h.controller.start();
    h.provider.grant();
    h.provider.update("Skapa en", false);
    h.provider.update("Skapa en faktura", false);
    h.clock.advance(VOICE_END_SILENCE_MS - 1);
    assert.deepEqual(h.commits, []);
    assert.equal(h.controller.getSnapshot().status, "listening");
  });

  it("kort paus mitt i meningen (interim + speechstart igen) stoppar inte", () => {
    const h = harness();
    h.controller.start();
    h.provider.grant();
    h.provider.speechStart();
    h.provider.update("Skapa en faktura till", false);
    h.provider.speechEnd();
    h.clock.advance(VOICE_END_SILENCE_MS - 200);
    // Användaren fortsätter efter en kort tankepaus.
    h.provider.speechStart();
    h.provider.update("Skapa en faktura till Carina Johansson", false);
    h.clock.advance(VOICE_END_SILENCE_MS);
    assert.equal(h.provider.stopped, 0, "pågående yttrande ska inte auto-stoppas");
    assert.deepEqual(h.commits, []);
    h.provider.update("Skapa en faktura till Carina Johansson", true);
    h.provider.speechEnd();
    h.clock.advance(VOICE_END_SILENCE_MS);
    assert.equal(h.provider.stopped, 1);
    h.provider.end();
    assert.deepEqual(h.commits, ["Skapa en faktura till Carina Johansson"]);
  });

  it("inledande tystnad under 7 s räknas inte som sluttystnad – tal hinner börja", () => {
    const h = harness();
    h.controller.start();
    h.provider.grant();
    h.clock.advance(3_000);
    assert.equal(h.controller.getSnapshot().status, "listening");
    h.provider.speechStart();
    h.provider.update("hej", true);
    h.clock.advance(VOICE_INITIAL_SILENCE_MS);
    // start-timern ska vara avväpnad; bara end-silence/maxtid gäller efter tal
    assert.notEqual(h.controller.getSnapshot().status, "error");
  });

  it("generellt mikrofonfel före tal → 'Mikrofonen kunde inte användas.'", () => {
    const h = harness();
    h.controller.start();
    h.provider.fail("audio-capture");
    assert.equal(speechErrorMessage("audio-capture"), "Mikrofonen kunde inte användas.");
    assert.equal(speechErrorMessage("unknown"), "Mikrofonen kunde inte användas.");
    assert.deepEqual(h.commits, []);
  });

  it("dispose rensar timers så inget sent auto-stopp läcker", () => {
    const h = harness();
    h.controller.start();
    h.provider.grant();
    h.provider.update("pågående", false);
    h.controller.dispose();
    h.clock.advance(VOICE_MAX_DURATION_MS);
    h.clock.advance(VOICE_END_SILENCE_MS);
    assert.equal(h.clock.pending, 0);
    assert.deepEqual(h.commits, []);
    assert.equal(h.provider.aborted, 1);
  });
});

/*
 * Manuellt kvar (kräver riktig mikrofon / enhet – inte CI):
 *  - bakgrundsljud på kontor, tangentbord, låg musik, utomhus
 *  - Chrome/Safari/iOS faktiska speechend-latens och mic-indikatorn som släcks
 *  - mobil: tap → prata → auto-stopp utan att tangentbord/bottennav täcker läget
 *  - 2 s tankepaus när motorn fortfarande flaggar pågående yttrande
 */

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
  onspeechstart: (() => void) | null = null;
  onspeechend: (() => void) | null = null;
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

  it("vidarebefordrar native speechstart/speechend (VAD) till kontrollern", () => {
    FakeRecognition.instances = [];
    const provider = createWebSpeechProvider({ webkitSpeechRecognition: FakeRecognition })!;
    const { handlers, events } = collectingHandlers();
    const withSpeech: SpeechSessionHandlers = {
      ...handlers,
      onSpeechStart: () => events.push("speechstart"),
      onSpeechEnd: () => events.push("speechend"),
    };
    provider.start({ lang: "sv-SE" }, withSpeech);
    const rec = FakeRecognition.instances[0]!;
    rec.onspeechstart?.();
    rec.onspeechend?.();
    assert.deepEqual(events, ["speechstart", "speechend"]);
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
    assert.equal(rec.onerror, null);
    assert.equal(rec.onresult, null);
    assert.equal(rec.onend, null);
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
