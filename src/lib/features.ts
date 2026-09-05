/**
 * Valfria funktioner i Driva: Hemsida, Samarbeta och Grossistbeställningar.
 *
 * Core-nav (Hem, Kunder, Ekonomi, Inbox, Bokföring) syns alltid.
 * Optional-nav syns bara när funktionen är explicit aktiv. Befintlig
 * användning utan sparad flagga räknas som aktiv (backfill) så inget
 * försvinner. Explicit false vinner över att data finns – Stäng av ≠ Ta bort.
 *
 * Aktivering/avstängning sätter bara flaggan (+ pausar publika sajten /
 * återkallar konsultåtkomst). Ingen hemsida, domän, inbjudan, konsult,
 * grossistanslutning, prisfil eller beställning raderas här.
 */

import type { CollaborationInvitation, DB, Domain, PurchaseOrder, Website, WholesalerConnection } from "./types";
import { db, save } from "./store";
import { LOCAL_JSON_BUSINESS_ID, currentActor } from "./collaboration/actor";
import { activeMembershipsForBusiness, invitationsForBusiness } from "./collaboration/registry";
import { isAccountingRole } from "./collaboration/permissions";
import type { OptionalFeatureId, OptionalFeatures, ResolvedOptionalFeatures } from "./optional-features";

export type { OptionalFeatureId, OptionalFeatures, ResolvedOptionalFeatures } from "./optional-features";
export {
  OPTIONAL_FEATURE_COPY,
  OPTIONAL_FEATURE_HREF,
  OPTIONAL_FEATURE_IDS,
  isOptionalFeatureId,
  optionalFeatureHref,
} from "./optional-features";

export function storedOptionalFeatures(meta: DB["meta"] | undefined): OptionalFeatures {
  const raw = meta?.features;
  if (!raw || typeof raw !== "object") return {};
  const next: OptionalFeatures = {};
  if (raw.website === true) next.website = true;
  else if (raw.website === false) next.website = false;
  if (raw.collaboration === true) next.collaboration = true;
  else if (raw.collaboration === false) next.collaboration = false;
  if (raw.wholesalers === true) next.wholesalers = true;
  else if (raw.wholesalers === false) next.wholesalers = false;
  return next;
}

/**
 * Befintlig grossistanvändning – anslutning eller beställning. Räknas som
 * aktiv utan sparad flagga (backfill) så att ett företag med order aldrig
 * tappar sin historik ur vyn.
 */
export function hasWholesalerUsage(input: {
  wholesalerConnections?: WholesalerConnection[] | null;
  purchaseOrders?: PurchaseOrder[] | null;
}): boolean {
  return (input.wholesalerConnections ?? []).length > 0 || (input.purchaseOrders ?? []).length > 0;
}

/** Befintlig hemsidedata – utkast, publicerad sajt eller kopplad domän. */
export function hasWebsiteUsage(input: {
  website?: Website | null;
  domains?: Domain[] | null;
}): boolean {
  if (input.website) return true;
  return (input.domains ?? []).length > 0;
}

function inviteCountsAsUsage(inv: CollaborationInvitation): boolean {
  return inv.status !== "revoked" && !inv.revokedAt;
}

/** Befintligt samarbete – konsult, pending/skickad inbjudan. */
export function hasCollaborationUsage(
  input: {
    collaborationInvitations?: CollaborationInvitation[] | null;
  },
  businessId: string,
): boolean {
  if ((input.collaborationInvitations ?? []).some(inviteCountsAsUsage)) return true;
  if (invitationsForBusiness(businessId).some(inviteCountsAsUsage)) return true;
  return activeMembershipsForBusiness(businessId).some((m) => isAccountingRole(m.role));
}

export function resolveOwnerBusinessId(explicit?: string): string {
  if (explicit) return explicit;
  const actor = currentActor();
  if (actor?.businessId) return actor.businessId;
  return LOCAL_JSON_BUSINESS_ID;
}

/**
 * Canonical synlighet: explicit false vinner, explicit true vinner,
 * saknad flagga backfillas från användning så befintliga företag inte tappar menyn.
 */
