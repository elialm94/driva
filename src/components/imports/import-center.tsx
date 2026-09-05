"use client";

import { useCallback, useId, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, FileUp, Loader2, Sparkles, Trash2, X } from "lucide-react";
import type { ImportAnalysis, ImportOutcome } from "@/lib/services/data-imports";
import type { RegisterMapping } from "@/lib/imports/registers";
import type { DataImportKind, WholesalerColumnMapping } from "@/lib/types";
import { COLUMN_KEYS, COLUMN_LABELS } from "@/lib/wholesalers/column-mapping";
import { AppLink } from "../app-link";
import { Badge, Card } from "../ui";
import { buttonClasses, cx } from "../ui-classes";

/* ----------------------------------- typer ---------------------------------- */

type Phase = "reading" | "checking" | "ready" | "importing" | "done" | "failed";

interface FileEntry {
  id: string;
  file: File;
  phase: Phase;
  analysis?: ImportAnalysis;
  error?: string;
  outcome?: ImportOutcome;
  /** Användarens val på kortet. */
  years: number[];
  mapping: RegisterMapping;
  articleMapping: WholesalerColumnMapping;
  connectionId: string;
  kindOverride?: DataImportKind;
  detailsOpen: boolean;
  confirming: boolean;
}

type ApiAnalyze = { ok: true; analysis: ImportAnalysis } | { ok: false; error: string };
type ApiImport = ImportOutcome | { ok: false; error: string };

const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPT = ".se,.si,.sie,.csv,.txt,.tsv,.xlsx,.xml,.zip,.pdf";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";

function fmt(n: number): string {
  return n.toLocaleString("sv-SE");
}

async function postImport(file: File, mode: "analyze" | "import", options: Record<string, unknown>): Promise<Response> {
  const form = new FormData();
  form.set("mode", mode);
  form.set("file", file, file.name);
  form.set("options", JSON.stringify(options));
  return fetch("/api/kom-igang/import", { method: "POST", body: form });
}

/* -------------------------------- komponenten ------------------------------- */

