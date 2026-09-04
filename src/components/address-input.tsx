"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { MapPin } from "lucide-react";
import { cx, DemoTag } from "./ui";
import { FieldError, invalidFieldCls } from "./form-validation";
import { formatSwedishPostalCode, isSwedishPostalCode } from "@/lib/validation";
import {
  ADDRESS_LANGUAGE,
  ADDRESS_MENU_Z_INDEX,
  ADDRESS_PLACE_FIELDS,
  ADDRESS_PLACES_LOAD_TIMEOUT_MS,
  ADDRESS_PRIMARY_TYPES,
  ADDRESS_REGION_CODES,
  ADDRESS_SEARCH_DEBOUNCE_MS,
  applyPickedAddress,
  demoAddressSuggestions,
  formatAddressLine,
  googleMapsApiKey,
  partsFromPlaceComponents,
  shouldSearchAddress,
  type AddressParts,
} from "@/lib/address-autocomplete";

export type { AddressParts };

/**
 * Delad AddressAutocomplete – enda stället Driva hämtar adressförslag.
 * Ny kund, redigera kund, ROT-bostad, onboarding, inställningar och
 * uppdrag använder den här filen. Forka inte en andra Places-integration.
 *
 * Med `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` används Google Places API (New).
 * Demo / saknad nyckel / Google-fel → manuella fält + ev. exempeladresser.
 */

const defaultInputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted focus:border-accent";
const defaultLabelCls = "mb-1 block text-[13px] font-medium text-soft";

interface Suggestion {
  id: string;
  main: string;
  secondary: string;
  /** Hämtar kompletta adressdelar – anropas bara när användaren väljer. */
  resolve: () => Promise<AddressParts>;
}

/* ------------------------------ Google-laddare ------------------------------ */

interface PlaceComponents {
  fetchFields(opts: { fields: string[] }): Promise<unknown>;
  addressComponents?: { longText: string | null; types: string[] }[] | null;
}

interface PlacePrediction {
  placeId: string;
  text: { text: string };
  mainText: { text: string } | null;
  secondaryText: { text: string } | null;
  toPlace(): PlaceComponents;
}

interface PlacesLib {
  AutocompleteSessionToken: new () => object;
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions(
      req: Record<string, unknown>
    ): Promise<{ suggestions: { placePrediction: PlacePrediction | null }[] }>;
  };
}

declare global {
  interface Window {
    google?: { maps?: { importLibrary?: (name: string) => Promise<unknown> } };
    __drivaMapsReady?: () => void;
  }
}

const MAPS_KEY = googleMapsApiKey();

/**
 * Demosessioner får exempeladresser även när nyckeln finns – anonyma
 * besökare ska inte generera Places-kostnad. App-skalet sätter attributet
 * på serversidan (isDemoSession), så gränsen kan inte stängas av från klienten.
 */
function isDemoSurface(): boolean {
  return typeof document !== "undefined" && document.querySelector("[data-driva-demo]") !== null;
}

const MAPS_CALLBACK = "__drivaMapsReady";

let placesLoader: Promise<PlacesLib | null> | null = null;

