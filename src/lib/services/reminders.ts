import { db, save } from "../store";
import { uid } from "../ids";
import { tenantContext } from "../storage/context";
import type { Reminder, ReminderRelatedType } from "../types";
import {
  DAYPART_TIMES,
  DEFAULT_TIMEZONE,
  instantFromLocal,
  localParts,
  resolveWhen,
  startOfLocalDay,
  type WhenExpression,
} from "../reminders/when";
import { customerHref, invoiceHref, jobHref, quoteHref } from "../nav";

/**
 * Påminnelser: domäntjänst med företags- OCH användarskopning.
 *
 * Företagsskopningen kommer från withBusiness-kontexten (db() är redan
 * tenantens tillstånd, RLS vaktar i Supabase-läget). Användarskopningen
 * ligger här: en påminnelse tillhör sin skapare och syns aldrig för andra
 * användare i samma företag. I JSON-demoläget (ingen inloggning) är
 * userId null för alla – då ses allt.
 */

/**
 * DEN centrala tidszonshjälpen: företagets/användarens tidszon med svensk
 * standard. När en tidszonsinställning införs på företaget är detta enda
 * stället att läsa den på – strängen sprids aldrig i komponenter.
 */
export function businessTimezone(): string {
  return DEFAULT_TIMEZONE;
}

function currentUserId(): string | null {
  return tenantContext()?.userId ?? null;
}

/** Påminnelser som tillhör inloggad användare (eller alla i JSON-demoläget). */
export function ownedReminders(): Reminder[] {
  const userId = currentUserId();
  return (db().reminders ?? []).filter((r) => r.userId === userId || r.userId === null);
}

export type CreateReminderInput = {
  title: string;
  description?: string;
  when: WhenExpression;
  source?: Reminder["source"];
  related?: { type: ReminderRelatedType; id: string };
};

export type ReminderResult = { ok: true; reminder: Reminder } | { ok: false; error: string };

export function createReminder(input: CreateReminderInput, now = new Date()): ReminderResult {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Påminnelsen behöver en beskrivning av vad som ska göras." };
  const timezone = businessTimezone();
  const resolved = resolveWhen(input.when, now, timezone);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const reminder: Reminder = {
    id: uid(),
    userId: currentUserId(),
    title,
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    dueAt: resolved.value.dueAt,
    timezone: resolved.value.timezone,
    hasExplicitTime: resolved.value.hasExplicitTime,
    status: "PENDING",
    source: input.source ?? "assistant",
    ...(input.related ? { relatedEntityType: input.related.type, relatedEntityId: input.related.id } : {}),
    createdAt: now.toISOString(),
  };
  db().reminders.push(reminder);
  save();
  return { ok: true, reminder };
}

export function listReminders(opts: { includeDone?: boolean } = {}): Reminder[] {
  return ownedReminders()
    .filter((r) => (opts.includeDone ? r.status !== "DISMISSED" : r.status === "PENDING"))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

/** Fritextsökning bland aktiva påminnelser (för "flytta påminnelsen om Göran"). */
export function searchReminders(query: string): Reminder[] {
  const q = query.trim().toLowerCase();
  const pending = listReminders();
  if (!q) return pending;
  return pending.filter(
    (r) => r.title.toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q)
  );
}

function requireOwned(id: string): Reminder {
  const reminder = ownedReminders().find((r) => r.id === id);
  if (!reminder) throw new Error("Påminnelsen finns inte.");
  return reminder;
}

export function updateReminder(
  id: string,
  patch: { title?: string; description?: string; when?: WhenExpression },
  now = new Date()
): ReminderResult {
  const reminder = requireOwned(id);
  if (reminder.status !== "PENDING") return { ok: false, error: "Påminnelsen är redan avklarad." };
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) return { ok: false, error: "Titeln kan inte vara tom." };
    reminder.title = title;
  }
  if (patch.description !== undefined) {
    if (patch.description.trim()) reminder.description = patch.description.trim();
    else delete reminder.description;
  }
  if (patch.when) {
    const resolved = resolveWhen(patch.when, now, reminder.timezone);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    reminder.dueAt = resolved.value.dueAt;
    reminder.hasExplicitTime = resolved.value.hasExplicitTime;
    delete reminder.snoozedUntil;
  }
  save();
  return { ok: true, reminder };
}

export function completeReminder(id: string, now = new Date()): Reminder {
  const reminder = requireOwned(id);
  reminder.status = "COMPLETED";
  reminder.completedAt = now.toISOString();
  save();
  return reminder;
}

/** Ångra Klar: tillbaka till PENDING så raden syns i uppmärksamhet igen. */
export function reopenReminder(id: string): Reminder {
  const reminder = requireOwned(id);
  if (reminder.status !== "COMPLETED") throw new Error("Påminnelsen är inte markerad som klar.");
  reminder.status = "PENDING";
  delete reminder.completedAt;
  save();
  return reminder;
}

export type SnoozeChoice = "1h" | "imorgon" | { date: string };

export type SnoozeResult = {
  reminder: Reminder;
  previousSnoozedUntil?: string;
};

/**
 * Snabbval för Snooza-knappen: 1 timme (exakt), imorgon (morgon-dagsdelen)
 * eller valfritt datum (behåller påminnelsens ursprungliga klockslag).
 */
