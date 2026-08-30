/**
 * Klientsäker Hem-modell för påminnelser.
 *
 * Inga store-/fs-importer – används av Hem-sektionen i webbläsaren.
 * Servern bygger raderna med listHomeReminders() och skickar dem hit.
 */

export type HomeReminderGroup = "overdue" | "today" | "upcoming" | "undated";

export interface HomeReminderItem {
  id: string;
  title: string;
  whenLabel: string;
  group: HomeReminderGroup;
  hasDate: boolean;
  hasExplicitTime: boolean;
  dueAt?: string;
  timezone: string;
}

export function groupHomeReminders(items: HomeReminderItem[]): {
  overdue: HomeReminderItem[];
  today: HomeReminderItem[];
  upcoming: HomeReminderItem[];
  undated: HomeReminderItem[];
} {
  const overdue: HomeReminderItem[] = [];
  const today: HomeReminderItem[] = [];
  const upcoming: HomeReminderItem[] = [];
  const undated: HomeReminderItem[] = [];
  for (const item of items) {
    if (item.group === "overdue") overdue.push(item);
    else if (item.group === "today") today.push(item);
    else if (item.group === "upcoming") upcoming.push(item);
    else undated.push(item);
  }
  return { overdue, today, upcoming, undated };
}