function loadPlaces(): Promise<PlacesLib | null> {
  if (!MAPS_KEY || isDemoSurface()) return Promise.resolve(null);
  if (placesLoader) return placesLoader;
  placesLoader = new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve(null);
      return;
    }
    let settled = false;
    const done = (lib: PlacesLib | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(lib);
    };
    const timeout = window.setTimeout(() => done(null), ADDRESS_PLACES_LOAD_TIMEOUT_MS);

    const boot = () => {
      const importLibrary = window.google?.maps?.importLibrary;
      if (!importLibrary) {
        done(null);
        return;
      }
      importLibrary("places")
        .then((lib) => done(lib as PlacesLib))
        .catch(() => done(null));
    };

    if (window.google?.maps?.importLibrary) {
      boot();
      return;
    }

    window.__drivaMapsReady = boot;
    const existing = document.getElementById(MAPS_CALLBACK);
    if (existing) return;

    const script = document.createElement("script");
    script.id = MAPS_CALLBACK;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      MAPS_KEY
    )}&v=weekly&loading=async&language=sv&region=SE&callback=${MAPS_CALLBACK}`;
    script.async = true;
    // Origin-only referer så en nyckel låst till https://app.example/* matchar
    // även med dokumentets strict-origin-when-cross-origin.
    script.referrerPolicy = "origin";
    script.onerror = () => done(null);
    document.head.appendChild(script);
  });
  return placesLoader;
}

function preferLocalExamples(): boolean {
  return !MAPS_KEY || isDemoSurface();
}

/* ------------------------------ Förslagslista ------------------------------ */

function SuggestionMenu({
  open,
  anchorRef,
  menuRef,
  children,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  menuRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const [box, setBox] = useState<CSSProperties | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setBox(null);
      return;
    }
    function place() {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const gap = 6;
      const below = window.innerHeight - rect.bottom - gap - 8;
      const above = rect.top - gap - 8;
      const preferBelow = below >= 168 || below >= above;
      const maxHeight = Math.min(280, Math.max(120, preferBelow ? below : above));
      setBox({
        position: "fixed",
        left: rect.left,
        width: Math.max(rect.width, 220),
        maxHeight,
        zIndex: ADDRESS_MENU_Z_INDEX,
        ...(preferBelow
          ? { top: rect.bottom + gap }
          : { bottom: window.innerHeight - rect.top + gap }),
      });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchorRef]);

  if (!open || !mounted || !box) return null;
  return createPortal(
    <div
      ref={menuRef}
      style={box}
      className="overflow-hidden rounded-xl border border-line bg-card shadow-pop animate-fade-in"
      data-address-suggestions=""
    >
      {children}
    </div>,
    document.body
  );
}

/* -------------------------------- Komponenten ------------------------------- */

export function AddressAutocomplete({
  value,
  defaultValue,
  onChange,
  onSelect,
  onBlur,
  name = "address",
  id,
  label = "Adress",
  hideLabel = false,
  placeholder = "Börja skriv gatuadressen …",
  inputClassName,
  labelClassName,
  disabled,
  composeSelected = "street",
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  "aria-label": ariaLabel,
}: {
  value?: string;
  defaultValue?: string;
  onChange?: (street: string) => void;
  onSelect?: (parts: AddressParts) => void;
  onBlur?: () => void;
  name?: string;
  id?: string;
  label?: string;
  hideLabel?: boolean;
  placeholder?: string;
  inputClassName?: string;
  labelClassName?: string;
  disabled?: boolean;
  /** street = gata; line = "gata, postnummer ort" för enfältiga formulär. */
  composeSelected?: "street" | "line";
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "aria-label"?: string;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? "");
  const street = value ?? uncontrolled;

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [searching, setSearching] = useState(false);
  const [liveMode, setLiveMode] = useState(false);

  const sessionRef = useRef<object | null>(null);
  const requestSeq = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function setStreet(next: string) {
    if (value === undefined) setUncontrolled(next);
    onChange?.(next);
  }

  const search = useCallback(async (query: string) => {
    const seq = ++requestSeq.current;
    if (!shouldSearchAddress(query)) {
      setSuggestions([]);
      setOpen(false);
      setSearching(false);
      return;
    }

    if (preferLocalExamples()) {
      const result = demoAddressSuggestions(query).map((a) => ({
        id: a.address,
        main: a.address,
        secondary: `${a.postalCode} ${a.city}`.trim(),
        resolve: async () => a,
      }));
      setLiveMode(false);
      setSuggestions(result);
      setOpen(result.length > 0);
      setHighlight(0);
      setSearching(false);
      return;
    }

    setSearching(true);
    const lib = await loadPlaces();
    if (seq !== requestSeq.current) return;
    if (!lib) {
      // Nyckel finns men Google vägrade / nätet dog – manuellt fält, ingen död lista.
      setLiveMode(false);
      setSuggestions([]);
      setOpen(false);
      setSearching(false);
      return;
    }

    sessionRef.current ??= new lib.AutocompleteSessionToken();

    try {
      const { suggestions: raw } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: query,
        sessionToken: sessionRef.current,
        includedPrimaryTypes: [...ADDRESS_PRIMARY_TYPES],
        includedRegionCodes: [...ADDRESS_REGION_CODES],
        language: ADDRESS_LANGUAGE,
        region: "se",
      });
      if (seq !== requestSeq.current) return;

      const mapped: Suggestion[] = raw
        .map((s) => s.placePrediction)
        .filter((p): p is PlacePrediction => !!p)
        .slice(0, 5)
        .map((p) => ({
          id: p.placeId,
          main: p.mainText?.text ?? p.text.text,
          secondary: p.secondaryText?.text ?? "",
          resolve: async () => {
            const place = p.toPlace();
            await place.fetchFields({ fields: [...ADDRESS_PLACE_FIELDS] });
            // Sessionen förbrukas när detaljer hämtas – börja om vid nästa sökning.
            sessionRef.current = null;
            const parts = partsFromPlaceComponents(place.addressComponents ?? []);
            return { ...parts, address: parts.address || (p.mainText?.text ?? p.text.text) };
          },
        }));
      setLiveMode(true);
      setSuggestions(mapped);
      setOpen(mapped.length > 0);
      setHighlight(0);
    } catch {
      setLiveMode(false);
      setSuggestions([]);
      setOpen(false);
    } finally {
      if (seq === requestSeq.current) setSearching(false);
    }
  }, []);

  function onAddressChange(next: string) {
    setStreet(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!shouldSearchAddress(next)) {
      setSuggestions([]);
      setOpen(false);
      setSearching(false);
      return;
    }
    debounceRef.current = setTimeout(() => void search(next), ADDRESS_SEARCH_DEBOUNCE_MS);
  }

  async function pick(s: Suggestion) {
    setOpen(false);
    let resolved: AddressParts;
    try {
      resolved = await s.resolve();
    } catch {
      resolved = { address: s.main, postalCode: "", city: "" };
    }
    const selected = applyPickedAddress(resolved, s.main);
    const filled = composeSelected === "line" ? formatAddressLine(selected) : selected.address;
    const complete = composeSelected === "line" ? { ...selected, address: filled } : selected;
    // Ett skriv: full adress via onSelect. Anropa inte onChange(gata) före/efter —
    // kontrollerade formulär (Inställningar) skulle annars skriva gata + gammal postort.
    if (value === undefined) setUncontrolled(filled);
    if (onSelect) onSelect(complete);
    else onChange?.(filled);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    // Enter får inte skicka parent-formuläret medan listan är öppen eller
    // medan vi väntar på förslag (annars hinner Ny kund submitta).
    if (e.key === "Enter" && (open || searching)) {
      e.preventDefault();
      e.stopPropagation();
      if (open) {
        const s = suggestions[highlight];
        if (s) void pick(s);
      }
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  }

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node;
      if (containerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const el = menuRef.current?.querySelector<HTMLElement>(`[data-address-option="${highlight}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  return (
    <div ref={containerRef} className="relative" data-address-autocomplete="">
      {hideLabel ? null : (
        <label htmlFor={inputId} className={labelClassName ?? defaultLabelCls}>
          {label}
        </label>
      )}
      <div ref={inputWrapRef} className="relative">
        <input
          id={inputId}
          name={name}
          value={street}
          disabled={disabled}
          onChange={(e) => onAddressChange(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          className={inputClassName ?? defaultInputCls}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-busy={searching || undefined}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          aria-label={hideLabel ? (ariaLabel ?? label) : ariaLabel}
        />
        {searching ? (
          <span className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
        ) : null}
      </div>

      <SuggestionMenu open={open} anchorRef={inputWrapRef} menuRef={menuRef}>
        <ul role="listbox" className="max-h-[inherit] overflow-auto">
          {suggestions.map((s, i) => (
            <li key={s.id} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                data-address-option={i}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void pick(s)}
                onMouseEnter={() => setHighlight(i)}
                className={cx(
                  "flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors",
                  i === highlight ? "bg-canvas" : "bg-card"
                )}
              >
                <MapPin className="size-4 shrink-0 text-muted" />
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-medium text-ink">{s.main}</span>
                  {s.secondary ? <span className="block truncate text-[12px] text-muted">{s.secondary}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2 border-t border-line/70 bg-canvas/60 px-3.5 py-1.5">
          {liveMode ? (
            <span className="text-[11px] text-muted">Adressförslag från Google</span>
          ) : (
            <>
              <DemoTag>Demo</DemoTag>
              <span className="text-[11px] text-muted">
                {MAPS_KEY
                  ? "Exempeladresser i demon"
                  : "Exempeladresser – sätt NEXT_PUBLIC_GOOGLE_MAPS_API_KEY för riktig Google Maps-sökning"}
              </span>
            </>
          )}
        </div>
      </SuggestionMenu>
    </div>
  );
}

export function AddressFields({
  value,
  defaults,
  onChange,
  onBlur,
  names,
  ids,
  label = "Adress",
  inputClassName,
  labelClassName,
  errors,
  invalid,
  describedBy,
}: {
  value?: AddressParts;
  defaults?: Partial<AddressParts>;
  onChange?: (parts: AddressParts) => void;
  onBlur?: () => void;
  names?: { address?: string; postalCode?: string; city?: string };
  ids?: { address?: string; postalCode?: string; city?: string };
  label?: string;
  inputClassName?: string;
  labelClassName?: string;
  errors?: { address?: string; postalCode?: string; city?: string };
  invalid?: { address?: boolean; postalCode?: boolean; city?: boolean };
  describedBy?: { address?: string; postalCode?: string; city?: string };
}) {
  const [internal, setInternal] = useState<AddressParts>({
    address: defaults?.address ?? "",
    postalCode: defaults?.postalCode ?? "",
    city: defaults?.city ?? "",
  });
  const parts = value ?? internal;
  const fieldCls = inputClassName ?? defaultInputCls;
  const labelCls = labelClassName ?? defaultLabelCls;

  function emit(next: AddressParts) {
    if (!value) setInternal(next);
    onChange?.(next);
  }

  const postalErrorId = ids?.postalCode ? `${ids.postalCode}-fel` : undefined;
  const addressErrorId = ids?.address ? `${ids.address}-fel` : undefined;
  const cityErrorId = ids?.city ? `${ids.city}-fel` : undefined;

  return (
    <div className="space-y-4">
      <div>
        <AddressAutocomplete
          name={names?.address ?? "address"}
          id={ids?.address}
          label={label}
          value={parts.address}
          onChange={(address) => emit({ ...parts, address })}
          onSelect={(selected) => emit(applyPickedAddress(selected, selected.address || parts.address))}
          onBlur={onBlur}
          inputClassName={cx(fieldCls, (invalid?.address || errors?.address) && invalidFieldCls)}
          labelClassName={labelCls}
          aria-invalid={Boolean(invalid?.address || errors?.address)}
          aria-describedby={describedBy?.address ?? (errors?.address ? addressErrorId : undefined)}
        />
        <FieldError id={addressErrorId}>{errors?.address}</FieldError>
      </div>

      <div className="grid grid-cols-[1fr_2fr] gap-3">
        <div>
          <label htmlFor={ids?.postalCode} className={labelCls}>
            Postnummer
          </label>
          <input
            id={ids?.postalCode}
            name={names?.postalCode ?? "postalCode"}
            value={parts.postalCode}
            onChange={(e) => emit({ ...parts, postalCode: e.target.value })}
            onBlur={() => {
              if (isSwedishPostalCode(parts.postalCode)) {
                emit({ ...parts, postalCode: formatSwedishPostalCode(parts.postalCode) });
              }
              onBlur?.();
            }}
            className={cx(fieldCls, (invalid?.postalCode || errors?.postalCode) && invalidFieldCls)}
            placeholder="116 24"
            autoComplete="postal-code"
            inputMode="numeric"
            aria-invalid={Boolean(invalid?.postalCode || errors?.postalCode) || undefined}
            aria-describedby={describedBy?.postalCode ?? (errors?.postalCode ? postalErrorId : undefined)}
          />
          <FieldError id={postalErrorId}>{errors?.postalCode}</FieldError>
        </div>
        <div>
          <label htmlFor={ids?.city} className={labelCls}>
            Ort
          </label>
          <input
            id={ids?.city}
            name={names?.city ?? "city"}
            value={parts.city}
            onChange={(e) => emit({ ...parts, city: e.target.value })}
            onBlur={onBlur}
            className={cx(fieldCls, (invalid?.city || errors?.city) && invalidFieldCls)}
            placeholder="Fylls i från adressen"
            autoComplete="off"
            aria-invalid={Boolean(invalid?.city || errors?.city) || undefined}
            aria-describedby={describedBy?.city ?? (errors?.city ? cityErrorId : undefined)}
          />
          <FieldError id={cityErrorId}>{errors?.city}</FieldError>
        </div>
      </div>
    </div>
  );
}
