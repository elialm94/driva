import type { IssueBlocker } from "@/lib/invoices/validate";
import { SendChecklist } from "./send-checklist";

export function InvoiceIssueChecklist({ blockers }: { blockers: IssueBlocker[] }) {
  return <SendChecklist id="invoice-send-blockers" title="Innan fakturan kan skickas" blockers={blockers} />;
}
