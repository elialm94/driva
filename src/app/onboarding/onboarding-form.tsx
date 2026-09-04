"use client";

import { useActionState, useRef, useState, type FormEvent } from "react";
import { onboardingAction, type OnboardingFormState } from "@/app/auth-actions";
import { AddressFields } from "@/components/address-input";
import { FieldError, FormField, focusField, invalidFieldCls } from "@/components/form-validation";
import { cx } from "@/components/ui";
import {
  formatOrgnr,
  formatVatNumber,
  isOrgnrFormat,
} from "@/lib/invoices/formats";
import {
  ONBOARDING_FIELD_IDS,
  suggestedOnboardingVatNumber,
  validateOnboardingFields,
  type OnboardingPaymentMethod,
} from "@/lib/onboarding";
import { swedishOrgnrInputProps } from "@/lib/validation";

const initialState: OnboardingFormState = {};

const field =
  "mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500";
const labelCls = "block text-sm font-medium text-stone-700";
const helperCls = "mt-1 text-[12px] text-stone-500";
const groupCls = "space-y-3";
const groupTitle = "text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500";

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
  const [state, submit, pending] = useActionState(onboardingAction, initialState);
  const [clientErrors, setClientErrors] = useState<OnboardingFormState["fieldErrors"]>({});
  const [name, setName] = useState(defaultName);
  const [orgNumber, setOrgNumber] = useState("");
  const [vatNumber, setVatNumber] = useState("");
  const [address, setAddress] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<OnboardingPaymentMethod | "">("");
  const [bankgiro, setBankgiro] = useState("");
  const [plusgiro, setPlusgiro] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [email, setEmail] = useState(defaultEmail);
  const [phone, setPhone] = useState(defaultPhone);
  const lastSuggestedVat = useRef("");

  const errors = { ...state.fieldErrors, ...clientErrors };

  function suggestVatFromOrgnr(formatted: string) {
    if (!isOrgnrFormat(formatted)) return;
    const suggested = suggestedOnboardingVatNumber(formatted);
    setVatNumber((prev) => {
      if (!prev.trim() || prev === lastSuggestedVat.current) return suggested;
      return prev;
    });
    lastSuggestedVat.current = suggested;
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    const result = validateOnboardingFields({
      name,
      orgNumber,
      vatNumber,
      address,
      postalCode,
      city,
      paymentMethod,
      bankgiro,
      plusgiro,
      bankAccount,
      email,
      phone,
    });
    if (Object.keys(result.fieldErrors).length > 0) {
      e.preventDefault();
      setClientErrors(result.fieldErrors);
      focusField(result.firstField);
      return;
    }
    setName(result.values.name);
    setOrgNumber(result.values.orgNumber);
    setVatNumber(result.values.vatNumber);
    setAddress(result.values.address);
    setPostalCode(result.values.postalCode);
    setCity(result.values.city);
    setEmail(result.values.email);
    setPhone(result.values.phone);
    if (result.values.bankgiro) setBankgiro(result.values.bankgiro);
    if (result.values.plusgiro) setPlusgiro(result.values.plusgiro);
    if (result.values.bankAccount) setBankAccount(result.values.bankAccount);
    setClientErrors({});
  }

  const hasErrors = Boolean(errors && Object.values(errors).some(Boolean));

  return (
    <form action={submit} noValidate className="space-y-6" onSubmit={onSubmit}>
      <section className={groupCls}>
        <p className={groupTitle}>Företag</p>
        <FormField id={ONBOARDING_FIELD_IDS.name} label="Företagsnamn" error={errors?.name} labelClassName={labelCls} helperClassName={helperCls}>
          <input
            name="name"
            autoComplete="organization"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={cx(field, errors?.name && invalidFieldCls)}
            placeholder="Söders Snickeri AB"
          />
        </FormField>
        <FormField
          id={ONBOARDING_FIELD_IDS.orgNumber}
          label="Organisationsnummer"
          error={errors?.orgNumber}
          helper="10 siffror, med eller utan bindestreck."
          labelClassName={labelCls}
          helperClassName={helperCls}
        >
          <input
            name="orgNumber"
            {...swedishOrgnrInputProps}
            value={orgNumber}
            onChange={(e) => {
              const formatted = formatOrgnr(e.target.value);
              setOrgNumber(formatted);
              suggestVatFromOrgnr(formatted);
            }}
            className={cx(field, errors?.orgNumber && invalidFieldCls)}
          />
        </FormField>
        <FormField
          id={ONBOARDING_FIELD_IDS.vatNumber}
          label="Momsregistreringsnummer"
          error={errors?.vatNumber}
          helper={
            vatNumber && vatNumber === formatVatNumber(orgNumber)
              ? "Föreslaget från organisationsnumret."
              : "Svenskt momsreg.nr: SE + org.nr utan bindestreck + 01."
          }
          labelClassName={labelCls}
          helperClassName={helperCls}
        >
          <input
            name="vatNumber"
            autoComplete="off"
            spellCheck={false}
            value={vatNumber}
            onChange={(e) => setVatNumber(e.target.value.toUpperCase().replace(/\s/g, ""))}
            placeholder="SE559123456701"
            className={cx(field, errors?.vatNumber && invalidFieldCls)}
          />
        </FormField>
      </section>

      <section className={groupCls}>
        <p className={groupTitle}>Adress</p>
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
          inputClassName="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500"
          labelClassName={labelCls}
          errors={{ address: errors?.address, postalCode: errors?.postalCode, city: errors?.city }}
        />
      </section>

      <section className={groupCls}>
        <p className={groupTitle}>Betalning</p>
        <fieldset id={ONBOARDING_FIELD_IDS.paymentMethod}>
          <legend className={labelCls}>Betalningssätt</legend>
          <p className={helperCls}>Minst ett sätt krävs för att kunna skicka faktura.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PAYMENT_METHODS.map((method) => (
              <label
                key={method.value}
                className={cx(
                  "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                  paymentMethod === method.value ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-800"
                )}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  value={method.value}
                  checked={paymentMethod === method.value}
                  onChange={() => setPaymentMethod(method.value)}
                  className="sr-only"
                />
                {method.label}
              </label>
            ))}
          </div>
          {errors?.paymentMethod ? <FieldError id={`${ONBOARDING_FIELD_IDS.paymentMethod}-fel`}>{errors.paymentMethod}</FieldError> : null}
        </fieldset>
        {paymentMethod === "bankgiro" ? (
          <FormField
            id={ONBOARDING_FIELD_IDS.bankgiro}
            label="Bankgiro"
            error={errors?.bankgiro}
            helper="Format NNN-NNNN eller NNNN-NNNN."
            labelClassName={labelCls}
            helperClassName={helperCls}
          >
            <input
              name="bankgiro"
              inputMode="numeric"
              autoComplete="off"
              value={bankgiro}
              onChange={(e) => setBankgiro(e.target.value)}
              className={cx(field, errors?.bankgiro && invalidFieldCls)}
              placeholder="5678-1234"
            />
          </FormField>
        ) : null}
        {paymentMethod === "plusgiro" ? (
          <FormField
            id={ONBOARDING_FIELD_IDS.plusgiro}
            label="Plusgiro"
            error={errors?.plusgiro}
            helper="2–8 siffror, t.ex. 123456-1."
            labelClassName={labelCls}
            helperClassName={helperCls}
          >
            <input
              name="plusgiro"
              inputMode="numeric"
              autoComplete="off"
              value={plusgiro}
              onChange={(e) => setPlusgiro(e.target.value)}
              className={cx(field, errors?.plusgiro && invalidFieldCls)}
              placeholder="123456-1"
            />
          </FormField>
        ) : null}
        {paymentMethod === "bankkonto" ? (
          <FormField
            id={ONBOARDING_FIELD_IDS.bankAccount}
            label="Bankkonto"
            error={errors?.bankAccount}
            helper="Clearingnummer och kontonummer."
            labelClassName={labelCls}
            helperClassName={helperCls}
          >
            <input
              name="bankAccount"
              autoComplete="off"
              value={bankAccount}
              onChange={(e) => setBankAccount(e.target.value)}
              className={cx(field, errors?.bankAccount && invalidFieldCls)}
              placeholder="1234-567 890 12"
            />
          </FormField>
        ) : null}
      </section>

      <section className={groupCls}>
        <p className={groupTitle}>Kontakt</p>
        <FormField id={ONBOARDING_FIELD_IDS.email} label="Kontaktmejl" error={errors?.email} labelClassName={labelCls} helperClassName={helperCls}>
          <input
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={cx(field, errors?.email && invalidFieldCls)}
          />
        </FormField>
        <FormField
          id={ONBOARDING_FIELD_IDS.phone}
          label="Telefon"
          optional
          error={errors?.phone}
          labelClassName={labelCls}
          helperClassName={helperCls}
        >
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={cx(field, errors?.phone && invalidFieldCls)}
            placeholder="070-123 45 67"
          />
        </FormField>
      </section>

      {state.error && !hasErrors ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      {hasErrors ? (
        <FieldError id="ob-sammanfattning">Rätta uppgifterna ovan – inget skickas förrän de stämmer.</FieldError>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
      >
        {pending ? "Skapar företag …" : "Kom igång"}
      </button>
    </form>
  );
}
