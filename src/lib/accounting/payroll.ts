import { db, save } from "../store";
import { uid } from "../ids";
import { birthDateFromPersonnummer, normalizePersonnummer } from "../personnummer";
import type { Employee, EmployerDeclaration, PayrollRun, Verification } from "../types";
import { logAudit } from "./audit";
import { bokforingsdatum, todayDate } from "./dates";
import { createCorrection, postVerification } from "./engine";
import { fiscalYearFor, lockPeriod } from "./fiscal";
import {
  agiDueDate,
  computePayroll,
  contributionAgeError,
  employeeInputErrors,
  isMonthKey,
  monthEnd,
  monthLabel,
  nextMonthKey,
  salaryAccountFor,
  taxBasisLabel,
  ARBETSGIVARAVGIFT,
  FORETAGSKONTO,
  PERSONALSKATT,
  SOCIALA_AVGIFTER,
  type EmployeeInput,
} from "./payroll-model";
import { bookEmployerTaxesOnTaxAccount } from "./tax-account";

export * from "./payroll-model";

/**
 * Lön till ägaren och arbetsgivardeklarationen.
 *
 * Lönen är produktens första månatliga myndighetsskyldighet: tolv tillfällen om
 * året där en missad deklaration kostar pengar. Därför är kedjan sluten –
 * lönekörningen bokförs, deklarationen fryser siffrorna ur bokföringen, och
 * samma belopp förs till skattekontot. Ingen del räknar om på egen hand.
 *
 * Standardlönedag är den 25:e, det vanliga i svenska bolag.
 */
const DEFAULT_PAY_DAY = 25;

export function employees(): Employee[] {
  return db().employees ?? [];
}

/** Den anställde lönen gäller. V1 är en anställd: ägaren. */
export function currentEmployee(): Employee | undefined {
  return employees().find((e) => e.status === "anstalld");
}

export function employeeById(id: string): Employee | undefined {
  return employees().find((e) => e.id === id);
}

/** Födelsedatumet ur personnummret – enda källan för åldersregeln. */
export function birthDateOf(employee: Employee): string {
  const d = birthDateFromPersonnummer(employee.personnummer);
  if (!d) throw new Error(`Personnummret för ${employee.name} går inte att tolka – rätta det under Lön.`);
  return d;
}

/**
 * Lägg upp eller ändra den anställde. Ändringar gäller framåt: redan bokförda
 * lönekörningar bär sina egna belopp och rörs aldrig.
 */
export function saveEmployee(
  input: EmployeeInput & { id?: string },
  actor: "anvandare" | "assistent"
): Employee {
  const data = db();
  const normalized: EmployeeInput = {
    ...input,
    name: input.name.trim(),
    personnummer: normalizePersonnummer(input.personnummer),
    email: input.email?.trim() || undefined,
    monthlySalary: Math.round(input.monthlySalary),
  };
  const errors = employeeInputErrors(normalized, todayDate());
  if (errors.length) throw new Error(errors.join(" "));

  data.employees ??= [];
  const existing = input.id ? data.employees.find((e) => e.id === input.id) : undefined;
  if (input.id && !existing) throw new Error("Den anställde finns inte.");

  if (!existing) {
    const other = data.employees.find((e) => e.status === "anstalld");
    if (other) {
      throw new Error(
        `${other.name} är redan upplagd som anställd. Driva stöder en anställd – avsluta anställningen först.`
      );
    }
  }

  const employee: Employee = existing
    ? Object.assign(existing, {
        name: normalized.name,
        personnummer: normalized.personnummer,
        role: normalized.role,
        monthlySalary: normalized.monthlySalary,
        taxBasis: normalized.taxBasis,
        startDate: normalized.startDate,
        ...(normalized.email ? { email: normalized.email } : {}),
      })
    : {
        id: uid(),
        name: normalized.name,
        personnummer: normalized.personnummer,
        ...(normalized.email ? { email: normalized.email } : {}),
        role: normalized.role,
        monthlySalary: normalized.monthlySalary,
        taxBasis: normalized.taxBasis,
        startDate: normalized.startDate,
        status: "anstalld" as const,
        createdAt: new Date().toISOString(),
      };
  if (!existing) data.employees.push(employee);
  if (existing && !normalized.email) delete employee.email;

  logAudit(
    actor,
    "anstalld_andrad",
    `${employee.name} ${existing ? "ändrades" : "lades upp"} som anställd: ${employee.monthlySalary} kr/månad, skatteavdrag ${taxBasisLabel(employee.taxBasis)}.`,
    { targetType: "anstalld", targetId: employee.id }
  );
  save();
  return employee;
}

