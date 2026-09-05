process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  HUS_BEGARAN_NS,
  HUS_KOMPONENT_NS,
  HUS_ROT_CATEGORIES,
  HUS_RUT_CATEGORIES,
  HusBegaranError,
  buildHusBegaranXml,
  husBegaranName,
  laborHoursFromLines,
  materialCostFromLines,
  otherCostFromLines,
  personnummerTo12Digits,
  validateHusBegaran,
  type HusArende,
  type HusBegaranInput,
} from "./hus-begaran";
import { labor } from "./invoices/test-db";
import { validateAgainstHusXsd, xmllintAvailable } from "./__fixtures__/hus/xsd";

const TODAY = "2026-09-05";
const FIXTURES = path.join(process.cwd(), "src/lib/__fixtures__/hus");

function fixture(name: string): string {
  return readFileSync(path.join(FIXTURES, name), "utf8");
}

function rotArende(over: Partial<HusArende> = {}): HusArende {
  return {
    kopare: "198505151234",
    betalningsDatum: "2026-08-28",
    prisForArbete: 50_000,
    betaltBelopp: 35_000,
    begartBelopp: 15_000,
    fakturaNr: "1045",
    ovrigKostnad: 2_625,
    bostad: { kind: "fastighet", fastighetsbeteckning: "Södermalm 12:34" },
    utfortArbete: [{ kategori: "Bygg", antalTimmar: 40, materialkostnad: 19_000 }],
    ...over,
  };
}

function rotInput(over: Partial<HusBegaranInput> = {}): HusBegaranInput {
  return { type: "rot", namn: "ROT 2026-09-05", today: TODAY, arenden: [rotArende()], ...over };
}

function assertValidAgainstXsd(xml: string, t: { skip: (msg?: string) => void }) {
  const res = validateAgainstHusXsd(xml);
  if (!res) {
    t.skip("xmllint saknas – XSD-validering hoppas över");
    return;
  }
  assert.ok(res.ok, `Filen validerar inte mot Begaran.xsd:\n${res.output}`);
}

describe("HUS Begäran v6 – gyllene filer", () => {
  it("ROT småhus matchar fixturen exakt", () => {
    assert.equal(buildHusBegaranXml(rotInput()), fixture("rot-smahus.xml"));
  });

  it("ROT bostadsrätt matchar fixturen exakt och sorterar arbetsområden i schemats ordning", () => {
    const xml = buildHusBegaranXml(
      rotInput({
        arenden: [
          rotArende({
            kopare: "197307245428",
            betalningsDatum: "2026-08-20",
            prisForArbete: 12_500,
            betaltBelopp: 8_750,
            begartBelopp: 3_750,
            fakturaNr: "1046",
            ovrigKostnad: 0,
            bostad: { kind: "bostadsratt", lagenhetsNr: "1201", brfOrgNr: "769612-3456" },
            utfortArbete: [
              { kategori: "Vvs", antalTimmar: 3, materialkostnad: 1_200 },
              { kategori: "Bygg", antalTimmar: 12, materialkostnad: 0 },
            ],
          }),
        ],
      })
    );
    assert.equal(xml, fixture("rot-bostadsratt.xml"));
    assert.ok(xml.indexOf("<Bygg>") < xml.indexOf("<Vvs>"), "Bygg före Vvs enligt schemat");
    assert.ok(!xml.includes("Fastighetsbeteckning"));
  });

  it("RUT städning matchar fixturen exakt", () => {
    const xml = buildHusBegaranXml({
      type: "rut",
      namn: "RUT 2026-09-05",
      today: TODAY,
      arenden: [
        {
          kopare: "199506027839",
          betalningsDatum: "2026-08-20",
          prisForArbete: 1_550,
          betaltBelopp: 775,
          begartBelopp: 775,
          fakturaNr: "1047",
          ovrigKostnad: 60,
          utfortArbete: [{ kategori: "Stadning", antalTimmar: 2, materialkostnad: 0 }],
        },
      ],
    });
    assert.equal(xml, fixture("rut-stadning.xml"));
    assert.ok(xml.includes("<HushallBegaran"));
    assert.ok(!xml.includes("RotBegaran"));
  });

  it("gyllene filerna validerar mot Skatteverkets XSD", (t) => {
    if (!xmllintAvailable()) return t.skip("xmllint saknas – XSD-validering hoppas över");
    for (const name of ["rot-smahus.xml", "rot-bostadsratt.xml", "rut-stadning.xml"]) {
      assertValidAgainstXsd(fixture(name), t);
    }
  });

  it("schemats element kommer i sekvensordning och med rätt namespace", () => {
    const xml = buildHusBegaranXml(rotInput());
    assert.ok(xml.includes(`xmlns="${HUS_BEGARAN_NS}"`));
    assert.ok(xml.includes(`<RotBegaran xmlns="${HUS_KOMPONENT_NS}"`));
    const order = [
      "Kopare",
      "BetalningsDatum",
      "PrisForArbete",
      "BetaltBelopp",
      "BegartBelopp",
      "FakturaNr",
      "Ovrigkostnad",
      "Fastighetsbeteckning",
      "UtfortArbete",
      "AntalTimmar",
      "Materialkostnad",
    ];
    const positions = order.map((el) => xml.indexOf(`<${el}>`));
    positions.forEach((p, i) => assert.ok(p > -1, `${order[i]} saknas`));
    for (let i = 1; i < positions.length; i++) assert.ok(positions[i] > positions[i - 1], `${order[i]} i fel ordning`);
  });

  it("escapar specialtecken i text", () => {
    const xml = buildHusBegaranXml(
      rotInput({ arenden: [rotArende({ bostad: { kind: "fastighet", fastighetsbeteckning: "Berg & Dal <1:2>" } })] })
    );
    assert.ok(xml.includes("<Fastighetsbeteckning>Berg &amp; Dal &lt;1:2&gt;</Fastighetsbeteckning>"));
  });
});

