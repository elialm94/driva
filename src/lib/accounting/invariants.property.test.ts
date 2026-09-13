process.env.DRIVA_TEST = "1";

/**
 * Egenskapsbaserat test av bokföringens invarianter.
 *
 * Idén: invarianterna i `invariants.ts` ska hålla efter VARJE affärshändelse,
 * inte bara i demoseedet och inte bara i den ordning ett handskrivet test råkar
 * välja. Testet genererar därför slumpade sekvenser av 20 till 200 händelser,
 * kör dem mot en färsk nystart-lagring genom appens vanliga tjänstefunktioner,
 * och kör alla invarianter efter varje händelse.
 *
 * Regler som testet lyder:
 *
 *   * Bokföring sker bara genom tjänstelagret (som i sin tur går genom
 *     `postVerification`). Testet skriver aldrig i `db().verifications` och
 *     bygger aldrig egna verifikationer.
 *   * Testet rättar ingenting. Hittas ett brott rapporteras det, med den
 *     minsta sekvens fast-check kunnat krympa fram. Ingen produktionskod och
 *     ingen invariant justeras för att få testet grönt.
 *   * En tjänstefunktion som vägrar av ett dokumenterat skäl ("perioden är inte
 *     slut ännu", "fakturan är redan betald") är inte ett brott. Den händelsen
 *     hoppas över och sekvensen fortsätter - det är så appen beter sig när en
 *     användare klickar på något som inte går.
 *
 * Antal körningar: 50 lokalt, 500 med DRIVA_DEEP=1.
 *
 * Vad scenariot INTE kan pröva: nystart-bolaget startar 2026-09-01, första
 * räkenskapsåret slutar 2027-08-31 och momsen är helårsmoms. Både
 * momsdeklarationen (`markVatReportDeclared`) och bokslutet (`closeFiscalYear`)
 * kräver att perioden respektive året har tagit slut, och en sekvens som utgår
 * från dagens datum kan inte flytta tiden framåt. Händelserna "momsperiod
 * deklareras", "år stängs" och "år öppnas igen" blir därför alltid avvisade -
 * de finns i generatorn men bidrar inte till täckningen. Sista testet i filen
 * skriver ut täckningen per händelsetyp så det aldrig är dolt.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { buildScenario } from "../../../scripts/scenario";
import { checkInvariants, INVARIANTS, invariantLabel, type InvariantKey, type InvariantViolation } from "./invariants";
import { db, replaceDb } from "../store";
import { EXPENSE_CATEGORIES } from "../bas";
import { BANK_KINDS } from "../banking/bank-kinds";
import { createCustomer } from "../services/customers";
import { createInvoice, issueInvoice, registerInvoicePayment } from "../services/invoices";
import { invoiceOutstanding } from "../services/data";
import { bookExpense, createExpenseFromKnownReceipt } from "../services/expenses";
import { bookBankTransactionAs } from "../services/bank-booking";
import { postVerificationCorrection } from "../services/verification-correction";
import { generateVatReport, markVatReportDeclared, vatPeriods } from "./vat";
import { bookFSkatt } from "./tax-account";
import { closePeriod, nextMonthToClose } from "./period-close";
import { closeFiscalYear, reopenFiscalYear } from "./close";
import { fiscalYears } from "./fiscal";
import type { DocLine, RotRut } from "../types";

/* ------------------------------ Händelserna ------------------------------- */

const VAT_RATES = [0, 6, 12, 25] as const;
const LINE_KINDS = ["arbete", "material", "resor", "ovrigt"] as const;

interface GenLine {
  kindIndex: number;
  qtyQuarters: number;
  unitPrice: number;
  vatRateIndex: number;
}

type Event =
  | { t: "kundfaktura_skapas"; kundIndex: number; lines: GenLine[]; rotVal: number }
  | { t: "kundfaktura_betalas"; fakturaIndex: number; andelProcent: number }
  | { t: "kvitto_bokfors"; leverantorIndex: number; belopp: number; momssatsIndex: number; kategoriIndex: number }
  | { t: "banktransaktion_bokfors"; txIndex: number; typIndex: number }
  | { t: "momsperiod_deklareras"; periodIndex: number }
  | { t: "fskatt_bokfors"; manadIndex: number; belopp: number }
  | { t: "manad_stangs" }
  | { t: "verifikation_rattas"; verIndex: number; kategoriIndex: number }
  | { t: "ar_stangs"; arIndex: number }
  | { t: "ar_oppnas_igen"; arIndex: number };