/** Avsluta anställningen. Lönehistoriken och deklarationerna står kvar. */
export function endEmployment(id: string, endDate: string, actor: "anvandare" | "assistent"): Employee {
  const employee = employeeById(id);
  if (!employee) throw new Error("Den anställde finns inte.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error("Slutdatum anges som YYYY-MM-DD.");
  if (endDate < employee.startDate) throw new Error("Slutdatumet kan inte ligga före anställningens första dag.");
  employee.status = "avslutad";
  employee.endDate = endDate;
  logAudit(actor, "anstalld_andrad", `Anställningen för ${employee.name} avslutades ${endDate}.`, {
    targetType: "anstalld",
    targetId: employee.id,
  });
  save();
  return employee;
}

/* ------------------------------ Lönekörningar ----------------------------- */

export function payrollRuns(): PayrollRun[] {
  return db().payrollRuns ?? [];
}

export function payrollRunsForMonth(month: string): PayrollRun[] {
  return payrollRuns().filter((r) => r.month === month);
}

export function payrollRunById(id: string): PayrollRun | undefined {
  return payrollRuns().find((r) => r.id === id);
}

export function defaultPayDate(month: string): string {
  return `${month}-${DEFAULT_PAY_DAY}`;
}

/**
 * Bokför månadens lön. En månad körs bara en gång per anställd – körs den igen
 * returneras den befintliga körningen i stället för att lönen dubbleras.
 */
export function runPayroll(
  args: { employeeId?: string; month: string; payDate?: string },
  actor: "anvandare" | "assistent"
): PayrollRun {
  const data = db();
  if (!isMonthKey(args.month)) throw new Error("Lönemånaden anges som YYYY-MM.");
  const employee = args.employeeId ? employeeById(args.employeeId) : currentEmployee();
  if (!employee) throw new Error("Ingen anställd är upplagd – lägg upp lönen under Bokföring › Lön först.");

  const existing = payrollRuns().find((r) => r.month === args.month && r.employeeId === employee.id);
  if (existing) return existing;

  const payDate = args.payDate ?? defaultPayDate(args.month);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate)) throw new Error("Utbetalningsdagen anges som YYYY-MM-DD.");
  if (args.month < employee.startDate.slice(0, 7)) {
    throw new Error(
      `Anställningen började ${employee.startDate} – lön för ${monthLabel(args.month)} kan inte bokföras.`
    );
  }
  if (employee.endDate && args.month > employee.endDate.slice(0, 7)) {
    throw new Error(`Anställningen slutade ${employee.endDate} – lön för ${monthLabel(args.month)} kan inte bokföras.`);
  }
  const declaration = employerDeclarationFor(args.month);
  if (declaration?.status === "deklarerad") {
    throw new Error(
      `Arbetsgivardeklarationen för ${monthLabel(args.month)} är redan lämnad – lönen för månaden kan inte ändras.`
    );
  }

  const birthDate = birthDateOf(employee);
  const incomeYear = Number(payDate.slice(0, 4));
  const ageError = contributionAgeError(birthDate, incomeYear);
  if (ageError) throw new Error(ageError);

  const calc = computePayroll({
    gross: employee.monthlySalary,
    taxBasis: employee.taxBasis,
    birthDate,
    incomeYear,
  });
  if (calc.gross <= 0) throw new Error("Månadslönen är noll – ingenting att bokföra.");

  const salaryAccount = salaryAccountFor(employee.role);
  const ver = postVerification({
    date: payDate,
    description: `Lön ${monthLabel(args.month)} ${employee.name}`,
    entries: [
      { account: salaryAccount, debit: calc.gross },
      ...(calc.contribution > 0 ? [{ account: SOCIALA_AVGIFTER, debit: calc.contribution }] : []),
      ...(calc.tax > 0 ? [{ account: PERSONALSKATT, credit: calc.tax }] : []),
      ...(calc.contribution > 0 ? [{ account: ARBETSGIVARAVGIFT, credit: calc.contribution }] : []),
      { account: FORETAGSKONTO, credit: calc.net },
    ],
    source: { type: "lon", id: `${employee.id}-${args.month}` },
    createdBy: actor,
    explanation:
      `Bruttolön ${calc.gross} kr för ${monthLabel(args.month)}. ${calc.tax} kr drogs i preliminärskatt (${calc.taxLabel}) och ` +
      `${calc.net} kr betalades ut. ${calc.rate.reason} Skatten och avgifterna står som skuld till Skatteverket till ` +
      `arbetsgivardeklarationen lämnas.`,
  });

  const run: PayrollRun = {
    id: uid(),
    employeeId: employee.id,
    month: args.month,
    payDate,
    gross: calc.gross,
    tax: calc.tax,
    net: calc.net,
    employerContribution: calc.contribution,
    contributionPercent: calc.rate.percent,
    taxBasis: employee.taxBasis,
    salaryAccount,
    verificationId: ver.id,
    createdBy: actor,
    createdAt: new Date().toISOString(),
  };
  data.payrollRuns ??= [];
  data.payrollRuns.push(run);

  // Utkastet till deklarationen speglar bokföringen direkt, så beloppet syns
  // som kommande skyldighet redan innan månaden är slut.
  generateEmployerDeclaration(args.month, actor, { silent: true });

  logAudit(
    actor,
    "lon_bokford",
    `Lön för ${monthLabel(args.month)} bokfördes: ${calc.gross} kr brutto, ${calc.tax} kr skatt, ${calc.net} kr netto.`,
    { targetType: "lonekorning", targetId: run.id }
  );
  save();
  return run;
}

