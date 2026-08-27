import type { Invoice, Job, Quote, TxStatus } from "@/lib/types";
import { Badge, StatusDot, type BadgeTone } from "./ui";
import { dagarTill } from "@/lib/format";
import { derivedJobStatus, type DerivedJobStatus } from "@/lib/services/job-lifecycle";

export function QuoteStatusBadge({ quote }: { quote: Quote }) {
  const map: Record<Quote["status"], { tone: BadgeTone; label: string }> = {
    utkast: { tone: "neutral", label: "Utkast" },
    skickad: { tone: "warn", label: "Väntar på BankID" },
    godkand: { tone: "ok", label: "Godkänd med BankID" },
    avbojd: { tone: "danger", label: "Avböjd" },
    utgangen: { tone: "neutral", label: "Utgången" },
  };
  const { tone, label } = map[quote.status];
  return (
    <Badge tone={tone}>
      <StatusDot tone={tone} />
      {label}
    </Badge>
  );
}

export function InvoiceStatusBadge({ invoice }: { invoice: Invoice }) {
  if (invoice.status === "skickad" && dagarTill(invoice.dueDate) < 0) {
    return (
      <Badge tone="danger">
        <StatusDot tone="danger" />
        Försenad {-dagarTill(invoice.dueDate)} dagar
      </Badge>
    );
  }
  const map: Record<Invoice["status"], { tone: BadgeTone; label: string }> = {
    utkast: { tone: "neutral", label: "Utkast" },
    skickad: { tone: "info", label: "Skickad" },
    betald: { tone: "ok", label: "Betald" },
    krediterad: { tone: "neutral", label: "Krediterad" },
  };
  const { tone, label } = map[invoice.status];
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
  const derived = derivedJobStatus({ status: stored, startDate, completedAt });
  const map: Record<DerivedJobStatus, { tone: BadgeTone; label: string }> = {
    planerat: { tone: "info", label: "Planerat" },
    pagar: { tone: "warn", label: "Pågår" },
    klart: { tone: "ok", label: "Klart" },
  };
  const { tone, label } = map[derived];
  return (
    <Badge tone={tone}>
      <StatusDot tone={tone} />
      {label}
    </Badge>
  );
}

export function TxStatusBadge({ status }: { status: TxStatus }) {
  const map: Record<TxStatus, { tone: BadgeTone; label: string }> = {
    ny: { tone: "neutral", label: "Ny" },
    matchad: { tone: "info", label: "Matchad" },
    bokford: { tone: "ok", label: "Bokförd" },
    behover_atgard: { tone: "warn", label: "Behöver åtgärd" },
  };
  const { tone, label } = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}
