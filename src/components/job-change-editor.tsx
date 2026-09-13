"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Save, Trash2 } from "lucide-react";
import type { DocLine, JobChange, VatRate } from "@/lib/types";
import { docTotals } from "@/lib/calc";
import { kr } from "@/lib/format";
import {
  createJobChangeAction,
  deleteJobChangeAction,
  saveAndSendJobChangeAction,
  updateJobChangeAction,
} from "@/app/closeout-actions";
import { LinesEditor, newLine } from "./lines-editor";
import { buttonClasses, cx } from "./ui";
import { Modal } from "./modal";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-soft";

/**
 * Redigera en ändring (utkast). Skicka = spara + lås + status "Väntar på
 * kunden". Ingen AI fyller i pris, material eller tid – bara det du skriver.
 */
export function JobChangeEditor({
  jobId,
  jobHref,
  change,
  defaultVatRate,
  defaultHourlyRate,
  rotActive,
  reverseCharge,
}: {
  jobId: string;
  jobHref: string;
  change?: JobChange;
  defaultVatRate: VatRate;
  defaultHourlyRate?: number;
  rotActive: boolean;
  reverseCharge: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(change?.title ?? "");
  const [description, setDescription] = useState(change?.description ?? "");
  const [timeImpact, setTimeImpact] = useState(change?.timeImpact ?? "");
  const [lines, setLines] = useState<DocLine[]>(
    change?.lines.length ? change.lines : [newLine("arbete", defaultVatRate, "andring-rad-1", defaultHourlyRate)]
  );
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [pending, start] = useTransition();
  const totals = docTotals(lines, null);
  const filled = lines.filter((l) => l.isHeading || l.description.trim().length > 0);
  const input = { title, description, timeImpact, lines: filled };

  function validate(forSend: boolean): string | null {
    if (!title.trim()) return "Ge ändringen en rubrik, t.ex. “Extra eluttag i köket”.";
    if (forSend && filled.filter((l) => !l.isHeading).length === 0) return "Lägg till minst en rad med beskrivning innan du skickar.";
    return null;
  }

  function saveDraft() {
    const v = validate(false);
    if (v) {
      setShowErrors(true);
      setError(v);
      return;
    }
    setError(null);
    start(async () => {
      const r = change ? await updateJobChangeAction(change.id, input) : await createJobChangeAction(jobId, input);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(`${jobHref}/andringar/${r.changeId}` as never);
      router.refresh();
    });
  }

  function send() {
    const v = validate(true);
    if (v) {
      setShowErrors(true);
      setError(v);
      setConfirmSend(false);
      return;
    }
    setError(null);
    start(async () => {
      let id = change?.id;
      if (!id) {
        const created = await createJobChangeAction(jobId, input);
        if (!created.ok) {
          setError(created.error);
          setConfirmSend(false);
          return;
        }
        id = created.changeId;
      }
      const r = await saveAndSendJobChangeAction(id, input);
      setConfirmSend(false);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(`${jobHref}/andringar/${r.changeId}?skickad=1` as never);
      router.refresh();
    });
  }

  function remove() {
    if (!change) {
      router.push(jobHref as never);
      return;
    }
    start(async () => {
      const r = await deleteJobChangeAction(change.id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(jobHref as never);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6" data-testid="job-change-editor">
      <div className="card px-5 py-5 sm:px-6">
        <div className="grid gap-4">
          <div>
            <label htmlFor="andring-rubrik" className={labelCls}>
              Vad gäller ändringen?
            </label>
            <input
              id="andring-rubrik"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="T.ex. Extra eluttag i köket"
              maxLength={200}
              className={cx(inputCls, showErrors && !title.trim() && "border-danger")}
              data-testid="job-change-title"
            />
          </div>
          <div>
            <label htmlFor="andring-beskrivning" className={labelCls}>
              Beskriv för kunden vad som ändras och varför
            </label>
            <textarea
              id="andring-beskrivning"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={4000}
              placeholder="Skriv som du skulle säga det till kunden. Det här är texten kunden godkänner."
              className={inputCls}
              data-testid="job-change-description"
            />
          </div>
          <div>
            <label htmlFor="andring-tid" className={labelCls}>
              Påverkan på tid (frivilligt)
            </label>
            <input
              id="andring-tid"
              value={timeImpact}
              onChange={(e) => setTimeImpact(e.target.value)}
              placeholder="T.ex. cirka två extra arbetsdagar"
              maxLength={300}
              className={inputCls}
            />
          </div>
        </div>
      </div>

      <div className="card px-5 py-5 sm:px-6">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-semibold">Pris för ändringen</h2>
          <p className="text-[13px] text-muted tabular">
            {kr(totals.subtotal)} exkl. moms · <span className="font-medium text-ink">{kr(totals.total)}</span> inkl. moms
          </p>
        </div>
        <p className="mb-4 text-[13px] text-soft">
          Använd negativt à-pris för avdrag. Rubriker räknas inte i summan.
        </p>
        <LinesEditor
          lines={lines}
          onChange={setLines}
          defaultVatRate={defaultVatRate}
          defaultHourlyRate={defaultHourlyRate}
          showErrors={showErrors}
          rotActive={rotActive}
          reverseCharge={reverseCharge}
          fromRegister={false}
        />
      </div>

      {error ? (
        <p role="alert" className="text-[13px] font-medium text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={saveDraft} disabled={pending} className={buttonClasses("secondary")} data-testid="job-change-save">
          <Save className="size-4" /> Spara utkast
        </button>
        <button type="button" onClick={() => setConfirmSend(true)} disabled={pending} className={buttonClasses("primary")} data-testid="job-change-send">
          <Send className="size-4" /> Skicka till kunden
        </button>
        <button type="button" onClick={remove} disabled={pending} className={cx(buttonClasses("ghost"), "ml-auto text-muted")}>
          <Trash2 className="size-4" /> {change ? "Ta bort utkastet" : "Avbryt"}
        </button>
      </div>

      <Modal open={confirmSend} onClose={() => setConfirmSend(false)} title="Skicka ändringen till kunden" size="sm">
        <div className="space-y-4 px-6 py-5">
          <p className="text-[14px] leading-relaxed text-soft">
            Innehållet låses när du skickar. Kunden godkänner exakt det här: <span className="font-medium text-ink">{title || "utan rubrik"}</span>,{" "}
            {kr(totals.total)} inkl. moms{timeImpact ? `, ${timeImpact}` : ""}. Behöver du ändra något efteråt skapar du en ny version.
          </p>
          <p className="text-[13px] text-muted">Du får en länk att dela med kunden. Inget skickas automatiskt.</p>
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClasses("ghost")} onClick={() => setConfirmSend(false)}>
              Avbryt
            </button>
            <button type="button" className={buttonClasses("primary")} onClick={send} disabled={pending} data-testid="job-change-send-confirm">
              {pending ? "Skickar …" : "Lås och skicka"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
