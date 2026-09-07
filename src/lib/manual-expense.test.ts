process.env.DRIVA_TEST = "1";

/**
 * Ny utgift för hand: köp och privata utlägg, milersättning, traktamente och
 * representation.
 *
 * Innan: enda vägen in för en kostnad var ett kvitto eller en banktransaktion.
 * Ägaren som betalade skruv med eget kort, körde egen bil till kunden eller
 * bjöd en beställare på lunch hade ingenstans att registrera det – och fick
 * gissa BAS-konton, schabloner och momsregler själv.
 *
 * Nu räknar en ren modul fram konteringen (samma siffror i förhandsvisningen
 * som i bokföringen), privata utgifter blir skuld till ägaren (2893) tills
 * banken visar återbetalningen, och bankinkorgen känner igen återbetalningen
 * i stället för att bokföra den som en ny kostnad.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb } from "./invoices/test-db";
import { uid } from "./ids";
import type { BankAccount, BankTransaction } from "./types";
import {
  planManualExpense,
  planIsBalanced,
  representationSplit,
  settlementAccountFor,
  MANUAL_EXPENSE_ACCOUNTS,
  type ManualExpenseDraft,
} from "./expenses/manual-expense";
import { mileageAllowance, mileageRatesFor, perDiemAllowance, perDiemRatesFor } from "./accounting/allowances";
import { prisbasbeloppFor } from "./accounting/prisbasbelopp";
import { inventarieGransFor } from "./accounting/assets";
import { accountBalance } from "./accounting/ledger";
import { accountName } from "./accounting/chart";
import { categoryContext, createManualExpense, manualExpenseCategories, ownerLiability } from "./services/manual-expense";
import { expenseCategoryLabel, undoExpenseBooking } from "./services/expenses";
import { listExpensesForTable } from "./services/economy-list";
import { bankKindSuggestion, bookBankTransactionAs } from "./services/bank-booking";
import { registerBankTransactions } from "./services/banking";
import { getBusinessActions } from "./services/actions";

const YEAR = new Date().getFullYear();
const TODAY = new Date().toISOString().slice(0, 10);
const D = (month: number, day: number) => `${YEAR}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
/** Ett datum i år som säkert inte ligger i framtiden. */
const DATE = TODAY < D(2, 1) ? D(1, 1) : D(1, 15);

function reset() {
  replaceDb(
    emptyTestDb({
      bankAccounts: [
        {
          id: "acc-1",
          provider: "mock",
          name: "Företagskonto",
          accountNumber: "1234-5678",
          balance: 0,
          connectedAt: new Date().toISOString(),
        } satisfies BankAccount,
      ],
    })
  );
  db().fiscalYears.push({
    id: "fy",
    label: String(YEAR),
    startDate: `${YEAR}-01-01`,
    endDate: `${YEAR}-12-31`,
    status: "oppet",
    openingBalances: {},
    openingSource: "migrering",
  });
}

/** Svensk formattering använder hårda blanksteg (1 250 kr) – jämför med vanliga. */
function plain(text: string | undefined): string {
  return (text ?? "").replace(/\u00a0/g, " ");
}

/** Konteringen som { konto: debet − kredit } för läsbara påståenden. */
function net(lines: readonly { account: number; debit: number; credit: number }[]) {
  const out: Record<number, number> = {};
  for (const l of lines) out[l.account] = (out[l.account] ?? 0) + l.debit - l.credit;
  return out;
}

function verificationNet(verificationId: string | undefined) {
  const v = db().verifications.find((x) => x.id === verificationId);
  assert.ok(v, "verifikationen finns");
  return Object.fromEntries(v.entries.map((e) => [e.account, e.debit - e.credit]));
}

function plan(draft: ManualExpenseDraft, categoryKey?: string) {
  const result = planManualExpense(draft, { category: categoryContext(categoryKey ?? draft.category) });
  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.ok(planIsBalanced(result.plan), "planen är i balans");
  return result.plan;
}

function planError(draft: ManualExpenseDraft, categoryKey?: string): string {
  const result = planManualExpense(draft, { category: categoryContext(categoryKey ?? draft.category) });
  assert.ok(!result.ok, "planen skulle ha nekats");
  return result.error;
}

/* ============================== Schablonerna =============================== */

