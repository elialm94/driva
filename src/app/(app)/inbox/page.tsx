import { PageHeader } from "@/components/ui";
import { InboxList } from "@/components/inbox-list";
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
        subtitle={`Förfrågningar från hemsidan och inkommande kvitton till ${address}. Inte samma lista som Hem.`}
      />
      <p className="mb-4 rounded-2xl border border-line bg-card px-4 py-3 text-[14px] text-soft">
        Inkommande adress: <span className="font-medium text-ink">{address}</span>
      </p>
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
