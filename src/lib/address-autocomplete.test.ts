import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADDRESS_SEARCH_DEBOUNCE_MS,
  ADDRESS_SEARCH_MIN_CHARS,
  demoAddressSuggestions,
  formatAddressLine,
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
    const hits = demoAddressSuggestions("Vädu");
    assert.equal(hits.length, 1);
    assert.deepEqual(hits[0], {
      address: "Vädursvägen 13",
      postalCode: "141 43",
      city: "Huddinge",
    });
  });

  it("formaterar enradig adress utan att kräva place_id", () => {
    assert.equal(
      formatAddressLine({ address: "Renstiernas gata 12", postalCode: "116 28", city: "Stockholm" }),
      "Renstiernas gata 12, 116 28 Stockholm"
    );
    assert.equal(formatAddressLine({ address: "Gatan 1", postalCode: "", city: "" }), "Gatan 1");
  });
});

describe("AddressAutocomplete-klienten", () => {
  const source = readFileSync(join(root, "src/components/address-input.tsx"), "utf8");

  it("använder session token och hämtar details bara efter val", () => {
    assert.match(source, /AutocompleteSessionToken/);
    assert.match(source, /sessionRef\.current = null/);
    assert.match(source, /resolve: async \(\) => \{[\s\S]*fetchFields\(\{ fields: \["addressComponents"\] \}\)/);
    assert.match(source, /async function pick[\s\S]*await s\.resolve\(\)/);
    assert.match(source, /void pick\(s\)/);
  });

  it("startar inte Places från ett redan sparat värde", () => {
    assert.doesNotMatch(source, /useEffect\(\(\) => \{\s*void search\(/);
    assert.match(source, /onAddressChange/);
  });

  it("hindrar Enter från att skicka formuläret när listan är öppen", () => {
    assert.match(source, /e\.key === "Enter"/);
    assert.match(source, /e\.preventDefault\(\)/);
  });

  it("faller tillbaka till exempeladresser i demo och utan nyckel", () => {
    assert.match(source, /isDemoSurface/);
    assert.match(source, /demoAddressSuggestions/);
    assert.match(source, /NEXT_PUBLIC_GOOGLE_MAPS_API_KEY/);
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
});