describe("Skatteverkets schabloner", () => {
  it("milersättningen följer bilslag och år – 25 kr/mil egen bil från 2023, 18,50 innan", () => {
    assert.equal(mileageRatesFor(2026).egen, 25);
    assert.equal(mileageRatesFor(2026).formansbil, 12);
    assert.equal(mileageRatesFor(2026).formansbil_el, 9.5);
    assert.equal(mileageRatesFor(2022).egen, 18.5);
    // Okänt år: närmaste kända – framtiden får senaste, förr i tiden får första.
    assert.deepEqual(mileageRatesFor(2040), mileageRatesFor(2026));
    assert.deepEqual(mileageRatesFor(2010), mileageRatesFor(2022));
  });

  it("milersättningen räknas per mil och avrundas till hela kronor", () => {
    assert.equal(mileageAllowance({ date: "2026-03-01", km: 320, vehicle: "egen" }), 800);
    assert.equal(mileageAllowance({ date: "2026-03-01", km: 320, vehicle: "formansbil_el" }), 304);
    assert.equal(mileageAllowance({ date: "2022-03-01", km: 320, vehicle: "egen" }), 592);
    // 12,5 km × 2,5 kr/km = 31,25 → 31 (örefri bokföring).
    assert.equal(mileageAllowance({ date: "2026-03-01", km: 12.5, vehicle: "egen" }), 31);
    assert.equal(mileageAllowance({ date: "2026-03-01", km: 0, vehicle: "egen" }), 0);
    assert.equal(mileageAllowance({ date: "2026-03-01", km: Number.NaN, vehicle: "egen" }), 0);
  });

  it("traktamentet är 0,5 % av prisbasbeloppet avrundat till tiotal – halv dag och natt är hälften", () => {
    assert.equal(prisbasbeloppFor(2026), 59_200);
    assert.deepEqual(perDiemRatesFor(2026), { heldag: 300, halvdag: 150, natt: 150 });
    // 58 800 × 0,005 = 294 → 290.
    assert.deepEqual(perDiemRatesFor(2025), { heldag: 290, halvdag: 145, natt: 145 });
    assert.equal(perDiemAllowance({ date: "2026-05-01", fullDays: 2, halfDays: 1, nights: 2 }), 600 + 150 + 300);
    // Delar av dagar räknas inte; negativa tal ger noll.
    assert.equal(perDiemAllowance({ date: "2026-05-01", fullDays: 1.9, halfDays: -1, nights: 0 }), 300);
  });

  it("inventariegränsen är ett halvt prisbasbelopp det år köpet gjordes", () => {
    assert.equal(inventarieGransFor("2026-06-01"), 29_600);
    assert.equal(inventarieGransFor("2024-06-01"), 28_650);
  });
});

/* ============================ Konteringsplanen ============================= */

describe("Planen för ett köp eller privat utlägg", () => {
  const base: ManualExpenseDraft = {
    kind: "kop",
    date: "2026-03-10",
    paidBy: "foretagskonto",
    supplier: "Beijer Bygg",
    amount: 1_250,
    vatAmount: 250,
    category: "material",
  };

  it("från företagskontot: kostnad + ingående moms mot 1930", () => {
    const p = plan(base);
    assert.deepEqual(net(p.lines), { 4010: 1_000, 2641: 250, 1930: -1_250 });
    assert.equal(p.amount, 1_250);
    assert.equal(p.vatDeductible, 250);
    assert.equal(p.settlementAccount, 1930);
    assert.equal(p.supplier, "Beijer Bygg");
    assert.equal(p.description, "material");
    assert.equal(plain(p.title), "Köp 1 250 kr hos Beijer Bygg");
    assert.match(p.explanation, /konto 4010 \(Material\)/);
    assert.match(p.explanation, /företagskontot \(1930\)/);
    assert.equal(p.notes.length, 0);
  });

  it("betalt privat: samma kostnad men skulden till ägaren (2893) krediteras", () => {
    const p = plan({ ...base, paidBy: "privat", description: "Skruv och plugg till badrummet" });
    assert.deepEqual(net(p.lines), { 4010: 1_000, 2641: 250, 2893: -1_250 });
    assert.equal(p.settlementAccount, 2893);
    assert.match(p.title, /^Utlägg/);
    assert.equal(p.description, "Skruv och plugg till badrummet");
    assert.match(p.explanation, /skuld till dig \(2893\)/);
    assert.ok(p.notes.some((n) => /ställt till bolaget/.test(n)), "påminner om att kvittot ska vara bolagets");
    assert.equal(settlementAccountFor("privat"), 2893);
    assert.equal(settlementAccountFor("foretagskonto"), 1930);
    assert.equal(settlementAccountFor(undefined), 1930);
  });

  it("momsfri kategori: hela beloppet blir kostnad, ingen moms lyfts", () => {
    const p = plan({ ...base, category: "hyra", vatAmount: 250 });
    assert.deepEqual(net(p.lines), { 5010: 1_250, 1930: -1_250 });
    assert.equal(p.vatDeductible, 0);
    assert.match(p.explanation, /saknar avdragsgill moms/);
  });

  it("omvänd byggmoms: momsen bokförs både ut och in så nettot mot Skatteverket blir noll", () => {
    const p = plan({ ...base, category: "byggtjanster_omvand", amount: 10_000, vatAmount: 0 });
    assert.deepEqual(net(p.lines), { 4425: 10_000, 2647: 2_500, 2614: -2_500, 1930: -10_000 });
    assert.equal(p.vatDeductible, 0);
    assert.match(p.explanation, /omvänd|betalningsskyldig/i);
  });

  it("utan moms angiven: kostnaden är hela beloppet", () => {
    const p = plan({ ...base, vatAmount: undefined });
    assert.deepEqual(net(p.lines), { 4010: 1_250, 1930: -1_250 });
    assert.match(p.explanation, /Ingen moms angiven/);
  });

  it("nekar ofullständiga eller orimliga uppgifter med begriplig svenska", () => {
    assert.equal(planError({ ...base, supplier: "   " }), "Skriv vem du köpte av.");
    assert.equal(planError({ ...base, amount: undefined }), "Ange beloppet i hela kronor.");
    assert.equal(planError({ ...base, amount: 0 }), "Ange beloppet i hela kronor.");
    assert.equal(planError({ ...base, amount: 12.5 }), "Ange beloppet i hela kronor.");
    assert.equal(planError({ ...base, vatAmount: 2_000 }), "Momsen kan inte vara större än beloppet.");
    assert.equal(planError({ ...base, category: undefined }), "Välj vad köpet gällde.");
    assert.equal(planError({ ...base, date: "igår" }), "Välj ett datum.");
    assert.equal(planError({ ...base, date: "2026-13-45" }), "Välj ett datum.");
    assert.equal(planError({ ...base, kind: "hittepå" as ManualExpenseDraft["kind"] }), "Okänd typ av utgift.");
  });

  it("långa texter kortas och blanksteg städas", () => {
    const p = plan({ ...base, supplier: `  Beijer   ${"x".repeat(400)}  ` });
    assert.ok(p.supplier.length <= 200);
    assert.ok(p.supplier.startsWith("Beijer x"));
  });
});

