"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Check, Eye, FileText, Pencil, Undo2, UserRound, Wallet } from "lucide-react";
import { buttonClasses, Card, cx } from "./ui";
import { DateField } from "./date-field";
import { kr } from "@/lib/format";
import {
  endEmploymentAction,
  generateEmployerDeclarationAction,
  markEmployerDeclarationDeclaredAction,
  reversePayrollRunAction,
  revealEmployeePersonnummerAction,
  runPayrollAction,
  saveEmployeeAction,
} from "@/app/bokforing-actions";
import {
  computePayroll,
  monthLabel,
  skatteverketTableUrl,
  TAX_TABLE_MAX,
  TAX_TABLE_MIN,
} from "@/lib/accounting/payroll-model";
import { birthDateFromPersonnummer } from "@/lib/personnummer";
import type { Employee, EmployeeRole, TaxBasis } from "@/lib/types";

/** Klientwidgets för lönen. Beräkningarna kommer från payroll-model. */

const fieldCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2.5 text-[14px] text-ink placeholder:text-muted focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-soft";

function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="mt-2 text-[13px] font-medium text-danger">{error}</p>;
}

function amount(value: string): number {
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

/**
 * Lägg upp eller ändra den anställde. Förhandsvisningen räknar med samma modul
 * som bokföringen, så det som visas är det som kommer att bokföras.
 */
export function EmployeeForm({ employee, today }: { employee?: Employee; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(!employee);
  const [name, setName] = useState(employee?.name ?? "");
  const [personnummer, setPersonnummer] = useState(employee?.personnummer ?? "");
  const [email, setEmail] = useState(employee?.email ?? "");
  const [role, setRole] = useState<EmployeeRole>(employee?.role ?? "foretagsledare");
  const [salary, setSalary] = useState(employee ? String(employee.monthlySalary) : "");
  const [basisKind, setBasisKind] = useState<TaxBasis["kind"]>(employee?.taxBasis.kind ?? "tabell");
  const [table, setTable] = useState(
    employee?.taxBasis.kind === "tabell" ? String(employee.taxBasis.table) : "33"
  );
  const [deduction, setDeduction] = useState(
    employee?.taxBasis.kind === "tabell" ? String(employee.taxBasis.monthlyDeduction) : ""
  );
  const [percent, setPercent] = useState(
    employee?.taxBasis.kind === "procent" ? String(employee.taxBasis.percent) : "30"
  );
  const [startDate, setStartDate] = useState(employee?.startDate ?? `${today.slice(0, 8)}01`);
  const [error, setError] = useState<string | null>(null);

  const gross = amount(salary);
  const basis: TaxBasis =
    basisKind === "tabell"
      ? {
          kind: "tabell",
          table: Number(table) || 0,
          monthlyDeduction: amount(deduction),
          salaryAtLookup: gross,
        }
      : { kind: "procent", percent: Number(percent.replace(",", ".")) || 0 };
  const birthDate = birthDateFromPersonnummer(personnummer, today);
  const preview =
    gross > 0 && birthDate
      ? computePayroll({ gross, taxBasis: basis, birthDate, incomeYear: Number(startDate.slice(0, 4) || today.slice(0, 4)) })
      : null;

  if (!open) {
    return (
      <button className={buttonClasses("secondary", "sm")} onClick={() => setOpen(true)}>
        <Pencil className="size-3.5" />
        Ändra lönen
      </button>
    );
  }

  return (
    <Card className="px-6 py-5">
      <div className="flex items-center gap-2.5">
        <UserRound className="size-4.5 text-muted" />
        <h3 className="text-[15px] font-semibold">{employee ? "Ändra den anställde" : "Lägg upp lönen"}</h3>
      </div>
      <p className="mt-1 text-[13px] text-soft">
        Ändringar gäller framåt. Redan bokförda löner bär sina egna belopp och rörs aldrig.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="lon-namn">
            Namn
          </label>
          <input
            id="lon-namn"
            className={fieldCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Anna Ek"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="lon-pnr">
            Personnummer
          </label>
          <input
            id="lon-pnr"
            className={fieldCls}
            value={personnummer}
            onChange={(e) => setPersonnummer(e.target.value)}
            placeholder="ÅÅÅÅMMDD-NNNN"
            inputMode="numeric"
          />
          <p className="mt-1 text-[12px] text-muted">
            Styr arbetsgivaravgiften. {birthDate ? `Född ${birthDate}.` : "Skrivs som ÅÅÅÅMMDD-NNNN."}
          </p>
        </div>
        <div>
          <label className={labelCls} htmlFor="lon-roll">
            Roll
          </label>
          <select
            id="lon-roll"
            className={fieldCls}
            value={role}
            onChange={(e) => setRole(e.target.value as EmployeeRole)}
          >
            <option value="foretagsledare">Företagsledare (konto 7220)</option>
            <option value="tjansteman">Tjänsteman (konto 7210)</option>
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="lon-belopp">
            Månadslön före skatt
          </label>
          <input
            id="lon-belopp"
            className={fieldCls}
            value={salary}
            onChange={(e) => setSalary(e.target.value)}
            placeholder="40 000"
            inputMode="numeric"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="lon-epost">
            E-post <span className="font-normal text-muted">(valfritt)</span>
          </label>
          <input
            id="lon-epost"
            className={fieldCls}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="anna@exempel.se"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="lon-start">
            Anställd sedan
          </label>
          <DateField id="lon-start" value={startDate} onChange={setStartDate} />
        </div>
      </div>

      <div className="mt-5 border-t border-line/60 pt-4">
        <p className={labelCls}>Skatteavdrag</p>
        <div className="flex flex-wrap gap-2">
          <BasisTab active={basisKind === "tabell"} onClick={() => setBasisKind("tabell")} label="Skattetabell" />
          <BasisTab active={basisKind === "procent"} onClick={() => setBasisKind("procent")} label="Fast procent" />
        </div>
        {basisKind === "tabell" ? (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="lon-tabell">
                Tabellnummer
              </label>
              <input
                id="lon-tabell"
                className={fieldCls}
                value={table}
                onChange={(e) => setTable(e.target.value)}
                inputMode="numeric"
              />
              <p className="mt-1 text-[12px] text-muted">
                {TAX_TABLE_MIN}–{TAX_TABLE_MAX}, enligt kommunens skattesats. Står i Skatteverkets beslut.
              </p>
            </div>
            <div>
              <label className={labelCls} htmlFor="lon-avdrag">
                Skatteavdrag enligt tabellen
              </label>
              <input
                id="lon-avdrag"
                className={fieldCls}
                value={deduction}
                onChange={(e) => setDeduction(e.target.value)}
                placeholder="9 412"
                inputMode="numeric"
              />
              <p className="mt-1 text-[12px] text-muted">
                Slå upp raden för {gross > 0 ? kr(gross) : "månadslönen"} i{" "}
                <a
                  className="underline decoration-line-strong underline-offset-2 hover:decoration-accent"
                  href={skatteverketTableUrl()}
                  target="_blank"
                  rel="noreferrer"
                >
                  tabell {table || TAX_TABLE_MIN}
                </a>{" "}
                och skriv in beloppet. Driva räknar aldrig fram skatt på egen hand – avdraget ska vara Skatteverkets.
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-3 sm:w-1/2">
            <label className={labelCls} htmlFor="lon-procent">
              Procent av bruttolönen
            </label>
            <input
              id="lon-procent"
              className={fieldCls}
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              inputMode="decimal"
            />
            <p className="mt-1 text-[12px] text-muted">
              Används vid beslut om särskild beräkningsgrund (jämkning) och vid sidoinkomst.
            </p>
          </div>
        )}
      </div>

      {preview ? (
        <dl className="mt-5 grid gap-3 border-t border-line/60 pt-4 text-[13px] sm:grid-cols-4">
          <div>
            <dt className="text-[12px] text-muted">Bruttolön</dt>
            <dd className="tabular font-semibold">{kr(preview.gross)}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted">Skatt</dt>
            <dd className="tabular font-semibold">{kr(preview.tax)}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted">Netto till den anställde</dt>
            <dd className="tabular font-semibold">{kr(preview.net)}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted">{preview.rate.label}</dt>
            <dd className="tabular font-semibold">{kr(preview.contribution)}</dd>
          </div>
          <p className="text-[12px] text-muted sm:col-span-4">
            {preview.rate.reason} Bolagets totala kostnad blir {kr(preview.gross + preview.contribution)} per månad.
          </p>
        </dl>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          className={buttonClasses("primary", "sm")}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await saveEmployeeAction({
                ...(employee ? { id: employee.id } : {}),
                name,
                personnummer,
                email: email || undefined,
                role,
                monthlySalary: gross,
                taxBasis: basis,
                startDate,
              });
              if (!res.ok) {
                setError(res.error);
                return;
              }
              setError(null);
              if (employee) setOpen(false);
              router.refresh();
            })
          }
        >
          {pending ? "Sparar …" : employee ? "Spara ändringen" : "Lägg upp lönen"}
        </button>
        {employee ? (
          <button className={buttonClasses("ghost", "sm")} disabled={pending} onClick={() => setOpen(false)}>
            Avbryt
          </button>
        ) : null}
      </div>
      <ErrorNote error={error} />
    </Card>
  );
}

function BasisTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "rounded-full border px-3 py-1.5 text-[13px] font-medium",
        active ? "border-accent bg-accent/10 text-ink" : "border-line text-soft hover:border-line-strong"
      )}
    >
      {label}
    </button>
  );
}

