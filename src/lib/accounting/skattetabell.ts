import table2026 from "./skattetabeller/2026.json";

/**
 * Skatteverkets skattetabeller, kolumn 1 (månadslön). Beloppen är lagrade
 * per inkomstår. Formuläret föreslår avdraget; användaren kan skriva över.
 */

interface YearTable {
  year: number;
  column: number;
  salaries: number[];
  tables: Record<string, number[]>;
}

const YEARS: Record<number, YearTable> = {
  2026: table2026 as YearTable,
};

export function taxTableDeduction(year: number, table: number, monthlySalary: number): number | undefined {
  const pack = YEARS[year] ?? YEARS[2026];
  if (!pack) return undefined;
  const row = pack.tables[String(table)];
  if (!row || row.length === 0) return undefined;
  const salary = Math.round(monthlySalary);
  const salaries = pack.salaries;
  if (salary <= salaries[0]) return row[0];
  if (salary >= salaries[salaries.length - 1]) return row[row.length - 1];
  for (let i = 1; i < salaries.length; i++) {
    if (salary === salaries[i]) return row[i];
    if (salary < salaries[i]) {
      const span = salaries[i] - salaries[i - 1];
      const t = (salary - salaries[i - 1]) / span;
      return Math.round(row[i - 1] + (row[i] - row[i - 1]) * t);
    }
  }
  return undefined;
}