describe("Planen för milersättning", () => {
  const base: ManualExpenseDraft = {
    kind: "milersattning",
    date: "2026-03-10",
    paidBy: "foretagskonto",
    mileage: { km: 320, vehicle: "egen", route: "Verkstaden – Kund i Täby och tillbaka" },
  };

  it("schablon × mil → 7331 mot skuld till ägaren, oavsett vad paidBy säger", () => {
    const p = plan(base);
    assert.deepEqual(net(p.lines), { 7331: 800, 2893: -800 });
    assert.equal(p.amount, 800);
    assert.equal(p.vatDeductible, 0);
    assert.equal(p.settlementAccount, 2893);
    assert.equal(p.supplier, "Milersättning");
    assert.equal(p.title, "Milersättning 32 mil × 25 kr");
    assert.equal(p.description, "32 mil egen bil – Verkstaden – Kund i Täby och tillbaka");
    assert.match(p.explanation, /320 km/);
    assert.match(p.explanation, /2026 är 25 kr per mil/);
    assert.match(p.explanation, /Ingen moms/);
    assert.ok(p.notes.some((n) => /körjournal/i.test(n)), "påminner om körjournal");
    assert.ok(p.notes.some((n) => /ruta 051/.test(n)), "nämner arbetsgivardeklarationen");
  });

  it("förmånsbil får sin lägre schablon och decimalsträckor avrundas", () => {
    assert.equal(plan({ ...base, mileage: { km: 320, vehicle: "formansbil" } }).amount, 384);
    const el = plan({ ...base, mileage: { km: 12.5, vehicle: "formansbil_el" } });
    assert.equal(el.amount, 12); // 1,25 mil × 9,50 = 11,875
    assert.equal(el.title, "Milersättning 1,3 mil × 9,5 kr");
    assert.equal(el.description, "1,3 mil förmånsbil (el)");
  });

  it("nekar tomma, orimliga och för korta resor", () => {
    assert.equal(planError({ ...base, mileage: undefined }), "Ange hur långt du körde, i kilometer.");
    assert.equal(planError({ ...base, mileage: { km: 0, vehicle: "egen" } }), "Ange hur långt du körde, i kilometer.");
    assert.equal(planError({ ...base, mileage: { km: -5, vehicle: "egen" } }), "Ange hur långt du körde, i kilometer.");
    assert.equal(planError({ ...base, mileage: { km: 5_001, vehicle: "egen" } }), "Sträckan verkar för lång för en resa – dela upp den.");
    assert.equal(
      planError({ ...base, mileage: { km: 100, vehicle: "traktor" as "egen" } }),
      "Välj vilken bil du körde."
    );
    // 0,1 km förmånsbil el = 0,095 kr → 0 kr.
    assert.equal(planError({ ...base, mileage: { km: 0.1, vehicle: "formansbil_el" } }), "Sträckan är för kort för att ge någon ersättning.");
  });
});

