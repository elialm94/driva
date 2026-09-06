import Link from "next/link";
import { Check, CircleAlert, Lock } from "lucide-react";
import { datumKort } from "@/lib/format";
import { Badge, Card, SectionTitle } from "./ui";
import { cx } from "./ui-classes";
import { ClosePeriodButton } from "./periodstangning-widgets";
import { todayDate } from "@/lib/accounting/dates";
import { lockedThrough } from "@/lib/accounting/fiscal";
import { closableMonths, periodCloseStatus, type PeriodCloseStatus } from "@/lib/accounting/period-close";

/**
 * Periodstängning: månadsavstämningen som ett flöde.
 *
 * Vyn visar en månad i taget, för det är så låset fungerar: ett enda datum som
 * bara går framåt. Att visa tolv knappar hade antytt att månaderna är
 * oberoende, och det är de inte – mars kan inte stängas medan februari står
 * öppen, eftersom låset i så fall hade svept med februari ändå.
 *
 * Samma vy på ägarytan och konsultytan. Månadsavstämning är byråns löpande
 * arbete, och det är samma arbete oavsett vem som sitter framför det.
 */

export interface PeriodstangningViewProps {
  /** Ytans adress för en av ägarytans, för länkarna i kontrollistan. */
  hrefFor?: (ownerHref: string) => string;
  /** Klienten stängningen gäller. Konsultytan skickar den. */
  businessId?: string;
  /** Revisorn läser avstämningen men låser inte perioden. */
  readOnly?: boolean;
}