/**
 * Återför en felaktig lönekörning. Verifikationen står kvar och återförs med en
 * rättelse – bokföring skrivs aldrig om – och löneraden tas bort så att månaden
 * kan köras om med rätt belopp.
 */
export function reversePayrollRun(runId: string, reason: string, actor: "anvandare" | "assistent"): Verification {
  const data = db();
  const run = payrollRunById(runId);
  if (!run) throw new Error("Lönekörningen finns inte.");
  if (!reason.trim()) throw new Error("Skriv varför lönen återförs – rättelsen ska gå att förstå i efterhand.");
  const declaration = employerDeclarationFor(run.month);
  if (declaration?.status === "deklarerad") {
    throw new Error(
      `Arbetsgivardeklarationen för ${monthLabel(run.month)} är lämnad. Lönen kan inte återföras – rätta i stället genom en ny deklaration hos Skatteverket.`
    );
  }

  const { reversal } = createCorrection({
    verificationId: run.verificationId,
    reason: `lön ${monthLabel(run.month)} – ${reason.trim()}`,
    by: actor,
  });
  data.payrollRuns = payrollRuns().filter((r) => r.id !== runId);
  generateEmployerDeclaration(run.month, actor, { silent: true });
  logAudit(actor, "lon_bokford", `Lönen för ${monthLabel(run.month)} återfördes: ${reason.trim()}`, {
    targetType: "lonekorning",
    targetId: run.id,
  });
  save();
  return reversal;
}

/**
 * Månader i det öppna räkenskapsåret där lönen ska ha betalats men inte är
 * bokförd. Innevarande månad räknas först när lönedagen passerat.
 */
export function payrollMonthsAwaitingRun(through: string = todayDate()): string[] {
  const employee = currentEmployee();
  if (!employee) return [];
  const fy = fiscalYearFor(through);
  if (!fy) return [];
  const months: string[] = [];
  const first = maxMonth(fy.startDate.slice(0, 7), employee.startDate.slice(0, 7));
  const last = employee.endDate ? minMonth(fy.endDate.slice(0, 7), employee.endDate.slice(0, 7)) : fy.endDate.slice(0, 7);
  for (let m = first; m <= last; m = nextMonthKey(m)) {
    if (defaultPayDate(m) > through) break;
    if (!payrollRuns().some((r) => r.month === m && r.employeeId === employee.id)) months.push(m);
  }
  return months;
}

