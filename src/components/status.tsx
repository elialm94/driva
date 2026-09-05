import type { Invoice, Job, PurchaseOrderStatus, Quote, TxStatus } from "@/lib/types";
import { Badge, StatusDot } from "./ui";
import { dagarTill } from "@/lib/format";
import { derivedJobStatus, type DerivedJobStatus } from "@/lib/services/job-lifecycle";
import {
  INVOICE_CREDIT_NOTE,
  INVOICE_STATUS,
  JOB_STATUS,
  PURCHASE_ORDER_STATUS,
  QUOTE_STATUS,
  TX_STATUS,
  invoiceOverdueLabel,
} from "@/lib/status-labels";

/** Materialbeställningens status – svenska etiketter, aldrig råa enumvärden. */
export function PurchaseOrderStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  const { tone, label } = PURCHASE_ORDER_STATUS[status];
  return (
    <Badge tone={tone}>
      <StatusDot tone={tone} />
      {label}
    </Badge>
  );
}

export function QuoteStatusBadge({ quote, status }: { quote: Quote; status?: Quote["status"] }) {
  const { tone, label } = QUOTE_STATUS[status ?? quote.status];
  return (
    <Badge tone={tone}>
      <StatusDot tone={tone} />
      {label}
    </Badge>
  );
}

export function InvoiceStatusBadge({ invoice }: { invoice: Invoice }) {
  // En kreditfaktura är ingen fordran – den kan aldrig vara "förfallen" eller "obetald".
  if (invoice.type === "kredit") {
    return (
      <Badge tone={INVOICE_CREDIT_NOTE.tone}>
        <StatusDot tone={INVOICE_CREDIT_NOTE.tone} />
        {INVOICE_CREDIT_NOTE.label}
      </Badge>
    );
  }
  if ((invoice.status === "skickad" || invoice.status === "delbetald") && dagarTill(invoice.dueDate) < 0) {
    const overdue = invoiceOverdueLabel(-dagarTill(invoice.dueDate));
    return (
      <Badge tone={overdue.tone}>
        <StatusDot tone={overdue.tone} />
        {overdue.label}
      </Badge>
    );
  }
  const { tone, label } = INVOICE_STATUS[invoice.status];
  return (
    <Badge tone={tone}>
      <StatusDot tone={tone} />
      {label}
    </Badge>
  );
}

export function JobStatusBadge({
  status,
  startDate,
  completedAt,
}: {
  status: Job["status"] | DerivedJobStatus;
  startDate?: string;
  completedAt?: string;
}) {
  const stored: Job["status"] = status === "planerat" ? "kommande" : status;
  const derived: DerivedJobStatus = derivedJobStatus({ status: stored, startDate, completedAt });
  const { tone, label } = JOB_STATUS[derived];
  return (
    <Badge tone={tone}>
      <StatusDot tone={tone} />
      {label}
    </Badge>
  );
}

export function TxStatusBadge({ status }: { status: TxStatus }) {
  const { tone, label } = TX_STATUS[status];
  return <Badge tone={tone}>{label}</Badge>;
}