export function ImportCenter({ importedCount }: { importedCount: number }) {
  const router = useRouter();
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [dragging, setDragging] = useState(false);
  const [showFormats, setShowFormats] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const importingRef = useRef(false);

  const update = useCallback((id: string, patch: Partial<FileEntry> | ((e: FileEntry) => Partial<FileEntry>)) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...(typeof patch === "function" ? patch(e) : patch) } : e)));
  }, []);

  const analyze = useCallback(
    async (entry: FileEntry, options: Record<string, unknown> = {}) => {
      update(entry.id, { phase: "checking", error: undefined });
      try {
        const res = await postImport(entry.file, "analyze", options);
        const body = (await res.json()) as ApiAnalyze;
        if (!body.ok) {
          update(entry.id, { phase: "failed", error: body.error });
          return;
        }
        const a = body.analysis;
        update(entry.id, (e) => ({
          phase: "ready",
          analysis: a,
          years: a.sie ? a.sie.years.filter((y) => y.defaultSelected).map((y) => y.index) : [],
          mapping: a.register ? a.register.mapping : e.mapping,
          articleMapping: a.articles ? a.articles.preview.mapping : e.articleMapping,
          connectionId: a.articles && a.articles.connections.length === 1 ? a.articles.connections[0].id : e.connectionId,
          kindOverride: (options.kind as DataImportKind | undefined) ?? e.kindOverride,
        }));
      } catch {
        update(entry.id, { phase: "failed", error: "Filen kunde inte skickas. Kontrollera uppkopplingen och försök igen." });
      }
    },
    [update],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      const fresh: FileEntry[] = list.map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        phase: "reading",
        years: [],
        mapping: {},
        articleMapping: {},
        connectionId: "",
        detailsOpen: false,
        confirming: false,
      }));
      setEntries((prev) => [...prev, ...fresh]);
      for (const entry of fresh) {
        if (entry.file.size === 0) {
          update(entry.id, { phase: "failed", error: "Filen är tom." });
          continue;
        }
        if (entry.file.size > MAX_BYTES) {
          update(entry.id, { phase: "failed", error: "Filen är för stor (max 25 MB)." });
          continue;
        }
        // Läser filen → Kontrollerar innehållet: uppladdningen är "läser", serverns analys är "kontrollerar".
        void analyze(entry);
      }
    },
    [analyze, update],
  );

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }

  async function runImport(entry: FileEntry) {
    if (importingRef.current || !entry.analysis) return;
    importingRef.current = true;
    update(entry.id, { phase: "importing", error: undefined, confirming: false });
    try {
      const kind = entry.kindOverride ?? entry.analysis.kind;
      const res = await postImport(entry.file, "import", {
        kind,
        expectedHash: entry.analysis.fileHash,
        yearIndexes: entry.years,
        mapping: entry.mapping,
        articleMapping: entry.articleMapping,
        connectionId: entry.connectionId,
      });
      const body = (await res.json()) as ApiImport;
      if (!body.ok) {
        update(entry.id, { phase: "ready", error: body.error });
        return;
      }
      update(entry.id, { phase: "done", outcome: body });
      router.refresh();
    } catch {
      update(entry.id, { phase: "ready", error: "Importen kunde inte genomföras. Inget har sparats – försök igen." });
    } finally {
      importingRef.current = false;
    }
  }

  function remove(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  return (
    <div className="space-y-5" data-import-center>
      <Card
        className={cx(
          "border-dashed p-6 text-center transition-colors sm:p-10",
          dragging ? "border-accent bg-accent-soft/40" : "border-line-strong",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-import-dropzone
      >
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-deep">
          <FileUp className="size-5" />
        </div>
        <p className="mt-4 text-[17px] font-semibold text-ink">Dra filer hit eller välj från enheten</p>
        <p className="mt-1 text-[14px] text-soft">Till exempel bokföring, kunder, leverantörer, artiklar eller prislistor.</p>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
          data-import-file-input
        />
        <div className="mt-5 flex flex-col items-center gap-3">
          <label htmlFor={inputId} className={buttonClasses("primary", "lg", "cursor-pointer")}>
            Välj filer
          </label>
          <button type="button" className="text-[13px] text-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => setShowFormats((v) => !v)}>
            Vilka filer fungerar?
          </button>
        </div>
        {showFormats ? (
          <dl className="mx-auto mt-4 grid max-w-md gap-2 text-left text-[13px] text-soft sm:grid-cols-[auto_1fr]">
            <dt className="font-medium text-ink">Bokföring</dt>
            <dd>SIE-fil (SIE 4) från ditt tidigare program. Räkenskapsår, ingående balanser och verifikationer.</dd>
            <dt className="font-medium text-ink">Kunder och leverantörer</dt>
            <dd>Excel (.xlsx) eller CSV med en rad per kund/leverantör. Kolumnerna behöver inte heta något särskilt.</dd>
            <dt className="font-medium text-ink">Artiklar och priser</dt>
            <dd>Grossistens prislista eller rabattbrev (CSV, Excel, XML eller ZIP). Hör till Grossistbeställningar.</dd>
            <dt className="font-medium text-ink">Inte här</dt>
            <dd>Kvitton och fakturor som PDF tar du emot i Inboxen.</dd>
          </dl>
        ) : null}
      </Card>

      {entries.length === 0 && importedCount > 0 ? (
        <p className="text-[13px] text-muted">
          {importedCount} {importedCount === 1 ? "import är" : "importer är"} genomförda – se listan under{" "}
          <AppLink href="/installningar?flik=kom-igang" originLabel="Flytta dina uppgifter" className="text-accent hover:underline">
            Kom igång
          </AppLink>
          .
        </p>
      ) : null}

      <ul className="space-y-4" data-import-cards>
        {entries.map((entry) => (
          <li key={entry.id}>
            <FileCard
              entry={entry}
              onRemove={() => remove(entry.id)}
              onReplace={() => inputRef.current?.click()}
              onToggleDetails={() => update(entry.id, { detailsOpen: !entry.detailsOpen })}
              onYears={(years) => update(entry.id, { years })}
              onMapping={(mapping) => {
                update(entry.id, { mapping });
                void analyze({ ...entry, mapping }, { kind: entry.kindOverride ?? entry.analysis?.kind, mapping });
              }}
              onArticleMapping={(articleMapping) => {
                update(entry.id, { articleMapping });
                void analyze({ ...entry, articleMapping }, { kind: "artiklar", articleMapping });
              }}
              onConnection={(connectionId) => update(entry.id, { connectionId })}
              onKind={(kind) => void analyze(entry, { kind })}
              onConfirm={() => update(entry.id, { confirming: true })}
              onCancelConfirm={() => update(entry.id, { confirming: false })}
              onImport={() => void runImport(entry)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------------------------- filkort --------------------------------- */

function Progress({ phase }: { phase: Phase }) {
  const steps: { key: Phase; label: string }[] = [
    { key: "reading", label: "Läser filen" },
    { key: "checking", label: "Kontrollerar innehållet" },
    { key: "ready", label: "Redo att granskas" },
  ];
  const index = phase === "reading" ? 0 : phase === "checking" ? 1 : 2;
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]" aria-label="Analys">
      {steps.map((s, i) => (
        <li key={s.key} className={cx("flex items-center gap-1.5", i <= index ? "text-ink" : "text-muted")}>
          {i < index ? <CheckCircle2 className="size-3.5 text-ok" /> : i === index && index < 2 ? <Loader2 className="size-3.5 animate-spin" /> : <span className={cx("size-1.5 rounded-full", i <= index ? "bg-ink" : "bg-line-strong")} />}
          {s.label}
        </li>
      ))}
    </ol>
  );
}

function FileCard({
  entry,
  onRemove,
  onReplace,
  onToggleDetails,
  onYears,
  onMapping,
  onArticleMapping,
  onConnection,
  onKind,
  onConfirm,
  onCancelConfirm,
  onImport,
}: {
  entry: FileEntry;
  onRemove: () => void;
  onReplace: () => void;
  onToggleDetails: () => void;
  onYears: (years: number[]) => void;
  onMapping: (mapping: RegisterMapping) => void;
  onArticleMapping: (mapping: WholesalerColumnMapping) => void;
  onConnection: (id: string) => void;
  onKind: (kind: DataImportKind) => void;
  onConfirm: () => void;
  onCancelConfirm: () => void;
  onImport: () => void;
}) {
  const a = entry.analysis;
  const busy = entry.phase === "reading" || entry.phase === "checking" || entry.phase === "importing";

  if (entry.phase === "done" && entry.outcome) {
    return (
      <Card className="p-5" data-import-card data-import-state="done">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-ink">{a?.title ?? entry.file.name} är inflyttat</p>
            <p className="mt-0.5 text-[13.5px] text-soft" data-import-summary>
              {entry.outcome.summary}
              {entry.outcome.ignored > 0 ? ` · ${fmt(entry.outcome.ignored)} rader hoppades över` : ""}
            </p>
            {entry.outcome.warnings.length > 0 ? (
              <details className="mt-2 text-[13px] text-soft">
                <summary className="cursor-pointer text-muted">
                  {entry.outcome.warnings.length} {entry.outcome.warnings.length === 1 ? "anmärkning" : "anmärkningar"}
                </summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {entry.outcome.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <AppLink href={entry.outcome.nextHref} originLabel="Flytta dina uppgifter" className={buttonClasses("secondary", "sm")}>
                {entry.outcome.nextLabel} <ChevronRight className="size-3.5" />
              </AppLink>
            </div>
          </div>
          <button type="button" className={buttonClasses("ghost", "sm")} aria-label="Ta bort kortet" onClick={onRemove}>
            <X className="size-4" />
          </button>
        </div>
      </Card>
    );
  }

  const kind = entry.kindOverride ?? a?.kind;
  const alreadyImported = Boolean(a?.alreadyImported);
  const requiredChoiceMissing =
    (a?.kind === "bokforing" && entry.years.length === 0) ||
    (a?.register && a.register.problems.length > 0) ||
    (a?.kind === "artiklar" && (!entry.connectionId || !a.articles?.featureEnabled)) ||
    kind === "unknown" ||
    kind === "unsupported";
  const canImport = entry.phase === "ready" && a && !alreadyImported && !requiredChoiceMissing && !a.message?.startsWith("Inget i filen");

  return (
    <Card className="overflow-hidden" data-import-card data-import-state={entry.phase} data-import-kind={kind ?? ""}>
      <div className="flex items-start gap-3 px-5 pt-5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-ink" data-import-title>
            {a?.title ?? entry.file.name}
          </p>
          <p className="mt-0.5 text-[13.5px] text-soft" data-import-subtitle>
            {a ? a.subtitle : `${entry.file.name} · ${fmt(Math.round(entry.file.size / 1024))} kB`}
          </p>
          {a && a.title !== entry.file.name ? <p className="truncate text-[12px] text-muted">{entry.file.name}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {a?.source === "ai" ? (
            <Badge tone="info">
              <Sparkles className="mr-1 size-3" /> AI-förslag
            </Badge>
          ) : null}
          <button type="button" className={buttonClasses("ghost", "sm")} aria-label="Ta bort filen" onClick={onRemove} disabled={entry.phase === "importing"}>
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      <div className="px-5 pt-3">
        <Progress phase={entry.phase} />
      </div>

      {entry.error ? (
        <p role="alert" className="mx-5 mt-3 flex items-start gap-2 rounded-xl bg-danger-soft px-3.5 py-2.5 text-[13.5px] text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {entry.error}
        </p>
      ) : null}

      {a ? (
        <div className="space-y-4 px-5 pb-5 pt-4">
          {a.aiReason ? <p className="text-[13px] text-soft">AI-förslag: {a.aiReason}</p> : null}
          {a.message ? (
            <p className={cx("rounded-xl px-3.5 py-2.5 text-[13.5px]", a.kind === "unsupported" ? "bg-warn-soft/60 text-warn" : "bg-canvas text-soft")}>{a.message}</p>
          ) : null}
          {alreadyImported ? (
            <p className="flex items-start gap-2 rounded-xl bg-canvas px-3.5 py-2.5 text-[13.5px] text-soft">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" />
              Den här filen är redan inflyttad ({a.alreadyImported!.at.slice(0, 10)}: {a.alreadyImported!.summary}). Samma fil importeras inte två gånger.
            </p>
          ) : null}

          {a.canChooseKind ? (
            <label className="block max-w-xs">
              <span className="mb-1 block text-[13px] text-muted">Vad innehåller filen?</span>
              <select
                className={inputCls}
                value={kind === "unknown" || kind === "unsupported" ? "" : kind}
                disabled={busy}
                onChange={(e) => e.target.value && onKind(e.target.value as DataImportKind)}
                data-import-kind-select
              >
                <option value="">Välj …</option>
                <option value="kunder">Kunder</option>
                <option value="leverantorer">Leverantörer</option>
                <option value="artiklar">Artiklar och priser</option>
              </select>
            </label>
          ) : null}

          {a.sie ? <SieDetails entry={entry} onYears={onYears} disabled={busy} /> : null}
          {a.register && kind !== "unknown" ? <RegisterDetails entry={entry} onMapping={onMapping} disabled={busy} /> : null}
          {a.articles && kind === "artiklar" ? (
            <ArticleDetails entry={entry} onArticleMapping={onArticleMapping} onConnection={onConnection} disabled={busy} />
          ) : null}

          {a.warnings.length > 0 ? (
            <ul className="space-y-1 text-[13px] text-soft">
              {a.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" /> {w}
                </li>
              ))}
            </ul>
          ) : null}

          {canImport ? (
            entry.confirming ? (
              <div className="rounded-xl border border-accent/40 bg-accent-soft/40 p-4" data-import-confirm>
                <p className="text-[14px] font-medium text-ink">Flytta in {a.title.toLowerCase()} nu?</p>
                <p className="mt-1 text-[13px] text-soft">
                  {a.kind === "bokforing"
                    ? "Verifikationerna bokförs i Ferva med filens nummer. Det kan inte ångras automatiskt – rättelser görs som vanligt i bokföringen."
                    : "Raderna läggs till i registret. Inget befintligt skrivs över."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className={buttonClasses("primary", "md")} onClick={onImport} data-import-run>
                    Ja, flytta in
                  </button>
                  <button type="button" className={buttonClasses("ghost", "md")} onClick={onCancelConfirm}>
                    Avbryt
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={buttonClasses("primary", "md")} onClick={onConfirm} data-import-confirm-open>
                  Importera
                </button>
                <button type="button" className={buttonClasses("ghost", "md")} onClick={onReplace} disabled={busy}>
                  Ersätt fil
                </button>
                <button type="button" className={buttonClasses("ghost", "md")} onClick={onToggleDetails}>
                  Kontrollera detaljer <ChevronDown className={cx("size-3.5 transition-transform", entry.detailsOpen && "rotate-180")} />
                </button>
              </div>
            )
          ) : entry.phase === "importing" ? (
            <p className="flex items-center gap-2 text-[14px] text-soft">
              <Loader2 className="size-4 animate-spin" /> Flyttar in … inget visas som klart förrän allt är sparat.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={buttonClasses("ghost", "md")} onClick={onReplace} disabled={busy}>
                Ersätt fil
              </button>
              {a.sie || a.register ? (
                <button type="button" className={buttonClasses("ghost", "md")} onClick={onToggleDetails}>
                  Kontrollera detaljer <ChevronDown className={cx("size-3.5 transition-transform", entry.detailsOpen && "rotate-180")} />
                </button>
              ) : null}
            </div>
          )}

          {entry.detailsOpen ? <Details analysis={a} /> : null}
        </div>
      ) : (
        <div className="px-5 pb-5" />
      )}
    </Card>
  );
}

/* --------------------------------- bokföring -------------------------------- */

function SieDetails({ entry, onYears, disabled }: { entry: FileEntry; onYears: (years: number[]) => void; disabled: boolean }) {
  const sie = entry.analysis!.sie!;
  return (
    <div className="space-y-3" data-import-sie>
      {sie.companyName || sie.orgNumber ? (
        <p className="text-[13px] text-soft">
          Filen kommer från <span className="font-medium text-ink">{sie.companyName ?? "okänt företag"}</span>
          {sie.orgNumber ? ` (${sie.orgNumber})` : ""}
          {sie.program ? ` · exporterad från ${sie.program}` : ""}
        </p>
      ) : null}
      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium text-muted">Räkenskapsår att ta med</legend>
        {sie.years.map((y) => {
          const checked = entry.years.includes(y.index);
          return (
            <label
              key={y.index}
              className={cx(
                "flex items-start gap-3 rounded-xl border px-3.5 py-3",
                y.selectable ? "cursor-pointer border-line/80" : "border-line/60 opacity-70",
              )}
              data-import-year={y.label}
            >
              <input
                type="checkbox"
                className="mt-1 size-4 accent-ink"
                checked={checked}
                disabled={!y.selectable || disabled}
                onChange={(e) => onYears(e.target.checked ? [...entry.years, y.index] : entry.years.filter((i) => i !== y.index))}
              />
              <span className="min-w-0 flex-1 text-[13.5px]">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{y.label}</span>
                  <span className="text-muted">
                    {y.startDate}–{y.endDate}
                  </span>
                  {y.existing === "same_year_with_verifications" ? <Badge tone="warn">Har redan bokföring</Badge> : null}
                  {y.existing === "closed" ? <Badge tone="neutral">Stängt år</Badge> : null}
                </span>
                <span className="mt-1 block text-soft">
                  {y.balancesOnly
                    ? "Bara saldon i filen"
                    : `${fmt(y.importableCount)} ${y.importableCount === 1 ? "verifikation" : "verifikationer"}${y.firstDate ? ` · ${y.firstDate} – ${y.lastDate}` : ""} · ${fmt(y.accountCount)} konton · debet ${fmt(y.totalDebitKr)} kr / kredit ${fmt(y.totalCreditKr)} kr`}
                </span>
                {y.willImport.length > 0 ? (
                  <span className="mt-1 block text-ok">Tas med: {y.willImport.join(", ")}</span>
                ) : null}
                {y.omitted.map((o, i) => (
                  <span key={i} className="mt-1 block text-warn">
                    Tas inte med: {o}
                  </span>
                ))}
                {y.warnings.map((w, i) => (
                  <span key={`w${i}`} className="mt-1 block text-soft">
                    {w}
                  </span>
                ))}
              </span>
            </label>
          );
        })}
      </fieldset>
      {sie.unknownAccounts.length > 0 ? (
        <p className="text-[13px] text-soft">
          {fmt(sie.unknownAccounts.length)} konton saknas i Fervas standardkontoplan och får namnen från filen
          {sie.unknownAccounts.length <= 8 ? ` (${sie.unknownAccounts.join(", ")})` : ""}.
        </p>
      ) : null}
      <p className="text-[12.5px] text-muted">Belopp bokförs i hela kronor – ören avrundas så att varje verifikation balanserar exakt.</p>
    </div>
  );
}

/* ---------------------------------- register -------------------------------- */

function RegisterDetails({ entry, onMapping, disabled }: { entry: FileEntry; onMapping: (m: RegisterMapping) => void; disabled: boolean }) {
  const reg = entry.analysis!.register!;
  const used = new Set(Object.values(entry.mapping));
  return (
    <div className="space-y-3" data-import-register>
      <div>
        <p className="text-[14px] font-medium text-ink">Vi tror att dessa kolumner hör ihop</p>
        <p className="text-[13px] text-soft">Rätta om något är fel. Kolumner som inte används tas inte med.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {reg.fields.map((f) => {
          const current = entry.mapping[f.key] ?? "";
          const conf = reg.confidence[f.key];
          return (
            <label key={f.key} className="block rounded-xl border border-line/80 px-3 py-2">
              <span className="flex items-center justify-between text-[13px] text-muted">
                <span>{f.label}</span>
                {conf === "ai" ? <span className="text-[11px] text-info">AI-förslag</span> : conf === "medium" ? <span className="text-[11px] text-warn">Gissning</span> : null}
              </span>
              <select
                className={cx(inputCls, "mt-1 py-1.5")}
                value={current}
                disabled={disabled}
                onChange={(e) => {
                  const next = { ...entry.mapping };
                  if (e.target.value) next[f.key] = e.target.value;
                  else delete next[f.key];
                  onMapping(next);
                }}
                aria-label={f.label}
                data-import-field={f.key}
              >
                <option value="">Finns inte i filen</option>
                {reg.headers.map((h, i) => (
                  <option key={`${h}-${i}`} value={h} disabled={used.has(h) && h !== current}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
      {reg.problems.length > 0 ? (
        <ul className="text-[13.5px] text-warn">
          {reg.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : (
        <p className="text-[13.5px] text-soft">
          <span className="font-medium text-ink">{fmt(reg.created)}</span> skapas
          {reg.duplicates.length > 0 ? ` · ${fmt(reg.duplicates.length)} finns redan och hoppas över` : ""}
          {reg.review.length > 0 ? ` · ${fmt(reg.review.length)} ${reg.review.length === 1 ? "rad" : "rader"} bör kontrolleras` : ""}
          {reg.invalid.length > 0 ? ` · ${fmt(reg.invalid.length)} saknar namn` : ""}
        </p>
      )}
      <SampleTable headers={reg.headers} rows={reg.sampleRows} />
    </div>
  );
}

/* ---------------------------------- artiklar -------------------------------- */

function ArticleDetails({
  entry,
  onArticleMapping,
  onConnection,
  disabled,
}: {
  entry: FileEntry;
  onArticleMapping: (m: WholesalerColumnMapping) => void;
  onConnection: (id: string) => void;
  disabled: boolean;
}) {
  const art = entry.analysis!.articles!;
  const used = new Set(Object.values(entry.articleMapping));
  return (
    <div className="space-y-3" data-import-articles>
      {art.featureEnabled && art.connections.length > 0 ? (
        <label className="block max-w-sm">
          <span className="mb-1 block text-[13px] text-muted">Vilken grossist hör prislistan till?</span>
          <select className={inputCls} value={entry.connectionId} disabled={disabled} onChange={(e) => onConnection(e.target.value)} data-import-connection>
            <option value="">Välj grossist …</option>
            {art.connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <AppLink
          href={art.featureEnabled ? "/installningar?flik=grossister" : "/installningar?flik=funktioner"}
          originLabel="Flytta dina uppgifter"
          className={buttonClasses("secondary", "sm")}
        >
          {art.featureEnabled ? "Lägg till grossist" : "Öppna Funktioner"} <ChevronRight className="size-3.5" />
        </AppLink>
      )}
      {!art.preview.discountLetter ? (
        <div>
          <p className="mb-2 text-[13px] font-medium text-muted">Vilken kolumn är vad?</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {COLUMN_KEYS.map((key) => {
              const current = entry.articleMapping[key] ?? "";
              return (
                <label key={key} className="block rounded-xl border border-line/80 px-3 py-2">
                  <span className="text-[13px] text-muted">{COLUMN_LABELS[key]}</span>
                  <select
                    className={cx(inputCls, "mt-1 py-1.5")}
                    value={current}
                    disabled={disabled}
                    onChange={(e) => {
                      const next = { ...entry.articleMapping };
                      if (e.target.value) next[key] = e.target.value;
                      else delete next[key];
                      onArticleMapping(next);
                    }}
                    aria-label={COLUMN_LABELS[key]}
                  >
                    <option value="">Finns inte i filen</option>
                    {art.preview.headers.map((h, i) => (
                      <option key={`${h}-${i}`} value={h} disabled={used.has(h) && h !== current}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
      {art.preview.problems.length > 0 ? (
        <ul className="text-[13.5px] text-warn">
          {art.preview.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      <SampleTable headers={art.preview.headers} rows={art.preview.sampleRows} />
    </div>
  );
}

function SampleTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-[13px] font-medium text-muted">De första raderna</p>
      <div className="overflow-x-auto rounded-xl border border-line/80">
        <table className="min-w-full text-[12.5px]">
          <thead className="bg-canvas text-left text-muted">
            <tr>
              {headers.map((h, i) => (
                <th key={`${h}-${i}`} className="whitespace-nowrap px-2 py-1.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="border-t border-line/60">
                {headers.map((_, ci) => (
                  <td key={ci} className="max-w-56 truncate px-2 py-1.5 text-ink">
                    {row[ci] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ----------------------------------- detaljer ------------------------------- */

function Details({ analysis }: { analysis: ImportAnalysis }) {
  const sie = analysis.sie;
  const reg = analysis.register;
  return (
    <div className="space-y-3 rounded-xl bg-canvas p-4 text-[13px] text-soft" data-import-details>
      <p>
        Tolkning: {analysis.source === "ai" ? "AI-förslag, bekräftat av dig i kolumnvalen" : "deterministisk (filens innehåll och rubriker)"} · fil {analysis.fileKind.toUpperCase()} ·{" "}
        {fmt(Math.round(analysis.fileSize / 1024))} kB · kontrollsumma {analysis.fileHash.slice(0, 12)}…
      </p>
      {sie ? (
        <>
          {sie.years.flatMap((y) => y.unbalanced.map((u) => ({ y, u }))).length > 0 ? (
            <div>
              <p className="font-medium text-ink">Verifikationer som inte balanserar i filen</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {sie.years.flatMap((y) =>
                  y.unbalanced.slice(0, 20).map((u, i) => (
                    <li key={`${y.index}-${i}`}>
                      {u.series}
                      {u.number ?? ""} {u.date} {u.text} – skillnad {(u.diffOre / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2 })} kr
                    </li>
                  )),
                )}
              </ul>
            </div>
          ) : null}
          {sie.dimensions.length > 0 ? <p>Dimensioner i filen: {sie.dimensions.join(", ")} – följer med som text på raderna.</p> : null}
          <p>{fmt(sie.accountCount)} konton i filens kontoplan.</p>
        </>
      ) : null}
      {reg ? (
        <>
          {reg.review.length > 0 ? (
            <div>
              <p className="font-medium text-ink">Rader att kontrollera (tas med, fältet lämnas tomt)</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {reg.review.slice(0, 30).map((r, i) => (
                  <li key={i}>
                    Rad {r.line}: {r.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {reg.duplicates.length > 0 ? (
            <div>
              <p className="font-medium text-ink">Finns redan</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {reg.duplicates.slice(0, 30).map((d, i) => (
                  <li key={i}>
                    Rad {d.line}: {d.name} (samma {d.matchedOn})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {reg.unmapped.length > 0 ? <p>Kolumner som inte tas med: {reg.unmapped.join(", ")}</p> : null}
        </>
      ) : null}
    </div>
  );
}
