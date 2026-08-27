"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { cx, DemoTag } from "./ui";

/**
 * Adressfält med autocomplete.
 *
 * Med `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` satt används Google Places API (New)
 * – förslagen hämtas via AutocompleteSuggestion och vald adress fyller i
 * gatuadress, postnummer och ort automatiskt.
 *
 * Utan nyckel används en liten lista svenska exempeladresser, tydligt märkt
 * som demo (samma princip som BankID-mocken).
 */

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted focus:border-accent";

export interface AddressParts {
  address: string;
  postalCode: string;
  city: string;
}

interface Suggestion {
  id: string;
  main: string;
  secondary: string;
  /** Hämtar kompletta adressdelar för förslaget. */
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

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

let placesLoader: Promise<PlacesLib | null> | null = null;

function loadPlaces(): Promise<PlacesLib | null> {
  if (!MAPS_KEY) return Promise.resolve(null);
  if (placesLoader) return placesLoader;
  placesLoader = new Promise((resolve) => {
    const boot = () => {
      window.google
        ?.maps!.importLibrary!("places")
        .then((lib) => resolve(lib as PlacesLib))
        .catch(() => resolve(null));
    };
    if (window.google?.maps?.importLibrary) {
      boot();
      return;
    }
    window.__drivaMapsReady = boot;
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      MAPS_KEY
    )}&v=weekly&loading=async&language=sv&region=SE&callback=__drivaMapsReady`;
    script.async = true;
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return placesLoader;
}

function partsFromComponents(components: { longText: string | null; types: string[] }[]): AddressParts {
  const get = (type: string) => components.find((c) => c.types.includes(type))?.longText ?? "";
  const street = [get("route"), get("street_number")].filter(Boolean).join(" ");
  return {
    address: street,
    postalCode: get("postal_code"),
    // Sverige använder postal_town; locality/sublocality som reserv.
    city: get("postal_town") || get("locality") || get("sublocality") || "",
  };
}

/* ------------------------------ Demo-adresser ------------------------------ */

const DEMO_ADDRESSES: AddressParts[] = [
  { address: "Vädursvägen 13", postalCode: "141 43", city: "Huddinge" },
  { address: "Folkungagatan 62", postalCode: "116 22", city: "Stockholm" },
  { address: "Åsögatan 114", postalCode: "116 24", city: "Stockholm" },
  { address: "Renstiernas gata 12", postalCode: "116 28", city: "Stockholm" },
  { address: "Hornsgatan 45", postalCode: "118 49", city: "Stockholm" },
  { address: "Götgatan 71", postalCode: "116 62", city: "Stockholm" },
  { address: "Sveavägen 24", postalCode: "111 57", city: "Stockholm" },
  { address: "Vasagatan 33", postalCode: "411 24", city: "Göteborg" },
  { address: "Stora Nygatan 7", postalCode: "211 37", city: "Malmö" },
  { address: "Drottninggatan 5", postalCode: "753 10", city: "Uppsala" },
];

function demoSuggestions(query: string): Suggestion[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return DEMO_ADDRESSES.filter((a) => a.address.toLowerCase().includes(q))
    .slice(0, 5)
    .map((a) => ({
      id: a.address,
      main: a.address,
      secondary: `${a.postalCode} ${a.city}`,
      resolve: async () => a,
    }));
}

/* -------------------------------- Komponenten ------------------------------- */

export function AddressFields({
  defaults,
}: {
  defaults?: Partial<AddressParts>;
}) {
  const [address, setAddress] = useState(defaults?.address ?? "");
  const [postalCode, setPostalCode] = useState(defaults?.postalCode ?? "");
  const [city, setCity] = useState(defaults?.city ?? "");

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [searching, setSearching] = useState(false);

  const sessionRef = useRef<object | null>(null);
  const requestSeq = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const liveMode = !!MAPS_KEY;

  const search = useCallback(async (query: string) => {
    const seq = ++requestSeq.current;

    if (!MAPS_KEY) {
      const result = demoSuggestions(query);
      setSuggestions(result);
      setOpen(result.length > 0);
      setHighlight(0);
      return;
    }

    if (query.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    setSearching(true);
    const lib = await loadPlaces();
    if (!lib || seq !== requestSeq.current) {
      setSearching(false);
      return;
    }
    sessionRef.current ??= new lib.AutocompleteSessionToken();

    try {
      const { suggestions: raw } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: query,
        sessionToken: sessionRef.current,
        includedRegionCodes: ["se"],
        language: "sv-SE",
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
            await place.fetchFields({ fields: ["addressComponents"] });
            // Sessionen förbrukas när detaljer hämtas – börja om vid nästa sökning.
            sessionRef.current = null;
            const parts = partsFromComponents(place.addressComponents ?? []);
            return { ...parts, address: parts.address || (p.mainText?.text ?? p.text.text) };
          },
        }));
      setSuggestions(mapped);
      setOpen(mapped.length > 0);
      setHighlight(0);
    } catch {
      setSuggestions([]);
      setOpen(false);
    } finally {
      if (seq === requestSeq.current) setSearching(false);
    }
  }, []);

  function onAddressChange(value: string) {
    setAddress(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void search(value), liveMode ? 250 : 80);
  }

  async function pick(s: Suggestion) {
    setOpen(false);
    setAddress(s.main);
    const parts = await s.resolve();
    setAddress(parts.address);
    if (parts.postalCode) setPostalCode(parts.postalCode);
    if (parts.city) setCity(parts.city);
  }

  // Stäng vid klick utanför
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  return (
    <div className="space-y-4">
      <div ref={containerRef} className="relative">
        <label className="mb-1 block text-[13px] font-medium text-soft">Adress</label>
        <input
          name="address"
          value={address}
          onChange={(e) => onAddressChange(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onKeyDown={(e) => {
            if (!open) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const s = suggestions[highlight];
              if (s) void pick(s);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className={inputCls}
          placeholder="Börja skriv gatuadressen …"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />

        {open ? (
          <div className="absolute inset-x-0 top-full z-20 mt-1.5 overflow-hidden rounded-xl border border-line bg-card shadow-pop animate-fade-in">
            <ul role="listbox">
              {suggestions.map((s, i) => (
                <li key={s.id} role="option" aria-selected={i === highlight}>
                  <button
                    type="button"
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
                    Exempeladresser – sätt NEXT_PUBLIC_GOOGLE_MAPS_API_KEY för riktig Google Maps-sökning
                  </span>
                </>
              )}
            </div>
          </div>
        ) : null}

        {searching ? (
          <span className="absolute right-3 top-[38px] size-4 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
        ) : null}
      </div>

      <div className="grid grid-cols-[1fr_2fr] gap-3">
        <div>
          <label className="mb-1 block text-[13px] font-medium text-soft">Postnummer</label>
          <input
            name="postalCode"
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value)}
            className={inputCls}
            placeholder="116 24"
            autoComplete="off"
            inputMode="numeric"
          />
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium text-soft">Ort</label>
          <input
            name="city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className={inputCls}
            placeholder="Fylls i från adressen"
            autoComplete="off"
          />
        </div>
      </div>
    </div>
  );
}
