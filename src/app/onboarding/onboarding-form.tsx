"use client";

import { useActionState, useEffect, useState, type FormEvent } from "react";
import { createCompanyAction, type CompanyStepState } from "@/app/onboarding-actions";
import { AddressFields } from "@/components/address-input";
import { FieldError, FormField, focusField, invalidFieldCls } from "@/components/form-validation";
import { buttonClasses, cx } from "@/components/ui";
import { formatOrgnr, formatVatNumber, isOrgnrFormat } from "@/lib/invoices/formats";
import {
  ONBOARDING_FIELD_IDS,
  UNSUPPORTED_COMPANY_FORM_ERROR,
  validateOnboardingFields,
  type OnboardingCompanyForm,
  type OnboardingPaymentMethod,
  type OnboardingPaymentTiming,
} from "@/lib/onboarding";
import { COMPANY_FORM_OPTIONS } from "@/lib/setup/onboarding-state";
import { ChoiceChip } from "@/components/choice-chip";
import { swedishOrgnrInputProps } from "@/lib/validation";

const initialState: CompanyStepState = {};

const field =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-3 text-[16px] text-ink placeholder:text-muted focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-soft";
const helperCls = "mt-1 text-[12px] text-muted";

const PAYMENT_METHODS: { value: OnboardingPaymentMethod; label: string }[] = [
  { value: "bankgiro", label: "Bankgiro" },
  { value: "plusgiro", label: "Plusgiro" },
  { value: "bankkonto", label: "Bankkonto" },
];

