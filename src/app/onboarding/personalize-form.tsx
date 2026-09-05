"use client";

import { useActionState, useState } from "react";
import { personalizeAction, type PersonalizeStepState } from "@/app/onboarding-actions";
import { FieldError } from "@/components/form-validation";
import { buttonClasses, cx } from "@/components/ui";
import type { OnboardingBookkeeping, OnboardingIndustry, OnboardingPayroll } from "@/lib/types";
import {
  BOOKKEEPING_OPTIONS,
  INDUSTRY_OPTIONS,
  PAYROLL_OPTIONS,
  validatePersonalization,
} from "@/lib/setup/onboarding-state";
import { ChoiceChip } from "./onboarding-form";

const initialState: PersonalizeStepState = {};
const questionTitle = "text-[16px] font-semibold text-ink";
const field =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-3 text-[16px] text-ink placeholder:text-muted focus:border-accent";

export function PersonalizeForm({
  defaults,
}: {
  defaults?: {
    industries: OnboardingIndustry[];
    otherIndustry?: string;
    payroll: OnboardingPayroll | null;
    bookkeeping: OnboardingBookkeeping | null;
  };
}) {
  const [state, submit, pending] = useActionState(personalizeAction, initialState);
  const [industries, setIndustries] = useState<OnboardingIndustry[]>(defaults?.industries ?? []);
  const [otherIndustry, setOtherIndustry] = useState(defaults?.otherIndustry ?? "");
  const [payroll, setPayroll] = useState<OnboardingPayroll | "">(defaults?.payroll ?? "");
  const [bookkeeping, setBookkeeping] = useState<OnboardingBookkeeping | "">(defaults?.bookkeeping ?? "");
  const [clientErrors, setClientErrors] = useState<PersonalizeStepState["fieldErrors"]>({});
  const errors = { ...state.fieldErrors, ...clientErrors };

  function toggleIndustry(value: OnboardingIndustry) {
    setIndustries((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  return (
    <form
      action={submit}
      noValidate
      className="space-y-8"
      data-onboarding-step="personalize"
      onSubmit={(e) => {
        const result = validatePersonalization({ industries, otherIndustry, payroll, bookkeeping });
        if (!result.values) {
          e.preventDefault();
          setClientErrors(result.errors);
          const first = Object.keys(result.errors)[0];
          document.getElementById(`ob-${first}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
        setClientErrors({});
      }}
    >
      <fieldset id="ob-industries" className="space-y-3">
        <legend className={questionTitle}>Vad arbetar företaget med?</legend>
        <p className="text-[13px] text-muted">Välj allt som stämmer. Det styr förslag – inte vad du kan göra.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {INDUSTRY_OPTIONS.map((option) => {
            const checked = industries.includes(option.value);
            return (
              <ChoiceChip key={option.value} checked={checked}>
                <input
                  type="checkbox"
                  name="industries"
                  value={option.value}
                  checked={checked}
                  onChange={() => toggleIndustry(option.value)}
                  className="sr-only"
                />
                <span className={cx("flex size-4 items-center justify-center rounded border text-[10px]", checked ? "border-white bg-white text-ink" : "border-line-strong")} aria-hidden>
                  {checked ? "✓" : ""}
                </span>
                {option.label}
              </ChoiceChip>
            );
          })}
        </div>
        {industries.includes("annat") ? (
          <label className="block" htmlFor="ob-otherIndustry">
            <span className="mb-1 block text-[13px] font-medium text-soft">Vad då?</span>
            <input
              id="ob-otherIndustry"
              name="otherIndustry"
              className={field}
              value={otherIndustry}
              onChange={(e) => setOtherIndustry(e.target.value)}
              placeholder="t.ex. plåt, kyla, glas"
              autoFocus
            />
            {errors.otherIndustry ? <FieldError>{errors.otherIndustry}</FieldError> : null}
          </label>
        ) : null}
        {errors.industries ? <FieldError id="ob-industries-fel">{errors.industries}</FieldError> : null}
      </fieldset>

      <fieldset id="ob-payroll" className="space-y-3">
        <legend className={questionTitle}>Betalar företaget ut lön?</legend>
        <div className="grid gap-2">
          {PAYROLL_OPTIONS.map((option) => (
            <ChoiceChip key={option.value} checked={payroll === option.value}>
              <input type="radio" name="payroll" value={option.value} checked={payroll === option.value} onChange={() => setPayroll(option.value)} className="sr-only" />
              {option.label}
            </ChoiceChip>
          ))}
        </div>
        {errors.payroll ? <FieldError id="ob-payroll-fel">{errors.payroll}</FieldError> : null}
      </fieldset>

      <fieldset id="ob-bookkeeping" className="space-y-3">
        <legend className={questionTitle}>Hur ser bokföringen ut idag?</legend>
        <div className="grid gap-2">
          {BOOKKEEPING_OPTIONS.map((option) => (
            <ChoiceChip key={option.value} checked={bookkeeping === option.value}>
              <input type="radio" name="bookkeeping" value={option.value} checked={bookkeeping === option.value} onChange={() => setBookkeeping(option.value)} className="sr-only" />
              {option.label}
            </ChoiceChip>
          ))}
        </div>
        {bookkeeping === "existing" ? (
          <p className="rounded-xl bg-canvas px-3.5 py-2.5 text-[13px] text-soft">
            Du behöver inte ha några filer till hands nu. Under Kom igång får du uppgiften <span className="font-medium text-ink">Flytta in bokföringen</span> och kan ladda upp när det passar.
          </p>
        ) : null}
        {bookkeeping === "consultant" ? (
          <p className="rounded-xl bg-canvas px-3.5 py-2.5 text-[13px] text-soft">
            Vi föreslår att du bjuder in din redovisningskonsult – och flyttar in befintlig bokföring om det behövs.
          </p>
        ) : null}
        {errors.bookkeeping ? <FieldError id="ob-bookkeeping-fel">{errors.bookkeeping}</FieldError> : null}
      </fieldset>

      {state.error && Object.keys(errors).length === 0 ? (
        <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-[14px] text-danger">
          {state.error}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className={buttonClasses("primary", "lg", "w-full")} data-onboarding-open>
        {pending ? "Öppnar Ferva …" : "Öppna Ferva"}
      </button>
    </form>
  );
}
