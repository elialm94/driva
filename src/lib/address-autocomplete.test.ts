import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADDRESS_LANGUAGE,
  ADDRESS_MENU_Z_INDEX,
  ADDRESS_PLACE_FIELDS,
  ADDRESS_PLACES_LOAD_TIMEOUT_MS,
  ADDRESS_PRIMARY_TYPES,
  ADDRESS_REGION_CODES,
  ADDRESS_SEARCH_DEBOUNCE_MS,
  ADDRESS_SEARCH_MIN_CHARS,
  applyPickedAddress,
  demoAddressSuggestions,
  formatAddressLine,
  googleMapsApiKey,
  partsFromPlaceComponents,
  shouldSearchAddress,
  trimmedAddressQuery,
} from "./address-autocomplete";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("address autocomplete helpers", () => {
  it("kräver tre meningsfulla tecken och ignorerar blanksteg", () => {
    assert.equal(ADDRESS_SEARCH_MIN_CHARS, 3);
    assert.equal(trimmedAddressQuery("  va  "), "va");
    assert.equal(shouldSearchAddress("va"), false);
    assert.equal(shouldSearchAddress("  va  "), false);
    assert.equal(shouldSearchAddress("vad"), true);
    assert.equal(shouldSearchAddress("  Väd  "), true);
  });

  it("debounce ligger i 200–300 ms", () => {
    assert.ok(ADDRESS_SEARCH_DEBOUNCE_MS >= 200 && ADDRESS_SEARCH_DEBOUNCE_MS <= 300);
  });

  it("bygger gata + postnummer + ort från Places-komponenter", () => {
    const parts = partsFromPlaceComponents([
      { longText: "Folkungagatan", types: ["route"] },
      { longText: "62", types: ["street_number"] },
      { longText: "116 22", types: ["postal_code"] },
      { longText: "Stockholm", types: ["postal_town"] },
      { longText: "Södermalm", types: ["sublocality"] },
    ]);
    assert.deepEqual(parts, {
      address: "Folkungagatan 62",
      postalCode: "116 22",
      city: "Stockholm",
    });
  });

  it("faller tillbaka till locality när postal_town saknas", () => {
    const parts = partsFromPlaceComponents([
      { longText: "Vasagatan", types: ["route"] },
      { longText: "33", types: ["street_number"] },
      { longText: "Göteborg", types: ["locality"] },
    ]);
    assert.equal(parts.address, "Vasagatan 33");
    assert.equal(parts.city, "Göteborg");
    assert.equal(parts.postalCode, "");
  });

  it("demo-förslag kräver 3 tecken och matchar svensk exempelgata", () => {
    assert.deepEqual(demoAddressSuggestions("va"), []);
    const hits = demoAddressSuggestions("väd");
    assert.equal(hits.length, 1);
    assert.deepEqual(hits[0], {
      address: "Vädursvägen 13",
      postalCode: "141 43",
      city: "Huddinge",
    });
  });

  it("Places (New) är Sverige-biasad och bara adresstyper", () => {
    assert.deepEqual([...ADDRESS_PRIMARY_TYPES], ["premise", "subpremise", "street_address", "route"]);
    assert.deepEqual([...ADDRESS_REGION_CODES], ["se"]);
    assert.equal(ADDRESS_LANGUAGE, "sv-SE");
    assert.deepEqual([...ADDRESS_PLACE_FIELDS], ["addressComponents"]);
    assert.ok(ADDRESS_MENU_Z_INDEX > 80);
    assert.ok(ADDRESS_PLACES_LOAD_TIMEOUT_MS >= 3000 && ADDRESS_PLACES_LOAD_TIMEOUT_MS <= 15_000);
    assert.equal(typeof googleMapsApiKey(), "string");
  });

  it("formaterar enradig adress utan att kräva place_id", () => {
    assert.equal(
      formatAddressLine({ address: "Renstiernas gata 12", postalCode: "116 28", city: "Stockholm" }),
      "Renstiernas gata 12, 116 28 Stockholm"
    );
    assert.equal(formatAddressLine({ address: "Gatan 1", postalCode: "", city: "" }), "Gatan 1");
  });

  it("valt förslag skriver över gata, postnummer och ort – inte bara gatan", () => {
    const picked = applyPickedAddress(
      { address: "Vädursvägen 13", postalCode: "14143", city: "Huddinge" },
      "Vädursvägen 13"
    );
    assert.deepEqual(picked, {
      address: "Vädursvägen 13",
      postalCode: "141 43",
      city: "Huddinge",
    });
  });

  it("låter inte ett gammalt postnummer ligga kvar när förslaget har ny postort", () => {
    const current = { address: "Åsögatan 114", postalCode: "116 24", city: "" };
    const picked = applyPickedAddress(
      { address: "Vädursvägen 13", postalCode: "141 43", city: "Huddinge" },
      "Vädursvägen 13"
    );
    assert.notEqual(picked.postalCode, current.postalCode);
    assert.equal(picked.city, "Huddinge");
  });
});