function maxMonth(a: string, b: string): string {
  return a >= b ? a : b;
}

function minMonth(a: string, b: string): string {
  return a <= b ? a : b;
}

/* --------------------------- Lönespecifikation ---------------------------- */

export interface PayslipYearToDate {
  gross: number;
  tax: number;
  net: number;
}

export interface Payslip {
  run: PayrollRun;
  employee: Employee;
  monthLabel: string;
  /** Ackumulerat under kalenderåret till och med den här körningen. */
  yearToDate: PayslipYearToDate;
  /** Satsen och regeln som gav arbetsgivaravgiften. */
  contributionReason: string;
  taxLabel: string;
}

/**
 * Lönespecifikationen till den anställde. Härledd ur den bokförda körningen –
 * specifikationen kan aldrig visa andra tal än de som är bokförda.
 */
export function payslip(runId: string): Payslip {
  const run = payrollRunById(runId);
  if (!run) throw new Error("Lönekörningen finns inte.");
  const employee = employeeById(run.employeeId);
  if (!employee) throw new Error("Den anställde finns inte längre.");
  const year = run.payDate.slice(0, 4);
  const earlier = payrollRuns().filter(
    (r) => r.employeeId === run.employeeId && r.payDate.slice(0, 4) === year && r.month <= run.month
  );
  const birthDate = birthDateFromPersonnummer(employee.personnummer);
  const calc = birthDate
    ? computePayroll({ gross: run.gross, taxBasis: run.taxBasis, birthDate, incomeYear: Number(year) })
    : undefined;
  return {
    run,
    employee,
    monthLabel: monthLabel(run.month),
    yearToDate: {
      gross: earlier.reduce((s, r) => s + r.gross, 0),
      tax: earlier.reduce((s, r) => s + r.tax, 0),
      net: earlier.reduce((s, r) => s + r.net, 0),
    },
    contributionReason: calc?.rate.reason ?? `Arbetsgivaravgift ${run.contributionPercent} %.`,
    taxLabel: taxBasisLabel(run.taxBasis),
  };
}

/* ----------------------- Arbetsgivardeklaration (AGI) --------------------- */

export function employerDeclarations(): EmployerDeclaration[] {
  return db().employerDeclarations ?? [];
}

export function employerDeclarationFor(month: string): EmployerDeclaration | undefined {
  return employerDeclarations().find((d) => d.month === month);
}

export function employerDeclarationById(id: string): EmployerDeclaration | undefined {
  return employerDeclarations().find((d) => d.id === id);
}

/**
 * Utkast till arbetsgivardeklaration, räknat ur de bokförda lönekörningarna för
 * månaden. Utkastet räknas om varje gång; en lämnad deklaration är låst.
 */
export function generateEmployerDeclaration(
  month: string,
  actor: "anvandare" | "assistent",
  opts: { silent?: boolean } = {}
): EmployerDeclaration {
  if (!isMonthKey(month)) throw new Error("Månaden anges som YYYY-MM.");
  const data = db();
  data.employerDeclarations ??= [];
  const existing = employerDeclarationFor(month);
  if (existing?.status === "deklarerad") return existing;

  const runs = payrollRunsForMonth(month);
  const rows = runs.map((r) => {
    const employee = employeeById(r.employeeId);
    return {
      employeeId: r.employeeId,
      name: employee?.name ?? "Okänd anställd",
      personnummer: employee?.personnummer ?? "",
      gross: r.gross,
      tax: r.tax,
      employerContribution: r.employerContribution,
    };
  });
  const gross = sum(rows.map((r) => r.gross));
  const tax = sum(rows.map((r) => r.tax));
  const employerContribution = sum(rows.map((r) => r.employerContribution));

  const declaration: EmployerDeclaration = existing
    ? Object.assign(existing, {
        rows,
        gross,
        tax,
        employerContribution,
        attBetala: tax + employerContribution,
        generatedAt: new Date().toISOString(),
      })
    : {
        id: uid(),
        month,
        label: monthLabel(month),
        status: "utkast" as const,
        rows,
        gross,
        tax,
        employerContribution,
        attBetala: tax + employerContribution,
        dueDate: agiDueDate(month),
        generatedAt: new Date().toISOString(),
      };
  if (!existing) data.employerDeclarations.push(declaration);

  if (!opts.silent) {
    logAudit(
      actor,
      "arbetsgivardeklaration_genererad",
      `Utkast till arbetsgivardeklaration för ${declaration.label}: ${declaration.attBetala} kr att betala.`,
      { targetType: "arbetsgivardeklaration", targetId: declaration.id }
    );
    save();
  }
  return declaration;
}

