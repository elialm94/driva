"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buttonClasses, Card, cx } from "./ui";
import { Modal } from "./modal";
import {
  applyBillingVatSuggestion,
  billingCompleteFieldIds,
  billingCompleteModalOpen,
  billingCompletionDraftFromSeller,
  billingCompletionPatchFromDraft,
  settingsBillingReadiness,
  suggestedVatForCompletion,
  type BillingCompletionDraft,
  type SettingsReadinessItemId,
} from "@/lib/billing-readiness";
import type { SellerBlockerInput } from "@/lib/invoices/seller-blockers";
import { formatVatNumber, isOrgnrFormat, isVatNumberFormat } from "@/lib/invoices/formats";
import {
  normalizeSwedishBankgiro,
  swedishBankgiroInputProps,
} from "@/lib/validation";
import { AddressFields } from "./address-input";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-soft";
const hintCls = "mt-1 text-[12px] text-muted";

export function SettingsBillingBanner({
  seller,
  savedReady,
  onPersist,
}: {
  seller: SellerBlockerInput;
  /** Sparad (server) readiness – styr den tysta "redan redo"-hinten. */
  savedReady: boolean;
  onPersist: (
    patch: Partial<SellerBlockerInput>
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const readiness = useMemo(() => settingsBillingReadiness(seller), [seller]);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [settled, setSettled] = useState(false);
  const startedIncomplete = useRef(!savedReady);

  useEffect(() => {
    if (!readiness.ready || !startedIncomplete.current) return;
    const t = window.setTimeout(() => setSettled(true), 5500);
    return () => window.clearTimeout(t);
  }, [readiness.ready]);

  const justCompleted = startedIncomplete.current && readiness.ready;

  return (
    <>
      {readiness.ready ? (
        !justCompleted || settled ? (
          <p className="mb-6 text-[13px] text-muted" data-testid="billing-readiness-ready">
            Redo att fakturera
          </p>
        ) : (
          <Card className="mb-6 px-5 py-4" data-testid="billing-readiness-success">
            <p className="text-[13px] font-medium text-muted">Fakturering</p>
            <p className="mt-0.5 text-[15px] font-medium text-ok">✓ Redo att fakturera</p>
            <p className="mt-1 text-[13px] text-soft">{readiness.consequence}</p>
          </Card>
        )
      ) : (
        <Card
          className="mb-6 border-warn/30 bg-warn-soft/40 px-5 py-4"
          data-testid="billing-readiness-banner"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-muted">Fakturering</p>
              <p className="mt-0.5 text-[15px] font-medium text-warn">{readiness.headline}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-soft">{readiness.consequence}</p>
              <ul className="mt-2 space-y-0.5 text-[13px] text-ink">
                {readiness.previewLabels.map((label) => (
                  <li key={label} className="flex gap-2">
                    <span className="text-muted" aria-hidden>
                      ·
                    </span>
                    <span>{label}</span>
                  </li>
                ))}
                {readiness.moreCount > 0 ? (
                  <li className="text-muted">
                    {readiness.moreCount} till
                  </li>
                ) : null}
              </ul>
            </div>
            <button
              type="button"
              className={buttonClasses("secondary", "sm", "w-full shrink-0 sm:w-auto")}
              onClick={() => setCompleteOpen(true)}
            >
              Komplettera
            </button>
          </div>
        </Card>
      )}

      <BillingCompleteModal
        open={billingCompleteModalOpen(completeOpen, readiness.ready)}
        onClose={() => setCompleteOpen(false)}
        seller={seller}
        onPersist={onPersist}
      />
    </>
  );
}

function BillingCompleteModal({
  open,
  onClose,
  seller,
  onPersist,
}: {
  open: boolean;
  onClose: () => void;
  seller: SellerBlockerInput;
  onPersist: (
    patch: Partial<SellerBlockerInput>
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [draft, setDraft] = useState<BillingCompletionDraft>(() => billingCompletionDraftFromSeller(seller));
  const [fieldIds, setFieldIds] = useState<SettingsReadinessItemId[]>(() =>
    billingCompleteFieldIds(settingsBillingReadiness(seller).items)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(billingCompletionDraftFromSeller(seller));
    setFieldIds(billingCompleteFieldIds(settingsBillingReadiness(seller).items));
    setError(null);
    // Bara när modalen öppnas – utkastet får inte skrivas tillbaka från parent medan man redigerar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function patchDraft(next: Partial<BillingCompletionDraft>) {
    setDraft((prev) => ({ ...prev, ...next }));
  }

  function discardAndClose() {
    setDraft(billingCompletionDraftFromSeller(seller));
    setError(null);
    onClose();
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    const result = await onPersist(billingCompletionPatchFromDraft(draft, fieldIds));
    setSaving(false);
    if (result.ok === false) {
      setError(result.error);
      return;
    }
    onClose();
  }

  const suggested = suggestedVatForCompletion(draft.orgNumber, draft.vatNumber);
  const vatOk = draft.vatNumber.trim() ? isVatNumberFormat(draft.vatNumber) : false;
  const vatSuggested =
    isOrgnrFormat(draft.orgNumber) && draft.vatNumber.trim() === formatVatNumber(draft.orgNumber);

  return (
    <Modal
      open={open}
      onClose={discardAndClose}
      size="md"
      title="Komplettera för fakturering"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={buttonClasses("ghost", "sm")} onClick={discardAndClose}>
            Stäng
          </button>
          <button type="button" className={buttonClasses("primary", "sm")} onClick={() => void save()} disabled={saving}>
            {saving ? "Sparar …" : "Spara"}
          </button>
        </div>
      }
    >
      <div className="space-y-5 px-6 py-5" data-testid="billing-complete-modal">
        <p className="text-[13px] leading-relaxed text-soft">
          Momsreg.nr och betalningssätt sparas först när du klickar Spara.
        </p>

        {fieldIds.includes("name") ? (
          <div data-testid="billing-complete-name">
            <label className={labelCls} htmlFor="komplettera-name">
              Företagsnamn
            </label>
            <input
              id="komplettera-name"
              value={draft.name}
              onChange={(e) => patchDraft({ name: e.target.value })}
              className={inputCls}
            />
          </div>
        ) : null}

        {fieldIds.includes("orgnr") ? (
          <div data-testid="billing-complete-orgnr">
            <label className={labelCls} htmlFor="komplettera-orgnr">
              Organisationsnummer
            </label>
            <input
              id="komplettera-orgnr"
              value={draft.orgNumber}
              onChange={(e) => patchDraft({ orgNumber: e.target.value })}
              placeholder="555555-5555"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              className={inputCls}
            />
          </div>
        ) : null}

        {fieldIds.includes("address") ? (
          <div data-testid="billing-complete-address">
            <AddressFields
              value={{ address: draft.address, postalCode: draft.postalCode, city: draft.city }}
              onChange={(parts) => patchDraft(parts)}
              ids={{ address: "komplettera-address", postalCode: "komplettera-postalCode", city: "komplettera-city" }}
              inputClassName={inputCls}
              labelClassName={labelCls}
            />
          </div>
        ) : null}

        <div data-testid="billing-complete-vat">
          <label className={labelCls} htmlFor="komplettera-vat">
            Momsregistreringsnummer
          </label>
          <input
            id="komplettera-vat"
            value={draft.vatNumber}
            onChange={(e) => patchDraft({ vatNumber: e.target.value })}
            placeholder="SE559123456701"
            className={inputCls}
          />
          {suggested ? (
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <p className={hintCls}>Föreslaget från org.nr: {suggested}</p>
              <button
                type="button"
                data-testid="billing-complete-suggest-vat"
                className={buttonClasses("secondary", "sm")}
                onClick={() => setDraft((prev) => applyBillingVatSuggestion(prev, suggested))}
              >
                Använd förslaget
              </button>
            </div>
          ) : vatOk ? (
            <p className={cx(hintCls, "text-ok")}>
              {vatSuggested ? "Föreslaget från org.nr. Format OK – inte verifierat." : "Format OK. Inte verifierat mot Skatteverket."}
            </p>
          ) : (
            <p className={hintCls}>Svenskt momsreg.nr: SE + org.nr utan bindestreck + 01.</p>
          )}
        </div>

        <div data-testid="billing-complete-payment">
          <label className={labelCls} htmlFor="komplettera-payment">
            Bankgiro
          </label>
          <input
            id="komplettera-payment"
            value={draft.bankgiro}
            onChange={(e) => patchDraft({ bankgiro: e.target.value })}
            onBlur={(e) => {
              const next = normalizeSwedishBankgiro(e.target.value);
              if (next) patchDraft({ bankgiro: next });
            }}
            {...swedishBankgiroInputProps}
            className={inputCls}
          />
          <p className={hintCls}>7–8 siffror, med eller utan bindestreck. Vi kontrollerar inte mot Bankgirot.</p>
        </div>

        {error ? (
          <p className="text-[14px] font-medium text-danger" data-testid="billing-complete-error">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
