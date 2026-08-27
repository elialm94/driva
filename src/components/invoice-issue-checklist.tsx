import Link from "next/link";
import type { IssueBlocker } from "@/lib/invoices/validate";
import { Card } from "./ui";

export function InvoiceIssueChecklist({ blockers }: { blockers: IssueBlocker[] }) {
  if (blockers.length === 0) return null;
  return (
    <div id="invoice-send-blockers">
      <Card className="mb-6 border-warn/30 bg-warn-soft/40 px-5 py-4">
        <p className="text-[15px] font-semibold text-ink">Innan fakturan kan skickas</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[14px] text-soft">
          {blockers.map((b) => (
            <li key={b.code}>
              {b.message}
              {b.href ? (
                <>
                  {" "}
                  <Link href={b.href as never} className="font-medium text-ink underline-offset-2 hover:underline">
                    {b.actionLabel ?? "Komplettera"}
                  </Link>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