const LEVERANTORER = ["Bauhaus", "Beijer Bygg", "Circle K", "Ahlsell", "Dahl", "Optimera"];

const genLine: fc.Arbitrary<GenLine> = fc.record({
  kindIndex: fc.nat({ max: LINE_KINDS.length - 1 }),
  qtyQuarters: fc.integer({ min: 1, max: 160 }),
  unitPrice: fc.integer({ min: 1, max: 60_000 }),
  vatRateIndex: fc.nat({ max: VAT_RATES.length - 1 }),
});

const genEvent: fc.Arbitrary<Event> = fc.oneof(
  fc.record({
    t: fc.constant("kundfaktura_skapas" as const),
    kundIndex: fc.nat({ max: 40 }),
    lines: fc.array(genLine, { minLength: 1, maxLength: 5 }),
    rotVal: fc.nat({ max: 2 }),
  }),
  fc.record({
    t: fc.constant("kundfaktura_betalas" as const),
    fakturaIndex: fc.nat({ max: 60 }),
    andelProcent: fc.integer({ min: 1, max: 100 }),
  }),
  fc.record({
    t: fc.constant("kvitto_bokfors" as const),
    leverantorIndex: fc.nat({ max: LEVERANTORER.length - 1 }),
    belopp: fc.integer({ min: 1, max: 40_000 }),
    momssatsIndex: fc.nat({ max: VAT_RATES.length - 1 }),
    kategoriIndex: fc.nat({ max: EXPENSE_CATEGORIES.length - 1 }),
  }),
  fc.record({
    t: fc.constant("banktransaktion_bokfors" as const),
    txIndex: fc.nat({ max: 200 }),
    typIndex: fc.nat({ max: BANK_KINDS.length - 1 }),
  }),
  fc.record({ t: fc.constant("momsperiod_deklareras" as const), periodIndex: fc.nat({ max: 8 }) }),
  fc.record({
    t: fc.constant("fskatt_bokfors" as const),
    manadIndex: fc.nat({ max: 13 }),
    belopp: fc.integer({ min: 1, max: 30_000 }),
  }),
  fc.record({ t: fc.constant("manad_stangs" as const) }),
  fc.record({
    t: fc.constant("verifikation_rattas" as const),
    verIndex: fc.nat({ max: 200 }),
    kategoriIndex: fc.nat({ max: EXPENSE_CATEGORIES.length - 1 }),
  }),
  fc.record({ t: fc.constant("ar_stangs" as const), arIndex: fc.nat({ max: 3 }) }),
  fc.record({ t: fc.constant("ar_oppnas_igen" as const), arIndex: fc.nat({ max: 3 }) })
);

const genSequence = fc.array(genEvent, { minLength: 20, maxLength: 200 });

/* --------------------------- Körning av händelser -------------------------- */

/**
 * En händelse gjorde ingenting: tjänstefunktionen vägrade av ett dokumenterat
 * skäl, eller det fanns inget att arbeta på (ingen obokad transaktion kvar).
 * Det är inte ett brott mot en invariant.
 */
const HOPPADES_OVER = Symbol("hoppades över");

/**
 * Täckning per händelsetyp över alla körningar. Utan den ser ett grönt test ut
 * som om alla tio händelsetyperna hade prövats, och det gör de inte: nystart-
 * scenariots räkenskapsår slutar 2027-08-31 och momsen är helårsmoms, så
 * momsdeklaration och bokslut kan inte äga rum i en sekvens som utgår från idag.
 * Summeringen skrivs ut efter testerna så det aldrig är dolt vad som verkligen
 * kördes.
 */
const tackning = new Map<Event["t"], { utford: number; hoppad: number; skal: Map<string, number> }>();

