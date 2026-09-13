"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOffline } from "next/offline";
import { Camera, CheckCircle2, CloudOff, Pause, Play, Receipt, RefreshCw, Trash2, Wrench } from "lucide-react";
import {
  activeTimer,
  cachedJobs,
  discardMutation,
  enqueue,
  ensureBinding,
  listMutations,
  retryMutation,
  setActiveTimer,
  setCachedJobs,
  subscribeOffline,
  syncNow,
  type SyncOutcome,
} from "@/lib/offline/client";
import { offlineEncryptionAvailable, type ActiveTimer } from "@/lib/offline/idb";
import { KIND_LABEL, minimizeJob } from "@/lib/offline/queue";
import type { CachedJob, OfflineMutation } from "@/lib/offline/types";
import { Badge, Card, buttonClasses, cx, type BadgeTone } from "./ui";

export interface FieldModeJob {
  id: string;
  title: string;
  status: "kommande" | "pagar" | "klart";
  customerName: string;
  address?: string;
}

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-soft";

const MAX_PHOTO_EDGE = 1600;

/** Komprimera till JPEG ≤ 1600 px – uppdragsfoton lagras som data-URL på servern. */
async function compressImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.82));
  } catch {
    return file;
  }
}

function hoursBetween(startedAt: string, now: number): number {
  return Math.max(0, (now - Date.parse(startedAt)) / 3_600_000);
}

