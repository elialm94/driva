"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mic, PenLine } from "lucide-react";
import { Badge, buttonClasses, cx } from "./ui";
import { Modal } from "./modal";
import { DateField } from "./date-field";
import { AppLink } from "./app-link";
import { DAY_REPORT_KIND_LABEL, parseDayReport, type DayReportItem, type DayReportItemKind } from "@/lib/day-report";
import { saveDayReportAction } from "@/app/closeout-actions";

/*
 * "Rapportera dagens jobb" - text in, granskade förslag ut.
 *
 * Röst är medvetet inte inbyggt: det finns ingen säker röstarkitektur i
 * repot och ingen ny extern leverantör ska läggas till. Gränssnittet är byggt
 * så att en diktering kan fylla samma textfält senare (se onDictation), och
 * allt därefter - tolkning, granskning, sparande - är redan på plats.
 */

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted focus:border-accent";
const smallInputCls =
  "w-full rounded-lg border border-line-strong bg-card px-2.5 py-1.5 text-[14px] text-ink placeholder:text-muted focus:border-accent";

const KIND_TONE: Record<DayReportItemKind, "info" | "neutral" | "accent" | "warn"> = {
  tid: "info",
  resa: "neutral",
  material: "accent",
  andring: "warn",
  anteckning: "neutral",
};

type ReviewItem = DayReportItem & { selected: boolean; unitPrice: string; qtyText: string };

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toReview(items: DayReportItem[]): ReviewItem[] {
  return items.map((i) => ({
    ...i,
    selected: true,
    unitPrice: "",
    qtyText: i.qty != null ? String(i.qty).replace(".", ",") : "",
  }));
}

export function DayReportButton({ jobId, className }: { jobId: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className ?? buttonClasses("secondary", "sm")}
        onClick={() => setOpen(true)}
        data-testid="day-report-open"
      >
        <PenLine className="size-3.5" />
        <span className="sm:hidden">Dagens jobb</span>
        <span className="hidden sm:inline">Rapportera dagens jobb</span>
      </button>
      <DayReportSheet open={open} onClose={() => setOpen(false)} jobId={jobId} />
    </>
  );
}

