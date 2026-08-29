import { notFound } from "next/navigation";
import { Mail, Phone, Paperclip } from "lucide-react";
import { inquiryDisplayStatus } from "@/lib/services/customers";
import { getInboxView } from "@/lib/services/inbox";
import { datumTid, kr } from "@/lib/format";
import { Avatar, Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { AppLink } from "@/components/app-link";
import { SmartBack } from "@/components/back-link";
import { NewUppdragButton } from "@/components/uppdrag-form";
import { InboxMailActions } from "@/components/inbox-mail-actions";
import { kunderInboxHref, newQuoteHref } from "@/lib/nav";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Inbox" };

const SOURCE_LABEL = {
  hemsida: "Hemsida",
  email: "E-post",
  telefon: "Telefon",
  manuell: "Manuell",
  assistent: "Assistent",
} as const;

export default async function InboxDetailPage(props: { params: Promise<{ id: string }> }) {
  await ensurePageBusiness();
  const { id } = await props.params;
  const view = getInboxView(id);
  if (!view) notFound();

  if (view.kind === "inquiry") {
    const { request, customer } = view.view;
    const handled = inquiryDisplayStatus(request.status) === "hanterad";
    const fromHere = { href: `/inbox/${request.id}`, label: request.title };

    return (
      <div className="animate-fade-up">
        <PageHeader
          back={<SmartBack />}
          crumbs={[{ href: kunderInboxHref(), label: "Inbox" }, { label: request.title }]}
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
            <AppLink href={`/kunder/${customer.id}`} originLabel={request.title} className="flex items-center gap-3">
              <Avatar name={customer.name} />
              <div>
                <p className="text-[16px] font-semibold">{customer.name}</p>
                <p className="text-[13px] text-muted">{customer.kind === "foretag" ? "Företag" : "Privatperson"}</p>
              </div>
            </AppLink>
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

  const { item } = view;
  const handled = item.status !== "ny";
  const canCreateExpense =
    item.parsedAmount != null && item.parsedVatAmount != null && Boolean(item.parsedSupplier) && !item.expenseId;

  return (
    <div className="animate-fade-up">
      <PageHeader
        back={<SmartBack />}
        crumbs={[{ href: kunderInboxHref(), label: "Inbox" }, { label: item.subject || "Mejl" }]}
        title={item.subject || "(utan ämne)"}
        subtitle={`${item.fromAddress} · inkommen ${datumTid(item.createdAt)}`}
        actions={
          item.status === "ny" ? (
            <InboxMailActions itemId={item.id} canCreateExpense={canCreateExpense} />
          ) : item.expenseId ? (
            <ButtonLink href="/ekonomi?flik=utgifter" variant="secondary">
              Öppna utgifter
            </ButtonLink>
          ) : undefined
        }
      />

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[16px] font-semibold">{item.fromAddress}</p>
            <p className="text-[13px] text-muted">till {item.toAddress}</p>
          </div>
          <Badge tone={handled ? "neutral" : "info"}>
            {item.status === "bokford" ? "Bokförd" : handled ? "Behandlad" : "Ny"}
          </Badge>
        </div>

        {item.parsedAmount != null ? (
          <p className="mt-3 text-[14px] text-soft">
            Tolkat belopp: <span className="font-medium text-ink">{kr(item.parsedAmount)}</span>
            {item.parsedSupplier ? ` · ${item.parsedSupplier}` : ""}
            {item.confidence != null ? ` · konfidens ${(item.confidence * 100).toFixed(0)} %` : ""}
          </p>
        ) : (
          <p className="mt-3 text-[14px] text-muted">Inget belopp tolkat – Driva gissar inte belopp från mejlet.</p>
        )}

        <div className="mt-5 border-t border-line pt-4">
          <p className="mb-2 text-[13px] font-medium text-muted">Meddelande</p>
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{item.textBody}</p>
        </div>

        {item.attachments.length > 0 ? (
          <div className="mt-5 border-t border-line pt-4">
            <p className="mb-2 text-[13px] font-medium text-muted">Bilagor</p>
            <ul className="space-y-2">
              {item.attachments.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-[14px] text-soft">
                  <Paperclip className="size-3.5 text-muted" />
                  <span>{a.filename}</span>
                  <span className="text-muted">{a.contentType}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