export function OnboardingForm({
  defaultEmail,
  defaultName = "",
  defaultPhone = "",
}: {
  defaultEmail: string;
  defaultName?: string;
  /** Från registreringen (user_metadata) – går att ändra här. */
  defaultPhone?: string;
}) {
  const [state, submit, pending] = useActionState(createCompanyAction, initialState);
  const [clientErrors, setClientErrors] = useState<CompanyStepState["fieldErrors"]>({});
  const [name, setName] = useState(defaultName);
  const [companyForm, setCompanyForm] = useState<OnboardingCompanyForm | "">("");
  const [orgNumber, setOrgNumber] = useState("");
  const [address, setAddress] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [paymentTiming, setPaymentTiming] = useState<OnboardingPaymentTiming>("now");
  const [paymentMethod, setPaymentMethod] = useState<OnboardingPaymentMethod | "">("");
  const [bankgiro, setBankgiro] = useState("");
  const [plusgiro, setPlusgiro] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [email, setEmail] = useState(defaultEmail);
  const [phone, setPhone] = useState(defaultPhone);

  const errors = { ...state.fieldErrors, ...clientErrors };
  // Momsregistreringsnumret räknas alltid ut ur organisationsnumret – ingen manuell inmatning.
  const vatNumber = isOrgnrFormat(orgNumber) ? formatVatNumber(orgNumber) : "";

  useEffect(() => {
    if (state.firstField) focusField(state.firstField);
  }, [state]);

  function values() {
    return {
      name,
      companyForm,
      orgNumber,
      vatNumber,
      address,
      postalCode,
      city,
      paymentTiming,
      paymentMethod,
      bankgiro,
      plusgiro,
      bankAccount,
      email,
      phone,
    };
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    const result = validateOnboardingFields(values());
    if (Object.keys(result.fieldErrors).length > 0) {
      e.preventDefault();
      setClientErrors(result.fieldErrors);
      focusField(result.firstField);
      return;
    }
    setClientErrors({});
  }

  const hasErrors = Object.values(errors).some(Boolean);
  const unsupported = companyForm === "annan";

  return (
    <form action={submit} noValidate className="space-y-7" onSubmit={onSubmit} data-onboarding-step="company">
      <input type="hidden" name="vatNumber" value={vatNumber} />
      <input type="hidden" name="paymentTiming" value={paymentTiming} />

      <fieldset id={ONBOARDING_FIELD_IDS.companyForm} className="space-y-2">
        <legend className={labelCls}>Företagsform</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {COMPANY_FORM_OPTIONS.map((option) => (
            <ChoiceChip key={option.value} checked={companyForm === option.value}>
              <input
                type="radio"
                name="companyForm"
                value={option.value}
                checked={companyForm === option.value}
                onChange={() => setCompanyForm(option.value)}
                className="sr-only"
              />
              {option.label}
            </ChoiceChip>
          ))}
        </div>
        {unsupported ? (
          <p role="alert" className="rounded-xl bg-warn-soft/50 px-3.5 py-2.5 text-[13px] leading-relaxed text-warn">
            {UNSUPPORTED_COMPANY_FORM_ERROR} Vill du testa Ferva ändå kan du gå tillbaka och välja en av de två.
          </p>
        ) : errors.companyForm ? (
          <FieldError id={`${ONBOARDING_FIELD_IDS.companyForm}-fel`}>{errors.companyForm}</FieldError>
        ) : null}
      </fieldset>

      <FormField
        id={ONBOARDING_FIELD_IDS.orgNumber}
        label={companyForm === "enskild" ? "Personnummer (enskild firma)" : "Organisationsnummer"}
        error={errors.orgNumber}
        helper="10 siffror, med eller utan bindestreck."
        labelClassName={labelCls}
        helperClassName={helperCls}
      >
        <input
          name="orgNumber"
          {...swedishOrgnrInputProps}
          value={orgNumber}
          onChange={(e) => setOrgNumber(formatOrgnr(e.target.value))}
          className={cx(field, errors.orgNumber && invalidFieldCls)}
          placeholder="559123-4567"
        />
      </FormField>

      <FormField id={ONBOARDING_FIELD_IDS.name} label="Företagsnamn" error={errors.name} labelClassName={labelCls} helperClassName={helperCls}>
        <input
          name="name"
          autoComplete="organization"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={cx(field, errors.name && invalidFieldCls)}
          placeholder={companyForm === "enskild" ? "Ekvägens El" : "Ekvägens El AB"}
        />
      </FormField>

      <div id={ONBOARDING_FIELD_IDS.vatNumber}>
        <p className={labelCls}>Momsregistreringsnummer</p>
        <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-dashed border-line-strong bg-canvas px-3.5 py-2.5">
          <span className={cx("text-[15px] tabular", vatNumber ? "text-ink" : "text-muted")} data-onboarding-vat>
            {vatNumber || "Räknas ut från organisationsnumret"}
          </span>
          {vatNumber ? <span className="text-[12px] text-muted">Uträknat automatiskt</span> : null}
        </div>
        {errors.vatNumber ? <FieldError id={`${ONBOARDING_FIELD_IDS.vatNumber}-fel`}>{errors.vatNumber}</FieldError> : null}
      </div>

      <AddressFields
        value={{ address, postalCode, city }}
        onChange={(parts) => {
          setAddress(parts.address);
          setPostalCode(parts.postalCode);
          setCity(parts.city);
        }}
        ids={{
          address: ONBOARDING_FIELD_IDS.address,
          postalCode: ONBOARDING_FIELD_IDS.postalCode,
          city: ONBOARDING_FIELD_IDS.city,
        }}
        inputClassName={field}
        labelClassName={labelCls}
        errors={{ address: errors.address, postalCode: errors.postalCode, city: errors.city }}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id={ONBOARDING_FIELD_IDS.email} label="Kontaktmejl" error={errors.email} labelClassName={labelCls} helperClassName={helperCls}>
          <input
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={cx(field, errors.email && invalidFieldCls)}
          />
        </FormField>
        <FormField id={ONBOARDING_FIELD_IDS.phone} label="Telefon" optional error={errors.phone} labelClassName={labelCls} helperClassName={helperCls}>
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={cx(field, errors.phone && invalidFieldCls)}
            placeholder="070-123 45 67"
          />
        </FormField>
      </div>

      <fieldset id={ONBOARDING_FIELD_IDS.paymentTiming} className="space-y-2">
        <legend className={labelCls}>Betalningsuppgifter</legend>
        <p className={helperCls}>Behövs innan du skickar din första faktura – inte för att komma igång.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <ChoiceChip checked={paymentTiming === "now"}>
            <input type="radio" name="paymentTimingChoice" value="now" checked={paymentTiming === "now"} onChange={() => setPaymentTiming("now")} className="sr-only" />
            Lägg till nu
          </ChoiceChip>
          <ChoiceChip checked={paymentTiming === "later"}>
            <input type="radio" name="paymentTimingChoice" value="later" checked={paymentTiming === "later"} onChange={() => setPaymentTiming("later")} className="sr-only" />
            Gör det senare
          </ChoiceChip>
        </div>
      </fieldset>

      {paymentTiming === "now" ? (
        <div className="space-y-3">
          <fieldset id={ONBOARDING_FIELD_IDS.paymentMethod}>
            <legend className={labelCls}>Betalningssätt</legend>
            <div className="mt-1 grid gap-2 sm:grid-cols-3">
              {PAYMENT_METHODS.map((method) => (
                <ChoiceChip key={method.value} checked={paymentMethod === method.value}>
                  <input
                    type="radio"
                    name="paymentMethod"
                    value={method.value}
                    checked={paymentMethod === method.value}
                    onChange={() => setPaymentMethod(method.value)}
                    className="sr-only"
                  />
                  {method.label}
                </ChoiceChip>
              ))}
            </div>
            {errors.paymentMethod ? <FieldError id={`${ONBOARDING_FIELD_IDS.paymentMethod}-fel`}>{errors.paymentMethod}</FieldError> : null}
          </fieldset>
          {paymentMethod === "bankgiro" ? (
            <FormField id={ONBOARDING_FIELD_IDS.bankgiro} label="Bankgiro" error={errors.bankgiro} helper="Format NNN-NNNN eller NNNN-NNNN." labelClassName={labelCls} helperClassName={helperCls}>
              <input name="bankgiro" inputMode="numeric" autoComplete="off" value={bankgiro} onChange={(e) => setBankgiro(e.target.value)} className={cx(field, errors.bankgiro && invalidFieldCls)} placeholder="5678-1234" />
            </FormField>
          ) : null}
          {paymentMethod === "plusgiro" ? (
            <FormField id={ONBOARDING_FIELD_IDS.plusgiro} label="Plusgiro" error={errors.plusgiro} helper="2–8 siffror, t.ex. 123456-1." labelClassName={labelCls} helperClassName={helperCls}>
              <input name="plusgiro" inputMode="numeric" autoComplete="off" value={plusgiro} onChange={(e) => setPlusgiro(e.target.value)} className={cx(field, errors.plusgiro && invalidFieldCls)} placeholder="123456-1" />
            </FormField>
          ) : null}
          {paymentMethod === "bankkonto" ? (
            <FormField id={ONBOARDING_FIELD_IDS.bankAccount} label="Bankkonto" error={errors.bankAccount} helper="Clearingnummer och kontonummer." labelClassName={labelCls} helperClassName={helperCls}>
              <input name="bankAccount" autoComplete="off" value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} className={cx(field, errors.bankAccount && invalidFieldCls)} placeholder="1234-567 890 12" />
            </FormField>
          ) : null}
        </div>
      ) : (
        <p className="rounded-xl bg-canvas px-3.5 py-2.5 text-[13px] text-soft">
          Vi påminner dig under Kom igång. Fakturor kan skickas först när ett giltigt mottagarkonto finns.
        </p>
      )}

      {state.error && !hasErrors ? (
        <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-[14px] text-danger">
          {state.error}
        </p>
      ) : null}
      {hasErrors ? <FieldError id="ob-sammanfattning">Rätta uppgifterna ovan – inget sparas förrän de stämmer.</FieldError> : null}

      <button type="submit" disabled={pending || unsupported} className={buttonClasses("primary", "lg", "w-full")} data-onboarding-continue>
        {pending ? "Skapar företaget …" : "Fortsätt"}
      </button>
    </form>
  );
}
