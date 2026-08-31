"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { MapPin } from "lucide-react";
import { cx } from "./ui";
import { useAddressAutocomplete } from "./use-address-autocomplete";
import { trackAddressEvent, type AddressParts } from "@/lib/address-autocomplete";

/**
 * Gatuadressfältet med Google Places-förslag.
 *
 * Google är en genväg, aldrig ett krav: användaren kan alltid skriva klart
 * själv, och om förslagen inte kan laddas blir fältet ett vanligt textfält
 * med en kort förklaring i stället för ett rått Google-fel.
 *
 * All kostnadskontroll ligger i useAddressAutocomplete.
 */

const UNAVAILABLE_TEXT = "Adressförslag kunde inte laddas. Du kan skriva adressen manuellt.";

export function AddressAutocompleteInput({
  value,
  onValueChange,
  onAddressSelected,
  onBlur,
  id,
  name = "address",
  label,
  placeholder = "Börja skriv gatuadressen …",
  className,
  inputClassName,
  labelClassName,
  invalid,
  autoFocus,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  "aria-label": ariaLabel,
}: {
  value: string;
  /** Användaren skriver själv – strukturerade fält rörs inte. */
  onValueChange: (value: string) => void;
  /** Användaren valde ett förslag – här kommer hela den strukturerade adressen. */
  onAddressSelected: (parts: AddressParts) => void;
  onBlur?: () => void;
  id?: string;
  name?: string;
  /** Utelämnas när fältet redan har en etikett från omgivande layout. */
  label?: string;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  labelClassName?: string;
  invalid?: boolean;
  autoFocus?: boolean;
  /** Sätts av FormField vid kloning – forwardas till inputen. */
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  /** För kompakta fält utan synlig etikett. */
  "aria-label"?: string;
}) {
  const autoId = useId();
  const inputId = id ?? `adress-${autoId}`;
  const listboxId = `${inputId}-forslag`;
  const hintId = `${inputId}-hint`;

  const containerRef = useRef<HTMLDivElement>(null);
  /** Texten som senast gav strukturerad adress – oförändrad text = inget nytt anrop. */
  const resolvedTextRef = useRef(value);
  const typedSinceSelectRef = useRef(false);

  const {
    suggestions,
    open,
    highlight,
    status,
    onQueryChange,
    reopen,
    close,
    cancelPending,
    endInteraction,
    setHighlight,
    selectSuggestion,
  } = useAddressAutocomplete();

  const [pickPending, setPickPending] = useState(false);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [close]);

  function handleChange(next: string) {
    onValueChange(next);
    typedSinceSelectRef.current = true;
    if (next === resolvedTextRef.current) {
      // Tillbaka till senast valda adressen: vi har redan strukturerade fält
      // i formuläret – avbryt ev. schemalagd sökning i stället för att fråga om.
      cancelPending();
      return;
    }
    onQueryChange(next);
  }

  async function pick(id: string) {
    setPickPending(true);
    const parts = await selectSuggestion(id);
    setPickPending(false);
    if (!parts) return;
    resolvedTextRef.current = parts.address;
    typedSinceSelectRef.current = false;
    onAddressSelected(parts);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const lastIndex = suggestions.length - 1;
    if (e.key === "ArrowDown") {
      if (suggestions.length === 0) return;
      e.preventDefault();
      if (!open) {
        reopen();
        setHighlight(0);
        return;
      }
      setHighlight((prev) => (prev >= lastIndex ? 0 : prev + 1));
      return;
    }
    if (!open) return;
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((prev) => (prev <= 0 ? lastIndex : prev - 1));
      return;
    }
    if (e.key === "Enter") {
      const picked = suggestions[highlight];
      if (picked) {
        // Enter på ett markerat förslag får inte skicka formuläret.
        e.preventDefault();
        e.stopPropagation();
        void pick(picked.id);
      }
      return;
    }
    if (e.key === "Escape") {
      // Stäng listan utan att stänga en eventuell modal ovanför.
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === "Tab") {
      close();
    }
  }

  const activeId = open && highlight >= 0 && suggestions[highlight] ? `${listboxId}-${highlight}` : undefined;
  const unavailable = status === "unavailable" && Boolean(value.trim());

  return (
    <div className={className}>
      <div ref={containerRef} className="relative">
        {label ? (
          <label
            className={labelClassName ?? "mb-1 block text-[13px] font-medium text-soft"}
            htmlFor={inputId}
          >
            {label}
          </label>
        ) : null}
        <div className="relative">
          <input
            id={inputId}
            name={name}
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={reopen}
            onBlur={() => {
              if (typedSinceSelectRef.current && value.trim()) trackAddressEvent("address_manual_used");
              // Fokus lämnar fältet ⇒ nästa inmatning är en ny Places-session.
              endInteraction();
              onBlur?.();
            }}
            onKeyDown={handleKeyDown}
            className={cx(
              inputClassName ??
                "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted focus:border-accent",
              invalid && "border-danger",
            )}
            placeholder={placeholder}
            autoComplete="off"
            autoFocus={autoFocus}
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            aria-invalid={ariaInvalid || invalid || undefined}
            aria-describedby={
              [ariaDescribedBy, unavailable ? hintId : null].filter(Boolean).join(" ") || undefined
            }
          />
          {status === "searching" || pickPending ? (
            <span
              aria-hidden
              className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin rounded-full border-2 border-line-strong border-t-accent"
            />
          ) : null}
        </div>

        {open && suggestions.length > 0 ? (
          <div
            className={cx(
              "absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-line bg-card shadow-pop animate-fade-in",
              // Mobil: håll listan inom viewporten utan nästlade scrollytor.
              "max-h-[min(18rem,45dvh)] overflow-y-auto overscroll-contain",
            )}
          >
            <ul role="listbox" id={listboxId} aria-label="Adressförslag">
              {suggestions.map((s, i) => (
                <li key={s.id} id={`${listboxId}-${i}`} role="option" aria-selected={i === highlight}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void pick(s.id)}
                    onMouseEnter={() => setHighlight(i)}
                    className={cx(
                      "flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors min-h-11",
                      i === highlight ? "bg-canvas" : "bg-card",
                    )}
                  >
                    <MapPin className="size-4 shrink-0 text-muted" />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-medium text-ink">{s.main}</span>
                      {s.secondary ? (
                        <span className="block truncate text-[12px] text-muted">{s.secondary}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {/* Google kräver attribution när Places-data visas utan karta. */}
            <div className="sticky bottom-0 border-t border-line/70 bg-canvas/80 px-3.5 py-1.5 backdrop-blur-sm">
              <span className="text-[11px] text-muted">Powered by Google</span>
            </div>
          </div>
        ) : null}

      </div>

      {unavailable ? (
        <p id={hintId} className="mt-1.5 text-[12px] leading-relaxed text-muted">
          {UNAVAILABLE_TEXT}
        </p>
      ) : null}
    </div>
  );
}
