"use client";

import { useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { Eye, Pencil, Shield } from "lucide-react";
import { updateWebsitePrivacyPolicyAction } from "@/app/actions";
import { SETTINGS_HREF } from "@/lib/settings-routes";
import {
  PRIVACY_POLICY_SUPPLEMENT_MAX,
  applyPrivacyTokens,
  capturePrivacyTokens,
  controllerName,
  formatCompanyAddress,
  privacyPolicyHref,
} from "@/lib/website-privacy";
import type { PrivacyPolicyMode, PrivacyPolicyState } from "@/lib/types";
import type { CompanySettings } from "@/lib/types";
import type { RichTextDoc } from "@/lib/richtext";
import { buttonClasses } from "./ui";
import { Modal } from "./modal";
import { enqueueWebsiteMutation, useWebsiteEditorSyncOptional } from "./website-editor-sync";

const RichTextEditor = dynamic(
  () => import("./rich-text-editor").then((m) => m.RichTextEditor),
  { ssr: false }
);

export function PrivacyPolicySettingsCard({
  company,
  businessName,
  draft,
  standardSeed,
}: {
  company: CompanySettings;
  businessName: string;
  draft: PrivacyPolicyState;
  standardSeed: RichTextDoc;
}) {
  const [open, setOpen] = useState(false);
  const custom = draft.mode === "custom";

  return (
    <>
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-ink/5">
          <Shield className="size-4.5 text-ink" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-ink">Integritetspolicy</p>
          <p className="mt-1 text-[13px] leading-relaxed text-soft">{custom ? "Anpassad" : "Standard"}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={privacyPolicyHref(true)}
              target="_blank"
              rel="noreferrer"
              className={buttonClasses("secondary", "sm")}
            >
              <Eye className="size-3.5" /> Visa policy
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
          businessName={businessName}
          draft={draft}
          standardSeed={standardSeed}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function PrivacyPolicyEditModal({
  company,
  businessName,
  draft,
  standardSeed,
  onClose,
}: {
  company: CompanySettings;
  businessName: string;
  draft: PrivacyPolicyState;
  standardSeed: RichTextDoc;
  onClose: () => void;
}) {
  const name = controllerName(company, { businessName });
  const address = formatCompanyAddress(company);
  const liveSeed = applyPrivacyTokens(standardSeed, company, { businessName });
  const liveCustom = draft.customBody
    ? applyPrivacyTokens(draft.customBody, company, { businessName })
    : liveSeed;

  const [mode, setMode] = useState<PrivacyPolicyMode>(draft.mode);
  const [supplement, setSupplement] = useState(draft.supplement ?? "");
  const [customDoc, setCustomDoc] = useState<RichTextDoc | undefined>(
    draft.mode === "custom" ? liveCustom : undefined
  );
  const [confirmCustomize, setConfirmCustomize] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sync = useWebsiteEditorSyncOptional();

  function beginCustomize() {
    setCustomDoc(liveSeed);
    setMode("custom");
    setConfirmCustomize(false);
    setError(null);
  }

  function resetToStandard() {
    setError(null);
    startTransition(async () => {
      const result = await enqueueWebsiteMutation(
        sync,
        (clientRevision) =>
          updateWebsitePrivacyPolicyAction({
            mode: "standard",
            supplement,
            clientRevision,
          }),
        () => sync?.notePrivacy({ mode: "standard", supplement }),
      );
      if (result.ok === false) {
        setError(result.error);
        return;
      }
      setMode("standard");
      setCustomDoc(undefined);
      setConfirmReset(false);
    });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await enqueueWebsiteMutation(sync, (clientRevision) => {
        const next =
          mode === "custom"
            ? {
                mode: "custom" as const,
                customBody: customDoc
                  ? capturePrivacyTokens(customDoc, company, { businessName })
                  : undefined,
                clientRevision,
              }
            : { mode: "standard" as const, supplement, clientRevision };
        sync?.notePrivacy(
          mode === "custom"
            ? {
                mode: "custom",
                customBody: customDoc
                  ? capturePrivacyTokens(customDoc, company, { businessName })
                  : undefined,
              }
            : { mode: "standard", supplement },
        );
        return updateWebsitePrivacyPolicyAction(next);
      });
      if (result.ok === false) {
        setError(result.error);
        return;
      }
      onClose();
    });
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title="Integritetspolicy"
        size="lg"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            {mode === "custom" ? (
              <button
                type="button"
                className={buttonClasses("ghost")}
                onClick={() => setConfirmReset(true)}
              >
                Återställ till Drivas standard
              </button>
            ) : (
              <span />
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className={buttonClasses("ghost")} onClick={onClose}>
                Avbryt
              </button>
              <button type="button" className={buttonClasses("primary")} disabled={pending} onClick={save}>
                {pending ? "Sparar …" : "Spara"}
              </button>
            </div>
          </div>
        }
      >
        {mode === "custom" ? (
          <div className="space-y-4 px-6 py-5">
            <p className="text-[13px] leading-relaxed text-soft">Anpassad</p>
            <RichTextEditor
              key="privacy-custom"
              value={customDoc ?? liveSeed}
              onChange={setCustomDoc}
              placeholder="Skriv om policyn. Företagsnamn, e-post och telefon uppdateras från Företagsuppgifter."
              ariaLabel="Integritetspolicy"
            />
            {error ? <p className="text-[13px] font-medium text-danger">{error}</p> : null}
          </div>
        ) : (
          <div className="space-y-4 px-6 py-5">
            <p className="text-[13px] leading-relaxed text-soft">
              Driva håller standardtexten uppdaterad. Företagsuppgifter hämtas automatiskt från{" "}
              <a href={SETTINGS_HREF.foretag} className="font-medium text-accent hover:underline">
                Företagsuppgifter
              </a>
              .
            </p>
            <div className="rounded-2xl border border-line bg-canvas px-4 py-3 text-[13px] leading-relaxed text-ink">
              <p className="font-medium">{name}</p>
              {company.orgNumber ? <p className="mt-0.5 text-soft">Org.nr {company.orgNumber}</p> : null}
              {address ? <p className="mt-0.5 text-soft">{address}</p> : null}
              <p className="mt-0.5 text-soft">
                {[company.email, company.phone].filter(Boolean).join(" · ")}
              </p>
            </div>
            <a
              href={privacyPolicyHref(true)}
              target="_blank"
              rel="noreferrer"
              className={buttonClasses("secondary", "sm")}
            >
              <Eye className="size-3.5" /> Visa hela policyn
            </a>
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-soft" htmlFor="integritet-tillagg">
                Eget tillägg (valfritt)
              </label>
              <textarea
                id="integritet-tillagg"
                value={supplement}
                onChange={(e) => setSupplement(e.target.value)}
                rows={5}
                maxLength={PRIVACY_POLICY_SUPPLEMENT_MAX}
                placeholder="T.ex. hur ni hanterar foton från hembesök, eller hur länge ni sparar offerter utöver standardtexten."
                className="w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] leading-relaxed focus:border-accent"
              />
              <p className="mt-1.5 text-[12px] text-muted">
                Visas som avsnittet Övrigt på /integritetspolicy. {supplement.trim().length}/
                {PRIVACY_POLICY_SUPPLEMENT_MAX}
              </p>
            </div>
            <button
              type="button"
              className={buttonClasses("secondary", "sm")}
              onClick={() => setConfirmCustomize(true)}
            >
              Anpassa hela policyn
            </button>
            {error ? <p className="text-[13px] font-medium text-danger">{error}</p> : null}
          </div>
        )}
      </Modal>

      <Modal
        open={confirmCustomize}
        onClose={() => setConfirmCustomize(false)}
        title="Vill du redigera hela policyn?"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClasses("ghost")} onClick={() => setConfirmCustomize(false)}>
              Avbryt
            </button>
            <button type="button" className={buttonClasses("primary")} onClick={beginCustomize}>
              Anpassa policy
            </button>
          </div>
        }
      >
        <p className="px-6 py-5 text-[14px] leading-relaxed text-soft">
          Drivas standard används som utgångspunkt. När du anpassar texten ansvarar du själv för
          ändringarna. Du kan alltid återställa till Drivas standard.
        </p>
      </Modal>

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Återställa integritetspolicyn?"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClasses("ghost")} onClick={() => setConfirmReset(false)}>
              Avbryt
            </button>
            <button type="button" className={buttonClasses("primary")} onClick={resetToStandard}>
              Återställ
            </button>
          </div>
        }
      >
        <p className="px-6 py-5 text-[14px] leading-relaxed text-soft">
          Egna ändringar ersätts av Drivas aktuella standardpolicy.
        </p>
      </Modal>
    </>
  );
}
