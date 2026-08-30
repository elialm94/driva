"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  completeReminderAction,
  dismissReminderAction,
  snoozeReminderAction,
  updateReminderAction,
} from "@/app/actions";
import { actionMenuItemClassName, ActionMenu } from "./action-menu";
import { DateTimePopover } from "./date-time-picker";
import { Modal } from "./modal";
import { SnoozeMenu } from "./snooze-menu";
import { buttonClasses, Card, cx, SectionTitle } from "./ui";
import { prettyReminderTitle } from "@/lib/reminders/parse";
import { groupHomeReminders, type HomeReminderGroup, type HomeReminderItem } from "@/lib/services/reminders";

/** Så många rader visas direkt – resten bakom "Visa alla". */
const HOME_REMINDERS_VISIBLE = 3;

const GROUP_LABEL: Record<HomeReminderGroup, string> = {
  overdue: "Försenade",
  today: "Idag",
  upcoming: "Kommande",
  undated: "Utan datum",
};

const COMPACT_ORDER: HomeReminderGroup[] = ["overdue", "today", "upcoming", "undated"];

export function HomeReminders({ items }: { items: HomeReminderItem[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [allOpen, setAllOpen] = useState(false);
  const [editing, setEditing] = useState<HomeReminderItem | null>(null);
  const router = useRouter();

  useEffect(() => {
    setHidden(new Set());
  }, [items]);

  const visible = items.filter((item) => !hidden.has(item.id));
  if (visible.length === 0) return null;

  const grouped = groupHomeReminders(visible);
  const preview = visible.slice(0, HOME_REMINDERS_VISIBLE);
  const previewGrouped = groupHomeReminders(preview);
  const showAllLink = visible.length > HOME_REMINDERS_VISIBLE;

  function hide(id: string) {
    setHidden((prev) => new Set(prev).add(id));
    router.refresh();
  }

  return (
    <div className="mt-10">
      <SectionTitle>Påminnelser</SectionTitle>
      <Card className="divide-y divide-line/70">
        {COMPACT_ORDER.map((group) => {
          const rows = previewGrouped[group];
          if (rows.length === 0) return null;
          return (
            <div key={group}>
              <p className="px-5 pb-1 pt-3 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted">
                {GROUP_LABEL[group]}
              </p>
              {rows.map((item) => (
                <ReminderRow
                  key={item.id}
                  item={item}
                  onHide={() => hide(item.id)}
                  onEdit={() => setEditing(item)}
                />
              ))}
            </div>
          );
        })}
      </Card>
      {showAllLink ? (
        <button
          type="button"
          onClick={() => setAllOpen(true)}
          className="mt-2 min-h-11 text-[13px] font-medium text-soft hover:text-ink"
        >
          Visa alla
        </button>
      ) : null}

      <Modal open={allOpen} onClose={() => setAllOpen(false)} title="Påminnelser" size="sm">
        <div className="divide-y divide-line/70 px-2 py-2">
          {COMPACT_ORDER.map((group) => {
            const rows = grouped[group];
            if (rows.length === 0) return null;
            return (
              <div key={group} className="py-1">
                <p className="px-3 pb-1 pt-2 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted">
                  {GROUP_LABEL[group]}
                </p>
                {rows.map((item) => (
                  <ReminderRow
                    key={item.id}
                    item={item}
                    onHide={() => {
                      hide(item.id);
                      if (visible.length <= 1) setAllOpen(false);
                    }}
                    onEdit={() => {
                      setAllOpen(false);
                      setEditing(item);
                    }}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </Modal>

      {editing ? (
        <EditReminderModal
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function ReminderRow({
  item,
  onHide,
  onEdit,
}: {
  item: HomeReminderItem;
  onHide: () => void;
  onEdit: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="flex items-start gap-3 px-5 py-3 sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium text-ink">{item.title}</p>
        <p className="mt-0.5 text-[13px] text-soft">
          {item.whenLabel}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        <button
          type="button"
          className={cx(buttonClasses("primary", "sm"), "max-lg:min-h-11")}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await completeReminderAction(item.id);
              onHide();
            })
          }
        >
          {pending ? "Sparar …" : "Klar"}
        </button>
        {item.hasDate ? (
          <SnoozeMenu
            presets={[
              { key: "1h" as const, label: "1 timme" },
              { key: "imorgon" as const, label: "Imorgon" },
            ]}
            disabled={pending}
            onPreset={(key) =>
              startTransition(async () => {
                await snoozeReminderAction(item.id, key);
                router.refresh();
              })
            }
            onCustom={(value) =>
              startTransition(async () => {
                await snoozeReminderAction(item.id, value);
                router.refresh();
              })
            }
          />
        ) : (
          <button
            type="button"
            className={cx(buttonClasses("secondary", "sm"), "max-lg:min-h-11")}
            disabled={pending}
            onClick={onEdit}
          >
            Lägg till tid
          </button>
        )}
        <ActionMenu label="Fler åtgärder">
          <button type="button" role="menuitem" className={actionMenuItemClassName()} onClick={onEdit}>
            <Pencil className="size-3.5" /> Redigera
          </button>
          <button
            type="button"
            role="menuitem"
            className={actionMenuItemClassName({ danger: true })}
            onClick={() =>
              startTransition(async () => {
                await dismissReminderAction(item.id);
                onHide();
              })
            }
          >
            <Trash2 className="size-3.5" /> Ta bort
          </button>
        </ActionMenu>
      </div>
    </div>
  );
}

function EditReminderModal({
  item,
  onClose,
  onSaved,
}: {
  item: HomeReminderItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const whenAnchorRef = useRef<HTMLDivElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!item.dueAt) return;
    const local = new Date(item.dueAt);
    const y = local.toLocaleString("sv-SE", { timeZone: item.timezone, year: "numeric" });
    const m = local.toLocaleString("sv-SE", { timeZone: item.timezone, month: "2-digit" });
    const d = local.toLocaleString("sv-SE", { timeZone: item.timezone, day: "2-digit" });
    setDate(`${y}-${m}-${d}`);
    if (item.hasExplicitTime) {
      const hh = local.toLocaleString("sv-SE", { timeZone: item.timezone, hour: "2-digit", hour12: false });
      const mm = local.toLocaleString("sv-SE", { timeZone: item.timezone, minute: "2-digit" });
      setTime(`${hh.padStart(2, "0")}:${mm.padStart(2, "0")}`);
    }
  }, [item]);

  return (
    <Modal
      open
      onClose={onClose}
      title="Redigera påminnelse"
      size="sm"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={buttonClasses("ghost", "sm")} onClick={onClose}>
            Avbryt
          </button>
          <button
            type="button"
            className={buttonClasses("primary", "sm")}
            disabled={pending || !title.trim()}
            onClick={() =>
              startTransition(async () => {
                const result = await updateReminderAction(item.id, {
                  title: prettyReminderTitle(title),
                  ...(date ? { whenDate: date, time: time || undefined } : { clearWhen: true }),
                });
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                onSaved();
              })
            }
          >
            {pending ? "Sparar …" : "Spara"}
          </button>
        </div>
      }
    >
      <div className="space-y-4 px-6 py-4">
        <label className="block text-[13px] font-medium text-soft">
          Text
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 h-11 w-full rounded-xl border border-line bg-card px-3 text-[14.5px] text-ink"
          />
        </label>
        <div>
          <p className="text-[13px] font-medium text-soft">När</p>
          <div ref={whenAnchorRef} className="mt-1 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="min-h-11 rounded-lg bg-canvas px-2.5 py-1.5 text-[13.5px] font-medium text-ink ring-1 ring-line"
            >
              {date || "Ingen tid"}
            </button>
            {date ? (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="min-h-11 rounded-lg bg-canvas px-2.5 py-1.5 text-[13.5px] font-medium tabular text-ink ring-1 ring-line"
              >
                {time || "Ingen tid"}
              </button>
            ) : null}
          </div>
          <DateTimePopover
            date={date}
            time={time}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            anchorRef={whenAnchorRef}
            timeOptional
            allowEmpty
            onChange={(next) => {
              setDate(next.date);
              setTime(next.time);
            }}
          />
        </div>
        {error ? <p className="text-[13px] text-danger">{error}</p> : null}
      </div>
    </Modal>
  );
}
