"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { OnboardingBookkeeping, OnboardingIndustry, OnboardingPayroll } from "@/lib/types";
import {
  BOOKKEEPING_OPTIONS,
  INDUSTRY_OPTIONS,
  PAYROLL_OPTIONS,
  industriesSummary,
} from "@/lib/setup/onboarding-state";
import { updateSetupProfileAction } from "@/app/onboarding-actions";
import { ChoiceChip } from "../choice-chip";
import { buttonClasses } from "../ui";

const field =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted focus:border-accent";

/** Inställningar → Kom igång: profilen (bransch, lön, bokföring) – ändras när som helst, låser inget. */
export function SetupProfileForm({
  profile,
}: {
  profile: {
    industries: OnboardingIndustry[];
    otherIndustry?: string;
    payroll: OnboardingPayroll | null;
    bookkeeping: OnboardingBookkeeping | null;
  };
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(profile.industries.length === 0);
  const [industries, setIndustries] = useState<OnboardingIndustry[]>(profile.industries);
  const [otherIndustry, setOtherIndustry] = useState(profile.otherIndustry ?? "");
  const [payroll, setPayroll] = useState<OnboardingPayroll | "">(profile.payroll ?? "");
  const [bookkeeping, setBookkeeping] = useState<OnboardingBookkeeping | "">(profile.bookkeeping ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    const summary = industriesSummary({ ...profile, status: "complete", currentStep: null, startedAt: "", taskOverrides: {}, updatedAt: "" });
    return (
      <dl className="grid gap-x-6 gap-y-2 text-[14px] sm:grid-cols-[auto_1fr]">
        <dt className="text-muted">Verksamhet</dt>
        <dd className="text-ink">{summary || "Inte angivet"}</dd>
        <dt className="text-muted">Lön</dt>
        <dd className="text-ink">
          {PAYROLL_OPTIONS.find((o) => o.value === profile.payroll)?.label ?? "Inte angivet"}
          {profile.payroll === "owner" || profile.payroll === "employees" ? (
            <span className="block text-[13px] text-soft">Lönehantering finns inte i Ferva ännu – vi hör av oss när det finns.</span>
          ) : null}
        </dd>
        <dt className="text-muted">Bokföring</dt>
        <dd className="text-ink">{BOOKKEEPING_OPTIONS.find((o) => o.value === profile.bookkeeping)?.label ?? "Inte angivet"}</dd>
        <dd className="sm:col-start-2">
          <button type="button" className={buttonClasses("secondary", "sm")} onClick={() => setEditing(true)} data-setup-profile-edit>
            Ändra
          </button>
        </dd>
      </dl>
    );
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const res = await updateSetupProfileAction({ industries, otherIndustry, payroll, bookkeeping });
          if (!res.ok) {
            setError(res.error);
            return;
          }
          setEditing(false);
          router.refresh();
        });
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-[14px] font-medium text-ink">Vad arbetar företaget med?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {INDUSTRY_OPTIONS.map((o) => {
            const checked = industries.includes(o.value);
            return (
              <ChoiceChip key={o.value} checked={checked}>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  onChange={() => setIndustries((prev) => (checked ? prev.filter((v) => v !== o.value) : [...prev, o.value]))}
                />
                {o.label}
              </ChoiceChip>
            );
          })}
        </div>
        {industries.includes("annat") ? (
          <input className={field} value={otherIndustry} onChange={(e) => setOtherIndustry(e.target.value)} placeholder="Vad då?" aria-label="Annat – vad då?" />
        ) : null}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-[14px] font-medium text-ink">Betalar företaget ut lön?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {PAYROLL_OPTIONS.map((o) => (
            <ChoiceChip key={o.value} checked={payroll === o.value}>
              <input type="radio" name="payroll" className="sr-only" checked={payroll === o.value} onChange={() => setPayroll(o.value)} />
              {o.label}
            </ChoiceChip>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-[14px] font-medium text-ink">Hur ser bokföringen ut idag?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {BOOKKEEPING_OPTIONS.map((o) => (
            <ChoiceChip key={o.value} checked={bookkeeping === o.value}>
              <input type="radio" name="bookkeeping" className="sr-only" checked={bookkeeping === o.value} onChange={() => setBookkeeping(o.value)} />
              {o.label}
            </ChoiceChip>
          ))}
        </div>
      </fieldset>
      {error ? <p className="text-[14px] font-medium text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" className={buttonClasses("primary", "md")} disabled={pending} data-setup-profile-save>
          {pending ? "Sparar …" : "Spara"}
        </button>
        {profile.industries.length > 0 ? (
          <button type="button" className={buttonClasses("ghost", "md")} onClick={() => setEditing(false)}>
            Avbryt
          </button>
        ) : null}
      </div>
    </form>
  );
}