describe("Planen för traktamente", () => {
  const base: ManualExpenseDraft = {
    kind: "traktamente",
    date: "2026-03-10",
    paidBy: "privat",
    perDiem: { fullDays: 2, halfDays: 1, nights: 2, destination: "Göteborg" },
  };

  it("heldagar, halvdagar och nätter à schablonen → 7321 mot skuld till ägaren", () => {
    const p = plan(base);
    assert.deepEqual(net(p.lines), { 7321: 1_050, 2893: -1_050 });
    assert.equal(p.amount, 1_050);
    assert.equal(p.vatDeductible, 0);
    assert.equal(p.supplier, "Traktamente");
    assert.equal(plain(p.title), "Traktamente Göteborg – 1 050 kr");
    assert.equal(p.description, "Göteborg, 2 heldagar, 1 halvdag, 2 nätter");
    assert.match(plain(p.explanation), /2 heldagar à 300 kr, 1 halvdag à 150 kr, 2 nätter à 150 kr = 1 050 kr/);
    assert.ok(p.notes.some((n) => /50 km/.test(n)), "påminner om avståndskravet");
    assert.ok(p.notes.some((n) => /ruta 050/.test(n)), "nämner arbetsgivardeklarationen");
  });

  it("2025 ger den lägre schablonen och enbart nätter går bra", () => {
    const p = plan({ ...base, date: "2025-09-01", perDiem: { fullDays: 0, halfDays: 0, nights: 3, destination: "Umeå" } });
    assert.equal(p.amount, 3 * 145);
    assert.equal(p.description, "Umeå, 3 nätter");
  });

  it("nekar resor utan dagar, utan resmål eller längre än tre månader", () => {
    assert.equal(planError({ ...base, perDiem: undefined }), "Ange resans dagar.");
    assert.equal(
      planError({ ...base, perDiem: { fullDays: 0, halfDays: 0, nights: 0, destination: "Göteborg" } }),
      "Ange minst en hel dag, halv dag eller natt."
    );
    assert.equal(
      planError({ ...base, perDiem: { fullDays: 0.5, halfDays: 0.5, nights: 0.9, destination: "Göteborg" } }),
      "Ange minst en hel dag, halv dag eller natt."
    );
    assert.equal(planError({ ...base, perDiem: { fullDays: 2, halfDays: 0, nights: 1 } }), "Skriv vart resan gick.");
    assert.equal(
      planError({ ...base, perDiem: { fullDays: 91, halfDays: 0, nights: 90, destination: "Kiruna" } }),
      "Efter tre månader på samma ort sänks traktamentet – registrera resan i delar."
    );
  });
});

describe("Planen för representation", () => {
  const base: ManualExpenseDraft = {
    kind: "representation",
    date: "2026-03-10",
    paidBy: "foretagskonto",
    supplier: "Restaurang Prinsen",
    amount: 1_500,
    vatAmount: 161,
    representation: { kind: "kundmaltid", persons: 4, alcohol: false, participants: "Anna (Bygg AB), Erik", purpose: "avstämning inför etapp 2" },
  };

  it("kundmåltid: kostnaden är inte avdragsgill men momsen lyfts med 36 kr per person", () => {
    const p = plan(base);
    // Netto 1 339. Moms 161, varav 4 × 36 = 144 får lyftas; resten (17) blir kostnad.
    assert.deepEqual(net(p.lines), { 6072: 1_339 + 17, 2641: 144, 1930: -1_500 });
    assert.equal(p.vatDeductible, 144);
    assert.equal(p.supplier, "Restaurang Prinsen");
    assert.equal(plain(p.title), "Måltid med kund 1 500 kr · 4 personer");
    assert.equal(p.description, "måltid med kund, 4 personer, avstämning inför etapp 2");
    assert.match(p.explanation, /Anna \(Bygg AB\), Erik/);
    assert.match(p.explanation, /inte avdragsgill \(6072\)/);
    assert.match(plain(p.explanation), /högst 36 kr per person – här 144 kr/);
    assert.match(plain(p.explanation), /Resten av momsen \(17 kr\) blir kostnad/);
    assert.ok(p.notes.some((n) => /vem som deltog och syftet/.test(n)));
    assert.ok(p.notes.some((n) => /omedelbart samband/.test(n)), "kundmåltid kräver samband med verksamheten");
  });

  it("med alkohol höjs schablonen till 46 kr per person", () => {
    const p = plan({ ...base, representation: { ...base.representation!, alcohol: true } });
    // 4 × 46 = 184 > 161 → hela momsen får lyftas.
    assert.deepEqual(net(p.lines), { 6072: 1_339, 2641: 161, 1930: -1_500 });
    assert.match(p.explanation, /46 kr per person när alkohol ingår/);
  });

  it("fika med kund under gränsen: allt avdragsgillt på 6071", () => {
    const p = plan({ ...base, supplier: "Espresso House", amount: 100, vatAmount: 11, representation: { kind: "kundfika", persons: 2, alcohol: false } });
    assert.deepEqual(net(p.lines), { 6071: 89, 2641: 11, 1930: -100 });
    assert.equal(plain(p.title), "Fika med kund 100 kr · 2 personer");
    assert.equal(p.description, "fika med kund, 2 personer");
    assert.doesNotMatch(p.explanation, /Resten/);
  });

  it("fika över 60 kr per person: överskottet blir ej avdragsgillt, momsen lyfts på hela underlaget under 300 kr/person", () => {
    const p = plan({ ...base, supplier: "Konditoriet", amount: 500, vatAmount: 54, representation: { kind: "kundfika", persons: 2, alcohol: false } });
    // Netto 446: 2 × 60 = 120 avdragsgillt, 326 ej. Underlag 446 < 600 → all moms lyfts.
    assert.deepEqual(net(p.lines), { 6071: 120, 6072: 326, 2641: 54, 1930: -500 });
    assert.match(plain(p.explanation), /Resten \(326 kr\) bokförs som ej avdragsgill \(6072\)/);
  });

  it("fika över 300 kr per person: bara momsen på 300 kr/person får lyftas", () => {
    const p = plan({ ...base, supplier: "Delikatessen", amount: 1_000, vatAmount: 107, representation: { kind: "kundfika", persons: 1, alcohol: false } });
    // Netto 893: 60 avdragsgillt, 833 ej. Moms på underlaget 300/893 av 107 = 36; 71 blir kostnad.
    assert.deepEqual(net(p.lines), { 6071: 60, 6072: 833 + 71, 2641: 36, 1930: -1_000 });
    assert.match(plain(p.explanation), /71 kr av momsen blir kostnad/);
  });

  it("personalrepresentation bokförs på 76xx och privat betalning blir skuld till ägaren", () => {
    const fest = plan({
      ...base,
      paidBy: "privat",
      supplier: "Restaurang Prinsen",
      amount: 3_000,
      vatAmount: 321,
      representation: { kind: "personalmaltid", persons: 3, alcohol: true },
    });
    // 3 × 46 = 138 får lyftas; 183 blir kostnad.
    assert.deepEqual(net(fest.lines), { 7632: 2_679 + 183, 2641: 138, 2893: -3_000 });
    assert.equal(plain(fest.title), "Personalfest eller intern måltid 3 000 kr · 3 personer");
    assert.ok(fest.notes.some((n) => /personalrepresentation/.test(n)));
    assert.ok(!fest.notes.some((n) => /omedelbart samband/.test(n)), "kravet gäller bara kundmåltider");

    const fika = plan({ ...base, supplier: "ICA", amount: 150, vatAmount: 16, representation: { kind: "personalfika", persons: 5, alcohol: false } });
    assert.deepEqual(net(fika.lines), { 7631: 134, 2641: 16, 1930: -150 });
  });

  it("uppdelningen summerar alltid till exakt totalbeloppet", () => {
    for (const persons of [1, 2, 3, 7]) {
      for (const amount of [37, 100, 499, 1_234, 9_999]) {
        for (const kind of ["kundmaltid", "kundfika", "personalmaltid", "personalfika"] as const) {
          const vatAmount = Math.round(amount * 0.12 / 1.12);
          const s = representationSplit({ kind, amount, vatAmount, persons, alcohol: persons % 2 === 0 });
          assert.equal(s.deductibleNet + s.nonDeductibleNet + s.deductibleVat + s.nonDeductibleVat, amount, `${kind} ${amount} × ${persons}`);
          assert.ok(s.deductibleVat >= 0 && s.nonDeductibleVat >= 0 && s.deductibleNet >= 0 && s.nonDeductibleNet >= 0);
        }
      }
    }
  });

  it("nekar utan restaurang, belopp, slag eller deltagare", () => {
    assert.equal(planError({ ...base, supplier: "" }), "Skriv var ni var – restaurangen eller butiken.");
    assert.equal(planError({ ...base, amount: undefined }), "Ange beloppet i hela kronor.");
    assert.equal(planError({ ...base, representation: undefined }), "Välj vilken sorts representation det var.");
    assert.equal(
      planError({ ...base, representation: { kind: "kundmaltid", persons: 0, alcohol: false } }),
      "Ange hur många personer som deltog."
    );
    assert.equal(planError({ ...base, vatAmount: 5_000 }), "Momsen kan inte vara större än beloppet.");
  });
});

