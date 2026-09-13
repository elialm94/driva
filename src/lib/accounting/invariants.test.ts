process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildScenario } from "../../../scripts/scenario";
import { emptyTestDb } from "../invoices/test-db";
import type { AuditEvent, DB, FiscalYear, Verification, VerificationEntry } from "../types";
import { accountName } from "./chart";
import {
  checkInvariants,
  INVARIANTS,
  verificationContentHash,
  type InvariantKey,
  type InvariantViolation,
} from "./invariants";

/**
 * Invarianterna körs mot båda scenarierna i scripts/scenario.ts:
 *
 *   demo    hela demoföretaget, med bokförda fakturor, kvitton och betalningar
 *   nystart ett nystartat bolag med banken kopplad och ingenting bokfört ännu
 *
 * Utöver det kontrolleras att varje invariant faktiskt fäller ett trasigt
 * tillstånd. En invariant som aldrig kan falla är ingen invariant.
 *
 * Två invarianter är inte gröna i dag, och det är avsiktligt synligt:
 *
 *   (c) kräver att en hash lagras när verifikationen bokförs. Det finns inte i
 *       postVerification, så kontrollen rapporterar "ej verifierbar" i stället
 *       för att tiga. Se todo nedan.
 *   (h) faller på demoseedet: en leverantörsfaktura och betalningen av den
 *       delar source.id. Se todo nedan.
 *
 * Todo-markeringarna pekar på fasen i cursor-prompt-bokforing.md. Filen ligger
 * inte i repot, så fasen namnges i stället för att hänvisa till en sökväg som
 * inte finns.
 */

const YEAR = Number(new Date().toISOString().slice(0, 4));

/**
 * Scenarierna byggs av scripts/scenario.ts, samma tillstånd som
 * `npm run scenario` skriver. Kontrollerna är rena, så tillståndet skickas in
 * som argument i stället för att laddas in i store.
 */
function scenarioDemo(): DB {
  return buildScenario("demo");
}

function scenarioNystart(): DB {
  return buildScenario("nystart");
}

function messages(violations: InvariantViolation[]): string {
  return violations.map((v) => v.message).join("\n");
}

/* ----------------------- Byggstenar för trasiga fall ---------------------- */

function testFiscalYear(over: Partial<FiscalYear> = {}): FiscalYear {
  return {
    id: "fy",
    label: String(YEAR),
    startDate: `${YEAR}-01-01`,
    endDate: `${YEAR}-12-31`,
    status: "oppet",
    openingBalances: {},
    openingSource: "migrering",
    ...over,
  };
}

function rad(account: number, debit: number, credit: number): VerificationEntry {
  return { account, accountName: accountName(account), debit, credit };
}

/**
 * Verifikation byggd för hand. Kontrollerna ska hitta fel som motorn aldrig
 * skulle släppa igenom (obalans, hål i serien), så de går inte att skapa via
 * postVerification.
 */
function ver(over: Partial<Verification> & { number: number; entries: VerificationEntry[] }): Verification {
  const date = over.date ?? `${YEAR}-03-15`;
  return {
    id: `v-${over.number}`,
    series: "A",
    description: "Testpost",
    source: { type: "manuell" },
    confidence: "hog",
    createdBy: "anvandare",
    status: "bokford",
    postedAt: `${date}T12:00:00.000Z`,
    createdAt: `${date}T12:00:00.000Z`,
    fiscalYearId: "fy",
    ...over,
    date,
  };
}

function stateMed(verifications: Verification[], over: Partial<DB> = {}): DB {
  return emptyTestDb({ fiscalYears: [testFiscalYear()], verifications, ...over });
}

function brottFor(data: DB, key: InvariantKey): InvariantViolation[] {
  return checkInvariants(data, { only: [key] }).brott;
}

/* ------------------------------- Scenarier -------------------------------- */

describe("Scenariot nystart uppfyller alla invarianter", () => {
  for (const invariant of INVARIANTS) {
    it(invariant.label, () => {
      const brott = invariant.check(scenarioNystart()).filter((v) => v.severity === "brott");
      assert.equal(brott.length, 0, messages(brott));
    });
  }

  it("utan bokföring finns ingenting som inte kan verifieras heller", () => {
    const data = scenarioNystart();
    assert.equal(data.verifications.length, 0, "nystart ska inte ha någon bokföring");
    const report = checkInvariants(data);
    assert.equal(report.ejVerifierbara.length, 0, messages(report.ejVerifierbara));
    assert.ok(report.ok, messages(report.brott));
  });
});

