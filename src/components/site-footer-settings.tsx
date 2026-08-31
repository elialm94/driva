"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setWebsiteFooterAction } from "@/app/actions";
import type { CompanySettings, Website, WebsiteFooter } from "@/lib/types";
import {
  FOOTER_ABOUT_MAX,
  SOCIAL_NETWORK_LABELS,
  WEBSITE_SOCIAL_NETWORKS,
  draftWebsiteFooter,
  resolveFooterAbout,
  sameFooter,
} from "@/lib/website-footer";
import { formatAddressLine, resolveSiteContact } from "@/lib/website-contact";
import { SETTINGS_HREF } from "@/lib/settings-routes";
import { cx } from "./ui";

export function FooterSettingsCard({
  website,
  company,
  published,
}: {
  website: Website;
  company: CompanySettings;
  published: boolean;
}) {
  const initial = draftWebsiteFooter(website);
  const publishedFooter = website.footer;
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const savedRef = useRef(initial);

  useEffect(() => {
    const next = draftWebsiteFooter(website);
    if (sameFooter(next, savedRef.current)) return;
    savedRef.current = next;
    setForm(next);
  }, [website]);

  const contact = resolveSiteContact(company, website);
  const address = formatAddressLine(contact);
  const suggestedAbout = resolveFooterAbout({ ...form, aboutText: undefined }, website) ?? "";
  const unpublished = published && !sameFooter(form, publishedFooter ?? {});

  function patch(next: WebsiteFooter) {
    setForm(next);
    setError(null);
    startTransition(async () => {
      const result = await setWebsiteFooterAction({
        showPhone: next.showPhone,
        showEmail: next.showEmail,
        showAddress: next.showAddress,
        showServices: next.showServices,
        showLogo: next.showLogo,
        aboutText: next.aboutText ?? "",
        social: next.social ?? {},
      });
      if (result.ok === false) {
        setError(result.error);
        return;
      }
      savedRef.current = next;
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[14px] font-medium text-ink">Sidfot</p>
        <p className="mt-1 text-[13px] leading-relaxed text-soft">
          Kontakt, tjänster och logotyp hämtas automatiskt. Du kan dölja fält och lägga till vanliga
          sociala länkar.
        </p>
      </div>

      <div className="space-y-2">
        <Toggle
          label="Visa telefon"
          hint={contact.phone || "Saknas i Inställningar"}
          checked={form.showPhone !== false}
          disabled={!contact.phone}
          onChange={(showPhone) => patch({ ...form, showPhone })}
        />
        <Toggle
          label="Visa e-post"
          hint={contact.email || "Saknas i Inställningar"}
          checked={form.showEmail !== false}
          disabled={!contact.email}
          onChange={(showEmail) => patch({ ...form, showEmail })}
        />
        <Toggle
          label="Visa adress"
          hint={address || "Saknas i Inställningar"}
          checked={form.showAddress !== false}
          disabled={!address}
          onChange={(showAddress) => patch({ ...form, showAddress })}
        />
        <Toggle
          label="Visa tjänster"
          hint="Från Tjänster-sektionen"
          checked={form.showServices !== false}
          onChange={(showServices) => patch({ ...form, showServices })}
        />
        <Toggle
          label="Visa logotyp"
          hint={company.logoDataUrl ? "Samma logotyp som i Inställningar" : "Ingen logotyp uppladdad"}
          checked={form.showLogo !== false}
          disabled={!company.logoDataUrl}
          onChange={(showLogo) => patch({ ...form, showLogo })}
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
              onBlur={(e) => patch({ ...form, social: { ...form.social, [network]: e.target.value } })}
              className="w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] focus:border-accent"
            />
          </div>
        ))}
        <p className="text-[12px] leading-relaxed text-muted">
          Vanliga länkar som öppnas i ny flik. Tomt fält döljer ikonen. Ingen feed eller inloggning.
        </p>
      </div>

      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-soft" htmlFor="footer-about">
          Kort om företaget
        </label>
        <textarea
          id="footer-about"
          value={form.aboutText ?? ""}
          onChange={(e) => setForm({ ...form, aboutText: e.target.value })}
          onBlur={(e) => patch({ ...form, aboutText: e.target.value })}
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
      ) : pending ? (
        <p className="text-[12px] text-muted">Sparar …</p>
      ) : null}
    </div>
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
