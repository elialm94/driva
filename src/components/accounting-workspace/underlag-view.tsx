import { PageHeader } from "@/components/ui";
import { InboxList } from "@/components/inbox-list";
import { InboxAddressCard } from "@/components/inbox-address";
import { InboxUploadZone } from "@/components/inbox-upload";
import { inboundAddressForBusiness, listInbox } from "@/lib/services/inbox";
import { wsCan, type AccountingWorkspace } from "@/lib/accounting-workspace/shared";

function str(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/** Underlag (inkorgen) – samma lista på båda ytorna; uppladdning kräver skrivrätt. */
export function UnderlagView({
  ws,
  searchParams,
}: {
  ws: AccountingWorkspace;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const address = inboundAddressForBusiness();
  const query = {
    q: str(searchParams.q),
    filter: str(searchParams.visning) === "alla" ? ("alla" as const) : ("oppna" as const),
    economicOnly: str(searchParams.ekonomiska) !== "alla",
    page: Number(str(searchParams.sida)) || 1,
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Underlag"
        subtitle="Leverantörsfakturor, kvitton och andra ekonomiska dokument samlas här."
      />
      {wsCan(ws, "write_accounting") ? (
        <div className="mb-5">
          <InboxUploadZone />
        </div>
      ) : null}
      <InboxAddressCard address={address} />
      <InboxList result={listInbox(query)} query={query} />
    </div>
  );
}
