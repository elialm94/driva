import { PageHeader, cx } from "@/components/ui";
import { CustomerRegister, NewCustomerButton } from "@/components/customer-list";
import { InquiryInbox } from "@/components/inquiry-inbox";
import {
  countOpenInquiries,
  listCustomersForTable,
  listInquiriesInbox,
  type CustomerActivityFilter,
  type CustomerKindFilter,
  type CustomerPaymentFilter,
  type CustomerSort,
  type InquiryInboxFilter,
} from "@/lib/services/customers";
import { KUNDER_TABS, type KunderTab } from "@/lib/nav";
import Link from "next/link";

export const metadata = { title: "Kunder" };

function str(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function CustomersPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const tab: KunderTab = str(searchParams.flik) === "forfragningar" ? "forfragningar" : "kunder";
  const openCount = countOpenInquiries();

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Kunder"
        subtitle={
          tab === "forfragningar"
            ? "Nya förfrågningar från hemsidan, telefon och mejl – en kö att ta hand om."
            : "Alla du jobbar med eller pratar med – allt kopplas ihop automatiskt."
        }
        actions={tab === "kunder" ? <NewCustomerButton /> : undefined}
      />

      <div className="mb-5 flex gap-1 overflow-x-auto rounded-2xl bg-ink/4 p-1">
        {KUNDER_TABS.map((t) => (
          <Link
            key={t.key}
            href={t.href as never}
            aria-label={t.key === "forfragningar" && openCount > 0 ? `Förfrågningar, ${openCount} öppna` : t.label}
            className={cx(
              "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-4 py-2 text-center text-sm font-medium transition-all",
              tab === t.key ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"
            )}
          >
            {t.label}
            {t.key === "forfragningar" && openCount > 0 ? (
              <span className="ml-1.5 rounded-full bg-ink/8 px-1.5 py-0.5 text-[11px] font-medium tabular text-soft">
                {openCount}
              </span>
            ) : null}
          </Link>
        ))}
      </div>

      {tab === "forfragningar" ? (
        <InquiryInbox
          result={listInquiriesInbox({
            q: str(searchParams.q),
            filter: str(searchParams.visning) === "alla" ? "alla" : "oppna",
            page: Number(str(searchParams.sida)) || 1,
          })}
          query={{
            q: str(searchParams.q),
            filter: (str(searchParams.visning) === "alla" ? "alla" : "oppna") as InquiryInboxFilter,
            page: Number(str(searchParams.sida)) || 1,
          }}
        />
      ) : (
        <CustomerRegister
          result={listCustomersForTable({
            q: str(searchParams.q),
            kind: parseKind(str(searchParams.typ)),
            activity: parseActivity(str(searchParams.aktivitet)),
            payment: parsePayment(str(searchParams.betalning)),
            sort: parseSort(str(searchParams.sortering)),
            page: Number(str(searchParams.sida)) || 1,
          })}
          query={{
            q: str(searchParams.q),
            kind: parseKind(str(searchParams.typ)),
            activity: parseActivity(str(searchParams.aktivitet)),
            payment: parsePayment(str(searchParams.betalning)),
            sort: parseSort(str(searchParams.sortering)),
            page: Number(str(searchParams.sida)) || 1,
          }}
        />
      )}
    </div>
  );
}

function parseKind(value: string): CustomerKindFilter {
  return value === "privat" || value === "foretag" ? value : "alla";
}

function parseActivity(value: string): CustomerActivityFilter {
  return value === "uppdrag" || value === "ingen" ? value : "alla";
}

function parsePayment(value: string): CustomerPaymentFilter {
  return value === "obetalt" || value === "forsenad" ? value : "alla";
}

function parseSort(value: string): CustomerSort {
  return value === "namn" || value === "attBetala" ? value : "aktivitet";
}
