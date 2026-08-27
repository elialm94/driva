import Link from "next/link";
import { notFound } from "next/navigation";
import { Mail, Phone } from "lucide-react";
import { getInquiryView, inquiryDisplayStatus } from "@/lib/services/customers";
import { datumTid } from "@/lib/format";
import { Avatar, Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { BackLink } from "@/components/back-link";
import { NewUppdragButton } from "@/components/uppdrag-form";
import { kunderInboxHref, newQuoteHref } from "@/lib/nav";

export const metadata = { title: "Förfrågan" };

const SOURCE_LABEL = {
  hemsida: "Hemsida",
  email: "E-post",
  telefon: "Telefon",
  manuell: "Manuell",
  assistent: "Assistent",
} as const;

export default async function InquiryPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const view = getInquiryView(id);
  if (!view) notFound();
  const { request, customer } = view;
  const handled = inquiryDisplayStatus(request.status) === "hanterad";
  const fromHere = { href: `/kunder/forfragningar/${request.id}`, label: request.title };

  return (
    <div className="animate-fade-up">
      <PageHeader
        back={<BackLink fallbackHref={kunderInboxHref()} fallbackLabel="Förfrågningar" />}
        crumbs={[
          { href: "/kunder", label: "Kunder" },
          { href: kunderInboxHref(), label: "Förfrågningar" },
          { label: request.title },
        ]}
        title={request.title}
        subtitle={`${customer.name} · inkommen ${datumTid(request.createdAt)}`}
        actions={
          request.status === "ny" ? (
            <>
              <NewUppdragButton
                customers={[{ id: customer.id, name: customer.name, kind: customer.kind }]}
                defaultCustomerId={customer.id}
                defaultTitle={request.ai?.workType ?? request.title}
                defaultDescription={request.message}
                size="sm"
                variant="secondary"
              />
              <ButtonLink href={newQuoteHref({ kund: customer.id, forfragan: request.id, from: fromHere })}>
                Skapa offert
              </ButtonLink>
            </>
          ) : request.quoteId ? (
            <ButtonLink href={`/ekonomi/offerter/${request.quoteId}`} variant="secondary">
              Öppna offert
            </ButtonLink>
          ) : undefined
        }
      />

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <Link href={`/kunder/${customer.id}` as never} className="flex items-center gap-3">
            <Avatar name={customer.name} />
            <div>
              <p className="text-[16px] font-semibold">{customer.name}</p>
              <p className="text-[13px] text-muted">{customer.kind === "foretag" ? "Företag" : "Privatperson"}</p>
            </div>
          </Link>
          <Badge tone={handled ? "neutral" : "info"}>{handled ? "Hanterad" : "Ny"}</Badge>
        </div>

        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[14px] text-soft">
          {customer.contactPerson ? <span>{customer.contactPerson}</span> : null}
          <a href={`mailto:${customer.email}`} className="flex items-center gap-1.5 hover:text-ink">
            <Mail className="size-3.5 text-muted" /> {customer.email}
          </a>
          {customer.phone ? (
            <span className="flex items-center gap-1.5">
              <Phone className="size-3.5 text-muted" /> {customer.phone}
            </span>
          ) : null}
          <span className="text-muted">via {SOURCE_LABEL[request.source]}</span>
        </div>

        <div className="mt-5 border-t border-line pt-4">
          <p className="mb-2 text-[13px] font-medium text-muted">Meddelande</p>
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{request.message}</p>
        </div>
      </Card>
    </div>
  );
}
