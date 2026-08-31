/**
 * Delad laddare för Google Maps Places-biblioteket.
 *
 * Laddas EN gång per session och först när en adressruta faktiskt behöver
 * förslag – aldrig vid sidladdning av Hem. Ingen ny script-tagg per
 * komponent, inga race conditions: alla anropare väntar på samma promise.
 *
 * Ingen karta, ingen Street View, ingen geocoding – bara Places-autocomplete.
 */

import { ADDRESS_LANGUAGE } from "./address-autocomplete";

export interface PlacesPlace {
  fetchFields(opts: { fields: readonly string[] }): Promise<unknown>;
  addressComponents?: { longText: string | null; shortText?: string | null; types: string[] }[] | null;
}

export interface PlacesPrediction {
  placeId: string;
  text: { text: string };
  mainText: { text: string } | null;
  secondaryText: { text: string } | null;
  toPlace(): PlacesPlace;
}

export interface PlacesLibrary {
  AutocompleteSessionToken: new () => object;
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions(
      request: Record<string, unknown>,
    ): Promise<{ suggestions: { placePrediction: PlacesPrediction | null }[] }>;
  };
}

declare global {
  interface Window {
    google?: { maps?: { importLibrary?: (name: string) => Promise<unknown> } };
    __drivaMapsReady?: () => void;
    __drivaAddressCounters?: () => Record<string, number>;
  }
}

/** Nyckeln är publik per definition (NEXT_PUBLIC_) men läses bara härifrån. */
function apiKey(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? "";
}

/**
 * Den publika demosessionen ska inte dra Google-kostnader: appskalet sätter
 * data-driva-demo och adressfälten blir vanliga textfält. Manuell inmatning
 * fungerar precis som när nyckel saknas.
 */
function isPublicDemoSession(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector("[data-driva-demo]") !== null;
}

/** Är Places konfigurerat? Utan nyckel eller i demon → manuell inmatning. */
export function isPlacesConfigured(): boolean {
  return apiKey().length > 0 && !isPublicDemoSession();
}

const CALLBACK_NAME = "__drivaMapsReady";

let loader: Promise<PlacesLibrary | null> | null = null;

/**
 * Laddar Places-biblioteket lazy. Returnerar null när nyckel saknas eller
 * skriptet inte kan laddas – anroparen visar då manuell inmatning i stället
 * för ett rått Google-fel.
 */
export function loadPlacesLibrary(): Promise<PlacesLibrary | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const key = apiKey();
  if (!key || isPublicDemoSession()) return Promise.resolve(null);
  if (loader) return loader;

  loader = new Promise<PlacesLibrary | null>((resolve) => {
    const timeout = window.setTimeout(() => resolve(null), 10_000);
    const done = (lib: PlacesLibrary | null) => {
      window.clearTimeout(timeout);
      resolve(lib);
    };

    const importPlaces = () => {
      const importLibrary = window.google?.maps?.importLibrary;
      if (!importLibrary) {
        done(null);
        return;
      }
      importLibrary("places")
        .then((lib) => done(lib as PlacesLibrary))
        .catch(() => done(null));
    };

    if (window.google?.maps?.importLibrary) {
      importPlaces();
      return;
    }

    const existing = document.getElementById(CALLBACK_NAME) as HTMLScriptElement | null;
    if (existing) {
      // En annan komponent hann före: vänta på samma callback.
      window[CALLBACK_NAME] = importPlaces;
      return;
    }

    window[CALLBACK_NAME] = importPlaces;
    const script = document.createElement("script");
    script.id = CALLBACK_NAME;
    script.async = true;
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
      `&v=weekly&loading=async&language=${encodeURIComponent(ADDRESS_LANGUAGE)}&region=SE` +
      `&callback=${CALLBACK_NAME}`;
    script.onerror = () => done(null);
    document.head.appendChild(script);
  });

  return loader;
}

/** Testkrok: nästa anrop laddar om. Används inte i produktionskod. */
export function resetPlacesLoader(): void {
  loader = null;
}
