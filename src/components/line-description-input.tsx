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
import { getLineDescriptionVocabularyAction } from "@/app/actions";
import {
  LINE_DESCRIPTION_MIN_QUERY,
  rankLineDescriptionSuggestions,
  type LineDescriptionVocabEntry,
} from "@/lib/line-description-suggestions";
import type { LineKind } from "@/lib/types";
import { cx } from "./ui";

const VocabContext = createContext<LineDescriptionVocabEntry[] | null>(null);

export function LineDescriptionVocabProvider({ children }: { children: ReactNode }) {
  const { vocab, ready } = useFetchedLineDescriptionVocabulary();
  return (
    <VocabContext.Provider value={vocab}>
      <div data-line-vocab={ready ? String(vocab.length) : "pending"} className="contents">
        {children}
      </div>
    </VocabContext.Provider>
  );
}

function useFetchedLineDescriptionVocabulary(): { vocab: LineDescriptionVocabEntry[]; ready: boolean } {
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
  return { vocab, ready };
}

function useLineDescriptionVocabulary(): LineDescriptionVocabEntry[] {
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
  return ctx ?? local;
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
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const vocab = useLineDescriptionVocabulary();
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

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      if (canOpen) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
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
    if ((e.key === "Enter" || e.key === "Tab") && canOpen) {
      const pick = suggestions[highlight] ?? suggestions[0];
      if (!pick) return;
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
      }
      apply(pick.text);
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
                "cursor-pointer px-3 py-1.5 text-[14px] text-ink",
                index === highlight ? "bg-accent-soft" : "hover:bg-canvas"
              )}
              onMouseEnter={() => setHighlight(index)}
              onMouseDown={(e) => {
                e.preventDefault();
                apply(item.text);
              }}
            >
              {item.text}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
