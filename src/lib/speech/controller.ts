import type { SpeechErrorCode, SpeechSession, SpeechToTextProvider } from "./types";

/**
 * Tillståndsmaskin för röstinmatning – ren modul utan React/DOM så att den
 * kan enhetstestas med en mockad leverantör.
 *
 *   idle → requesting → listening → transcribing → idle (+ onCommit)
 *                     ↘ error (vänligt meddelande + nytt försök)
 *
 * Kortkommando, inte inspelningssession:
 *  - Efter att tal hörts: ~1,5 s tystnad (motorns speechend/VAD + timer) → stopp.
 *  - Innan tal hörts: längre startfönster; annars "Jag hörde inget".
 *  - Maxtid tvingar stopp så mikrofonen aldrig hänger.
 *  - Slutligt transkript skickas till samma pipeline som Enter (onCommit).
 *  - Interim visas live men onCommit körs aldrig på halvfärdig text.
 *  - Avbryt återställer fältet och kör inget kommando.
 */

export type VoiceStatus = "idle" | "requesting" | "listening" | "transcribing" | "error";

export interface VoiceSnapshot {
  status: VoiceStatus;
  errorCode: SpeechErrorCode | null;
}

export const VOICE_LANG_DEFAULT = "sv-SE";

/**
 * Tid innan tal börjat: användaren ska hinna andas och börja prata.
 * 7 s ligger i mitten av 5–8 s och matchar ungefär webbläsarens egen no-speech.
 */
export const VOICE_INITIAL_SILENCE_MS = 7_000;

/**
 * Tystnad efter att tal hörts. 1,5 s (övre delen av 1,2–1,5 s) så en kort
 * tankepaus ("till… Carina") inte klipper, men ett avslutat kommando känns
 * omedelbart. Primär signal är motorns speechend/isFinal – inte mic-nivå.
 */
export const VOICE_END_SILENCE_MS = 1_500;

/** Säkerhetsgräns: korta kommandon, aldrig obegränsad inspelning. */
export const VOICE_MAX_DURATION_MS = 35_000;

/** Injicerbar klocka så testerna kan styra tystnad/maxtid utan riktig väntan. */
export interface VoiceClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export function defaultVoiceClock(): VoiceClock {
  return {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => {
      clearTimeout(id as ReturnType<typeof setTimeout>);
    },
  };
}

/** Vänliga svenska felmeddelanden – aldrig tekniska koder i UI:t. */
export function speechErrorMessage(code: SpeechErrorCode): string {
  switch (code) {
    case "permission-denied":
      return "Tillåt mikrofonåtkomst för att använda röstkommandon.";
    case "no-speech":
      return "Jag hörde inget. Försök igen.";
    case "transcription-failed":
      return "Kunde inte tolka det du sa. Försök igen.";
    case "audio-capture":
    case "network":
    case "unknown":
      return "Mikrofonen kunde inte användas.";
  }
}

/** Lägger transkript efter befintlig text med exakt ett mellanslag emellan. */
export function joinTranscript(base: string, transcript: string): string {
  const addition = transcript.trim();
  if (!addition) return base;
  if (!base.trim()) return addition;
  return `${base.replace(/\s+$/u, "")} ${addition}`;
}

export interface VoiceControllerOptions {
  provider: SpeechToTextProvider;
  /** Språkhint till motorn. Standard: sv-SE. */
  lang?: string;
  /** Läser fältets nuvarande värde (fångas som bas när inspelningen startar). */
  getText(): string;
  /** Skriver till fältet: interim-förhandsvisning och slutlig text. */
  setText(text: string): void;
  /** Statusändringar för UI:t. */
  onSnapshot(snapshot: VoiceSnapshot): void;
  /**
   * Körs EN gång med det slutliga transkriptet efter att inspelningen stoppats.
   * Samma text som ligger i fältet – anroparen skickar den till Enter-pipelinen.
   * Anropas inte vid avbryt, tomt resultat, fel eller interim.
   */
  onCommit?(text: string): void;
  /** Testbar tid. Standard: webbläsarens setTimeout/Date.now. */
  clock?: VoiceClock;
  initialSilenceMs?: number;
  endSilenceMs?: number;
  maxDurationMs?: number;
}

