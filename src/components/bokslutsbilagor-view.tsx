import Link from "next/link";
import { Check, CircleAlert } from "lucide-react";
import { Badge, Card, SectionTitle } from "./ui";
import {
  DoubtfulReceivablesForm,
  FundForm,
  ManualAccrualForm,
  VacationLiabilityForm,
} from "./bokslutsbilaga-widgets";
import { kr, datumKort } from "@/lib/format";
import { db } from "@/lib/store";
import { fiscalYears } from "@/lib/accounting/fiscal";
import { currentEmployee } from "@/lib/accounting/payroll";
import { pendingAccruals, bookedAccruals, ACCRUAL_LABEL } from "@/lib/accounting/accruals";
import {
  doubtfulSuggestions,
  fundLots,
  fundReversalsDue,
  maxFundAllocation,
  SCHEDULE_LABEL,
  yearEndSchedules,
} from "@/lib/accounting/year-end";
import { invoiceOutstanding } from "@/lib/services/data";

/**
 * Bokslutsbilagorna: specifikationen bakom balanskontona. Saldot på 2920 är ett
 * tal – bilagan svarar på vad talet består av. Tre bilagor kräver en uppgift
 * bokföringen inte känner, så de har varsitt formulär här.
 *
 * Samma vy på ägarytan och konsultytan; konsulten gör bilagorna i praktiken.
 */

export interface BokslutsbilagorViewProps {
  /** Ytans adress för en av ägarytans, t.ex. lönesidan. */
  hrefFor?: (ownerHref: string) => string;
  /** Klienten bilagorna hör till. Konsultytan skickar den. */
  businessId?: string;
  /** Revisorn läser bilagorna men bokför dem inte. */
  readOnly?: boolean;
}

/** Räkenskapsåret bilagorna gäller: det äldsta öppna. */
export function bilagorFiscalYear() {
  return fiscalYears().filter((f) => f.status === "oppet")[0];
}

