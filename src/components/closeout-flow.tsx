"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronLeft, Clock, FileText, Flag, Ban, RotateCcw } from "lucide-react";
import type { CloseoutBillingMode } from "@/lib/types";
import type { CloseoutItem, CloseoutView } from "@/lib/services/closeout";
import {
  clearBillingDeferralAction,
  completeJobCloseoutAction,
  createCloseoutDraftAction,
  setBillingDeferralAction,
} from "@/app/closeout-actions";
import { kr } from "@/lib/format";
import { invoiceEditHref } from "@/lib/nav";
import { Modal } from "./modal";
import { Badge, buttonClasses, cx, type BadgeTone } from "./ui";

type Step = "kontroll" | "fakturera" | "satt" | "klart";

const STEP_TITLES: Record<Step, string> = {
  kontroll: "Kontrollera jobbet",
  fakturera: "Vad ska faktureras nu?",
  satt: "Hur vill du fakturera?",
  klart: "Klart",
};

const GROUP_LABEL: Record<CloseoutItem["group"], string> = {
  avtalat: "Enligt offerten",
  andringar: "Godkända ändringar",
  tillagg: "Registrerade tillägg",
};

function stateBadge(item: CloseoutItem): { tone: BadgeTone; label: string } {
  switch (item.state) {
    case "fakturerbar":
      return { tone: "accent", label: "Fakturerbar" };
    case "utkast":
      return { tone: "info", label: "På utkast" };
    case "fakturerad":
      return { tone: "ok", label: item.invoiceNumber != null ? `Faktura #${item.invoiceNumber}` : "Fakturerad" };
    case "hantera_senare":
      return { tone: "warn", label: "Hantera senare" };
    case "inte_fakturerbart":
      return { tone: "neutral", label: "Inte fakturerbart" };
  }
}

/**
 * Det guidade avslutsflödet. Tre steg, sedan "Skapa fakturautkast" – aldrig
 * ett utskick. Beslut per post (inte fakturerbart / hantera senare) sparas
 * direkt på uppdraget så att de finns kvar om man stänger och kommer tillbaka.
 */
