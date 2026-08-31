"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ADDRESS_DEBOUNCE_MS,
  ADDRESS_LANGUAGE,
  ADDRESS_MAX_SUGGESTIONS,
  ADDRESS_PLACE_FIELDS,
  ADDRESS_PRIMARY_TYPES,
  ADDRESS_REGION_CODES,
  PredictionCache,
  addressPartsFromComponents,
  shouldFetchPredictions,
  trackAddressEvent,
  type AddressParts,
} from "@/lib/address-autocomplete";
import { isPlacesConfigured, loadPlacesLibrary, type PlacesPrediction } from "@/lib/places-loader";
import { formatSwedishPostalCode, isSwedishPostalCode } from "@/lib/validation";

/**
 * Enda vägen till Google Places i Driva.
 *
 * Hooken äger minChars, debounce, sessionToken, avbrutna requests,
 * fältval och cache. Komponenter ska aldrig anropa Places direkt – då kan
 * kostnadskontrollerna inte kringgås av misstag.
 *
 * Inget anropas vid mount, fokus eller när en sparad adress renderas.
 * Först när användaren faktiskt skriver eller ändrar adressen.
 */

export interface AddressSuggestion {
  id: string;
  main: string;
  secondary: string;
}

export type AddressAutocompleteStatus = "idle" | "searching" | "unavailable";

interface CachedSuggestions {
  suggestions: AddressSuggestion[];
  predictions: Map<string, PlacesPrediction>;
}