describe("HUS Begäran v6 – regler", () => {
  it("ROT och RUT blandas aldrig i samma fil", () => {
    assert.throws(
      () => buildHusBegaranXml(rotInput({ arenden: [rotArende({ utfortArbete: [{ kategori: "Stadning", antalTimmar: 2, materialkostnad: 0 }] })] })),
      (e: unknown) => e instanceof HusBegaranError && /Stadning hör inte till ROT/.test(e.message)
    );
    assert.throws(
      () =>
        buildHusBegaranXml({
          type: "rut",
          namn: "RUT",
          today: TODAY,
          arenden: [rotArende({ bostad: undefined, utfortArbete: [{ kategori: "Bygg", antalTimmar: 2, materialkostnad: 0 }] })],
        }),
      /Bygg hör inte till RUT/
    );
    // Kategorilistorna överlappar inte – ett arbetsområde kan aldrig vara båda.
    for (const c of HUS_ROT_CATEGORIES) assert.ok(!(HUS_RUT_CATEGORIES as readonly string[]).includes(c));
  });

  it("bostad hör bara till ROT och ROT kräver bostad", () => {
    assert.match(validateHusBegaran(rotInput({ arenden: [rotArende({ bostad: undefined })] })).join(" "), /bostad .* saknas/);
    const rut: HusBegaranInput = {
      type: "rut",
      namn: "RUT",
      today: TODAY,
      arenden: [rotArende({ utfortArbete: [{ kategori: "Stadning", antalTimmar: 1, materialkostnad: 0 }] })],
    };
    assert.match(validateHusBegaran(rut).join(" "), /hör bara till ROT/);
  });

  it("e-tjänstens beloppsregler: begärt ≤ betalt och begärt + betalt ≤ arbetskostnad", () => {
    assert.match(
      validateHusBegaran(rotInput({ arenden: [rotArende({ betaltBelopp: 10_000, begartBelopp: 15_000 })] })).join(" "),
      /begärt belopp får inte vara större än betalt/
    );
    assert.match(
      validateHusBegaran(rotInput({ arenden: [rotArende({ prisForArbete: 40_000 })] })).join(" "),
      /får inte överstiga arbetskostnaden/
    );
    assert.deepEqual(validateHusBegaran(rotInput()), []);
  });

  it("betalningsdatum: efter 2009-06-30, aldrig i framtiden, samma år i hela filen", () => {
    assert.match(validateHusBegaran(rotInput({ arenden: [rotArende({ betalningsDatum: "2009-06-30" })] })).join(" "), /efter 2009-06-30/);
    assert.match(validateHusBegaran(rotInput({ arenden: [rotArende({ betalningsDatum: "2026-09-06" })] })).join(" "), /senare än idag/);
    assert.match(
      validateHusBegaran(rotInput({ arenden: [rotArende(), rotArende({ betalningsDatum: "2025-12-30" })] })).join(" "),
      /samma betalningsår/
    );
  });

  it("minst ett arbetsområde, max 100 köpare, namn 1–16 tecken, 12-siffrigt personnummer", () => {
    assert.match(validateHusBegaran(rotInput({ arenden: [rotArende({ utfortArbete: [] })] })).join(" "), /minst ett arbetsområde/);
    assert.match(validateHusBegaran(rotInput({ arenden: Array.from({ length: 101 }, () => rotArende()) })).join(" "), /högst 100/);
    assert.match(validateHusBegaran(rotInput({ arenden: [] })).join(" "), /minst en köpare/);
    assert.match(validateHusBegaran(rotInput({ namn: "Ett alldeles för långt namn" })).join(" "), /1–16 tecken/);
    assert.match(validateHusBegaran(rotInput({ arenden: [rotArende({ kopare: "8505151234" })] })).join(" "), /12 siffror/);
    assert.equal(husBegaranName("rot", TODAY), "ROT 2026-09-05");
    assert.ok(husBegaranName("rut", TODAY).length <= 16);
  });

  it("timmar och material är heltal inom schemats intervall", () => {
    assert.match(
      validateHusBegaran(rotInput({ arenden: [rotArende({ utfortArbete: [{ kategori: "Bygg", antalTimmar: 2.5, materialkostnad: 0 }] })] })).join(" "),
      /heltal mellan 0 och 999/
    );
    assert.match(
      validateHusBegaran(rotInput({ arenden: [rotArende({ utfortArbete: [{ kategori: "Bygg", antalTimmar: 1000, materialkostnad: 0 }] })] })).join(" "),
      /heltal mellan 0 och 999/
    );
    assert.match(
      validateHusBegaran(rotInput({ arenden: [rotArende({ utfortArbete: [{ kategori: "Bygg", antalTimmar: 1, materialkostnad: 10_000_000 }] })] })).join(" "),
      /materialkostnaden/
    );
  });
});

