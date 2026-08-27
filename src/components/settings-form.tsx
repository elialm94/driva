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
import { updateCompanySettingsAction } from "@/app/actions";
import { resetDemoAction } from "@/app/actions";
import type { CompanySettings, VatRate } from "@/lib/types";
import type { InvoiceDefaults } from "@/lib/services/settings";
import { SETTINGS_HREF, type SettingsFlik } from "@/lib/settings-routes";
import { formatOrgnr, formatVatNumber, isOrgnrFormat, isVatNumberFormat } from "@/lib/invoices/formats";
import { withReturnTo } from "@/lib/nav";
import type { IssueBlocker } from "@/lib/invoices/validate";
import { swedishFormProps } from "@/lib/swedish-validity";
import { DomainSettingsCard } from "./domain-widgets";

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
  inquiryNotificationEmail: string;
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
    inquiryNotificationEmail: initial.inquiryNotificationEmail || initial.email,
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
  const [notifyTouched, setNotifyTouched] = useState(() => Boolean(initial.inquiryNotificationEmail));
  const [isPending, startTransition] = useTransition();
  const [resetting, startReset] = useTransition();
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
        next.inquiryNotificationEmail = String(value);
      }
      return next;
    });
  }

  const orgnrOk = form.orgNumber.trim() ? isOrgnrFormat(form.orgNumber) : false;
  const vatOk = form.vatNumber.trim() ? isVatNumberFormat(form.vatNumber) : false;
  const vatSuggested = orgnrOk && form.vatNumber.trim() === formatVatNumber(form.orgNumber);

  const tabHref = (href: string) => withReturnTo(href, returnTo, returnLabel);

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateCompanySettingsAction({
        name: form.name,
        orgNumber: form.orgNumber,
        vatNumber: form.vatNumber,
        email: form.email,
        inquiryNotificationEmail: form.inquiryNotificationEmail,
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
          back={<BackLink fallbackHref={returnTo} fallbackLabel={returnLabel ?? "Tillbaka"} />}
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
        {...swedishFormProps()}
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
              <div className="flex flex-wrap items-start gap-4">
                <CompanyLogo
                  company={{ name: form.name, logoInitials: form.logoInitials || "FÖ", logoDataUrl: form.logoDataUrl || undefined }}
                  size="lg"
                />
                <div className="min-w-[16rem] flex-1">
                  <ImageDropzone
                    label="Logotyp"
                    hint={form.logoDataUrl ? undefined : "Valfritt. Utan logotyp visas initialerna."}
                    value={form.logoDataUrl || undefined}
                    error={logoError}
                    onChange={(url) => patch("logoDataUrl", url ?? "")}
                    onError={setLogoError}
                    variant="thumb"
                    addLabel="Välj bild"
                    replaceLabel="Byt logotyp"
                    removeLabel="Ta bort"
                    compress={{ maxEdge: 800, quality: 0.88, maxChars: 400_000 }}
                  />
                </div>
              </div>
            </div>
            <div>
              <label className={labelCls}>Företagsnamn</label>
              <input value={form.name} onChange={(e) => patch("name", e.target.value)} className={inputCls} required />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor="orgnr">
                  Organisationsnummer
                </label>
                <input
                  id="orgnr"
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
                  className={inputCls}
                />
                {orgnrOk ? (
                  <p className={cx(hintCls, "text-ok")}>Format OK. Inte kontrollerat mot Skatteverket.</p>
                ) : (
                  <p className={hintCls}>
                    Format NNNNNN-NNNN. Senare kan Driva hämta namn och adress härifrån – idag kontrolleras bara formatet.
                  </p>
                )}
              </div>
              <div>
                <label className={labelCls}>Momsregistreringsnummer</label>
                <input
                  value={form.vatNumber}
                  onChange={(e) => patch("vatNumber", e.target.value)}
                  placeholder="SE559123456701"
                  className={inputCls}
                />
                {vatOk ? (
                  <p className={cx(hintCls, vatSuggested ? "text-ok" : "text-ok")}>
                    {vatSuggested ? "Föreslaget från org.nr. Format OK – inte verifierat." : "Format OK. Inte verifierat mot Skatteverket."}
                  </p>
                ) : (
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
                <label className={labelCls}>E-post</label>
                <input type="email" value={form.email} onChange={(e) => patch("email", e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Telefon</label>
                <input value={form.phone} onChange={(e) => patch("phone", e.target.value)} className={inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Webbplats</label>
              <input
                value={form.websiteUrl}
                onChange={(e) => patch("websiteUrl", e.target.value)}
                placeholder="https://"
                className={inputCls}
              />
            </div>
          </Card>

          <div id="forfragningar" className="scroll-mt-24">
          <Card className="space-y-4 p-6">
            <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Förfrågningar från hemsidan</p>
            <div>
              <label className={labelCls} htmlFor="inquiry-notify-email">
                Skicka nya förfrågningar till
              </label>
              <input
                id="inquiry-notify-email"
                type="email"
                value={form.inquiryNotificationEmail}
                onChange={(e) => {
                  setNotifyTouched(true);
                  patch("inquiryNotificationEmail", e.target.value);
                }}
                className={inputCls}
              />
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
              <label className={labelCls}>Bankgiro</label>
              <input
                value={form.bankgiro}
                onChange={(e) => patch("bankgiro", e.target.value)}
                placeholder="5678-1234"
                className={inputCls}
              />
              <p className={hintCls}>Format NNN-NNNN eller NNNN-NNNN. Vi kontrollerar inte mot Bankgirot.</p>
            </div>
            {extraPay ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>PlusGiro</label>
                  <input value={form.plusgiro} onChange={(e) => patch("plusgiro", e.target.value)} placeholder="123456-1" className={inputCls} />
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
                  <label className={labelCls}>IBAN</label>
                  <input value={form.iban} onChange={(e) => patch("iban", e.target.value)} placeholder="SE00 0000 0000 0000 0000 0000" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>BIC/SWIFT</label>
                  <input value={form.bic} onChange={(e) => patch("bic", e.target.value)} placeholder="ESSESESS" className={inputCls} />
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
                <label className={labelCls}>Betalningsvillkor (dagar)</label>
                <input
                  type="number"
                  min={1}
                  value={form.paymentTermsDays}
                  onChange={(e) => patch("paymentTermsDays", Number(e.target.value))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Dröjsmålsränta (% per år)</label>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={form.lateInterestRate}
                  onChange={(e) => patch("lateInterestRate", Number(e.target.value))}
                  className={inputCls}
                />
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
                <label className={labelCls}>Betalningsvillkor (dagar)</label>
                <input
                  type="number"
                  min={1}
                  value={form.paymentTermsDays}
                  onChange={(e) => patch("paymentTermsDays", Number(e.target.value))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Dröjsmålsränta (% per år)</label>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={form.lateInterestRate}
                  onChange={(e) => patch("lateInterestRate", Number(e.target.value))}
                  className={inputCls}
                />
              </div>
            </div>
          </div>
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Offerter</p>
            <div className="mt-3 max-w-xs">
              <label className={labelCls}>Standard giltighetstid (dagar)</label>
              <input
                type="number"
                min={1}
                value={form.quoteValidityDays}
                onChange={(e) => patch("quoteValidityDays", Number(e.target.value))}
                className={inputCls}
              />
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
          <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <p className="text-[14px] font-medium text-ink">Återställ demodata</p>
              <p className="text-[13px] text-muted">Nollställer företaget, kunder och dokument till exempeldatat.</p>
            </div>
            <button
              type="button"
              className={buttonClasses("secondary", "sm")}
              disabled={resetting}
              onClick={() => startReset(async () => resetDemoAction())}
            >
              {resetting ? "Återställer …" : "Återställ"}
            </button>
          </Card>
        </div>
      ) : null}

      {flik !== "konto" ? (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="submit" className={buttonClasses("primary")} disabled={isPending || !dirty}>
            {isPending ? "Sparar …" : "Spara ändringar"}
          </button>
          {saved && !dirty ? (
            <p className="flex items-center gap-1.5 text-[14px] font-medium text-ok">
              <Check className="size-4" /> Ändringarna är sparade
            </p>
          ) : null}
          {error ? <p className="text-[14px] font-medium text-danger">{error}</p> : null}
        </div>
      ) : null}
      </form>

      {dialog}
    </div>
  );
}
