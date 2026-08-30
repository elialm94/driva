import { cache } from "react";
import { countInboxBadge } from "./inbox";
import { countBookkeepingBadge, listBookkeepingAttention } from "./actions";

/**
 * App-skalets nav-räknare – EN beräkning per request via React cache().
 *
 * Badge betyder "något här väntar på dig", inte "det finns data här".
 * Bara Inbox och Bokföring får tal. Hem är redan den samlade vyn och
 * ska inte ha en summerad badge. Kunder/Ekonomi/Samarbeta/Hemsida
 * räknar inte poster.
 *
 *   Inbox     – inkommande dokument användaren ska hantera nu
 *               (countsTowardInboxBadge / countInboxBadge)
 *   Bokföring – aktiva bokföringsfrågor att lösa
 *               (countsTowardBookkeepingBadge / countBookkeepingBadge)
 *
 * Sidomenyn anropar inte listInbox() eller getBusinessActions() – bara
 * de billiga räknarna. Efter server action / router.refresh() byggs
 * layouten om och talen uppdateras utan full sidladdning.
 */
export const getBookkeepingAttention = cache(() => listBookkeepingAttention());

export const getNavAttentionCounts = cache(() => ({
  inbox: countInboxBadge(),
  bokforing: countBookkeepingBadge(),
}));