function raknaTackning(kind: Event["t"], utford: boolean, skal?: string): void {
  let rad = tackning.get(kind);
  if (!rad) {
    rad = { utford: 0, hoppad: 0, skal: new Map() };
    tackning.set(kind, rad);
  }
  if (utford) {
    rad.utford++;
    return;
  }
  rad.hoppad++;
  if (skal) rad.skal.set(skal, (rad.skal.get(skal) ?? 0) + 1);
}

/** Plocka ur en lista med ett genererat index, oavsett listans längd. */
function pick<T>(list: T[], index: number): T | undefined {
  if (list.length === 0) return undefined;
  return list[index % list.length];
}

function lineOf(gen: GenLine, i: number): DocLine {
  return {
    id: `rad-${i}`,
    kind: LINE_KINDS[gen.kindIndex],
    description: "Genererad rad",
    qty: gen.qtyQuarters / 4,
    unit: "st",
    unitPrice: gen.unitPrice,
    vatRate: VAT_RATES[gen.vatRateIndex],
  };
}

/** Momsen på ett bruttobelopp vid en given momssats, i hela kronor. */
function vatOfGross(gross: number, rate: number): number {
  if (rate === 0) return 0;
  return Math.min(gross - 1, Math.round((gross * rate) / (100 + rate)));
}

/**
 * Utför en händelse genom tjänstelagret. Returnerar HOPPADES_OVER när
 * tjänsten vägrade - felet bubblar bara upp om det inte är en vägran, för då är
 * det en krasch och inte en spärr.
 */
