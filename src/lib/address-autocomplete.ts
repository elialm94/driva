/**
 * Ren adresslogik för den delade AddressAutocomplete.
 * Google Places anropas bara från klienten, och bara efter att användaren
 * valt ett förslag (session token + details).
 */

import { formatSwedishPostalCode, isSwedishPostalCode } from "./validation";

export const ADDRESS_SEARCH_MIN_CHARS = 3;
export const ADDRESS_SEARCH_DEBOUNCE_MS = 250;

/**
 * Places API (New) – bara riktiga postadresser.
 * Legacy-typen "address" finns inte; den här kombinationen är Googles motsvarighet.
 */
export const ADDRESS_PRIMARY_TYPES = ["premise", "subpremise", "street_address", "route"] as const;
export const ADDRESS_REGION_CODES = ["se"] as const;
export const ADDRESS_LANGUAGE = "sv-SE";
export const ADDRESS_PLACE_FIELDS = ["addressComponents"] as const;

/**
 * Resmål på en reseräkning: ort ELLER gatuadress, i vilket land som helst.
 * "geocode" är Googles samling av adresser och orter utan företag, och
 * inga `includedRegionCodes` betyder hela världen.
 */
export const TRIP_PRIMARY_TYPES = ["geocode"] as const;
export const TRIP_REGION_CODES = [] as const;

/** Över Ny kund-modalen (z=50 + 10×lager) och datumväljaren (z=80). */
export const ADDRESS_MENU_Z_INDEX = 400;

/** Om Maps-skriptet aldrig anropar callback (ogiltig nyckel / referer) ska inte spinnaren hänga. */
export const ADDRESS_PLACES_LOAD_TIMEOUT_MS = 8000;

/** Publik nyckel, trimnad. Tom sträng = inte konfigurerad. */
export function googleMapsApiKey(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? "";
}

export interface AddressParts {
  address: string;
  postalCode: string;
  city: string;
  /** Landets namn på svenska. Bara med när förslaget hade ett land. */
  country?: string;
  /** Landskod (ISO 3166-1 alpha-2), t.ex. "SE" eller "NO". */
  countryCode?: string;
}

export interface PlaceAddressComponent {
  longText?: string | null;
  /** Kort form, t.ex. landskoden "NO". */
  shortText?: string | null;
  types: string[];
}

export function trimmedAddressQuery(raw: string): string {
  return raw.trim();
}

/** Minst tre meningsfulla tecken efter trim – "va" ska inte söka. */
export function shouldSearchAddress(raw: string): boolean {
  return trimmedAddressQuery(raw).length >= ADDRESS_SEARCH_MIN_CHARS;
}

/** Alltid en sträng – `.trim()` på undefined kastar och kan fälla error boundary. */
export function addressFieldText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Gata / postnummer / ort – det enda AddressFields får släppa ut.
 * Land hör till resmålet (`composeSelected="trip"`), inte kund-/jobbadress.
 */
export function streetAddressParts(parts: AddressParts): Pick<AddressParts, "address" | "postalCode" | "city"> {
  return {
    address: addressFieldText(parts.address),
    postalCode: addressFieldText(parts.postalCode),
    city: addressFieldText(parts.city),
  };
}

/**
 * En rad i förslagsmenyn. `main`/`secondary` är alltid strängar så React
 * inte får ett objekt som barn (produktion: minified error, #441-gränsen).
 */
export function presentAddressSuggestion(parts: AddressParts): { id: string; main: string; secondary: string } {
  const address = addressFieldText(parts.address).trim();
  const city = addressFieldText(parts.city).trim();
  const postal = addressFieldText(parts.postalCode).trim();
  const main = address || city;
  const place = [postal, city].filter(Boolean).join(" ");
  const countryCode = addressFieldText(parts.countryCode).trim().toUpperCase();
  const country = countryCode === "SE" ? "" : addressFieldText(parts.country).trim();
  const secondary = [place, country].filter(Boolean).join(", ");
  return {
    id: [main, postal, city].filter(Boolean).join("|") || "förslag",
    main,
    secondary,
  };
}

export function formatAddressLine(parts: AddressParts): string {
  const place = [addressFieldText(parts.postalCode).trim(), addressFieldText(parts.city).trim()]
    .filter(Boolean)
    .join(" ");
  return [addressFieldText(parts.address).trim(), place].filter(Boolean).join(", ");
}

