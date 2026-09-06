"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileUp, Pencil, Plus, Store } from "lucide-react";
import type {
  WholesalerColumnKey,
  WholesalerColumnMapping,
  WholesalerConnection,
  WholesalerCustomerPriceRule,
  WholesalerPriceImport,
} from "@/lib/types";
import type { ImportPreview } from "@/lib/wholesalers/import-engine";
import { COLUMN_HINTS, COLUMN_KEYS, COLUMN_LABELS } from "@/lib/wholesalers/column-mapping";
import {
  DELIVERY_MODE_LABELS,
  WHOLESALER_KEYS,
  WHOLESALER_NAMES,
  connectionLabel,
  customerPriceRuleLabel,
} from "@/lib/wholesalers/labels";
import { datumLang, datumTid } from "@/lib/format";
import { saveWholesalerConnectionAction, setWholesalerConnectionActiveAction } from "@/app/wholesaler-actions";
import { Badge, Card, DemoTag, buttonClasses, cx } from "./ui";
import { Modal } from "./modal";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted focus:border-accent";
const labelCls = "mb-1 block text-[13px] text-muted";

export interface WholesalerSettingsConnection {
  connection: WholesalerConnection;
  label: string;
  priceList: { importId: string; priceDate: string; productCount: number; stale: boolean; filename: string } | null;
  lastImport: WholesalerPriceImport | null;
  discountsWithoutRegister: boolean;
}