export function DayReportSheet({ open, onClose, jobId }: { open: boolean; onClose: () => void; jobId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<"skriv" | "granska" | "klart">("skriv");
  const [text, setText] = useState("");
  const [date, setDate] = useState(todayISO);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ entries: number; changes: number; notes: number; firstChangeId?: string } | null>(null);

  function reset() {
    setStep("skriv");
    setText("");
    setItems([]);
    setError(null);
    setSaved(null);
  }

  function close() {
    onClose();
    reset();
  }

  function interpret() {
    const parsed = parseDayReport(text);
    if (parsed.length === 0) {
      setError("Skriv några ord om dagen först, till exempel \"tre timmar montering, köpte skruv på Beijer\".");
      return;
    }
    setError(null);
    setItems(toReview(parsed));
    setStep("granska");
  }

  function patch(id: string, p: Partial<ReviewItem>) {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...p } : i)));
  }

  const chosen = items.filter((i) => i.selected);

  function save() {
    setError(null);
    const payload = chosen.map((i) => {
      const qty = i.qtyText.trim() === "" ? undefined : Number(i.qtyText.replace(",", "."));
      const unitPrice = i.unitPrice.trim() === "" ? undefined : Math.round(Number(i.unitPrice.replace(",", ".")));
      return {
        id: i.id,
        kind: i.kind,
        description: i.description,
        source: i.source,
        ...(i.unit ? { unit: i.unit } : {}),
        ...(i.supplier ? { supplier: i.supplier } : {}),
        ...(qty != null && Number.isFinite(qty) ? { qty } : {}),
        ...(unitPrice != null && Number.isFinite(unitPrice) ? { unitPrice } : {}),
      };
    });
    startTransition(async () => {
      const res = await saveDayReportAction(jobId, payload, date);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved({ entries: res.entries, changes: res.changes, notes: res.notes, firstChangeId: res.firstChangeId });
      setStep("klart");
      router.refresh();
    });
  }

  const footer =
    step === "skriv" ? (
      <div className="flex justify-end gap-2">
        <button type="button" className={buttonClasses("ghost")} onClick={close}>
          Avbryt
        </button>
        <button
          type="button"
          className={buttonClasses("primary")}
          onClick={interpret}
          disabled={!text.trim()}
          data-testid="day-report-interpret"
        >
          Tolka
        </button>
      </div>
    ) : step === "granska" ? (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className={buttonClasses("ghost")} onClick={() => setStep("skriv")}>
          Ändra texten
        </button>
        <button
          type="button"
          className={buttonClasses("primary")}
          onClick={save}
          disabled={isPending || chosen.length === 0}
          data-testid="day-report-save"
        >
          {isPending ? "Sparar …" : chosen.length === 1 ? "Spara 1 post" : `Spara ${chosen.length} poster`}
        </button>
      </div>
    ) : (
      <div className="flex justify-end gap-2">
        <button type="button" className={buttonClasses("primary")} onClick={close} data-testid="day-report-done">
          Klart
        </button>
      </div>
    );

  return (
    <Modal open={open} onClose={close} title="Rapportera dagens jobb" size="md" footer={footer}>
      <div className="space-y-4 px-6 py-5" data-testid={`day-report-step-${step}`}>
        {step === "skriv" ? (
          <>
            <p className="text-[14px] text-muted">
              Berätta med egna ord vad som hände i dag. Vi delar upp det i tid, resa, material, ändringar och
              anteckningar som du granskar innan något sparas. Inga priser fylls i åt dig.
            </p>
            <label className="block">
              <span className="mb-1 block text-[13px] text-muted">Datum</span>
              <DateField value={date} onChange={setDate} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[13px] text-muted">Vad gjorde du i dag?</span>
              <textarea
                className={cx(inputCls, "min-h-32 resize-y")}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Tre timmar montering, fyrtiofem minuter resa, köpte skruv och reglar på Beijer och kunden ville även att vi byter två lister."
                data-testid="day-report-text"
                autoFocus
              />
            </label>
            <p className="flex items-center gap-1.5 text-[12.5px] text-muted">
              <Mic className="size-3.5" aria-hidden />
              Röst kommer senare och hamnar i samma fält. Texten lämnar aldrig din enhet innan du sparar.
            </p>
          </>
        ) : null}

        {step === "granska" ? (
          <>
            <p className="text-[14px] text-muted">
              Bocka av det som ska sparas och rätta det som blev fel. Pris för material och resa fyller du i själv,
              annars sparas 0 kr som du kan ändra senare. Ändringar blir utkast som du prissätter och skickar till
              kunden när du vill.
            </p>
            <ul className="space-y-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className={cx(
                    "rounded-xl border border-line px-3 py-2.5",
                    !item.selected && "opacity-60"
                  )}
                  data-testid="day-report-item"
                  data-kind={item.kind}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      className="mt-1 size-4 accent-[var(--color-accent)]"
                      checked={item.selected}
                      onChange={(e) => patch(item.id, { selected: e.target.checked })}
                      aria-label={`Spara ${DAY_REPORT_KIND_LABEL[item.kind].toLowerCase()}`}
                    />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={KIND_TONE[item.kind]}>{DAY_REPORT_KIND_LABEL[item.kind]}</Badge>
                        <span className="truncate text-[12.5px] text-muted" title={item.source}>
                          &quot;{item.source}&quot;
                        </span>
                      </div>
                      <input
                        className={smallInputCls}
                        value={item.description}
                        onChange={(e) => patch(item.id, { description: e.target.value })}
                        aria-label="Beskrivning"
                      />
                      {item.kind === "tid" || item.kind === "resa" || item.kind === "material" ? (
                        <div className="grid grid-cols-2 gap-2">
                          {item.kind !== "material" ? (
                            <label className="block">
                              <span className="mb-0.5 block text-[12px] text-muted">
                                {item.kind === "tid" ? "Timmar" : item.unit === "km" ? "Kilometer" : "Minuter"}
                              </span>
                              <input
                                className={smallInputCls}
                                inputMode="decimal"
                                value={item.qtyText}
                                onChange={(e) => patch(item.id, { qtyText: e.target.value })}
                              />
                            </label>
                          ) : (
                            <label className="block">
                              <span className="mb-0.5 block text-[12px] text-muted">Antal</span>
                              <input
                                className={smallInputCls}
                                inputMode="decimal"
                                value={item.qtyText || "1"}
                                onChange={(e) => patch(item.id, { qtyText: e.target.value })}
                              />
                            </label>
                          )}
                          {item.kind !== "tid" ? (
                            <label className="block">
                              <span className="mb-0.5 block text-[12px] text-muted">
                                {item.kind === "material" ? "Pris per st (exkl. moms)" : item.unit === "km" ? "Kr per km" : "Kr per timme"}
                              </span>
                              <input
                                className={smallInputCls}
                                inputMode="numeric"
                                value={item.unitPrice}
                                onChange={(e) => patch(item.id, { unitPrice: e.target.value })}
                                placeholder="0"
                              />
                            </label>
                          ) : (
                            <p className="self-end pb-2 text-[12px] text-muted">Timpris enligt uppdraget.</p>
                          )}
                        </div>
                      ) : null}
                      {item.kind === "material" && item.supplier ? (
                        <p className="text-[12px] text-muted">Inköpt hos {item.supplier}.</p>
                      ) : null}
                      {item.kind === "andring" ? (
                        <p className="text-[12px] text-muted">Sparas som utkast under Ändringar och tillägg - utan pris.</p>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {step === "klart" && saved ? (
          <div className="space-y-2" data-testid="day-report-saved">
            <p className="text-[15px] font-medium text-ink">Sparat.</p>
            <ul className="list-disc space-y-1 pl-5 text-[14px] text-ink">
              {saved.entries > 0 ? <li>{saved.entries === 1 ? "1 post" : `${saved.entries} poster`} under Arbete & material.</li> : null}
              {saved.changes > 0 ? (
                <li>
                  {saved.changes === 1 ? "1 ändringsutkast" : `${saved.changes} ändringsutkast`} under Ändringar och tillägg.
                  {saved.firstChangeId ? (
                    <>
                      {" "}
                      <AppLink className="text-accent underline" href={`/uppdrag/${jobId}/andringar/${saved.firstChangeId}`}>
                        Öppna och prissätt
                      </AppLink>
                    </>
                  ) : null}
                </li>
              ) : null}
              {saved.notes > 0 ? <li>{saved.notes === 1 ? "1 anteckning" : `${saved.notes} anteckningar`} i uppdraget.</li> : null}
            </ul>
            <p className="text-[13px] text-muted">Ingenting har skickats till kunden.</p>
          </div>
        ) : null}

        {error ? (
          <p className="rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-[13.5px] text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
