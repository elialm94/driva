import { CalendarPlus } from "lucide-react";
import { datumLang, kr } from "@/lib/format";
import { Badge, Card, SectionTitle, buttonClasses, cx } from "./ui";
import {
  authorityKindLabel,
  type AuthorityEvent,
  type AuthorityEventStatus,
} from "@/lib/accounting/skatteverket-calendar";

const STATUS: Record<AuthorityEventStatus, { label: string; tone: "danger" | "warn" | "neutral" | "ok" }> = {
  forfallen: { label: "Förfallen", tone: "danger" },
  snart: { label: "Snart", tone: "warn" },
  kommande: { label: "Kommande", tone: "neutral" },
  klar: { label: "Klar", tone: "ok" },
};

/**
 * Kommande till Skatteverket – moms, AGI, F-skatt, INK2 och årsredovisning
 * i datumordning, med länk till rätt sida och en ICS att lägga i kalendern.
 */
export function SkatteverketCalendar({ events }: { events: AuthorityEvent[] }) {
  if (events.length === 0) return null;
  return (
    <section className="mb-8" data-skv-calendar>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <SectionTitle>Kommande till Skatteverket</SectionTitle>
        <a href="/api/bokforing/kalender" className={buttonClasses("ghost", "sm")}>
          <CalendarPlus className="size-3.5" />
          Lägg i kalendern
        </a>
      </div>
      <Card className="divide-y divide-line/60 px-0 py-0">
        {events.map((e) => (
          <a
            key={e.id}
            href={e.href}
            data-skv-event={e.id}
            data-skv-status={e.status}
            className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5 hover:bg-canvas/60"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[14px] font-semibold">{e.title}</p>
                <Badge tone={STATUS[e.status].tone}>{STATUS[e.status].label}</Badge>
                <span className="text-[11px] text-muted">{authorityKindLabel(e.kind)}</span>
              </div>
              <p className="mt-0.5 text-[13px] text-soft">{e.subtitle}</p>
            </div>
            <div className="text-right">
              <p className={cx("text-[13px] font-medium", e.status === "forfallen" ? "text-danger" : e.status === "snart" ? "text-warn" : "text-ink")}>
                {datumLang(e.dueDate)}
              </p>
              {e.amount != null && e.amount > 0 ? (
                <p className="text-[15px] font-semibold tabular">{kr(e.amount)}</p>
              ) : null}
            </div>
          </a>
        ))}
      </Card>
      <p className="mt-2 text-[12px] text-muted">
        Datum enligt Skatteverkets tabeller. Årsredovisningen lämnas till Bolagsverket. Filen öppnas i
        Kalender, Google eller Outlook.
      </p>
    </section>
  );
}
