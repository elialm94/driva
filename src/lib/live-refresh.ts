/**
 * Live-uppdatering av ägarens vyer när tillståndet ändras UTANFÖR fliken.
 *
 * Problemet (P1 "#115 visar Väntar på godkännande efter kundens godkännande"):
 * servern är konsekvent – demosessionens rad och tenantens state_version
 * verifieras vid varje läsning – men ägarens flik läser inte om av sig själv.
 * App Routern återställer Bakåt/Framåt ur sin klientcache utan någon
 * serverfråga, och en flik som legat öppen medan kunden godkände i en annan
 * flik (eller på en annan enhet) visar det tillstånd den renderades med.
 * revalidatePath i server-actionen når bara fliken som anropade den.
 *
 * Två rena byggstenar (inga DOM-beroenden – testas i node):
 *
 *   * createLiveRefreshGate: avgör om en händelse (flik synlig igen, fönster i
 *     fokus, popstate, bfcache-pageshow, meddelande från annan flik) ska ge
 *     en router.refresh(). Tröskel mellan uppdateringar + kravet att fliken
 *     faktiskt varit borta en stund innan "tillbaka" räknas.
 *   * BroadcastChannel-meddelandet som kundens publika åtgärder skickar så att
 *     ägarens öppna flik i samma webbläsare (demon!) uppdateras direkt – utan
 *     att vänta på fokus eller navigering.
 */

export const LIVE_REFRESH_CHANNEL = "driva-live-refresh";

export type LiveRefreshReason = "visible" | "focus" | "popstate" | "pageshow" | "broadcast";

export type LiveRefreshSource = "quote-accepted" | "quote-declined";

export interface LiveRefreshMessage {
  kind: "data-changed";
  source: LiveRefreshSource;
  at: number;
}

/** Minsta avstånd mellan två uppdateringar – skyddar mot händelsestormar. */
export const LIVE_REFRESH_MIN_INTERVAL_MS = 1500;

/**
 * Så länge måste fliken/fönstret ha varit borta innan återkomsten räknas.
 * Kortare frånvaro är fokusflimmer (adressfält, devtools), inte en återkomst.
 */
export const LIVE_REFRESH_MIN_AWAY_MS = 1000;

export interface LiveRefreshGateOptions {
  minIntervalMs?: number;
  minAwayMs?: number;
}

export interface LiveRefreshGate {
  /** Fliken doldes / fönstret tappade fokus vid `now`. */
  away(now: number): void;
  /**
   * Ska `reason` vid tidpunkten `now` ge en uppdatering? Sant markerar
   * samtidigt att uppdateringen gjordes (tröskeln börjar om).
   */
  shouldRefresh(reason: LiveRefreshReason, now: number): boolean;
}

export function createLiveRefreshGate(opts: LiveRefreshGateOptions = {}): LiveRefreshGate {
  const minIntervalMs = opts.minIntervalMs ?? LIVE_REFRESH_MIN_INTERVAL_MS;
  const minAwayMs = opts.minAwayMs ?? LIVE_REFRESH_MIN_AWAY_MS;
  let lastRefreshAt: number | null = null;
  let awaySince: number | null = null;

  return {
    away(now) {
      awaySince ??= now;
    },
    shouldRefresh(reason, now) {
      if (reason === "visible" || reason === "focus") {
        // Återkomst utan registrerad frånvaro (initial fokus, flimmer) räknas inte.
        const since = awaySince;
        awaySince = null;
        if (since === null || now - since < minAwayMs) return false;
      }
      if (lastRefreshAt !== null && now - lastRefreshAt < minIntervalMs) return false;
      lastRefreshAt = now;
      return true;
    },
  };
}

export function isLiveRefreshMessage(value: unknown): value is LiveRefreshMessage {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<LiveRefreshMessage>;
  return v.kind === "data-changed" && typeof v.source === "string" && typeof v.at === "number";
}

/**
 * Meddela andra flikar i samma webbläsare att tillståndet ändrats. Tyst
 * no-op där BroadcastChannel saknas (äldre webbläsare, SSR).
 */
export function announceLiveRefresh(source: LiveRefreshSource, now = Date.now()): boolean {
  if (typeof BroadcastChannel === "undefined") return false;
  try {
    const channel = new BroadcastChannel(LIVE_REFRESH_CHANNEL);
    const message: LiveRefreshMessage = { kind: "data-changed", source, at: now };
    channel.postMessage(message);
    channel.close();
    return true;
  } catch {
    return false;
  }
}
