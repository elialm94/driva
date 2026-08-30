"use client";

import { useEffect, useState, useTransition } from "react";
import { AppLink, useAppNavigate } from "./app-link";
import { Check, ExternalLink, Globe, Search } from "lucide-react";
import { Badge, Card, DemoTag, buttonClasses, cx } from "./ui";
import { FieldError, focusField, invalidFieldCls } from "./form-validation";
import { kr } from "@/lib/format";
import { SETTINGS_HREF } from "@/lib/settings-routes";
import { withReturnTo } from "@/lib/nav";
import type { SearchResult } from "@/lib/domains/availability";
import type { DomainCardView, DomainProgressStep } from "@/lib/domains/view";
import {
  pollDomainAction,
  purchaseDomainAction,
  retryDomainAction,
  searchDomainAction,
  setAutoRenewAction,
  startExistingDomainAction,
  verifyExistingDomainAction,
} from "@/app/domain-actions";

const COMPLETE_COMPANY_HREF = withReturnTo(SETTINGS_HREF.foretag, "/hemsida/doman", "Domän");

export function DomainSearchPanel({
  demo,
  companyName,
  orgNumber,
  email,
  initialView,
  missingProfile,
}: {
  demo: boolean;
  companyName: string;
  orgNumber: string;
  email: string;
  initialView: DomainCardView | null;
  missingProfile: boolean;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<SearchResult | null>(null);
  const [view, setView] = useState<DomainCardView | null>(initialView);
  const [existingOpen, setExistingOpen] = useState(false);
  const [searching, startSearch] = useTransition();

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  function onSearch(q = query) {
    if (!q.trim()) {
      setFieldError("Ange en adress att söka");
      setError(null);
      setResult(null);
      focusField("doman-sok");
      return;
    }
    setFieldError(null);
    setError(null);
    setResult(null);
    setConfirming(null);
    startSearch(async () => {
      const res = await searchDomainAction(q);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult(res.result);
    });
  }

  if (missingProfile && !view) {
    return <MissingProfileCard />;
  }

  if (view && view.source === "existing" && !view.live) {
    return <ExistingPendingCard view={view} demo={demo} onChange={setView} />;
  }

  if (view) {
    return (
      <div className="space-y-5">
        <ManagedDomainCard view={view} onChange={setView} demo={demo} />
        {view.source === "purchased" ? (
          <ManageRenewal view={view} onChange={setView} companyName={companyName} />
        ) : null}
      </div>
    );
  }

  if (existingOpen) {
    return (
      <ExistingDomainForm
        demo={demo}
        onBack={() => setExistingOpen(false)}
        onConnected={(next) => {
          setExistingOpen(false);
          setView(next);
        }}
      />
    );
  }

  if (confirming) {
    return (
      <PurchaseConfirm
        result={confirming}
        companyName={companyName}
        orgNumber={orgNumber}
        email={email}
        demo={demo}
        onCancel={() => setConfirming(null)}
        onPurchased={(next) => {
          setConfirming(null);
          setResult(null);
          setView(next);
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      <Card className="px-5 py-5 sm:px-6">
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-start"
          onSubmit={(e) => {
            e.preventDefault();
            onSearch();
          }}
        >
          <div className="min-w-0 flex-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input
                id="doman-sok"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (fieldError) setFieldError(null);
                }}
                placeholder="sodermalmssnickeri"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? "doman-sok-fel" : undefined}
                className={cx(
                  "h-12 w-full rounded-xl border border-line-strong bg-card pl-10 pr-16 text-[15px] text-ink placeholder:text-muted focus:border-accent",
                  fieldError && invalidFieldCls,
                )}
                aria-label="Sök .se-adress"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] font-medium text-muted">
                .se
              </span>
            </div>
            <FieldError id="doman-sok-fel">{fieldError}</FieldError>
          </div>
          <button type="submit" className={cx(buttonClasses("primary", "lg"), "w-full sm:w-auto")} disabled={searching}>
            {searching ? "Söker …" : "Sök"}
          </button>
        </form>
        {demo ? (
          <p className="mt-3 flex items-center gap-2 text-[12px] text-muted">
            <DemoTag>DEMO</DemoTag>
            Ingen riktig .se-adress köps.
          </p>
        ) : null}
        {error ? <p className="mt-3 text-[14px] font-medium text-danger">{error}</p> : null}
      </Card>

      {result ? (
        <SearchOutcome result={result} onSelect={(hostname) => onSearch(hostname)} onBuy={() => setConfirming(result)} />
      ) : null}

      <button
        type="button"
        className="text-[14px] font-medium text-soft underline-offset-2 hover:text-ink hover:underline"
        onClick={() => setExistingOpen(true)}
      >
        Har du redan en domän? Anslut befintlig
      </button>
    </div>
  );
}

