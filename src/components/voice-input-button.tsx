"use client";

import { useEffect, useRef } from "react";
import { Loader2, Mic, Square, X } from "lucide-react";
import { useVoiceInput } from "@/lib/speech/use-voice-input";
import { cx } from "./ui";

export interface VoiceUiState {
  /** Webbläsaren stödjer röstinmatning – fältet kan reservera plats för mikrofonen. */
  available: boolean;
  /** Pågående session (väntar/lyssnar/transkriberar) – fältet breddar högermarginalen. */
  active: boolean;
}

/**
 * Mikrofonknappen i kommandofältet – kort röstkommando, inte inspelning.
 *
 * Tryck → prata → tystnad auto-stoppar → slutligt transkript skickas till
 * samma parse-väg som Enter. Interim visas live. Avbryt (Esc/kryss) slänger
 * utan att köra något. Ingen egen röstguide, ingen ljudlagring. Döljs när
 * webbläsaren saknar taligenkänning.
 */
export function VoiceInputButton({
  value,
  onValueChange,
  onCommit,
  onActive,
  onUiState,
  onHint,
  forSheet,
}: {
  value: string;
  onValueChange(next: string): void;
  /** Slutligt transkript efter stopp – samma pipeline som Enter. */
  onCommit?(text: string): void;
  /** Användaren tryckte på mikrofonen – fältet kan öppna panelen. */
  onActive?(): void;
  /** Kapabilitet + aktiv inspelning, för fältets padding och ⌘K-märket. */
  onUiState?(state: VoiceUiState): void;
  /** Vänligt felmeddelande till fältets hintyta (null rensar). */
  onHint?(hint: string | null): void;
  forSheet: boolean;
}) {
  const voice = useVoiceInput({ value, onValueChange, onCommit });

  // Rapportera UI-läge/fel uppåt bara när något faktiskt ändrats – annars
  // riskerar inline-callbacks från föräldern att skapa render-loopar.
  const lastUi = useRef<VoiceUiState | null>(null);
  const lastHint = useRef<string | null>(null);
  const onUiStateRef = useRef(onUiState);
  const onHintRef = useRef(onHint);
  useEffect(() => {
    onUiStateRef.current = onUiState;
    onHintRef.current = onHint;
    const next: VoiceUiState = { available: voice.supported, active: voice.active };
    if (lastUi.current?.available !== next.available || lastUi.current?.active !== next.active) {
      lastUi.current = next;
      onUiState?.(next);
    }
    const hint = voice.status === "error" ? voice.errorMessage : null;
    if (lastHint.current !== hint) {
      lastHint.current = hint;
      onHint?.(hint);
    }
  });

  // Vid unmount (t.ex. mobilarket stängs): nollställ det vi rapporterat.
  // Ändringsvakterna nollas också – annars rapporterar remounten (bl.a.
  // React StrictMode i dev) aldrig om kapabiliteten.
  useEffect(
    () => () => {
      lastUi.current = null;
      lastHint.current = null;
      onUiStateRef.current?.({ available: false, active: false });
      onHintRef.current?.(null);
    },
    []
  );

  // Kapabilitetsregeln: ingen död knapp – finns inget stöd renderas inget.
  if (!voice.supported) return null;

  const requesting = voice.status === "requesting";
  const listening = voice.status === "listening";
  const transcribing = voice.status === "transcribing";
  const error = voice.status === "error";

  const mainLabel = listening
    ? "Stoppa inspelning"
    : requesting
      ? "Avbryt röstinmatning"
      : "Använd röst";

  return (
    <div
      className={cx(
        // bg-card täcker fältets text rent om statusklustret tillfälligt är
        // bredare än reserverad padding (t.ex. "Tolkar…" på mobil).
        "absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center rounded-xl bg-card",
        forSheet ? "gap-1" : "gap-0.5"
      )}
    >
      {/* Statustext – inte bara färg: text + ikonbyte + puls signalerar läget. */}
      {listening ? (
        <span
          role="status"
          className="flex shrink-0 items-center gap-1.5 pl-1 pr-1 text-[12.5px] font-medium text-danger"
        >
          <span aria-hidden className="size-2 animate-pulse rounded-full bg-danger" />
          Lyssnar…
        </span>
      ) : null}
      {transcribing ? (
        <span
          role="status"
          className="flex shrink-0 items-center gap-1.5 pl-1 pr-1 text-[12.5px] font-medium text-soft"
        >
          <Loader2 aria-hidden className="size-3.5 animate-spin" />
          Tolkar…
        </span>
      ) : null}

      {/* Avbryt: släng sessionen och återställ fältet exakt (även Esc). */}
      {listening || transcribing ? (
        <button
          type="button"
          onClick={voice.cancel}
          onMouseDown={(e) => e.preventDefault() /* behåll fokus i sökfältet */}
          aria-label="Avbryt röstinmatning"
          title="Avbryt (Esc)"
          className={cx(
            "flex shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-ink/5 hover:text-ink",
            forSheet ? "size-11" : "size-8"
          )}
        >
          <X className={forSheet ? "size-5" : "size-4"} />
        </button>
      ) : null}

      {/* Huvudknappen: mikrofon → stopp. ≥44×44px på touch (size-11). */}
      <button
        type="button"
        onClick={() => {
          onActive?.();
          voice.toggle();
        }}
        onMouseDown={(e) => e.preventDefault() /* behåll fokus i sökfältet */}
        disabled={transcribing}
        aria-label={mainLabel}
        aria-pressed={listening}
        title={mainLabel}
        className={cx(
          "flex shrink-0 items-center justify-center rounded-xl transition-colors disabled:opacity-50",
          forSheet ? "size-11" : "size-9",
          listening
            ? "bg-danger text-white hover:bg-danger/90"
            : error
              ? "text-danger hover:bg-danger-soft"
              : "text-muted hover:bg-ink/5 hover:text-ink"
        )}
      >
        {requesting || transcribing ? (
          <Loader2 className={cx("animate-spin", forSheet ? "size-5" : "size-4")} />
        ) : listening ? (
          <Square fill="currentColor" className={forSheet ? "size-4" : "size-3.5"} />
        ) : (
          <Mic className={forSheet ? "size-5" : "size-4"} />
        )}
      </button>
    </div>
  );
}
