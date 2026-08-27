import type { FormEvent } from "react";

/** Native HTML5 bubbles follow the browser language, not `<html lang="sv">`. */
export const SWEDISH_VALIDITY = {
  required: "Fyll i det här fältet.",
  email: "Ange en giltig e-postadress.",
  phone: "Ange ett giltigt telefonnummer.",
  generic: "Ange ett giltigt värde.",
} as const;

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function isField(el: EventTarget | null): el is Field {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

function fieldType(el: Field): string {
  return el instanceof HTMLInputElement ? el.type : el instanceof HTMLSelectElement ? "select" : "textarea";
}

function looksLikePhone(el: Field): boolean {
  if (!(el instanceof HTMLInputElement)) return false;
  const name = `${el.name} ${el.id} ${el.autocomplete}`.toLowerCase();
  return el.type === "tel" || el.inputMode === "tel" || /phone|tel|telefon/.test(name);
}

function looksLikeEmail(el: Field): boolean {
  if (!(el instanceof HTMLInputElement)) return false;
  const name = `${el.name} ${el.id} ${el.autocomplete}`.toLowerCase();
  return el.type === "email" || /e-?post|email/.test(name);
}

export function swedishValidityMessage(el: Field): string {
  const v = el.validity;
  if (v.valid) return "";
  if (v.valueMissing) return SWEDISH_VALIDITY.required;
  if (v.typeMismatch || v.patternMismatch || v.badInput) {
    if (looksLikeEmail(el) || fieldType(el) === "email") return SWEDISH_VALIDITY.email;
    if (looksLikePhone(el)) return SWEDISH_VALIDITY.phone;
    return SWEDISH_VALIDITY.generic;
  }
  return SWEDISH_VALIDITY.generic;
}

export function applySwedishValidity(el: Field) {
  el.setCustomValidity("");
  if (!el.validity.valid) el.setCustomValidity(swedishValidityMessage(el));
}

/** Spread onto `<form>` so every constrained field gets Swedish native bubbles. */
export function swedishFormProps() {
  return {
    onInvalidCapture: (e: FormEvent<HTMLFormElement>) => {
      if (isField(e.target)) applySwedishValidity(e.target);
    },
    onInputCapture: (e: FormEvent<HTMLFormElement>) => {
      if (isField(e.target)) e.target.setCustomValidity("");
    },
    onChangeCapture: (e: FormEvent<HTMLFormElement>) => {
      if (isField(e.target)) e.target.setCustomValidity("");
    },
  };
}
