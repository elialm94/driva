/**
 * Skelett för loading.tsx-gränserna (§ prestandapasset).
 *
 * Syfte: navigering ska ALDRIG kännas ignorerad. Sidoskalet (sidomeny/botten-
 * nav) ligger kvar i layouten; dessa skelett fyller innehållsytan omedelbart
 * medan serverdatat strömmar in. Formen speglar respektive sidas verkliga
 * layout så bytet till riktigt innehåll inte hoppar.
 *
 * Ingen läsbar text – bara pulsande ytor (aria-hidden + busy-status).
 */
import { cx } from "./ui";

function Bone({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-lg bg-ink/6", className)} />;
}

function SkeletonShell({ children }: { children: React.ReactNode }) {
  return (
    <div aria-busy="true" aria-live="polite" className="animate-fade-up">
      <span className="sr-only">Laddar …</span>
      <div aria-hidden>{children}</div>
    </div>
  );
}

/** Sidhuvud: rubrik + underrubrik (+ ev. åtgärdsknappar till höger). */
export function HeaderSkeleton({ actions = 0 }: { actions?: number }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <Bone className="h-8 w-44" />
        <Bone className="mt-2 h-4 w-72 max-w-full" />
      </div>
      {actions > 0 ? (
        <div className="flex gap-2">
          {Array.from({ length: actions }).map((_, i) => (
            <Bone key={i} className="h-11 w-28 rounded-xl" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Fliksrad som i Kunder/Ekonomi. */
export function TabsSkeleton({ tabs = 4 }: { tabs?: number }) {
  return (
    <div className="mb-5 flex gap-1 rounded-2xl bg-ink/4 p-1">
      {Array.from({ length: tabs }).map((_, i) => (
        <Bone key={i} className="h-11 flex-1 rounded-xl bg-ink/5" />
      ))}
    </div>
  );
}

/** Sökfält + filterknapp. */
export function SearchRowSkeleton() {
  return (
    <div className="mb-4 flex gap-2">
      <Bone className="h-11 flex-1 rounded-2xl" />
      <Bone className="h-11 w-24 rounded-xl" />
    </div>
  );
}

/** Tabell-/listkort med n rader. */
export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="card overflow-hidden">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-line/60 px-4 py-3 last:border-0">
          <Bone className="size-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Bone className="h-4 w-1/3 max-w-40" />
            <Bone className="mt-1.5 h-3 w-1/2 max-w-56" />
          </div>
          <Bone className="h-4 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** Registervy: rubrik + flikar + sök + tabell (Kunder/Ekonomi/Inbox). */
export function RegisterSkeleton({
  tabs = 0,
  actions = 2,
  rows = 8,
}: {
  tabs?: number;
  actions?: number;
  rows?: number;
}) {
  return (
    <SkeletonShell>
      <HeaderSkeleton actions={actions} />
      {tabs > 0 ? <TabsSkeleton tabs={tabs} /> : null}
      <SearchRowSkeleton />
      <TableSkeleton rows={rows} />
    </SkeletonShell>
  );
}

/** Detaljsida: tillbaka-rad + rubrik + innehållskort. */
export function DetailSkeleton({ cards = 2 }: { cards?: number }) {
  return (
    <SkeletonShell>
      <Bone className="mb-3 h-4 w-32" />
      <HeaderSkeleton actions={1} />
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="card mb-4 p-5">
          <Bone className="h-4 w-40" />
          <Bone className="mt-3 h-3 w-full max-w-md" />
          <Bone className="mt-2 h-3 w-2/3 max-w-sm" />
          <Bone className="mt-2 h-3 w-1/2 max-w-xs" />
        </div>
      ))}
    </SkeletonShell>
  );
}

/** Hem: hälsning + kommandofält + uppmärksamhetslista. */
export function HomeSkeleton() {
  return (
    <SkeletonShell>
      <Bone className="h-4 w-40" />
      <Bone className="mt-2 h-8 w-56" />
      <Bone className="mt-6 h-12 w-full rounded-2xl" />
      <Bone className="mt-10 h-4 w-64" />
      <div className="mt-3 space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card flex items-center gap-3 px-4 py-3.5">
            <Bone className="size-9 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Bone className="h-4 w-2/5 max-w-64" />
              <Bone className="mt-1.5 h-3 w-3/5 max-w-80" />
            </div>
            <Bone className="h-9 w-24 shrink-0 rounded-xl" />
          </div>
        ))}
      </div>
    </SkeletonShell>
  );
}

/** Översiktssida med statuskort (Bokföring, Samarbeta, Hemsida). */
export function OverviewSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <SkeletonShell>
      <HeaderSkeleton />
      <div className="space-y-4">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="card p-5">
            <div className="flex items-center justify-between gap-4">
              <Bone className="h-5 w-48" />
              <Bone className="h-4 w-20" />
            </div>
            <Bone className="mt-3 h-3 w-full max-w-lg" />
            <Bone className="mt-2 h-3 w-2/3 max-w-md" />
          </div>
        ))}
      </div>
    </SkeletonShell>
  );
}