describe("Kontona planen kan röra", () => {
  it("finns alla i kontoplanen så att formuläret kan visa namn", () => {
    for (const account of MANUAL_EXPENSE_ACCOUNTS) {
      assert.notEqual(accountName(account), "", `konto ${account} har ett namn`);
    }
  });

  it("formulärets kategorier är kvittokategorierna utan representation (den har sin egen flik)", () => {
    const keys = manualExpenseCategories().map((c) => c.key);
    assert.ok(keys.includes("material") && keys.includes("verktyg") && keys.includes("hyra"));
    assert.ok(!keys.includes("representation"));
    assert.equal(categoryContext("hyra")?.vatFree, true);
    assert.equal(categoryContext("byggtjanster_omvand")?.reverseChargeRate, 25);
    assert.equal(categoryContext("finns-inte"), undefined);
    assert.equal(categoryContext(undefined), undefined);
  });
});

/* ============================ Spara och bokföra ============================ */

describe("Registrera en utgift för hand", () => {
  beforeEach(reset);

  it("ett köp från företagskontot bokförs direkt med planens kontering", () => {
    const r = createManualExpense({
      kind: "kop",
      date: DATE,
      paidBy: "foretagskonto",
      supplier: "Beijer Bygg",
      amount: 1_250,
      vatAmount: 250,
      category: "material",
    });
    assert.equal(r.askedAssetQuestion, false);
    assert.ok(r.verificationId);
    assert.deepEqual(verificationNet(r.verificationId), { 4010: 1_000, 2641: 250, 1930: -1_250 });
    const saved = db().expenses.find((e) => e.id === r.expense.id)!;
    assert.equal(saved.status, "bokford");
    assert.equal(saved.kind, "kop");
    assert.equal(saved.paidBy, "foretagskonto");
    assert.equal(saved.category, "material");
    assert.equal(saved.verificationId, r.verificationId);
    assert.equal(saved.details, undefined);
    const v = db().verifications.find((x) => x.id === r.verificationId)!;
    assert.equal(v.description, "Beijer Bygg – material");
    assert.equal(v.source?.type, "utgift");
    assert.equal(ownerLiability().balance, 0);
  });

  it("ett privat utlägg blir skuld till ägaren och syns i sammanställningen", () => {
    const r = createManualExpense({
      kind: "kop",
      date: DATE,
      paidBy: "privat",
      supplier: "Bauhaus",
      amount: 500,
      vatAmount: 100,
      category: "verktyg",
      description: "Bits och borr",
    });
    assert.deepEqual(verificationNet(r.verificationId), { 5410: 400, 2641: 100, 2893: -500 });
    assert.equal(accountBalance(2893), -500);
    const owed = ownerLiability();
    assert.equal(owed.balance, 500);
    assert.deepEqual(owed.openExpenses.map((e) => e.id), [r.expense.id]);
    assert.ok(db().activity.some((a) => /skuld till dig/.test(a.text)), "aktiviteten säger att bolaget är skyldigt ägaren");
  });

  it("milersättning är alltid en skuld till ägaren och sparar schablonen som gällde", () => {
    const r = createManualExpense({
      kind: "milersattning",
      date: DATE,
      paidBy: "foretagskonto",
      mileage: { km: 320, vehicle: "egen", route: "  Verkstaden – Täby  " },
    });
    assert.deepEqual(verificationNet(r.verificationId), { 7331: 800, 2893: -800 });
    const saved = r.expense;
    assert.equal(saved.paidBy, "privat");
    assert.equal(saved.kind, "milersattning");
    assert.equal(saved.category, "milersattning");
    assert.equal(saved.supplier, "Milersättning");
    assert.equal(saved.amount, 800);
    assert.equal(saved.vatAmount, 0);
    assert.deepEqual(saved.details?.mileage, { km: 320, vehicle: "egen", ratePerMil: 25, route: "Verkstaden – Täby" });
    assert.equal(expenseCategoryLabel(saved), "Milersättning");
    // Ingen leverantörsregel lärs av en schablon – det finns ingen leverantör.
    const rules = db().meta.merchantCategoryRules ?? {};
    assert.ok(!Object.keys(rules).some((k) => /milers/i.test(k)), "ingen regel för 'Milersättning'");
  });

  it("traktamente sparar årets schablon i uppgifterna", () => {
    const r = createManualExpense({
      kind: "traktamente",
      date: DATE,
      paidBy: "privat",
      perDiem: { fullDays: 2, halfDays: 1, nights: 2, destination: "Göteborg" },
    });
    const rates = perDiemRatesFor(YEAR);
    assert.deepEqual(verificationNet(r.verificationId), { 7321: 2 * rates.heldag + rates.halvdag + 2 * rates.natt, 2893: -r.expense.amount });
    assert.deepEqual(r.expense.details?.perDiem, { fullDays: 2, halfDays: 1, nights: 2, destination: "Göteborg", rates });
    assert.equal(expenseCategoryLabel(r.expense), "Traktamente");
  });

  it("representation bokförs med uppdelningen och får sitt slag som visningsnamn", () => {
    const r = createManualExpense({
      kind: "representation",
      date: DATE,
      paidBy: "foretagskonto",
      supplier: "Restaurang Prinsen",
      amount: 1_500,
      vatAmount: 161,
      representation: { kind: "kundmaltid", persons: 4, alcohol: false, participants: "Anna, Erik" },
    });
    assert.deepEqual(verificationNet(r.verificationId), { 6072: 1_356, 2641: 144, 1930: -1_500 });
    assert.equal(r.expense.category, "representation");
    assert.equal(r.expense.vatAmount, 161);
    assert.deepEqual(r.expense.details?.representation, { kind: "kundmaltid", persons: 4, alcohol: false, participants: "Anna, Erik" });
    assert.equal(expenseCategoryLabel(r.expense), "Måltid med kund");
    assert.equal(expenseCategoryLabel({ kind: "representation" }), "Representation");
    assert.equal(expenseCategoryLabel({ category: "material" }), "Material");
  });

  it("ett kvitto som följer med kopplas till utgiften", () => {
    const r = createManualExpense(
      { kind: "kop", date: DATE, paidBy: "privat", supplier: "Bauhaus", amount: 500, vatAmount: 100, category: "verktyg" },
      { receipt: { id: "rc-1", filename: "kvitto.jpg", contentType: "image/jpeg", sizeBytes: 12_345, storagePath: "biz/rc-1.jpg" } }
    );
    assert.equal(r.expense.receiptId, "rc-1");
    const receipt = db().receipts.find((x) => x.id === "rc-1")!;
    assert.equal(receipt.expenseId, r.expense.id);
    assert.equal(receipt.source, "uppladdning");
    assert.equal(receipt.extracted?.amount, 500);
    assert.equal(receipt.extracted?.vatAmount, 100);
    assert.equal(receipt.extracted?.category, "verktyg");
    assert.equal(receipt.extracted?.confidence, "hog");
  });

  it("kan kopplas till ett uppdrag – men bara ett som finns", () => {
    db().customers.push({
      id: "c1",
      kind: "privat",
      name: "Anna",
      email: "",
      phone: "",
      address: "",
      postalCode: "",
      city: "",
      notes: "",
      createdAt: new Date().toISOString(),
    });
    db().jobs.push({
      id: "job-1",
      customerId: "c1",
      title: "Badrum",
      description: "",
      status: "pagar",
      checklist: [],
      notes: "",
      createdAt: new Date().toISOString(),
    });
    const r = createManualExpense({
      kind: "kop",
      date: DATE,
      paidBy: "foretagskonto",
      supplier: "Beijer",
      amount: 100,
      vatAmount: 20,
      category: "material",
      jobId: " job-1 ",
    });
    assert.equal(r.expense.jobId, "job-1");
    assert.throws(
      () =>
        createManualExpense({
          kind: "kop",
          date: DATE,
          paidBy: "foretagskonto",
          supplier: "Beijer",
          amount: 100,
          vatAmount: 20,
          category: "material",
          jobId: "job-borttaget",
        }),
      /Uppdraget finns inte längre/
    );
  });

  it("nekar framtida datum och ogiltiga utkast innan något sparas", () => {
    const before = db().expenses.length;
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    assert.throws(
      () => createManualExpense({ kind: "kop", date: tomorrow, paidBy: "foretagskonto", supplier: "X", amount: 100, category: "material" }),
      /inte ligga i framtiden/
    );
    assert.throws(
      () => createManualExpense({ kind: "kop", date: DATE, paidBy: "foretagskonto", supplier: "X", amount: 100, category: "okänd" }),
      /Välj vad köpet gällde/
    );
    assert.throws(
      () => createManualExpense({ kind: "milersattning", date: DATE, paidBy: "privat", mileage: { km: 0, vehicle: "egen" } }),
      /hur långt du körde/
    );
    assert.equal(db().expenses.length, before, "inget sparades");
    assert.equal(db().verifications.length, 0);
  });

  it("ett köp över inventariegränsen bokförs inte – frågan ställs som för kvitton", () => {
    const limit = inventarieGransFor(DATE);
    const r = createManualExpense({
      kind: "kop",
      date: DATE,
      paidBy: "foretagskonto",
      supplier: "Hilti",
      amount: Math.round(limit * 1.25) + 1_000,
      vatAmount: Math.round(limit * 0.25) + 200,
      category: "verktyg",
    });
    assert.equal(r.askedAssetQuestion, true);
    assert.equal(r.verificationId, undefined);
    assert.equal(r.expense.status, "behover_svar");
    assert.match(r.expense.question?.text ?? "", /används i flera år/);
    assert.equal(db().verifications.length, 0);
    const actions = getBusinessActions().attention;
    assert.ok(
      actions.some((a) => a.href.includes(r.expense.id) || /Hilti/.test(`${a.title} ${a.subtitle}`)),
      "frågan ligger bland åtgärderna på Hem"
    );
  });

  it("ett dyrt köp i en kategori som aldrig är inventarie bokförs direkt", () => {
    const r = createManualExpense({
      kind: "kop",
      date: DATE,
      paidBy: "foretagskonto",
      supplier: "Fastighets AB",
      amount: 60_000,
      vatAmount: 0,
      category: "hyra",
    });
    assert.equal(r.askedAssetQuestion, false);
    assert.deepEqual(verificationNet(r.verificationId), { 5010: 60_000, 1930: -60_000 });
  });
});

