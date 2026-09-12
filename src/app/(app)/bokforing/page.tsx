import Link from "next/link";
import { BadgeCheck, Check, CircleHelp } from "lucide-react";
import { db } from "@/lib/store";
import { kr, datumKort } from "@/lib/format";
import { ButtonLink, Card, PageHeader, SectionTitle } from "@/components/ui";
import { AttentionSection } from "@/components/attention-list";
import { ScrollToId } from "@/components/scroll-to-id";
import { InboxAddressCard } from "@/components/inbox-address";
import { InboxUploadZone } from "@/components/inbox-upload";
import { ResultatOverview } from "@/components/resultat-overview";
import { inboundAddressForBusiness } from "@/lib/services/inbox";
import { getBusinessActions } from "@/lib/services/actions";
import {
  BOOKKEEPING_PAGE_SUBTITLE,
  BOOKKEEPING_SECTION_TITLE,
  BOOKKEEPING_UNRESOLVED_ANCHOR,
  bookkeepingQueue,
  bookkeepingStatusHeadline,
  isBookkeepingUnresolvedVisa,
} from "@/lib/services/action-views";
import { bankReconciliation } from "@/lib/accounting/reconciliation";
import { upcomingAuthorityEvents } from "@/lib/accounting/skatteverket-calendar";
import { SkatteverketCalendar } from "@/components/skatteverket-calendar";
import { fiscalYears, lockedThrough, todayDate } from "@/lib/accounting/fiscal";
import { verificationLabel } from "@/lib/accounting/engine";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Bokföring" };

/** Så många olösta rader visas direkt – resten bakom "Visa N till", som på Hem. */
const BOOKKEEPING_ATTENTION_VISIBLE = 8;

function monthsBefore(date: string, months: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

export default async function BookkeepingPage({
  searchParams,
}: {
  searchParams: Promise<{ visa?: string }>;
}) {
  await ensurePageBusiness();
  const params = await searchParams;
  const focusUnresolved = isBookkeepingUnresolvedVisa(params.visa);
  const data = db();
  const recon = bankReconciliation();
  const today = todayDate();

  // Samma åtgärdsmotor som Hem – komplett bokföringskö, ingen gruppering.
  const bookkeepingActions = bookkeepingQueue(getBusinessActions().attention);
  const needsHelp = bookkeepingActions.length;
  const allGood = needsHelp === 0;
  const upcoming = upcomingAuthorityEvents();

  const openYear = fiscalYears().find((f) => f.status === "oppet");
  const showBokslut =
    openYear != null && (today >= monthsBefore(openYear.endDate, 2) || today > openYear.endDate);

  /*
   * Ett öppet år utan ingående balanser och utan en enda verifikation är
   * ögonblicket för ett övertagande: antingen är det bolagets första år, eller
   * så ligger historiken i ett annat program och måste in innan bokföringen
   * börjar. Kortet visas bara då – efteråt är det en risk utan nytta.
   */
  const emptyStart =
    openYear != null &&
    openYear.openingSource !== "foregaende_ar" &&
    Object.keys(openYear.openingBalances).length === 0 &&
    !data.verifications.some((v) => v.fiscalYearId === openYear.id);

  const recent = [...data.verifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);
  const lock = lockedThrough();

  return (
    <div>
      <PageHeader title="Bokföring" subtitle={BOOKKEEPING_PAGE_SUBTITLE} />
      {focusUnresolved ? <ScrollToId id={BOOKKEEPING_UNRESOLVED_ANCHOR} /> : null}

      {/* 1. Är min bokföring i ordning? */}
      <div className="mb-8">
        <h2 className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
          {allGood ? (
            <>
              <BadgeCheck className="size-5 text-ok" />
              {bookkeepingStatusHeadline(0)}
            </>
          ) : (
            <>
              <CircleHelp className="size-5 text-warn" />
              {bookkeepingStatusHeadline(needsHelp)}
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

      {/* 2. Komplett bokföringskö – samma åtgärds-id:n som Hem, aldrig en andra inbox. */}
      {needsHelp > 0 ? (
        <section id={BOOKKEEPING_UNRESOLVED_ANCHOR} className="mb-8 scroll-mt-6">
          <AttentionSection
            title={BOOKKEEPING_SECTION_TITLE}
            items={bookkeepingActions}
            initialVisible={BOOKKEEPING_ATTENTION_VISIBLE}
          />
        </section>
      ) : focusUnresolved ? (
        <section id={BOOKKEEPING_UNRESOLVED_ANCHOR} className="mb-8 scroll-mt-6" />
      ) : null}

      {needsHelp === 0 ? (
        <div className="mb-8 space-y-4">
          <InboxUploadZone />
          <InboxAddressCard address={inboundAddressForBusiness()} />
        </div>
      ) : (
        <Card className="mb-8 px-5 py-4">
          <p className="text-[14px] font-medium">Skicka underlag hit</p>
          <p className="mt-0.5 text-[13px] text-soft">Kvitton och fakturor via mejl eller släpp i rutan.</p>
          <div className="mt-3">
            <InboxUploadZone />
          </div>
          <div className="mt-3">
            <InboxAddressCard address={inboundAddressForBusiness()} />
          </div>
        </Card>
      )}

      <SkatteverketCalendar events={upcoming} />

      <ResultatOverview />

      <section className="mb-8">
        <Card className="px-5 py-4">
          {recon.ok ? (
            <p className="flex items-center gap-1.5 text-[13px] text-soft">
              <Check className="size-3.5 text-ok" />
              Banken är avstämd
              {recon.reconciledThrough ? ` till ${datumKort(recon.reconciledThrough)}` : ""}
            </p>
          ) : null}
          <p className={`${recon.ok ? "mt-3" : ""} text-[13px] text-soft`}>
            {lock ? `Bokföringen är låst till och med ${datumKort(lock)}` : "Ingen period är låst"}
            {" · "}
            <Link href="/bokforing/periodstangning" className="font-medium text-accent hover:underline">
              Periodstängning
            </Link>
          </p>
        </Card>
      </section>

      {emptyStart && openYear ? (
        <Card className="mb-8 flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <p className="text-[15px] font-semibold">Kommer bokföringen från ett annat program?</p>
            <p className="mt-0.5 text-[13px] text-soft">
              {openYear.label} börjar på noll. Läs in balansräkningen från Fortnox, Visma eller Björn Lundén så utgår
              rapporterna från rätt siffror.
            </p>
          </div>
          <ButtonLink href="/bokforing/ingaende-balans" variant="secondary" size="sm">
            Ingående balans
          </ButtonLink>
        </Card>
      ) : null}

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
    </div>
  );
}