/**
 * Ett valt förslag ersätter gata + postnummer + ort i ett svep.
 * Gamla fältvärden får inte ligga kvar (t.ex. Inställningar med
 * kontrollerat state, där en gatu-only-uppdatering annars vinner).
 */
export function applyPickedAddress(selected: AddressParts, suggestionMain: string): AddressParts {
  const postal = addressFieldText(selected?.postalCode).trim();
  const country = addressFieldText(selected?.country).trim();
  const countryCode = addressFieldText(selected?.countryCode).trim().toUpperCase();
  return {
    address: addressFieldText(selected?.address).trim() || addressFieldText(suggestionMain).trim(),
    postalCode: isSwedishPostalCode(postal) ? formatSwedishPostalCode(postal) : postal,
    city: addressFieldText(selected?.city).trim(),
    ...(country ? { country } : {}),
    ...(countryCode ? { countryCode } : {}),
  };
}

export function partsFromPlaceComponents(components: PlaceAddressComponent[]): AddressParts {
  const find = (type: string) => components.find((c) => c.types.includes(type));
  const get = (type: string) => find(type)?.longText ?? "";
  const street = [get("route"), get("street_number")].filter(Boolean).join(" ");
  const country = find("country");
  return {
    address: street,
    postalCode: get("postal_code"),
    city: get("postal_town") || get("locality") || get("sublocality") || "",
    // Landet följer bara med när förslaget hade ett – gamla adressfält
    // (kund, ROT-bostad, inställningar) ska se exakt samma objekt som förut.
    ...(country?.longText ? { country: country.longText } : {}),
    ...(country?.shortText ? { countryCode: country.shortText.toUpperCase() } : {}),
  };
}

/**
 * Resmålet som en rad: "Vasagatan 33, 411 24 Göteborg" eller "Oslo, Norge".
 * Delar som redan står i en tidigare del hoppas över, så en ort inte blir
 * "Göteborg, Göteborg". Sverige skrivs inte ut – inrikes är normalfallet.
 */
export function formatTripDestination(parts: AddressParts): string {
  const place = [addressFieldText(parts.postalCode).trim(), addressFieldText(parts.city).trim()]
    .filter(Boolean)
    .join(" ");
  const countryCode = addressFieldText(parts.countryCode).trim().toUpperCase();
  const country = countryCode === "SE" ? "" : addressFieldText(parts.country).trim();
  const segments: string[] = [];
  for (const segment of [addressFieldText(parts.address).trim(), place, country]) {
    if (!segment) continue;
    const lower = segment.toLowerCase();
    if (segments.some((s) => s.toLowerCase().includes(lower))) continue;
    segments.push(segment);
  }
  return segments.join(", ");
}

/**
 * Exempelresmål när Places inte är tillgängligt (demo eller saknad nyckel):
 * orter i Sverige och några vanliga utlandsmål, så att landet kan väljas
 * utan Google.
 */
export const DEMO_TRIP_PLACES: AddressParts[] = [
  { address: "", postalCode: "", city: "Göteborg", country: "Sverige", countryCode: "SE" },
  { address: "", postalCode: "", city: "Malmö", country: "Sverige", countryCode: "SE" },
  { address: "", postalCode: "", city: "Stockholm", country: "Sverige", countryCode: "SE" },
  { address: "", postalCode: "", city: "Kiruna", country: "Sverige", countryCode: "SE" },
  { address: "", postalCode: "", city: "Umeå", country: "Sverige", countryCode: "SE" },
  { address: "", postalCode: "", city: "Oslo", country: "Norge", countryCode: "NO" },
  { address: "", postalCode: "", city: "Trondheim", country: "Norge", countryCode: "NO" },
  { address: "", postalCode: "", city: "København", country: "Danmark", countryCode: "DK" },
  { address: "", postalCode: "", city: "Helsingfors", country: "Finland", countryCode: "FI" },
  { address: "", postalCode: "", city: "Berlin", country: "Tyskland", countryCode: "DE" },
];

export function demoTripSuggestions(query: string): AddressParts[] {
  if (!shouldSearchAddress(query)) return [];
  const q = trimmedAddressQuery(query).toLowerCase();
  return DEMO_TRIP_PLACES.filter(
    (p) => p.city.toLowerCase().includes(q) || (p.country ?? "").toLowerCase().includes(q)
  ).slice(0, 5);
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
