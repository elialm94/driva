import Link from "next/link";
import { CalendarClock, FileText, UserRound, Wallet } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { PrintButton } from "@/components/bokforing-widgets";
import {
  DeclareEmployerDeclarationButton,
  EmployeeForm,
  EndEmploymentButton,
  GenerateEmployerDeclarationButton,
  ReversePayrollButton,
  RevealPersonnummer,
  RunPayrollButton,
} from "@/components/lon-widgets";
import { kr, datumKort } from "@/lib/format";
import { maskPersonnummer } from "@/lib/personnummer";
import { ensurePageBusiness } from "@/lib/auth/session";
import { todayDate } from "@/lib/accounting/dates";
import {
  currentEmployee,
  employeeById,
  employerDeclarations,
  employerDeclarationsAwaitingFiling,
  employerDeclarationFor,
  monthLabel,
  payrollMonthsAwaitingRun,
  payrollRuns,
  taxBasisLabel,
  taxLookupStale,
  EMPLOYEE_ROLE_LABEL,
} from "@/lib/accounting/payroll";

export const metadata = { title: "Lön" };

export default async function LonPage() {
  await ensurePageBusiness();
  const today = todayDate();
  const employee = currentEmployee();
  const runs = [...payrollRuns()].sort((a, b) => b.month.localeCompare(a.month));
  const awaitingRun = payrollMonthsAwaitingRun(today);
  const awaitingFiling = employerDeclarationsAwaitingFiling(today);
  const declarations = [...employerDeclarations()].sort((a, b) => b.month.localeCompare(a.month));
  const missingDraft = awaitingRun.filter((m) => !employerDeclarationFor(m));
  const stale = employee ? taxLookupStale(employee.taxBasis, employee.monthlySalary) : false;

  return (
    <div>
      <PageHeader
        back={<SmartBack />}
        title="Lön"
        subtitle="Fast månadslön till ägaren, med arbetsgivardeklaration varje månad. Skatten och avgifterna följer med till skattekontot."
        actions={<PrintButton />}
      />

      {employee ? (
        <>
          <Card className="mb-4 px-6 py-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <UserRound className="size-4.5 text-muted" />
                  <h2 className="text-[15px] font-semibold">{employee.name}</h2>
                  <Badge tone="ok">{EMPLOYEE_ROLE_LABEL[employee.role]}</Badge>
                </div>
                <dl className="mt-3 grid gap-3 text-[13px] sm:grid-cols-2">
                  <div>
                    <dt className="text-[12px] text-muted">Personnummer</dt>
                    <dd>
                      <RevealPersonnummer
                        employeeId={employee.id}
                        masked={maskPersonnummer(employee.personnummer)}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-muted">Anställd sedan</dt>
                    <dd>{datumKort(employee.startDate)}</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-muted">Skatteavdrag</dt>
                    <dd>{taxBasisLabel(employee.taxBasis)}</dd>
                  </div>
                  {employee.email ? (
                    <div>
                      <dt className="text-[12px] text-muted">E-post</dt>
                      <dd>{employee.email}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>
              <p className="text-[26px] font-semibold tracking-tight tabular">{kr(employee.monthlySalary)}</p>
            </div>
            {stale ? (
              <p className="mt-4 border-t border-line/60 pt-3 text-[13px] font-medium text-warn">
                Månadslönen har ändrats sedan tabellavdraget slogs upp. Slå upp raden för{" "}
                {kr(employee.monthlySalary)} i tabellen igen, annars dras fel skatt.
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap items-start gap-3 border-t border-line/60 pt-4">
              <EmployeeForm employee={employee} today={today} />
              <EndEmploymentButton employeeId={employee.id} today={today} />
            </div>
          </Card>

          {awaitingRun.length + awaitingFiling.length + missingDraft.length > 0 ? (
            <div className="mb-8">
              <SectionTitle>Att göra ({awaitingRun.length + awaitingFiling.length})</SectionTitle>
              <div className="space-y-4">
                {awaitingRun.map((m) => (
                  <Card key={m} className="px-6 py-5">
                    <p className="text-[15px] font-semibold">Lön {monthLabel(m)}</p>
                    <p className="mt-1 text-[13px] text-soft">
                      Lönedagen har passerat men lönen är inte bokförd. Utan lönekörning finns inget underlag till
                      arbetsgivardeklarationen.
                    </p>
                    <div className="mt-3">
                      <RunPayrollButton month={m} gross={employee.monthlySalary} />
                    </div>
                  </Card>
                ))}
                {awaitingFiling.map((d) => (
                  <Card key={d.id} className="px-6 py-5">
                    <p className="text-[15px] font-semibold">Arbetsgivardeklaration {d.label}</p>
                    <p className="mt-1 text-[13px] text-soft">
                      {kr(d.attBetala)} att betala, senast {datumKort(d.dueDate)}. Lämna deklarationen hos Skatteverket
                      och markera den här, så förs beloppet till skattekontot.
                    </p>
                    <div className="mt-3">
                      <DeclareEmployerDeclarationButton id={d.id} label={d.label} attBetala={d.attBetala} />
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div className="mb-8">
          <EmptyState
            icon={Wallet}
            title="Ingen lön är upplagd"
            text="Ägaruttag i ett aktiebolag är lön: fast månadslön, skatteavdrag och arbetsgivaravgift, med arbetsgivardeklaration varje månad. Lägg upp den en gång, kör den varje månad."
          />
          <div className="mt-4">
            <EmployeeForm today={today} />
          </div>
        </div>
      )}

      <div className="mb-8">
        <SectionTitle>Lönekörningar</SectionTitle>
        {runs.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="Ingen lön är bokförd ännu"
            text="Så snart en månad är körd syns bruttolön, skatt, netto och arbetsgivaravgift här, med lönespecifikation."
          />
        ) : (
          <Card className="overflow-x-auto px-6 py-5">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <th className="pb-2 font-semibold">Månad</th>
                  <th className="pb-2 font-semibold">Utbetalt</th>
                  <th className="pb-2 text-right font-semibold">Brutto</th>
                  <th className="pb-2 text-right font-semibold">Skatt</th>
                  <th className="pb-2 text-right font-semibold">Netto</th>
                  <th className="pb-2 text-right font-semibold">Avgifter</th>
                  <th className="pb-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const declaration = employerDeclarationFor(r.month);
                  const locked = declaration?.status === "deklarerad";
                  return (
                    <tr key={r.id} className="border-t border-line/50 align-top">
                      <td className="py-2.5 pr-3 font-medium whitespace-nowrap">
                        <Link
                          className="underline decoration-line-strong underline-offset-2 hover:decoration-accent"
                          href={`/bokforing/lon/${r.id}`}
                        >
                          {monthLabel(r.month)}
                        </Link>
                        <span className="block text-[12px] font-normal text-muted">
                          {employeeById(r.employeeId)?.name ?? "Tidigare anställd"}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap text-muted">{datumKort(r.payDate)}</td>
                      <td className="py-2.5 pr-3 text-right tabular">{kr(r.gross)}</td>
                      <td className="py-2.5 pr-3 text-right tabular">{kr(r.tax)}</td>
                      <td className="py-2.5 pr-3 text-right tabular font-medium">{kr(r.net)}</td>
                      <td className="py-2.5 pr-3 text-right tabular">{kr(r.employerContribution)}</td>
                      <td className="py-2.5 text-right">
                        {locked ? (
                          <span className="text-[12px] text-muted">Deklarerad</span>
                        ) : (
                          <ReversePayrollButton runId={r.id} label={monthLabel(r.month)} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      <div className="mb-8">
        <SectionTitle>Arbetsgivardeklarationer</SectionTitle>
        {declarations.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="Ingen arbetsgivardeklaration ännu"
            text="Deklarationen tas fram ur de bokförda lönerna, en per månad, och lämnas senast den 12:e månaden efter (den 17:e i januari och augusti)."
          />
        ) : (
          <div className="space-y-3">
            {declarations.map((d) => (
              <Card key={d.id} className="px-6 py-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <p className="text-[15px] font-semibold">{d.label}</p>
                      <Badge tone={d.status === "deklarerad" ? "ok" : d.dueDate < today ? "warn" : "neutral"}>
                        {d.status === "deklarerad" ? "Lämnad" : d.dueDate < today ? "Försenad" : "Utkast"}
                      </Badge>
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 text-[12px] text-muted">
                      <CalendarClock className="size-3.5" />
                      Förfaller {datumKort(d.dueDate)}
                      {d.declaredAt ? ` · lämnad ${datumKort(d.declaredAt)}` : ""}
                    </p>
                    <dl className="mt-3 grid gap-3 text-[13px] sm:grid-cols-3">
                      <div>
                        <dt className="text-[12px] text-muted">Bruttolön</dt>
                        <dd className="tabular">{kr(d.gross)}</dd>
                      </div>
                      <div>
                        <dt className="text-[12px] text-muted">Avdragen skatt</dt>
                        <dd className="tabular">{kr(d.tax)}</dd>
                      </div>
                      <div>
                        <dt className="text-[12px] text-muted">Arbetsgivaravgifter</dt>
                        <dd className="tabular">{kr(d.employerContribution)}</dd>
                      </div>
                    </dl>
                  </div>
                  <div className="text-right">
                    <p className="text-[12px] text-muted">Att betala</p>
                    <p className="text-[20px] font-semibold tabular">{kr(d.attBetala)}</p>
                  </div>
                </div>
                {d.status === "utkast" ? (
                  <div className="mt-3 border-t border-line/60 pt-3">
                    <DeclareEmployerDeclarationButton id={d.id} label={d.label} attBetala={d.attBetala} />
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        )}
        {missingDraft.length > 0 ? (
          <div className="mt-3">
            <GenerateEmployerDeclarationButton month={missingDraft[0]} />
            <p className="mt-1.5 text-[12px] text-muted">
              En månad utan lön ska ändå deklareras när bolaget är registrerat som arbetsgivare – som nollredovisning.
            </p>
          </div>
        ) : null}
      </div>

      <p className="mt-6 text-[12px] leading-relaxed text-muted">
        Driva skickar aldrig något till Skatteverket. Deklarationen tas fram ur bokföringen och markeras som lämnad här –
        då fryses siffrorna, beloppet förs till skattekontot och månaden låses.
      </p>
    </div>
  );
}
