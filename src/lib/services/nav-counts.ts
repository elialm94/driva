import { cache } from "react";
import { countInboxBadge } from "./inbox";
import { countBookkeepingBadge, listBookkeepingAttention } from "./actions";

/**
 * App-skalets nav-räknare – EN beräkning per request via React cache().
 *
 * Badge betyder "något här väntar på dig", inte "det finns data här".
 * Bara Bokföring får tal: öppna underlag plus aktiva bokföringsfrågor.
 * Hem är redan den samlade vyn och ska inte ha en summerad badge.
 *
 * Sidomenyn anropar inte listInbox() eller getBusinessActions() – bara
 * de billiga räknarna. Efter server action / router.refresh() byggs
 * layouten om och talen uppdateras utan full sidladdning.
 */
export const getBookkeepingAttention = cache(() => listBookkeepingAttention());

export const getNavAttentionCounts = cache(() => {
  let inbox = 0;
  let bokforing = 0;
  try {
    inbox = countInboxBadge();
  } catch (err) {
    console.error("[nav-counts] inbox:", err instanceof Error ? err.message : err);
  }
  try {
    bokforing = countBookkeepingBadge();
  } catch (err) {
    console.error("[nav-counts] bokforing:", err instanceof Error ? err.message : err);
  }
  return { inbox: 0, bokforing: inbox + bokforing };
});
