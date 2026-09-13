"use client";

import { Plus, Trash2, X } from "lucide-react";
import type { PaymentPlanPart } from "@/lib/types";
import { kr } from "@/lib/format";
import {
  DEFAULT_PAYMENT_PLAN,
  PAYMENT_PLAN_KIND_LABEL,
  hasPaymentPlan,
  paymentPlanAmounts,
  paymentPlanIssue,
  paymentPlanPartKind,
} from "@/lib/payment-plan";
import { buttonClasses, cx } from "./ui";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";

export const PLAN_PRESETS: { label: string; plan: PaymentPlanPart[] }[] = [
  {
    label: "30 % vid start",
    plan: [
      { label: "Vid arbetets start", percent: 30, kind: "forskott" },
      { label: "När arbetet är klart och godkänt", percent: 70, kind: "slutbetalning" },
    ],
  },
  {
    label: "50 / 50",
    plan: [
      { label: "Vid arbetets start", percent: 50, kind: "forskott" },
      { label: "När arbetet är klart och godkänt", percent: 50, kind: "slutbetalning" },
    ],
  },
  {
    label: "Förskott i kronor",
    plan: [
      { label: "Förskott vid beställning", percent: 0, amount: 10000, kind: "forskott" },
      { label: "När arbetet är klart och godkänt", percent: 100, kind: "slutbetalning" },
    ],
  },
  {
    label: "Tre delar",
    plan: [
      { label: "Vid arbetets start", percent: 30, kind: "forskott" },
      { label: "Vid halvtid", percent: 40, kind: "delbetalning" },
      { label: "När arbetet är klart och godkänt", percent: 30, kind: "slutbetalning" },
    ],
  },
];

function samePlan(a: PaymentPlanPart[], b: PaymentPlanPart[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Betalplan på offerten. Standard är ingen plan (allt när arbetet är klart)
 * – då syns bara en rad och en sekundär knapp "Lägg till betalplan". Sista
 * delen är alltid resten; förskott kan anges i kronor eller procent.
 */
export function PaymentPlanEditor({
  plan,
  onChange,
  totalInclVat,
  showErrors = false,
}: {
  plan: PaymentPlanPart[];
  onChange: (plan: PaymentPlanPart[]) => void;
  totalInclVat: number;
  showErrors?: boolean;
}) {
  const active = hasPaymentPlan(plan);
  const issue = paymentPlanIssue(plan, totalInclVat);
  const amounts = paymentPlanAmounts(plan, totalInclVat);

  function update(i: number, patch: Partial<PaymentPlanPart>) {
    onChange(plan.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  }

  function setMode(i: number, mode: "percent" | "amount") {
    const part = plan[i];
    if (mode === "amount") {
      const suggested = part.amount ?? Math.round((totalInclVat * part.percent) / 100);
      update(i, { amount: suggested, percent: 0 });
    } else {
      const next = { ...part };
      const pct = totalInclVat > 0 && part.amount != null ? Math.round((part.amount / totalInclVat) * 100) : part.percent;
      delete next.amount;
      onChange(plan.map((p, j) => (j === i ? { ...next, percent: pct } : p)));
    }
  }

  function addPart() {
    const last = plan[plan.length - 1];
    const before = plan.slice(0, -1);
    onChange([
      ...before,
      { label: before.length === 0 ? "Vid arbetets start" : "Delbetalning", percent: 0, kind: before.length === 0 ? "forskott" : "delbetalning" },
      { ...last, kind: "slutbetalning" },
    ]);
  }

  function removePart(i: number) {
    const next = plan.filter((_, j) => j !== i);
    onChange(next.length <= 1 ? DEFAULT_PAYMENT_PLAN.map((p) => ({ ...p })) : next);
  }

  if (!active) {
    return (
      <div id="offert-betalplan" data-testid="payment-plan-off">
        <p className="mb-1 block text-[13px] font-medium text-soft">Betalning</p>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3.5 py-2.5">
          <p className="text-[14px] text-ink">Allt faktureras när arbetet är klart.</p>
          <button
            type="button"
            className={buttonClasses("secondary", "sm")}
            onClick={() => onChange(PLAN_PRESETS[0].plan.map((p) => ({ ...p })))}
            data-testid="payment-plan-add"
          >
            <Plus className="size-3.5" /> Lägg till betalplan
          </button>
        </div>
        <p className="mt-1.5 text-[12px] text-muted">
          En betalplan delar upp betalningen i förskott, delbetalning och slutbetalning. Den blir en del av offerten kunden godkänner.
        </p>
      </div>
    );
  }

  return (
    <div id="offert-betalplan" data-testid="payment-plan-editor">
      <div className="mb-1 flex items-center justify-between">
        <label className="block text-[13px] font-medium text-soft">Betalplan</label>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-danger"
          onClick={() => onChange(DEFAULT_PAYMENT_PLAN.map((p) => ({ ...p })))}
          data-testid="payment-plan-remove"
        >
          <X className="size-3.5" /> Ta bort betalplan
        </button>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {PLAN_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange(p.plan.map((x) => ({ ...x })))}
            className={cx(
              "rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors max-lg:py-2",
              samePlan(plan, p.plan) ? "border-ink bg-ink text-white" : "border-line-strong text-soft hover:border-muted"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {plan.map((p, i) => {
          const last = i === plan.length - 1;
          const kind = paymentPlanPartKind(plan, i);
          const fixed = p.amount != null;
          return (
            <div key={i} className="rounded-xl border border-line/80 px-3 py-2.5" data-testid="payment-plan-part">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">{PAYMENT_PLAN_KIND_LABEL[kind]}</span>
                <span className="text-[13px] text-soft tabular">{totalInclVat > 0 ? kr(amounts[i] ?? 0) : ""}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <input
                  value={p.label}
                  onChange={(e) => update(i, { label: e.target.value })}
                  aria-label="Delbetalningens namn"
                  className={cx(inputCls, "min-w-[10rem] flex-1")}
                />
                {last ? (
                  <span className="shrink-0 text-[13px] text-muted">Resten av beloppet</span>
                ) : (
                  <div className="flex shrink-0 items-center gap-1">
                    <input
                      type="number"
                      value={fixed ? (p.amount ?? 0) : p.percent}
                      min={0}
                      max={fixed ? undefined : 100}
                      inputMode="numeric"
                      aria-label={fixed ? "Fast belopp i kronor" : "Andel i procent"}
                      onChange={(e) =>
                        fixed ? update(i, { amount: Math.max(0, Math.round(Number(e.target.value) || 0)) }) : update(i, { percent: Number(e.target.value) })
                      }
                      className={cx(inputCls, fixed ? "w-28 text-right" : "w-20 text-right")}
                    />
                    <select
                      value={fixed ? "amount" : "percent"}
                      onChange={(e) => setMode(i, e.target.value as "percent" | "amount")}
                      aria-label="Ange i procent eller kronor"
                      className={cx(inputCls, "w-auto")}
                    >
                      <option value="percent">%</option>
                      <option value="amount">kr</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => removePart(i)}
                      aria-label="Ta bort del"
                      className="rounded-lg p-1.5 text-muted hover:bg-canvas hover:text-danger"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <button type="button" onClick={addPart} className={buttonClasses("ghost", "sm")}>
          <Plus className="size-3.5" /> Lägg till del
        </button>
        {issue && (showErrors || hasPaymentPlan(plan)) ? <p className="text-[13px] font-medium text-danger">{issue}</p> : null}
      </div>
    </div>
  );
}
