/**
 * Ren adresslogik för den delade AddressAutocomplete.
 * Google Places anropas bara från klienten, och bara efter att användaren
 * valt ett förslag (session token + details).
 */

export const ADDRESS_SEARCH_MIN_CHARS = 3;
export const ADDRESS_SEARCH_DEBOUNCE_MS = 250;

export interface AddressParts {
  address: string;
  postalCode: string;
  city: string;
}

export interface PlaceAddressComponent {
  longText?: string | null;
  types: string[];
}

export function trimmedAddressQuery(raw: string): string {
  return raw.trim();
}

/** Minst tre meningsfulla tecken efter trim – "va" ska inte söka. */
export function shouldSearchAddress(raw: string): boolean {
  return trimmedAddressQuery(raw).length >= ADDRESS_SEARCH_MIN_CHARS;
}

export function formatAddressLine(parts: AddressParts): string {
  const place = [parts.postalCode.trim(), parts.city.trim()].filter(Boolean).join(" ");
  return [parts.address.trim(), place].filter(Boolean).join(", ");
}

export function partsFromPlaceComponents(components: PlaceAddressComponent[]): AddressParts {
  const get = (type: string) => components.find((c) => c.types.includes(type))?.longText ?? "";
  const street = [get("route"), get("street_number")].filter(Boolean).join(" ");
  return {
    address: street,
    postalCode: get("postal_code"),
    city: get("postal_town") || get("locality") || get("sublocality") || "",
  };
}

export const DEMO_ADDRESSES: AddressParts[] = [
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

export function demoAddressSuggestions(query: string): AddressParts[] {
  if (!shouldSearchAddress(query)) return [];
  const q = trimmedAddressQuery(query).toLowerCase();
  return DEMO_ADDRESSES.filter((a) => a.address.toLowerCase().includes(q)).slice(0, 5);
}