export function WholesalerSettings({
  overviews,
  demo,
}: {
  overviews: WholesalerSettingsConnection[];
  demo: boolean;
}) {
  const [editing, setEditing] = useState<WholesalerConnection | null | "new">(null);
  const [importing, setImporting] = useState<WholesalerConnection | null>(null);

  return (
    <div className="space-y-5">
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Grossister</p>
            <p className="mt-1 max-w-xl text-[14px] leading-relaxed text-soft">
              Koppla dina grossister, ladda upp prislistan och beställ material direkt från uppdraget. Svaret
              från grossisten hamnar i din inbox och matchas mot beställningen.
            </p>
          </div>
          <button type="button" className={buttonClasses("primary", "sm")} onClick={() => setEditing("new")}>
            <Plus className="size-3.5" /> Lägg till grossist
          </button>
        </div>
        {demo ? (
          <p className="mt-3 flex items-center gap-2 text-[13px] text-soft">
            <DemoTag /> I demon finns en fiktiv grossist med prislista. Beställningar simuleras och en demobekräftelse
            kommer tillbaka i inboxen – inget skickas till någon riktig mottagare.
          </p>
        ) : null}
      </Card>

      {overviews.length === 0 ? (
        <Card className="flex flex-col items-center px-6 py-10 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft">
            <Store className="size-6 text-accent" />
          </div>
          <p className="mt-4 text-[16px] font-semibold text-ink">Ingen grossist ännu</p>
          <p className="mt-1 max-w-sm text-sm text-soft">
            Lägg till Ahlsell, Dahl, Sonepar, Solar, Lundagrossisten, Rexel eller en annan grossist. Kundnummer och
            ordermejl räcker för att börja beställa.
          </p>
          <button type="button" className={cx(buttonClasses("primary"), "mt-5")} onClick={() => setEditing("new")}>
            <Plus className="size-4" /> Lägg till grossist
          </button>
        </Card>
      ) : (
        <div className="space-y-4">
          {overviews.map((o) => (
            <ConnectionCard
              key={o.connection.id}
              overview={o}
              onEdit={() => setEditing(o.connection)}
              onImport={() => setImporting(o.connection)}
            />
          ))}
        </div>
      )}

      {editing ? (
        <ConnectionFormModal connection={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
      {importing ? <PriceFileModal connection={importing} onClose={() => setImporting(null)} /> : null}
    </div>
  );
}

/* ------------------------------ anslutningskort ----------------------------- */

function ConnectionCard({
  overview,
  onEdit,
  onImport,
}: {
  overview: WholesalerSettingsConnection;
  onEdit: () => void;
  onImport: () => void;
}) {
  const { connection, priceList, lastImport } = overview;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggleActive() {
    setError(null);
    startTransition(async () => {
      const result = await setWholesalerConnectionActiveAction(connection.id, !connection.active);
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  return (
    <Card className={cx("p-5", !connection.active && "opacity-80")} data-wholesaler-connection={connection.id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[16px] font-semibold text-ink">{overview.label}</p>
            {connection.displayName && connection.wholesaler !== "other" ? (
              <span className="text-[13px] text-muted">{WHOLESALER_NAMES[connection.wholesaler]}</span>
            ) : null}
            <Badge tone={connection.active ? "ok" : "neutral"}>{connection.active ? "Aktiv" : "Inaktiv"}</Badge>
          </div>
          <p className="mt-1 text-[13px] text-soft">
            Kundnummer {connection.customerNumber} · Order till {connection.orderEmail}
          </p>
          <p className="mt-0.5 text-[13px] text-muted">
            {DELIVERY_MODE_LABELS[connection.defaultDeliveryMode]}
            {connection.defaultDeliveryMode === "pickup" && connection.defaultStore ? ` · ${connection.defaultStore}` : ""}
            {connection.defaultDeliveryMode === "delivery" && connection.defaultDeliveryAddress
              ? ` · ${connection.defaultDeliveryAddress}`
              : ""}
            {" · "}
            {customerPriceRuleLabel(connection.customerPriceRule)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" className={buttonClasses("secondary", "sm")} onClick={onEdit} aria-label={`Ändra ${overview.label}`}>
            <Pencil className="size-3.5" /> Ändra
          </button>
          <button type="button" className={buttonClasses("ghost", "sm")} disabled={pending} onClick={toggleActive}>
            {connection.active ? "Inaktivera" : "Aktivera"}
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-line/80 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 text-[14px]">
            {priceList ? (
              <>
                <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                  <CheckCircle2 className="size-4 text-ok" />
                  Dina priser uppdaterades {datumLang(priceList.priceDate)}
                </p>
                <p className="mt-0.5 text-[13px] text-soft">
                  {priceList.productCount.toLocaleString("sv-SE")} artiklar importerades · {priceList.filename}
                </p>
                {priceList.stale ? (
                  <p className="mt-1 flex items-center gap-1.5 text-[13px] font-medium text-warn">
                    <AlertTriangle className="size-3.5" /> Prisfilen kan behöva uppdateras
                  </p>
                ) : null}
              </>
            ) : overview.discountsWithoutRegister ? (
              <p className="flex items-start gap-2 font-medium text-warn">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                Vi hittade rabatter men saknar artikelregistret. Ladda även upp grossistens artikel- eller prislista.
              </p>
            ) : (
              <p className="text-soft">Ingen prislista ännu. Ladda upp grossistens prisfil för att söka med dina priser.</p>
            )}
            {lastImport && lastImport.status === "failed" ? (
              <p className="mt-1 text-[13px] text-danger">
                Senaste import misslyckades {datumTid(lastImport.completedAt ?? lastImport.createdAt)}
                {lastImport.failedReason ? ` – ${lastImport.failedReason}` : ""}
              </p>
            ) : null}
            {lastImport && lastImport.status !== "failed" && lastImport.errors.length > 0 ? (
              <details className="mt-1 text-[13px] text-soft">
                <summary className="cursor-pointer">
                  {lastImport.skippedCount > 0
                    ? `${lastImport.skippedCount.toLocaleString("sv-SE")} rader hoppades över`
                    : `${lastImport.errors.length} rader med anmärkning`}
                </summary>
                <ul className="mt-1 space-y-0.5">
                  {lastImport.errors.slice(0, 10).map((e) => (
                    <li key={`${e.row}-${e.message}`}>{e.message}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
          <button type="button" className={buttonClasses("secondary", "sm")} onClick={onImport}>
            <FileUp className="size-3.5" /> {priceList ? "Ersätt prisfilen" : "Ladda upp prisfil"}
          </button>
        </div>
      </div>
      {error ? <p className="mt-2 text-[13px] font-medium text-danger">{error}</p> : null}
    </Card>
  );
}

/* ------------------------------ formulär: grossist -------------------------- */

type RuleKind = WholesalerCustomerPriceRule["kind"];

function ConnectionFormModal({ connection, onClose }: { connection: WholesalerConnection | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ids = useId();
  const [form, setForm] = useState(() => ({
    wholesaler: connection?.wholesaler ?? "ahlsell",
    displayName: connection?.displayName ?? "",
    customerNumber: connection?.customerNumber ?? "",
    orderEmail: connection?.orderEmail ?? "",
    ccSelf: connection?.ccSelf ?? false,
    defaultDeliveryMode: connection?.defaultDeliveryMode ?? "pickup",
    defaultStore: connection?.defaultStore ?? "",
    defaultDeliveryAddress: connection?.defaultDeliveryAddress ?? "",
    contactPerson: connection?.contactPerson ?? "",
    phone: connection?.phone ?? "",
    ruleKind: (connection?.customerPriceRule.kind ?? "later") as RuleKind,
    markupPercent:
      connection?.customerPriceRule.kind === "markup" ? String(connection.customerPriceRule.percent) : "25",
  }));

  function patch<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function submit() {
    setError(null);
    const rule: WholesalerCustomerPriceRule =
      form.ruleKind === "markup"
        ? { kind: "markup", percent: Number(form.markupPercent.replace(",", ".")) }
        : form.ruleKind === "file_sales_price"
          ? { kind: "file_sales_price" }
          : { kind: "later" };
    startTransition(async () => {
      const result = await saveWholesalerConnectionAction(
        {
          wholesaler: form.wholesaler,
          displayName: form.displayName,
          customerNumber: form.customerNumber,
          orderEmail: form.orderEmail,
          ccSelf: form.ccSelf,
          defaultDeliveryMode: form.defaultDeliveryMode,
          defaultStore: form.defaultStore,
          defaultDeliveryAddress: form.defaultDeliveryAddress,
          contactPerson: form.contactPerson,
          phone: form.phone,
          customerPriceRule: rule,
          active: connection?.active ?? true,
        },
        connection?.id,
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={connection ? `Ändra ${connectionLabel(connection)}` : "Lägg till grossist"}
      size="md"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={buttonClasses("ghost")} onClick={onClose} disabled={pending}>
            Avbryt
          </button>
          <button type="button" className={buttonClasses("primary")} onClick={submit} disabled={pending}>
            {pending ? "Sparar …" : "Spara grossist"}
          </button>
        </div>
      }
    >
      <form
        className="space-y-4 px-6 py-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={labelCls}>Grossist</span>
            <select
              className={inputCls}
              value={form.wholesaler}
              onChange={(e) => patch("wholesaler", e.target.value as typeof form.wholesaler)}
              id={`${ids}-grossist`}
            >
              {WHOLESALER_KEYS.map((k) => (
                <option key={k} value={k}>
                  {WHOLESALER_NAMES[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>
              Eget namn {form.wholesaler === "other" ? "" : <span className="text-muted">(valfritt)</span>}
            </span>
            <input
              className={inputCls}
              value={form.displayName}
              onChange={(e) => patch("displayName", e.target.value)}
              placeholder={form.wholesaler === "other" ? "Grossistens namn" : "t.ex. Ahlsell Västberga"}
            />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={labelCls}>Kundnummer hos grossisten</span>
            <input
              className={inputCls}
              value={form.customerNumber}
              onChange={(e) => patch("customerNumber", e.target.value)}
              id={`${ids}-kundnummer`}
              required
            />
          </label>
          <label className="block">
            <span className={labelCls}>Ordermejl eller säljarens e-post</span>
            <input
              className={inputCls}
              type="email"
              inputMode="email"
              value={form.orderEmail}
              onChange={(e) => patch("orderEmail", e.target.value)}
              id={`${ids}-ordermejl`}
              placeholder="order@grossisten.se"
              required
            />
          </label>
        </div>
        <p className="text-[12.5px] text-muted">
          Du anger själv vilken adress som tar emot beställningar – fråga din säljare om du är osäker.
        </p>
        <label className="flex items-center gap-2 text-[14px] text-ink">
          <input type="checkbox" className="size-4" checked={form.ccSelf} onChange={(e) => patch("ccSelf", e.target.checked)} />
          Skicka en kopia till min egen e-post
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={labelCls}>Standardval</span>
            <select
              className={inputCls}
              value={form.defaultDeliveryMode}
              onChange={(e) => patch("defaultDeliveryMode", e.target.value as typeof form.defaultDeliveryMode)}
            >
              <option value="pickup">{DELIVERY_MODE_LABELS.pickup}</option>
              <option value="delivery">{DELIVERY_MODE_LABELS.delivery}</option>
            </select>
          </label>
          {form.defaultDeliveryMode === "pickup" ? (
            <label className="block">
              <span className={labelCls}>Standardbutik eller hämtningsplats</span>
              <input className={inputCls} value={form.defaultStore} onChange={(e) => patch("defaultStore", e.target.value)} />
            </label>
          ) : (
            <label className="block">
              <span className={labelCls}>Standardleveransadress</span>
              <input
                className={inputCls}
                value={form.defaultDeliveryAddress}
                onChange={(e) => patch("defaultDeliveryAddress", e.target.value)}
              />
            </label>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={labelCls}>Kontaktperson hos grossisten</span>
            <input className={inputCls} value={form.contactPerson} onChange={(e) => patch("contactPerson", e.target.value)} />
          </label>
          <label className="block">
            <span className={labelCls}>Telefonnummer</span>
            <input className={inputCls} inputMode="tel" value={form.phone} onChange={(e) => patch("phone", e.target.value)} />
          </label>
        </div>

        <fieldset className="rounded-2xl border border-line/80 p-4">
          <legend className="px-1 text-[13px] font-medium text-muted">Kundpris på material från grossisten</legend>
          <div className="space-y-2 text-[14px]">
            <label className="flex items-start gap-2">
              <input type="radio" name="rule" className="mt-1" checked={form.ruleKind === "later"} onChange={() => patch("ruleKind", "later")} />
              <span>
                <span className="font-medium text-ink">Ange kundpris senare</span>
                <span className="block text-[13px] text-soft">Inköpspriset följer med, du sätter kundpriset när materialet bekräftats.</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="rule" className="mt-1" checked={form.ruleKind === "markup"} onChange={() => patch("ruleKind", "markup")} />
              <span className="flex-1">
                <span className="font-medium text-ink">Beräkna med påslag på inköpspriset</span>
                {form.ruleKind === "markup" ? (
                  <span className="mt-1.5 flex items-center gap-2 text-[13px] text-soft">
                    Påslag
                    <input
                      className={cx(inputCls, "w-24 py-1.5")}
                      inputMode="decimal"
                      value={form.markupPercent}
                      onChange={(e) => patch("markupPercent", e.target.value)}
                      aria-label="Påslag i procent"
                    />
                    %
                  </span>
                ) : null}
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="rule"
                className="mt-1"
                checked={form.ruleKind === "file_sales_price"}
                onChange={() => patch("ruleKind", "file_sales_price")}
              />
              <span>
                <span className="font-medium text-ink">Använd utpris från prisfilen</span>
                <span className="block text-[13px] text-soft">Kräver att filen innehåller ett rekommenderat eller avtalat utpris.</span>
              </span>
            </label>
          </div>
        </fieldset>
        {error ? <p className="text-[14px] font-medium text-danger">{error}</p> : null}
        <button type="submit" className="sr-only">
          Spara
        </button>
      </form>
    </Modal>
  );
}

/* ------------------------------ prisfil: import ---------------------------- */

type UploadState =
  | { step: "pick" }
  | { step: "preview"; file: File; preview: ImportPreview; mapping: WholesalerColumnMapping }
  | { step: "done"; message: string; ok: boolean; errors?: { row: number; message: string }[] };

async function postPriceFile(
  connectionId: string,
  file: File,
  mode: "preview" | "import",
  mapping?: WholesalerColumnMapping,
): Promise<Record<string, unknown>> {
  const body = new FormData();
  body.set("connectionId", connectionId);
  body.set("mode", mode);
  if (mapping) body.set("mapping", JSON.stringify(mapping));
  body.set("file", file, file.name);
  const res = await fetch("/api/grossist/prisfil", { method: "POST", body });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!json) return { ok: false, error: "Servern svarade inte. Försök igen." };
  return json;
}

function PriceFileModal({ connection, onClose }: { connection: WholesalerConnection; onClose: () => void }) {
  const router = useRouter();
  const [state, setState] = useState<UploadState>({ step: "pick" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const label = connectionLabel(connection);

  useEffect(() => {
    if (state.step === "pick") {
      const t = window.setTimeout(() => fileRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
  }, [state.step]);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const json = await postPriceFile(connection.id, file, "preview");
      if (json.ok !== true) {
        setError(String(json.error ?? "Filen kunde inte läsas."));
        return;
      }
      const preview = json.preview as ImportPreview;
      setState({ step: "preview", file, preview, mapping: preview.mapping });
    } catch {
      setError("Filen kunde inte skickas. Kontrollera uppkopplingen och försök igen.");
    } finally {
      setBusy(false);
    }
  }

  async function remap(next: WholesalerColumnMapping) {
    if (state.step !== "preview") return;
    setState({ ...state, mapping: next });
    setBusy(true);
    try {
      const json = await postPriceFile(connection.id, state.file, "preview", next);
      if (json.ok === true) {
        const preview = json.preview as ImportPreview;
        setState((s) => (s.step === "preview" ? { ...s, preview, mapping: preview.mapping } : s));
      }
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (state.step !== "preview") return;
    setError(null);
    setBusy(true);
    try {
      const json = await postPriceFile(connection.id, state.file, "import", state.mapping);
      if (json.ok === true) {
        setState({ step: "done", ok: true, message: String(json.message ?? "Prislistan importerades.") });
      } else {
        setState({
          step: "done",
          ok: false,
          message: String(json.error ?? "Importen misslyckades."),
          errors: Array.isArray(json.errors) ? (json.errors as { row: number; message: string }[]) : undefined,
        });
      }
      router.refresh();
    } catch {
      setError("Importen kunde inte genomföras. Den tidigare prislistan gäller fortfarande.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      title={`Prisfil för ${label}`}
      size="lg"
      footer={
        state.step === "preview" ? (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" className={buttonClasses("ghost")} disabled={busy} onClick={() => setState({ step: "pick" })}>
              Välj annan fil
            </button>
            <button
              type="button"
              className={buttonClasses("primary")}
              disabled={busy || state.preview.problems.length > 0}
              onClick={runImport}
            >
              {busy ? "Importerar …" : state.preview.discountLetter ? "Spara rabatter" : "Importera prislistan"}
            </button>
          </div>
        ) : (
          <div className="flex justify-end">
            <button type="button" className={buttonClasses("primary")} disabled={busy} onClick={onClose}>
              {state.step === "done" ? "Klar" : "Stäng"}
            </button>
          </div>
        )
      }
    >
      <div className="px-6 py-5">
        {state.step === "pick" ? (
          <div className="space-y-4">
            <p className="text-[14px] leading-relaxed text-soft">
              Ladda upp grossistens prislista, rabattbrev eller din kundspecifika nettoprislista. CSV, TXT, Excel
              (.xlsx), XML eller ZIP fungerar – vi känner igen kolumnerna åt dig och du får kontrollera innan
              något ersätts.
            </p>
            <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line-strong px-6 py-8 text-center hover:border-accent">
              <FileUp className="size-6 text-accent" />
              <span className="text-[14px] font-medium text-ink">{busy ? "Läser filen …" : "Välj prisfil"}</span>
              <span className="text-[12.5px] text-muted">Max 8 MB. Den nuvarande prislistan påverkas inte förrän du bekräftar.</span>
              <input
                ref={fileRef}
                type="file"
                className="sr-only"
                accept=".csv,.txt,.xlsx,.xml,.zip,text/csv,text/plain,application/xml,text/xml,application/zip,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={busy}
                onChange={(e) => pick(e.target.files?.[0])}
                data-price-file-input
              />
            </label>
            {error ? <p className="text-[14px] font-medium text-danger">{error}</p> : null}
          </div>
        ) : null}

        {state.step === "preview" ? (
          <PreviewStep state={state} busy={busy} onRemap={remap} error={error} />
        ) : null}

        {state.step === "done" ? (
          <div className="space-y-3">
            <p className={cx("flex items-start gap-2 text-[15px] font-medium", state.ok ? "text-ink" : "text-danger")}>
              {state.ok ? <CheckCircle2 className="mt-0.5 size-5 text-ok" /> : <AlertTriangle className="mt-0.5 size-5" />}
              {state.message}
            </p>
            {state.errors && state.errors.length > 0 ? (
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-xl bg-canvas p-3 text-[13px] text-soft">
                {state.errors.map((e) => (
                  <li key={`${e.row}-${e.message}`}>{e.message}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function PreviewStep({
  state,
  busy,
  onRemap,
  error,
}: {
  state: Extract<UploadState, { step: "preview" }>;
  busy: boolean;
  onRemap: (m: WholesalerColumnMapping) => void;
  error: string | null;
}) {
  const { preview, mapping } = state;
  // Samma referensregel som servern: rubriken när den är unik, annars "#N".
  const headerOptions = useMemo(
    () =>
      preview.headers.map((h, i) => {
        const duplicate = preview.headers.indexOf(h) !== i || preview.headers.lastIndexOf(h) !== i;
        return { value: /^#\d+$/.test(h) || duplicate ? `#${i + 1}` : h, label: h };
      }),
    [preview.headers],
  );
  const usedRefs = new Set(Object.values(mapping).filter(Boolean));

  function setColumn(key: WholesalerColumnKey, ref: string) {
    const next: WholesalerColumnMapping = { ...mapping };
    if (!ref) delete next[key];
    else next[key] = ref;
    onRemap(next);
  }

  return (
    <div className="space-y-5">
      <div className="text-[14px] text-soft">
        <p>
          <span className="font-medium text-ink">{preview.innerFilename}</span> · {preview.rowCount.toLocaleString("sv-SE")}{" "}
          rader
          {preview.kind === "zip" ? " · läst ur ZIP-arkivet" : ""}
        </p>
        {preview.discountLetter ? (
          <p className="mt-1 flex items-start gap-2 text-warn">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Filen ser ut som ett rabattbrev. Rabattgrupperna sparas och används när du laddar upp artikel- eller
            prislistan.
          </p>
        ) : null}
      </div>

      {preview.problems.length > 0 ? (
        <ul className="space-y-1 rounded-xl bg-warn-soft/40 px-4 py-3 text-[14px] text-warn">
          {preview.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 text-[14px] text-ok">
          <CheckCircle2 className="size-4" /> Kolumnerna är identifierade. Kontrollera och importera.
        </p>
      )}

      <div>
        <p className="mb-2 text-[13px] font-medium text-muted">Vilken kolumn är vad?</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {COLUMN_KEYS.map((key) => {
            const current = mapping[key] ?? "";
            const conf = preview.confidence[key];
            return (
              <label key={key} className="block rounded-xl border border-line/80 px-3 py-2">
                <span className="flex items-center justify-between text-[13px] text-muted">
                  <span>{COLUMN_LABELS[key]}</span>
                  {conf === "low" ? <span className="text-[11px] text-warn">Gissning</span> : null}
                </span>
                <select
                  className={cx(inputCls, "mt-1 py-1.5 text-[14px]")}
                  value={current}
                  disabled={busy}
                  onChange={(e) => setColumn(key, e.target.value)}
                  aria-label={COLUMN_LABELS[key]}
                >
                  <option value="">Finns inte i filen</option>
                  {headerOptions.map((o) => (
                    <option key={o.value} value={o.value} disabled={usedRefs.has(o.value) && o.value !== current}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {COLUMN_HINTS[key] ? <span className="mt-1 block text-[11.5px] text-muted">{COLUMN_HINTS[key]}</span> : null}
              </label>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-2 text-[13px] font-medium text-muted">De första raderna</p>
        <div className="overflow-x-auto rounded-xl border border-line/80">
          <table className="min-w-full text-[12.5px]">
            <thead className="bg-canvas text-left text-muted">
              <tr>
                {preview.headers.map((h, i) => (
                  <th key={`${h}-${i}`} className="whitespace-nowrap px-2 py-1.5 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.sampleRows.map((row, ri) => (
                <tr key={ri} className="border-t border-line/60">
                  {preview.headers.map((_, ci) => (
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
      {error ? <p className="text-[14px] font-medium text-danger">{error}</p> : null}
      <p className="text-[12.5px] text-muted">
        Den nya prislistan blir aktiv först när alla{" "}
        <span className="font-medium text-ink">{preview.rowCount.toLocaleString("sv-SE")}</span> rader gått igenom. Går
        något fel behåller vi den gamla listan.
      </p>
    </div>
  );
}