export interface VoiceController {
  /** Starta en session (från idle eller error). Ignoreras under pågående. */
  start(): void;
  /** Sluta lyssna och behåll transkriptet (→ transcribing → idle). */
  stop(): void;
  /** Avbryt: släng sessionens resultat och återställ fältet exakt. I felläge: avfärda felet. */
  cancel(): void;
  /** Knappens beteende: idle/fel → starta; väntar på behörighet → avbryt; lyssnar → stoppa. */
  toggle(): void;
  /** Släpp resurser tyst utan att röra fälttexten (unmount). */
  dispose(): void;
  getSnapshot(): VoiceSnapshot;
}

export function createVoiceController(options: VoiceControllerOptions): VoiceController {
  const clock = options.clock ?? defaultVoiceClock();
  const initialSilenceMs = options.initialSilenceMs ?? VOICE_INITIAL_SILENCE_MS;
  const endSilenceMs = options.endSilenceMs ?? VOICE_END_SILENCE_MS;
  const maxDurationMs = options.maxDurationMs ?? VOICE_MAX_DURATION_MS;

  let status: VoiceStatus = "idle";
  let errorCode: SpeechErrorCode | null = null;
  let session: SpeechSession | null = null;
  /** Fältets exakta innehåll när inspelningen startade (för append + återställning). */
  let base = "";
  /** Senaste transkript-texten från sessionen (interim eller final). */
  let lastText = "";
  /** Sant när motorn rapporterat tal eller icke-tom text. */
  let heardSpeech = false;
  /** Sant om motorn någon gång skickat speechend – då litar vi på native VAD. */
  let sawSpeechEnd = false;
  /** Löpnummer för aktiv session – sena callbacks från gamla sessioner ignoreras. */
  let token = 0;
  let initialTimer: unknown = null;
  let endTimer: unknown = null;
  let maxTimer: unknown = null;
  let committed = false;

  function setStatus(next: VoiceStatus, code: SpeechErrorCode | null = null) {
    status = next;
    errorCode = code;
    options.onSnapshot({ status, errorCode });
  }

  function isBusy(): boolean {
    return status === "requesting" || status === "listening" || status === "transcribing";
  }

  function clearTimer(id: unknown) {
    if (id != null) clock.clearTimeout(id);
  }

  function clearAllTimers() {
    clearTimer(initialTimer);
    clearTimer(endTimer);
    clearTimer(maxTimer);
    initialTimer = null;
    endTimer = null;
    maxTimer = null;
  }

  function armInitialSilence(active: number) {
    clearTimer(initialTimer);
    initialTimer = clock.setTimeout(() => {
      if (token !== active || status !== "listening" || heardSpeech) return;
      // Inget tal alls: släpp micken direkt, inget kommando.
      fail("no-speech");
    }, initialSilenceMs);
  }

  function armMaxDuration(active: number) {
    clearTimer(maxTimer);
    maxTimer = clock.setTimeout(() => {
      if (token !== active || status !== "listening") return;
      requestStop();
    }, maxDurationMs);
  }

  function armEndSilence(active: number) {
    if (status !== "listening") return;
    clearTimer(endTimer);
    endTimer = clock.setTimeout(() => {
      if (token !== active || status !== "listening" || !heardSpeech) return;
      requestStop();
    }, endSilenceMs);
  }

  function clearEndSilence() {
    clearTimer(endTimer);
    endTimer = null;
  }

  /** Sessionsslut: committa transkriptet till pipelinen, eller vänligt fel. */
  function finish(text: string) {
    if (committed) return;
    committed = true;
    clearAllTimers();
    const s = session;
    session = null;
    // Säkerställ att motorn släppt mikrofonen även om onEnd kom först.
    s?.stop();
    const trimmed = text.trim();
    if (trimmed) {
      if (status === "listening") setStatus("transcribing");
      const full = joinTranscript(base, trimmed);
      options.setText(full);
      setStatus("idle");
      options.onCommit?.(full);
    } else {
      options.setText(base);
      setStatus("error", heardSpeech ? "transcription-failed" : "no-speech");
    }
  }

  function fail(code: SpeechErrorCode) {
    if (committed) return;
    committed = true;
    clearAllTimers();
    const s = session;
    session = null;
    s?.abort();
    options.setText(base);
    setStatus("error", code);
  }

  function requestStop() {
    if (status !== "listening") return;
    clearAllTimers();
    setStatus("transcribing");
    session?.stop();
  }

  function start() {
    if (isBusy()) return; // ingen dubbelstart under övergångar
    token += 1;
    const active = token;
    base = options.getText();
    lastText = "";
    heardSpeech = false;
    sawSpeechEnd = false;
    committed = false;
    clearAllTimers();
    setStatus("requesting");
    const started = options.provider.start(
      { lang: options.lang ?? VOICE_LANG_DEFAULT },
      {
        onStart() {
          if (token !== active || status !== "requesting") return;
          setStatus("listening");
          armInitialSilence(active);
          armMaxDuration(active);
        },
        onSpeechStart() {
          if (token !== active) return;
          heardSpeech = true;
          clearTimer(initialTimer);
          initialTimer = null;
          // Nytt tal mitt i en tystnadspaus – avbryt pending auto-stopp.
          clearEndSilence();
        },
        onSpeechEnd() {
          if (token !== active || status !== "listening") return;
          sawSpeechEnd = true;
          if (heardSpeech) armEndSilence(active);
        },
        onUpdate(update) {
          if (token !== active) return;
          lastText = update.text;
          options.setText(joinTranscript(base, update.text));
          if (update.text.trim()) {
            heardSpeech = true;
            clearTimer(initialTimer);
            initialTimer = null;
          }
          if (status !== "listening") return;
          if (update.isFinal) {
            // Segment klart enligt motorn – kort tystnadsfönster, sen stopp.
            armEndSilence(active);
            return;
          }
          if (!sawSpeechEnd) {
            // Ingen native VAD ännu: inaktivitet sedan senaste interim.
            armEndSilence(active);
            return;
          }
          // Motorn har VAD och skickar fortfarande interim → pågående yttrande.
          clearEndSilence();
        },
        onEnd() {
          if (token !== active) return;
          finish(lastText);
        },
        onError(error) {
          if (token !== active) return;
          let code = error.code;
          if (heardSpeech && (code === "network" || code === "unknown")) {
            code = "transcription-failed";
          }
          fail(code);
        },
      }
    );
    // Callbacks kan ha hunnit köra synkront (t.ex. direktfel) – spara bara
    // sessionen om den fortfarande är den aktiva.
    if (token === active && isBusy()) session = started;
  }

  /** Avbryt tyst: döda sessionen utan callbacks. */
  function killSession() {
    token += 1;
    committed = true;
    clearAllTimers();
    const s = session;
    session = null;
    s?.abort();
  }

  function stop() {
    if (status === "listening") {
      requestStop();
      return;
    }
    // Före beviljad behörighet finns inget att behålla – behandla som avbryt.
    if (status === "requesting") cancel();
  }

  function cancel() {
    if (isBusy()) {
      killSession();
      options.setText(base);
      setStatus("idle");
      return;
    }
    if (status === "error") setStatus("idle"); // avfärda felet
  }

  function toggle() {
    if (status === "idle" || status === "error") {
      start();
      return;
    }
    if (status === "requesting") {
      cancel();
      return;
    }
    if (status === "listening") {
      stop();
      return;
    }
    // transcribing: ignorera tryck tills övergången är klar
  }

  function dispose() {
    killSession();
    // Ingen setText här – vid unmount ägs fälttexten av UI:t.
    if (status !== "idle") setStatus("idle");
  }

  return {
    start,
    stop,
    cancel,
    toggle,
    dispose,
    getSnapshot: () => ({ status, errorCode }),
  };
}
