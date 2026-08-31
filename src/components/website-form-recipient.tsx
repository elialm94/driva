"use client";

import { useState, useTransition } from "react";
import { Mail } from "lucide-react";
import { updateWebsiteFormRecipientAction } from "@/app/actions";
import { isEmailFormat } from "@/lib/settings-validation";
import {
  hasWebsiteFormRecipientOverride,
  resolveWebsiteFormRecipient,
  websiteFormRecipientOverride,
} from "@/lib/website-form-recipient";
import { buttonClasses } from "./ui";
import { Modal } from "./modal";

export function WebsiteFormRecipientCard({
  companyEmail,
  storedRecipient,
  mailLive,
}: {
  companyEmail: string;
  storedRecipient?: string;
  mailLive: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [stored, setStored] = useState(storedRecipient);
  const company = { email: companyEmail };
  const settings = { websiteNotificationEmail: stored };
  const recipient = resolveWebsiteFormRecipient(settings, company);

  return (
    <>
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-info-soft">
          <Mail className="size-4.5 text-info" />
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-soft">Skickas till</p>
          <p className="mt-0.5 text-[14px] font-medium text-ink">{recipient || "din e-post"}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-soft">
            Nya förfrågningar skapar automatiskt ett uppdrag och skickas även till den här adressen.
          </p>
          {!mailLive ? (
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              E-postavisering kräver att utskick konfigureras (Resend).
            </p>
          ) : null}
          <button
            type="button"
            className="mt-2 inline-block text-[13px] font-medium text-accent hover:underline"
            onClick={() => setOpen(true)}
          >
            Ändra
          </button>
        </div>
      </div>
      {open ? (
        <WebsiteFormRecipientModal
          companyEmail={companyEmail}
          initial={recipient}
          hasOverride={hasWebsiteFormRecipientOverride(settings, company)}
          onClose={() => setOpen(false)}
          onSaved={(next) => {
            setStored(websiteFormRecipientOverride({ websiteNotificationEmail: next }, company));
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function WebsiteFormRecipientModal({
  companyEmail,
  initial,
  hasOverride,
  onClose,
  onSaved,
}: {
  companyEmail: string;
  initial: string;
  hasOverride: boolean;
  onClose: () => void;
  onSaved: (recipient: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const company = companyEmail.trim();
  const showUseCompany =
    Boolean(company) && (hasOverride || value.trim().toLowerCase() !== company.toLowerCase());

  function save(next: string) {
    const trimmed = next.trim();
    if (trimmed && !isEmailFormat(trimmed)) {
      setError("Ange en giltig e-postadress.");
      return;
    }
    if (!trimmed && !company) {
      setError("Ange en giltig e-postadress.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await updateWebsiteFormRecipientAction(trimmed && trimmed.toLowerCase() !== company.toLowerCase() ? trimmed : "");
      if (result.ok === false) {
        setError(result.error);
        return;
      }
      onSaved(result.recipient);
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Vart ska nya förfrågningar skickas?"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClasses("ghost")} onClick={onClose} disabled={pending}>
            Avbryt
          </button>
          <button type="button" className={buttonClasses("primary")} disabled={pending} onClick={() => save(value)}>
            {pending ? "Sparar …" : "Spara"}
          </button>
        </div>
      }
    >
      <div className="space-y-4 px-6 py-5">
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-soft" htmlFor="webbformular-mottagare">
            E-post
          </label>
          <input
            id="webbformular-mottagare"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            value={value}
            onChange={(e) => {
              setError(null);
              setValue(e.target.value);
            }}
            placeholder={company || "namn@företag.se"}
            className="w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] leading-relaxed focus:border-accent"
          />
          {showUseCompany ? (
            <button
              type="button"
              className="mt-2 text-[13px] font-medium text-accent hover:underline"
              onClick={() => {
                setError(null);
                setValue(company);
              }}
            >
              Använd företagets e-post
            </button>
          ) : null}
          {error ? <p className="mt-2 text-[13px] font-medium text-danger">{error}</p> : null}
        </div>
      </div>
    </Modal>
  );
}
