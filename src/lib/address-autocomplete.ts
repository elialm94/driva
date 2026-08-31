/**
 * Adressautocomplete: all kostnadskontroll på ett ställe.
 *
 * Google Places (New) är en bekvämlighet, inte ett beroende. Reglerna här
 * gäller för HELA appen så att ingen ny adressruta kan börja anropa Google
 * per tangenttryckning:
 *
 *   * Minst {@link ADDRESS_MIN_QUERY_CHARS} meningsfulla tecken (whitespace
 *     räknas inte) innan första requesten.
 *   * Debounce – en request vid naturlig paus, inte per bokstav.
 *   * En session per adressinmatning (sessionToken), avslutad av detaljanropet.
 *   * Detaljer hämtas BARA när användaren valt ett förslag, och bara
 *     {@link ADDRESS_PLACE_FIELDS}.
 *   * Kortlivad cache på query → förslag inom samma session.
 *   * Sverige först, och bara adresstyper (inga restauranger/museer).
 *
 * Modulen är avsiktligt fri från React och DOM så att reglerna kan testas.
 */

/** Minsta antal meningsfulla tecken (exkl. whitespace) innan Google anropas. */
export const ADDRESS_MIN_QUERY_CHARS = 3;

/** Paus efter senaste tangenttryckningen innan requesten går. */
export const ADDRESS_DEBOUNCE_MS = 250;

/** Hur länge ett cachat svar får återanvändas inom samma inmatning. */
export const ADDRESS_CACHE_TTL_MS = 2 * 60 * 1000;

/** Tak för cachen så en lång inmatning inte växer obegränsat. */
export const ADDRESS_CACHE_MAX_ENTRIES = 30;

/** Max antal förslag som visas. Fler ger inte bättre UX. */
export const ADDRESS_MAX_SUGGESTIONS = 5;

/**
 * Bara riktiga postadresser. Legacy-typen "address" finns inte i Places (New),
 * så kombinationen nedan är Googles rekommenderade motsvarighet.
 */
export const ADDRESS_PRIMARY_TYPES = ["premise", "subpremise", "street_address", "route"] as const;

/** Driva är primärt svenskt – bias mot SE ger färre irrelevanta förslag. */
export const ADDRESS_REGION_CODES = ["se"] as const;

export const ADDRESS_LANGUAGE = "sv-SE";

/**
 * Enda fältet vi behöver för att strukturera en adress. Inga öppettider,
 * betyg, foton, telefonnummer eller geometry.
 */
export const ADDRESS_PLACE_FIELDS = ["addressComponents"] as const;

/** Landskod när Google inte svarar med något annat. */
export const DEFAULT_ADDRESS_COUNTRY = "SE";

export interface AddressParts {
  address: string;
  postalCode: string;
  city: string;
  /** ISO-3166-1 alpha-2, t.ex. "SE". */
  country?: string;
}

export interface AddressComponent {
  longText: string | null;
  shortText?: string | null;
  types: string[];
}

/** Tecken som faktiskt bär information – whitespace räknas inte. */
export function meaningfulQueryLength(value: string): number {
  return value.replace(/\s+/g, "").length;
}

/**
 * Ska vi anropa Google för den här inmatningen? "V" och "Vä" ger nej,
 * "Väd" ger ja.
 */
export function shouldFetchPredictions(value: string): boolean {
  return meaningfulQueryLength(value) >= ADDRESS_MIN_QUERY_CHARS;
}

/** Nyckel för duplikatskydd: skiftlägesokänslig och whitespace-normaliserad. */
export function predictionCacheKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function componentText(components: AddressComponent[], type: string): string {
  return components.find((c) => c.types.includes(type))?.longText?.trim() ?? "";
}

function componentShortText(components: AddressComponent[], type: string): string {
  const hit = components.find((c) => c.types.includes(type));
  return (hit?.shortText ?? hit?.longText ?? "").trim();
}

/**
 * Google → Drivas kanoniska fält.
 *
 * Sverige använder postal_town för ort; locality/sublocality är reserv.
 * Postnummer normaliseras till "141 43" av anroparen via validation-hjälpen.
 */
export function addressPartsFromComponents(components: AddressComponent[]): AddressParts {
  const route = componentText(components, "route");
  const streetNumber = componentText(components, "street_number");
  const address = [route, streetNumber].filter(Boolean).join(" ");
  const city =
    componentText(components, "postal_town") ||
    componentText(components, "locality") ||
    componentText(components, "sublocality") ||
    "";
  const country = componentShortText(components, "country").toUpperCase();
  return {
    address,
    postalCode: componentText(components, "postal_code"),
    city,
    ...(country ? { country } : {}),
  };
}

/** Har vi allt vi behöver, eller ska användaren fylla i resten manuellt? */
export function isCompleteAddress(parts: AddressParts): boolean {
  return Boolean(parts.address.trim() && parts.postalCode.trim() && parts.city.trim());
}

/** "Vädursvägen 13, 141 43 Huddinge" – för fält som lagrar adressen som en rad. */
export function singleLineAddress(parts: AddressParts): string {
  const street = parts.address.trim();
  const place = [parts.postalCode.trim(), parts.city.trim()].filter(Boolean).join(" ");
  return [street, place].filter(Boolean).join(", ");
}

/**
 * Kortlivad cache för query → förslag inom EN adressinmatning.
 * Ingen permanent Places-databas: instansen dör med komponenten.
 */
export class PredictionCache<T> {
  private entries = new Map<string, { at: number; value: T }>();

  constructor(
    private readonly ttlMs = ADDRESS_CACHE_TTL_MS,
    private readonly maxEntries = ADDRESS_CACHE_MAX_ENTRIES,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get(query: string): T | undefined {
    const key = predictionCacheKey(query);
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (this.now() - hit.at > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    // Färskast sist – enklaste LRU-ordningen.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }

  set(query: string, value: T): void {
    const key = predictionCacheKey(query);
    this.entries.delete(key);
    this.entries.set(key, { at: this.now(), value });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/* -------------------------------- Telemetri -------------------------------- */

/**
 * Grova räknare för att kunna se hur ofta Places faktiskt används.
 * Aldrig adresser, namn eller andra personuppgifter – bara händelsenamn.
 */
export type AddressAutocompleteEvent =
  | "address_autocomplete_started"
  | "address_autocomplete_request"
  | "address_autocomplete_cache_hit"
  | "address_prediction_selected"
  | "address_manual_used"
  | "address_autocomplete_error";

export const ADDRESS_AUTOCOMPLETE_EVENTS: AddressAutocompleteEvent[] = [
  "address_autocomplete_started",
  "address_autocomplete_request",
  "address_autocomplete_cache_hit",
  "address_prediction_selected",
  "address_manual_used",
  "address_autocomplete_error",
];

const counters = new Map<AddressAutocompleteEvent, number>();

/**
 * Räknar upp en händelse. Driva har ingen klient-analytics-pipeline, så
 * räknarna hålls i minnet och kan läsas i devtools via
 * `window.__drivaAddressCounters`. Ingen nätverkstrafik, inga persondata.
 */
export function trackAddressEvent(event: AddressAutocompleteEvent): void {
  counters.set(event, (counters.get(event) ?? 0) + 1);
}

export function addressEventCounts(): Record<string, number> {
  return Object.fromEntries(counters);
}

export function resetAddressEventCounts(): void {
  counters.clear();
}