describe("Scenariot demo uppfyller invarianterna a till g", () => {
  for (const invariant of INVARIANTS) {
    if (invariant.key === "ett_underlag_en_verifikation") continue;
    it(invariant.label, () => {
      const brott = invariant.check(scenarioDemo()).filter((v) => v.severity === "brott");
      assert.equal(brott.length, 0, messages(brott));
    });
  }

  /**
   * (e) var grön på demo av ett skäl som var värt att skriva ned: ingenting i
   * seeden rörde 1630. Preliminärskatten bokfördes med entriesTaxPayment
   * (2510/1930), så skattekontot var orört och kontrollen hade ingenting att
   * jämföra – en grön rad som inte betydde "skattekontot stämmer".
   *
   * Skattekontomodellen (PR #137) bokför F-skatten som 2518/1630 med source
   * skattekonto, så kontrollen är skarp nu. Därför är den här raden ett riktigt
   * saldo i stället: rörelserna finns, var och en kommer från en av de två
   * dokumenterade vägarna, och saldot är ingående balans plus just dem.
   *
   * Inga exakta belopp eller antal pinnas här: F-skatten bokförs en gång per
   * månad fram till todayDate(), så både antalet rörelser och saldot växer med
   * kalendern. Ett hårdkodat tal hade gjort testet beroende av vilken dag det
   * kördes, och det är precis vad en invariant inte ska vara.
   */
  it("(e) skattekontots saldo är ingående balans plus rörelserna via de två vägarna", () => {
    const data = scenarioDemo();
    const nettoPa1630 = (v: Verification) =>
      v.entries.filter((e) => e.account === 1630).reduce((s, e) => s + e.debit - e.credit, 0);
    const viaSkattekontot = (v: Verification) => v.source.type === "skattekonto";
    const viaBanken = (v: Verification) =>
      v.source.type === "banktransaktion" &&
      v.entries.every((e) => e.account === 1630 || (e.account >= 1900 && e.account <= 1999));

    const rorelser = data.verifications.filter((v) => v.entries.some((e) => e.account === 1630));
    assert.ok(rorelser.length > 0, "seeden ska röra 1630 - annars är kontrollen tom igen");
    assert.ok(rorelser.some(viaSkattekontot), "F-skatten ska bokföras med source skattekonto");
    assert.ok(rorelser.some(viaBanken), "bankens överföring till skattekontot ska finnas");
    assert.deepEqual(
      rorelser.filter((v) => !viaSkattekontot(v) && !viaBanken(v)).map((v) => v.description),
      [],
      "varje rörelse på 1630 ska komma via skattekontot eller bankens överföring"
    );

    const ib = data.fiscalYears.reduce((s, fy) => s + (fy.openingBalances["1630"] ?? 0), 0);
    const alla = rorelser.reduce((s, v) => s + nettoPa1630(v), 0);
    const dokumenterade = rorelser
      .filter((v) => viaSkattekontot(v) || viaBanken(v))
      .reduce((s, v) => s + nettoPa1630(v), 0);
    assert.notEqual(alla, 0, "saldot ska vara skilt från noll - annars stämmer det trivialt");
    assert.equal(ib + alla, ib + dokumenterade, "saldot ska förklaras helt av de dokumenterade vägarna");

    // …och invarianten själv ska vara grön på just det saldot.
    const report = checkInvariants(data, { only: ["skattekonto_harleds_ur_rorelserna"] });
    assert.equal(report.brott.length, 0, messages(report.brott));
    assert.equal(report.ejVerifierbara.length, 0, messages(report.ejVerifierbara));
  });

  it("(c) rapporteras som ej verifierbar, inte som godkänd", () => {
    const report = checkInvariants(scenarioDemo(), { only: ["bokford_verifikation_oforandrad"] });
    assert.equal(report.brott.length, 0, messages(report.brott));
    assert.equal(report.ejVerifierbara.length, 1, "kontrollen ska säga att den inte kan utföras");
    assert.match(report.ejVerifierbara[0].message, /saknar en hash från bokföringstillfället/);
  });

  // TODO: (c) håller först när postVerification lagrar hashen som
  // verificationContentHash räknar fram. Ingen fas i cursor-prompt-bokforing.md
  // äger det (Fas 4 Redovisningsvyn är närmast, men handlar om vyerna), och
  // ändringen ligger i src/lib/accounting/engine.ts, alltså produktionskod.
  // Fram till dess är oföränderligheten vaktad av databasens
  // immutabilitetstriggers, inte av den här kontrollen.
  it("(c) varje bokförd verifikation kan jämföras med sin hash från bokföringen", {
    todo: "postVerification lagrar ingen hash ännu, se kommentaren ovan",
  });

  // TODO: (h) faller på demo. Leverantörsfakturan bokförs med
  // source { leverantorsfaktura, id } och betalningen av samma faktura bokförs
  // med exakt samma source, så underlaget bär två verifikationer (seed.ts,
  // services/suppliers.ts och services/supplier-payments.ts). Kravet kommer från
  // Fas 1.1 Skattekontomodellen i cursor-prompt-bokforing.md ("inga två
  // verifikationer har samma source.id"), men fasen skriver bara om F-skatten,
  // inte om leverantörsfakturan. Betalningen behöver ett eget underlag för att
  // invarianten ska hålla. Det är produktionskod och görs inte här.
  it("(h) varje source.id har högst en verifikation, även för leverantörsfakturor", {
    todo: "demoseedet bokför leverantörsfakturan och dess betalning på samma source.id",
  });

  it("(h) faller bara på leverantörsfakturor: mottagen faktura och betalning delar underlag", () => {
    const brott = brottFor(scenarioDemo(), "ett_underlag_en_verifikation");
    assert.ok(brott.length > 0, "det kända brottet finns inte längre, ta bort todo:t ovan");
    for (const v of brott) {
      assert.match(
        v.message,
        /^Underlaget leverantorsfaktura:/,
        `nytt slags dubbelbokfört underlag: ${v.message}`
      );
      assert.equal(v.verificationIds?.length, 2, `fler än två verifikationer på samma underlag: ${v.message}`);
    }
  });
});

