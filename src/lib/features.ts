/**
 * Valfria funktioner i Driva: Hemsida och Samarbeta.
 *
 * Core-nav (Hem, Kunder, Ekonomi, Inbox, Bokföring) syns alltid.
 * Optional-nav syns när funktionen är aktiverad ELLER när företaget redan
 * har data – så befintliga användare inte tappar sidomenyn.
 *
 * Aktivering sätter bara en flagga. Ingen hemsida, domän, inbjudan eller
 * konsult raderas eller skapas här.
 */

import type { CollaborationInvitation, DB, Domain, Website } from "./types";
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
  if (raw.collaboration === true) next.collaboration = true;
  return next;
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

export function resolveOptionalFeatures(
  data: Pick<DB, "website" | "domains" | "collaborationInvitations" | "meta"> = db(),
  businessId?: string,
): ResolvedOptionalFeatures {
  const stored = storedOptionalFeatures(data.meta);
  const id = resolveOwnerBusinessId(businessId);
  return {
    website: stored.website === true || hasWebsiteUsage(data),
    collaboration: stored.collaboration === true || hasCollaborationUsage(data, id),
  };
}

/**
 * Sätter flaggan. Rör inte hemsida, domän, inbjudningar eller medlemskap.
 * Redan aktiv → no-op.
 */
export function activateOptionalFeature(id: OptionalFeatureId): ResolvedOptionalFeatures {
  const data = db();
  const current = storedOptionalFeatures(data.meta);
  if (current[id] === true) return resolveOptionalFeatures(data);
  data.meta = {
    ...data.meta,
    features: { ...current, [id]: true },
  };
  save();
  return resolveOptionalFeatures(data);
}