describe("HUS – avläsning ur fakturarader", () => {
  it("timmar läses bara av från timprisade arbetsrader – fast pris ger null, aldrig en gissning", () => {
    assert.equal(laborHoursFromLines([labor({ qty: 40, unit: "tim" })]), 40);
    assert.equal(laborHoursFromLines([labor({ qty: 16, unit: "tim" }), labor({ qty: 24.4, unit: "h" })]), 40);
    assert.equal(laborHoursFromLines([labor({ qty: 1, unit: "st", unitPrice: 40_000 })]), null);
    assert.equal(laborHoursFromLines([labor({ qty: 10, unit: "tim" }), labor({ qty: 1, unit: "st" })]), null);
    assert.equal(laborHoursFromLines([labor({ kind: "material", qty: 3, unit: "tim" })]), null);
    assert.equal(laborHoursFromLines([]), null);
  });

  it("material och övrig kostnad räknas inkl. moms och rör aldrig arbetsraderna", () => {
    const lines = [
      labor({ qty: 40, unit: "tim", unitPrice: 1_000 }),
      labor({ kind: "material", qty: 1, unit: "st", unitPrice: 15_200 }),
      labor({ kind: "resor", qty: 6, unit: "tim", unitPrice: 350 }),
      labor({ kind: "ovrigt", qty: 1, unit: "st", unitPrice: 800 }),
    ];
    assert.equal(materialCostFromLines(lines), 19_000);
    assert.equal(otherCostFromLines(lines), 2_625 + 1_000);
    assert.equal(laborHoursFromLines(lines), 40);
  });

  it("personnummer blir 12 siffror – sekel härleds bara för 10 siffror", () => {
    assert.equal(personnummerTo12Digits("19850515-1234", TODAY), "198505151234");
    assert.equal(personnummerTo12Digits("850515-1234", TODAY), "198505151234");
    assert.equal(personnummerTo12Digits("100101-1234", TODAY), "201001011234");
    assert.equal(personnummerTo12Digits("261231-1234", TODAY), "192612311234");
    assert.equal(personnummerTo12Digits("8505151234", TODAY), "198505151234");
    assert.equal(personnummerTo12Digits("85051512", TODAY), null);
    assert.equal(personnummerTo12Digits("", TODAY), null);
  });
});