describe("AddressAutocomplete-klienten", () => {
  const source = readFileSync(join(root, "src/components/address-input.tsx"), "utf8");

  it("använder session token och hämtar details bara efter val", () => {
    assert.match(source, /AutocompleteSessionToken/);
    assert.match(source, /sessionRef\.current = null/);
    assert.match(source, /resolve: async \(\) => \{[\s\S]*fetchFields\(\{ fields: \[\.\.\.ADDRESS_PLACE_FIELDS\] \}\)/);
    assert.match(source, /includedPrimaryTypes: \[\.\.\.ADDRESS_PRIMARY_TYPES\]/);
    assert.match(source, /async function pick[\s\S]*await s\.resolve\(\)/);
    assert.match(source, /void pick\(s\)/);
  });

  it("pick skriver inte gatan ensam innan postnr/ort är klara", () => {
    assert.match(source, /applyPickedAddress/);
    assert.doesNotMatch(source, /setStreet\(s\.main\)/);
    assert.match(source, /if \(onSelect\) onSelect\(complete\);\s*else onChange\?\.\(filled\);/);
    assert.doesNotMatch(source, /selected\.postalCode \|\| parts\.postalCode/);
  });

  it("startar inte Places från ett redan sparat värde", () => {
    assert.doesNotMatch(source, /useEffect\(\(\) => \{\s*void search\(/);
    assert.match(source, /onAddressChange/);
  });

  it("hindrar Enter från att skicka formuläret när listan är öppen eller sökning pågår", () => {
    assert.match(source, /e\.key === "Enter" && \(open \|\| searching\)/);
    assert.match(source, /e\.preventDefault\(\)/);
    assert.match(source, /e\.stopPropagation\(\)/);
  });

  it("faller tillbaka till exempeladresser i demo och utan nyckel", () => {
    assert.match(source, /isDemoSurface/);
    assert.match(source, /demoAddressSuggestions/);
    assert.match(source, /googleMapsApiKey/);
    assert.match(source, /ADDRESS_PLACES_LOAD_TIMEOUT_MS/);
    assert.match(source, /referrerPolicy = "origin"/);
  });

  it("portalerar förslagsmenyn ovanpå Ny kund-modalen", () => {
    assert.match(source, /ADDRESS_MENU_Z_INDEX/);
    assert.match(source, /data-address-suggestions/);
    assert.match(source, /createPortal/);
  });
});

describe("alla redigerbara adressfält använder den delade komponenten", () => {
  const consumers = [
    "src/components/new-customer-modal.tsx",
    "src/components/customer-details-form.tsx",
    "src/components/customer-rot-section.tsx",
    "src/components/settings-form.tsx",
    "src/components/settings-billing-readiness.tsx",
    "src/app/onboarding/onboarding-form.tsx",
    "src/components/uppdrag-form.tsx",
    "src/components/tax-reduction-application.tsx",
  ];

  for (const rel of consumers) {
    it(rel, () => {
      const src = readFileSync(join(root, rel), "utf8");
      assert.match(src, /from ["'].*address-input["']/);
    });
  }

  it("Inställningar använder AddressFields med Gatuadress", () => {
    const src = readFileSync(join(root, "src/components/settings-form.tsx"), "utf8");
    assert.match(src, /<AddressFields/);
    assert.match(src, /label="Gatuadress"/);
    assert.match(src, /installningar-address/);
    assert.match(src, /installningar-postalCode/);
    assert.match(src, /installningar-city/);
  });
});
