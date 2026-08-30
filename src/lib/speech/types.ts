/**
 * Röstinmatning (tal-till-text) för kommandofältet.
 *
 * Rösten är ett kort kommando: tryck → prata → tystnad → slutligt transkript
 * skickas till samma parse/submit-väg som Enter på skriven text. Ingen egen
 * röstguide, ingen affärslogik här. Interim visas live men kör aldrig en åtgärd.
 *
 * Integritet: leverantören lämnar bara ifrån sig text. Ingen ljuddata lagras,
 * laddas upp eller loggas – med Web Speech API rör vi aldrig råa ljudbuffertar.
 */

/** Fel som en leverantör kan rapportera, normaliserade över webbläsare. */
export type SpeechErrorCode =
  | "permission-denied"
  | "no-speech"
  | "audio-capture"
  | "network"
  | "transcription-failed"
  | "unknown";

export interface SpeechError {
  code: SpeechErrorCode;
}

/** En uppdatering under pågående session – alltid HELA transkriptet hittills. */
export interface SpeechUpdate {
  text: string;
  /** Sant när texten enbart består av slutgiltiga resultat (inga interim). */
  isFinal: boolean;
}

export interface SpeechSessionHandlers {
  /** Ljudupptagningen har faktiskt startat (behörighet beviljad). */
  onStart(): void;
  /**
   * Motorns VAD hörde tal (Web Speech `speechstart`). Används för att skilja
   * inledande tystnad från tystnad efter att användaren faktiskt pratat.
   */
  onSpeechStart?(): void;
  /**
   * Motorns VAD anser att yttrandet tog slut (Web Speech `speechend`).
   * Kontrollern väntar därefter en kort end-silence innan auto-stopp.
   */
  onSpeechEnd?(): void;
  onUpdate(update: SpeechUpdate): void;
  /** Sessionen är klar (manuellt stopp, auto-stopp eller motorns slut). Inget anropas efter. */
  onEnd(): void;
  /** Sessionen dog i ett fel. Varken onEnd eller fler onUpdate anropas efter. */
  onError(error: SpeechError): void;
}

export interface SpeechSession {
  /** Sluta lyssna men låt påbörjade resultat slutföras (→ onEnd). */
  stop(): void;
  /** Avbryt omedelbart och tyst: inga fler callbacks alls. */
  abort(): void;
}

export interface SpeechStartOptions {
  /** BCP-47-språkkod, t.ex. "sv-SE". */
  lang: string;
}

/**
 * Leverantörsgränssnitt för tal-till-text. V1 är webbläsarens inbyggda
 * Web Speech API; en framtida serverleverantör (t.ex. Whisper bakom ett
 * endpoint) implementerar samma kontrakt utan att kommandofältet ändras.
 */
export interface SpeechToTextProvider {
  start(options: SpeechStartOptions, handlers: SpeechSessionHandlers): SpeechSession;
}