function fmtDuration(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h} h ${m.toString().padStart(2, "0")} min` : `${m} min`;
}

function statusTone(s: OfflineMutation["status"]): BadgeTone {
  switch (s) {
    case "synced":
      return "ok";
    case "syncing":
      return "info";
    case "conflict":
    case "rejected":
    case "failed":
      return "danger";
    default:
      return "warn";
  }
}

const STATUS_LABEL: Record<OfflineMutation["status"], string> = {
  pending: "Väntar",
  blocked: "Väntar",
  syncing: "Synkar",
  synced: "Synkad",
  conflict: "Konflikt",
  failed: "Misslyckades",
  rejected: "Avvisad",
};

export function FieldMode({
  session,
  jobs,
  customers,
  today,
}: {
  session: { businessId: string; userId: string } | null;
  jobs: FieldModeJob[];
  customers: { id: string; name: string }[];
  today: string;
}) {
  const offline = useOffline();
  const [cached, setCached] = useState<CachedJob[]>([]);
  const [queue, setQueue] = useState<OfflineMutation[]>([]);
  const [timer, setTimer] = useState<ActiveTimer | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [bound, setBound] = useState(false);

  const refresh = useCallback(async () => {
    const [c, q, t] = await Promise.all([cachedJobs(), listMutations(), activeTimer().catch(() => null)]);
    setCached(c);
    setQueue(q);
    setTimer(t);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const decision = await ensureBinding(session).catch(() => "keep" as const);
      if (!alive) return;
      setBound(session !== null && decision !== "wipe");
      await refresh();
    })();
    const unsub = subscribeOffline(() => void refresh());
    return () => {
      alive = false;
      unsub();
    };
  }, [session, refresh]);

  useEffect(() => {
    if (!timer) return;
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const t = window.setInterval(tick, 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(t);
    };
  }, [timer]);

  const cachedIds = useMemo(() => new Set(cached.map((j) => j.id)), [cached]);

  async function toggleJob(job: FieldModeJob) {
    const next = cachedIds.has(job.id)
      ? cached.filter((j) => j.id !== job.id)
      : [...cached, minimizeJob(job, job.customerName, new Date().toISOString())];
    await setCachedJobs(next);
  }

  async function runSync() {
    setSyncing(true);
    try {
      const r: SyncOutcome = await syncNow();
      if (r.kind === "wiped") setNotice(r.message);
      else if (r.kind === "blocked") setNotice(r.message);
      else if (r.kind === "offline") setNotice("Ingen anslutning – ändringarna ligger kvar och synkas när nätet är tillbaka.");
      else setNotice(null);
    } finally {
      setSyncing(false);
    }
  }

  const parked = queue.filter((m) => m.status === "conflict" || m.status === "failed" || m.status === "rejected");
  const waiting = queue.filter((m) => m.status === "pending" || m.status === "syncing" || m.status === "blocked");

  if (!session) {
    return (
      <Card className="p-5 text-soft">
        Fältläget är avstängt i demon. I ett riktigt konto väljer du här vilka uppdrag som ska följa med i enheten och
        registrerar tid, foton och kvitton på dem utan nät.
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-soft">
        {offline ? (
          <Badge tone="neutral">
            <CloudOff className="size-3.5" /> Offline
          </Badge>
        ) : (
          <Badge tone="ok">Online</Badge>
        )}
        <span>
          {cached.length} {cached.length === 1 ? "uppdrag" : "uppdrag"} i enheten · {waiting.length} väntar
          {parked.length ? ` · ${parked.length} behöver dig` : ""}
        </span>
        {typeof window !== "undefined" && !offlineEncryptionAvailable() ? (
          <span className="text-danger">Lokal kryptering saknas i den här webbläsaren.</span>
        ) : null}
        <button
          type="button"
          onClick={() => void runSync()}
          disabled={syncing || offline || waiting.length === 0}
          className={buttonClasses("secondary", "sm", "ml-auto")}
        >
          <RefreshCw className={cx("size-3.5", syncing && "animate-spin")} /> Synka nu
        </button>
      </div>
      {notice ? <p className="rounded-xl bg-warn-soft px-4 py-3 text-[14px] text-ink">{notice}</p> : null}

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-ink">Uppdrag att ha med</h2>
        <p className="text-[13px] text-soft">
          Bara titel, kundnamn och adress sparas i enheten – inget mer. Välj med nät; listan finns kvar offline.
        </p>
        {jobs.length === 0 && cached.length === 0 ? (
          <Card className="p-5 text-soft">Inga öppna uppdrag. Skapa ett uppdrag först, eller lägg upp ett utkast längre ner.</Card>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
            {(offline ? cached.map((c) => ({ ...c, status: c.status })) : jobs).map((job) => {
              const on = cachedIds.has(job.id);
              return (
                <li key={job.id}>
                  <label className="flex cursor-pointer items-start gap-3 px-4 py-3">
                    <input
                      type="checkbox"
                      className="mt-1 size-4 accent-accent"
                      checked={on}
                      disabled={offline || !bound}
                      onChange={() => void toggleJob(job as FieldModeJob)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink">{job.title}</span>
                      <span className="block truncate text-[13px] text-soft">
                        {job.customerName}
                        {job.address ? ` · ${job.address}` : ""}
                      </span>
                    </span>
                    <Badge tone={job.status === "pagar" ? "info" : "neutral"}>{job.status === "pagar" ? "Pågår" : "Kommande"}</Badge>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {cached.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-[15px] font-semibold text-ink">Registrera på plats</h2>
          <div className="space-y-4">
            {cached.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                today={today}
                timer={timer?.jobId === job.id ? timer : null}
                otherTimerRunning={!!timer && timer.jobId !== job.id}
                now={now}
                onNotice={setNotice}
              />
            ))}
          </div>
        </section>
      ) : null}

      <ReceiptCard onNotice={setNotice} disabled={!bound} />
      <DraftCard customers={customers} today={today} disabled={!bound} onNotice={setNotice} />

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-ink">Kö</h2>
        {queue.length === 0 ? (
          <p className="text-[13px] text-soft">Inget väntar på synk.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
            {[...queue].sort((a, b) => b.seq - a.seq).map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Badge tone={statusTone(m.status)}>{STATUS_LABEL[m.status]}</Badge>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium text-ink">{KIND_LABEL[m.kind]}</span>
                  <span className="block text-[12px] text-soft">
                    {new Date(m.createdAt).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })}
                    {m.lastError ? ` · ${m.lastError}` : ""}
                  </span>
                </span>
                {m.status === "conflict" || m.status === "failed" || m.status === "rejected" ? (
                  <span className="flex gap-2">
                    {m.status !== "rejected" ? (
                      <button type="button" className={buttonClasses("secondary", "sm")} onClick={() => void retryMutation(m.id)}>
                        Försök igen
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={buttonClasses("danger-outline", "sm")}
                      onClick={() => {
                        if (window.confirm("Ta bort ändringen från enheten? Den har inte sparats på servern.")) void discardMutation(m.id);
                      }}
                    >
                      <Trash2 className="size-3.5" /> Ta bort
                    </button>
                  </span>
                ) : m.status === "synced" ? (
                  <CheckCircle2 className="size-4 text-ok" />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ------------------------------ Uppdragskort ------------------------------ */

function JobCard({
  job,
  today,
  timer,
  otherTimerRunning,
  now,
  onNotice,
}: {
  job: CachedJob;
  today: string;
  timer: ActiveTimer | null;
  otherTimerRunning: boolean;
  now: number;
  onNotice: (s: string | null) => void;
}) {
  const [hours, setHours] = useState("");
  const [desc, setDesc] = useState("");
  const [note, setNote] = useState("");
  const [mat, setMat] = useState({ description: "", qty: "1", unit: "st", unitPrice: "" });
  const [busy, setBusy] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  async function guard(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      onNotice(null);
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "Kunde inte spara lokalt.");
    } finally {
      setBusy(false);
    }
  }

  const startTimer = () => guard(() => setActiveTimer({ jobId: job.id, startedAt: new Date().toISOString() }));

  const stopTimer = () =>
    guard(async () => {
      if (!timer) return;
      const h = Math.round(hoursBetween(timer.startedAt, Date.now()) * 4) / 4;
      await setActiveTimer(null);
      if (h < 0.25) {
        onNotice("Kortare än en kvart – ingen tid registrerades.");
        return;
      }
      await enqueue("work_time", { job: { id: job.id }, hours: h, date: today, description: desc.trim() || undefined }, { entityVersion: job.status });
      setDesc("");
    });

  const addHours = () =>
    guard(async () => {
      const h = Number(hours.replace(",", "."));
      if (!Number.isFinite(h) || h <= 0) throw new Error("Ange timmar större än noll.");
      await enqueue("work_time", { job: { id: job.id }, hours: h, date: today, description: desc.trim() || undefined }, { entityVersion: job.status });
      setHours("");
      setDesc("");
    });

  const addNote = () =>
    guard(async () => {
      if (!note.trim()) throw new Error("Skriv en anteckning.");
      await enqueue("work_note", { job: { id: job.id }, text: note.trim() }, { entityVersion: job.status });
      setNote("");
    });

  const addPhoto = (file: File | undefined) =>
    guard(async () => {
      if (!file) return;
      const blob = await compressImage(file);
      await enqueue("job_photo", { job: { id: job.id } }, { blob, entityVersion: job.status });
      if (photoRef.current) photoRef.current.value = "";
    });

  const addMaterial = () =>
    guard(async () => {
      const qty = Number(mat.qty.replace(",", "."));
      const price = Number(mat.unitPrice.replace(",", "."));
      if (!mat.description.trim()) throw new Error("Beskriv materialet.");
      if (!Number.isFinite(qty) || qty <= 0) throw new Error("Ange en mängd större än noll.");
      if (!Number.isFinite(price) || price < 0) throw new Error("Ange pris per enhet (exkl. moms).");
      await enqueue(
        "material",
        { job: { id: job.id }, description: mat.description.trim(), qty, unit: mat.unit.trim() || "st", unitPrice: Math.round(price) },
        { entityVersion: job.status }
      );
      setMat({ description: "", qty: "1", unit: "st", unitPrice: "" });
    });

  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-ink">{job.title}</h3>
          <p className="truncate text-[13px] text-soft">
            {job.customerName}
            {job.address ? ` · ${job.address}` : ""}
          </p>
        </div>
        {timer ? (
          <button type="button" className={buttonClasses("accent", "sm")} onClick={() => void stopTimer()} disabled={busy}>
            <Pause className="size-3.5" /> Stoppa · {fmtDuration(hoursBetween(timer.startedAt, now))}
          </button>
        ) : (
          <button
            type="button"
            className={buttonClasses("primary", "sm")}
            onClick={() => void startTimer()}
            disabled={busy || otherTimerRunning}
            title={otherTimerRunning ? "Stoppa den pågående tiden först" : undefined}
          >
            <Play className="size-3.5" /> Starta tid
          </button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="grid gap-3 sm:grid-cols-[6rem_1fr]">
          <div>
            <label className={labelCls} htmlFor={`h-${job.id}`}>
              Timmar
            </label>
            <input id={`h-${job.id}`} inputMode="decimal" placeholder="2,5" value={hours} onChange={(e) => setHours(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor={`d-${job.id}`}>
              Vad gjorde du? <span className="font-normal text-muted">(valfritt)</span>
            </label>
            <input id={`d-${job.id}`} value={desc} onChange={(e) => setDesc(e.target.value)} className={inputCls} placeholder="Rivning kök" />
          </div>
        </div>
        <button type="button" className={buttonClasses("secondary", "md", "self-end")} onClick={() => void addHours()} disabled={busy}>
          Registrera tid
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <label className={labelCls} htmlFor={`n-${job.id}`}>
            Anteckning
          </label>
          <textarea id={`n-${job.id}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} placeholder="Kunden vill ha vit fog i stället för grå." />
        </div>
        <button type="button" className={buttonClasses("secondary", "md", "self-end")} onClick={() => void addNote()} disabled={busy}>
          Spara anteckning
        </button>
      </div>

      <details className="rounded-xl border border-line p-3">
        <summary className="cursor-pointer text-[14px] font-medium text-ink">
          <Wrench className="mr-1 inline size-4 text-muted" /> Materialrad
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_5rem_5rem_7rem_auto]">
          <input value={mat.description} onChange={(e) => setMat({ ...mat, description: e.target.value })} className={inputCls} placeholder="Gipsskiva 13 mm" aria-label="Beskrivning" />
          <input value={mat.qty} onChange={(e) => setMat({ ...mat, qty: e.target.value })} className={inputCls} inputMode="decimal" aria-label="Mängd" />
          <input value={mat.unit} onChange={(e) => setMat({ ...mat, unit: e.target.value })} className={inputCls} aria-label="Enhet" />
          <input value={mat.unitPrice} onChange={(e) => setMat({ ...mat, unitPrice: e.target.value })} className={inputCls} inputMode="decimal" placeholder="kr/st exkl." aria-label="Pris per enhet exkl. moms" />
          <button type="button" className={buttonClasses("secondary", "md")} onClick={() => void addMaterial()} disabled={busy}>
            Lägg till
          </button>
        </div>
      </details>

      <div>
        <input
          ref={photoRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          id={`p-${job.id}`}
          onChange={(e) => void addPhoto(e.target.files?.[0])}
        />
        <label htmlFor={`p-${job.id}`} className={buttonClasses("secondary", "md", "cursor-pointer")}>
          <Camera className="size-4" /> Ta foto
        </label>
      </div>
    </Card>
  );
}

