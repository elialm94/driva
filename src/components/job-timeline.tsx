"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Banknote,
  Camera,
  CheckCircle2,
  Clock,
  FileText,
  Flag,
  Inbox,
  Package,
  PenLine,
  Play,
  ReceiptText,
  RotateCcw,
  Share2,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { TIMELINE_FILTERS, type TimelineCategory, type TimelineEntry, type TimelineIcon } from "@/lib/job-timeline-types";
import { datumLang, datumTid } from "@/lib/format";
import { SectionTitle, cx } from "./ui";

const ICONS: Record<TimelineIcon, LucideIcon> = {
  forfragan: Inbox,
  offert: FileText,
  andring: PenLine,
  kund: UserRound,
  start: Play,
  tid: Clock,
  material: Package,
  foto: Camera,
  rapport: PenLine,
  faktura: ReceiptText,
  betalning: Banknote,
  kredit: RotateCcw,
  beslut: CheckCircle2,
  flagga: Flag,
  delning: Share2,
};

const CATEGORY_TONE: Record<TimelineCategory, string> = {
  kund: "bg-accent-soft text-accent",
  arbete: "bg-canvas text-soft",
  ekonomi: "bg-ok-soft text-ok",
};

/** Nyast först, filtrerbar. Servern har redan tagit fram posterna. */
export function JobTimeline({ entries, initialLimit = 8 }: { entries: TimelineEntry[]; initialLimit?: number }) {
  const [filter, setFilter] = useState<"alla" | TimelineCategory>("alla");
  const [expanded, setExpanded] = useState(false);
  const visible = entries.filter((e) => filter === "alla" || e.category === filter);
  const shown = expanded ? visible : visible.slice(0, initialLimit);

  return (
    <section className="mb-8" aria-labelledby="tidslinje-rubrik" data-testid="job-timeline">
      <SectionTitle
        right={
          <div role="tablist" aria-label="Filtrera tidslinjen" className="flex flex-wrap gap-1">
            {TIMELINE_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                data-testid={`timeline-filter-${f.key}`}
                className={cx(
                  "rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors",
                  filter === f.key ? "bg-ink text-white" : "text-muted hover:bg-canvas hover:text-ink"
                )}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        }
      >
        <span id="tidslinje-rubrik">Tidslinje</span>
      </SectionTitle>

      {shown.length === 0 ? (
        <p className="text-[14px] text-soft">Inget att visa här än.</p>
      ) : (
        <ol className="relative ml-3 border-l border-line/80 pl-6">
          {shown.map((e) => {
            const Icon = ICONS[e.icon];
            const body = (
              <>
                <p className="text-[14px] font-medium text-ink">
                  {e.title}
                  {e.byCustomer ? <span className="ml-2 rounded-full bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">Kunden</span> : null}
                </p>
                {e.detail ? <p className="text-[12.5px] text-muted">{e.detail}</p> : null}
                <p className="mt-0.5 text-[12px] tabular text-muted">{e.dayOnly ? datumLang(e.at) : datumTid(e.at)}</p>
              </>
            );
            return (
              <li key={e.id} className="relative pb-5 last:pb-0" data-testid="timeline-entry" data-category={e.category}>
                <span className={cx("absolute -left-[37px] top-0 flex size-6 items-center justify-center rounded-full ring-4 ring-card", CATEGORY_TONE[e.category])}>
                  <Icon className="size-3.5" />
                </span>
                {e.href ? (
                  <Link href={e.href as never} className="block rounded-lg -mx-2 px-2 py-0.5 transition-colors hover:bg-canvas/70">
                    {body}
                  </Link>
                ) : (
                  <div className="py-0.5">{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {visible.length > initialLimit ? (
        <button type="button" className="mt-3 text-[13px] font-medium text-soft hover:text-ink" onClick={() => setExpanded((v) => !v)} data-testid="timeline-toggle">
          {expanded ? "Visa färre" : `Visa alla ${visible.length}`}
        </button>
      ) : null}
    </section>
  );
}
