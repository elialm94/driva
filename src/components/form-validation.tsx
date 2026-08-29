"use client";

import { AppLink } from "./app-link";
import { useCallback, useRef, useState, type FormEvent, type ReactNode } from "react";
import { cx } from "./ui";
import type { MissingRequirement } from "@/lib/form-requirements";
import { swedishValidityMessage } from "@/lib/swedish-validity";

/**
 * Delad presentationsdel av valideringsmönstret:
 *  - FormValidationSummary: "N uppgifter saknas" intill knappen, varje post
 *    fokuserar sitt fält (eller länkar vidare).
 *  - FieldError + invalidFieldCls: diskret markering vid fältet.
 *  - useNativeFieldErrors: små modalformulär med native `required` får
 *    kvarliggande fälttexter i stället för webbläsarens bubbla.
 *
 * Kravberäkningen bor i src/lib/form-requirements.ts (rena funktioner).
 */

/** Rulla till och fokusera ett fält; icke-fokuserbara element fokuserar första fokuserbara barnet. */
export function focusField(fieldId?: string) {
  if (!fieldId) return;
  const el = document.getElementById(fieldId);
  if (!el) return;
  const target =
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLButtonElement
      ? el
      : el.querySelector<HTMLElement>("input, select, textarea, button, [tabindex]");
  target?.focus({ preventScroll: true });
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}

/** Extra klass på fält som saknar uppgift – diskret, inte rött överallt. */
export const invalidFieldCls = "border-danger/60 focus:border-danger";

export function FieldError({ id, children, className }: { id?: string; children?: ReactNode; className?: string }) {
  if (!children) return null;
  return (
    <p id={id} className={cx("mt-1 text-[12px] font-medium text-danger", className)}>
      {children}
    </p>
  );
}

function SummaryItem({ item, onFocus }: { item: MissingRequirement; onFocus?: (item: MissingRequirement) => void }) {
  const cls = "text-left font-medium text-ink underline decoration-warn/70 underline-offset-2 hover:decoration-warn";
  if (item.href) {
    return (
      <AppLink href={item.href} className={cls}>
        {item.label}
      </AppLink>
    );
  }
  if (!item.fieldId) return <span className="text-ink">{item.label}</span>;
  return (
    <button type="button" className={cls} onClick={() => (onFocus ? onFocus(item) : focusField(item.fieldId))}>
      {item.label}
    </button>
  );
}

/**
 * "N uppgifter saknas" + kort lista, nära knappen. Poster är knappar som
 * rullar till och fokuserar fältet. Försvinner så fort inget saknas.
 */
export function FormValidationSummary({
  missing,
  heading,
  className,
  id,
  onFocus,
}: {
  missing: MissingRequirement[];
  /** Egen rubrik, annars "N uppgifter saknas". */
  heading?: string;
  className?: string;
  id?: string;
  onFocus?: (item: MissingRequirement) => void;
}) {
  if (missing.length === 0) return null;
  const title = heading ?? (missing.length === 1 ? "1 uppgift saknas" : `${missing.length} uppgifter saknas`);
  return (
    <div id={id} role="alert" className={cx("rounded-xl border border-warn/30 bg-warn-soft/40 px-3.5 py-3", className)}>
      <p className="text-[13px] font-semibold text-ink">{title}</p>
      <ul className="mt-1.5 space-y-1 text-[13px]">
        {missing.map((item) => (
          <li key={item.id} className="flex items-baseline gap-1.5">
            <span aria-hidden className="text-warn">
              •
            </span>
            <SummaryItem item={item} onFocus={onFocus} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Mjuk variant: "N uppgifter saknas för ROT-ansökan: Fastighetsbeteckning" – blockerar inget. */
export function SoftMissingHint({
  missing,
  intro,
  className,
}: {
  missing: MissingRequirement[];
  /** T.ex. "för ROT-ansökan". */
  intro: string;
  className?: string;
}) {
  if (missing.length === 0) return null;
  const lead = missing.length === 1 ? `1 uppgift saknas ${intro}: ` : `${missing.length} uppgifter saknas ${intro}: `;
  return (
    <p className={cx("text-[12px] leading-relaxed text-muted", className)}>
      {lead}
      {missing.map((item, i) => (
        <span key={item.id}>
          {i > 0 ? ", " : ""}
          {item.fieldId ? (
            <button
              type="button"
              className="font-medium text-soft underline underline-offset-2 hover:text-ink"
              onClick={() => focusField(item.fieldId)}
            >
              {item.label}
            </button>
          ) : (
            <span className="font-medium text-soft">{item.label}</span>
          )}
        </span>
      ))}
    </p>
  );
}

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function isField(el: EventTarget | null): el is Field {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

/**
 * För små formulär med native `required`: i stället för webbläsarens bubbla
 * visas kvarliggande svenska fel vid fälten, och första ogiltiga fält
 * fokuseras. Ersätter swedishFormProps() – sprid `formProps()` på <form>.
 *
 * `labels` ger fältspecifik text när något är tomt, t.ex. { name: "Namn krävs." }.
 */
export function useNativeFieldErrors(labels?: Record<string, string>) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const focusHandled = useRef(false);

  function clearFor(target: EventTarget | null) {
    if (!isField(target) || !target.name) return;
    target.setCustomValidity("");
    const name = target.name;
    setErrors((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }

  function formProps() {
    return {
      onInvalidCapture: (e: FormEvent<HTMLFormElement>) => {
        const el = e.target;
        if (!isField(el)) return;
        e.preventDefault(); // ingen webbläsarbubbla – felen visas vid fälten
        const custom = el.validity.valueMissing ? labels?.[el.name] : undefined;
        const message = custom ?? swedishValidityMessage(el);
        setErrors((prev) => (prev[el.name] === message ? prev : { ...prev, [el.name]: message }));
        // invalid-händelser kommer i DOM-ordning: fokusera bara det första fältet.
        if (!focusHandled.current) {
          focusHandled.current = true;
          el.focus({ preventScroll: true });
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          window.setTimeout(() => {
            focusHandled.current = false;
          }, 0);
        }
      },
      onInputCapture: (e: FormEvent<HTMLFormElement>) => clearFor(e.target),
      onChangeCapture: (e: FormEvent<HTMLFormElement>) => clearFor(e.target),
    };
  }

  const reset = useCallback(() => setErrors({}), []);

  /** aria-attribut + felklass för ett fält. */
  function fieldProps(name: string, errorId: string) {
    const invalid = Boolean(errors[name]);
    return {
      "aria-invalid": invalid || undefined,
      "aria-describedby": invalid ? errorId : undefined,
    };
  }

  return { errors, formProps, fieldProps, reset };
}