/* ------------------------------ Kvitto ------------------------------ */

function ReceiptCard({ onNotice, disabled }: { onNotice: (s: string | null) => void; disabled: boolean }) {
  const [note, setNote] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  async function add(file: File | undefined) {
    if (!file) return;
    try {
      const blob = file.type.startsWith("image/") ? await compressImage(file) : file;
      const filename = file.name || (blob.type === "application/pdf" ? "kvitto.pdf" : "kvitto.jpg");
      await enqueue("receipt", { filename, contentType: blob.type || file.type || "image/jpeg", note: note.trim() || undefined }, { blob });
      setNote("");
      if (ref.current) ref.current.value = "";
      onNotice(null);
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "Kunde inte spara kvittot lokalt.");
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-[15px] font-semibold text-ink">Kvitto</h2>
      <Card className="space-y-3 p-4">
        <p className="text-[13px] text-soft">
          Fotografera kvittot nu – det hamnar i bokföringens underlag för kontroll när det synkats. Ingen tolkning görs
          offline.
        </p>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} placeholder="Var och vad (valfritt)" aria-label="Anteckning till kvittot" />
          <input ref={ref} type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" id="falt-kvitto" disabled={disabled} onChange={(e) => void add(e.target.files?.[0])} />
          <label htmlFor="falt-kvitto" className={buttonClasses("secondary", "md", cx("cursor-pointer", disabled && "pointer-events-none opacity-60"))}>
            <Receipt className="size-4" /> Fota kvitto
          </label>
        </div>
      </Card>
    </section>
  );
}

