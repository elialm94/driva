process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADDRESS_DEBOUNCE_MS,
  ADDRESS_MIN_QUERY_CHARS,
  ADDRESS_PLACE_FIELDS,
  ADDRESS_PRIMARY_TYPES,
  ADDRESS_REGION_CODES,
  PredictionCache,
  addressEventCounts,
  addressPartsFromComponents,
  isCompleteAddress,
  meaningfulQueryLength,
  predictionCacheKey,
  resetAddressEventCounts,
  shouldFetchPredictions,
  trackAddressEvent,
} from "./address-autocomplete";

const here = dirname(fileURLToPath(import.meta.url));

/* ---------------------- Kostnadsspärr: minsta antal tecken ------------------- */

describe("adressautocomplete: inga anrop innan tre meningsfulla tecken", () => {
  it("kräver exakt tre tecken innan Google får anropas", () => {
    assert.equal(ADDRESS_MIN_QUERY_CHARS, 3);
    assert.equal(shouldFetchPredictions("V"), false);
    assert.equal(shouldFetchPredictions("Vä"), false);
    assert.equal(shouldFetchPredictions("Väd"), true);
    assert.equal(shouldFetchPredictions("Vädursvägen"), true);
  });

  it("räknar inte whitespace som meningsfulla tecken", () => {
    assert.equal(meaningfulQueryLength("  V ä  "), 2);
    assert.equal(shouldFetchPredictions("  V ä  "), false);
    assert.equal(shouldFetchPredictions(" V ä d "), true);
    assert.equal(shouldFetchPredictions("   "), false);
    assert.equal(shouldFetchPredictions(""), false);
  });

  it("debounce ligger i intervallet 200–300 ms", () => {
    assert.ok(ADDRESS_DEBOUNCE_MS >= 200 && ADDRESS_DEBOUNCE_MS <= 300);
  });
});

/* ------------------------------ Requestens form ----------------------------- */

describe("adressautocomplete: minimal och relevant request", () => {
  it("hämtar bara adresskomponenter – inga dyra fält", () => {
    assert.deepEqual([...ADDRESS_PLACE_FIELDS], ["addressComponents"]);
    const forbidden = [
      "openingHours",
      "rating",
      "reviews",
      "photos",
      "websiteUri",
      "nationalPhoneNumber",
      "location",
      "geometry",
    ];
    for (const field of forbidden) {
      assert.ok(!ADDRESS_PLACE_FIELDS.includes(field as never), `${field} ska inte begäras`);
    }
  });

  it("begränsar förslagen till postadresser, inte restauranger och museer", () => {
    assert.deepEqual([...ADDRESS_PRIMARY_TYPES], ["premise", "subpremise", "street_address", "route"]);
    assert.ok(!ADDRESS_PRIMARY_TYPES.includes("establishment" as never));
    assert.ok(!ADDRESS_PRIMARY_TYPES.includes("restaurant" as never));
    // Places (New) tillåter max fem typer.
    assert.ok(ADDRESS_PRIMARY_TYPES.length <= 5);
  });

  it("biasar mot Sverige", () => {
    assert.deepEqual([...ADDRESS_REGION_CODES], ["se"]);
  });
});

/* --------------------------- Strukturerad adress ---------------------------- */

describe("adressautocomplete: Google → Drivas kanoniska fält", () => {
  it("mappar Vädursvägen 13, 141 43 Huddinge", () => {
    const parts = addressPartsFromComponents([
      { longText: "13", shortText: "13", types: ["street_number"] },
      { longText: "Vädursvägen", shortText: "Vädursvägen", types: ["route"] },
      { longText: "Huddinge", shortText: "Huddinge", types: ["postal_town"] },
      { longText: "141 43", shortText: "141 43", types: ["postal_code"] },
      { longText: "Sverige", shortText: "SE", types: ["country", "political"] },
    ]);
    assert.equal(parts.address, "Vädursvägen 13");
    assert.equal(parts.postalCode, "141 43");
    assert.equal(parts.city, "Huddinge");
    assert.equal(parts.country, "SE");
  });

  it("använder locality när postal_town saknas", () => {
    const parts = addressPartsFromComponents([
      { longText: "Storgatan", types: ["route"] },
      { longText: "2B", types: ["street_number"] },
      { longText: "Kiruna", types: ["locality", "political"] },
    ]);
    assert.equal(parts.address, "Storgatan 2B");
    assert.equal(parts.city, "Kiruna");
    assert.equal(parts.country, undefined);
  });

  it("tappar inte gatunamnet när husnummer saknas", () => {
    const parts = addressPartsFromComponents([{ longText: "Vädursvägen", types: ["route"] }]);
    assert.equal(parts.address, "Vädursvägen");
    assert.equal(isCompleteAddress(parts), false);
  });

  it("isCompleteAddress kräver gata, postnummer och ort", () => {
    assert.equal(
      isCompleteAddress({ address: "Vädursvägen 13", postalCode: "141 43", city: "Huddinge" }),
      true,
    );
    assert.equal(isCompleteAddress({ address: "Vädursvägen 13", postalCode: "", city: "Huddinge" }), false);
  });
});

