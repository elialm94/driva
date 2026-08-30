"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Landmark, Plus } from "lucide-react";
import { buttonClasses, Card, PageHeader, cx } from "./ui";
import { BackLink } from "./back-link";
import { useUnsavedLeave } from "./unsaved-changes";
import { CompanyLogo } from "./company-logo";
import { ImageDropzone } from "./image-dropzone";
import { saveLogoAction, updateCompanySettingsAction } from "@/app/actions";
import type { CompanySettings, VatRate } from "@/lib/types";
import type { InvoiceDefaults } from "@/lib/services/settings";
import { SETTINGS_HREF, type SettingsFlik } from "@/lib/settings-routes";
import { formatOrgnr, formatVatNumber, isOrgnrFormat, isVatNumberFormat } from "@/lib/invoices/formats";
import { labelForHref, withReturnTo } from "@/lib/nav";
import type { IssueBlocker } from "@/lib/invoices/validate";
import { settingsFieldErrors, type SettingsFieldError, type SettingsTab } from "@/lib/settings-validation";
import { FieldError, FormValidationSummary, focusField, invalidFieldCls } from "./form-validation";
import type { MissingRequirement } from "@/lib/form-requirements";
import { DomainSettingsCard } from "./domain-widgets";
import { StickyMobileActions } from "./sticky-actions";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-soft";
const hintCls = "mt-1 text-[12px] text-muted";

const TABS: { key: SettingsFlik; label: string; href: string }[] = [
  { key: "foretag", label: "Företag", href: SETTINGS_HREF.foretag },
  { key: "fakturering", label: "Fakturering & betalning", href: SETTINGS_HREF.fakturering },
  { key: "standardval", label: "Standardval", href: SETTINGS_HREF.standardval },
  { key: "konto", label: "Konto", href: SETTINGS_HREF.konto },
];

type FormState = {
  name: string;
  orgNumber: string;
  vatNumber: string;
  email: string;
  websiteNotificationEmail: string;
  phone: string;
  websiteUrl: string;
  address: string;
  postalCode: string;
  city: string;
  sate: string;
  country: string;
  bankgiro: string;
  plusgiro: string;
  bankAccount: string;
  iban: string;
  bic: string;
  logoInitials: string;
  logoDataUrl: string;
  paymentTermsDays: number;
  lateInterestRate: number;
  quoteValidityDays: number;
  defaultVatRate: VatRate;
};

function fromInitial(initial: CompanySettings, defaults: InvoiceDefaults): FormState {
  return {
    name: initial.name,
    orgNumber: formatOrgnr(initial.orgNumber),
    vatNumber: initial.vatNumber,
    email: initial.email,
    websiteNotificationEmail: initial.websiteNotificationEmail || initial.email,
    phone: initial.phone,
    websiteUrl: initial.websiteUrl ?? "",
    address: initial.address,
    postalCode: initial.postalCode,
    city: initial.city,
    sate: initial.sate ?? "",
    country: initial.country ?? "Sverige",
    bankgiro: initial.bankgiro,
    plusgiro: initial.plusgiro ?? "",
    bankAccount: initial.bankAccount ?? "",
    iban: initial.iban ?? "",
    bic: initial.bic ?? "",
    logoInitials: initial.logoInitials,
    logoDataUrl: initial.logoDataUrl ?? "",
    paymentTermsDays: defaults.paymentTermsDays,
    lateInterestRate: defaults.lateInterestRate,
    quoteValidityDays: defaults.quoteValidityDays,
    defaultVatRate: defaults.defaultVatRate,
  };
}

