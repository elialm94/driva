process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "../store";
import { emptyTestDb } from "../invoices/test-db";
import { postVerification } from "./engine";
import { generateVatReport, markVatReportDeclared, setVatPeriodicity } from "./vat";
import { generateEmployerDeclaration, runPayroll, saveEmployee } from "./payroll";
import { eskdBytes, eskdForPeriod } from "./eskd";
import { agiForMonth } from "./agi-xml";
import { granskningsperiod, sruBytes, sruForFiscalYear } from "./sru";
import {
  BALANS_CONCEPT,
  ixbrlBlockers,
  ixbrlBytes,
  ixbrlForAnnualReport,
  RESULTAT_CONCEPT,
} from "./ixbrl";
import { advanceAnnualReportStatus, generateAnnualReport, updateAnnualReport } from "./annual-report";
import type { AnnualReport } from "../types";
import { encodeLatin1, FilingDataError, orgNumber12, personnummer12 } from "./filing-format";
import { INK2R_BALANCE, INK2R_RESULT, ruleForAccount } from "./ink2r-model";
import { addCustomAccount, standardAccounts } from "./chart";

/**
 * Myndighetsfilerna: momsdeklaration (eSKD), arbetsgivardeklaration (AGI) och
 * inkomstdeklaration (SRU).
 *
 * En fil som avvisas vid uppladdning är värdelös, och felen som gör att den
 * avvisas är just de som inte syns när man läser filen: fel teckenuppsättning,
 * fel form på organisationsnummret, decimaler i ett belopp, poster i fel
 * ordning. Testerna håller fast formatens hårda krav – och att siffrorna i
 * filen är samma siffror som produkten visar på skärmen.
 */

const YEAR = 2026;
const BANK = 1930;
const FORSALJNING = 3001;
const UTGAENDE_MOMS = 2611;
const INGAENDE_MOMS = 2641;
const INKOP = 5410;

function reset() {
  replaceDb(emptyTestDb());
  const data = db();
  data.settings.name = "Bygg & Co AB";
  data.settings.orgNumber = "556677-8899";
  data.settings.email = "hej@byggco.se";
  data.settings.phone = "08-123 45 67";
  data.settings.address = "Storgatan 1";
  data.settings.postalCode = "123 45";
  data.settings.city = "Stockholm";
  // Migreringen lägger själv upp innevarande år med ett slumpat id. Testerna
  // slår upp året på id, så det byts ut mot ett förutsägbart – inte läggs till,
  // för två räkenskapsår över samma datum är inte ett tillstånd produkten har.
  data.fiscalYears = [{
    id: `fy-${YEAR}`,
    label: String(YEAR),
    startDate: `${YEAR}-01-01`,
    endDate: `${YEAR}-12-31`,
    status: "oppet",
    openingBalances: {},
    openingSource: "migrering",
  }];
  // Bankavstämningen ingår inte i det som testas här.
  data.bankAccounts = [];
}

function sale(date: string, net: number) {
  const vat = Math.round(net * 0.25);
  postVerification({
    date,
    description: "Fakturerat arbete",
    entries: [
      { account: BANK, debit: net + vat },
      { account: FORSALJNING, credit: net },
      { account: UTGAENDE_MOMS, credit: vat },
    ],
    source: { type: "manuell" },
    createdBy: "anvandare",
  });
}

function purchase(date: string, net: number, account = INKOP) {
  const vat = Math.round(net * 0.25);
  postVerification({
    date,
    description: "Inköp",
    entries: [
      { account, debit: net },
      { account: INGAENDE_MOMS, debit: vat },
      { account: BANK, credit: net + vat },
    ],
    source: { type: "manuell" },
    createdBy: "anvandare",
  });
}

/* ------------------------------ Gemensamma regler -------------------------- */

describe("formatens gemensamma regler", () => {
  it("kodar text till ISO 8859-1 och tappar inte de svenska tecknen", () => {
    const bytes = encodeLatin1("Bygg & Co AB, Åsa Öberg i Växjö");
    assert.equal(bytes.byteLength, "Bygg & Co AB, Åsa Öberg i Växjö".length);
    assert.equal(bytes[14], 0xc5); // Å
    assert.equal(bytes[18], 0xd6); // Ö
    assert.ok(bytes.every((b) => b <= 0xff));
  });

  it("ersätter tecken som inte finns i ISO 8859-1 i stället för att kasta", () => {
    const text = new TextDecoder("latin1").decode(encodeLatin1("Firma – Škoda"));
    assert.equal(text, "Firma - Skoda");
  });

  it("organisationsnummer blir tolvsiffrigt med sekelprefix för juridiska personer", () => {
    assert.equal(orgNumber12("556677-8899"), "165566778899");
    assert.equal(orgNumber12("165566778899"), "165566778899");
    assert.throws(() => orgNumber12("55667"), FilingDataError);
  });

  it("personnummer blir tolvsiffrigt utan bindestreck", () => {
    assert.equal(personnummer12("850101-1234"), "198501011234");
    assert.equal(personnummer12("050101-1234"), "200501011234");
  });
});

/* ---------------------------------- eSKD ----------------------------------- */

