"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import {
  forgetLineDescriptionSuggestionAction,
  getLineDescriptionVocabularyAction,
} from "@/app/actions";
import {
  LINE_DESCRIPTION_MIN_QUERY,
  normalizeLineDescriptionKey,
  rankLineDescriptionSuggestions,
  type LineDescriptionVocabEntry,
} from "@/lib/line-description-suggestions";
import type { LineKind } from "@/lib/types";
import { cx } from "./ui";

type VocabContextValue = {
  vocab: LineDescriptionVocabEntry[];
  forgetSuggestion: (text: string) => void;
};

const VocabContext = createContext<VocabContextValue | null>(null);

export function LineDescriptionVocabProvider({ children }: { children: ReactNode }) {
  const state = useFetchedLineDescriptionVocabulary();
  return (
    <VocabContext.Provider value={state}>
      <div data-line-vocab={state.ready ? String(state.vocab.length) : "pending"} className="contents">
        {children}
      </div>
    </VocabContext.Provider>
  );
}

function useFetchedLineDescriptionVocabulary(): VocabContextValue & { ready: boolean } {
  const [vocab, setVocab] = useState<LineDescriptionVocabEntry[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getLineDescriptionVocabularyAction()
      .then((next) => {
        if (!cancelled) {
          setVocab(next);
          setReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function forgetSuggestion(text: string) {
    const key = normalizeLineDescriptionKey(text);
    setVocab((prev) => prev.filter((entry) => normalizeLineDescriptionKey(entry.text) !== key));
    void forgetLineDescriptionSuggestionAction(text)
      .then((next) => {
        setVocab(next);
      })
      .catch(() => {
        /* Optimistic removal already applied. */
      });
  }

  return { vocab, ready, forgetSuggestion };
}

function useLineDescriptionVocabulary(): VocabContextValue {
  const ctx = useContext(VocabContext);
  const [local, setLocal] = useState<LineDescriptionVocabEntry[]>([]);
  useEffect(() => {
    if (ctx) return;
    let cancelled = false;
    getLineDescriptionVocabularyAction().then((next) => {
      if (!cancelled) setLocal(next);
    });
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  function forgetSuggestion(text: string) {
    const key = normalizeLineDescriptionKey(text);
    setLocal((prev) => prev.filter((entry) => normalizeLineDescriptionKey(entry.text) !== key));
    void forgetLineDescriptionSuggestionAction(text)
      .then((next) => setLocal(next))
      .catch(() => {
        /* Optimistic removal already applied. */
      });
  }

  return ctx ?? { vocab: local, forgetSuggestion };
}

export function LineDescriptionInput({
  id,
  value,
  onChange,
  placeholder,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  className,
  kind,
  autoFocus,
  onEnterNavigate,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  className?: string;
  kind?: LineKind;
  autoFocus?: boolean;
  /** Enter när autocomplete inte är öppen – flytta till nästa fält. */
  onEnterNavigate?: () => void;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const { vocab, forgetSuggestion } = useLineDescriptionVocabulary();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const suggestions = useMemo(
    () => rankLineDescriptionSuggestions(vocab, value, { kind }),
    [vocab, value, kind]
  );
  const canOpen = open && value.trim().length >= LINE_DESCRIPTION_MIN_QUERY && suggestions.length > 0;

  useEffect(() => {
    setHighlight(0);
  }, [value, kind]);

  useEffect(() => {
    setHighlight((i) => (suggestions.length === 0 ? 0 : Math.min(i, suggestions.length - 1)));
  }, [suggestions.length]);

  useEffect(() => {
    if (!canOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [canOpen]);

  function apply(text: string) {
    onChange(text);
    setOpen(false);
  }

  function forget(text: string) {
    forgetSuggestion(text);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      if (canOpen) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
      return;
    }
    if (e.key === "Enter") {
      if (e.nativeEvent.isComposing) return;
      if (canOpen) {
        const pick = suggestions[highlight] ?? suggestions[0];
        if (pick) {
          e.preventDefault();
          e.stopPropagation();
          apply(pick.text);
          return;
        }
      }
      e.preventDefault();
      onEnterNavigate?.();
      return;
    }
    if (!suggestions.length || value.trim().length < LINE_DESCRIPTION_MIN_QUERY) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((i) => (canOpen ? (i + 1) % suggestions.length : 0));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setHighlight((i) => (canOpen ? (i - 1 + suggestions.length) % suggestions.length : suggestions.length - 1));
      return;
    }
    if (e.key === "Tab" && canOpen) {
      const pick = suggestions[highlight] ?? suggestions[0];
      if (pick) apply(pick.text);
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <input
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid || undefined}
        aria-autocomplete="list"
        aria-expanded={canOpen}
        aria-controls={canOpen ? listId : undefined}
        aria-activedescendant={canOpen ? `${listId}-${highlight}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        role="combobox"
        className={className}
      />
      {canOpen ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-auto rounded-xl border border-line-strong bg-card py-1 shadow-pop"
        >
          {suggestions.map((item, index) => (
            <li
              key={item.text}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === highlight}
              className={cx(
                "flex cursor-pointer items-center gap-1 text-[14px] text-ink",
                index === highlight ? "bg-accent-soft" : "hover:bg-canvas"
              )}
              onMouseEnter={() => setHighlight(index)}
              onMouseDown={(e) => {
                e.preventDefault();
                apply(item.text);
              }}
            >
              <span className="min-w-0 flex-1 truncate px-3 py-1.5">{item.text}</span>
              <button
                type="button"
                aria-label="Glöm förslag"
                title="Glöm förslag"
                className="mr-1 shrink-0 rounded-md p-1 text-muted hover:bg-card hover:text-ink"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  forget(item.text);
                }}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
