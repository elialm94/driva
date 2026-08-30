import Link from "next/link";
import { ArrowRight, BadgeCheck, Check, CircleAlert, CircleHelp } from "lucide-react";
import { db } from "@/lib/store";
import { kr, datumKort } from "@/lib/format";
import { ButtonLink, Card, PageHeader, SectionTitle } from "@/components/ui";
import { AttentionSection } from "@/components/attention-list";
import { getBookkeepingAttention } from "@/lib/services/nav-counts";
import { bankReconciliation } from "@/lib/accounting/reconciliation";
import { vatChecklist, vatPeriods } from "@/lib/accounting/vat";
import { fiscalYears, todayDate } from "@/lib/accounting/fiscal";
import { resultatrapport } from "@/lib/accounting/ledger";
import { verificationLabel } from "@/lib/accounting/engine";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Bokföring" };

function datumDagManad(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "long" }).format(new Date(iso));
}

function monthsBefore(date: string, months: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

export default async function BookkeepingPage() {
  await ensurePageBusiness();
  const data = db();
  const recon = bankReconciliation();
  const rr = resultatrapport();
  const today = todayDate();

  // Samma räknare som sidomenyns Bokföring-badge (countBookkeepingBadge).
  const bookkeepingActions = getBookkeepingAttention();
  const vatIsAttention = bookkeepingActions.some((a) => a.category === "vat");
  const needsHelp = bookkeepingActions.length;
  const allGood = needsHelp === 0;

  const vatPeriodsNow = vatPeriods().filter((p) => p.state !== "kommande");
  const vat =
    vatPeriodsNow.find((p) => p.state === "att_deklarera") ??
    vatPeriodsNow.find((p) => p.state === "pagaende") ??
    vatPeriodsNow[vatPeriodsNow.length - 1];
  const vatBlockers = vat ? vatChecklist(vat.period).filter((c) => !c.ok) : [];

  const openYear = fiscalYears().find((f) => f.status === "oppet");
  const showBokslut =
    openYear != null && (today >= monthsBefore(openYear.endDate, 2) || today > openYear.endDate);

  const recent = [...data.verifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Bokföring"
        subtitle="Sköts automatiskt i bakgrunden – du behöver bara svara när något är oklart."
      />

      {/* 1. Är min bokföring i ordning? */}
      <div className="mb-8">
        <h2 className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
          {allGood ? (
            <>
              <BadgeCheck className="size-5 text-ok" />
              Bokföringen är uppdaterad
            </>
          ) : (
            <>
              <CircleHelp className="size-5 text-warn" />
              {needsHelp === 1 ? "1 sak behöver din hjälp" : `${needsHelp} saker behöver din hjälp`}
            </>
          )}
        </h2>
        <p className="mt-0.5 text-[14px] text-soft">
          {allGood
            ? `Händelser bokförs automatiskt${
                recon.ok && recon.reconciledThrough ? ` · banken är avstämd till ${datumKort(recon.reconciledThrough)}` : ""
              }.`
            : "Resten är uppdaterad automatiskt."}
        </p>
      </div>

      {/* 2. Behöver jag göra något? Samma motor som Hem, filtrerad till bokföring + moms. */}
      {needsHelp > 0 ? (
        <section className="mb-8">
          <AttentionSection title="Behöver din hjälp" items={bookkeepingActions} />
        </section>
      ) : null}

      {/* 3. Vad behöver jag snart betala/deklarera? (Om momsen redan ligger som åtgärd ovan visas den inte dubbelt.) */}
      {vat && !vatIsAttention ? (
        <section className="mb-8">
          <SectionTitle>Kommande</SectionTitle>
          <Card className="px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[15px] font-semibold">
                  Moms {vat.position.attBetala >= 0 ? "att betala" : "att få tillbaka"}
                </p>
                <p className="mt-0.5 text-[13px] text-soft">
                  {vat.position.attBetala >= 0 ? "Att betala senast" : "Deklareras senast"} {datumDagManad(vat.dueDate)}
                </p>
                <p className="mt-1.5 flex items-center gap-1.5 text-[13px]">
                  {vatBlockers.length === 0 ? (
                    <>
                      <Check className="size-3.5 text-ok" />
                      <span className="text-ok">underlag komplett</span>
                    </>
                  ) : (
                    <>
                      <CircleAlert className="size-3.5 text-warn" />
                      <span className="text-warn">
                        {vatBlockers.length} sak{vatBlockers.length > 1 ? "er" : ""} behöver lösas
                      </span>
                    </>
                  )}
                </p>
              </div>
              <p className="text-[22px] font-semibold tracking-tight tabular">{kr(Math.abs(vat.position.attBetala))}</p>
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer list-none text-[13px] font-medium text-accent hover:underline">
                Visa hur det räknats
              </summary>
              <div className="mt-2.5 space-y-1.5 rounded-xl bg-canvas/70 px-4 py-3 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-soft">Utgående moms</span>
                  <span className="font-medium tabular">{kr(vat.position.utgaende)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-soft">Ingående moms</span>
                  <span className="font-medium tabular">−{kr(vat.position.ingaende)}</span>
                </div>
                <div className="flex justify-between border-t border-line pt-1.5">
                  <span className="font-medium">{vat.position.attBetala >= 0 ? "Att betala" : "Att få tillbaka"}</span>
                  <span className="font-semibold tabular">{kr(Math.abs(vat.position.attBetala))}</span>
                </div>
              </div>
            </details>
          </Card>
        </section>
      ) : null}

      {/* Företaget i år: resultat + tyst bank */}
      <section className="mb-8">
        <SectionTitle>Företaget i år</SectionTitle>
        <Card className="px-5 py-4">
          <p className="text-[13px] text-muted">Resultat före skatt</p>
          <p className="mt-0.5 text-[24px] font-semibold tracking-tight tabular">{kr(rr.resultatForeSkatt)}</p>
          <p className="mt-1 text-[13px] text-soft">
            Omsättning {kr(rr.omsattning)} · Kostnader {kr(rr.kostnaderSumma)}
          </p>
          {recon.ok ? (
            <p className="mt-3 flex items-center gap-1.5 text-[13px] text-soft">
              <Check className="size-3.5 text-ok" />
              Banken är avstämd
              {recon.reconciledThrough ? ` till ${datumKort(recon.reconciledThrough)}` : ""}
            </p>
          ) : null}
        </Card>
      </section>

      {showBokslut && openYear ? (
        <Card className="mb-8 flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <p className="text-[15px] font-semibold">Bokslutet närmar sig</p>
            <p className="mt-0.5 text-[13px] text-soft">Räkenskapsåret {openYear.label} går mot sitt slut.</p>
          </div>
          <ButtonLink href="/bokforing/bokslut" variant="secondary" size="sm">
            Fortsätt bokslut
          </ButtonLink>
        </Card>
      ) : null}

      {allGood && recent.length > 0 ? (
        <section className="mb-8">
          <SectionTitle>Nyligen bokfört</SectionTitle>
          <ul className="space-y-1.5">
            {recent.map((v) => {
              const total = v.entries.reduce((s, e) => s + e.debit, 0);
              return (
                <li key={v.id}>
                  <Link
                    href={`/bokforing/verifikationer?v=${v.id}`}
                    className="flex items-baseline justify-between gap-3 text-[13px] hover:text-ink"
                  >
                    <span className="min-w-0 truncate text-soft">
                      <span className="font-mono text-muted">{verificationLabel(v)}</span> {v.description}
                    </span>
                    <span className="shrink-0 tabular text-muted">
                      {datumKort(v.date)} · {kr(total)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <footer className="border-t border-line/70 pt-6">
        <p className="text-[13px] font-medium text-ink">Bokföringsdetaljer</p>
        <p className="mt-0.5 text-[13px] text-muted">Behöver du se konton, verifikationer eller rapporter?</p>
        <Link
          href="/bokforing/detaljer"
          className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline"
        >
          Visa bokföringsdetaljer <ArrowRight className="size-3.5" />
        </Link>
      </footer>
    </div>
  );
}
