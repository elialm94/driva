import { notFound, redirect } from "next/navigation";
import { extractionReviewForItem, getInboxMail } from "@/lib/services/inbox";
import { attachmentIsViewable } from "@/lib/inbox/attachment-content";
import { kr } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { DocumentPane } from "@/components/document-viewer";
import { ExtractionReviewForm } from "@/components/extraction-review";
import { kunderInboxHref } from "@/lib/nav";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Kontrollera belopp" };

/**
 * Fokuserad granskning: dokumentet till vänster, Drivas tolkning till höger.
 * Användaren rättar mot PDF:en och godkänner – därefter körs pipelinen om.
 */
export default async function KontrolleraPage(props: { params: Promise<{ id: string }> }) {
  await ensurePageBusiness();
  const { id } = await props.params;
  const item = getInboxMail(id);
  if (!item) notFound();

  let review;
  try {
    review = extractionReviewForItem(id);
  } catch {
    notFound();
  }
  // Orderbekräftelser går aldrig genom faktura-/kvittogranskningen –
  // avstämningen bor på beställningen.
  if (!review.editable || item.documentType === "orderbekraftelse") redirect(`/inbox/${id}`);

  const attachment = item.attachments.find((a) => attachmentIsViewable(a));
  const who = item.parsedSupplier ?? item.subject ?? "dokument";
  const amountField = review.fields.find((f) => f.key === "amount");
  const uncertainAmount = !amountField || amountField.value == null || amountField.state === "kontrollera";

  return (
    <div className="animate-fade-up">
      <PageHeader
        back={<SmartBack />}
        crumbs={[
          { href: kunderInboxHref(), label: "Inbox" },
          { href: `/inbox/${item.id}`, label: who },
          { label: "Kontrollera" },
        ]}
        title="Kontrollera belopp"
        subtitle={
          uncertainAmount
            ? amountField?.value != null
              ? `Driva läste ${kr(Number(amountField.value))} men är inte säker – jämför mot dokumentet.`
              : "Driva kunde inte läsa totalbeloppet säkert – jämför mot dokumentet."
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

        <ExtractionReviewForm
          itemId={item.id}
          documentType={review.documentType === "orderbekraftelse" ? "ekonomiskt_dokument" : review.documentType}
          fields={review.fields}
          backHref={`/inbox/${item.id}`}
        />
      </div>
    </div>
  );
}
