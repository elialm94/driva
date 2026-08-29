import type { SpeechErrorCode, SpeechSession, SpeechToTextProvider } from "./types";

/**
 * Tillståndsmaskin för röstinmatning – ren modul utan React/DOM så att den
 * kan enhetstestas med en mockad leverantör.
 *
 *   idle → requesting → listening → transcribing → idle (text i fältet)
 *                     ↘ error (vänligt meddelande + nytt försök)
 *
 * Reglerna, i klartext:
 *  - Transkriptet LÄGGS TILL efter befintlig text med ett mellanslag – aldrig
 *    destruktiv överskrivning, aldrig autosänd.
 *  - Avbryt återställer fältet till exakt innehållet före inspelningen.
 *  - Tryck under pågående övergång ignoreras – ingen dubbelinspelning.
 */

export type VoiceStatus = "idle" | "requesting" | "listening" | "transcribing" | "error";

export interface VoiceSnapshot {
  status: VoiceStatus;
  errorCode: SpeechErrorCode | null;
}

export const VOICE_LANG_DEFAULT = "sv-SE";

/** Vänliga svenska felmeddelanden – aldrig tekniska koder i UI:t. */
export function speechErrorMessage(code: SpeechErrorCode): string {
  switch (code) {
    case "permission-denied":
      return "Mikrofonåtkomst är avstängd. Tillåt mikrofonen i webbläsaren för att använda röst.";
    case "no-speech":
      return "Jag kunde inte höra det tydligt. Försök igen.";
    case "audio-capture":
      return "Ingen mikrofon hittades. Kontrollera att en mikrofon är ansluten och försök igen.";
    case "network":
      return "Taligenkänningen kunde inte nås just nu. Kontrollera uppkopplingen och försök igen.";
    case "unknown":
      return "Röstinmatningen misslyckades. Försök igen.";
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
  let status: VoiceStatus = "idle";
  let errorCode: SpeechErrorCode | null = null;
  let session: SpeechSession | null = null;
  /** Fältets exakta innehåll när inspelningen startade (för append + återställning). */
  let base = "";
  /** Senaste transkript-texten från sessionen (interim eller final). */
  let lastText = "";
  /** Löpnummer för aktiv session – sena callbacks från gamla sessioner ignoreras. */
  let token = 0;

  function setStatus(next: VoiceStatus, code: SpeechErrorCode | null = null) {
    status = next;
    errorCode = code;
    options.onSnapshot({ status, errorCode });
  }

  function isBusy(): boolean {
    return status === "requesting" || status === "listening" || status === "transcribing";
  }

  /** Sessionsslut: committa transkriptet, eller vänligt fel om inget hördes. */
  function finish(text: string) {
    session = null;
    const committed = text.trim();
    if (committed) {
      // Slutlig text in i fältet – ALDRIG autosänd; användaren granskar och
      // skickar själv (Enter/samma flöden som skriven text).
      options.setText(joinTranscript(base, committed));
      setStatus("idle");
    } else {
      options.setText(base);
      setStatus("error", "no-speech");
    }
  }

  function start() {
    if (isBusy()) return; // ingen dubbelstart under övergångar
    token += 1;
    const active = token;
    base = options.getText();
    lastText = "";
    setStatus("requesting");
    const started = options.provider.start(
      { lang: options.lang ?? VOICE_LANG_DEFAULT },
      {
        onStart() {
          if (token !== active || status !== "requesting") return;
          setStatus("listening");
        },
        onUpdate(update) {
          if (token !== active) return;
          lastText = update.text;
          // Live-förhandsvisning i fältet; basen skrivs aldrig över.
          options.setText(joinTranscript(base, update.text));
        },
        onEnd() {
          if (token !== active) return;
          // Manuellt stopp eller motorns egen tystnadsgräns – samma väg.
          // Finns ingen slutlig text används senaste interim (användbar
          // delvis text i stället för att slänga det användaren sa).
          finish(lastText);
        },
        onError(error) {
          if (token !== active) return;
          session = null;
          options.setText(base);
          setStatus("error", error.code);
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
    const s = session;
    session = null;
    s?.abort();
  }

  function stop() {
    if (status === "listening") {
      setStatus("transcribing");
      session?.stop();
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
