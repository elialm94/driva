"use client";

import { useState, useTransition } from "react";
import { Eye, Pencil, Shield } from "lucide-react";
import { updatePrivacyPolicySupplementAction } from "@/app/actions";
import { SETTINGS_HREF } from "@/lib/settings-routes";
import {
  PRIVACY_POLICY_SUPPLEMENT_MAX,
  controllerName,
  formatCompanyAddress,
  privacyPolicyHref,
} from "@/lib/website-privacy";
import type { CompanySettings } from "@/lib/types";
import { buttonClasses } from "./ui";
import { Modal } from "./modal";

export function PrivacyPolicySettingsCard({
  company,
  businessName,
  supplement,
}: {
  company: CompanySettings;
  businessName: string;
  supplement?: string;
}) {
  const [open, setOpen] = useState(false);
  const name = controllerName(company, { businessName });
  const address = formatCompanyAddress(company);

  return (
    <>
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-ink/5">
          <Shield className="size-4.5 text-ink" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-ink">Integritetspolicy</p>
          <p className="mt-1 text-[13px] leading-relaxed text-soft">
            Automatiskt skapad från dina företagsuppgifter
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={privacyPolicyHref(true)}
              target="_blank"
              rel="noreferrer"
              className={buttonClasses("secondary", "sm")}
            >
              <Eye className="size-3.5" /> Visa
            </a>
            <button type="button" className={buttonClasses("secondary", "sm")} onClick={() => setOpen(true)}>
              <Pencil className="size-3.5" /> Redigera
            </button>
          </div>
        </div>
      </div>
      {open ? (
        <PrivacyPolicyEditModal
          company={company}
          name={name}
          address={address}
          initial={supplement ?? ""}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function PrivacyPolicyEditModal({
  company,
  name,
  address,
  initial,
  onClose,
}: {
  company: CompanySettings;
  name: string;
  address: string;
  initial: string;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updatePrivacyPolicySupplementAction(text);
      if (result.ok === false) {
        setError(result.error);
        return;
      }
      onClose();
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Redigera integritetspolicy"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClasses("ghost")} onClick={onClose}>
            Avbryt
          </button>
          <button type="button" className={buttonClasses("primary")} disabled={pending} onClick={save}>
            {pending ? "Sparar …" : "Spara tillägg"}
          </button>
        </div>
      }
    >
      <div className="space-y-4 px-6 py-5">
        <p className="text-[13px] leading-relaxed text-soft">
          Namn, org.nr, adress och kontakt hämtas automatiskt från{" "}
          <a href={SETTINGS_HREF.foretag} className="font-medium text-accent hover:underline">
            Företagsuppgifter
          </a>
          . Ändra dem där så uppdateras policyn.
        </p>
        <div className="rounded-2xl border border-line bg-canvas px-4 py-3 text-[13px] leading-relaxed text-ink">
          <p className="font-medium">{name}</p>
          {company.orgNumber ? <p className="mt-0.5 text-soft">Org.nr {company.orgNumber}</p> : null}
          {address ? <p className="mt-0.5 text-soft">{address}</p> : null}
          <p className="mt-0.5 text-soft">
            {[company.email, company.phone].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-soft" htmlFor="integritet-tillagg">
            Eget tillägg (valfritt)
          </label>
          <textarea
            id="integritet-tillagg"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            maxLength={PRIVACY_POLICY_SUPPLEMENT_MAX}
            placeholder="T.ex. hur ni hanterar foton från hembesök, eller hur länge ni sparar offerter utöver standardtexten."
            className="w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] leading-relaxed focus:border-accent"
          />
          <p className="mt-1.5 text-[12px] text-muted">
            Visas som avsnittet Övrigt på /integritetspolicy. {text.trim().length}/{PRIVACY_POLICY_SUPPLEMENT_MAX}
          </p>
          {error ? <p className="mt-2 text-[13px] font-medium text-danger">{error}</p> : null}
        </div>
      </div>
    </Modal>
  );
}