export function BokslutsbilagorView({ hrefFor = (href) => href, businessId, readOnly }: BokslutsbilagorViewProps) {
  const data = db();
  const fy = bilagorFiscalYear();

  if (!fy) {
    return (
      <Card className="px-6 py-5">
        <p className="text-[14px] text-soft">
          Alla räkenskapsår är stängda. Ett nytt år öppnas automatiskt vid nästa bokförda händelse.
        </p>
      </Card>
    );
  }

  const employee = currentEmployee();
  const schedules = yearEndSchedules(fy.id);
  const booked = schedules.filter((s) => s.status === "bokford");
  const vacation = schedules.find((s) => s.kind === "semesterloneskuld");
  const doubtful = schedules.find((s) => s.kind === "kundfordringar_nedskrivning");
  const fund = schedules.find((s) => s.kind === "periodiseringsfond");

  const suggestions = doubtfulSuggestions(fy.id);
  const alreadyPicked = doubtful?.inputs.doubtfulInvoiceIds ?? [];
  const pickedInvoices = alreadyPicked
    .map((id) => data.invoices.find((i) => i.id === id))
    .filter((i): i is NonNullable<typeof i> => Boolean(i));
  const kundnamn = (customerId: string) => data.customers.find((c) => c.id === customerId)?.name ?? "Okänd kund";
  const doubtfulRows = [
    ...suggestions.map((s) => ({
      id: s.invoice.id,
      label: `Faktura #${s.invoice.number} – ${kundnamn(s.invoice.customerId)}`,
      daysOverdue: s.daysOverdue,
      amountExcludingVat: s.amountExcludingVat,
      outstanding: invoiceOutstanding(s.invoice),
    })),
    // Redan nedskrivna fordringar som inte längre föreslås ska ändå gå att avmarkera.
    ...pickedInvoices
      .filter((i) => !suggestions.some((s) => s.invoice.id === i.id))
      .map((i) => ({
        id: i.id,
        label: `Faktura #${i.number} – ${kundnamn(i.customerId)}`,
        daysOverdue: 0,
        amountExcludingVat: invoiceOutstanding(i),
        outstanding: invoiceOutstanding(i),
      })),
  ];

  const dueLots = fundReversalsDue(fy.id);
  const lots = fundLots(fy.id).map((lot) => ({
    ...lot,
    mustReverse: dueLots.some((d) => d.year === lot.year),
  }));

  const planned = pendingAccruals(fy.id);
  const resolved = bookedAccruals(fy.id);

  return (
    <>
      {booked.length > 0 ? (
        <Card className="mb-6 px-6 py-5">
          <h3 className="text-[15px] font-semibold">Bokförda bilagor</h3>
          <ul className="mt-3 space-y-2">
            {booked.map((s) => (
              <li key={s.id} className="flex items-start gap-2.5 text-[13.5px]">
                <Check className="mt-0.5 size-4 shrink-0 text-ok" />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{SCHEDULE_LABEL[s.kind]}</span>
                  <span className="ml-2 tabular text-soft">{kr(s.closingAmount)}</span>
                  <span className="block text-[12px] text-muted">
                    Bokförd {s.bookedAt ? datumKort(s.bookedAt) : ""} · {s.verificationIds.length} verifikat
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {readOnly ? (
        <Card className="mb-6 px-6 py-5">
          <p className="text-[13px] text-soft">
            Endast läsning – en revisor granskar bilagorna men bokför dem inte. Bokförda bilagor står ovan.
          </p>
        </Card>
      ) : (
        <>
          <SectionTitle>Bilagor som kräver din bedömning</SectionTitle>
          <div className="mb-6 space-y-4">
            {employee ? (
              <VacationLiabilityForm
                fiscalYearId={fy.id}
                savedDays={vacation?.inputs.savedVacationDays ?? 0}
                monthlySalary={employee.monthlySalary}
                businessId={businessId}
              />
            ) : (
              <Card className="px-6 py-5">
                <h3 className="text-[15px] font-semibold">Semesterlöneskuld</h3>
                <p className="mt-1 text-[13px] text-soft">
                  Bolaget har ingen anställd, så det finns ingen intjänad semester att skulda.{" "}
                  <Link href={hrefFor("/bokforing/lon") as never} className="font-medium text-accent hover:underline">
                    Lägg upp lön
                  </Link>{" "}
                  om det ska finnas.
                </p>
              </Card>
            )}

            <DoubtfulReceivablesForm
              fiscalYearId={fy.id}
              suggestions={doubtfulRows}
              selected={alreadyPicked}
              businessId={businessId}
            />

            <FundForm
              fiscalYearId={fy.id}
              maxAllocation={maxFundAllocation(fy.id)}
              lots={lots}
              allocation={fund?.inputs.fundAllocation ?? 0}
              businessId={businessId}
            />
          </div>
        </>
      )}

      <SectionTitle>Periodiseringar</SectionTitle>
      <Card className="mb-6 px-6 py-5">
        <p className="text-[13px] leading-relaxed text-soft">
          En kostnad hör till den period den avser, inte till månaden fakturan kom. Driva föreslår periodisering för köp
          som ser ut att sträcka sig över årsskiftet – resten anger du här.
        </p>
        {planned.length > 0 || resolved.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {[...planned, ...resolved].map((a) => (
              <li key={a.id} className="flex items-start gap-2.5 text-[13.5px]">
                {a.status === "bokford" ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-ok" />
                ) : (
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{a.description}</span>
                  <span className="ml-2 tabular text-soft">{kr(a.amount)}</span>
                  <span className="block text-[12px] text-muted">
                    {ACCRUAL_LABEL[a.kind]} · {datumKort(a.fromDate)}–{datumKort(a.toDate)} ·{" "}
                    {a.status === "bokford" ? "Bokförd" : "Väntar på bokslutskörningen"}
                  </span>
                </span>
                <Badge tone={a.status === "bokford" ? "ok" : "warn"}>
                  {a.status === "bokford" ? "Bokförd" : "Planerad"}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
        {readOnly ? null : (
          <div className="mt-4">
            <ManualAccrualForm fiscalYearId={fy.id} yearEnd={fy.endDate} businessId={businessId} />
          </div>
        )}
      </Card>

      <p className="mt-6 text-[12px] leading-relaxed text-muted">
        Bilagorna bokförs som en justering mot vad kontot redan visar, aldrig som ett nytt totalbelopp – annars skulle
        andra årets bilaga dubbla första årets skuld. Verifikationen får bokslutsdatum och pekar tillbaka på bilagan.
      </p>
    </>
  );
}