/* ============================ Registret och ångra ============================ */

describe("Utgiftsregistret och ångra", () => {
  beforeEach(reset);

  it("raderna visar privat betalning, rätt slag och att de går att ångra", () => {
    const utlagg = createManualExpense({
      kind: "kop",
      date: DATE,
      paidBy: "privat",
      supplier: "Bauhaus",
      amount: 500,
      vatAmount: 100,
      category: "verktyg",
    });
    const mil = createManualExpense({ kind: "milersattning", date: DATE, paidBy: "privat", mileage: { km: 100, vehicle: "egen" } });
    const kop = createManualExpense({
      kind: "kop",
      date: DATE,
      paidBy: "foretagskonto",
      supplier: "Beijer",
      amount: 1_000,
      vatAmount: 200,
      category: "material",
    });
    const rows = listExpensesForTable().rows;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const u = byId.get(utlagg.expense.id)!;
    assert.equal(u.paidPrivately, true);
    assert.equal(u.undoable, true);
    assert.equal(u.categoryLabel, "Verktyg & förbrukning");
    assert.match(u.statusLabel, /privat/i);
    const m = byId.get(mil.expense.id)!;
    assert.equal(m.categoryLabel, "Milersättning");
    assert.equal(m.supplier, "Milersättning");
    assert.equal(m.amount, 250);
    assert.equal(m.paidPrivately, true);
    const k = byId.get(kop.expense.id)!;
    assert.ok(!k.paidPrivately);
    assert.equal(k.undoable, true);
    assert.equal(k.statusTone, "ok");
  });

  it("ångra en handregistrerad utgift: rättelse bokförs och raden försvinner med sitt kvitto", () => {
    const r = createManualExpense(
      { kind: "milersattning", date: DATE, paidBy: "privat", mileage: { km: 320, vehicle: "egen" } },
      { receipt: { id: "rc-mil", filename: "korjournal.pdf", contentType: "application/pdf" } }
    );
    assert.equal(ownerLiability().balance, 800);
    undoExpenseBooking(r.expense.id);
    assert.ok(!db().expenses.some((e) => e.id === r.expense.id), "utgiften är borta");
    assert.ok(!db().receipts.some((x) => x.id === "rc-mil"), "kvittot är borta");
    const original = db().verifications.find((v) => v.id === r.verificationId)!;
    assert.ok(original.correctedByVerificationId, "originalet är rättat");
    const correction = db().verifications.find((v) => v.id === original.correctedByVerificationId)!;
    assert.deepEqual(Object.fromEntries(correction.entries.map((e) => [e.account, e.debit - e.credit])), { 7331: -800, 2893: 800 });
    assert.equal(accountBalance(2893), 0);
    assert.equal(ownerLiability().balance, 0);
    assert.deepEqual(ownerLiability().openExpenses, []);
    assert.throws(() => undoExpenseBooking(r.expense.id), /inget att ångra/);
  });
});