/* -------------------- Kontrollerna hittar faktiskt fel -------------------- */

describe("Kontrollerna fäller ett trasigt tillstånd", () => {
  it("(a) obalanserad verifikation", () => {
    const data = stateMed([ver({ number: 1, entries: [rad(1930, 100, 0), rad(3001, 0, 90)] })]);
    const brott = brottFor(data, "verifikation_balanserar");
    assert.equal(brott.length, 1);
    assert.match(brott[0].message, /debet 100 kr, kredit 90 kr/);
  });

  it("(b) hål i nummerserien", () => {
    const data = stateMed([
      ver({ number: 1, entries: [rad(1930, 100, 0), rad(3001, 0, 100)] }),
      ver({ number: 3, entries: [rad(1930, 100, 0), rad(3001, 0, 100)] }),
    ]);
    const brott = brottFor(data, "nummerserie_obruten");
    assert.equal(brott.length, 1);
    assert.match(brott[0].message, /Hål i serie A mellan A1 och A3: 1 nummer saknas/);
  });

  it("(b) verifikation i fel räkenskapsår", () => {
    const data = stateMed(
      [ver({ number: 1, date: `${YEAR}-03-15`, fiscalYearId: "fy-forra", entries: [rad(1930, 100, 0), rad(3001, 0, 100)] })],
      {
        fiscalYears: [
          testFiscalYear(),
          testFiscalYear({
            id: "fy-forra",
            label: String(YEAR - 1),
            startDate: `${YEAR - 1}-01-01`,
            endDate: `${YEAR - 1}-12-31`,
          }),
        ],
      }
    );
    const brott = brottFor(data, "nummerserie_obruten");
    assert.equal(brott.length, 1);
    assert.match(brott[0].message, new RegExp(`ligger i räkenskapsåret ${YEAR - 1} i stället för ${YEAR}`));
  });

  it("(c) ändrat belopp efter bokföringen", () => {
    const original = ver({ number: 1, entries: [rad(1930, 100, 0), rad(3001, 0, 100)] });
    const hash = verificationContentHash(original);
    const orord = { ...original, postedHash: hash } as Verification;
    const andrad = {
      ...original,
      entries: [rad(1930, 900, 0), rad(3001, 0, 900)],
      postedHash: hash,
    } as Verification;

    assert.equal(brottFor(stateMed([orord]), "bokford_verifikation_oforandrad").length, 0);
    const brott = brottFor(stateMed([andrad]), "bokford_verifikation_oforandrad");
    assert.equal(brott.length, 1);
    assert.match(brott[0].message, /har ändrats efter bokföringen/);
  });

  it("(d) moms bokförd på ett momskonto som ingen ruta läser", () => {
    const data = stateMed([
      ver({
        number: 1,
        date: `${YEAR}-02-10`,
        description: "Moms direkt på redovisningskontot",
        entries: [rad(1930, 5_000, 0), rad(2650, 0, 5_000)],
      }),
    ]);
    const brott = brottFor(data, "momsrutor_mot_momskonton");
    assert.equal(brott.length, 1);
    assert.match(brott[0].message, /ruta 49 säger 0 kr men momskontona 26xx ändrades 5000 kr/);
    assert.match(brott[0].message, /2650/);
  });

  it("(d) frysta rutor i momsrapporten avviker från huvudboken", () => {
    const data = stateMed(
      [
        ver({
          number: 1,
          date: `${YEAR}-02-10`,
          description: "Försäljning",
          entries: [rad(1930, 12_500, 0), rad(3001, 0, 10_000), rad(2611, 0, 2_500)],
        }),
      ],
      {
        vatReports: [
          {
            id: "moms-q1",
            fiscalYearId: "fy",
            periodStart: `${YEAR}-01-01`,
            periodEnd: `${YEAR}-03-31`,
            label: `januari-mars ${YEAR}`,
            status: "deklarerad",
            boxes: [
              { code: "05", label: "Momspliktig försäljning", amount: 10_000 },
              { code: "10", label: "Utgående moms 25 %", amount: 2_000 },
              { code: "49", label: "Moms att betala eller få tillbaka", amount: 2_000 },
            ],
            utgaende: 2_000,
            ingaende: 0,
            attBetala: 2_000,
            generatedAt: `${YEAR}-04-01T10:00:00.000Z`,
          },
        ],
      }
    );
    const brott = brottFor(data, "momsrutor_mot_momskonton");
    assert.ok(brott.length >= 2, messages(brott));
    assert.match(messages(brott), /Momsrapporten för januari-mars/);
    assert.match(messages(brott), /Ruta 10 .*rapporten säger 2000 kr, huvudboken 2500 kr/);
  });

  it("(e) något annat än skattekontot rör 1630", () => {
    const data = stateMed([
      ver({
        number: 1,
        description: "Överföring till Skatteverket bokförd för hand",
        entries: [rad(1630, 20_000, 0), rad(1930, 0, 20_000)],
      }),
    ]);
    const brott = brottFor(data, "skattekonto_harleds_ur_rorelserna");
    assert.equal(brott.length, 2, messages(brott));
    assert.match(brott[0].message, /rör konto 1630 .* med 20000 kr men är bokförd som manuell/);
    assert.match(brott[1].message, /Saldot på 1630 är 20000 kr/);
  });

  /**
   * Bankens egen överföring till skattekontot (kind skattekonto i
   * banking/bank-kinds.ts) bokförs som banktransaktion och inte via
   * tax-account.ts. Den är den andra av de två vägar som får röra 1630, så den
   * ska inte fällas. Skillnaden mot testet ovan är bara vem som bokfört.
   */
  it("(e) bankens överföring till skattekontot är en av de två tillåtna vägarna", () => {
    const data = stateMed([
      {
        ...ver({
          number: 1,
          description: "Inbetalning till skattekontot",
          entries: [rad(1630, 20_000, 0), rad(1930, 0, 20_000)],
        }),
        source: { type: "banktransaktion", id: "tx-1" },
      },
    ]);
    assert.equal(brottFor(data, "skattekonto_harleds_ur_rorelserna").length, 0);
  });

  it("(e) en banktransaktion som gör något mer än att flytta pengar till 1630 fälls", () => {
    const data = stateMed([
      {
        ...ver({
          number: 1,
          description: "Banktransaktion som bokar moms mot skattekontot",
          entries: [rad(1630, 20_000, 0), rad(2650, 0, 20_000)],
        }),
        source: { type: "banktransaktion", id: "tx-1" },
      },
    ]);
    const brott = brottFor(data, "skattekonto_harleds_ur_rorelserna");
    assert.equal(brott.length, 2, messages(brott));
    assert.match(brott[0].message, /bokförd som banktransaktion, varken via skattekontot eller som en banköverföring/);
  });

  it("(f) ny verifikation i en låst period", () => {
    const las: AuditEvent = {
      id: "audit-las",
      at: `${YEAR}-04-20T09:00:00.000Z`,
      actor: "anvandare",
      action: "period_last",
      details: `Bokföringen låstes till och med ${YEAR}-03-31.`,
    };
    const efterat = ver({
      number: 1,
      date: `${YEAR}-03-15`,
      description: "Efterbokad kostnad",
      postedAt: `${YEAR}-05-02T08:00:00.000Z`,
      entries: [rad(5410, 800, 0), rad(1930, 0, 800)],
    });
    const data = stateMed([efterat], {
      accounting: { lockedThrough: `${YEAR}-03-31` },
      auditTrail: [las],
    });
    const brott = brottFor(data, "last_period_oforandrad");
    assert.equal(brott.length, 1, messages(brott));
    assert.match(brott[0].message, /i den låsta perioden men bokfördes/);

    // Systemposterna som får bokföras i låst period (momsomföring, skattekonto,
    // bokslut) räknas inte som en ändring av perioden.
    const systempost: Verification = { ...efterat, source: { type: "moms", id: "moms-q1" } };
    const utanBrott = brottFor(
      stateMed([systempost], { accounting: { lockedThrough: `${YEAR}-03-31` }, auditTrail: [las] }),
      "last_period_oforandrad"
    );
    assert.equal(utanBrott.length, 0, messages(utanBrott));
  });

  it("(f) rapporteras som ej verifierbar när låsets tidpunkt saknas", () => {
    const data = stateMed([], { accounting: { lockedThrough: `${YEAR}-03-31` } });
    const report = checkInvariants(data, { only: ["last_period_oforandrad"] });
    assert.equal(report.brott.length, 0);
    assert.equal(report.ejVerifierbara.length, 1);
    assert.match(report.ejVerifierbara[0].message, /saknar händelsen där låset sattes/);
  });

  it("(g) ingående balans som inte summerar till noll", () => {
    const data = stateMed([], {
      fiscalYears: [testFiscalYear({ openingBalances: { "1930": 50_000, "2081": -25_000 } })],
    });
    const brott = brottFor(data, "balansrapporten_balanserar");
    assert.equal(brott.length, 2, messages(brott));
    assert.match(brott[0].message, /Ingående balans för .* summerar till 25000 kr/);
    assert.match(brott[1].message, /Balansrapporten .* går inte ihop/);
  });

  it("(h) samma underlag bokfört två gånger", () => {
    const entries = [rad(4010, 1_000, 0), rad(1930, 0, 1_000)];
    const data = stateMed([
      { ...ver({ number: 1, entries }), source: { type: "utgift", id: "exp-1" } },
      { ...ver({ number: 2, entries }), id: "v-2b", source: { type: "utgift", id: "exp-1" } },
    ]);
    const brott = brottFor(data, "ett_underlag_en_verifikation");
    assert.equal(brott.length, 1, messages(brott));
    assert.match(brott[0].message, /Underlaget utgift:exp-1 har 2 verifikationer/);
  });

  /**
   * createCorrection i engine.ts bokför två verifikationer, återföringen och den
   * nya bokningen, båda med source rattelse och det rättade verifikationens id.
   * Det är rättelsen som modell och inte samma underlag bokfört två gånger.
   */
  it("(h) en rättelse är två verifikationer på samma id och räknas inte som dubbletter", () => {
    const entries = [rad(4010, 1_000, 0), rad(1930, 0, 1_000)];
    const data = stateMed([
      { ...ver({ number: 1, entries }), source: { type: "rattelse", id: "v-0" } },
      { ...ver({ number: 2, entries }), id: "v-2b", source: { type: "rattelse", id: "v-0" } },
    ]);
    assert.equal(brottFor(data, "ett_underlag_en_verifikation").length, 0);
  });

  it("manuella verifikationer utan underlag räknas inte som dubbletter", () => {
    const entries = [rad(4010, 1_000, 0), rad(1930, 0, 1_000)];
    const data = stateMed([ver({ number: 1, entries }), { ...ver({ number: 2, entries }), id: "v-2b" }]);
    assert.equal(brottFor(data, "ett_underlag_en_verifikation").length, 0);
  });
});

describe("Registret över invarianter", () => {
  it("täcker alla åtta invarianter, en gång var", () => {
    const keys = INVARIANTS.map((i) => i.key);
    assert.equal(keys.length, 8);
    assert.equal(new Set(keys).size, 8, "samma invariant är registrerad två gånger");
    for (const invariant of INVARIANTS) {
      assert.ok(invariant.label.length > 0, `${invariant.key} saknar rubrik`);
    }
  });

  it("checkInvariants kör bara det urval som efterfrågas", () => {
    const data = stateMed([ver({ number: 1, entries: [rad(1930, 100, 0), rad(3001, 0, 90)] })]);
    const report = checkInvariants(data, { only: ["ett_underlag_en_verifikation"] });
    assert.equal(report.perInvariant.verifikation_balanserar.length, 0, "obalansen skulle inte ha kontrollerats");
    assert.ok(report.ok);
    assert.equal(checkInvariants(data).ok, false, "hela körningen ska se obalansen");
  });
});
