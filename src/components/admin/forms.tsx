"use client";

/**
 * Klientformulär för Driva Admin. Komponenterna postar till server actions i
 * src/app/admin/actions.ts – ALL behörighet prövas där (servern), aldrig här.
 * Farliga åtgärder (radera/inaktivera) går via DangerPanel som alltid visar
 * vad som påverkas, vad som bevaras och om det går att ångra (spec §19).
 */
import { useActionState, useState, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { cx } from "@/components/ui";
import type { AdminActionState } from "@/app/admin/actions";

type PlainAction = (formData: FormData) => Promise<AdminActionState>;
type StateAction = (prev: AdminActionState, formData: FormData) => Promise<AdminActionState>;

function Feedback({ state }: { state: AdminActionState }) {
  if (state.error) return <p className="mt-1.5 text-[12.5px] text-red-400">{state.error}</p>;
  if (state.notice) return <p className="mt-1.5 text-[12.5px] text-emerald-400">{state.notice}</p>;
  return null;
}

export function PendingButton({
  children,
  variant = "secondary",
  className,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cx(
        "inline-flex h-8 items-center justify-center rounded-lg px-3 text-[12.5px] font-medium transition-colors disabled:opacity-50",
        variant === "primary" && "bg-amber-400 text-neutral-950 hover:bg-amber-300",
        variant === "secondary" && "border border-neutral-700 text-neutral-200 hover:bg-neutral-800",
        variant === "danger" && "border border-red-500/40 text-red-300 hover:bg-red-500/10",
        className
      )}
    >
      {pending ? "Arbetar …" : children}
    </button>
  );
}

/** Enkellknapp mot en server action, med inline-återkoppling. */
export function ActionButton({
  action,
  fields,
  children,
  variant = "secondary",
  confirmText,
}: {
  action: PlainAction;
  fields: Record<string, string>;
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger";
  /** Enkel bekräftelse för halvfarliga åtgärder. Riktigt farliga: DangerPanel. */
  confirmText?: string;
}) {
  const [state, setState] = useState<AdminActionState>({});
  const [pending, startTransition] = useTransition();
  return (
    <div>
      <form
        action={(formData) => {
          if (confirmText && !window.confirm(confirmText)) return;
          startTransition(async () => setState(await action(formData)));
        }}
      >
        {Object.entries(fields).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <button
          type="submit"
          disabled={pending}
          className={cx(
            "inline-flex h-8 items-center justify-center rounded-lg px-3 text-[12.5px] font-medium transition-colors disabled:opacity-50",
            variant === "primary" && "bg-amber-400 text-neutral-950 hover:bg-amber-300",
            variant === "secondary" && "border border-neutral-700 text-neutral-200 hover:bg-neutral-800",
            variant === "danger" && "border border-red-500/40 text-red-300 hover:bg-red-500/10"
          )}
        >
          {pending ? "Arbetar …" : children}
        </button>
      </form>
      <Feedback state={state} />
    </div>
  );
}

/** Formulär för (prev, formData)-actions med fält som children. */
export function StateForm({
  action,
  children,
  className,
}: {
  action: StateAction;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className={className}>
      {children}
      <Feedback state={state} />
    </form>
  );
}

/**
 * Farlig åtgärd (spec §19): expanderbar panel som ALLTID redovisar vad som
 * påverkas, vad som bevaras och om åtgärden kan ångras, plus ev. krav på att
 * skriva ett bekräftelsevärde. Servern gör om samma policykontroll oavsett
 * vad panelen visar.
 */
export function DangerPanel({
  title,
  buttonLabel,
  affects,
  preserved,
  undoable,
  blockers = [],
  fields,
  action,
  confirmField,
  disabled,
}: {
  title: string;
  buttonLabel: string;
  affects: string[];
  preserved: string[];
  /** T.ex. "Kan inte ångras." eller "Kan ångras genom återaktivering." */
  undoable: string;
  /** Policyhinder – visas i stället för knappen när åtgärden är blockerad. */
  blockers?: string[];
  fields: Record<string, string>;
  action: PlainAction;
  /** Krävt bekräftelsefält, t.ex. { name: "confirmName", expected: "Bolaget AB", label: "Skriv företagets namn" }. */
  confirmField?: { name: string; expected: string; label: string };
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<AdminActionState>({});
  const [pending, startTransition] = useTransition();
  const blocked = disabled || blockers.length > 0;

  return (
    <div className="rounded-xl border border-red-500/25 bg-red-500/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-[13px] font-medium text-red-300"
      >
        {title}
        <span className="text-[11px] text-red-400/70">{open ? "Dölj" : "Visa"}</span>
      </button>
      {open ? (
        <div className="border-t border-red-500/20 px-4 py-3 text-[12.5px]">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="font-semibold text-neutral-300">Detta påverkas</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-neutral-400">
                {affects.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-semibold text-neutral-300">Detta bevaras</p>
              {preserved.length > 0 ? (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-neutral-400">
                  {preserved.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-neutral-500">Ingenting utöver auditloggen.</p>
              )}
            </div>
          </div>
          <p className="mt-3 font-medium text-amber-300">{undoable}</p>

          {blockers.length > 0 ? (
            <div className="mt-3 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-300">
              <p className="font-semibold">Blockerad av policyn:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ) : (
            <form
              className="mt-3 flex flex-wrap items-end gap-2"
              action={(formData) => {
                startTransition(async () => setState(await action(formData)));
              }}
            >
              {Object.entries(fields).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              {confirmField ? (
                <label className="flex min-w-56 flex-1 flex-col gap-1 text-neutral-400">
                  {confirmField.label}
                  <input
                    name={confirmField.name}
                    autoComplete="off"
                    placeholder={confirmField.expected}
                    className="h-8 rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 text-[13px] text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
                  />
                </label>
              ) : null}
              <button
                type="submit"
                disabled={pending || blocked}
                className="inline-flex h-8 items-center rounded-lg bg-red-500/90 px-3 text-[12.5px] font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {pending ? "Arbetar …" : buttonLabel}
              </button>
            </form>
          )}
          <Feedback state={state} />
        </div>
      ) : null}
    </div>
  );
}

export const adminInputClass =
  "h-9 rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-[13px] text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none";

export const adminTextareaClass =
  "rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-[13px] text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none";