/* ======================== Återbetalningen i banken ========================= */

describe("Återbetalning till ägaren i bankinkorgen", () => {
  beforeEach(reset);

  function bankTx(over: Partial<BankTransaction> & { amount: number; counterpart: string }): BankTransaction {
    const t: BankTransaction = {
      id: uid(),
      accountId: "acc-1",
      externalId: `ext-${uid()}`,
      date: `${TODAY}T09:00:00.000Z`,
      description: "Överföring",
      status: "ny",
      ...over,
    };
    registerBankTransactions([t]);
    return db().bankTransactions.find((x) => x.id === t.id)!;
  }

  it("en överföring på exakt hela skulden föreslås som återbetalning – inte som kostnad", () => {
    createManualExpense({ kind: "kop", date: DATE, paidBy: "privat", supplier: "Bauhaus", amount: 500, vatAmount: 100, category: "verktyg" });
    createManualExpense({ kind: "milersattning", date: DATE, paidBy: "privat", mileage: { km: 320, vehicle: "egen" } });
    assert.equal(ownerLiability().balance, 1_300);

    const tx = bankTx({ amount: -1_300, counterpart: "Anders Andersson" });
    assert.equal(tx.status, "behover_atgard");
    assert.ok(!db().expenses.some((e) => e.bankTransactionId === tx.id), "ingen 'kvitto saknas'-platshållare skapades");
    const s = bankKindSuggestion(tx);
    assert.equal(s?.kind, "aterbetalning_agare");
    assert.equal(s?.outcome, "SUGGEST");
    assert.match(plain(s?.reason), /exakt vad bolaget är skyldigt dig/);

    const booked = bookBankTransactionAs(tx.id, { kind: "aterbetalning_agare", matchReason: s?.reason });
    assert.deepEqual(verificationNet(booked.verificationId), { 2893: 1_300, 1930: -1_300 });
    assert.equal(ownerLiability().balance, 0);
    assert.equal(db().bankTransactions.find((x) => x.id === tx.id)?.status, "bokford");
  });

  it("en överföring på exakt en enskild privat utgift matchas mot den", () => {
    createManualExpense({ kind: "kop", date: DATE, paidBy: "privat", supplier: "Bauhaus", amount: 500, vatAmount: 100, category: "verktyg", description: "Bits" });
    createManualExpense({ kind: "milersattning", date: DATE, paidBy: "privat", mileage: { km: 320, vehicle: "egen" } });
    const tx = bankTx({ amount: -800, counterpart: "Anders Andersson" });
    const s = bankKindSuggestion(tx);
    assert.equal(s?.kind, "aterbetalning_agare");
    assert.match(s?.reason ?? "", /matchar Milersättning/);
  });

  it("belopp som varken är hela skulden eller en enskild utgift föreslås inte som återbetalning", () => {
    createManualExpense({ kind: "kop", date: DATE, paidBy: "privat", supplier: "Bauhaus", amount: 500, vatAmount: 100, category: "verktyg" });
    createManualExpense({ kind: "kop", date: DATE, paidBy: "privat", supplier: "Clas Ohlson", amount: 500, vatAmount: 100, category: "verktyg" });
    // Två utgifter på 500 → tvetydigt; 999 matchar inget alls; 5 000 är mer än skulden.
    for (const amount of [-500, -999, -5_000]) {
      const tx = bankTx({ amount, counterpart: "Anders Andersson", description: "Överföring till eget konto" });
      assert.notEqual(bankKindSuggestion(tx)?.kind, "aterbetalning_agare", `${amount}`);
    }
  });

  it("utan skuld till ägaren finns inget att föreslå", () => {
    const tx = bankTx({ amount: -1_300, counterpart: "Anders Andersson", description: "Överföring till eget konto" });
    assert.notEqual(bankKindSuggestion(tx)?.kind, "aterbetalning_agare");
  });
});
