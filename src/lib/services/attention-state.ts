import { db, save } from "../store";
import { uid } from "../ids";
import { tenantContext } from "../storage/context";
import type { AttentionState } from "../types";
import { DAYPART_TIMES, instantFromLocal, localParts, resolveWhen } from "../reminders/when";
import { businessTimezone } from "./reminders";
import { controlsForAction, type AttentionSnoozeChoice } from "./action-issue";

/**
 * Uppmärksamhetstillstånd: snooze (och HIDE-avfärdan) för åtgärdsmotorns rader.
 *
 * Semantik – presentationspolicy, ALDRIG domänstatus:
 *   * Snooze betyder "visa inte detta under Behöver din uppmärksamhet förrän
 *     X". Fakturan förblir försenad, registret visar fortfarande fakta
 *     ("Försenad 7 dagar") – bara uppmärksamhetslistan/räknaren döljer raden.
 *   * När now ≥ snoozedUntil syns raden automatiskt igen OM motorn
 *     fortfarande härleder den; är saken löst under tiden är den borta.
 *   * Skopning som reminders: rader skrivs med inloggad användares id
 *     (auth.users.id). I JSON-/demoläget utan inloggning är userId null →
 *     tillståndet gäller hela företaget. Vid läsning gäller egna rader plus
 *     företagsgemensamma null-rader.
 *   * Upsert per (actionId, användare) – aldrig dubbletter, aldrig DELETE.
 *
 * Tidsmatten för presets återanvänder reminders/when.ts + businessTimezone()
 * – ingen andra tidsimplementation.
 */

function currentUserId(): string | null {
  return tenantContext()?.userId ?? null;
}

/** Tillstånd som gäller inloggad användare (företagsgemensamma null-rader gäller alla). */
function visibleStates(): AttentionState[] {
  const userId = currentUserId();
  return (db().attentionStates ?? []).filter((s) => s.userId === userId || s.userId === null);
}

/**
 * actionId → dolda rader just nu (aktiv snooze eller HIDE-avfärdan).
 * Motorfiltret i getBusinessActions bygger på denna – snoozade rader är
 * exkluderade ur listan OCH räknaren, överallt (Hem, Bokföring, AI).
 */
export function suppressedActionIds(now = new Date()): Set<string> {
  const result = new Set<string>();
  for (const s of visibleStates()) {
    if (s.dismissedAt) {
      result.add(s.actionId);
    } else if (s.snoozedUntil && Date.parse(s.snoozedUntil) > now.getTime()) {
      result.add(s.actionId);
    }
  }
  return result;
}

/** Aktiv snooze-tidpunkt för en rad (för UI-texter/AI-svar). */
export function snoozedUntilFor(actionId: string, now = new Date()): string | undefined {
  const own = visibleStates().filter((s) => s.actionId === actionId);
  // Egen rad vinner över företagsgemensam null-rad.
  const state = own.find((s) => s.userId !== null) ?? own[0];
  if (!state?.snoozedUntil) return undefined;
  return Date.parse(state.snoozedUntil) > now.getTime() ? state.snoozedUntil : undefined;
}

/** Räkna ut snooze-tidpunkten för ett preset – all policy på ett ställe. */
export function resolveSnoozeUntil(choice: AttentionSnoozeChoice, now = new Date()): Date {
  const tz = businessTimezone();

  if (choice === "senare_idag") {
    // Exakt +3 timmar – "titta på det efter nästa arbetspass".
    return new Date(now.getTime() + 3 * 3_600_000);
  }
  if (choice === "imorgon" || choice === "om_3_dagar") {
    const days = choice === "imorgon" ? 1 : 3;
    const p = localParts(now, tz);
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
    const [hour, minute] = DAYPART_TIMES.morgon.split(":").map(Number);
    return instantFromLocal(
      { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour, minute },
      tz
    );
  }
  if (choice === "nasta_vecka") {
    // Veckodagsregeln i resolveWhen: måndag är alltid nästa veckas måndag.
    const resolved = resolveWhen({ kind: "weekday", weekday: "måndag", daypart: "morgon" }, now, tz);
    if (!resolved.ok) throw new Error(resolved.error);
    return new Date(resolved.value.dueAt);
  }

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(choice.date);
  if (!m) throw new Error("Ogiltigt datum att skjuta upp till.");
  // Valt datum → synlig igen från den lokala dagens start.
  return instantFromLocal(
    { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: 0, minute: 0 },
    tz
  );
}

/** Upsert per (actionId, användare) – null-säkert: null === null i JSON-läget. */
function upsertState(actionId: string, patch: Pick<AttentionState, "snoozedUntil" | "dismissedAt" | "dismissalReason">): AttentionState {
  const data = db();
  data.attentionStates ??= [];
  const userId = currentUserId();
  const now = new Date().toISOString();
  let state = data.attentionStates.find((s) => s.actionId === actionId && s.userId === userId);
  if (state) {
    if (patch.snoozedUntil !== undefined) state.snoozedUntil = patch.snoozedUntil;
    if (patch.dismissedAt !== undefined) state.dismissedAt = patch.dismissedAt;
    if (patch.dismissalReason !== undefined) state.dismissalReason = patch.dismissalReason;
    state.updatedAt = now;
  } else {
    state = { id: uid(), userId, actionId, ...patch, createdAt: now, updatedAt: now };
    data.attentionStates.push(state);
  }
  save();
  return state;
}

function assertSnoozable(actionId: string): void {
  const controls = controlsForAction({ id: actionId });
  if (!controls.canSnooze) {
    throw new Error("Den här raden kan inte snoozas – den ska aldrig tystas.");
  }
}

/** Snooza med preset/datum. Ändrar aldrig domänstatus. */
export function snoozeAttention(actionId: string, choice: AttentionSnoozeChoice, now = new Date()): AttentionState {
  assertSnoozable(actionId);
  const until = resolveSnoozeUntil(choice, now);
  if (until.getTime() <= now.getTime()) throw new Error("Snooze-tidpunkten måste vara framåt.");
  return upsertState(actionId, { snoozedUntil: until.toISOString() });
}

/** Snooza till en exakt tidpunkt (AI-vägen: WhenExpression → resolveWhen → hit). */
export function snoozeAttentionUntil(actionId: string, untilIso: string, now = new Date()): AttentionState {
  assertSnoozable(actionId);
  const until = Date.parse(untilIso);
  if (Number.isNaN(until)) throw new Error("Ogiltig tidpunkt att skjuta upp till.");
  if (until <= now.getTime()) throw new Error("Snooze-tidpunkten måste vara framåt.");
  return upsertState(actionId, { snoozedUntil: new Date(until).toISOString() });
}

/**
 * HIDE-avfärdan – ENDAST för typer som deklarerar dismissBehavior "HIDE"
 * (rent ignorerbara info-rader). Domänavfärdanden ("Markera hanterad",
 * "Inte aktuell") går via sina tjänster och lagras aldrig här.
 */
export function hideAttention(actionId: string, reason?: string, now = new Date()): AttentionState {
  const controls = controlsForAction({ id: actionId });
  if (controls.dismissBehavior !== "HIDE") {
    throw new Error("Den här raden kan inte döljas permanent – använd snooze eller typens egen åtgärd.");
  }
  return upsertState(actionId, { dismissedAt: now.toISOString(), dismissalReason: reason });
}