export function SettingsForm({
  initial,
  defaults,
  flik,
  readiness,
  bank,
  returnTo,
  returnLabel,
  domainSummary = null,
}: {
  initial: CompanySettings;
  defaults: InvoiceDefaults;
  flik: SettingsFlik;
  readiness: { ready: boolean; missingCount: number; blockers: IssueBlocker[] };
  bank: { label: string; href: string } | null;
  returnTo?: string | null;
  returnLabel?: string | null;
  domainSummary?: { hostname: string; live: boolean } | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState(() => fromInitial(initial, defaults));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [extraPay, setExtraPay] = useState(() =>
    Boolean(initial.plusgiro || initial.bankAccount || initial.iban || initial.bic)
  );
  const [notifyTouched, setNotifyTouched] = useState(() => Boolean(initial.websiteNotificationEmail));
  const [isPending, startTransition] = useTransition();
  const [logoSaving, startLogoSave] = useTransition();
  const baseline = useRef(JSON.stringify(fromInitial(initial, defaults)));
  const dirty = JSON.stringify(form) !== baseline.current;
  const { dialog } = useUnsavedLeave(dirty && !isPending);

  function patch<K extends keyof FormState>(key: K, value: FormState[K]) {
    setSaved(false);
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "orgNumber" && isOrgnrFormat(String(value)) && !prev.vatNumber.trim()) {
        next.vatNumber = formatVatNumber(String(value));
      }
      if (key === "email" && !notifyTouched) {
        next.websiteNotificationEmail = String(value);
      }
      return next;
    });
  }

  // Logotypen autosparas direkt vid uppladdning/borttagning – ett dedikerat anrop som
  // aldrig tar med resten av ett halvredigerat formulär. Formulärets state patchas ändå
  // (och baslinjen flyttas efter lyckat spar) så att ett senare "Spara ändringar" med
  // hela formuläret aldrig kan backa logotypen.
  function saveLogo(url: string | undefined) {
    const next = url ?? "";
    patch("logoDataUrl", next);
    startLogoSave(async () => {
      const result = await saveLogoAction(url ?? null);
      if (result.ok === false) {
        // Misslyckat autospar: behåll bilden i formuläret så att "Spara ändringar" kan ta den.
        setLogoError(result.error);
        return;
      }
      setLogoError(null);
      const base = JSON.parse(baseline.current) as FormState;
      base.logoDataUrl = next;
      baseline.current = JSON.stringify(base);
      router.refresh();
    });
  }

  const orgnrOk = form.orgNumber.trim() ? isOrgnrFormat(form.orgNumber) : false;
  const vatOk = form.vatNumber.trim() ? isVatNumberFormat(form.vatNumber) : false;
  const vatSuggested = orgnrOk && form.vatNumber.trim() === formatVatNumber(form.orgNumber);

  const tabHref = (href: string) => withReturnTo(href, returnTo, returnLabel);

  // Realtidsvalidering – samma regler som servern (settings-validation.ts).
  const [attempted, setAttempted] = useState(false);
  const fieldErrors = useMemo(() => settingsFieldErrors(form), [form]);
  const showErrors = attempted && fieldErrors.length > 0;

  function errorFor(field: string): string | undefined {
    if (!showErrors) return undefined;
    return fieldErrors.find((e) => e.field === field)?.message;
  }

  function fieldMarkProps(field: string, base: string) {
    const message = errorFor(field);
    return {
      id: `installningar-${field}`,
      "aria-invalid": message ? true : undefined,
      "aria-describedby": message ? `installningar-${field}-fel` : undefined,
      className: cx(base, message && invalidFieldCls),
    };
  }

  // Betalningsvillkor och dröjsmålsränta redigeras på två flikar; fokusera lokalt när fältet finns här.
  function renderedOnCurrentTab(e: SettingsFieldError): boolean {
    if (e.tab === flik) return true;
    return flik === "fakturering" && (e.field === "paymentTermsDays" || e.field === "lateInterestRate");
  }

  const TAB_LABELS: Record<SettingsTab, string> = {
    foretag: "Företag",
    fakturering: "Fakturering & betalning",
    standardval: "Standardval",
  };

  const missingSummary: MissingRequirement[] = fieldErrors.map((e) =>
    renderedOnCurrentTab(e)
      ? { id: e.field, label: e.label, fieldId: `installningar-${e.field}` }
      : { id: e.field, label: `${e.label} – fliken ${TAB_LABELS[e.tab]}`, href: tabHref(SETTINGS_HREF[e.tab]) }
  );

  function save() {
    if (fieldErrors.length > 0) {
      setAttempted(true);
      const first = fieldErrors.find(renderedOnCurrentTab);
      if (first) focusField(`installningar-${first.field}`);
      return;
    }
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateCompanySettingsAction({
        name: form.name,
        orgNumber: form.orgNumber,
        vatNumber: form.vatNumber,
        email: form.email,
        websiteNotificationEmail: form.websiteNotificationEmail,
        phone: form.phone,
        websiteUrl: form.websiteUrl,
        address: form.address,
        postalCode: form.postalCode,
        city: form.city,
        sate: form.sate,
        country: form.country,
        bankgiro: form.bankgiro,
        plusgiro: form.plusgiro,
        bankAccount: form.bankAccount,
        iban: form.iban,
        bic: form.bic,
        logoInitials: form.logoInitials,
        logoDataUrl: form.logoDataUrl || undefined,
        paymentTermsDays: Number(form.paymentTermsDays),
        lateInterestRate: Number(form.lateInterestRate),
        quoteValidityDays: Number(form.quoteValidityDays),
        defaultVatRate: form.defaultVatRate,
      });
      if (result.ok === false) {
        setError(result.error);
        return;
      }
      baseline.current = JSON.stringify(form);
      setSaved(true);
      router.refresh();
    });
  }

  const firstMissingHref = readiness.blockers.find((b) => b.href)?.href;

  const subtitle = useMemo(() => {
    if (flik === "fakturering") return "Uppgifter som hamnar på nya fakturor. Utfärdade fakturor ändras inte.";
    if (flik === "standardval") return "Används när du skapar nya offerter och fakturor. Befintliga dokument ändras inte.";
    if (flik === "konto") return "Personligt konto är skilt från företagsuppgifterna.";
    return "Uppgifterna används på offerter, fakturor, hemsidan och i mejl. Du fyller i dem en gång.";
  }, [flik]);

  return (
    <div className="animate-fade-up">
      {returnTo ? (
        <PageHeader
          back={<BackLink fallbackHref={returnTo} fallbackLabel={returnLabel ?? labelForHref(returnTo)} />}
          title="Inställningar"
          subtitle={subtitle}
        />
      ) : (
        <PageHeader title="Inställningar" subtitle={subtitle} />
      )}

      <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <p className="text-[13px] font-medium text-muted">Fakturering</p>
          {readiness.ready ? (
            <p className="mt-0.5 text-[15px] font-medium text-ok">✓ Redo att fakturera</p>
          ) : (
            <p className="mt-0.5 text-[15px] font-medium text-warn">
              ⚠ {readiness.missingCount} {readiness.missingCount === 1 ? "uppgift saknas" : "uppgifter saknas"}
            </p>
          )}
        </div>
        {!readiness.ready && firstMissingHref ? (
          <Link href={tabHref(firstMissingHref) as never} className={buttonClasses("secondary", "sm")}>
            Komplettera
          </Link>
        ) : null}
      </Card>

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line pb-px">
        {TABS.map((tab) => {
          const active = tab.key === flik;
          return (
            <Link
              key={tab.key}
              href={tabHref(tab.href) as never}
              className={cx(
                "shrink-0 rounded-t-xl px-3.5 py-2.5 text-[14px] transition-colors",
                active ? "bg-card font-medium text-ink shadow-[0_-1px_0_#fff,0_1px_0_#e9e6de]" : "text-muted hover:text-ink"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!isPending && dirty) save();
        }}
      >
      {flik === "foretag" ? (
        <div className="space-y-5">
          <DomainSettingsCard summary={domainSummary} />
          <Card className="space-y-4 p-6">
            <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Identitet</p>
            <div>
              {/* En kompakt rad: förhandsvisning (logga/initialer) + klick-/släppyta. Sparas direkt. */}
              <ImageDropzone
                label="Logotyp"
                variant="compact"
                previewSlot={
                  <CompanyLogo
                    company={{ name: form.name, logoInitials: form.logoInitials || "FÖ", logoDataUrl: form.logoDataUrl || undefined }}
                    size="lg"
                  />
                }
                value={form.logoDataUrl || undefined}
                error={logoError}
                saving={logoSaving}
                onChange={saveLogo}
                onError={setLogoError}
                emptyLabel="Klicka eller släpp logotyp här"
                hint="JPG, PNG eller WebP · Valfritt"
                addLabel="Ladda upp logotyp"
                replaceLabel="Byt logotyp"
                removeLabel="Ta bort"
                compress={{ maxEdge: 800, quality: 0.88, maxChars: 400_000 }}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="installningar-name">
                Företagsnamn
              </label>
              <input value={form.name} onChange={(e) => patch("name", e.target.value)} {...fieldMarkProps("name", inputCls)} />
              <FieldError id="installningar-name-fel">{errorFor("name")}</FieldError>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor="installningar-orgNumber">
                  Organisationsnummer
                </label>
                <input
                  value={form.orgNumber}
                  onChange={(e) => {
                    const formatted = formatOrgnr(e.target.value);
                    e.target.value = formatted;
                    patch("orgNumber", formatted);
                  }}
                  onKeyDown={(e) => {
                    if (e.ctrlKey || e.metaKey || e.altKey) return;
                    if (e.key.length === 1 && !/\d/.test(e.key)) e.preventDefault();
                  }}
                  placeholder="559123-4567"
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck={false}
                  {...fieldMarkProps("orgNumber", inputCls)}
                />
                <FieldError id="installningar-orgNumber-fel">{errorFor("orgNumber")}</FieldError>
                {orgnrOk ? (
                  <p className={cx(hintCls, "text-ok")}>Format OK. Inte kontrollerat mot Skatteverket.</p>
                ) : errorFor("orgNumber") ? null : (
                  <p className={hintCls}>
                    Format NNNNNN-NNNN. Senare kan Driva hämta namn och adress härifrån – idag kontrolleras bara formatet.
                  </p>
                )}
              </div>
              <div>
                <label className={labelCls} htmlFor="installningar-vatNumber">
                  Momsregistreringsnummer
                </label>
                <input
                  value={form.vatNumber}
                  onChange={(e) => patch("vatNumber", e.target.value)}
                  placeholder="SE559123456701"
                  {...fieldMarkProps("vatNumber", inputCls)}
                />
                <FieldError id="installningar-vatNumber-fel">{errorFor("vatNumber")}</FieldError>
                {vatOk ? (
                  <p className={cx(hintCls, "text-ok")}>
                    {vatSuggested ? "Föreslaget från org.nr. Format OK – inte verifierat." : "Format OK. Inte verifierat mot Skatteverket."}
                  </p>
                ) : errorFor("vatNumber") ? null : (
                  <p className={hintCls}>Svenskt momsreg.nr: SE + org.nr utan bindestreck + 01.</p>
                )}
              </div>
            </div>
          </Card>

          <Card className="space-y-4 p-6">
            <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Adress</p>
            <p className={hintCls}>Samma adress används på offerter, fakturor och hemsidan. Du behöver inte ange den igen under fakturering.</p>
            <div>
              <label className={labelCls}>Gatuadress</label>
              <input value={form.address} onChange={(e) => patch("address", e.target.value)} className={inputCls} />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className={labelCls}>Postnummer</label>
                <input value={form.postalCode} onChange={(e) => patch("postalCode", e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Ort</label>
                <input value={form.city} onChange={(e) => patch("city", e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Land</label>
                <input value={form.country} onChange={(e) => patch("country", e.target.value)} className={inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Sätesort</label>
              <input
                value={form.sate}
                onChange={(e) => patch("sate", e.target.value)}
                placeholder={form.city || "Samma som ort"}
                className={inputCls}
              />
              <p className={hintCls}>Om tomt används orten på fakturan.</p>
            </div>
          </Card>

          <Card className="space-y-4 p-6">
            <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Kontakt</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor="installningar-email">
                  E-post
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => patch("email", e.target.value)}
                  {...fieldMarkProps("email", inputCls)}
                />
                <FieldError id="installningar-email-fel">{errorFor("email")}</FieldError>
              </div>
              <div>
                <label className={labelCls}>Telefon</label>
                <input
                  type="tel"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(e) => patch("phone", e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Webbplats</label>
              <input
                type="url"
                inputMode="url"
                autoCapitalize="none"
                value={form.websiteUrl}
                onChange={(e) => patch("websiteUrl", e.target.value)}
                placeholder="https://"
                className={inputCls}
              />
            </div>
          </Card>

          <div id="webbformulär" className="scroll-mt-24">
          <Card className="space-y-4 p-6">
            <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Uppdrag från hemsidan</p>
            <div>
              <label className={labelCls} htmlFor="installningar-websiteNotificationEmail">
                Skicka nya uppdrag till
              </label>
              <input
                type="email"
                value={form.websiteNotificationEmail}
                onChange={(e) => {
                  setNotifyTouched(true);
                  patch("websiteNotificationEmail", e.target.value);
                }}
                {...fieldMarkProps("websiteNotificationEmail", inputCls)}
              />
              <FieldError id="installningar-websiteNotificationEmail-fel">{errorFor("websiteNotificationEmail")}</FieldError>
              <p className={hintCls}>
                Standard är företagets e-post. En annan adress här ändrar inte den publika kontaktadressen på hemsidan.
              </p>
            </div>
          </Card>
          </div>
        </div>
      ) : null}

      {flik === "fakturering" ? (
        <div className="space-y-5">
          <Card className="space-y-4 p-6">
            <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Betalning till kunden</p>
            <p className={hintCls}>
              Adress och organisationsnummer hämtas från Företag. Fyll i de betalningssätt du faktiskt använder – du behöver inte ange alla.
            </p>
            <div>
              <label className={labelCls} htmlFor="installningar-bankgiro">
                Bankgiro
              </label>
              <input
                value={form.bankgiro}
                onChange={(e) => patch("bankgiro", e.target.value)}
                placeholder="5678-1234"
                {...fieldMarkProps("bankgiro", inputCls)}
              />
              <FieldError id="installningar-bankgiro-fel">{errorFor("bankgiro")}</FieldError>
              {errorFor("bankgiro") ? null : (
                <p className={hintCls}>Format NNN-NNNN eller NNNN-NNNN. Vi kontrollerar inte mot Bankgirot.</p>
              )}
            </div>
            {extraPay ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelCls} htmlFor="installningar-plusgiro">
                    PlusGiro
                  </label>
                  <input
                    value={form.plusgiro}
                    onChange={(e) => patch("plusgiro", e.target.value)}
                    placeholder="123456-1"
                    {...fieldMarkProps("plusgiro", inputCls)}
                  />
                  <FieldError id="installningar-plusgiro-fel">{errorFor("plusgiro")}</FieldError>
                </div>
                <div>
                  <label className={labelCls}>Bankkonto</label>
                  <input
                    value={form.bankAccount}
                    onChange={(e) => patch("bankAccount", e.target.value)}
                    placeholder="Clearing + kontonummer"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="installningar-iban">
                    IBAN
                  </label>
                  <input
                    value={form.iban}
                    onChange={(e) => patch("iban", e.target.value)}
                    placeholder="SE00 0000 0000 0000 0000 0000"
                    {...fieldMarkProps("iban", inputCls)}
                  />
                  <FieldError id="installningar-iban-fel">{errorFor("iban")}</FieldError>
                </div>
                <div>
                  <label className={labelCls} htmlFor="installningar-bic">
                    BIC/SWIFT
                  </label>
                  <input
                    value={form.bic}
                    onChange={(e) => patch("bic", e.target.value)}
                    placeholder="ESSESESS"
                    {...fieldMarkProps("bic", inputCls)}
                  />
                  <FieldError id="installningar-bic-fel">{errorFor("bic")}</FieldError>
                </div>
              </div>
            ) : (
              <button type="button" className={buttonClasses("ghost", "sm")} onClick={() => setExtraPay(true)}>
                <Plus className="size-3.5" /> Lägg till PlusGiro, bankkonto eller IBAN
              </button>
            )}
          </Card>

          <Card className="space-y-4 p-6">
            <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Standard på nya fakturor</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor="installningar-paymentTermsDays">
                  Betalningsvillkor (dagar)
                </label>
                <input
                  type="number"
                  min={1}
                  value={form.paymentTermsDays}
                  onChange={(e) => patch("paymentTermsDays", Number(e.target.value))}
                  {...fieldMarkProps("paymentTermsDays", inputCls)}
                />
                <FieldError id="installningar-paymentTermsDays-fel">{errorFor("paymentTermsDays")}</FieldError>
              </div>
              <div>
                <label className={labelCls} htmlFor="installningar-lateInterestRate">
                  Dröjsmålsränta (% per år)
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={form.lateInterestRate}
                  onChange={(e) => patch("lateInterestRate", Number(e.target.value))}
                  {...fieldMarkProps("lateInterestRate", inputCls)}
                />
                <FieldError id="installningar-lateInterestRate-fel">{errorFor("lateInterestRate")}</FieldError>
                <p className={hintCls}>Kan ändras per faktura.</p>
              </div>
            </div>
          </Card>

          {bank ? (
            <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-accent-soft">
                  <Landmark className="size-4.5 text-accent" />
                </div>
                <div>
                  <p className="text-[13px] font-medium text-muted">Anslutet bankkonto</p>
                  <p className="text-[14px] font-medium text-ink">{bank.label}</p>
                </div>
              </div>
              <Link href={bank.href as never} className={buttonClasses("secondary", "sm")}>
                Hantera bankkoppling →
              </Link>
            </Card>
          ) : null}
        </div>
      ) : null}

      {flik === "standardval" ? (
        <Card className="space-y-5 p-6">
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Fakturor</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor="installningar-paymentTermsDays">
                  Betalningsvillkor (dagar)
                </label>
                <input
                  type="number"
                  min={1}
                  value={form.paymentTermsDays}
                  onChange={(e) => patch("paymentTermsDays", Number(e.target.value))}
                  {...fieldMarkProps("paymentTermsDays", inputCls)}
                />
                <FieldError id="installningar-paymentTermsDays-fel">{errorFor("paymentTermsDays")}</FieldError>
              </div>
              <div>
                <label className={labelCls} htmlFor="installningar-lateInterestRate">
                  Dröjsmålsränta (% per år)
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={form.lateInterestRate}
                  onChange={(e) => patch("lateInterestRate", Number(e.target.value))}
                  {...fieldMarkProps("lateInterestRate", inputCls)}
                />
                <FieldError id="installningar-lateInterestRate-fel">{errorFor("lateInterestRate")}</FieldError>
              </div>
            </div>
          </div>
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Offerter</p>
            <div className="mt-3 max-w-xs">
              <label className={labelCls} htmlFor="installningar-quoteValidityDays">
                Standard giltighetstid (dagar)
              </label>
              <input
                type="number"
                min={1}
                value={form.quoteValidityDays}
                onChange={(e) => patch("quoteValidityDays", Number(e.target.value))}
                {...fieldMarkProps("quoteValidityDays", inputCls)}
              />
              <FieldError id="installningar-quoteValidityDays-fel">{errorFor("quoteValidityDays")}</FieldError>
            </div>
          </div>
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Moms</p>
            <div className="mt-3 max-w-xs">
              <label className={labelCls}>Vanlig momssats</label>
              <select
                value={form.defaultVatRate}
                onChange={(e) => patch("defaultVatRate", Number(e.target.value) as VatRate)}
                className={inputCls}
              >
                <option value={25}>25 %</option>
                <option value={12}>12 %</option>
                <option value={6}>6 %</option>
                <option value={0}>0 %</option>
              </select>
              <p className={hintCls}>Förifylld på nya rader. Ändras inte på redan skapade dokument.</p>
            </div>
          </div>
        </Card>
      ) : null}

      {flik === "konto" ? (
        <div className="space-y-5">
          <Card className="space-y-3 p-6">
            <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Demoläge</p>
            <p className="text-[15px] leading-relaxed text-soft">
              Driva körs just nu utan inloggning. Du arbetar som företagare för{" "}
              <span className="font-medium text-ink">{initial.name}</span>. Det finns inget separat användarkonto eller
              lösenord att ändra.
            </p>
            <p className="text-[14px] text-muted">
              Utskick använder företagets e-post{" "}
              <span className="font-medium text-ink">{initial.email || "–"}</span>.
            </p>
          </Card>
        </div>
      ) : null}

      {flik !== "konto" ? (
        <div className="mt-6">
          {showErrors ? (
            <FormValidationSummary
              id="installningar-saknas"
              missing={missingSummary}
              heading={missingSummary.length === 1 ? "1 uppgift behöver rättas" : `${missingSummary.length} uppgifter behöver rättas`}
              className="mb-4 max-w-xl"
            />
          ) : null}
          {/* Mobil: spara-knappen bor i den stickiga raden nedanför i stället. */}
          <div className="hidden flex-wrap items-center gap-3 lg:flex">
            <button
              type="submit"
              className={buttonClasses("primary")}
              disabled={isPending || !dirty}
              aria-describedby={showErrors ? "installningar-saknas" : undefined}
            >
              {isPending ? "Sparar …" : "Spara ändringar"}
            </button>
            {saved && !dirty ? (
              <p className="flex items-center gap-1.5 text-[14px] font-medium text-ok">
                <Check className="size-4" /> Ändringarna är sparade
              </p>
            ) : null}
            {!dirty && !saved ? <p className="text-[13px] text-muted">Inga osparade ändringar.</p> : null}
            {error ? (
              <p className="text-[14px] font-medium text-danger">
                Ändringarna kunde inte sparas just nu. Inget har gått förlorat. {error}
              </p>
            ) : null}
          </div>
          <StickyMobileActions
            summary={
              showErrors ? (
                <button
                  type="button"
                  onClick={() => focusField("installningar-saknas")}
                  className="text-[12px] font-medium text-warn underline decoration-warn/60 underline-offset-2"
                >
                  {missingSummary.length === 1
                    ? "1 uppgift behöver rättas"
                    : `${missingSummary.length} uppgifter behöver rättas`}
                </button>
              ) : error ? (
                <p className="text-[13px] font-medium text-danger">Kunde inte spara just nu. Inget har gått förlorat.</p>
              ) : saved && !dirty ? (
                <p className="flex items-center gap-1.5 text-[13px] font-medium text-ok">
                  <Check className="size-4" /> Ändringarna är sparade
                </p>
              ) : null
            }
          >
            <button
              type="submit"
              className={buttonClasses("primary", "lg", "flex-1")}
              disabled={isPending || !dirty}
              aria-describedby={showErrors ? "installningar-saknas" : undefined}
            >
              {isPending ? "Sparar …" : dirty ? "Spara ändringar" : "Inga osparade ändringar"}
            </button>
          </StickyMobileActions>
        </div>
      ) : null}
      </form>

      {dialog}
    </div>
  );
}
