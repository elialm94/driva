/**
 * Röstinmatning (tal-till-text) för kommandofältet.
 *
 * Rösten är ENBART en alternativ inmatningsmetod: transkriptet landar i det
 * befintliga textfältet, användaren läser/rättar, och texten följer sedan
 * exakt samma väg som skriven text (deterministisk tolk → kommandoflöden,
 * annars LLM-slingan). Ingen röstlogik i affärslagret, ingen autosänd.
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
  onUpdate(update: SpeechUpdate): void;
  /** Sessionen är klar (manuellt stopp eller rimlig tystnad). Inget anropas efter. */
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