export function CloseoutFlow({
  open,
  onClose,
  view,
  jobHref,
}: {
  open: boolean;
  onClose: () => void;
  view: CloseoutView;
  jobHref: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("kontroll");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(view.items.filter((i) => i.state === "fakturerbar").map((i) => i.key)));
  const [mode, setMode] = useState<CloseoutBillingMode>(() => view.modes.find((m) => m.recommended)?.mode ?? view.modes[0]?.mode ?? "ingen");
  const [error, setError] = useState<string | null>(null);
  // Utkastet som skapades i den här sessionen; annars det servern redan känner till.
  const [createdDraft, setCreatedDraft] = useState<{ id: string; amount: number } | null>(null);
  const [completedHere, setCompletedHere] = useState(false);
  const [pending, start] = useTransition();
  const draft = createdDraft ?? view.existingDraft;
  const completed = completedHere || view.isCompleted;

  function close() {
    onClose();
    setStep("kontroll");
    setError(null);
  }

  // Valet filtreras mot aktuell vy: poster som blivit "hantera senare" faller bort automatiskt.
  const billable = view.items.filter((i) => i.state === "fakturerbar");
  const selectedItems = billable.filter((i) => selected.has(i.key));
  const selectedTotal = selectedItems.reduce((s, i) => s + i.amountInclVat, 0);
  const groups = useMemo(() => {
    const out: { group: CloseoutItem["group"]; items: CloseoutItem[] }[] = [];
    for (const g of ["avtalat", "andringar", "tillagg"] as const) {
      const items = view.items.filter((i) => i.group === g);
      if (items.length) out.push({ group: g, items });
    }
    return out;
  }, [view.items]);
  const nothingToBill = billable.length === 0;
  const effectiveMode: CloseoutBillingMode = nothingToBill ? "ingen" : mode;
  const chosenMode = view.modes.find((m) => m.mode === effectiveMode);
  const checks = view.checks;
  const allGood =
    checks.checklistOpen === 0 && checks.pendingChanges.length === 0 && checks.draftChanges.length === 0 && checks.openDrafts.length === 0;

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function decide(item: CloseoutItem, kind: "hantera_senare" | "inte_fakturerbart" | "aterstall") {
    setError(null);
    start(async () => {
      const r =
        kind === "aterstall"
          ? await clearBillingDeferralAction(view.jobId, item.key)
          : await setBillingDeferralAction(view.jobId, item.key, kind);
      if (!r.ok) setError(r.error);
      else {
        if (kind === "aterstall") setSelected((prev) => new Set(prev).add(item.key));
        router.refresh();
      }
    });
  }

  function createDraft() {
    setError(null);
    start(async () => {
      const r = await createCloseoutDraftAction(view.jobId, effectiveMode, Array.from(selected));
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setCreatedDraft({ id: r.invoiceId, amount: r.amount });
      setStep("klart");
      router.refresh();
    });
  }

  function complete() {
    setError(null);
    start(async () => {
      const r = await completeJobCloseoutAction(view.jobId, effectiveMode, draft?.id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setCompletedHere(true);
      setStep("klart");
      router.refresh();
    });
  }

  const stepIndex: Record<Step, number> = { kontroll: 1, fakturera: 2, satt: 3, klart: 4 };

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          {step !== "kontroll" && step !== "klart" ? (
            <button
              type="button"
              aria-label="Tillbaka"
              className="-ml-1 rounded-lg p-1 text-muted hover:bg-canvas hover:text-ink"
              onClick={() => setStep(step === "satt" ? "fakturera" : "kontroll")}
            >
              <ChevronLeft className="size-4" />
            </button>
          ) : null}
          <span>
            <span className="text-[12px] font-medium uppercase tracking-wide text-muted">Avsluta uppdrag · steg {Math.min(stepIndex[step], 3)} av 3</span>
            <br />
            {STEP_TITLES[step]}
          </span>
        </span>
      }
      footer={
        step === "kontroll" ? (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={buttonClasses("ghost")} onClick={close}>
              Avbryt
            </button>
            <button type="button" className={buttonClasses("primary")} onClick={() => setStep("fakturera")} data-testid="closeout-next-1">
              Fortsätt
            </button>
          </div>
        ) : step === "fakturera" ? (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] text-soft tabular">
              {nothingToBill ? "Inget fakturerbart just nu." : `Valt: ${kr(selectedTotal)} inkl. moms`}
            </p>
            <button type="button" className={buttonClasses("primary")} onClick={() => setStep("satt")} data-testid="closeout-next-2">
              Fortsätt
            </button>
          </div>
        ) : step === "satt" ? (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={buttonClasses("ghost")} onClick={close}>
              Avbryt
            </button>
            {effectiveMode === "ingen" ? (
              <button type="button" className={buttonClasses("primary")} disabled={pending || completed} onClick={complete} data-testid="closeout-complete">
                {pending ? "Avslutar …" : "Avsluta uppdraget"}
              </button>
            ) : draft ? (
              <button type="button" className={buttonClasses("primary")} onClick={() => setStep("klart")} data-testid="closeout-existing-draft">
                Visa utkastet
              </button>
            ) : (
              <button type="button" className={buttonClasses("primary")} disabled={pending || selectedItems.length === 0} onClick={createDraft} data-testid="closeout-create-draft">
                {pending ? "Skapar …" : "Skapa fakturautkast"}
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={buttonClasses("ghost")} onClick={close}>
              Stäng
            </button>
            {draft ? (
              <Link href={invoiceEditHref(draft.id, { href: jobHref, label: view.jobTitle }) as never} className={buttonClasses("secondary")} data-testid="closeout-open-draft">
                <FileText className="size-4" /> Öppna fakturautkastet
              </Link>
            ) : null}
            {!completed ? (
              <button type="button" className={buttonClasses("primary")} disabled={pending} onClick={complete} data-testid="closeout-complete">
                {pending ? "Avslutar …" : "Avsluta uppdraget"}
              </button>
            ) : null}
          </div>
        )
      }
    >
      <div className="px-6 py-5" data-testid={`closeout-step-${step}`}>
        {error ? (
          <p role="alert" className="mb-4 rounded-xl border border-danger/30 bg-danger-soft/40 px-3.5 py-2.5 text-[13px] font-medium text-danger">
            {error}
          </p>
        ) : null}

        {step === "kontroll" ? (
          <div className="space-y-3">
            <p className="text-[14px] text-soft">
              En snabb koll innan fakturan. Inget skickas i det här flödet – du får ett utkast att granska.
            </p>
            <ul className="divide-y divide-line/70 rounded-2xl border border-line/80 text-[14px]">
              <CheckRow
                ok={checks.checklistOpen === 0}
                title={checks.checklistTotal === 0 ? "Ingen checklista på uppdraget" : checks.checklistOpen === 0 ? "Checklistan är avbockad" : `${checks.checklistOpen} punkt${checks.checklistOpen === 1 ? "" : "er"} kvar i checklistan`}
                detail={checks.openChecklist.slice(0, 3).join(" · ")}
              />
              <CheckRow
                ok={checks.pendingChanges.length === 0 && checks.draftChanges.length === 0}
                title={
                  checks.pendingChanges.length > 0
                    ? `${checks.pendingChanges.length} ändring${checks.pendingChanges.length === 1 ? "" : "ar"} väntar på kundens godkännande`
                    : checks.draftChanges.length > 0
                      ? `${checks.draftChanges.length} ändring${checks.draftChanges.length === 1 ? "" : "ar"} är fortfarande utkast`
                      : "Inga ändringar väntar"
                }
                detail={[...checks.pendingChanges, ...checks.draftChanges].map((c) => `Ändring ${c.number}: ${c.title}`).join(" · ")}
                warnOnly
              />
              <CheckRow
                ok={checks.openDrafts.length === 0}
                title={checks.openDrafts.length === 0 ? "Inga öppna fakturautkast" : `${checks.openDrafts.length} öppet fakturautkast${checks.openDrafts.length === 1 ? "" : ""} (${kr(checks.openDrafts.reduce((s, d) => s + d.amount, 0))})`}
                detail={checks.openDrafts.length > 0 ? "Flödet återanvänder utkastet i stället för att skapa ett nytt." : undefined}
                warnOnly
              />
              <CheckRow
                ok
                title={`${checks.photoCount} foto${checks.photoCount === 1 ? "" : "n"} på uppdraget`}
                detail={checks.registeredWorkInclVat > 0 ? `Registrerat arbete och material: ${kr(checks.registeredWorkInclVat)} inkl. moms` : undefined}
                neutral
              />
            </ul>
            {allGood ? <p className="text-[13px] text-ok">Allt ser klart ut.</p> : null}
          </div>
        ) : null}

        {step === "fakturera" ? (
          <div className="space-y-5">
            {view.items.length === 0 ? (
              <p className="text-[14px] text-soft">Det finns inget registrerat att fakturera på uppdraget.</p>
            ) : null}
            {groups.map(({ group, items }) => (
              <div key={group}>
                <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">{GROUP_LABEL[group]}</p>
                <ul className="divide-y divide-line/70 rounded-2xl border border-line/80">
                  {items.map((item) => {
                    const badge = stateBadge(item);
                    const canPick = item.state === "fakturerbar";
                    return (
                      <li key={item.key} className="flex flex-wrap items-start gap-3 px-4 py-3" data-testid="closeout-item" data-state={item.state}>
                        <label className={cx("flex min-w-0 flex-1 items-start gap-3", !canPick && "opacity-80")}>
                          <input
                            type="checkbox"
                            className="mt-1 size-4 accent-[var(--color-accent)]"
                            checked={canPick && selected.has(item.key)}
                            disabled={!canPick}
                            onChange={() => toggle(item.key)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[14px] font-medium text-ink">{item.label}</span>
                            {item.detail ? <span className="block text-[12.5px] text-muted">{item.detail}</span> : null}
                            {item.deferral?.note ? <span className="block text-[12.5px] italic text-soft">{item.deferral.note}</span> : null}
                          </span>
                        </label>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <span className="text-[14px] font-medium tabular">{kr(item.amountInclVat)}</span>
                          <Badge tone={badge.tone}>{badge.label}</Badge>
                        </div>
                        {canPick ? (
                          <div className="flex w-full gap-3 pl-7 text-[12.5px]">
                            <button type="button" className="inline-flex items-center gap-1 text-muted hover:text-ink" disabled={pending} onClick={() => decide(item, "hantera_senare")}>
                              <Clock className="size-3.5" /> Hantera senare
                            </button>
                            <button type="button" className="inline-flex items-center gap-1 text-muted hover:text-ink" disabled={pending} onClick={() => decide(item, "inte_fakturerbart")}>
                              <Ban className="size-3.5" /> Inte fakturerbart
                            </button>
                          </div>
                        ) : item.state === "hantera_senare" || item.state === "inte_fakturerbart" ? (
                          <div className="flex w-full gap-3 pl-7 text-[12.5px]">
                            <button type="button" className="inline-flex items-center gap-1 text-muted hover:text-ink" disabled={pending} onClick={() => decide(item, "aterstall")}>
                              <RotateCcw className="size-3.5" /> Gör fakturerbar igen
                            </button>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] tabular sm:grid-cols-4">
              <Sum label="Fakturerbart" value={view.totals.billable} />
              <Sum label="På utkast" value={view.totals.inDrafts} />
              <Sum label="Fakturerat" value={view.totals.invoiced} />
              <Sum label="Senare / ej" value={view.totals.deferred + view.totals.notBillable} />
            </dl>
          </div>
        ) : null}

        {step === "satt" ? (
          <div className="space-y-3">
            {nothingToBill ? (
              <p className="text-[14px] text-soft">Inget är valt att fakturera. Du kan avsluta uppdraget direkt.</p>
            ) : (
              <fieldset className="space-y-2">
                <legend className="sr-only">Faktureringssätt</legend>
                {view.modes.map((m) => (
                  <label
                    key={m.mode}
                    className={cx(
                      "flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition-colors",
                      mode === m.mode ? "border-ink bg-canvas/60" : "border-line hover:border-line-strong"
                    )}
                    data-testid={`closeout-mode-${m.mode}`}
                  >
                    <input type="radio" name="closeout-mode" className="mt-1 size-4" checked={mode === m.mode} onChange={() => setMode(m.mode)} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-ink">
                        {m.label}
                        {m.recommended ? <Badge tone="accent">Föreslaget</Badge> : null}
                      </span>
                      <span className="block text-[13px] text-soft">{m.description}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            {chosenMode && chosenMode.mode !== "ingen" ? (
              <p className="text-[13px] text-muted">
                Utkastet blir {kr(effectiveMode === "delfaktura" && view.nextPlanPart ? view.nextPlanPart.amount + selectedItems.filter((i) => i.sourceType !== "quote_remainder").reduce((s, i) => s + i.amountInclVat, 0) : selectedTotal)} inkl. moms
                (före ROT/RUT). Du granskar och skickar det själv – ingenting går iväg automatiskt.
              </p>
            ) : null}
            {draft && effectiveMode !== "ingen" ? (
              <p className="flex items-start gap-2 rounded-xl border border-info/30 bg-info-soft/40 px-3.5 py-2.5 text-[13px] text-soft">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-info" />
                Det finns redan ett fakturautkast från avslutet ({kr(draft.amount)}). Det återanvänds – inget nytt skapas.
              </p>
            ) : null}
          </div>
        ) : null}

        {step === "klart" ? (
          <div className="flex flex-col items-center px-2 py-4 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-ok-soft">
              {completed ? <Flag className="size-7 text-ok" /> : <CheckCircle2 className="size-7 text-ok" />}
            </div>
            <p className="text-[18px] font-semibold text-ink">{completed ? "Uppdraget är avslutat" : draft ? "Fakturautkastet är skapat" : "Klart"}</p>
            <p className="mt-1 max-w-sm text-[14px] text-soft">
              {draft ? `${kr(draft.amount)} inkl. moms ligger som utkast. Granska raderna och skicka när det passar.` : "Inget nytt skapades."}
              {!completed ? " Du kan avsluta uppdraget nu eller göra det senare." : " Uppdraget kan öppnas igen om något dyker upp."}
            </p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function CheckRow({ ok, title, detail, warnOnly, neutral }: { ok: boolean; title: string; detail?: string; warnOnly?: boolean; neutral?: boolean }) {
  const Icon = neutral ? FileText : ok ? CheckCircle2 : AlertTriangle;
  const tone = neutral ? "text-muted" : ok ? "text-ok" : warnOnly ? "text-warn" : "text-warn";
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Icon className={cx("mt-0.5 size-4 shrink-0", tone)} />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink">{title}</p>
        {detail ? <p className="text-[12.5px] text-muted">{detail}</p> : null}
      </div>
    </li>
  );
}

function Sum({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2 sm:block">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-ink">{kr(value)}</dd>
    </div>
  );
}