function utfor(event: Event): typeof HOPPADES_OVER | void {
  const data = db();
  switch (event.t) {
    case "kundfaktura_skapas": {
      // Kunden skapas genom kundtjänsten första gången indexet pekar utanför
      // listan, så sekvensen kan växa kundregistret utan att skriva i lagret.
      let customer = pick(data.customers, event.kundIndex);
      if (!customer || event.kundIndex >= data.customers.length) {
        const nr = data.customers.length + 1;
        customer = createCustomer({
          kind: "foretag",
          name: `Kund ${nr} AB`,
          orgNumber: "556677-8899",
          email: `kund${nr}@exempel.se`,
          // Fakturering kräver en fullständig adress (assertInvoiceReadyToIssue),
          // så kunden skapas som en kund appen faktiskt kan fakturera.
          address: `Testgatan ${nr}`,
          postalCode: "118 20",
          city: "Stockholm",
        });
      }
      const rot: RotRut | null = event.rotVal === 0 ? null : { type: event.rotVal === 1 ? "rot" : "rut" };
      const invoice = createInvoice({
        customerId: customer.id,
        type: "faktura",
        lines: event.lines.map(lineOf),
        // ROT/RUT kräver personnummer och bostad på företagskunder, så
        // generatorn håller sig till vanlig faktura när kunden är ett företag.
        rot: customer.kind === "privat" ? rot : null,
      });
      issueInvoice(invoice.id);
      return;
    }
    case "kundfaktura_betalas": {
      const oppna = data.invoices.filter((i) => invoiceOutstanding(i) > 0 && i.status !== "utkast");
      const invoice = pick(oppna, event.fakturaIndex);
      if (!invoice) return HOPPADES_OVER;
      const kvar = invoiceOutstanding(invoice);
      const belopp =
        event.andelProcent >= 100 ? kvar : Math.max(1, Math.min(kvar, Math.round((kvar * event.andelProcent) / 100)));
      registerInvoicePayment(invoice.id, { amount: belopp, matchedBy: "manuell" });
      return;
    }
    case "kvitto_bokfors": {
      const leverantor = LEVERANTORER[event.leverantorIndex];
      const momssats = VAT_RATES[event.momssatsIndex];
      const { expense } = createExpenseFromKnownReceipt({
        supplier: leverantor,
        amount: event.belopp,
        vatAmount: vatOfGross(event.belopp, momssats),
        date: new Date().toISOString().slice(0, 10),
        description: "Genererat kvitto",
        source: "email",
      });
      // Kvittoflödet bokför själv när matchningen är entydig. Är köpet redan
      // bokfört finns inget kvar att göra här.
      const aktuell = db().expenses.find((e) => e.id === expense.id);
      if (!aktuell || aktuell.status === "bokford") return HOPPADES_OVER;
      bookExpense(aktuell, EXPENSE_CATEGORIES[event.kategoriIndex].key, "hog", "anvandare");
      return;
    }
    case "banktransaktion_bokfors": {
      const obokade = data.bankTransactions.filter((t) => t.status === "ny");
      const tx = pick(obokade, event.txIndex);
      if (!tx) return HOPPADES_OVER;
      const kind = BANK_KINDS[event.typIndex];
      // "Redan bokförd" kräver en verifikation att peka på och är ingen egen
      // bokföringshändelse - den utelämnas.
      if (kind.key === "redan_bokford") return HOPPADES_OVER;
      bookBankTransactionAs(tx.id, { kind: kind.key, by: "anvandare", remember: false });
      return;
    }
    case "momsperiod_deklareras": {
      const perioder = vatPeriods().filter((p) => p.state === "att_deklarera");
      const period = pick(perioder, event.periodIndex);
      if (!period) return HOPPADES_OVER;
      const report = generateVatReport(period.period.key);
      if (report.status === "deklarerad") return HOPPADES_OVER;
      markVatReportDeclared(report.id, "anvandare");
      return;
    }
    case "fskatt_bokfors": {
      const fy = fiscalYears()[0];
      if (!fy) return HOPPADES_OVER;
      // Månaderna räknas från räkenskapsårets start, så F-skatten hamnar i ett
      // år som finns.
      const start = new Date(`${fy.startDate}T12:00:00.000Z`);
      start.setUTCMonth(start.getUTCMonth() + event.manadIndex);
      const manad = start.toISOString().slice(0, 7);
      bookFSkatt(manad, "anvandare", event.belopp);
      return;
    }
    case "manad_stangs": {
      const nasta = nextMonthToClose();
      if (!nasta) return HOPPADES_OVER;
      closePeriod(nasta.period.key, "anvandare");
      return;
    }
    case "verifikation_rattas": {
      // Bara verifikationer som inte redan är rättade kan rättas.
      const kandidater = data.verifications.filter((v) => !v.correctedByVerificationId);
      const ver = pick(kandidater, event.verIndex);
      if (!ver) return HOPPADES_OVER;
      postVerificationCorrection(
        ver.id,
        { kind: "konto", category: EXPENSE_CATEGORIES[event.kategoriIndex].key, reason: "Fel konto vid bokföringen" },
        "anvandare"
      );
      return;
    }
    case "ar_stangs": {
      const ar = pick(
        fiscalYears().filter((f) => f.status === "oppet"),
        event.arIndex
      );
      if (!ar) return HOPPADES_OVER;
      closeFiscalYear(ar.id, "anvandare");
      return;
    }
    case "ar_oppnas_igen": {
      const ar = pick(
        fiscalYears().filter((f) => f.status === "stangt"),
        event.arIndex
      );
      if (!ar) return HOPPADES_OVER;
      reopenFiscalYear(ar.id, "Rättelse efter att en faktura hittades efter bokslutet", "anvandare");
      return;
    }
  }
}

/**
 * Är felet en dokumenterad vägran från tjänstelagret, eller en krasch?
 *
 * Vägran = tjänsten sa nej till en händelse som inte får ske just nu
 * (perioden är inte slut, fakturan är redan betald, transaktionstypen passar
 * inte riktningen). Det är app-beteende och inget att rapportera.
 *
 * Allt annat - TypeError, "Cannot read properties of undefined" och liknande -
 * är en krasch och rapporteras som ett fel i sekvensen.
 */
const KRASCHKLASSER = new Set(["TypeError", "RangeError", "ReferenceError", "SyntaxError"]);

function arVagran(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // Domänfelen (PostingError, PeriodCloseError, InvoiceNotReadyError,
  // CustomerValidationError och de vanliga Error med svensk text) är vägran.
  // JS-körningsfel är kraschar och rapporteras.
  return !KRASCHKLASSER.has(error.name);
}

/* ------------------------------ Rapportering ------------------------------ */

