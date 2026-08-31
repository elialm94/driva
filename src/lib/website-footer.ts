/**
 * Sidfot för Driva-genererade sajter.
 *
 * Kontakt, tjänster och logotyp hämtas live från företagsuppgifter och
 * Tjänster-sektionen. Användaren fyller bara i det som inte redan finns:
 * sociala URL:er, ev. egen kort text, och visa/dölj.
 *
 * Ingen feed, iframe, OAuth eller Meta-API – bara vanliga externa länkar.
 */

import type { CompanySettings, Website, WebsiteFooter, WebsiteFooterSocial, WebsiteSection } from "./types";
import { formatAddressLine, resolveSiteContact } from "./website-contact";
import { controllerName } from "./website-privacy";

export const FOOTER_ABOUT_MAX = 400;
export const FOOTER_SERVICES_MAX = 6;
export const FOOTER_URL_MAX = 240;

export const DEFAULT_WEBSITE_FOOTER: WebsiteFooter = {
  showPhone: true,
  showEmail: true,
  showAddress: true,
  showServices: true,
  showLogo: true,
};

export type WebsiteSocialNetwork = keyof WebsiteFooterSocial;

export const WEBSITE_SOCIAL_NETWORKS = ["instagram", "facebook", "tiktok"] as const satisfies WebsiteSocialNetwork[];

export const SOCIAL_NETWORK_LABELS: Record<WebsiteSocialNetwork, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
};

export interface FooterSocialLink {
  network: WebsiteSocialNetwork;
  label: string;
  href: string;
}

export interface ResolvedWebsiteFooter {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  orgNumber?: string;
  about?: string;
  services: string[];
  social: FooterSocialLink[];
  logoSrc?: string;
  showLogo: boolean;
}

type FooterSource = Pick<Website, "footer" | "draftFooter">;

export function publishedWebsiteFooter(site: FooterSource): WebsiteFooter {
  return normalizeWebsiteFooter(site.footer);
}

export function draftWebsiteFooter(site: FooterSource): WebsiteFooter {
  return site.draftFooter ? normalizeWebsiteFooter(site.draftFooter) : publishedWebsiteFooter(site);
}

export function sameFooter(a: WebsiteFooter, b: WebsiteFooter): boolean {
  return JSON.stringify(normalizeWebsiteFooter(a)) === JSON.stringify(normalizeWebsiteFooter(b));
}

export function normalizeWebsiteFooter(raw?: WebsiteFooter | null): WebsiteFooter {
  const next: WebsiteFooter = {
    showPhone: raw?.showPhone !== false,
    showEmail: raw?.showEmail !== false,
    showAddress: raw?.showAddress !== false,
    showServices: raw?.showServices !== false,
    showLogo: raw?.showLogo !== false,
  };
  const about = (raw?.aboutText ?? "").trim();
  if (about) next.aboutText = about.slice(0, FOOTER_ABOUT_MAX);
  const social = normalizeSocialMap(raw?.social);
  if (social) next.social = social;
  return next;
}

export function assertWebsiteFooter(input: {
  showPhone?: unknown;
  showEmail?: unknown;
  showAddress?: unknown;
  showServices?: unknown;
  showLogo?: unknown;
  aboutText?: unknown;
  social?: unknown;
}): WebsiteFooter {
  const aboutRaw = typeof input.aboutText === "string" ? input.aboutText : "";
  if (aboutRaw.trim().length > FOOTER_ABOUT_MAX) {
    throw new Error("Texten i sidfoten är för lång.");
  }
  return normalizeWebsiteFooter({
    showPhone: input.showPhone !== false,
    showEmail: input.showEmail !== false,
    showAddress: input.showAddress !== false,
    showServices: input.showServices !== false,
    showLogo: input.showLogo !== false,
    aboutText: aboutRaw,
    social: assertSocialMap(input.social),
  });
}

function assertSocialMap(raw: unknown): WebsiteFooterSocial | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "object") throw new Error("Ogiltiga sociala länkar.");
  const src = raw as Record<string, unknown>;
  const next: WebsiteFooterSocial = {};
  for (const network of WEBSITE_SOCIAL_NETWORKS) {
    const value = src[network];
    if (value == null || value === "") continue;
    if (typeof value !== "string") throw new Error(`Ange en giltig ${SOCIAL_NETWORK_LABELS[network]}-länk.`);
    next[network] = assertSocialUrl(value, network);
  }
  return Object.keys(next).length ? next : undefined;
}

function normalizeSocialMap(raw?: WebsiteFooterSocial): WebsiteFooterSocial | undefined {
  if (!raw) return undefined;
  const next: WebsiteFooterSocial = {};
  for (const network of WEBSITE_SOCIAL_NETWORKS) {
    const href = trySocialUrl(raw[network] ?? "");
    if (href) next[network] = href;
  }
  return Object.keys(next).length ? next : undefined;
}

