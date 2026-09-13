import { notFound, redirect } from "next/navigation";
import { extractionReviewForItem, getInboxMail } from "@/lib/services/inbox";
import { attachmentIsViewable } from "@/lib/inbox/attachment-content";
import { kr } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { DocumentPane } from "@/components/document-viewer";
import { ExtractionReviewForm } from "@/components/extraction-review";
import { kunderInboxHref } from "@/lib/nav";
import { isOwnerSurface, wsCan, wsHref, type AccountingWorkspace } from "@/lib/accounting-workspace/shared";
import { DocumentLineReview } from "@/components/document-line-review";
import { getJob } from "@/lib/services/data";
import {
  documentLineMathFor,
  documentLineSourceFromInboxType,
  jobsForDocumentReview,
  lineReviewHeadline,
  linesForInboxItem,
} from "@/lib/services/document-lines";

/**
 * Fokuserad granskning: dokumentet till vänster, Fervas tolkning till höger.
 * Användaren rättar mot PDF:en och godkänner – därefter körs pipelinen om.
 */
export function UnderlagKontrolleraView({ ws, id }: { ws: AccountingWorkspace; id: string }) {
  const item = getInboxMail(id);
  if (!item) notFound();
  if (!wsCan(ws, "write_accounting")) redirect(wsHref(ws, `/bokforing/underlag/${id}`));

  let review;
  try {
    review = extractionReviewForItem(id);
  } catch {
    notFound();
  }
  // Orderbekräftelser går aldrig genom faktura-/kvittogranskningen –
  // avstämningen bor på beställningen.
  if (!review.editable || item.documentType === "orderbekraftelse") redirect(wsHref(ws, `/bokforing/underlag/${id}`));

  const attachment = item.attachments.find((a) => attachmentIsViewable(a));
  const who = item.parsedSupplier ?? item.subject ?? "dokument";
  const amountField = review.fields.find((f) => f.key === "amount");
  const uncertainAmount = !amountField || amountField.value == null || amountField.state === "kontrollera";

  return (
    <div className="animate-fade-up">
      <PageHeader
        back={isOwnerSurface(ws) ? <SmartBack /> : undefined}
        crumbs={[
          { href: wsHref(ws, kunderInboxHref()), label: "Underlag" },
          { href: wsHref(ws, `/bokforing/underlag/${item.id}`), label: who },
          { label: "Kontrollera" },
        ]}
        title="Kontrollera belopp"
        subtitle={
          uncertainAmount
            ? amountField?.value != null
              ? `Ferva läste ${kr(Number(amountField.value))} men är inte säker – jämför mot dokumentet.`
              : "Ferva kunde inte läsa totalbeloppet säkert – jämför mot dokumentet."
            : "Kontrollera uppgifterna mot dokumentet och godkänn."
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(360px,1fr)] lg:items-start">
        {attachment ? (
          <DocumentPane
            href={`/api/inbox/bilaga/${item.id}/${attachment.id}`}
            filename={attachment.filename}
          />
        ) : (
          <Card className="p-6">
            <p className="text-[14px] font-medium text-ink">Inget visningsbart dokument</p>
            <p className="mt-1 text-[13px] text-muted">
              Posten saknar bilaga som kan visas här. Kontrollera uppgifterna mot originalet och godkänn.
            </p>
            {item.textBody ? (
              <p className="mt-3 whitespace-pre-wrap rounded-xl bg-canvas p-3 text-[13px] text-soft">
                {item.textBody}
              </p>
            ) : null}
          </Card>
        )}

        <div>
          <ExtractionReviewForm
            itemId={item.id}
            documentType={review.documentType === "orderbekraftelse" ? "ekonomiskt_dokument" : review.documentType}
            fields={review.fields}
            backHref={wsHref(ws, `/bokforing/underlag/${item.id}`)}
          />
          {(() => {
            const lines = linesForInboxItem(item.id);
            if (lines.length === 0) return null;
            const source = documentLineSourceFromInboxType(item.documentType);
            const startedJobId = item.jobMatchMethod === "started_from_job" ? item.suggestedJobId : undefined;
            const suggested = item.suggestedJobId ? getJob(item.suggestedJobId) : undefined;
            const copy = lineReviewHeadline(item.id, source, startedJobId ? suggested?.title : undefined);
            const math = documentLineMathFor(source, item.id, item.parsedAmount ?? 0);
            return (
              <DocumentLineReview
                source={source}
                sourceDocumentId={item.id}
                lines={lines}
                headline={copy.found}
                question={
                  copy.question ??
                  (suggested && !startedJobId
                    ? `Ferva föreslår '${suggested.title}' - bekräfta innan du kopplar.`
                    : undefined)
                }
                mathMessage={math.message}
                mathOk={math.ok}
                jobs={jobsForDocumentReview()}
                startedJobId={startedJobId}
              />
            );
          })()}
        </div>
      </div>
    </div>
  );
}
