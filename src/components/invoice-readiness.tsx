import type { InvoiceReadiness } from "@/lib/services/invoice-readiness";

export function InvoiceReadinessBlock({ readiness }: { readiness: InvoiceReadiness }) {
  if (readiness.uninvoicedCount === 0 && readiness.unfinishedLineCount === 0) return null;
  return (
    <div className="mt-3 rounded-xl border border-line/80 px-3 py-2 text-[13px]" data-invoice-readiness="">
      {readiness.ready ? (
        <p className="font-medium text-ink">Redo att fakturera</p>
      ) : readiness.canInvoiceWithoutUnfinished ? (
        <p className="font-medium text-ink">Du kan fakturera det som är klart. Resten ligger kvar på uppdraget.</p>
      ) : (
        <p className="font-medium text-ink">Inget klart att fakturera ännu.</p>
      )}
      {readiness.blockers.length > 0 ? (
        <ul className="mt-1 list-disc pl-4 text-warn">
          {readiness.blockers.map((b) => (
            <li key={`${b.kind}-${b.text}`}>{b.text}</li>
          ))}
        </ul>
      ) : null}
      {readiness.warnings.length > 0 ? (
        <ul className="mt-1 list-disc pl-4 text-muted">
          {readiness.warnings.map((w) => (
            <li key={`${w.kind}-${w.text}`}>{w.text}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