export function assertSocialUrl(raw: string, network: WebsiteSocialNetwork): string {
  const href = trySocialUrl(raw);
  if (!href) {
    throw new Error(`Ange en giltig ${SOCIAL_NETWORK_LABELS[network]}-länk, till exempel https://${exampleHost(network)}/dittforetag.`);
  }
  return href;
}

function exampleHost(network: WebsiteSocialNetwork): string {
  if (network === "instagram") return "instagram.com";
  if (network === "facebook") return "facebook.com";
  return "tiktok.com";
}

/** http(s)-länk. Tomt = ingen länk. Ingen feed, ingen OAuth. */
export function trySocialUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > FOOTER_URL_MAX) return undefined;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (!url.hostname.includes(".")) return undefined;
  return url.toString();
}

export function footerServiceTitles(sections: Pick<WebsiteSection, "type" | "visible" | "items">[]): string[] {
  const section = sections.find((s) => s.type === "tjanster" && s.visible !== false);
  if (!section) return [];
  const titles: string[] = [];
  for (const item of section.items ?? []) {
    const title = item.title.trim();
    if (!title) continue;
    titles.push(title);
    if (titles.length >= FOOTER_SERVICES_MAX) break;
  }
  return titles;
}

function firstSentences(text: string, maxChars: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (cleaned.length <= maxChars) return cleaned;
  const parts = cleaned.split(/(?<=[.!?])\s+/);
  let out = "";
  for (const part of parts) {
    const next = out ? `${out} ${part}` : part;
    if (next.length > maxChars) break;
    out = next;
    if ((out.match(/[.!?]/g) ?? []).length >= 3) break;
  }
  if (out) return out;
  const cut = cleaned.slice(0, maxChars - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > 40 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

export function suggestFooterAbout(input: {
  businessName: string;
  city?: string;
  heroBody?: string;
  aboutBody?: string;
  services: string[];
}): string {
  const about = firstSentences(input.aboutBody ?? "", FOOTER_ABOUT_MAX);
  if (about) return about;
  const hero = firstSentences(input.heroBody ?? "", FOOTER_ABOUT_MAX);
  if (hero) return hero;
  const name = input.businessName.trim() || "Vi";
  const city = (input.city ?? "").trim();
  const services = input.services.slice(0, 3);
  const where = city ? ` i ${city}` : "";
  if (services.length === 0) {
    return `${name} hjälper kunder${where} med hantverk och uppdrag – från första mötet till klart arbete.`;
  }
  if (services.length === 1) {
    return `${name} hjälper kunder${where} med ${services[0].toLowerCase()}.`;
  }
  const last = services[services.length - 1].toLowerCase();
  const head = services
    .slice(0, -1)
    .map((s) => s.toLowerCase())
    .join(", ");
  return `${name} hjälper kunder${where} med ${head} och ${last}.`;
}

export function resolveFooterAbout(
  footer: WebsiteFooter,
  website: Pick<Website, "businessName" | "city" | "sections">,
): string | undefined {
  const custom = footer.aboutText?.trim();
  if (custom) return firstSentences(custom, FOOTER_ABOUT_MAX);
  const sections = website.sections.filter((s) => s.visible !== false);
  const aboutSection = sections.find((s) => s.type === "om" || s.type === "text");
  const hero = sections.find((s) => s.type === "hero");
  const text = suggestFooterAbout({
    businessName: website.businessName,
    city: website.city,
    heroBody: hero?.body,
    aboutBody: aboutSection?.body,
    services: footerServiceTitles(website.sections),
  });
  return text || undefined;
}

export function resolveWebsiteFooter(
  website: Pick<Website, "businessName" | "city" | "sections">,
  company: Pick<
    CompanySettings,
    "name" | "phone" | "email" | "address" | "postalCode" | "city" | "orgNumber" | "logoDataUrl"
  >,
  footer: WebsiteFooter = DEFAULT_WEBSITE_FOOTER,
): ResolvedWebsiteFooter {
  const settings = normalizeWebsiteFooter(footer);
  const contact = resolveSiteContact(company, website);
  const name = controllerName(company, website);
  const services = settings.showServices === false ? [] : footerServiceTitles(website.sections);
  const social: FooterSocialLink[] = [];
  for (const network of WEBSITE_SOCIAL_NETWORKS) {
    const href = settings.social?.[network];
    if (!href) continue;
    social.push({ network, label: SOCIAL_NETWORK_LABELS[network], href });
  }

  const resolved: ResolvedWebsiteFooter = {
    name,
    orgNumber: contact.orgNumber || undefined,
    services,
    social,
    showLogo: settings.showLogo !== false && Boolean(company.logoDataUrl),
    logoSrc: settings.showLogo !== false ? company.logoDataUrl : undefined,
  };
  if (settings.showPhone !== false && contact.phone) resolved.phone = contact.phone;
  if (settings.showEmail !== false && contact.email) resolved.email = contact.email;
  if (settings.showAddress !== false) {
    const address = formatAddressLine(contact);
    if (address) resolved.address = address;
  }
  const about = resolveFooterAbout(settings, website);
  if (about) resolved.about = about;
  return resolved;
}
