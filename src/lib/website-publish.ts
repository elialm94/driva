/**
 * Publicering av hemsidan: klientens synliga redigerarläge skickas med
 * i anropet och skrivs + publiceras i samma commit. Revisioner gör att
 * en sen autosave efter publicering inte kan skapa ett nytt utkast.
 */
import type {
  PrivacyPolicyState,
  Website,
  WebsiteCtaDestination,
  WebsiteDesign,
  WebsiteFooter,
  WebsiteImagePosition,
} from "./types";

export interface WebsiteWriteMeta {
  /** Klientens redigeringsrevision vid just den här skrivningen. */
  clientRevision?: number;
}

export interface WebsiteSectionPublishUpdate {
  id: string;
  heading?: string;
  body?: string;
  image?: string | null;
  imagePosition?: WebsiteImagePosition | null;
  primaryCtaLabel?: string;
  hours?: string | null;
  ctaDestination?: WebsiteCtaDestination;
  ctaLabel?: string;
}

export interface WebsitePublishInput {
  /**
   * Revisionen som var synlig när användaren klickade Publicera.
   * En äldre revision än `publishedRevision` avvisas.
   */
  revision: number;
  design?: WebsiteDesign;
  footer?: WebsiteFooter;
  privacyPolicy?: PrivacyPolicyState;
  sectionOrder?: string[];
  sectionVisibility?: { id: string; visible: boolean }[];
  sectionUpdates?: WebsiteSectionPublishUpdate[];
  primaryCtaLabel?: string;
}

export interface WebsitePublishResult {
  publishedRevision: number;
  publishedAt: string;
  design: WebsiteDesign;
  footer: WebsiteFooter;
  privacy: PrivacyPolicyState;
  sectionOrder: string[];
  hasUnpublishedDrafts: boolean;
}

export function websiteDraftRevision(site: Pick<Website, "draftRevision">): number {
  return site.draftRevision ?? 0;
}

export function websitePublishedRevision(site: Pick<Website, "publishedRevision">): number {
  return site.publishedRevision ?? 0;
}

/**
 * En skrivning med lägre eller samma revision som redan publicerats (eller
 * äldre än senaste utkastet) ska ignoreras – annars kan en sen save efter
 * publicering göra redigeraren smutsig igen.
 */
export function isStaleWebsiteWrite(
  site: Pick<Website, "draftRevision" | "publishedRevision">,
  clientRevision?: number,
): boolean {
  if (clientRevision == null || !Number.isFinite(clientRevision)) return false;
  if (clientRevision <= websitePublishedRevision(site)) return true;
  if (clientRevision < websiteDraftRevision(site)) return true;
  return false;
}

/** Acceptera skrivningen och flytta fram `draftRevision` när klienten skickar en. */
export function acceptWebsiteWrite(
  site: Pick<Website, "draftRevision" | "publishedRevision">,
  clientRevision?: number,
): boolean {
  if (isStaleWebsiteWrite(site, clientRevision)) return false;
  if (clientRevision != null && Number.isFinite(clientRevision)) {
    site.draftRevision = Math.max(websiteDraftRevision(site), clientRevision);
  }
  return true;
}