/* ------------------------------ Utkast ------------------------------ */

function DraftCard({
  customers,
  today,
  disabled,
  onNotice,
}: {
  customers: { id: string; name: string }[];
  today: string;
  disabled: boolean;
  onNotice: (s: string | null) => void;
}) {
  const [customerId, setCustomerId] = useState<string>("__ny");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [kind, setKind] = useState<"privat" | "foretag">("privat");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  async function save() {
    try {
      if (!title.trim()) throw new Error("Ge uppdraget en titel.");
      let customer: { id: string } | { localId: string };
      if (customerId === "__ny") {
        if (!name.trim()) throw new Error("Ange kundens namn.");
        const localId = `kund-${Date.now().toString(36)}`;
        await enqueue("customer_draft", { localId, kind, name: name.trim(), phone: phone.trim() || undefined });
        customer = { localId };
      } else {
        customer = { id: customerId };
      }
      await enqueue("job_draft", {
        localId: `uppdrag-${Date.now().toString(36)}`,
        customer,
        title: title.trim(),
        description: description.trim() || undefined,
        startDate: today,
      });
      setName("");
      setPhone("");
      setTitle("");
      setDescription("");
      onNotice("Utkastet ligger i kön och blir ett riktigt uppdrag när det synkats.");
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "Kunde inte spara utkastet lokalt.");
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-[15px] font-semibold text-ink">Nytt uppdrag (utkast)</h2>
      <Card className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="falt-kund">
              Kund
            </label>
            <select id="falt-kund" value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={inputCls}>
              <option value="__ny">Ny kund …</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {customerId === "__ny" ? (
            <>
              <div>
                <label className={labelCls} htmlFor="falt-kundnamn">
                  Namn
                </label>
                <input id="falt-kundnamn" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls} htmlFor="falt-kundtel">
                  Telefon <span className="font-normal text-muted">(valfritt)</span>
                </label>
                <input id="falt-kundtel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} inputMode="tel" />
              </div>
              <div>
                <label className={labelCls} htmlFor="falt-kundtyp">
                  Typ
                </label>
                <select id="falt-kundtyp" value={kind} onChange={(e) => setKind(e.target.value as "privat" | "foretag")} className={inputCls}>
                  <option value="privat">Privatperson</option>
                  <option value="foretag">Företag</option>
                </select>
              </div>
            </>
          ) : null}
          <div className={customerId === "__ny" ? "" : "sm:col-span-1"}>
            <label className={labelCls} htmlFor="falt-titel">
              Uppdrag
            </label>
            <input id="falt-titel" value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="Byte av köksblandare" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="falt-beskrivning">
              Beskrivning <span className="font-normal text-muted">(valfritt)</span>
            </label>
            <textarea id="falt-beskrivning" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
          </div>
        </div>
        <button type="button" className={buttonClasses("primary")} onClick={() => void save()} disabled={disabled}>
          Spara utkast
        </button>
      </Card>
    </section>
  );
}
