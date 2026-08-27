import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Plus,
  Inbox,
  FileText,
  Hammer,
  ReceiptText,
} from "lucide-react";
import { getCustomer, customerBundle, quoteTotals } from "@/lib/services/data";
import { docTotals } from "@/lib/calc";
import { db } from "@/lib/store";
import { kr, relativ, datumKort } from "@/lib/format";
import { Avatar, Badge, ButtonLink, Card, SectionTitle, cx } from "@/components/ui";
import { InvoiceStatusBadge, JobStatusBadge, QuoteStatusBadge } from "@/components/status";
import { NotesEditor } from "@/components/notes-editor";
import { NewRequestButton } from "@/components/request-form";
import { updateCustomerNotesAction } from "@/app/actions";

export const metadata = { title: "Kund" };

const REQUEST_STATUS: Record<string, { label: string; tone: "info" | "neutral" | "ok" }> = {
  ny: { label: "Ny", tone: "info" },
  offert_skapad: { label: "Offert skapad", tone: "ok" },
  besvarad: { label: "Besvarad", tone: "neutral" },
  avslutad: { label: "Avslutad", tone: "neutral" },
};

export default async function CustomerPage(props: PageProps<"/kunder/[id]">) {
  const { id } = await props.params;
  const customer = getCustomer(id);
  if (!customer) notFound();
  const bundle = customerBundle(id);
  const data = db();

  const sectionEmpty = "px-5 py-4 text-[14px] text-muted";
  const rowCls =
    "flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-canvas/60 first:rounded-t-[calc(1.25rem-1px)] last:rounded-b-[calc(1.25rem-1px)]";

  return (
    <div className="animate-fade-up">
      <Link href="/kunder" className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Kunder
      </Link>

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar name={customer.name} size="lg" />
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-[22px] font-semibold tracking-tight">{customer.name}</h1>
                <Badge tone="neutral">{customer.kind === "foretag" ? "Företag" : "Privatperson"}</Badge>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[14px] text-soft">
                {customer.contactPerson ? <span>{customer.contactPerson}</span> : null}
                <a href={`mailto:${customer.email}`} className="flex items-center gap-1.5 hover:text-ink">
                  <Mail className="size-3.5 text-muted" /> {customer.email}
                </a>
                {customer.phone ? (
                  <span className="flex items-center gap-1.5">
                    <Phone className="size-3.5 text-muted" /> {customer.phone}
                  </span>
                ) : null}
                {customer.address ? (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="size-3.5 text-muted" />{" "}
                    {[customer.address, [customer.postalCode, customer.city].filter(Boolean).join(" ")]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <NewRequestButton customerId={customer.id} customerName={customer.name} />
            <ButtonLink href={`/pengar/offerter/ny?kund=${customer.id}`} size="sm">
              <Plus className="size-3.5" /> Ny offert
            </ButtonLink>
          </div>
        </div>
        <div className="mt-5 border-t border-line pt-4">
          <p className="mb-1.5 text-[13px] font-medium text-muted">Anteckningar</p>
          <NotesEditor
            initial={customer.notes}
            placeholder="Portkod, önskemål, bra att veta …"
            save={updateCustomerNotesAction.bind(null, customer.id)}
          />
        </div>
      </Card>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <div className="space-y-8">
          <div>
            <SectionTitle>Förfrågningar</SectionTitle>
            <Card className="divide-y divide-line/70">
              {bundle.requests.length === 0 ? (
                <p className={sectionEmpty}>Inga förfrågningar ännu.</p>
              ) : (
                bundle.requests.map((r) => {
                  const st = REQUEST_STATUS[r.status];
                  return (
                    <div key={r.id} className={cx(rowCls, "items-start")}>
                      <Inbox className="mt-1 size-4 shrink-0 text-muted" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium">{r.title}</p>
                        <p className="mt-0.5 line-clamp-2 text-[13px] text-soft">”{r.message}”</p>
                        {r.ai ? (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {r.ai.workType ? <Badge tone="accent">{r.ai.workType}</Badge> : null}
                            {r.ai.desiredStart ? <Badge tone="neutral">Önskad start: {r.ai.desiredStart}</Badge> : null}
                            {r.ai.budget ? <Badge tone="neutral">Budget: {r.ai.budget}</Badge> : null}
                          </div>
                        ) : null}
                        <p className="mt-1 text-[12px] text-muted">{relativ(r.createdAt)}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {r.status === "ny" ? (
                          <ButtonLink href={`/pengar/offerter/ny?kund=${customer.id}&forfragan=${r.id}`} size="sm">
                            Skapa offert
                          </ButtonLink>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </Card>
          </div>

          <div>
            <SectionTitle>Offerter</SectionTitle>
            <Card className="divide-y divide-line/70">
              {bundle.quotes.length === 0 ? (
                <p className={sectionEmpty}>Inga offerter ännu.</p>
              ) : (
                bundle.quotes.map((q) => (
                  <Link key={q.id} href={`/pengar/offerter/${q.id}` as never} className={rowCls}>
                    <FileText className="size-4 shrink-0 text-muted" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium">
                        Offert #{q.number} · {data.quoteVersions.find((v) => v.id === q.currentVersionId)?.title}
                      </p>
                      <p className="text-[13px] text-muted">{kr(quoteTotals(q).toPay)}</p>
                    </div>
                    <QuoteStatusBadge quote={q} />
                  </Link>
                ))
              )}
            </Card>
          </div>

          <div>
            <SectionTitle>Jobb</SectionTitle>
            <Card className="divide-y divide-line/70">
              {bundle.jobs.length === 0 ? (
                <p className={sectionEmpty}>Inga jobb ännu.</p>
              ) : (
                bundle.jobs.map((j) => (
                  <Link key={j.id} href={`/jobb/${j.id}` as never} className={rowCls}>
                    <Hammer className="size-4 shrink-0 text-muted" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium">{j.title}</p>
                      {j.startDate ? <p className="text-[13px] text-muted">{datumKort(j.startDate)}</p> : null}
                    </div>
                    <JobStatusBadge status={j.status} />
                  </Link>
                ))
              )}
            </Card>
          </div>

          <div>
            <SectionTitle>Fakturor</SectionTitle>
            <Card className="divide-y divide-line/70">
              {bundle.invoices.length === 0 ? (
                <p className={sectionEmpty}>Inga fakturor ännu.</p>
              ) : (
                bundle.invoices.map((inv) => (
                  <Link key={inv.id} href={`/pengar/fakturor/${inv.id}` as never} className={rowCls}>
                    <ReceiptText className="size-4 shrink-0 text-muted" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium">Faktura #{inv.number}</p>
                      <p className="text-[13px] text-muted">{kr(docTotals(inv.lines, inv.rot).toPay)}</p>
                    </div>
                    <InvoiceStatusBadge invoice={inv} />
                  </Link>
                ))
              )}
            </Card>
          </div>
        </div>

        <div>
          <SectionTitle>Historik</SectionTitle>
          <Card className="px-5 py-2">
            {bundle.activity.length === 0 ? (
              <p className="py-3 text-[14px] text-muted">Ingen aktivitet ännu.</p>
            ) : (
              bundle.activity.map((a, i) => (
                <div key={a.id} className={cx("flex gap-3 py-3", i > 0 && "border-t border-line/60")}>
                  <div className="mt-[7px] size-1.5 shrink-0 rounded-full bg-line-strong" />
                  <div className="min-w-0">
                    <p className="text-[14px] leading-snug text-soft">{a.text}</p>
                    <p className="mt-0.5 text-[12px] text-muted">{relativ(a.at)}</p>
                  </div>
                </div>
              ))
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
