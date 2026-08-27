import type { DB } from "../types";
import { bokforingsdatum, calendarFiscalYear } from "./dates";

/**
 * Migrering/backfill för bokföringsmotorn. Körs i store.normalize() – på
 * både befintliga db.json-filer och nybyggd seed – och är idempotent.
 *
 *  1. Nya samlingar och fält får sina standardvärden.
 *  2. Verifikationer får status/postedAt/fiscalYearId (alla historiska är bokförda).
 *  3. Räkenskapsår (kalenderår) skapas för alla år som har verifikationer.
 *  4. Första årets ingående balans härleds så att banken stämmer mot 1930:
 *     IB(1930) = bankens saldo − bokförda 1930-rörelser − ohanterade banktransaktioner.
 *     Motposten läggs på eget kapital (2081 Aktiekapital + 2091 Balanserat resultat),
 *     så att både balansräkningen och bankavstämningen går ihop från dag ett.
 *
 * Befintliga relationer (fakturor ↔ verifikationer, utgifter, betalningar)
 * lämnas orörda.
 */
export function migrateAccounting(data: DB): boolean {
  let changed = false;

  if (!data.fiscalYears) {
    data.fiscalYears = [];
    changed = true;
  }
  if (!data.accounting) {
    data.accounting = {};
    changed = true;
  }
  for (const key of ["vatReports", "assets", "accruals", "auditTrail", "annualReports"] as const) {
    if (!data[key]) {
      (data as unknown as Record<string, unknown>)[key] = [];
      changed = true;
    }
  }
  if (!data.settings.companyForm) {
    data.settings.companyForm = "ab";
    changed = true;
  }

  // Verifikationsfält.
  for (const v of data.verifications) {
    if (!v.status) {
      v.status = "bokford";
      changed = true;
    }
    if (!v.postedAt) {
      v.postedAt = v.createdAt;
      changed = true;
    }
  }

  // Räkenskapsår för alla år med verifikationer + innevarande år.
  const years = new Set<number>();
  for (const v of data.verifications) years.add(Number(bokforingsdatum(v.date).slice(0, 4)));
  years.add(Number(bokforingsdatum(new Date().toISOString()).slice(0, 4)));
  const firstMigration = data.fiscalYears.length === 0;
  for (const year of [...years].sort()) {
    if (!data.fiscalYears.some((f) => f.startDate <= `${year}-06-15` && `${year}-06-15` <= f.endDate)) {
      data.fiscalYears.push(calendarFiscalYear(year));
      changed = true;
    }
  }
  data.fiscalYears.sort((a, b) => a.startDate.localeCompare(b.startDate));

  // Koppla verifikationer till sina räkenskapsår.
  for (const v of data.verifications) {
    if (!v.fiscalYearId) {
      const d = bokforingsdatum(v.date);
      const fy = data.fiscalYears.find((f) => f.startDate <= d && d <= f.endDate);
      if (fy) {
        v.fiscalYearId = fy.id;
        changed = true;
      }
    }
  }

  // Ingående balans för det första året (endast vid första migreringen).
  if (firstMigration && data.fiscalYears.length > 0) {
    const first = data.fiscalYears[0];
    if (Object.keys(first.openingBalances).length === 0) {
      const ib = deriveOpeningBalances(data);
      if (Object.keys(ib).length > 0) {
        first.openingBalances = ib;
        first.openingSource = "migrering";
        changed = true;
      }
    }
  }

  return changed;
}

function deriveOpeningBalances(data: DB): Record<string, number> {
  const bankBalance = data.bankAccounts.reduce((s, a) => s + a.balance, 0);
  if (bankBalance === 0 && data.verifications.length === 0) return {};

  let booked1930 = 0;
  for (const v of data.verifications) {
    for (const e of v.entries) {
      if (e.account === 1930) booked1930 += e.debit - e.credit;
    }
  }
  const unbooked = data.bankTransactions
    .filter((t) => t.status !== "bokford")
    .reduce((s, t) => s + t.amount, 0);

  const ib1930 = bankBalance - booked1930 - unbooked;
  if (ib1930 === 0) return {};

  const opening: Record<string, number> = { "1930": ib1930 };
  const isAb = (data.settings.companyForm ?? "ab") === "ab";
  if (ib1930 > 0) {
    if (isAb) {
      const aktiekapital = Math.min(25_000, ib1930);
      opening["2081"] = -aktiekapital;
      if (ib1930 - aktiekapital !== 0) opening["2091"] = -(ib1930 - aktiekapital);
    } else {
      opening["2010"] = -ib1930;
    }
  } else {
    opening[isAb ? "2091" : "2010"] = -ib1930;
  }
  return opening;
}
