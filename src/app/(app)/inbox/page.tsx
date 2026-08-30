import { PageHeader } from "@/components/ui";
import { InboxList } from "@/components/inbox-list";
import { InboxAddressCard } from "@/components/inbox-address";
import { InboxUploadButton } from "@/components/inbox-upload";
import { inboundAddressForBusiness, listInbox } from "@/lib/services/inbox";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Inbox" };

function str(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function InboxPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await ensurePageBusiness();
  const searchParams = await props.searchParams;
  const address = inboundAddressForBusiness();

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Inbox"
        subtitle="Leverantörsfakturor, kvitton och andra ekonomiska dokument samlas här."
        actions={<InboxUploadButton />}
      />
      <InboxAddressCard address={address} />
      <InboxList
        result={listInbox({
          q: str(searchParams.q),
          filter: str(searchParams.visning) === "alla" ? "alla" : "oppna",
          page: Number(str(searchParams.sida)) || 1,
        })}
        query={{
          q: str(searchParams.q),
          filter: str(searchParams.visning) === "alla" ? "alla" : "oppna",
          page: Number(str(searchParams.sida)) || 1,
        }}
      />
    </div>
  );
}
