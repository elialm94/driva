import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { FieldMode, type FieldModeJob } from "@/components/field-mode";
import { db } from "@/lib/store";
import { ensurePageBusiness, getSessionUser, isDemoSession } from "@/lib/auth/session";
import { LOCAL_JSON_BUSINESS_ID, LOCAL_JSON_USER_ID } from "@/lib/collaboration/actor";
import { tenantContext } from "@/lib/storage/context";
import { requestSlot } from "@/lib/storage/request-scope";
import { todayIso } from "@/lib/company-claims";

export const metadata: Metadata = { title: "Fältläge" };
export const dynamic = "force-dynamic";

/**
 * Fältläge (spec §9): det enda i appen som fungerar utan nät. Sidan
 * serverrenderar de öppna uppdragen så användaren kan välja vilka som ska
 * följa med i enheten; allt annat sker i klienten mot IndexedDB och synkas
 * via /api/offline/sync.
 */
export default async function FieldModePage() {
  await ensurePageBusiness();
  const data = db();
  const user = await getSessionUser();
  const demo = await isDemoSession();
  const businessId = requestSlot().businessId ?? tenantContext()?.businessId ?? LOCAL_JSON_BUSINESS_ID;
  const customers = new Map(data.customers.map((c) => [c.id, c.name]));
  const jobs: FieldModeJob[] = data.jobs
    .filter((j) => j.status !== "klart")
    .sort((a, b) => (a.status === "pagar" ? 0 : 1) - (b.status === "pagar" ? 0 : 1) || (a.startDate ?? "").localeCompare(b.startDate ?? ""))
    .map((j) => ({
      id: j.id,
      title: j.title,
      status: j.status,
      customerName: customers.get(j.customerId) ?? "Okänd kund",
      ...(j.address ? { address: j.address } : {}),
    }));
  const openCustomers = data.customers
    .map((c) => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "sv"));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fältläge"
        subtitle="Registrera tid, anteckningar, foton, kvitton och material på de uppdrag du tagit med dig – även utan nät. Synkas när anslutningen är tillbaka."
      />
      <FieldMode
        session={demo ? null : { businessId, userId: user?.id ?? LOCAL_JSON_USER_ID }}
        jobs={jobs}
        customers={openCustomers}
        today={todayIso()}
      />
    </div>
  );
}
