import type { ReactNode } from "react";
import {
  SUPPORT_AREAS,
  SUPPORT_AREA_LABEL,
  SUPPORT_LEVEL_LABEL,
  SUPPORT_MATRIX_VERSION,
  entriesByArea,
  type SupportEntry,
  type SupportLevel,
} from "@/lib/support/matrix";
import type { EntryStatus } from "@/lib/support/eligibility";
import { Badge, cx, type BadgeTone } from "./ui";

const LEVEL_TONE: Record<SupportLevel, BadgeTone> = {
  supported: "ok",
  consultant: "info",
  unsupported: "warn",
};

export function SupportLevelBadge({ level, status }: { level: SupportLevel; status?: EntryStatus }) {
  if (status === "approved") return <Badge tone="ok">Godkänt av konsult</Badge>;
  return <Badge tone={LEVEL_TONE[level]}>{SUPPORT_LEVEL_LABEL[level]}</Badge>;
}

/**
 * Hela supportmatrisen, område för område. Servern och hjälpen visar samma
 * lista – det finns ingen separat marknadscopy om vad Ferva stödjer.
 * `statusFor` låter bolagsvyerna visa "Godkänt av konsult" per post och
 * `extra` lägger till åtgärder (konsultens godkännande) under en post.
 */
export function SupportMatrixView({
  statusFor,
  extra,
  showSources = true,
}: {
  statusFor?: (entry: SupportEntry) => EntryStatus;
  extra?: (entry: SupportEntry) => ReactNode;
  showSources?: boolean;
}) {
  return (
    <div className="space-y-8" data-support-matrix={SUPPORT_MATRIX_VERSION}>
      {SUPPORT_AREAS.map((area) => (
        <section key={area} aria-labelledby={`omfattning-${area}`}>
          <h2 id={`omfattning-${area}`} className="text-[15px] font-semibold text-ink">
            {SUPPORT_AREA_LABEL[area]}
          </h2>
          <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-card">
            {entriesByArea(area).map((entry) => {
              const status = statusFor?.(entry);
              return (
                <li key={entry.id} id={entry.id} className="px-4 py-3.5" data-support-entry={entry.id} data-support-level={entry.level}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-[14px] font-medium text-ink">{entry.label}</h3>
                    <SupportLevelBadge level={entry.level} status={status} />
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-soft">{entry.summary}</p>
                  {showSources ? (
                    <dl className={cx("mt-2 grid gap-x-4 gap-y-1 text-[12px] text-muted sm:grid-cols-[auto_1fr]")}>
                      <dt className="font-medium">Så upprätthålls det</dt>
                      <dd>{entry.enforcement}</dd>
                      <dt className="font-medium">Källa</dt>
                      <dd>{entry.source}</dd>
                      <dt className="font-medium">Gäller från</dt>
                      <dd>
                        {entry.effectiveFrom}
                        {entry.effectiveTo ? ` till ${entry.effectiveTo}` : ""} · {entry.owner}
                      </dd>
                    </dl>
                  ) : null}
                  {extra ? extra(entry) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function SupportMatrixLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2 text-[13px] text-soft">
      <li className="flex items-center gap-2">
        <Badge tone="ok">{SUPPORT_LEVEL_LABEL.supported}</Badge> Ferva hanterar fallet med verifierade regler.
      </li>
      <li className="flex items-center gap-2">
        <Badge tone="info">{SUPPORT_LEVEL_LABEL.consultant}</Badge> Får användas när bolagets redovisningskonsult godkänt det i Ferva.
      </li>
      <li className="flex items-center gap-2">
        <Badge tone="warn">{SUPPORT_LEVEL_LABEL.unsupported}</Badge> Servern stoppar fallet tills det är byggt och verifierat.
      </li>
    </ul>
  );
}
