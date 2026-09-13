"use client";

import type { ReactNode } from "react";
import { CheckCircle2, CircleAlert, Users } from "lucide-react";
import type { ScopeFlag } from "@/lib/types";
import { SCOPE_QUESTIONS, VERDICT_TITLE, verdictLead, type Eligibility } from "@/lib/support/eligibility";
import type { SupportLevel } from "@/lib/support/matrix";
import { cx } from "./ui";

/**
 * Onboardingens omfattningsfråga + direkt besked (spec §10). Samma komponent
 * i Inställningar → Företag så att svaren går att ändra. Fälten heter
 * `scope` (checkbox, flera) – servern läser formData.getAll("scope").
 */
export function ScopeQuestions({
  flags,
  onChange,
  legend = "Stämmer något av det här in på företaget?",
  helper = "Kryssa bara i det som gäller. Så vet du direkt om Ferva passar – och vi bokför aldrig något vi inte har regler för.",
  legendClassName,
  helperClassName,
  disabled,
}: {
  flags: readonly ScopeFlag[];
  onChange: (next: ScopeFlag[]) => void;
  legend?: string;
  helper?: string;
  legendClassName?: string;
  helperClassName?: string;
  disabled?: boolean;
}) {
  function toggle(flag: ScopeFlag) {
    const next = flags.includes(flag) ? flags.filter((f) => f !== flag) : [...flags, flag];
    onChange(SCOPE_QUESTIONS.map((q) => q.flag).filter((f) => next.includes(f)));
  }
  return (
    <fieldset className="space-y-2" data-scope-questions>
      <legend className={legendClassName}>{legend}</legend>
      {helper ? <p className={helperClassName}>{helper}</p> : null}
      <div className="grid gap-2">
        {SCOPE_QUESTIONS.map((q) => {
          const checked = flags.includes(q.flag);
          return (
            <label
              key={q.flag}
              className={cx(
                "flex min-h-11 cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[14px] leading-snug transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
                checked ? "border-ink bg-ink text-white" : "border-line-strong bg-card text-ink hover:border-muted/60",
                disabled && "opacity-60",
              )}
            >
              <input
                type="checkbox"
                name="scope"
                value={q.flag}
                checked={checked}
                disabled={disabled}
                onChange={() => toggle(q.flag)}
                className="mt-0.5 size-4 shrink-0 rounded border-line-strong accent-accent"
              />
              <span>{q.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

const TONE: Record<SupportLevel, { box: string; icon: ReactNode }> = {
  supported: { box: "border-ok/30 bg-ok-soft/40 text-ink", icon: <CheckCircle2 className="size-5 shrink-0 text-ok" aria-hidden /> },
  consultant: { box: "border-info/30 bg-info-soft/50 text-ink", icon: <Users className="size-5 shrink-0 text-info" aria-hidden /> },
  unsupported: { box: "border-warn/40 bg-warn-soft/50 text-ink", icon: <CircleAlert className="size-5 shrink-0 text-warn" aria-hidden /> },
};

/** Beskedet. Visas så snart företagsformen är vald – innan dess finns inget att säga. */
export function EligibilityVerdict({ eligibility, compact }: { eligibility: Eligibility; compact?: boolean }) {
  const tone = TONE[eligibility.verdict];
  const listed = eligibility.verdict === "unsupported" ? eligibility.blocking : eligibility.consultant;
  return (
    <div
      role="status"
      aria-live="polite"
      data-eligibility={eligibility.verdict}
      className={cx("flex gap-3 rounded-xl border px-3.5 py-3", tone.box)}
    >
      {tone.icon}
      <div className="min-w-0 space-y-1">
        <p className="text-[14px] font-semibold">{VERDICT_TITLE[eligibility.verdict]}</p>
        {!compact ? <p className="text-[13px] leading-relaxed text-soft">{verdictLead(eligibility)}</p> : null}
        {listed.length ? (
          <ul className="mt-1 space-y-1 text-[13px] text-soft">
            {listed.map((e) => (
              <li key={e.id} className="flex gap-2">
                <span aria-hidden>·</span>
                <span>
                  <span className="font-medium text-ink">{e.label}.</span> {e.summary}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}