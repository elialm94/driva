import { db } from "@/lib/store";
import { customerSummary } from "@/lib/services/data";
import { kr } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { CustomerList, NewCustomerButton, type CustomerRow } from "@/components/customer-list";

export const metadata = { title: "Kunder" };

export default function CustomersPage() {
  const customers = [...db().customers]
    .sort((a, b) => a.name.localeCompare(b.name, "sv"))
    .map((c): CustomerRow => {
      const s = customerSummary(c.id);
      return {
        id: c.id,
        name: c.name,
        kind: c.kind,
        contactPerson: c.contactPerson,
        email: c.email,
        phone: c.phone,
        city: c.city,
        openQuotes: s.openQuotes,
        activeJobs: s.activeJobs,
        unpaid: s.unpaid > 0 ? kr(s.unpaid) : null,
        newRequests: s.newRequests,
      };
    });

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Kunder"
        subtitle="Alla du jobbar med eller pratar med – allt kopplas ihop automatiskt."
        actions={<NewCustomerButton />}
      />
      <CustomerList customers={customers} />
    </div>
  );
}