export type OptionalFeatureData = Pick<
  DB,
  "website" | "domains" | "collaborationInvitations" | "meta" | "wholesalerConnections" | "purchaseOrders"
>;

export function resolveOptionalFeatures(
  data: OptionalFeatureData = db(),
  businessId?: string,
): ResolvedOptionalFeatures {
  const stored = storedOptionalFeatures(data.meta);
  const id = resolveOwnerBusinessId(businessId);
  return {
    website: stored.website === false ? false : stored.website === true || hasWebsiteUsage(data),
    collaboration:
      stored.collaboration === false ? false : stored.collaboration === true || hasCollaborationUsage(data, id),
    wholesalers:
      stored.wholesalers === false ? false : stored.wholesalers === true || hasWholesalerUsage(data),
  };
}

/** Är grossistbeställningar på för requestens företag? */
export function wholesalersEnabled(data: OptionalFeatureData = db()): boolean {
  return resolveOptionalFeatures(data).wholesalers;
}

export function isOptionalFeatureExplicitlyDisabled(
  id: OptionalFeatureId,
  data: Pick<DB, "meta"> = db(),
): boolean {
  return storedOptionalFeatures(data.meta)[id] === false;
}

function writeFeatureFlag(id: OptionalFeatureId, value: boolean): void {
  const data = db();
  const current = storedOptionalFeatures(data.meta);
  data.meta = {
    ...data.meta,
    features: { ...current, [id]: value },
  };
}

/**
 * Sätter flaggan. Rör inte hemsida, domän, inbjudningar eller medlemskap.
 * Redan aktiv → no-op. Rensar inte publika sajtens paus – publicera gör det.
 */
export function activateOptionalFeature(id: OptionalFeatureId): ResolvedOptionalFeatures {
  const data = db();
  const current = storedOptionalFeatures(data.meta);
  if (current[id] === true) return resolveOptionalFeatures(data);
  writeFeatureFlag(id, true);
  save();
  return resolveOptionalFeatures(data);
}

/**
 * Stänger av funktionen. Raderar inget. Hemsida: pausar publika sajten
 * utan att ändra website.status (publicerad snapshot ligger kvar).
 * Samarbeta: flaggan sätts här – åtkomst återkallas av anroparen.
 */
export function deactivateOptionalFeature(id: OptionalFeatureId): ResolvedOptionalFeatures {
  const data = db();
  const current = storedOptionalFeatures(data.meta);
  if (current[id] === false) return resolveOptionalFeatures(data);
  writeFeatureFlag(id, false);
  if (id === "website") pauseWebsitePublic();
  save();
  return resolveOptionalFeatures(db());
}

/** Pausar den publika sajten utan att röra innehåll eller publiceringsstatus. */
export function pauseWebsitePublic(): void {
  const data = db();
  if (!data.website) return;
  if (data.meta.websitePausedAt) return;
  data.meta = { ...data.meta, websitePausedAt: new Date().toISOString() };
}

/** Publicering tar bort pausen – sajten blir live igen. */
export function clearWebsitePublicPause(): void {
  const data = db();
  if (!data.meta.websitePausedAt) return;
  const next = { ...data.meta };
  delete next.websitePausedAt;
  data.meta = next;
}

/**
 * Live mot besökare: funktionen på + publicerad + inte pausad.
 * Enabled + utkast/pausad = syns i appen, inte publikt.
 * Disabled = ingen meny + publik sida pausad.
 */
export function isWebsitePubliclyLive(
  data: OptionalFeatureData = db(),
  businessId?: string,
): boolean {
  const site = data.website;
  if (!site || site.status !== "publicerad") return false;
  if (data.meta.websitePausedAt) return false;
  return resolveOptionalFeatures(data, businessId).website;
}

export function websiteRestoreNoticeHref(): string {
  return "/hemsida?aterstalld=1";
}

export function shouldShowWebsiteRestoreNotice(
  data: Pick<DB, "website" | "meta"> = db(),
): boolean {
  return Boolean(data.website && data.meta.websitePausedAt);
}
