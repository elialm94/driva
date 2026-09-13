import Link from "next/link";
import { BadgeCheck, FileText, ReceiptText } from "lucide-react";
import { DiscardDraftButton } from "./discard-draft-button";
import { InvoiceStatusBadge, QuoteStatusBadge } from "./status";
import { datumTid, kr } from "@/lib/format";
import { jobEconomyDocCanDiscard, jobQuoteCardHeading } from "@/lib/job-ui-types";
import { invoiceTotals } from "@/lib/services/data";
import { acceptedByLabel } from "@/lib/status-labels";
import type { Invoice, Quote, QuoteAcceptance } from "@/lib/types";
import type { ReactNode } from "react";

function DocRow({
  href,
  icon,
  title,
  extra,
  badge,
  discard,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  extra?: ReactNode;
  badge: ReactNode;
  discard?: { kind: "quote" | "invoice"; documentId: string; returnTo: string };
}) {
  return (
    <div className="flex items-stretch first:rounded-t-[calc(1rem-1px)] last:rounded-b-[calc(1rem-1px)]">
      <Link
        href={href as never}
        className="flex min-w-0 flex-1 items-start gap-3 px-5 py-3.5 transition-colors hover:bg-canvas/60"
      >
        {icon}
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium">{title}</p>
          {extra}
        </div>
        <div className="shrink-0 self-center">{badge}</div>
      </Link>
      {discard ? (
        <div className="flex items-center pr-3" data-job-draft-discard={discard.kind}>
          <DiscardDraftButton
            kind={discard.kind}
            documentId={discard.documentId}
            appearance="icon"
            returnTo={discard.returnTo}
          />
        </div>
      ) : null}
    </div>
  );
}

export function JobEconomyDocs({
  quote,
  quoteAmount,
  quoteStatus,
  acceptance,
  quoteHref,
  invoices,
  invoiceHref,
  returnTo,
}: {
  quote?: Quote;
  quoteAmount: number;
  quoteStatus?: Quote["status"];
  acceptance?: QuoteAcceptance;
  quoteHref: string;
  invoices: Invoice[];
  invoiceHref: (id: string) => string;
  returnTo: string;
}) {
  return (
    <div className="divide-y divide-line/70 rounded-2xl border border-line/80" data-job-economy-docs>
      {quote ? (
        <DocRow
          href={quoteHref}
          icon={<FileText className="mt-0.5 size-4 shrink-0 text-muted" />}
          title={jobQuoteCardHeading(quote, quoteAmount)}
          extra={
            acceptance ? (
              <p className="mt-0.5 flex items-center gap-1 text-[13px] text-ok">
                <BadgeCheck className="size-3.5 shrink-0" />
                {acceptedByLabel(acceptance)}, {datumTid(acceptance.acceptedAt)}
              </p>
            ) : null
          }
          badge={<QuoteStatusBadge quote={quote} status={quoteStatus} />}
          discard={
            jobEconomyDocCanDiscard({ kind: "quote", status: quote.status })
              ? { kind: "quote", documentId: quote.id, returnTo }
              : undefined
          }
        />
      ) : null}
      {invoices.map((inv) => (
        <DocRow
          key={inv.id}
          href={invoiceHref(inv.id)}
          icon={<ReceiptText className="size-4 shrink-0 self-center text-muted" />}
          title={
            inv.number == null
              ? `Fakturautkast · ${kr(invoiceTotals(inv).toPay)}`
              : `Faktura #${inv.number} · ${kr(invoiceTotals(inv).toPay)}`
          }
          badge={<InvoiceStatusBadge invoice={inv} />}
          discard={
            jobEconomyDocCanDiscard({ kind: "invoice", status: inv.status, type: inv.type })
              ? { kind: "invoice", documentId: inv.id, returnTo }
              : undefined
          }
        />
      ))}
    </div>
  );
}
