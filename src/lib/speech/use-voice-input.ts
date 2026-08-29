"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createVoiceController,
  speechErrorMessage,
  type VoiceController,
  type VoiceSnapshot,
  type VoiceStatus,
} from "./controller";
import { resolveSpeechProvider } from "./provider";
import type { SpeechToTextProvider } from "./types";

export interface UseVoiceInputOptions {
  /** Fältets nuvarande värde. */
  value: string;
  /** Skriver nytt värde till fältet (interim-förhandsvisning + slutligt transkript). */
  onValueChange(next: string): void;
}

export interface VoiceInputHandle {
  /** Falskt ⇒ rendera ingen mikrofon alls (t.ex. Firefox). */
  supported: boolean;
  status: VoiceStatus;
  /** Vänligt svenskt felmeddelande när status är "error", annars null. */
  errorMessage: string | null;
  /** Sant under requesting/listening/transcribing. */
  active: boolean;
  /** Knapptryck: starta / avbryt behörighetsväntan / stoppa. */
  toggle(): void;
  /** Avbryt och återställ fältet exakt (Escape/kryss). */
  cancel(): void;
}

/**
 * Tunt React-skal runt den rena tillståndsmaskinen i ./controller.
 * Leverantören väljs vid montering (kapabilitetskoll); kontrollern och
 * själva igenkänningsobjektet skapas först vid första trycket.
 */
export function useVoiceInput(options: UseVoiceInputOptions): VoiceInputHandle {
  const [provider] = useState<SpeechToTextProvider | null>(() => resolveSpeechProvider());
  const [snapshot, setSnapshot] = useState<VoiceSnapshot>({ status: "idle", errorCode: null });

  // Senaste värde/callback via refs (uppdateras efter varje render) så
  // kontrollern kan skapas en gång och läsa färskt vid händelsetidpunkten.
  const valueRef = useRef(options.value);
  const changeRef = useRef(options.onValueChange);
  useEffect(() => {
    valueRef.current = options.value;
    changeRef.current = options.onValueChange;
  });

  const controllerRef = useRef<VoiceController | null>(null);
  const getController = useCallback((): VoiceController | null => {
    if (!provider) return null;
    if (!controllerRef.current) {
      controllerRef.current = createVoiceController({
        provider,
        getText: () => valueRef.current,
        setText: (text) => changeRef.current(text),
        onSnapshot: setSnapshot,
      });
    }
    return controllerRef.current;
  }, [provider]);

  // Unmount: avbryt tyst (ljudet släpps, fälttexten lämnas ifred).
  useEffect(() => () => controllerRef.current?.dispose(), []);

  const active =
    snapshot.status === "requesting" ||
    snapshot.status === "listening" ||
    snapshot.status === "transcribing";

  // Escape avbryter pågående inspelning – fångas i capture-fasen så
  // kommandofältets egen Escape-hantering (rensa/stäng) inte triggas.
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      controllerRef.current?.cancel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active]);

  // I felläge: om användaren ändrar fälttexten själv (skriver/rensar) är
  // felet inte längre relevant – avfärda det så hinten försvinner.
  const errorValueRef = useRef<string | null>(null);
  useEffect(() => {
    if (snapshot.status !== "error") {
      errorValueRef.current = null;
      return;
    }
    if (errorValueRef.current === null) {
      errorValueRef.current = options.value;
      return;
    }
    if (options.value !== errorValueRef.current) {
      errorValueRef.current = null;
      controllerRef.current?.cancel();
    }
  }, [snapshot.status, options.value]);

  return {
    supported: provider !== null,
    status: snapshot.status,
    errorMessage: snapshot.errorCode ? speechErrorMessage(snapshot.errorCode) : null,
    active,
    toggle: () => getController()?.toggle(),
    cancel: () => getController()?.cancel(),
  };
}