export function useAddressAutocomplete() {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [status, setStatus] = useState<AddressAutocompleteStatus>("idle");

  const cache = useMemo(() => new PredictionCache<CachedSuggestions>(), []);
  const predictionsRef = useRef(new Map<string, PlacesPrediction>());
  const sessionRef = useRef<object | null>(null);
  const sessionStartedRef = useRef(false);
  const seqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      // Avbryt eventuellt inflight-svar: högre seq gör svaret ointressant.
      seqRef.current += 1;
    };
  }, []);

  const close = useCallback(() => setOpen(false), []);

  /** Avbryt schemalagd/pågående sökning utan att röra sessionen. */
  const cancelPending = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    seqRef.current += 1;
    setOpen(false);
    setStatus((prev) => (prev === "searching" ? "idle" : prev));
  }, []);

  /**
   * Avslutar adressinmatningen: pågående request blir ointressant, listan
   * töms och nästa inmatning startar en ny Places-session. Att tömma
   * förslagen hindrar att ett inaktuellt förslag väljs efter att sessionen
   * redan avslutats.
   */
  const endInteraction = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    seqRef.current += 1;
    sessionRef.current = null;
    sessionStartedRef.current = false;
    cache.clear();
    predictionsRef.current.clear();
    setSuggestions([]);
    setOpen(false);
    setHighlight(-1);
  }, [cache]);

  const runSearch = useCallback(
    async (query: string, seq: number) => {
      const cached = cache.get(query);
      if (cached) {
        trackAddressEvent("address_autocomplete_cache_hit");
        predictionsRef.current = cached.predictions;
        if (seq !== seqRef.current || !mountedRef.current) return;
        setSuggestions(cached.suggestions);
        setOpen(cached.suggestions.length > 0);
        setHighlight(-1);
        setStatus("idle");
        return;
      }

      setStatus("searching");
      const lib = await loadPlacesLibrary();
      if (seq !== seqRef.current || !mountedRef.current) return;
      if (!lib) {
        // Nyckel saknas, skriptet blockerat eller nätverket nere → manuell inmatning.
        trackAddressEvent("address_autocomplete_error");
        setSuggestions([]);
        setOpen(false);
        setStatus("unavailable");
        return;
      }

      if (!sessionStartedRef.current) {
        trackAddressEvent("address_autocomplete_started");
        sessionStartedRef.current = true;
      }
      // En session per adressinmatning; detaljanropet avslutar den.
      sessionRef.current ??= new lib.AutocompleteSessionToken();

      try {
        trackAddressEvent("address_autocomplete_request");
        const { suggestions: raw } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: query,
          sessionToken: sessionRef.current,
          includedPrimaryTypes: [...ADDRESS_PRIMARY_TYPES],
          includedRegionCodes: [...ADDRESS_REGION_CODES],
          language: ADDRESS_LANGUAGE,
          region: "se",
        });
        if (seq !== seqRef.current || !mountedRef.current) return;

        const predictions = new Map<string, PlacesPrediction>();
        const mapped: AddressSuggestion[] = [];
        for (const item of raw) {
          const prediction = item.placePrediction;
          if (!prediction) continue;
          if (mapped.length >= ADDRESS_MAX_SUGGESTIONS) break;
          predictions.set(prediction.placeId, prediction);
          mapped.push({
            id: prediction.placeId,
            main: prediction.mainText?.text ?? prediction.text.text,
            secondary: prediction.secondaryText?.text ?? "",
          });
        }

        predictionsRef.current = predictions;
        cache.set(query, { suggestions: mapped, predictions });
        setSuggestions(mapped);
        setOpen(mapped.length > 0);
        setHighlight(-1);
        setStatus("idle");
      } catch {
        if (seq !== seqRef.current || !mountedRef.current) return;
        trackAddressEvent("address_autocomplete_error");
        setSuggestions([]);
        setOpen(false);
        setStatus("unavailable");
      }
    },
    [cache],
  );

  /**
   * Anropas när användaren SKRIVER i adressfältet – inte vid fokus, blur
   * eller när ett sparat värde renderas.
   */
  const onQueryChange = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const seq = ++seqRef.current;

      if (!isPlacesConfigured()) {
        setSuggestions([]);
        setOpen(false);
        return;
      }
      if (!shouldFetchPredictions(value)) {
        // "V" och "Vä" ska aldrig nå Google.
        setSuggestions([]);
        setOpen(false);
        setHighlight(-1);
        return;
      }

      debounceRef.current = setTimeout(() => {
        void runSearch(value, seq);
      }, ADDRESS_DEBOUNCE_MS);
    },
    [runSearch],
  );

  /** Öppnar igen utan nätverksanrop när vi redan har förslag. */
  const reopen = useCallback(() => {
    setOpen((prev) => prev || suggestions.length > 0);
  }, [suggestions.length]);

  /**
   * Detaljer hämtas ENDAST här – när användaren valt ett förslag. Aldrig per
   * visat förslag, och bara adresskomponenter.
   */
  const selectSuggestion = useCallback(
    async (id: string): Promise<AddressParts | null> => {
      const prediction = predictionsRef.current.get(id);
      if (!prediction) return null;
      setOpen(false);
      setStatus("searching");
      try {
        const place = prediction.toPlace();
        await place.fetchFields({ fields: ADDRESS_PLACE_FIELDS });
        // fetchFields avslutar sessionen – nästa sökning får en ny token.
        sessionRef.current = null;
        sessionStartedRef.current = false;
        const parts = addressPartsFromComponents(place.addressComponents ?? []);
        const fallbackStreet = prediction.mainText?.text ?? prediction.text.text;
        const resolved: AddressParts = {
          ...parts,
          address: parts.address || fallbackStreet,
          postalCode: isSwedishPostalCode(parts.postalCode)
            ? formatSwedishPostalCode(parts.postalCode)
            : parts.postalCode,
        };
        trackAddressEvent("address_prediction_selected");
        if (mountedRef.current) setStatus("idle");
        return resolved;
      } catch {
        sessionRef.current = null;
        sessionStartedRef.current = false;
        trackAddressEvent("address_autocomplete_error");
        if (mountedRef.current) setStatus("unavailable");
        return null;
      }
    },
    [],
  );

  return {
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
  };
}
