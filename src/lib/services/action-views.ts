import type { BusinessAction } from "./actions";

/**
 * Två vyer av SAMMA åtgärdsmotor – aldrig två todo-system.
 *
 *   Hem       = prioriterad åtgärdsyta över hela Driva ("Vad behöver jag göra?").
 *               Bokföringsundantag kan grupperas så de inte drunknar andra
 *               domäner. Inga egna rader i en tabell.
 *   Bokföring = komplett bokföringsyta ("Vad händer i bokföringen?").
 *               Alla olösta bokföringsundantag, plus moms/verifikationer.
 *
 * Clas Ohlson-kvittot är EN åtgärd (`receipt-exp-clas`) med ett id, ett
 * snooze-tillstånd och en lösning. Den projiceras till Hem och/eller
 * Bokföring – den dupliceras aldrig.
 */

/** Visa rutinundantag var för sig under tröskeln; därefter EN grupprad på Hem. */
export const ACCOUNTING_GROUP_THRESHOLD = 3;

/** Projektions-id – ingen rad i attention_states förrän någon snoozar den. */
export const ACCOUNTING_EXCEPTIONS_GROUP_ID = "accounting-exceptions-group";

/** Olösta bokföringsfrågor – djuplänk från Hem-gruppen. */
export const BOOKKEEPING_UNRESOLVED_VISA = "olosta";
export const BOOKKEEPING_UNRESOLVED_ANCHOR = "behover-losas";
/** Bara query – AppLink/nav strippar hash och skulle annars koda `#` som `%23`. */
export const BOOKKEEPING_UNRESOLVED_HREF = `/bokforing?visa=${BOOKKEEPING_UNRESOLVED_VISA}`;

/** Sektionsrubrik på Bokföring (CSS gör den till BEHÖVER LÖSAS · N). */
export const BOOKKEEPING_SECTION_TITLE = "Behöver lösas";

/** Sidans ingress – specialistyta, inte en andra uppmärksamhetsinbox. */
export const BOOKKEEPING_PAGE_SUBTITLE =
  "Sköts automatiskt i bakgrunden – du behöver bara svara när något är oklart.";

export function isBookkeepingAction(action: Pick<BusinessAction, "category">): boolean {
  return action.category === "accounting" || action.category === "vat";
}

/** Komplett bokföringskö – alla olösta undantag, ingen gruppering. */
export function bookkeepingQueue(actions: readonly BusinessAction[]): BusinessAction[] {
  return actions.filter(isBookkeepingAction);
}

/**
 * Rutinundantag som fyller Hem när de är många: kvitton, oklar kategori,
 * inkommande underlag, kundförfrågan. Bankmatchning, oförklarad differens
 * och momsdeadline stannar som egna rader (pengar / lagkrav).
 */
export function isGroupableBookkeeping(action: Pick<BusinessAction, "id" | "priority" | "category">): boolean {
  if (!isBookkeepingAction(action)) return false;
  if (action.priority === "urgent") return false;
  const id = action.id;
  if (id === "bank-unexplained" || id.startsWith("bank-") || id.startsWith("vat-")) return false;
  return (
    id.startsWith("receipt-") ||
    id.startsWith("question-") ||
    id.startsWith("inbox-mail-") ||
    id.startsWith("client-request-")
  );
}

export function bookkeepingStatusHeadline(count: number): string {
  if (count === 0) return "Bokföringen är uppdaterad";
  if (count === 1) return "1 bokföringsfråga att lösa";
  return `${count} bokföringsfrågor att lösa`;
}

export function bookkeepingGroupTitle(count: number): string {
  if (count === 1) return "1 bokföringsfråga behöver hanteras";
  return `${count} bokföringsfrågor behöver hanteras`;
}

function groupSubtitle(items: readonly BusinessAction[]): string {
  const labels = items
    .map((a) => {
      if (a.id.startsWith("receipt-")) {
        const m = a.title.match(/^Kvitto saknas –\s*(.+?)(?:,\s|$)/);
        return m?.[1] ?? a.title;
      }
      if (a.id.startsWith("question-")) return a.subtitle.split(" · ")[0] ?? a.title;
      if (a.id.startsWith("inbox-mail-")) return a.title.replace(/^Granska (kvitto|faktura) från /u, "");
      if (a.id.startsWith("client-request-")) return a.subtitle.split(" · ")[0] ?? a.title;
      return a.title;
    })
    .filter(Boolean);
  const shown = labels.slice(0, 3);
  const extra = labels.length - shown.length;
  return extra > 0 ? `${shown.join(" · ")} · +${extra}` : shown.join(" · ");
}

export function bookkeepingGroupAction(items: readonly BusinessAction[]): BusinessAction {
  const count = items.length;
  return {
    id: ACCOUNTING_EXCEPTIONS_GROUP_ID,
    priority: "action",
    category: "accounting",
    icon: "question",
    title: bookkeepingGroupTitle(count),
    subtitle: groupSubtitle(items),
    href: BOOKKEEPING_UNRESOLVED_HREF,
    cta: { type: "link", label: "Öppna bokföring", href: BOOKKEEPING_UNRESOLVED_HREF },
  };
}

/**
 * Hem-projektion: samma åtgärds-id:n som motorn, men rutinmässiga
 * bokföringsundantag slås ihop till EN rad när de är så många att de
 * annars tar upp hela listan. Underliggande rader lever kvar i
 * getBusinessActions() / bookkeepingQueue() / accountantQueue().
 */
export function projectHomeAttention(actions: readonly BusinessAction[]): BusinessAction[] {
  const groupable = actions.filter(isGroupableBookkeeping);
  if (groupable.length < ACCOUNTING_GROUP_THRESHOLD) return [...actions];

  const group = bookkeepingGroupAction(groupable);
  const result: BusinessAction[] = [];
  let inserted = false;
  for (const action of actions) {
    if (isGroupableBookkeeping(action)) {
      if (!inserted) {
        result.push(group);
        inserted = true;
      }
      continue;
    }
    result.push(action);
  }
  if (!inserted) result.push(group);
  return result;
}

export function isBookkeepingUnresolvedVisa(visa: string | undefined): boolean {
  return visa === BOOKKEEPING_UNRESOLVED_VISA;
}
