import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { CustomerRegister } from "@/components/customer-list";
import { KunderHeaderActions } from "@/components/kunder-header-actions";
import {
  listCustomersForTable,
  type CustomerActivityFilter,
  type CustomerKindFilter,
  type CustomerPaymentFilter,
  type CustomerSort,
} from "@/lib/services/customers";
import { RETURN_LABEL_PARAM, RETURN_TO_PARAM } from "@/lib/nav";
import { db } from "@/lib/store";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Kunder" };

function str(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/** Gamla `/kunder?flik=uppdrag`-länkar: vidare till `/uppdrag` med sök/filter/sida och tillbaka-kedjan bevarade. */
const UPPDRAG_LIST_PARAMS = ["q", "visning", "ekonomi", "sortering", "sida", RETURN_TO_PARAM, RETURN_LABEL_PARAM] as const;

export default async function CustomersPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const flik = str(searchParams.flik);
  if (flik === "uppdrag" || flik === "forfragningar") {
    const q = new URLSearchParams();
    for (const key of UPPDRAG_LIST_PARAMS) {
      const value = str(searchParams[key]);
      if (value) q.set(key, value);
    }
    const qs = q.toString();
    redirect(qs ? `/uppdrag?${qs}` : "/uppdrag");
  }
  await ensurePageBusiness();
  const customers = [...db().customers]
    .sort((a, b) => a.name.localeCompare(b.name, "sv"))
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind }));

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Kunder"
        subtitle="Alla du jobbar med eller pratar med – allt kopplas ihop automatiskt."
        stackActions
        actions={<KunderHeaderActions customers={customers} />}
      />

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
