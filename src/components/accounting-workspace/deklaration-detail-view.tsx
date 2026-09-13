import { notFound, redirect } from "next/navigation";
import { SmartBack } from "@/components/back-link";
import { InlamningPanel } from "@/components/inlamning";
import { ManuellInlamning } from "@/components/manuell-inlamning";
import { Badge, PageHeader } from "@/components/ui";
import { isOwnerSurface, wsCan, wsHref, type AccountingWorkspace } from "@/lib/accounting-workspace/shared";
import { FILING_GROUP_LABEL, filingCaseById, filingCaseDetail, isFilingKind } from "@/lib/filing/deklarationer";
import { datumLang, kr } from "@/lib/format";

/**
 * Ett deklarationsärende: kontroll, hämta fil, öppna e-tjänsten, instruktioner,
 * "Jag har lämnat in" och historik. Samma vy för ägare och konsult; vad
 * knapparna får göra styrs av arbetsytans capabilities.
 *
 * ROT/RUT-ärenden hör hemma på uppdraget/fakturan och skickas dit.
 */
export function DeklarationDetailView({ ws, type, subjectId }: { ws: AccountingWorkspace; type: string; subjectId: string }) {
  if (type === "hus") {
    const c = filingCaseById("hus", subjectId);
    if (!c) notFound();
    redirect(wsHref(ws, c.href));
  }
  if (!isFilingKind(type)) notFound();

  const detail = filingCaseDetail(type, subjectId);
  if (!detail) notFound();

  const c = detail.case;
  const canPrepare = wsCan(ws, "prepare_filing");
  const canSubmit = wsCan(ws, "submit_filing");
  const groupTone = c.group === "inlamnat" ? "ok" : c.group === "kommande" ? "info" : "warn";

  return (
    <div>
      <PageHeader
        back={isOwnerSurface(ws) ? <SmartBack /> : undefined}
        title={`${c.title} · ${c.periodLabel}`}
        subtitle={c.status}
      />

      <p className="mb-5 text-[12.5px] leading-relaxed text-muted">
        <Badge tone={groupTone}>{FILING_GROUP_LABEL[c.group]}</Badge>{" "}
        {c.authorityName}
        {c.dueDate ? ` · senast ${datumLang(c.dueDate)}` : ""}
        {c.amount != null && c.amount > 0 ? ` · ${kr(c.amount)}` : ""}
        {" · "}
        {c.responsible.prepare} {c.responsible.submit}
      </p>

      {detail.machine.available ? (
        <div className="mb-6">
          <InlamningPanel {...detail.machine} businessId={ws.actionBusinessId} blockers={c.blockers} />
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            Inlämning via leverantör finns för det här företaget. Vill du hellre lämna in för hand följer du stegen nedan; båda
            vägarna hamnar i samma historik.
          </p>
        </div>
      ) : null}

      <ManuellInlamning
        kind={type}
        subjectId={subjectId}
        businessId={ws.actionBusinessId}
        authorityName={c.authorityName}
        periodLabel={c.periodLabel}
        instruction={detail.instruction}
        instructionsVersion={detail.instructionsVersion}
        files={detail.files}
        packageHref={detail.packageHref}
        blockers={c.blockers}
        warnings={detail.warnings}
        payloadError={detail.payloadError}
        canReport={detail.canReport}
        canPrepare={canPrepare}
        canSubmit={canSubmit}
        downloadedCurrent={detail.downloadedCurrent}
        open={detail.open}
        history={detail.history}
        alreadyFiled={c.group === "inlamnat"}
        machineAvailable={detail.machine.available}
      />
    </div>
  );
}