export function snoozeReminderBy(id: string, choice: SnoozeChoice, now = new Date()): SnoozeResult {
  const reminder = requireOwned(id);
  const previousSnoozedUntil = reminder.snoozedUntil;
  const tz = reminder.timezone;
  let until: Date;
  if (choice === "1h") {
    until = new Date(now.getTime() + 3_600_000);
  } else if (choice === "imorgon") {
    const p = localParts(now, tz);
    const clock = DAYPART_TIMES.morgon.split(":").map(Number);
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
    until = instantFromLocal(
      { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: clock[0], minute: clock[1] },
      tz
    );
  } else {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(choice.date);
    if (!m) throw new Error("Ogiltigt datum.");
    const due = localParts(new Date(reminder.dueAt), tz);
    until = instantFromLocal(
      { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: due.hour, minute: due.minute },
      tz
    );
  }
  const updated = snoozeReminder(id, until.toISOString());
  return previousSnoozedUntil ? { reminder: updated, previousSnoozedUntil } : { reminder: updated };
}

export function snoozeReminder(id: string, untilIso: string): Reminder {
  const reminder = requireOwned(id);
  if (Number.isNaN(Date.parse(untilIso))) throw new Error("Ogiltig tidpunkt att skjuta upp till.");
  reminder.snoozedUntil = new Date(untilIso).toISOString();
  save();
  return reminder;
}

/**
 * Ångra Snooza: återställ föregående snooze, eller ta bort den så förra
 * schemat (dueAt) gäller igen.
 */
export function unsnoozeReminder(id: string, previousSnoozedUntil?: string | null): Reminder {
  const reminder = requireOwned(id);
  if (previousSnoozedUntil) {
    if (Number.isNaN(Date.parse(previousSnoozedUntil))) throw new Error("Ogiltig tidpunkt att återställa.");
    reminder.snoozedUntil = new Date(previousSnoozedUntil).toISOString();
  } else {
    delete reminder.snoozedUntil;
  }
  save();
  return reminder;
}

/**
 * Mjuk borttagning – historiken bevaras, raden försvinner ur alla listor.
 * Inte en kundåtgärd i UI:t (Klar är enda sättet att avsluta). Behålls för
 * admin, dataradering och kommandofältets ångra-efter-skapande.
 */
export function dismissReminder(id: string): Reminder {
  const reminder = requireOwned(id);
  reminder.status = "DISMISSED";
  save();
  return reminder;
}

/* ------------------------- Uppmärksamhetspolicy (härledd) ------------------------- */

/**
 * När blir påminnelsen synlig i "Behöver din uppmärksamhet"?
 *  - Klockslag/dagsdel angiven → från dueAt.
 *  - Dagsnivå (ingen tid angiven) → från den lokala dagens start.
 *  - Uppskjuten → tidigast snoozedUntil.
 */
export function reminderVisibleFrom(reminder: Reminder): Date {
  const due = new Date(reminder.dueAt);
  const base = reminder.hasExplicitTime ? due : startOfLocalDay(due, reminder.timezone);
  if (reminder.snoozedUntil) {
    const snooze = new Date(reminder.snoozedUntil);
    if (snooze.getTime() > base.getTime()) return snooze;
  }
  return base;
}

/** Lokal kalenderdag (YYYY-MM-DD) för en tidpunkt i påminnelsens tidszon. */
export function reminderLocalDate(reminder: Reminder): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: reminder.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(reminder.dueAt));
}

/**
 * Mänsklig beskrivning av tidpunkten i påminnelsens LOKALA tid, inklusive
 * försening: "Skulle gjorts igår kl 10:00" / "Idag kl 14:00" / "onsdag 2 september kl 10:00".
 */
export function describeReminderDue(reminder: Reminder, now = new Date()): { overdue: boolean; text: string } {
  const due = new Date(reminder.dueAt);
  const tz = reminder.timezone;
  const overdue = due.getTime() < now.getTime();
  const dayDiff = Math.round(
    (startOfLocalDay(due, tz).getTime() - startOfLocalDay(now, tz).getTime()) / 86_400_000
  );
  const time = new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(due);
  const day =
    dayDiff === 0
      ? "idag"
      : dayDiff === 1
        ? "imorgon"
        : dayDiff === -1
          ? "igår"
          : dayDiff === -2
            ? "i förrgår"
            : new Intl.DateTimeFormat("sv-SE", {
                timeZone: tz,
                weekday: "long",
                day: "numeric",
                month: "long",
              }).format(due);
  if (overdue) {
    return { overdue, text: `Försenad – skulle gjorts ${day} kl ${time}` };
  }
  const capitalized = day.charAt(0).toUpperCase() + day.slice(1);
  return { overdue, text: `${capitalized} kl ${time}` };
}

/**
 * Mänsklig snooze-tid för Ångra-raden: "imorgon kl. 09:00", "idag kl. 10:55".
 * Egen sträng – rör inte Hem-etiketterna i describeReminderDue.
 */
export function describeSnoozeUntil(untilIso: string, timezone: string, now = new Date()): string {
  const until = new Date(untilIso);
  const dayDiff = Math.round(
    (startOfLocalDay(until, timezone).getTime() - startOfLocalDay(now, timezone).getTime()) / 86_400_000
  );
  const time = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(until);
  const day =
    dayDiff === 0
      ? "idag"
      : dayDiff === 1
        ? "imorgon"
        : new Intl.DateTimeFormat("sv-SE", {
            timeZone: timezone,
            weekday: "long",
            day: "numeric",
            month: "long",
          }).format(until);
  return `${day} kl. ${time}`;
}

/** Djuplänk till kopplad entitet – annars Hem. */
export function reminderTargetHref(reminder: Reminder): string {
  switch (reminder.relatedEntityType) {
    case "customer":
      return customerHref(reminder.relatedEntityId!);
    case "quote":
      return quoteHref(reminder.relatedEntityId!);
    case "invoice":
      return invoiceHref(reminder.relatedEntityId!);
    case "job":
      return jobHref(reminder.relatedEntityId!);
    default:
      return "/";
  }
}
