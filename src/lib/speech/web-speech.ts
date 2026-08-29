import type {
  SpeechErrorCode,
  SpeechSession,
  SpeechSessionHandlers,
  SpeechStartOptions,
  SpeechToTextProvider,
} from "./types";

/*
 * Web Speech API saknas i TypeScripts DOM-typer, så vi deklarerar minimala
 * lokala typer för exakt det vi använder. Safari exponerar API:t med
 * webkit-prefix; Firefox saknar det helt (→ null, mikrofonen döljs).
 */
interface RecognitionAlternativeLike {
  transcript: string;
}
interface RecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: RecognitionAlternativeLike | undefined;
}
interface RecognitionResultListLike {
  length: number;
  [index: number]: RecognitionResultLike;
}
interface RecognitionEventLike {
  results: RecognitionResultListLike;
}
interface RecognitionErrorEventLike {
  error?: string;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: RecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => SpeechRecognitionLike;

/** Plockar ut konstruktorn ur ett fönsterliknande objekt (testbart utan DOM). */
export function getSpeechRecognitionCtor(host: unknown): RecognitionCtor | null {
  if (typeof host !== "object" || host === null) return null;
  const w = host as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  const ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return typeof ctor === "function" ? (ctor as RecognitionCtor) : null;
}

/** Normaliserar webbläsarnas felkoder till våra leverantörsoberoende koder. */
export function mapRecognitionError(raw: string | undefined): SpeechErrorCode {
  switch (raw) {
    case "not-allowed":
    case "service-not-allowed":
      return "permission-denied";
    case "no-speech":
      return "no-speech";
    case "audio-capture":
      return "audio-capture";
    case "network":
      return "network";
    default:
      return "unknown";
  }
}

/** Slår ihop resultatdelar utan att ändra orden – bara blanksteg städas. */
function joinParts(parts: string[]): string {
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Web Speech API bakom det leverantörsoberoende gränssnittet.
 *
 * Returnerar null när webbläsaren saknar taligenkänning (kapabilitetskoll).
 * Själva igenkänningsobjektet skapas först vid start() – ingen init, inga
 * behörighetsfrågor och ingen nätverkskontakt före första trycket.
 */
export function createWebSpeechProvider(host: unknown): SpeechToTextProvider | null {
  const Recognition = getSpeechRecognitionCtor(host);
  if (!Recognition) return null;

  return {
    start(options: SpeechStartOptions, handlers: SpeechSessionHandlers): SpeechSession {
      const recognition = new Recognition();
      recognition.lang = options.lang;
      recognition.interimResults = true;
      // Kontinuerligt läge: inga aggressiva klipp vid korta tankepauser.
      // Manuellt stopp är primärflödet; avslutar motorn själv vid tystnad
      // (t.ex. Safari) hanteras det som ett vanligt sessionsslut via onend.
      recognition.continuous = true;
      recognition.maxAlternatives = 1;

      // Efter abort/fel får inga fler callbacks nå anroparen.
      let silenced = false;

      recognition.onstart = () => {
        if (!silenced) handlers.onStart();
      };
      recognition.onresult = (event) => {
        if (silenced) return;
        // Bygg om hela transkriptet vid varje händelse – idempotent och
        // robust oavsett hur motorn väljer att uppdatera resultatlistan.
        const finals: string[] = [];
        const interims: string[] = [];
        for (let i = 0; i < event.results.length; i += 1) {
          const result = event.results[i];
          const text = result?.[0]?.transcript ?? "";
          if (!text) continue;
          (result.isFinal ? finals : interims).push(text);
        }
        const full = joinParts([...finals, ...interims]);
        handlers.onUpdate({ text: full, isFinal: interims.length === 0 && full.length > 0 });
      };
      recognition.onerror = (event) => {
        if (silenced) return;
        silenced = true;
        // "aborted" är följden av vårt eget abort() – aldrig ett användarfel.
        if (event?.error === "aborted") return;
        handlers.onError({ code: mapRecognitionError(event?.error) });
      };
      recognition.onend = () => {
        if (silenced) return;
        silenced = true;
        handlers.onEnd();
      };

      try {
        recognition.start();
      } catch {
        // T.ex. motor i otillåtet läge – rapportera vänligt i stället för krasch.
        silenced = true;
        handlers.onError({ code: "unknown" });
      }

      return {
        stop() {
          try {
            recognition.stop();
          } catch {
            /* redan stoppad */
          }
        },
        abort() {
          silenced = true;
          try {
            recognition.abort();
          } catch {
            /* redan avslutad */
          }
        },
      };
    },
  };
}