describe("momsdeklaration som eSKD-fil", () => {
  beforeEach(() => {
    reset();
    setVatPeriodicity("kvartal", "anvandare");
  });

  it("skriver rutorna som taggar med hela kronor och rätt period", () => {
    sale(`${YEAR}-04-10`, 100_000);
    purchase(`${YEAR}-05-12`, 20_000);

    const file = eskdForPeriod(`${YEAR}-K2`);

    assert.match(file.xml, /^<\?xml version="1.0" encoding="ISO-8859-1"\?>/);
    assert.match(file.xml, /<OrgNr>556677-8899<\/OrgNr>/);
    assert.match(file.xml, new RegExp(`<Period>${YEAR}06</Period>`));
    assert.match(file.xml, /<ForsMomsEjAnnan>100000<\/ForsMomsEjAnnan>/);
    assert.match(file.xml, /<MomsUtgHog>25000<\/MomsUtgHog>/);
    assert.match(file.xml, /<MomsIngAvdr>5000<\/MomsIngAvdr>/);
    assert.match(file.xml, /<MomsBetala>20000<\/MomsBetala>/);
    assert.equal(file.attBetala, 20_000);

    // Beloppen är heltal: inga decimaler och inga tusenavgränsare.
    for (const line of file.xml.split("\r\n")) {
      const amount = line.match(/^<[A-Za-z]+>(-?[\d\s.,]+)<\/[A-Za-z]+>$/)?.[1];
      if (amount === undefined) continue;
      assert.match(amount, /^-?\d+$/, `Beloppet ${amount} är inte ett heltal`);
    }
  });

  it("radbryter med CRLF och kodas till ISO 8859-1", () => {
    sale(`${YEAR}-04-10`, 1_000);
    const file = eskdForPeriod(`${YEAR}-K2`);
    assert.ok(file.xml.includes("\r\n"));
    assert.ok(file.xml.endsWith("\r\n"));
    assert.ok(eskdBytes(file).byteLength > 0);
  });

  it("tomma rutor utelämnas men summeringen skrivs alltid", () => {
    const file = eskdForPeriod(`${YEAR}-K1`);
    assert.doesNotMatch(file.xml, /<ForsMomsEjAnnan>/);
    assert.match(file.xml, /<MomsBetala>0<\/MomsBetala>/);
  });

  it("moms att få tillbaka skrivs med minustecken", () => {
    purchase(`${YEAR}-02-12`, 40_000);
    const file = eskdForPeriod(`${YEAR}-K1`);
    assert.match(file.xml, /<MomsBetala>-10000<\/MomsBetala>/);
  });

  it("en deklarerad period ger filen som deklarerades, inte dagens bokföring", () => {
    sale(`${YEAR}-01-15`, 100_000);
    const report = generateVatReport(`${YEAR}-K1`, "anvandare");
    markVatReportDeclared(report.id, "anvandare");

    // En rättelse i efterhand hör till en senare period, inte till filen.
    postVerification({
      date: `${YEAR}-04-02`,
      description: "Rättelse",
      entries: [
        { account: BANK, debit: 1_250 },
        { account: FORSALJNING, credit: 1_000 },
        { account: UTGAENDE_MOMS, credit: 250 },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });

    const file = eskdForPeriod(`${YEAR}-K1`);
    assert.equal(file.fromDeclaredReport, true);
    assert.match(file.xml, /<MomsUtgHog>25000<\/MomsUtgHog>/);
  });

  it("okänd period går inte att bygga en fil av", () => {
    assert.throws(() => eskdForPeriod("2026-K9"), FilingDataError);
  });
});

/* ----------------------------------- AGI ----------------------------------- */

describe("arbetsgivardeklaration som XML-fil", () => {
  beforeEach(() => {
    reset();
    saveEmployee(
      {
        name: "Anna Andersson",
        personnummer: "19850101-1234",
        role: "foretagsledare",
        monthlySalary: 45_000,
        taxBasis: { kind: "procent", percent: 30 },
        startDate: `${YEAR}-01-01`,
      },
      "anvandare"
    );
    runPayroll({ month: `${YEAR}-01` }, "anvandare");
  });

  it("innehåller en huvuduppgift och en individuppgift per anställd", () => {
    const declaration = generateEmployerDeclaration(`${YEAR}-01`, "anvandare");
    const file = agiForMonth(`${YEAR}-01`);

    assert.equal(file.individualCount, 1);
    assert.match(file.xml, /omrade="Arbetsgivardeklaration"/);
    assert.match(file.xml, /<agd:AgRegistreradId faltkod="201">165566778899<\/agd:AgRegistreradId>/);
    assert.match(file.xml, new RegExp(`<agd:RedovisningsPeriod faltkod="006">${YEAR}01</agd:RedovisningsPeriod>`));
    assert.match(
      file.xml,
      new RegExp(`<agd:SummaArbAvgSlf faltkod="487">${declaration.employerContribution}</agd:SummaArbAvgSlf>`)
    );
    assert.match(file.xml, new RegExp(`<agd:SummaSkatteavdr faltkod="497">${declaration.tax}</agd:SummaSkatteavdr>`));
    assert.match(file.xml, /<agd:BetalningsmottagarId faltkod="215">198501011234<\/agd:BetalningsmottagarId>/);
    assert.match(file.xml, /<agd:Specifikationsnummer faltkod="570">1<\/agd:Specifikationsnummer>/);
    assert.match(file.xml, new RegExp(`<agd:KontantErsattningUlagAG faltkod="011">${declaration.gross}</agd:`));
    assert.match(file.xml, new RegExp(`<agd:AvdrPrelSkatt faltkod="001">${declaration.tax}</agd:AvdrPrelSkatt>`));
  });

  it("individuppgiftens specifikationsnummer står still mellan månaderna", () => {
    generateEmployerDeclaration(`${YEAR}-01`, "anvandare");
    runPayroll({ month: `${YEAR}-02` }, "anvandare");
    generateEmployerDeclaration(`${YEAR}-02`, "anvandare");

    const januari = agiForMonth(`${YEAR}-01`).xml;
    const februari = agiForMonth(`${YEAR}-02`).xml;
    const nummer = (xml: string) => xml.match(/faltkod="570">(\d+)</)?.[1];
    assert.equal(nummer(januari), nummer(februari));
  });

  it("en månad utan deklaration går inte att bygga en fil av", () => {
    assert.throws(() => agiForMonth(`${YEAR}-03`), FilingDataError);
  });

  it("kontaktuppgifter måste finnas – filen kräver dem", () => {
    generateEmployerDeclaration(`${YEAR}-01`, "anvandare");
    db().settings.phone = "";
    assert.throws(() => agiForMonth(`${YEAR}-01`), /telefon/);
  });
});

/* ----------------------------------- SRU ----------------------------------- */

describe("inkomstdeklaration 2 som SRU-filer", () => {
  beforeEach(() => {
    reset();
    sale(`${YEAR}-03-10`, 800_000);
    purchase(`${YEAR}-04-12`, 300_000);
  });

  it("INFO.SRU har de obligatoriska posterna i föreskriven ordning", () => {
    const filing = sruForFiscalYear(`fy-${YEAR}`);
    const posts = filing.info
      .trim()
      .split("\r\n")
      .map((line) => line.split(" ")[0]);

    assert.deepEqual(posts, [
      "#DATABESKRIVNING_START",
      "#PRODUKT",
      "#SKAPAD",
      "#PROGRAM",
      "#FILNAMN",
      "#DATABESKRIVNING_SLUT",
      "#MEDIELEV_START",
      "#ORGNR",
      "#NAMN",
      "#ADRESS",
      "#POSTNR",
      "#POSTORT",
      "#EMAIL",
      "#TELEFON",
      "#MEDIELEV_SLUT",
    ]);
    assert.match(filing.info, /#FILNAMN BLANKETTER\.SRU/);
    assert.match(filing.info, /#ORGNR 165566778899/);
  });

  it("BLANKETTER.SRU innehåller de tre blocken i rätt ordning och avslutas", () => {
    const filing = sruForFiscalYear(`fy-${YEAR}`);
    assert.deepEqual(
      filing.blocks.map((b) => b.blankett),
      [`INK2-${YEAR}P4`, `INK2R-${YEAR}P4`, `INK2S-${YEAR}P4`]
    );

    const lines = filing.blanketter.trim().split("\r\n");
    assert.equal(lines[0], `#BLANKETT INK2-${YEAR}P4`);
    assert.match(lines[1], /^#IDENTITET 165566778899 \d{8} \d{6}$/);
    assert.equal(lines[2], "#NAMN Bygg & Co AB");
    assert.equal(lines.at(-1), "#FIL_SLUT");
    assert.equal(lines.filter((l) => l === "#BLANKETTSLUT").length, 3);
    assert.ok(filing.blanketter.endsWith("\r\n"));
    assert.ok(sruBytes(filing.blanketter).byteLength > 0);
  });

  it("varje block börjar med räkenskapsåret och varje fältkod förekommer en gång", () => {
    const filing = sruForFiscalYear(`fy-${YEAR}`);
    for (const block of filing.blocks) {
      assert.equal(block.uppgifter[0].code, "7011");
      assert.equal(block.uppgifter[0].value, `${YEAR}0101`);
      assert.equal(block.uppgifter[1].code, "7012");
      assert.equal(block.uppgifter[1].value, `${YEAR}1231`);

      const codes = block.uppgifter.map((u) => u.code);
      assert.equal(new Set(codes).size, codes.length, `Dubblerad fältkod i ${block.blankett}`);
    }
  });

  it("alla belopp är heltal utan tecken för blankettens riktning", () => {
    const filing = sruForFiscalYear(`fy-${YEAR}`);
    for (const line of filing.blanketter.split("\r\n")) {
      if (!line.startsWith("#UPPGIFT")) continue;
      const value = line.split(" ")[2];
      assert.match(value, /^-?\d+$/, `Beloppet ${value} är inte ett heltal`);
    }
  });

  it("räkenskapsschemat lägger kostnader i kostnadsrutor som positiva belopp", () => {
    const filing = sruForFiscalYear(`fy-${YEAR}`);
    const ink2r = new Map(filing.blocks[1].uppgifter.map((u) => [u.code, Number(u.value)]));

    assert.equal(ink2r.get("7410"), 800_000); // Nettoomsättning
    assert.equal(ink2r.get("7513"), 300_000); // Övriga externa kostnader, positiv i kostnadsrutan
    assert.equal(ink2r.get("7450"), 500_000); // Årets resultat, vinst
    assert.equal(ink2r.has("7550"), false);
  });

  it("räkenskapsschemat balanserar: tillgångar möter eget kapital och skulder", () => {
    const filing = sruForFiscalYear(`fy-${YEAR}`);
    const ink2r = new Map(filing.blocks[1].uppgifter.map((u) => [u.code, Number(u.value)]));
    const sum = (codes: string[]) => codes.reduce((s, c) => s + (ink2r.get(c) ?? 0), 0);

    const tillgangar = sum(["7281", "7251"]);
    const egetKapitalOchSkulder = sum(["7301", "7302", "7369"]);
    assert.equal(tillgangar, egetKapitalOchSkulder);
  });

  it("en förlust hamnar i förlustrutan, inte som negativ vinst", () => {
    purchase(`${YEAR}-06-12`, 700_000);
    const filing = sruForFiscalYear(`fy-${YEAR}`);
    const ink2r = new Map(filing.blocks[1].uppgifter.map((u) => [u.code, Number(u.value)]));
    assert.equal(ink2r.get("7550"), 200_000);
    assert.equal(ink2r.has("7450"), false);
  });

  it("de skattemässiga justeringarna är samma tal som skattemotorns", () => {
    // Ej avdragsgill representation och skattefri ränteintäkt.
    postVerification({
      date: `${YEAR}-09-04`,
      description: "Restaurangbesök med kund",
      entries: [
        { account: 6072, debit: 4_800 },
        { account: BANK, credit: 4_800 },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });
    postVerification({
      date: `${YEAR}-12-20`,
      description: "Intäktsränta skattekonto",
      entries: [
        { account: BANK, debit: 600 },
        { account: 8314, credit: 600 },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });

    const filing = sruForFiscalYear(`fy-${YEAR}`);
    const ink2s = new Map(filing.blocks[2].uppgifter.map((u) => [u.code, Number(u.value)]));

    assert.equal(ink2s.get("7653"), 4_800); // 4.3c ej avdragsgilla kostnader
    assert.equal(ink2s.get("7754"), 600); // 4.5c ej skattepliktiga intäkter, positiv i minusrutan
    assert.equal(ink2s.get("7650"), 495_800); // 4.1 årets resultat, vinst

    // 1.1 på huvudblanketten är samma tal som 4.15 på INK2S.
    const ink2 = new Map(filing.blocks[0].uppgifter.map((u) => [u.code, Number(u.value)]));
    assert.equal(ink2.get("7104"), ink2s.get("8020"));
    assert.equal(ink2s.get("8020"), 495_800 + 4_800 - 600);
  });

  it("bokslutets omföring dubbelräknar inte årets resultat", () => {
    const foreBokslut = new Map(
      sruForFiscalYear(`fy-${YEAR}`).blocks[1].uppgifter.map((u) => [u.code, Number(u.value)])
    );
    // Före bokslutet ligger resultatet inte i eget kapital i bokföringen, men
    // räkenskapsschemat ska ändå visa det där – annars balanserar det inte.
    assert.equal(foreBokslut.get("7450"), 500_000);
    assert.equal(foreBokslut.get("7302"), 500_000);

    // Bokslutets två verifikationer: skatten och omföringen till eget kapital.
    postVerification({
      date: `${YEAR}-12-31`,
      description: "Beräknad bolagsskatt",
      entries: [
        { account: 8910, debit: 103_000 },
        { account: 2512, credit: 103_000 },
      ],
      source: { type: "bokslut", id: `fy-${YEAR}` },
      createdBy: "anvandare",
    });
    postVerification({
      date: `${YEAR}-12-31`,
      description: "Årets resultat",
      entries: [
        { account: 8999, debit: 397_000 },
        { account: 2099, credit: 397_000 },
      ],
      source: { type: "bokslut", id: `fy-${YEAR}` },
      createdBy: "anvandare",
    });

    const efterBokslut = new Map(
      sruForFiscalYear(`fy-${YEAR}`).blocks[1].uppgifter.map((u) => [u.code, Number(u.value)])
    );
    assert.equal(efterBokslut.get("7528"), 103_000); // Skatt på årets resultat
    assert.equal(efterBokslut.get("7450"), 397_000); // Årets resultat efter skatt
    assert.equal(efterBokslut.get("7302"), 397_000); // Räknas en gång, inte två
  });

  it("ett öppet räkenskapsår varnar för att siffrorna kan ändras", () => {
    const filing = sruForFiscalYear(`fy-${YEAR}`);
    assert.ok(filing.warnings.some((w) => w.includes("inte stängt")));
  });

  it("konton utan koppling till en ruta varnas för i stället för att tigas bort", () => {
    // Ett eget konto i en serie kopplingstabellen inte känner.
    addCustomAccount({ number: 4810, name: "Eget kostnadskonto" });
    postVerification({
      date: `${YEAR}-05-02`,
      description: "Bokfört på ett konto utan koppling",
      entries: [
        { account: 4810, debit: 5_000 },
        { account: BANK, credit: 5_000 },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });

    const filing = sruForFiscalYear(`fy-${YEAR}`);
    assert.deepEqual(
      filing.unmappedAccounts.map((u) => u.account),
      [4810]
    );
    assert.ok(filing.warnings.some((w) => w.includes("4810")));
  });

  it("granskningsperioden följer räkenskapsårets sista månad", () => {
    const period = (start: string, end: string) =>
      granskningsperiod({
        id: "fy",
        label: "test",
        startDate: start,
        endDate: end,
        status: "oppet",
        openingBalances: {},
        openingSource: "migrering",
      });

    assert.equal(period("2026-01-01", "2026-12-31").period, "2026P4");
    assert.equal(period("2025-05-01", "2026-04-30").period, "2026P1");
    assert.equal(period("2025-09-01", "2026-08-31").period, "2026P2");
    // Ett brutet år som inte är tolv månader kan tillhöra en annan period.
    assert.ok(period("2026-07-01", "2026-12-31").warning);
  });

  it("enskild firma deklarerar inte på INK2", () => {
    db().settings.companyForm = "enskild";
    assert.throws(() => sruForFiscalYear(`fy-${YEAR}`), /NE-bilagan/);
  });
});

/* ---------------------------------- iXBRL ---------------------------------- */

/**
 * Ett stängt år med föregående år bakom sig, en lönekörning och en
 * årsredovisning som är ifylld, granskad och signerad – alltså den handling som
 * faktiskt lämnas in.
 */
function reportForIxbrl(opts: { intyg?: boolean; signera?: boolean; treAr?: boolean } = {}): AnnualReport {
  const data = db();
  if (opts.treAr) {
    data.fiscalYears.unshift({
      id: `fy-${YEAR - 2}`,
      label: String(YEAR - 2),
      startDate: `${YEAR - 2}-01-01`,
      endDate: `${YEAR - 2}-12-31`,
      status: "oppet",
      openingBalances: {},
      openingSource: "migrering",
    });
    sale(`${YEAR - 2}-08-20`, 450_000);
  }
  data.fiscalYears.unshift({
    id: `fy-${YEAR - 1}`,
    label: String(YEAR - 1),
    startDate: `${YEAR - 1}-01-01`,
    endDate: `${YEAR - 1}-12-31`,
    status: "oppet",
    openingBalances: {},
    openingSource: "migrering",
  });
  sale(`${YEAR - 1}-05-10`, 600_000);
  sale(`${YEAR}-03-10`, 800_000);
  purchase(`${YEAR}-04-12`, 300_000);
  purchase(`${YEAR}-02-03`, 60_000, 1220);
  // En räntekostnad gör rörelseresultatet och resultatet efter finansiella
  // poster till två olika tal – filen ska visa dem som två olika fakta.
  postVerification({
    date: `${YEAR}-06-30`,
    description: "Ränta på banklån",
    entries: [
      { account: 8410, debit: 12_000 },
      { account: BANK, credit: 12_000 },
    ],
    source: { type: "manuell" },
    createdBy: "anvandare",
  });
  saveEmployee(
    {
      name: "Anna Andersson",
      personnummer: "19850101-1234",
      role: "foretagsledare",
      monthlySalary: 45_000,
      taxBasis: { kind: "procent", percent: 30 },
      startDate: `${YEAR}-01-01`,
    },
    "anvandare"
  );
  for (const month of ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]) {
    runPayroll({ month: `${YEAR}-${month}` }, "anvandare");
  }
  for (const fy of data.fiscalYears) fy.status = "stangt";

  const report = generateAnnualReport(`fy-${YEAR}`, "anvandare");
  updateAnnualReport(
    report.id,
    {
      underskrifter: [{ name: "Anna Andersson", role: "Styrelseledamot" }],
      ...(opts.intyg
        ? {
            fastallelseintyg: {
              stammaDate: `${YEAR + 1}-05-14`,
              certifiedByName: "Anna Andersson",
              certifiedByRole: "Styrelseledamot",
            },
          }
        : {}),
    },
    "anvandare"
  );
  if (opts.signera !== false) {
    advanceAnnualReportStatus(report.id, "granskad", "anvandare");
    advanceAnnualReportStatus(report.id, "signerad", "anvandare");
  }
  return report;
}

/**
 * Grov men ärlig kontroll av att dokumentet är välformad XML: taggarna stängs i
 * rätt ordning, attributen är citerade och inga oskyddade &-tecken finns.
 * Bolagsverket avvisar allt annat, och ett dokument som ser rätt ut i en
 * webbläsare kan ändå vara ogiltig XHTML.
 */
function xmlProblems(xml: string): string[] {
  const problems: string[] = [];
  const stack: string[] = [];
  const body = xml.replace(/<\?[^?]*\?>/g, "").replace(/<!DOCTYPE[^>]*>/g, "");
  const tags = body.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g);
  let consumed = 0;
  for (const tag of tags) {
    const between = body.slice(consumed, tag.index);
    if (/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;)/.test(between)) {
      problems.push(`Oskyddat &-tecken före <${tag[2]}>`);
    }
    consumed = tag.index + tag[0].length;
    if (tag[1] === "/") {
      const open = stack.pop();
      if (open !== tag[2]) problems.push(`</${tag[2]}> stänger <${open ?? "inget"}>`);
    } else if (!tag[4]) {
      stack.push(tag[2]);
    }
  }
  // Varje "<" som inte matchades som en tagg är ett trasigt element.
  const matchedLength = [...body.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g)].length;
  if (matchedLength !== (body.match(/</g) ?? []).length) problems.push("Något element går inte att tolka som XML");
  if (stack.length) problems.push(`Ostängda element: ${stack.join(", ")}`);
  return problems;
}

/** Alla numeriska fakta som begrepp → attributtext och skrivet värde. */
function facts(xhtml: string): Map<string, { attrs: string; written: string }[]> {
  const out = new Map<string, { attrs: string; written: string }[]>();
  for (const m of xhtml.matchAll(/<ix:nonFraction ([^>]*)>([^<]*)<\/ix:nonFraction>/g)) {
    const name = m[1].match(/name="([^"]+)"/)?.[1] ?? "";
    const concept = name.split(":")[1] ?? name;
    const list = out.get(concept) ?? [];
    list.push({ attrs: m[1], written: m[2] });
    out.set(concept, list);
  }
  return out;
}

/** Beloppet ett faktum står för, med tecknet ur sign-attributet. */
function factAmount(fact: { attrs: string; written: string }): number {
  const value = Number(fact.written.replace(/\s/g, "").replace(",", "."));
  return /sign="-"/.test(fact.attrs) ? -value : value;
}

describe("årsredovisning som iXBRL-fil", () => {
  beforeEach(reset);

  it("är välformad XHTML med iXBRL 1.1-huvud och utan externa beroenden", () => {
    const file = ixbrlForAnnualReport(reportForIxbrl({ intyg: true }).id);

    assert.deepEqual(xmlProblems(file.xhtml), []);
    assert.match(file.xhtml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
    assert.match(file.xhtml, /xmlns="http:\/\/www.w3.org\/1999\/xhtml"/);
    assert.match(file.xhtml, /xmlns:ix="http:\/\/www.xbrl.org\/2013\/inlineXBRL"/);
    assert.match(file.xhtml, /<meta name="generator" content="Driva" \/>/);
    // Inga script, inga externa stilmallar, inga bilder utifrån (TA 3.4, 3.5, 3.7).
    assert.doesNotMatch(file.xhtml, /<script|onclick=|<link rel="stylesheet"|<img/i);
    assert.match(file.xhtml, /<style type="text\/css">/);
    assert.ok(ixbrlBytes(file).byteLength > 0);
    assert.equal(new TextDecoder().decode(ixbrlBytes(file)), file.xhtml);
  });

  it("pekar på K2-taxonomin för aktiebolag med resultat- och balansräkning", () => {
    const file = ixbrlForAnnualReport(reportForIxbrl({ intyg: true }).id);
    assert.match(file.xhtml, /se-k2-ab-risbs-2024-09-12\.xsd/);
    assert.match(file.xhtml, /se-coa-rplc-2020-12-01\.xsd/);
  });

  it("kontexterna heter period0 och balans0 och saknar segment", () => {
    const file = ixbrlForAnnualReport(reportForIxbrl().id);

    assert.match(file.xhtml, /<xbrli:context id="period0">/);
    assert.match(file.xhtml, /<xbrli:context id="balans0">/);
    assert.match(file.xhtml, new RegExp(`<xbrli:startDate>${YEAR}-01-01</xbrli:startDate>`));
    assert.match(file.xhtml, new RegExp(`<xbrli:instant>${YEAR}-12-31</xbrli:instant>`));
    assert.match(file.xhtml, /<xbrli:identifier scheme="http:\/\/www.bolagsverket.se">5566778899</);
    // Inlämning av enbart årsredovisning: varken segment eller scenario (TA 2.3.1).
    assert.doesNotMatch(file.xhtml, /xbrli:segment|xbrli:scenario/);
  });

  it("jämförelseåret får egna kontexter och jämförelsetalen taggas i dem", () => {
    const file = ixbrlForAnnualReport(reportForIxbrl().id);

    assert.match(file.xhtml, /<xbrli:context id="period1">/);
    assert.match(file.xhtml, /<xbrli:context id="balans1">/);
    // Nettoomsättningen står både i resultaträkningens jämförelsekolumn och i
    // flerårsöversikten. Samma begrepp i samma kontext måste bära samma tal
    // (TA 2.6.1), och det ska taggas på båda ställena (TA 2.6.2).
    const iForegaende = (facts(file.xhtml).get("Nettoomsattning") ?? []).filter((f) =>
      /contextRef="period1"/.test(f.attrs)
    );
    assert.equal(iForegaende.length, 2);
    for (const fact of iForegaende) assert.equal(factAmount(fact), 600_000);
  });

  it("flerårsöversiktens tredje år får en egen kontext i stället för jämförelseårets", () => {
    const file = ixbrlForAnnualReport(reportForIxbrl({ treAr: true }).id);

    assert.match(file.xhtml, new RegExp(`<xbrli:context id="period2">[\\s\\S]*?${YEAR - 2}-01-01`));
    const belopp = new Map(
      (facts(file.xhtml).get("Nettoomsattning") ?? []).map((f) => [
        /contextRef="([^"]+)"/.exec(f.attrs)![1],
        factAmount(f),
      ])
    );
    assert.equal(belopp.get("period0"), 800_000);
    assert.equal(belopp.get("period1"), 600_000);
    assert.equal(belopp.get("period2"), 450_000);
  });

  it("beloppen är hela kronor med sign för de negativa", () => {
    const file = ixbrlForAnnualReport(reportForIxbrl().id);
    const alla = [...facts(file.xhtml).values()].flat();

    for (const fact of alla) {
      if (!/unitRef="SEK"/.test(fact.attrs)) continue;
      assert.match(fact.attrs, /decimals="INF"/);
      assert.match(fact.attrs, /scale="0"/);
      assert.doesNotMatch(fact.written, /[,.]/, `Beloppet ${fact.written} är inte helt`);
      assert.doesNotMatch(fact.written, /-/, "Minustecknet hör i sign-attributet, inte i talet");
    }

    const ranta = facts(file.xhtml).get("RantekostnaderLiknandeResultatposter") ?? [];
    assert.match(ranta[0].attrs, /sign="-"/);
    assert.equal(factAmount(ranta[0]), -12_000);
  });

  it("rörelseresultatet och resultatet efter finansiella poster är två olika fakta", () => {
    const report = reportForIxbrl();
    const file = ixbrlForAnnualReport(report.id);
    const f = facts(file.xhtml);

    const rorelse = factAmount((f.get("Rorelseresultat") ?? [])[0]);
    const efterFinansiella = factAmount((f.get("ResultatEfterFinansiellaPoster") ?? [])[0]);
    assert.equal(efterFinansiella, rorelse - 12_000);

    // Samma tal som årsredovisningen visar på skärmen.
    const row = (label: string) => report.content.resultatrakning.find((r) => r.label === label)?.amount;
    assert.equal(rorelse, row("Rörelseresultat"));
    assert.equal(efterFinansiella, row("Resultat efter finansiella poster"));
  });

  it("varje siffra i uppställningarna är samma siffra som i årsredovisningen", () => {
    const report = reportForIxbrl();
    const f = facts(ixbrlForAnnualReport(report.id).xhtml);
    const c = report.content;

    const check = (rows: typeof c.resultatrakning, concepts: Record<string, string>, contextRef: string) => {
      for (const row of rows) {
        const concept = concepts[row.label];
        if (!concept) continue;
        const fact = (f.get(concept) ?? []).find((x) => new RegExp(`contextRef="${contextRef}"`).test(x.attrs));
        assert.ok(fact, `${row.label} saknar faktum i ${contextRef}`);
        assert.equal(factAmount(fact), Math.round(row.amount) || 0, `${row.label} skiljer sig från rapporten`);
      }
    };
    check(c.resultatrakning, RESULTAT_CONCEPT, "period0");
    check(c.balansrakningTillgangar, BALANS_CONCEPT, "balans0");
    check(c.balansrakningEgetKapitalSkulder, BALANS_CONCEPT, "balans0");
  });

  it("allmän information ligger dold och taggad", () => {
    const file = ixbrlForAnnualReport(reportForIxbrl().id);
    const hidden = file.xhtml.match(/<ix:hidden>[\s\S]*?<\/ix:hidden>/)?.[0] ?? "";

    assert.match(hidden, new RegExp(`RakenskapsarForstaDag[^>]*>${YEAR}-01-01<`));
    assert.match(hidden, new RegExp(`RakenskapsarSistaDag[^>]*>${YEAR}-12-31<`));
    assert.match(hidden, /SprakHandlingUpprattadList[^>]*>se-mem-base:SprakSvenskaMember</);
    assert.match(hidden, /RedovisningsvalutaHandlingList[^>]*>se-mem-base:ValutaSvenskaKronorMember</);
    // Namn och organisationsnummer står synligt i dokumentet.
    assert.match(file.xhtml, /se-cd-base:ForetagetsNamn"[^>]*>Bygg &amp; Co AB</);
    assert.match(file.xhtml, /se-cd-base:Organisationsnummer"[^>]*>556677-8899</);
  });

  it("medelantalet anställda är ett tal med egen enhet, taggat där det står", () => {
    const file = ixbrlForAnnualReport(reportForIxbrl().id);

    assert.match(file.xhtml, /<xbrli:unit id="antal-anstallda"><xbrli:measure>se-k2type:AntalAnstallda</);
    const medel = facts(file.xhtml).get("MedelantaletAnstallda") ?? [];
    assert.equal(medel.length, 1);
    assert.match(medel[0].attrs, /unitRef="antal-anstallda"/);
    assert.equal(medel[0].written, "1,0");
    // Talet står i notens mening, inte i en tabell vid sidan av den.
    assert.match(file.xhtml, /uppgick till <ix:nonFraction[^>]*>1,0<\/ix:nonFraction>/);
  });

  it("medelantalet taggas även i en rapport som upprättades innan talet sparades", () => {
    const report = reportForIxbrl();
    // Rapporter från tidigare versioner bär talet bara i notens mening.
    delete db().annualReports.find((r) => r.id === report.id)!.content.medelantalAnstallda;

    const file = ixbrlForAnnualReport(report.id);
    const medel = facts(file.xhtml).get("MedelantaletAnstallda") ?? [];
    assert.equal(medel.length, 1);
    assert.equal(medel[0].written, "1,0");
    assert.deepEqual(
      file.warnings.filter((w) => /medelantal/i.test(w)),
      []
    );
  });

  it("soliditeten i flerårsöversikten är ett procenttal med scale -2", () => {
    const file = ixbrlForAnnualReport(reportForIxbrl().id);
    const soliditet = facts(file.xhtml).get("Soliditet") ?? [];

    assert.ok(soliditet.length >= 1);
    assert.match(soliditet[0].attrs, /unitRef="procent"/);
    assert.match(soliditet[0].attrs, /scale="-2"/);
    assert.match(file.xhtml, /<xbrli:unit id="procent"><xbrli:measure>xbrli:pure</);
  });

  it("varje företrädare blir en rad i underskriftstabellen med datum", () => {
    const file = ixbrlForAnnualReport(reportForIxbrl().id);

    assert.match(file.xhtml, /<ix:tuple name="se-gen-base:UnderskriftArsredovisningForetradareTuple" tupleID="underskrift-1" \/>/);
    assert.match(file.xhtml, /UnderskriftHandlingTilltalsnamn"[^>]*tupleRef="underskrift-1" order="1.0">Anna</);
    assert.match(file.xhtml, /UnderskriftHandlingEfternamn"[^>]*order="2.0">Andersson</);
    assert.match(file.xhtml, /UndertecknandeDatum"[^>]*order="4.0">\d{4}-\d{2}-\d{2}</);
  });

  it("fastställelseintyget tas bara med när stämman har hållits", () => {
    const utan = ixbrlForAnnualReport(reportForIxbrl().id);
    assert.doesNotMatch(utan.xhtml, /ArsstammaIntygande/);
    assert.doesNotMatch(utan.xhtml, /se-coa-rplc/);

    reset();
    const med = ixbrlForAnnualReport(reportForIxbrl({ intyg: true }).id);
    assert.match(med.xhtml, /se-bol-base:ArsstammaIntygande/);
    assert.match(med.xhtml, new RegExp(`se-bol-base:Arsstamma"[^>]*>${YEAR + 1}-05-14<`));
    assert.match(med.xhtml, /IntygandeOriginalInnehall/);
    assert.match(med.xhtml, /UnderskriftFaststallelseintygForetradareEfternamn"[^>]*>Andersson</);
  });

  it("otaggat innehåll räknas upp i stället för att tigas bort", () => {
    const file = ixbrlForAnnualReport(reportForIxbrl().id);
    assert.ok(file.warnings.length > 0);
    assert.ok(file.warnings.some((w) => /Not \d/.test(w)));
  });

  it("säger vad som saknas innan filen lämnas in", () => {
    const report = reportForIxbrl({ signera: false });
    const blockers = ixbrlBlockers(report);

    assert.ok(blockers.some((b) => b.includes("undertecknandet")));
    assert.ok(blockers.some((b) => b.includes("årsstämman")));

    reset();
    assert.deepEqual(ixbrlBlockers(reportForIxbrl({ intyg: true })), []);
  });

  it("en årsredovisning som inte finns går inte att bygga en fil av", () => {
    assert.throws(() => ixbrlForAnnualReport("finns-inte"), FilingDataError);
  });
});

/* ---------------------------- Kopplingstabellen ---------------------------- */

describe("kopplingen mellan kontoplanen och räkenskapsschemat", () => {
  it("varje konto i Drivas kontoplan har en ruta", () => {
    const utan: number[] = [];
    for (const { number: account } of standardAccounts()) {
      // Årets resultat och enskild firmas eget kapital hör inte till INK2R.
      if (account >= 8990 || (account >= 2010 && account <= 2019)) continue;
      const rules = account < 3000 ? INK2R_BALANCE : INK2R_RESULT;
      if (!ruleForAccount(account, rules)) utan.push(account);
    }
    assert.deepEqual(utan, []);
  });

  it("ingen ruta överlappar en annan – ett konto hör till ett fält", () => {
    for (const rules of [INK2R_BALANCE, INK2R_RESULT]) {
      const seen = new Map<number, string>();
      for (const rule of rules) {
        for (const [from, to] of rule.ranges) {
          for (let account = from; account <= to; account++) {
            const other = seen.get(account);
            assert.equal(other, undefined, `Konto ${account} finns i både ${other} och ${rule.code}`);
            seen.set(account, rule.code);
          }
        }
      }
    }
  });
});