export function PeriodstangningView({
  hrefFor = (href) => href,
  businessId,
  readOnly,
}: PeriodstangningViewProps) {
  const today = todayDate();
  const lock = lockedThrough();
  const months = closableMonths().map((p) => periodCloseStatus(p, today));
  const awaiting = months.filter((m) => m.state === "att_stanga");
  const next = awaiting[0];
  const ongoing = months.find((m) => m.state === "pagaende");

  return (
    <>
      <Card className="mb-6 px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Lock className="size-4.5 text-muted" />
            <h3 className="text-[15px] font-semibold">Bokföringen är låst</h3>
          </div>
          <Badge tone={lock ? "ok" : "neutral"}>{lock ? `Till och med ${datumKort(lock)}` : "Ingen period är låst"}</Badge>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-soft">
          {lock
            ? `Allt till och med ${datumKort(lock)} är låst: ingenting kan ändras där, och en rättelse bokförs i öppen period. Låset flyttas också av sig själv när en momsperiod deklareras eller en arbetsgivardeklaration lämnas.`
            : "Ingen period är låst ännu. Det betyder att en händelse i januari fortfarande kan ändras i november, och att en avstämning som gjordes i februari inte längre säger något."}
        </p>
      </Card>

      {next ? (
        <>
          <SectionTitle>Nästa period att stänga</SectionTitle>
          <Card className="mb-6 px-6 py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-[15px] font-semibold">{next.period.label}</h3>
              <Badge tone={next.blockers.length === 0 ? "ok" : "warn"}>
                {next.blockers.length === 0
                  ? "Klar att stängas"
                  : `${next.blockers.length} punkt${next.blockers.length === 1 ? "" : "er"} kvar`}
              </Badge>
            </div>
            <p className="mt-1 text-[13px] text-soft">
              {next.verifications} verifikation{next.verifications === 1 ? "" : "er"} med bokföringsdatum i månaden.
              {next.endsVatPeriod
                ? " Månaden avslutar en momsperiod, så momsunderlaget blir slutgiltigt när den låses."
                : ""}
            </p>

            <ul className="mt-4 space-y-2.5">
              {next.checks.map((c) => (
                <li key={c.key} className="flex items-start gap-2.5 text-[14px]">
                  {c.ok ? (
                    <Check className="mt-0.5 size-4.5 shrink-0 text-ok" />
                  ) : (
                    <CircleAlert className={cx("mt-0.5 size-4.5 shrink-0", c.blocking ? "text-warn" : "text-muted")} />
                  )}
                  <span>
                    <span className={c.ok ? "text-soft" : "font-medium"}>{c.label}</span>
                    {c.detail ? (
                      <span className="block text-[12.5px] text-muted">
                        {c.detail}
                        {!c.ok && c.href ? (
                          <>
                            {" "}
                            <Link href={hrefFor(c.href) as never} className="font-medium text-accent hover:underline">
                              {c.hrefLabel ?? "Visa"}
                            </Link>
                          </>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>

            {readOnly ? (
              <p className="mt-4 border-t border-line/60 pt-4 text-[13px] text-soft">
                Endast läsning – en revisor stänger inte en period.
              </p>
            ) : (
              <div className="mt-4 border-t border-line/60 pt-4">
                <ClosePeriodButton
                  periodKey={next.period.key}
                  label={`Stäng ${next.period.label}`}
                  disabled={next.blockers.length > 0}
                  businessId={businessId}
                />
                <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
                  {next.blockers.length > 0
                    ? `${next.blockers.length} punkt${next.blockers.length === 1 ? "" : "er"} behöver bli klar${next.blockers.length === 1 ? "" : "a"} innan månaden kan stängas.`
                    : `Bokföringen låses till och med ${next.period.end}. Låset går bara framåt – det backas enbart genom att räkenskapsåret öppnas igen, och det lämnar ett spår.`}
                </p>
              </div>
            )}
          </Card>

          {awaiting.length > 1 ? (
            <p className="mb-6 text-[13px] leading-relaxed text-soft">
              {awaiting.length - 1} månad{awaiting.length - 1 === 1 ? "" : "er"} står i kö efter{" "}
              {next.period.label}: {awaiting.slice(1).map((m) => m.period.label).join(", ")}. Periodlåset är ett enda
              datum, så de stängs i tur och ordning.
            </p>
          ) : null}
        </>
      ) : (
        <Card className="mb-6 px-6 py-5">
          <p className="text-[14px] leading-relaxed text-soft">
            {ongoing
              ? `Ingen avslutad månad väntar på stängning. ${ongoing.period.label} pågår och stängs efter månadsskiftet.`
              : "Ingen avslutad månad väntar på stängning."}
          </p>
        </Card>
      )}

      <SectionTitle>Månaderna i året</SectionTitle>
      {/*
        Tabellen får inte tvinga fram sidled-scroll: månaden och statusen är
        hela poängen, och en smal skärm som visar den ena utan den andra visar
        ingenting. Tre korta kolumner ryms, så rubriken bryter rad i stället.
      */}
      <Card className="mb-6 px-5 py-4">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left align-bottom text-[11px] font-semibold uppercase tracking-wide text-muted">
              <th className="pb-1.5 font-semibold">Månad</th>
              <th className="pb-1.5 pl-2 text-right font-semibold">Verifikationer</th>
              <th className="pb-1.5 pl-2 text-right font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.period.key} className="border-t border-line/50">
                <td className="py-1.5 pr-3">{m.period.label}</td>
                <td className="py-1.5 pl-2 text-right tabular text-soft">{m.verifications}</td>
                <td className="py-1.5 pl-2 text-right">
                  <Badge tone={statusTone(m)}>{statusText(m)}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <p className="text-[12px] leading-relaxed text-muted">
        Kontrollerna är samma som bokslutets, gjorda månad för månad: banken, underlagen, momsen och lönen.
        Kundfordringarnas värde och periodiseringarna hör till bokslutet och kontrolleras inte här – annars vore det
        tolv bokslut om året.
      </p>
    </>
  );
}

function statusTone(m: PeriodCloseStatus): "ok" | "warn" | "info" | "neutral" {
  if (m.state === "stangd") return "ok";
  if (m.state === "att_stanga") return m.blockers.length === 0 ? "info" : "warn";
  return "neutral";
}

function statusText(m: PeriodCloseStatus): string {
  if (m.state === "stangd") return "Stängd";
  if (m.state === "pagaende") return "Pågår";
  if (m.state === "kommande") return "Kommande";
  return m.blockers.length === 0 ? "Klar att stängas" : `${m.blockers.length} kvar`;
}
