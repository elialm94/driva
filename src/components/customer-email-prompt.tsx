"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Modal } from "./modal";
import { buttonClasses, cx } from "./ui";
import { FieldError, invalidFieldCls } from "./form-validation";
import { resolveCustomerEmailAction } from "@/app/actions";
import {
  EMAIL_SAVE_FAILED,
  emailInputError,
  missingEmailDialogCopy,
  type PendingAction,
} from "@/lib/missing-requirements";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted focus:border-accent";

/**
 * Fältet för buyer_email i resolveMissingRequirements-flödet.
 * E-posten skrivs i dialogen, sparas på kundkortet, och onResolved
 * återupptar pendingAction – ingen navigering till Kunden.
 */
export function CustomerEmailPrompt({
  open,
  onClose,
  pendingAction,
  onResolved,
}: {
  open: boolean;
  onClose: () => void;
  pendingAction: PendingAction;
  onResolved: (resolved: { email: string }) => void;
}) {
  const copy = missingEmailDialogCopy(pendingAction.kind);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();
  const savingRef = useRef(false);

  useEffect(() => {
    if (open) {
      setEmail("");
      setError(null);
      savingRef.current = false;
    }
  }, [open]);

  function save() {
    if (savingRef.current) return;
    const invalid = emailInputError(email);
    if (invalid) {
      setError(invalid);
      return;
    }
    savingRef.current = true;
    startSaving(async () => {
      try {
        const result = await resolveCustomerEmailAction(pendingAction.customerId, email);
        if (!result.ok) {
          setError(EMAIL_SAVE_FAILED);
          return;
        }
        onResolved({ email: result.email });
      } catch {
        setError(EMAIL_SAVE_FAILED);
      } finally {
        savingRef.current = false;
      }
    });
  }

  return (
    <Modal open={open} onClose={() => !isSaving && onClose()} size="sm" title={copy.title}>
      <form
        className="px-6 py-5"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p className="text-[15px] leading-relaxed text-soft">{copy.description}</p>
        <div className="mt-4">
          <label className="mb-1 block text-[13px] font-medium text-soft" htmlFor="komplettera-epost">
            E-post
          </label>
          <input
            id="komplettera-epost"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            autoFocus
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            placeholder="namn@exempel.se"
            className={cx(inputCls, error && invalidFieldCls)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "komplettera-epost-fel" : undefined}
          />
          <FieldError id="komplettera-epost-fel">{error}</FieldError>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={buttonClasses("secondary")} disabled={isSaving} onClick={onClose}>
            Avbryt
          </button>
          <button type="submit" className={buttonClasses("primary")} disabled={isSaving}>
            {isSaving ? "Sparar..." : "Spara och fortsätt"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