export function RunPayrollButton({ month, gross }: { month: string; gross: number }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        className={buttonClasses("primary", "sm")}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await runPayrollAction(month);
            setError(res.ok ? null : res.error);
          })
        }
      >
        <Wallet className="size-3.5" />
        {pending ? "Bokför …" : `Bokför lön ${monthLabel(month)}`}
      </button>
      <p className="mt-1.5 text-[12px] text-muted">
        {kr(gross)} före skatt. Lönen bokförs, skatten och avgifterna blir en skuld till Skatteverket fram till
        arbetsgivardeklarationen.
      </p>
      <ErrorNote error={error} />
    </div>
  );
}

export function ReversePayrollButton({ runId, label }: { runId: string; label: string }) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <button className={buttonClasses("ghost", "sm")} onClick={() => setOpen(true)}>
        <Undo2 className="size-3.5" />
        Återför
      </button>
    );
  }
  return (
    <div className="min-w-56">
      <label className={labelCls} htmlFor={`ater-${runId}`}>
        Varför återförs lönen för {label}?
      </label>
      <input
        id={`ater-${runId}`}
        className={fieldCls}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Fel månadslön"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          className={buttonClasses("secondary", "sm")}
          disabled={pending || reason.trim() === ""}
          onClick={() =>
            startTransition(async () => {
              const res = await reversePayrollRunAction(runId, reason);
              if (!res.ok) {
                setError(res.error);
                return;
              }
              setOpen(false);
              setReason("");
              setError(null);
            })
          }
        >
          {pending ? "Återför …" : "Återför lönen"}
        </button>
        <button className={buttonClasses("ghost", "sm")} disabled={pending} onClick={() => setOpen(false)}>
          Avbryt
        </button>
      </div>
      <p className="mt-1.5 text-[12px] text-muted">
        Verifikationen står kvar och återförs med en rättelse. Sedan kan månaden köras om.
      </p>
      <ErrorNote error={error} />
    </div>
  );
}

