"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { setWebsiteFooterAction } from "@/app/actions";
import type { CompanySettings, Website, WebsiteFooter } from "@/lib/types";
import {
  FOOTER_ABOUT_MAX,
  SOCIAL_NETWORK_LABELS,
  WEBSITE_SOCIAL_NETWORKS,
  draftWebsiteFooter,
  footerSummaryRows,
  resolveFooterAbout,
  sameFooter,
} from "@/lib/website-footer";
import { formatAddressLine, resolveSiteContact } from "@/lib/website-contact";
import { SETTINGS_HREF } from "@/lib/settings-routes";
import { buttonClasses, cx } from "./ui";
import { Modal } from "./modal";

/** Sammanfattning + modal. Ligger under Innehåll, inte bland reorderbara sektioner. */
export function FooterSettingsCard({
  website,
  company,
  published,
}: {
  website: Website;
  company: CompanySettings;
  published: boolean;
}) {
  const [open, setOpen] = useState(false);
  const footer = draftWebsiteFooter(website);
  const contact = resolveSiteContact(company, website);
  const rows = footerSummaryRows(footer, {
    phone: contact.phone,
    email: contact.email,
    address: formatAddressLine(contact),
  });
  const unpublished = published && !sameFooter(footer, website.footer ?? {});

  return (
    <>
      <div>
        <p className="text-[14px] font-medium text-ink">Sidfot</p>
        <dl className="mt-2 space-y-1.5">
          {rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-3 text-[13px]">
              <dt className="text-soft">{row.label}</dt>
              <dd className="font-medium text-ink">{row.value}</dd>
            </div>
          ))}
        </dl>
        {unpublished ? (
          <p className="mt-2 text-[12px] leading-relaxed text-muted">Opublicerade ändringar</p>
        ) : null}
        <button type="button" className={cx(buttonClasses("secondary", "sm"), "mt-3")} onClick={() => setOpen(true)}>
          <Pencil className="size-3.5" /> Redigera sidfot
        </button>
      </div>
      {open ? (
        <FooterEditModal website={website} company={company} published={published} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function FooterEditModal({
  website,
  company,
  published,
  onClose,
}: {
  website: Website;
  company: CompanySettings;
  published: boolean;
  onClose: () => void;
}) {
  const initial = draftWebsiteFooter(website);
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const contact = resolveSiteContact(company, website);
  const address = formatAddressLine(contact);
  const suggestedAbout = resolveFooterAbout({ ...form, aboutText: undefined }, website) ?? "";
  const unpublished = published && !sameFooter(form, website.footer ?? {});

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await setWebsiteFooterAction({
        showPhone: form.showPhone,
        showEmail: form.showEmail,
        showAddress: form.showAddress,
        showServices: form.showServices,
        showLogo: form.showLogo,
        aboutText: form.aboutText ?? "",
        social: form.social ?? {},
      });
      if (result.ok === false) {
        setError(result.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Redigera sidfot"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClasses("ghost")} onClick={onClose} disabled={pending}>
            Avbryt
          </button>
          <button type="button" className={buttonClasses("primary")} onClick={save} disabled={pending}>
            {pending ? "Sparar …" : "Spara"}
          </button>
        </div>
      }
    >
      <div className="space-y-4 px-6 py-5">
        <div className="space-y-2">
          <Toggle
            label="Visa telefon"
            hint={contact.phone || "Saknas i Inställningar"}
            checked={form.showPhone !== false}
            disabled={!contact.phone}
            onChange={(showPhone) => setForm({ ...form, showPhone })}
          />
          <Toggle
            label="Visa e-post"
            hint={contact.email || "Saknas i Inställningar"}
            checked={form.showEmail !== false}
            disabled={!contact.email}
            onChange={(showEmail) => setForm({ ...form, showEmail })}
          />
          <Toggle
            label="Visa adress"
            hint={address || "Saknas i Inställningar"}
            checked={form.showAddress !== false}
            disabled={!address}
            onChange={(showAddress) => setForm({ ...form, showAddress })}
          />
          <Toggle
            label="Visa tjänster"
            hint="Från Tjänster-sektionen"
            checked={form.showServices !== false}
            onChange={(showServices) => setForm({ ...form, showServices })}
          />
          <Toggle
            label="Visa logotyp"
            hint={company.logoDataUrl ? "Samma logotyp som i Inställningar" : "Ingen logotyp uppladdad"}
            checked={form.showLogo !== false}
            disabled={!company.logoDataUrl}
            onChange={(showLogo) => setForm({ ...form, showLogo })}
          />
        </div>

        <p className="text-[12px] leading-relaxed text-muted">
          Ändra telefon, e-post, adress och logotyp i{" "}
          <a href={SETTINGS_HREF.foretag} className="font-medium text-accent hover:underline">
            Företagsuppgifter
          </a>
          .
        </p>

        <div className="space-y-3">
          {WEBSITE_SOCIAL_NETWORKS.map((network) => (
            <div key={network}>
              <label className="mb-1.5 block text-[13px] font-medium text-soft" htmlFor={`footer-${network}`}>
                {SOCIAL_NETWORK_LABELS[network]}
              </label>
              <input
                id={`footer-${network}`}
                type="url"
                inputMode="url"
                placeholder={`https://${network}.com/dittforetag`}
                value={form.social?.[network] ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    social: { ...form.social, [network]: e.target.value },
                  })
                }
                className="w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] focus:border-accent"
              />
            </div>
          ))}
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-soft" htmlFor="footer-about">
            Kort om företaget
          </label>
          <textarea
            id="footer-about"
            value={form.aboutText ?? ""}
            onChange={(e) => setForm({ ...form, aboutText: e.target.value })}
            rows={4}
            maxLength={FOOTER_ABOUT_MAX}
            placeholder={suggestedAbout}
            className="w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] leading-relaxed focus:border-accent"
          />
          <p className="mt-1.5 text-[12px] text-muted">
            Tomt fält använder text från Om oss eller startsidan. {(form.aboutText ?? "").trim().length}/
            {FOOTER_ABOUT_MAX}
          </p>
        </div>

        {error ? <p className="text-[13px] font-medium text-danger">{error}</p> : null}
        {unpublished ? (
          <p className="text-[12px] leading-relaxed text-muted">
            Sidfoten i förhandsvisningen publiceras när du klickar Publicera ändringar.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={cx("flex items-start justify-between gap-3 rounded-xl border border-line px-3 py-2.5", disabled && "opacity-60")}>
      <span>
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        {hint ? <span className="mt-0.5 block text-[12px] text-muted">{hint}</span> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 accent-current"
      />
    </label>
  );
}