/* ---------------------------------- Cache ----------------------------------- */

describe("adressautocomplete: kortlivad cache mot dubbletter", () => {
  it("normaliserar nyckeln så samma sökning inte upprepas", () => {
    assert.equal(predictionCacheKey("  Vädursvä  "), "vädursvä");
    assert.equal(predictionCacheKey("Vädursvägen  13"), "vädursvägen 13");
    assert.equal(predictionCacheKey("VÄDURSVÄ"), predictionCacheKey("vädursvä"));
  });

  it("återanvänder svaret för samma query", () => {
    const cache = new PredictionCache<string[]>();
    cache.set("Vädursvä", ["a"]);
    assert.deepEqual(cache.get("vädursvä  "), ["a"]);
    assert.equal(cache.get("Storgatan"), undefined);
  });

  it("släpper cachen när den är för gammal", () => {
    let now = 1_000;
    const cache = new PredictionCache<string[]>(500, 10, () => now);
    cache.set("Väd", ["a"]);
    now = 1_400;
    assert.deepEqual(cache.get("Väd"), ["a"]);
    now = 1_600;
    assert.equal(cache.get("Väd"), undefined);
  });

  it("växer inte obegränsat", () => {
    const cache = new PredictionCache<number>(60_000, 3);
    for (const q of ["aaa", "bbb", "ccc", "ddd", "eee"]) cache.set(q, 1);
    assert.equal(cache.size, 3);
    assert.equal(cache.get("aaa"), undefined);
    assert.equal(cache.get("eee"), 1);
  });

  it("töms helt när inmatningen avslutas", () => {
    const cache = new PredictionCache<number>();
    cache.set("aaa", 1);
    cache.clear();
    assert.equal(cache.size, 0);
  });
});

/* -------------------------------- Telemetri --------------------------------- */

describe("adressautocomplete: räknare utan persondata", () => {
  beforeEach(() => resetAddressEventCounts());

  it("räknar händelser, inte adresser", () => {
    trackAddressEvent("address_autocomplete_request");
    trackAddressEvent("address_autocomplete_request");
    trackAddressEvent("address_prediction_selected");
    const counts = addressEventCounts();
    assert.equal(counts.address_autocomplete_request, 2);
    assert.equal(counts.address_prediction_selected, 1);
    // Bara händelsenamn – inget som kan innehålla en adress eller ett namn.
    for (const key of Object.keys(counts)) assert.match(key, /^address_[a-z_]+$/);
  });
});

/* ---------------------- Kostnadsspärrar i källkoden ------------------------- */

describe("adressautocomplete: kostnadskontrollerna är centraliserade", () => {
  it("bara hooken laddar Places – inga egna anrop per formulär", () => {
    const hook = readFileSync(join(here, "../components/use-address-autocomplete.ts"), "utf8");
    assert.match(hook, /loadPlacesLibrary/);
    assert.match(hook, /AutocompleteSessionToken/);
    assert.match(hook, /shouldFetchPredictions/);
    assert.match(hook, /ADDRESS_DEBOUNCE_MS/);
    assert.match(hook, /ADDRESS_PLACE_FIELDS/);
  });

  it("detaljer hämtas bara i selectSuggestion, aldrig per visat förslag", () => {
    const hook = readFileSync(join(here, "../components/use-address-autocomplete.ts"), "utf8");
    const calls = hook.match(/\.fetchFields\(/g) ?? [];
    assert.equal(calls.length, 1, "fetchFields ska anropas på exakt ett ställe");
    const selectIndex = hook.indexOf("selectSuggestion");
    assert.ok(selectIndex >= 0 && hook.indexOf(".fetchFields(") > selectIndex);
  });

  it("demo-adresserna är borta ur adressfältet", () => {
    const input = readFileSync(join(here, "../components/address-input.tsx"), "utf8");
    const auto = readFileSync(join(here, "../components/address-autocomplete.tsx"), "utf8");
    for (const src of [input, auto]) {
      assert.doesNotMatch(src, /DEMO_ADDRESSES/);
      assert.doesNotMatch(src, /DemoTag/);
      assert.doesNotMatch(src, /NEXT_PUBLIC_GOOGLE_MAPS_API_KEY/);
      assert.doesNotMatch(src, /Exempeladresser/);
    }
  });

  it("nyckeln läses bara från env i laddaren", () => {
    const loader = readFileSync(join(here, "./places-loader.ts"), "utf8");
    assert.match(loader, /process\.env\.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY/);
    // Ingen nyckel i loggar, ingen hårdkodad nyckel.
    assert.doesNotMatch(loader, /console\.(log|warn|error)/);
    assert.doesNotMatch(loader, /AIza/);
  });

  it("ingen karta, Street View eller geocoding laddas", () => {
    const loader = readFileSync(join(here, "./places-loader.ts"), "utf8");
    assert.match(loader, /importLibrary\("places"\)/);
    assert.doesNotMatch(loader, /importLibrary\("maps"\)/);
    assert.doesNotMatch(loader, /StreetView/);
    assert.doesNotMatch(loader, /Geocoder/);
  });
});