export function GenerateEmployerDeclarationButton({ month }: { month: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        className={buttonClasses("secondary", "sm")}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await generateEmployerDeclarationAction(month);
            setError(res.ok ? null : res.error);
          })
        }
      >
        <FileText className="size-3.5" />
        {pending ? "Tar fram …" : `Ta fram deklaration för ${monthLabel(month)}`}
      </button>
      <ErrorNote error={error} />
    </div>
  );
}

export function DeclareEmployerDeclarationButton({
  id,
  label,
  attBetala,
}: {
  id: string;
  label: string;
  attBetala: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        className={buttonClasses("primary", "sm")}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await markEmployerDeclarationDeclaredAction(id);
            setError(res.ok ? null : res.error);
          })
        }
      >
        <Check className="size-3.5" />
        {pending ? "Markerar …" : `Markera ${label} som lämnad`}
      </button>
      <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-muted">
        <ArrowRightLeft className="mt-0.5 size-3.5 shrink-0" />
        {attBetala > 0
          ? `${kr(attBetala)} förs till skattekontot och månaden låses. Betala senast förfallodagen.`
          : "Nollredovisning: ingenting att betala, men skyldigheten finns kvar när bolaget är registrerat som arbetsgivare."}
      </p>
      <ErrorNote error={error} />
    </div>
  );
}

export function EndEmploymentButton({ employeeId, today }: { employeeId: string; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <button className={buttonClasses("ghost", "sm")} onClick={() => setOpen(true)}>
        Avsluta anställningen
      </button>
    );
  }
  return (
    <div className="min-w-56">
      <label className={labelCls} htmlFor="lon-slut">
        Sista anställningsdag
      </label>
      <DateField id="lon-slut" value={date} onChange={setDate} />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          className={buttonClasses("secondary", "sm")}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await endEmploymentAction(employeeId, date);
              if (!res.ok) {
                setError(res.error);
                return;
              }
              setOpen(false);
              router.refresh();
            })
          }
        >
          {pending ? "Avslutar …" : "Avsluta"}
        </button>
        <button className={buttonClasses("ghost", "sm")} disabled={pending} onClick={() => setOpen(false)}>
          Avbryt
        </button>
      </div>
      <p className="mt-1.5 text-[12px] text-muted">Lönehistoriken och deklarationerna står kvar.</p>
      <ErrorNote error={error} />
    </div>
  );
}

/** Personnummer visas maskat. Ägaren kan visa hela, konsulten aldrig. */
export function RevealPersonnummer({ employeeId, masked }: { employeeId: string; masked: string }) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  if (value) return <span className="tabular">{value}</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="tabular">{masked}</span>
      {denied ? (
        <span className="text-[12px] text-muted">Inte tillgängligt</span>
      ) : (
        <button
          className="inline-flex items-center gap-1 text-[12px] font-medium text-soft underline decoration-line-strong underline-offset-2 hover:text-ink"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await revealEmployeePersonnummerAction(employeeId);
              if (res.ok) setValue(res.value);
              else setDenied(true);
            })
          }
        >
          <Eye className="size-3.5" />
          {pending ? "Visar …" : "Visa"}
        </button>
      )}
    </span>
  );
}
