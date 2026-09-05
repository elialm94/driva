import { notFound } from "next/navigation";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { PrintButton } from "@/components/bokforing-widgets";
import { RevealPersonnummer } from "@/components/lon-widgets";
import { kr, datumKort } from "@/lib/format";
import { maskPersonnummer } from "@/lib/personnummer";
import { db } from "@/lib/store";
import { ensurePageBusiness } from "@/lib/auth/session";
import { verificationLabel } from "@/lib/accounting/engine";
import { payrollRunById, payslip, EMPLOYEE_ROLE_LABEL } from "@/lib/accounting/payroll";

export const metadata = { title: "Lönespecifikation" };

/**
 * Lönespecifikationen till den anställde. Härledd ur den bokförda körningen –
 * den kan aldrig visa andra tal än de som är bokförda.
 */
export default async function LonespecifikationPage({ params }: { params: Promise<{ runId: string }> }) {
  await ensurePageBusiness();
  const { runId } = await params;
  if (!payrollRunById(runId)) notFound();
  const slip = payslip(runId);
  const { run, employee } = slip;
  const settings = db().settings;
  const verification = db().verifications.find((v) => v.id === run.verificationId);

  return (
    <div>
      <PageHeader
        back={<SmartBack />}
        title={`Lönespecifikation ${slip.monthLabel}`}
        subtitle={`${employee.name} · utbetalt ${datumKort(run.payDate)}`}
        actions={<PrintButton />}
      />

      <Card className="mb-4 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Arbetsgivare</p>
            <p className="mt-1 text-[15px] font-semibold">{settings.name}</p>
            {settings.orgNumber ? <p className="text-[13px] text-soft">{settings.orgNumber}</p> : null}
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Anställd</p>
            <p className="mt-1 text-[15px] font-semibold">{employee.name}</p>
            <p className="text-[13px] text-soft">
              <RevealPersonnummer employeeId={employee.id} masked={maskPersonnummer(employee.personnummer)} />
            </p>
            <p className="text-[13px] text-soft">{EMPLOYEE_ROLE_LABEL[employee.role]}</p>
          </div>
        </div>
      </Card>

      <Card className="mb-4 px-6 py-5">
        <table className="w-full text-[14px]">
          <tbody>
            <tr className="border-b border-line/50">
              <td className="py-2.5">Månadslön {slip.monthLabel}</td>
              <td className="py-2.5 text-right tabular">{kr(run.gross)}</td>
            </tr>
            <tr className="border-b border-line/50">
              <td className="py-2.5">
                Preliminär skatt
                <span className="block text-[12px] text-muted">{slip.taxLabel}</span>
              </td>
              <td className="py-2.5 text-right tabular">−{kr(run.tax)}</td>
            </tr>
            <tr>
              <td className="py-3 text-[15px] font-semibold">Netto att betala</td>
              <td className="py-3 text-right text-[18px] font-semibold tabular">{kr(run.net)}</td>
            </tr>
          </tbody>
        </table>
      </Card>

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Card className="px-6 py-5">
          <h3 className="text-[15px] font-semibold">Ackumulerat {run.payDate.slice(0, 4)}</h3>
          <dl className="mt-3 space-y-2 text-[13px]">
            <div className="flex justify-between gap-3">
              <dt className="text-soft">Bruttolön</dt>
              <dd className="tabular">{kr(slip.yearToDate.gross)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-soft">Avdragen skatt</dt>
              <dd className="tabular">{kr(slip.yearToDate.tax)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-soft">Netto</dt>
              <dd className="tabular">{kr(slip.yearToDate.net)}</dd>
            </div>
          </dl>
        </Card>
        <Card className="px-6 py-5">
          <h3 className="text-[15px] font-semibold">Arbetsgivarens kostnad</h3>
          <dl className="mt-3 space-y-2 text-[13px]">
            <div className="flex justify-between gap-3">
              <dt className="text-soft">Bruttolön</dt>
              <dd className="tabular">{kr(run.gross)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-soft">Arbetsgivaravgifter</dt>
              <dd className="tabular">{kr(run.employerContribution)}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-line/50 pt-2 font-semibold">
              <dt>Total lönekostnad</dt>
              <dd className="tabular">{kr(run.gross + run.employerContribution)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-[12px] text-muted">{slip.contributionReason}</p>
        </Card>
      </div>

      {verification ? (
        <p className="text-[12px] text-muted">
          Bokförd som{" "}
          <Link
            className="underline decoration-line-strong underline-offset-2 hover:decoration-accent"
            href="/bokforing/verifikationer"
          >
            verifikation {verificationLabel(verification)}
          </Link>
          . Skatten och avgifterna redovisas i arbetsgivardeklarationen för {slip.monthLabel}.
        </p>
      ) : null}
    </div>
  );
}