/**
 * Markera arbetsgivardeklarationen som lämnad. Samma statusmaskin som momsen:
 * siffrorna fryses, avgifterna och personalskatten förs till skattekontot,
 * händelsen auditloggas och månaden låses så att lönen inte kan ändras efter
 * att den redovisats till Skatteverket.
 *
 * En månad utan lön deklareras som nollredovisning – skyldigheten finns kvar när
 * bolaget är registrerat som arbetsgivare, men det finns ingenting att bokföra.
 */
export function markEmployerDeclarationDeclared(
  id: string,
  actor: "anvandare" | "assistent"
): EmployerDeclaration {
  const declaration = employerDeclarationById(id);
  if (!declaration) throw new Error("Arbetsgivardeklarationen finns inte.");
  if (declaration.status === "deklarerad") return declaration;

  const today = todayDate();
  const end = monthEnd(declaration.month);
  if (end >= today) {
    throw new Error(
      `${declaration.label} pågår fortfarande (till ${end}) – deklarationen kan lämnas först när månaden är slut.`
    );
  }
  const earlier = undeclaredEarlierMonths(declaration);
  if (earlier.length) {
    throw new Error(
      `Lämna månaderna i ordning: ${earlier.map((d) => d.label).join(", ")} har lön men är inte deklarerad${earlier.length > 1 ? "e" : ""} ännu.`
    );
  }

  // Frys siffrorna mot bokföringen vid deklarationstillfället.
  const fresh = generateEmployerDeclaration(declaration.month, actor, { silent: true });
  if (fresh.attBetala > 0) {
    const ver = bookEmployerTaxesOnTaxAccount(declaration.month, actor);
    declaration.taxAccountVerificationId = ver.id;
  }
  declaration.status = "deklarerad";
  declaration.declaredAt = new Date().toISOString();
  logAudit(
    actor,
    "arbetsgivardeklaration_deklarerad",
    `Arbetsgivardeklarationen för ${declaration.label} markerades som lämnad (${declaration.attBetala} kr).`,
    { targetType: "arbetsgivardeklaration", targetId: declaration.id }
  );
  lockPeriod(end, actor);
  save();
  return declaration;
}

/** Tidigare månader med lön som inte är deklarerade – ordningen ska hållas. */
function undeclaredEarlierMonths(declaration: EmployerDeclaration): EmployerDeclaration[] {
  const months = new Set(payrollRuns().map((r) => r.month));
  return employerDeclarations()
    .filter((d) => d.month < declaration.month && d.status !== "deklarerad" && months.has(d.month))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Månader där arbetsgivardeklarationen ska lämnas men inte är lämnad. Månaden
 * måste vara slut, och lönen för den ska vara bokförd – annars är det lönen som
 * är nästa steg, inte deklarationen.
 */
export function employerDeclarationsAwaitingFiling(through: string = todayDate()): EmployerDeclaration[] {
  return employerDeclarations()
    .filter((d) => d.status === "utkast" && monthEnd(d.month) < through && d.rows.length > 0)
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** Lönekostnad och avgifter för en period – underlag till bokslut och noter. */
export function payrollTotals(from: string, to: string): { gross: number; tax: number; contribution: number; months: number } {
  const runs = payrollRuns().filter((r) => {
    const d = bokforingsdatum(r.payDate);
    return d >= from && d <= to;
  });
  return {
    gross: sum(runs.map((r) => r.gross)),
    tax: sum(runs.map((r) => r.tax)),
    contribution: sum(runs.map((r) => r.employerContribution)),
    months: new Set(runs.map((r) => r.month)).size,
  };
}

function sum(values: number[]): number {
  return values.reduce((s, v) => s + v, 0);
}