interface Brott {
  /** Händelsens plats i sekvensen (1-baserat). */
  steg: number;
  event: Event;
  /** Ett brott mot en invariant. Saknas när händelsen kraschade i stället. */
  violation?: InvariantViolation;
  /** Tjänstelagret kraschade på händelsen (inte en vägran). */
  krasch?: { name: string; message: string; stack?: string };
  /**
   * Stegen som verkligen bokförde något, i ordning. fast-check kan inte krympa
   * sekvensen kortare än 20 händelser (uppgiftens undre gräns), så de flesta
   * händelser i en krympt sekvens hoppades över av tjänstelagret. Det är de här
   * stegen som är den verkliga kärnan i motexemplet.
   */
  verksammaSteg: number[];
}

function beskrivEvent(event: Event): string {
  switch (event.t) {
    case "kundfaktura_skapas":
      return `kundfaktura skapas (${event.lines.length} rad${event.lines.length === 1 ? "" : "er"}, kund #${event.kundIndex})`;
    case "kundfaktura_betalas":
      return `kundfaktura betalas ${event.andelProcent} % (faktura #${event.fakturaIndex})`;
    case "kvitto_bokfors":
      return `kvitto bokförs: ${LEVERANTORER[event.leverantorIndex]} ${event.belopp} kr, moms ${VAT_RATES[event.momssatsIndex]} %, kategori ${EXPENSE_CATEGORIES[event.kategoriIndex].key}`;
    case "banktransaktion_bokfors":
      return `banktransaktion bokförs som ${BANK_KINDS[event.typIndex].key} (transaktion #${event.txIndex})`;
    case "momsperiod_deklareras":
      return `momsperiod deklareras (period #${event.periodIndex})`;
    case "fskatt_bokfors":
      return `F-skatt bokförs ${event.belopp} kr (månad +${event.manadIndex})`;
    case "manad_stangs":
      return "månad stängs";
    case "verifikation_rattas":
      return `verifikation rättas till ${EXPENSE_CATEGORIES[event.kategoriIndex].key} (verifikation #${event.verIndex})`;
    case "ar_stangs":
      return `år stängs (år #${event.arIndex})`;
    case "ar_oppnas_igen":
      return `år öppnas igen (år #${event.arIndex})`;
  }
}

function rapport(events: Event[], brott: Brott): string {
  const rader = events.map(
    (e, i) => `  ${i + 1}. ${beskrivEvent(e)}${i + 1 === brott.steg ? "   <-- här" : ""}`
  );
  const rubrik = brott.violation
    ? [
        `Invariant bruten: ${brott.violation.invariant} - ${invariantLabel(brott.violation.invariant)}`,
        `Efter händelse ${brott.steg} av ${events.length}: ${beskrivEvent(brott.event)}`,
        `Brottet: ${brott.violation.message}`,
      ]
    : [
        `Tjänstelagret kraschade: ${brott.krasch?.name}: ${brott.krasch?.message}`,
        `På händelse ${brott.steg} av ${events.length}: ${beskrivEvent(brott.event)}`,
        brott.krasch?.stack ? `\n${brott.krasch.stack}` : "",
      ];
  const verksamma = brott.verksammaSteg.map((steg) => `  ${steg}. ${beskrivEvent(events[steg - 1])}`);
  return [
    "",
    ...rubrik,
    "",
    `Minsta sekvens som bryter (${events.length} händelse${events.length === 1 ? "" : "r"}):`,
    ...rader,
    "",
    `Av dessa bokförde ${brott.verksammaSteg.length} något - resten vägrade tjänstelagret. Kärnan i motexemplet:`,
    ...verksamma,
    "",
  ].join("\n");
}

/* -------------------------------- Egenskapen ------------------------------- */

const NUM_RUNS = process.env.DRIVA_DEEP === "1" ? 500 : 50;

/**
 * Kör en sekvens mot en färsk nystart-lagring och returnera det första brottet.
 * Undefined = invarianterna höll hela sekvensen igenom.
 *
 * `only` begränsar vilka invarianter som kontrolleras. Utan den körs alla, som
 * uppgiften beskriver. Med den kan varje invariant få sin EGEN minsta brytande
 * sekvens: ett tidigt brott mot en invariant döljer annars alla andra, och då
 * går det inte att rapportera en krympt sekvens per invariant.
 */