function MissingProfileCard() {
  return (
    <Card className="px-5 py-6 sm:px-6">
      <p className="text-[17px] font-semibold tracking-tight">En uppgift saknas innan domänen kan registreras</p>
      <p className="mt-2 text-[14px] leading-relaxed text-soft">
        Adressen registreras på ditt företag. Komplettera uppgifterna så tar vi vid där du var.
      </p>
      <AppLink href={COMPLETE_COMPANY_HREF} className={cx(buttonClasses("primary"), "mt-5")}>
        Komplettera företagsuppgifter
      </AppLink>
    </Card>
  );
}

function SearchOutcome({
  result,
  onSelect,
  onBuy,
}: {
  result: SearchResult;
  onSelect: (hostname: string) => void;
  onBuy: () => void;
}) {
  if (result.available) {
    return (
      <Card className="px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[16px] font-semibold text-ink">{result.hostname}</p>
            <p className="mt-1 flex items-center gap-2 text-[14px] text-ok">
              <Badge tone="ok">Ledig</Badge>
              {result.price ? <span>{kr(result.price.customerPrice)}/år</span> : null}
            </p>
          </div>
          <button type="button" className={cx(buttonClasses("accent"), "w-full sm:w-auto")} onClick={onBuy}>
            Skaffa domän
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="px-5 py-5 sm:px-6">
      <p className="font-mono text-[16px] font-semibold text-ink">{result.hostname}</p>
      <p className="mt-1">
        <Badge tone="neutral">Upptagen</Badge>
      </p>
      {result.alternatives.length ? (
        <div className="mt-4 space-y-2">
          <p className="text-[13px] font-medium text-muted">Liknande adresser</p>
          {result.alternatives.map((alt) => (
            <button
              key={alt}
              type="button"
              className="flex w-full items-center justify-between rounded-xl border border-line px-3.5 py-2.5 text-left text-[14px] hover:border-line-strong"
              onClick={() => onSelect(alt)}
            >
              <span className="font-mono">{alt}</span>
              <span className="text-[13px] font-medium text-accent">Sök</span>
            </button>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

function PurchaseConfirm({
  result,
  companyName,
  orgNumber,
  email,
  demo,
  onCancel,
  onPurchased,
}: {
  result: SearchResult;
  companyName: string;
  orgNumber: string;
  email: string;
  demo: boolean;
  onCancel: () => void;
  onPurchased: (view: DomainCardView) => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  return (
    <Card className="px-5 py-6 sm:px-6">
      <p className="text-[17px] font-semibold tracking-tight">Köp {result.hostname}</p>
      {demo ? (
        <p className="mt-2">
          <DemoTag>DEMO</DemoTag>
        </p>
      ) : null}
      <dl className="mt-4 space-y-2 text-[14px]">
        <Row label="Registreras på" value={`${companyName} · ${orgNumber}`} />
        <Row label="Kontakt" value={email} />
        <Row label="Pris" value={result.price ? `${kr(result.price.customerPrice)}/år` : "–"} />
        <Row label="Förnyelse" value="Förnyas automatiskt varje år" />
      </dl>
      {error ? <p className="mt-3 text-[14px] font-medium text-danger">{error}</p> : null}
      {missing ? (
        <AppLink href={COMPLETE_COMPANY_HREF} className={cx(buttonClasses("primary"), "mt-4")}>
          Komplettera företagsuppgifter
        </AppLink>
      ) : (
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={buttonClasses("ghost")} onClick={onCancel} disabled={pending}>
            Avbryt
          </button>
          <button
            type="button"
            className={buttonClasses("accent")}
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await purchaseDomainAction(result.hostname);
                if (!res.ok) {
                  setError(res.error);
                  setMissing(Boolean(res.missingProfile));
                  return;
                }
                onPurchased(res.view);
              })
            }
          >
            {pending ? "Köper …" : "Köp och koppla"}
          </button>
        </div>
      )}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-b border-line py-2 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}

function ManagedDomainCard({
  view,
  onChange,
  demo,
}: {
  view: DomainCardView;
  onChange: (view: DomainCardView) => void;
  demo: boolean;
}) {
  const live = view.live;

  useEffect(() => {
    if (live || view.phase === "failed") return;
    if (view.source === "existing") return;
    let cancelled = false;
    const tick = async () => {
      const res = await pollDomainAction(view.id);
      if (!cancelled && res.ok) onChange(res.view);
    };
    const id = setInterval(() => void tick(), 900);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [view.id, live, view.phase, view.source, onChange]);

  return (
    <Card className="px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-mono text-[16px] font-semibold">
            {view.hostname}
            {demo ? <DemoTag>DEMO</DemoTag> : null}
          </p>
          {live ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-[14px] font-medium text-ok">
              <Check className="size-4" /> Igång
            </p>
          ) : (
            <p className="mt-1.5 text-[13px] text-soft">Vi kopplar adressen till din hemsida.</p>
          )}
        </div>
        {live ? (
          <div className="flex gap-2">
            <a
              href={demo ? `/sajt?host=${encodeURIComponent(view.hostname)}` : `https://${view.hostname}`}
              target="_blank"
              rel="noreferrer"
              className={buttonClasses("secondary", "sm")}
            >
              <ExternalLink className="size-3.5" /> Öppna
            </a>
          </div>
        ) : null}
      </div>

      {!live ? <ProgressList steps={view.steps} /> : null}

      {view.errorMessage && view.phase === "failed" ? (
        <div className="mt-4 rounded-xl bg-danger-soft px-3.5 py-3 text-[14px] text-danger">
          <p>{view.errorMessage}</p>
          {view.canRetry ? (
            <RetryButton domainId={view.id} hostingOnly={view.retryIsHostingOnly} onChange={onChange} />
          ) : null}
        </div>
      ) : null}

      {view.renewalFailed ? (
        <p className="mt-4 rounded-xl bg-warn-soft px-3.5 py-3 text-[14px] text-warn">
          Förnyelsen kunde inte betalas. <span className="font-medium">Uppdatera betalning</span>
        </p>
      ) : null}
    </Card>
  );
}

function ProgressList({ steps }: { steps: DomainProgressStep[] }) {
  return (
    <ol className="mt-5 space-y-2.5">
      {steps.map((step) => (
        <li key={step.key} className="flex items-center gap-2.5 text-[14px]">
          <span
            className={cx(
              "flex size-5 items-center justify-center rounded-full text-[11px] font-semibold",
              step.done ? "bg-ok text-white" : step.current ? "bg-accent text-white" : "bg-ink/8 text-muted",
            )}
          >
            {step.done ? "✓" : ""}
          </span>
          <span className={step.done || step.current ? "text-ink" : "text-muted"}>{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

function RetryButton({
  domainId,
  hostingOnly,
  onChange,
}: {
  domainId: string;
  hostingOnly: boolean;
  onChange: (view: DomainCardView) => void;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={cx(buttonClasses("secondary", "sm"), "mt-3")}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await retryDomainAction(domainId);
          if (res.ok) onChange(res.view);
        })
      }
    >
      {pending ? "Försöker …" : hostingOnly ? "Försök igen" : "Försök igen"}
    </button>
  );
}

function ManageRenewal({
  view,
  onChange,
  companyName,
}: {
  view: DomainCardView;
  onChange: (view: DomainCardView) => void;
  companyName: string;
}) {
  const [pending, start] = useTransition();
  const [warnOff, setWarnOff] = useState(false);

  return (
    <Card className="px-5 py-5 sm:px-6">
      <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Hantera</p>
      <p className="mt-2 text-[14px] text-soft">
        Registrerad på {companyName}
        {view.registeredOn.orgNumber ? ` · ${view.registeredOn.orgNumber}` : ""}.
        {view.priceLabel ? ` ${view.priceLabel}.` : ""}
        {view.expiresLabel ? ` Nästa förnyelse ${view.expiresLabel}.` : ""}
      </p>
      <label className="mt-4 flex items-start gap-3 text-[14px]">
        <input
          type="checkbox"
          className="mt-1"
          checked={view.autoRenew}
          disabled={pending}
          onChange={(e) => {
            const enabled = e.target.checked;
            if (!enabled) {
              setWarnOff(true);
              return;
            }
            start(async () => {
              const res = await setAutoRenewAction(view.id, true);
              if (res.ok) onChange(res.view);
            });
          }}
        />
        <span>
          <span className="font-medium text-ink">Förnyas automatiskt varje år</span>
          <span className="block text-[13px] text-muted">Rekommenderas så att adressen inte går ut.</span>
        </span>
      </label>
      {warnOff ? (
        <div className="mt-3 rounded-xl border border-warn/30 bg-warn-soft px-3.5 py-3 text-[13px] text-ink">
          <p>Om du stänger av förnyelsen kan adressen gå ut och någon annan kan ta den.</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className={buttonClasses("ghost", "sm")} onClick={() => setWarnOff(false)}>
              Behåll på
            </button>
            <button
              type="button"
              className={buttonClasses("danger", "sm")}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await setAutoRenewAction(view.id, false);
                  if (res.ok) {
                    onChange(res.view);
                    setWarnOff(false);
                  }
                })
              }
            >
              Stäng av
            </button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function ExistingPendingCard({
  view,
  demo,
  onChange,
}: {
  view: DomainCardView;
  demo: boolean;
  onChange: (view: DomainCardView) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const dns = view.dnsChanges ?? [];

  return (
    <Card className="px-5 py-5 sm:px-6">
      <p className="flex items-center gap-2 font-mono text-[16px] font-semibold">
        {view.hostname}
        {demo ? <DemoTag>DEMO</DemoTag> : null}
      </p>
      <p className="mt-2 text-[14px] leading-relaxed text-soft">
        Ändra detta hos den som säljer din adress. När det är gjort kontrollerar vi anslutningen.
      </p>
      {dns.length ? (
        <ul className="mt-4 space-y-2">
          {dns.map((rec, i) => (
            <li key={`${rec.host}-${i}`} className="rounded-xl border border-line bg-canvas px-3.5 py-3 font-mono text-[13px]">
              <span className="font-semibold text-ink">{rec.type}</span> {rec.host} → {rec.value}
            </li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        className={cx(buttonClasses("primary"), "mt-4")}
        disabled={checking}
        onClick={() =>
          startCheck(async () => {
            const res = await verifyExistingDomainAction(view.id);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            onChange(res.view);
            if (!res.view.live) setError("Ändringen syns inte ännu. Det kan ta en stund – prova igen.");
            else setError(null);
          })
        }
      >
        {checking ? "Kontrollerar …" : "Kontrollera anslutning"}
      </button>
      {error ? <p className="mt-3 text-[14px] text-danger">{error}</p> : null}
    </Card>
  );
}

function ExistingDomainForm({
  demo,
  onBack,
  onConnected,
}: {
  demo: boolean;
  onBack: () => void;
  onConnected: (view: DomainCardView) => void;
}) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Card className="px-5 py-5 sm:px-6">
      <p className="text-[17px] font-semibold tracking-tight">Anslut befintlig adress</p>
      <p className="mt-1 text-[14px] text-soft">Skriv adressen du redan äger. Vi visar exakt vad som ska ändras.</p>
      {demo ? (
        <p className="mt-2">
          <DemoTag>DEMO</DemoTag>
        </p>
      ) : null}
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!query.trim()) {
            setFieldError("Ange domänen du redan äger");
            setError(null);
            focusField("doman-befintlig");
            return;
          }
          setFieldError(null);
          setError(null);
          start(async () => {
            const res = await startExistingDomainAction(query);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            onConnected(res.view);
          });
        }}
      >
        <input
          id="doman-befintlig"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (fieldError) setFieldError(null);
          }}
          placeholder="mittforetag.se"
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? "doman-befintlig-fel" : undefined}
          className={cx(
            "h-12 w-full rounded-xl border border-line-strong bg-card px-3 text-[15px] focus:border-accent",
            fieldError && invalidFieldCls,
          )}
        />
        <FieldError id="doman-befintlig-fel">{fieldError}</FieldError>
        {error ? <p className="text-[14px] font-medium text-danger">{error}</p> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={buttonClasses("ghost")} onClick={onBack}>
            Tillbaka
          </button>
          <button type="submit" className={buttonClasses("primary")} disabled={pending}>
            {pending ? "Lägger till …" : "Fortsätt"}
          </button>
        </div>
      </form>
    </Card>
  );
}

export function DomainSidebarCard({
  hostname,
  live,
  demo,
}: {
  hostname?: string;
  live: boolean;
  demo: boolean;
}) {
  return (
    <Card className="px-5 py-4">
      <div className="flex items-start gap-3">
        <div className="flex size-9 items-center justify-center rounded-xl bg-accent-soft">
          <Globe className="size-4.5 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          {hostname ? (
            <>
              <p className="truncate font-mono text-[13px] font-medium text-ink">{hostname}</p>
              <p className="mt-0.5 text-[13px] text-soft">
                {live ? "Igång" : "Kopplas"}
                {demo ? " · demo" : ""}
              </p>
            </>
          ) : (
            <p className="text-[13px] leading-relaxed text-soft">Skaffa en .se-adress så ligger hemsidan på ditt namn.</p>
          )}
          <AppLink href="/hemsida/doman" className="mt-2 inline-block text-[13px] font-medium text-accent hover:underline">
            {hostname ? "Öppna domänsidan →" : "Skaffa .se-adress →"}
          </AppLink>
        </div>
      </div>
    </Card>
  );
}

export function DomainSettingsCard({
  summary,
}: {
  summary: { hostname: string; live: boolean } | null;
}) {
  const navigate = useAppNavigate();
  if (!summary) return null;
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <div>
        <p className="text-[13px] font-medium text-muted">Webbadress</p>
        <p className="font-mono text-[14px] font-medium text-ink">{summary.hostname}</p>
        <p className="text-[13px] text-soft">{summary.live ? "Igång" : "Kopplas"}</p>
      </div>
      <button type="button" className={buttonClasses("secondary", "sm")} onClick={() => navigate("/hemsida/doman")}>
        Öppna domänsidan →
      </button>
    </Card>
  );
}
