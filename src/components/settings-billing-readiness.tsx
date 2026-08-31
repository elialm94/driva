"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Circle } from "lucide-react";
import { buttonClasses, Card, cx } from "./ui";
import { Modal } from "./modal";
import { AddressAutocompleteInput } from "./address-autocomplete";
import { focusField } from "./form-validation";
import {
  extraPayFieldsNeeded,
  settingsBillingReadiness,
  suggestedVatForCompletion,
  type SettingsReadinessItem,
} from "@/lib/billing-readiness";
import type { SellerBlockerInput } from "@/lib/invoices/seller-blockers";
import type { SettingsFlik } from "@/lib/settings-routes";
import { formatVatNumber, isOrgnrFormat, isVatNumberFormat } from "@/lib/invoices/formats";
import {
  formatSwedishPostalCode,
  isSwedishPostalCode,
  normalizeSwedishBankgiro,
  swedishBankgiroInputProps,
} from "@/lib/validation";
import { withReturnTo } from "@/lib/nav";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-soft";
const hintCls = "mt-1 text-[12px] text-muted";

export function SettingsBillingBanner({
  seller,
  flik,
  returnTo,
  returnLabel,
  savedReady,
  onPatch,
  onRequestExtraPay,
  onSave,
  saving,
}: {
  seller: SellerBlockerInput;
  flik: SettingsFlik;
  returnTo?: string | null;
  returnLabel?: string | null;
  /** Sparad (server) readiness – styr den tysta "redan redo"-hinten. */
  savedReady: boolean;
  onPatch: (patch: Partial<SellerBlockerInput>) => void;
  onRequestExtraPay: () => void;
  onSave: () => void;
  saving: boolean;
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

  if (readiness.ready) {
    if (!justCompleted || settled) {
      return (
        <p className="mb-6 text-[13px] text-muted" data-testid="billing-readiness-ready">
          Redo att fakturera
        </p>
      );
    }
    return (
      <Card className="mb-6 px-5 py-4" data-testid="billing-readiness-success">
        <p className="text-[13px] font-medium text-muted">Fakturering</p>
        <p className="mt-0.5 text-[15px] font-medium text-ok">✓ Redo att fakturera</p>
        <p className="mt-1 text-[13px] text-soft">{readiness.consequence}</p>
      </Card>
    );
  }

  return (
    <>
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

      <BillingCompleteModal
        open={completeOpen}
        onClose={() => setCompleteOpen(false)}
        seller={seller}
        items={readiness.items}
        flik={flik}
        returnTo={returnTo}
        returnLabel={returnLabel}
        onPatch={onPatch}
        onRequestExtraPay={onRequestExtraPay}
        onSave={onSave}
        saving={saving}
      />
    </>
  );
}

function BillingCompleteModal({
  open,
  onClose,
  seller,
  items,
  flik,
  returnTo,
  returnLabel,
  onPatch,
  onRequestExtraPay,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  seller: SellerBlockerInput;
  items: SettingsReadinessItem[];
  flik: SettingsFlik;
  returnTo?: string | null;
  returnLabel?: string | null;
  onPatch: (patch: Partial<SellerBlockerInput>) => void;
  onRequestExtraPay: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const router = useRouter();
  const [sessionIds, setSessionIds] = useState<SettingsReadinessItem["id"][]>([]);
  const sessionItemsRef = useRef<SettingsReadinessItem[]>([]);

  useEffect(() => {
    if (!open) {
      setSessionIds([]);
      sessionItemsRef.current = [];
      return;
    }
    setSessionIds(items.map((item) => item.id));
    sessionItemsRef.current = items;
    // Bara när modalen öppnas – ifyllda rader ska få checkmark, inte försvinna ur listan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const missingIds = new Set(items.map((item) => item.id));
  const rows = (sessionIds.length ? sessionIds : items.map((i) => i.id)).map((id) => {
    const live = items.find((item) => item.id === id);
    const remembered = sessionItemsRef.current.find((item) => item.id === id);
    return {
      item: live ?? remembered!,
      done: !missingIds.has(id),
    };
  }).filter((row) => row.item);

  function goToField(item: SettingsReadinessItem) {
    if (extraPayFieldsNeeded(item.field)) onRequestExtraPay();
    if (flik === item.flik) {
      onClose();
      window.requestAnimationFrame(() => focusField(item.fieldId));
      return;
    }
    router.push(withReturnTo(item.href, returnTo, returnLabel) as never);
  }

  function focusInline(id: string) {
    focusField(id);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Komplettera för fakturering"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={buttonClasses("ghost", "sm")} onClick={onClose}>
            Stäng
          </button>
          <button type="button" className={buttonClasses("primary", "sm")} onClick={onSave} disabled={saving}>
            {saving ? "Sparar …" : "Spara"}
          </button>
        </div>
      }
    >
      <div className="space-y-4 px-6 py-5">
        <p className="text-[13px] leading-relaxed text-soft">
          {items.length === 0
            ? "Du har fyllt i allt som krävs för att skicka fakturor."
            : items.length === 1
              ? "1 uppgift behöver kompletteras innan du kan skicka fakturor."
              : `${items.length} uppgifter behöver kompletteras innan du kan skicka fakturor.`}
        </p>
        <ul className="space-y-3">
          {rows.map(({ item, done }) => (
            <li
              key={item.id}
              className="rounded-2xl border border-line px-4 py-3"
              data-testid={`billing-complete-${item.id}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex min-w-0 items-center gap-2 text-[14px] font-medium text-ink">
                  {done ? (
                    <Check className="size-4 shrink-0 text-ok" aria-hidden />
                  ) : (
                    <Circle className="size-3.5 shrink-0 text-muted" aria-hidden />
                  )}
                  <span className={done ? "text-ok" : undefined}>{item.label}</span>
                </p>
                {!done ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={buttonClasses("secondary", "sm")}
                      onClick={() => focusInline(`komplettera-${item.id}`)}
                    >
                      Fyll i
                    </button>
                    <button
                      type="button"
                      className="text-[12px] font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
                      onClick={() => goToField(item)}
                    >
                      Visa fältet
                    </button>
                  </div>
                ) : (
                  <span className="text-[12px] font-medium text-ok">Klart</span>
                )}
              </div>
              {item.hint && !done ? <p className={cx(hintCls, "ml-6")}>{item.hint}</p> : null}
              {!done ? (
                <div className="mt-3 ml-0 sm:ml-6">
                  <CompletionFields item={item} seller={seller} onPatch={onPatch} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

function CompletionFields({
  item,
  seller,
  onPatch,
}: {
  item: SettingsReadinessItem;
  seller: SellerBlockerInput;
  onPatch: (patch: Partial<SellerBlockerInput>) => void;
}) {
  if (item.id === "address") {
    return (
      <div className="space-y-3">
        <div>
          <label className={labelCls} htmlFor="komplettera-address">
            Gatuadress
          </label>
          <AddressAutocompleteInput
            id="komplettera-address"
            value={seller.address}
            onValueChange={(next) => onPatch({ address: next })}
            onAddressSelected={(parts) =>
              onPatch({
                address: parts.address,
                ...(parts.postalCode ? { postalCode: parts.postalCode } : {}),
                ...(parts.city ? { city: parts.city } : {}),
              })
            }
            inputClassName={inputCls}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="komplettera-postalCode">
              Postnummer
            </label>
            <input
              id="komplettera-postalCode"
              value={seller.postalCode}
              onChange={(e) => onPatch({ postalCode: e.target.value })}
              onBlur={(e) => {
                if (isSwedishPostalCode(e.target.value)) onPatch({ postalCode: formatSwedishPostalCode(e.target.value) });
              }}
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="116 24"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="komplettera-city">
              Ort
            </label>
            <input
              id="komplettera-city"
              value={seller.city}
              onChange={(e) => onPatch({ city: e.target.value })}
              className={inputCls}
            />
          </div>
        </div>
      </div>
    );
  }

  if (item.id === "vat") {
    const suggested = suggestedVatForCompletion(seller.orgNumber, seller.vatNumber);
    const vatOk = seller.vatNumber.trim() ? isVatNumberFormat(seller.vatNumber) : false;
    const vatSuggested =
      isOrgnrFormat(seller.orgNumber) && seller.vatNumber.trim() === formatVatNumber(seller.orgNumber);
    return (
      <div>
        <label className={labelCls} htmlFor="komplettera-vat">
          Momsregistreringsnummer
        </label>
        <input
          id="komplettera-vat"
          value={seller.vatNumber}
          onChange={(e) => onPatch({ vatNumber: e.target.value })}
          placeholder="SE559123456701"
          className={inputCls}
        />
        {suggested ? (
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <p className={hintCls}>Föreslaget från org.nr: {suggested}</p>
            <button
              type="button"
              className={buttonClasses("secondary", "sm")}
              onClick={() => onPatch({ vatNumber: suggested })}
            >
              Använd föreslaget
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
    );
  }

  if (item.id === "payment") {
    return (
      <div>
        <label className={labelCls} htmlFor="komplettera-payment">
          Bankgiro
        </label>
        <input
          id="komplettera-payment"
          value={seller.bankgiro}
          onChange={(e) => onPatch({ bankgiro: e.target.value })}
          onBlur={(e) => {
            const next = normalizeSwedishBankgiro(e.target.value);
            if (next) onPatch({ bankgiro: next });
          }}
          {...swedishBankgiroInputProps}
          className={inputCls}
        />
        <p className={hintCls}>Ett giltigt sätt räcker – Bankgiro, PlusGiro, bankkonto eller IBAN.</p>
      </div>
    );
  }

  if (item.id === "name") {
    return (
      <div>
        <label className={labelCls} htmlFor="komplettera-name">
          Företagsnamn
        </label>
        <input
          id="komplettera-name"
          value={seller.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          className={inputCls}
        />
      </div>
    );
  }

  if (item.id === "orgnr") {
    return (
      <div>
        <label className={labelCls} htmlFor="komplettera-orgnr">
          Organisationsnummer
        </label>
        <input
          id="komplettera-orgnr"
          value={seller.orgNumber}
          onChange={(e) => onPatch({ orgNumber: e.target.value })}
          placeholder="555555-5555"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          className={inputCls}
        />
      </div>
    );
  }

  return null;
}