function korSekvens(events: Event[], only?: InvariantKey[]): Brott | undefined {
  replaceDb(buildScenario("nystart"));
  const verksammaSteg: number[] = [];

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    try {
      const utfall = utfor(event);
      if (utfall === HOPPADES_OVER) {
        raknaTackning(event.t, false, "inget att arbeta på");
        continue;
      }
      raknaTackning(event.t, true);
      verksammaSteg.push(i + 1);
    } catch (error) {
      if (arVagran(error)) {
        raknaTackning(event.t, false, (error as Error).message.slice(0, 110));
        continue;
      }
      const e = error as Error;
      return {
        steg: i + 1,
        event,
        krasch: { name: e?.name ?? "Fel", message: e?.message ?? String(error), stack: e?.stack },
        verksammaSteg,
      };
    }
    const report = checkInvariants(db(), only ? { only } : undefined);
    if (report.brott.length > 0) {
      return { steg: i + 1, event, violation: report.brott[0], verksammaSteg };
    }
  }
  return undefined;
}

/** Kör egenskapen och returnera rapporttexten när den faller. */
function korEgenskap(only?: InvariantKey[]): string | undefined {
  let funnet: { events: Event[]; brott: Brott } | undefined;

  const result = fc.check(
    fc.property(genSequence, (events) => {
      const brott = korSekvens(events, only);
      if (brott) {
        // Sparas vid varje (allt mindre) motexempel, så det sista som sparas
        // hör till den krympta sekvensen.
        funnet = { events, brott };
        return false;
      }
      return true;
    }),
    { numRuns: NUM_RUNS, verbose: false }
  );

  if (!result.failed) return undefined;
  const events = (result.counterexample?.[0] as Event[]) ?? funnet?.events ?? [];
  const brott = funnet?.brott;
  if (brott) return rapport(events, brott);
  // fast-check föll utan att korSekvens hann spara ett brott (avbrott, för
  // många överhoppade körningar). errorInstance finns bara på vissa utfall.
  const detalj = (result as { errorInstance?: unknown }).errorInstance;
  return `\nSekvensen misslyckades efter ${events.length} händelser utan att ett brott sparades:\n${
    detalj instanceof Error ? detalj.message : String(detalj ?? "")
  }\n`;
}

describe("Egenskap: bokföringens invarianter håller efter varje händelse", () => {
  it(`alla invarianter, slumpade sekvenser av 20-200 händelser mot en färsk nystart-lagring (${NUM_RUNS} körningar)`, () => {
    const text = korEgenskap();
    if (text) {
      // Skrivs ut så den minsta brytande sekvensen syns i testloggen, inte
      // bara i assert-meddelandet.
      console.error(text);
      assert.fail(text);
    }
  });

  // En egenskap per invariant, så varje bruten invariant får sin egen minsta
  // sekvens i stället för att döljas av den som råkar brytas först.
  for (const invariant of INVARIANTS) {
    it(`${invariant.key}: ${invariant.label} (${NUM_RUNS} körningar)`, () => {
      const text = korEgenskap([invariant.key]);
      if (text) {
        console.error(text);
        assert.fail(text);
      }
    });
  }

  /**
   * Täckningen skrivs ut sist. Den är ingen egenskap - den finns för att ett
   * grönt resultat inte ska läsas som "alla tio händelsetyperna prövades".
   * Händelsetyper med noll utförda är inte kontrollerade av det här testet.
   */
  it("täckning per händelsetyp (rapport, inte en egenskap)", () => {
    const rader: string[] = ["", "Täckning per händelsetyp över alla körningar:"];
    const outnyttjade: Event["t"][] = [];
    for (const [kind, rad] of tackning) {
      rader.push(`  ${kind}: ${rad.utford} utförda, ${rad.hoppad} hoppade`);
      if (rad.utford === 0) {
        outnyttjade.push(kind);
        const topp = [...rad.skal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
        for (const [skal, antal] of topp) rader.push(`      ${antal}x ${skal}`);
      }
    }
    if (outnyttjade.length > 0) {
      rader.push(
        "",
        `EJ PRÖVADE händelsetyper: ${outnyttjade.join(", ")}.`,
        "De invarianter som bara kan brytas av dessa händelser är alltså inte kontrollerade här.",
        ""
      );
    }
    console.error(rader.join("\n"));
    assert.ok(tackning.size > 0, "ingen händelse kördes alls");
  });
});
