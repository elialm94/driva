"use client";

import { useActionState, useState, type FormEvent } from "react";
import { onboardingAction, type OnboardingFormState } from "@/app/auth-actions";
import { FieldError, FormField, focusField, invalidFieldCls } from "@/components/form-validation";
import { validateOnboardingFields } from "@/lib/validation";
import { formatSwedishOrganizationNumber, swedishOrgnrInputProps, validateSwedishOrganizationNumber } from "@/lib/validation/swedish";
import { cx } from "@/components/ui";

const initialState: OnboardingFormState = {};

export function OnboardingForm({ defaultEmail }: { defaultEmail: string }) {
  const [state, submit, pending] = useActionState(onboardingAction, initialState);
  const [clientErrors, setClientErrors] = useState<OnboardingFormState["fieldErrors"]>({});

  const field =
    "mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500";
  const labelCls = "block text-sm font-medium text-stone-700";
  const helperCls = "mt-1 text-[12px] text-stone-500";
  const errors = { ...state.fieldErrors, ...clientErrors };

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    const data = new FormData(form);
    const result = validateOnboardingFields({
      name: String(data.get("name") ?? ""),
      orgNumber: String(data.get("orgNumber") ?? ""),
      email: String(data.get("email") ?? ""),
      phone: String(data.get("phone") ?? ""),
    });
    if (Object.keys(result.fieldErrors).length > 0) {
      e.preventDefault();
      setClientErrors(result.fieldErrors);
      focusField(result.firstField);
      return;
    }
    const org = form.elements.namedItem("orgNumber");
    if (org instanceof HTMLInputElement) org.value = result.values.orgNumber;
    const phone = form.elements.namedItem("phone");
    if (phone instanceof HTMLInputElement) phone.value = result.values.phone;
    setClientErrors({});
  }

  return (
    <form action={submit} noValidate className="space-y-4" onSubmit={onSubmit}>
      <FormField
        id="ob-name"
        label="Företagsnamn"
        error={errors?.name}
        labelClassName={labelCls}
        helperClassName={helperCls}
      >
        <input
          name="name"
          autoComplete="organization"
          className={cx(field, errors?.name && invalidFieldCls)}
          placeholder="Söders Snickeri AB"
        />
      </FormField>

      <FormField
        id="ob-orgnr"
        label="Organisationsnummer"
        error={errors?.orgNumber}
        helper="10 siffror, med eller utan bindestreck."
        labelClassName={labelCls}
        helperClassName={helperCls}
      >
        <input
          name="orgNumber"
          {...swedishOrgnrInputProps}
          placeholder="555555-5555"
          className={cx(field, errors?.orgNumber && invalidFieldCls)}
          onBlur={(e) => {
            const r = validateSwedishOrganizationNumber(e.target.value);
            if (r.ok && r.normalized) e.target.value = formatSwedishOrganizationNumber(r.normalized);
          }}
        />
      </FormField>

      <FormField
        id="ob-email"
        label="Kontaktmejl"
        error={errors?.email}
        labelClassName={labelCls}
        helperClassName={helperCls}
      >
        <input
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          defaultValue={defaultEmail}
          className={cx(field, errors?.email && invalidFieldCls)}
        />
      </FormField>

      <FormField
        id="ob-phone"
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
          className={cx(field, errors?.phone && invalidFieldCls)}
          placeholder="070-123 45 67"
        />
      </FormField>

      {state.error && !errors?.name && !errors?.orgNumber && !errors?.email && !errors?.phone ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      {errors?.name || errors?.orgNumber || errors?.email || errors?.phone ? (
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
