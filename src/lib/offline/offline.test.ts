process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { db, replaceDb } from "../store";
import { emptyTestDb, testCustomer } from "../invoices/test-db";
import { createJob, parseJobNotes } from "../services/jobs";
import { jobWorkEntries } from "../services/job-work";
import { resetPlatformRegistry, platformRegistry } from "../platform/registry";
import type { CollaborationActor } from "../collaboration/actor";
import {
  applyResult,
  applyTransportFailure,
  backoffMs,
  bindingDecision,
  blockingDependency,
  MAX_AUTO_ATTEMPTS,
  minimizeJob,
  nextBatch,
  pruneSynced,
  resolveLocalRefs,
  retryNow,
  summarize,
  toWire,
} from "./queue";
import { applyOfflineBatch, parseWireMutation } from "./server";
import type { OfflineMutation, WireMutation } from "./types";
import { serviceWorkerSource, SW_SOURCE } from "../pwa/service-worker-source";

/* ------------------------------ Hjälpare ------------------------------ */

function mutation(partial: Partial<OfflineMutation> & Pick<OfflineMutation, "kind" | "payload" | "seq">): OfflineMutation {
  return {
    id: `id-${partial.seq}-${partial.kind}`,
    businessId: "b1",
    userId: "u1",
    createdAt: "2026-09-13T08:00:00.000Z",
    status: "pending",
    attempts: 0,
    nextAttemptAt: 0,
    ...partial,
  } as OfflineMutation;
}

const OWNER: CollaborationActor = { userId: "u1", email: "a@b.se", name: "Ägare", role: "owner", businessId: "local" };
const AUDITOR: CollaborationActor = { ...OWNER, role: "auditor" };

function wire(id: string, seq: number, kind: WireMutation["kind"], payload: unknown, entityVersion?: string): WireMutation {
  return { id, seq, kind, payload, createdAt: "2026-09-13T08:00:00.000Z", ...(entityVersion ? { entityVersion } : {}) };
}

function reset() {
  replaceDb(emptyTestDb({ customers: [testCustomer({ id: "cust-1", name: "Anna Andersson", email: "anna@example.com" })] }));
  resetPlatformRegistry();
}

/* ------------------------------ Kön (ren logik) ------------------------------ */

describe("offline-kö: backoff och försök", () => {
  it("backoff dubblas från 2 s och tar tak vid 5 min", () => {
    assert.equal(backoffMs(1), 2_000);
    assert.equal(backoffMs(2), 4_000);
    assert.equal(backoffMs(3), 8_000);
    assert.equal(backoffMs(20), 300_000);
    // jitter ±20 %
    assert.equal(backoffMs(1, 0), 1_600);
    assert.equal(backoffMs(1, 1), 2_400);
  });

  it("nätfel räknar upp och parkerar som failed efter MAX_AUTO_ATTEMPTS", () => {
    let m = mutation({ kind: "work_note", seq: 1, payload: { job: { id: "j" }, text: "x" } });
    for (let i = 1; i < MAX_AUTO_ATTEMPTS; i++) {
      m = applyTransportFailure(m, 1_000, "Ingen kontakt");
      assert.equal(m.status, "pending");
      assert.equal(m.attempts, i);
      assert.ok(m.nextAttemptAt > 1_000);
    }
    m = applyTransportFailure(m, 1_000, "Ingen kontakt");
    assert.equal(m.status, "failed");
    assert.match(m.lastError ?? "", /försök/);
    const again = retryNow(m, 5_000);
    assert.equal(again.status, "pending");
    assert.equal(again.attempts, 0);
    assert.equal(again.nextAttemptAt, 5_000);
  });

  it("serverutfall mappas: synced får ref, konflikt/avvisad/misslyckad får meddelande", () => {
    const m = mutation({ kind: "work_note", seq: 1, payload: { job: { id: "j" }, text: "x" } });
    assert.equal(applyResult(m, { id: m.id, outcome: "synced", ref: "e1" }).serverRef, "e1");
    assert.equal(applyResult(m, { id: m.id, outcome: "conflict", message: "Ändrad" }).status, "conflict");
    assert.equal(applyResult(m, { id: m.id, outcome: "rejected" }).status, "rejected");
    assert.equal(applyResult(m, { id: m.id, outcome: "failed" }).lastError, "Kunde inte spara.");
  });
});

describe("offline-kö: ordning och beroenden", () => {
  const customer = mutation({ kind: "customer_draft", seq: 1, payload: { localId: "k1", kind: "privat", name: "Ny" } });
  const job = mutation({ kind: "job_draft", seq: 2, payload: { localId: "j1", customer: { localId: "k1" }, title: "T" } });
  const time = mutation({ kind: "work_time", seq: 3, payload: { job: { localId: "j1" }, hours: 2, date: "2026-09-13" } });
  const photo = mutation({ kind: "job_photo", seq: 4, payload: { job: { id: "server-job" } } });

  it("nästa omgång skickar bara det vars producenter är synkade", () => {
    const batch = nextBatch([customer, job, time, photo], 0);
    assert.deepEqual(
      batch.map((m) => m.kind),
      ["customer_draft", "job_photo"]
    );
    assert.equal(blockingDependency(job, [customer, job])?.id, customer.id);
    assert.equal(blockingDependency(photo, [customer, job, photo]), null);
  });

  it("en parkerad producent blockerar bara det som beror på den", () => {
    const failedCustomer = { ...customer, status: "failed" as const };
    const batch = nextBatch([failedCustomer, job, time, photo], 0);
    assert.deepEqual(
      batch.map((m) => m.kind),
      ["job_photo"]
    );
  });

  it("backoff respekteras och seq-ordningen håller", () => {
    const early = mutation({ kind: "work_note", seq: 5, payload: { job: { id: "x" }, text: "a" }, nextAttemptAt: 10_000 });
    const late = mutation({ kind: "work_note", seq: 6, payload: { job: { id: "x" }, text: "b" } });
    assert.deepEqual(nextBatch([late, early], 5_000).map((m) => m.seq), [6]);
    assert.deepEqual(nextBatch([late, early], 20_000).map((m) => m.seq), [5, 6]);
  });

  it("lokala utkast-referenser byts mot serverns id när producenten är synkad", () => {
    const syncedCustomer = { ...customer, status: "synced" as const, serverRef: "cust-9" };
    const resolved = resolveLocalRefs(job, [syncedCustomer, job]);
    assert.deepEqual((resolved.payload as { customer: unknown }).customer, { id: "cust-9" });
    const unresolved = resolveLocalRefs(time, [syncedCustomer, job, time]);
    assert.deepEqual((unresolved.payload as { job: unknown }).job, { localId: "j1" });
  });

  it("trådformatet bär ingen klientstatus", () => {
    const w = toWire({ ...time, status: "syncing", attempts: 3, lastError: "x", entityVersion: "pagar" });
    assert.deepEqual(Object.keys(w).sort(), ["createdAt", "entityVersion", "id", "kind", "payload", "seq"]);
  });

  it("gallring behåller producenter som fortfarande refereras", () => {
    const many: OfflineMutation[] = [];
    for (let i = 0; i < 205; i++) {
      many.push(mutation({ kind: "work_note", seq: i + 10, payload: { job: { id: "x" }, text: "a" }, status: "synced", id: `n-${i}` }));
    }
    const syncedCustomer = { ...customer, status: "synced" as const, serverRef: "cust-9", seq: 1 };
    const pendingJob = { ...job, seq: 2 };
    const pruned = pruneSynced([syncedCustomer, pendingJob, ...many], 200);
    assert.ok(pruned.some((m) => m.id === syncedCustomer.id), "refererad producent behålls");
    assert.ok(pruned.some((m) => m.id === pendingJob.id));
    assert.ok(pruned.length < 207);
  });

  it("sammanfattningen räknar väntande, synkande, synkade och parkerade", () => {
    const s = summarize([
      customer,
      { ...job, status: "syncing" },
      { ...time, status: "synced" },
      { ...photo, status: "conflict" },
      mutation({ kind: "work_note", seq: 9, payload: { job: { id: "x" }, text: "a" }, status: "rejected" }),
    ]);
    assert.deepEqual(s, { pending: 1, syncing: 1, synced: 1, parked: 2 });
  });
});

describe("offline-kö: tenantbindning och dataminimering", () => {
  it("bindning: bind första gången, behåll samma, rensa vid byte eller utloggning", () => {
    const stored = { businessId: "b1", userId: "u1", boundAt: "2026-09-13T00:00:00.000Z" };
    assert.equal(bindingDecision(null, { businessId: "b1", userId: "u1" }), "bind");
    assert.equal(bindingDecision(stored, { businessId: "b1", userId: "u1" }), "keep");
    assert.equal(bindingDecision(stored, { businessId: "b2", userId: "u1" }), "wipe");
    assert.equal(bindingDecision(stored, { businessId: "b1", userId: "u2" }), "wipe");
    assert.equal(bindingDecision(stored, null), "wipe");
    assert.equal(bindingDecision(null, null), "keep");
  });

  it("cachat uppdrag innehåller bara id, titel, kundnamn, status, adress och tid", () => {
    const cached = minimizeJob(
      { id: "j1", title: "Kök", status: "pagar", address: "Storgatan 1" } as never,
      "Anna Andersson",
      "2026-09-13T08:00:00.000Z"
    );
    assert.deepEqual(Object.keys(cached).sort(), ["address", "cachedAt", "customerName", "id", "status", "title"]);
  });
});

/* ------------------------------ Servern ------------------------------ */

describe("offline-synk: parse", () => {
  it("avvisar okänd typ och trasig payload med svenska meddelanden", () => {
    assert.equal(parseWireMutation({ kind: "delete_everything", payload: {} }).ok, false);
    const r = parseWireMutation({ kind: "work_time", payload: { job: { id: "j" }, hours: 30, date: "2026-09-13" } });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /timmar/i);
    const local = parseWireMutation({ kind: "work_time", payload: { job: { localId: "j" }, hours: 1, date: "2026-09-13" } });
    assert.equal(local.ok, false, "olösta lokala referenser accepteras inte av servern");
  });

  it("accepterar och normaliserar giltiga ärenden", () => {
    const r = parseWireMutation({ kind: "material", payload: { job: { id: "j" }, description: "  Gips ", qty: 2, unitPrice: 120, unit: "st" } });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal((r.payload as { description: string }).description, "Gips");
  });
});

describe("offline-synk: tillämpning", () => {
  beforeEach(reset);

  it("arbetstid, anteckning och material tillämpas via tjänsterna och kvitteras", async () => {
    const job = createJob({ customerId: "cust-1", title: "Kök" });
    const results = await applyOfflineBatch(
      [
        wire("aaaaaaaa-1", 1, "work_time", { job: { id: job.id }, hours: 2.5, date: "2026-09-13", description: "Rivning" }, "kommande"),
        wire("aaaaaaaa-2", 2, "work_note", { job: { id: job.id }, text: "Kunden vill ha vit fog" }, "kommande"),
        wire("aaaaaaaa-3", 3, "material", { job: { id: job.id }, description: "Gips", qty: 4, unitPrice: 110 }, "kommande"),
      ],
      OWNER
    );
    assert.deepEqual(results.map((r) => r.outcome), ["synced", "synced", "synced"]);
    const entries = jobWorkEntries(job.id).filter((e) => e.role === "actual");
    assert.equal(entries.length, 2);
    assert.equal(entries.find((e) => e.type === "labor")?.qty, 2.5);
    assert.equal(parseJobNotes(db().jobs.find((j) => j.id === job.id)!.notes)[0]?.text, "Kunden vill ha vit fog");
    assert.equal(platformRegistry().offlineMutations.length, 3);
  });

  it("idempotens: samma nyckel igen gör ingenting och svarar duplicate med första utfallet", async () => {
    const job = createJob({ customerId: "cust-1", title: "Kök" });
    const batch = [wire("bbbbbbbb-1", 1, "work_time", { job: { id: job.id }, hours: 1, date: "2026-09-13" })];
    const first = await applyOfflineBatch(batch, OWNER);
    const second = await applyOfflineBatch(batch, OWNER);
    assert.equal(first[0].outcome, "synced");
    assert.equal(second[0].outcome, "synced");
    assert.equal(second[0].duplicate, true);
    assert.equal(second[0].ref, first[0].ref);
    assert.equal(jobWorkEntries(job.id).filter((e) => e.role === "actual").length, 1);
  });

  it("konflikt: uppdraget markerades klart medan enheten var offline", async () => {
    const job = createJob({ customerId: "cust-1", title: "Kök" });
    db().jobs.find((j) => j.id === job.id)!.status = "klart";
    const [r] = await applyOfflineBatch([wire("cccccccc-1", 1, "work_time", { job: { id: job.id }, hours: 1, date: "2026-09-13" }, "pagar")], OWNER);
    assert.equal(r.outcome, "conflict");
    assert.match(r.message ?? "", /klart/);
    assert.equal(jobWorkEntries(job.id).filter((e) => e.role === "actual").length, 0);
    // Kvittot finns så en omsändning inte försöker igen i onödan.
    const again = await applyOfflineBatch([wire("cccccccc-1", 1, "work_time", { job: { id: job.id }, hours: 1, date: "2026-09-13" }, "pagar")], OWNER);
    assert.equal(again[0].duplicate, true);
  });

  it("borttaget uppdrag ger konflikt, inte krasch", async () => {
    const [r] = await applyOfflineBatch([wire("dddddddd-1", 1, "work_note", { job: { id: "finns-inte" }, text: "x" })], OWNER);
    assert.equal(r.outcome, "conflict");
  });

  it("capability: revisorn får inte registrera arbete eller kunder", async () => {
    const job = createJob({ customerId: "cust-1", title: "Kök" });
    const results = await applyOfflineBatch(
      [
        wire("eeeeeeee-1", 1, "work_time", { job: { id: job.id }, hours: 1, date: "2026-09-13" }),
        wire("eeeeeeee-2", 2, "customer_draft", { localId: "k", kind: "privat", name: "Ny" }),
      ],
      AUDITOR
    );
    assert.deepEqual(results.map((r) => r.outcome), ["rejected", "rejected"]);
    assert.equal(jobWorkEntries(job.id).filter((e) => e.role === "actual").length, 0);
    assert.equal(db().customers.length, 1);
  });

  it("kund- och uppdragsutkast blir riktiga poster; utkastets kund-id kommer från första svaret", async () => {
    const [c] = await applyOfflineBatch([wire("ffffffff-1", 1, "customer_draft", { localId: "k1", kind: "privat", name: "Bo Berg", phone: "0701234567" })], OWNER);
    assert.equal(c.outcome, "synced");
    assert.ok(c.ref);
    const [j] = await applyOfflineBatch([wire("ffffffff-2", 2, "job_draft", { localId: "j1", customer: { id: c.ref }, title: "Altan", startDate: "2026-09-14" })], OWNER);
    assert.equal(j.outcome, "synced");
    const job = db().jobs.find((x) => x.id === j.ref);
    assert.equal(job?.customerId, c.ref);
    assert.equal(job?.title, "Altan");
  });

  it("kvitto landar i underlagen utan tolkning", async () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").toString("base64");
    const [r] = await applyOfflineBatch([wire("gggggggg-1", 1, "receipt", { filename: "kvitto.png", contentType: "image/png", contentBase64: png, note: "Bauhaus" })], OWNER);
    assert.equal(r.outcome, "synced", r.message);
    const item = db().inboxItems.find((i) => i.id === r.ref);
    assert.ok(item);
  });

  it("ogiltig nyckel eller för stor omgång avvisas", async () => {
    const [r] = await applyOfflineBatch([{ id: "kort", seq: 1, kind: "work_note", payload: {}, createdAt: "x" }], OWNER);
    assert.equal(r.outcome, "rejected");
    await assert.rejects(() => applyOfflineBatch(Array.from({ length: 51 }, (_, i) => wire(`hhhhhhhh-${i}`, i, "work_note", {})), OWNER), /bad_request/);
  });
});

/* ------------------------------ Service worker ------------------------------ */

describe("service worker: cachepolicy", () => {
  type Classify = (req: { method: string; url: string; mode?: string; headers?: { get(n: string): string | null } }, origin: string) => string;

  function load(): Classify {
    const listeners: Record<string, unknown> = {};
    const self = {
      addEventListener: (name: string, fn: unknown) => {
        listeners[name] = fn;
      },
      location: { origin: "https://app.ferva.se" },
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
    } as Record<string, unknown>;
    const ctx = vm.createContext({ self, caches: {}, fetch: () => Promise.reject(new Error("no net")), Response: class {}, URL, console });
    vm.runInContext(serviceWorkerSource("test-1"), ctx);
    assert.ok(listeners.fetch && listeners.install && listeners.activate, "registrerar install/activate/fetch");
    return self.__fervaClassify as Classify;
  }

  const headers = (h: Record<string, string> = {}) => ({ get: (n: string) => h[n] ?? h[n.toLowerCase()] ?? null });
  const req = (url: string, extra: Partial<{ method: string; mode: string; headers: { get(n: string): string | null } }> = {}) => ({
    method: "GET",
    url,
    headers: headers(),
    ...extra,
  });

  it("versionen bakas in och saneras", () => {
    assert.match(serviceWorkerSource("abc123"), /const VERSION = "abc123";/);
    assert.match(serviceWorkerSource("x/../y"), /const VERSION = "x..y";/);
    assert.ok(!SW_SOURCE.includes('const VERSION = "abc'));
  });

  it("hashade artefakter, ikoner och offline-sidan får cachas", () => {
    const classify = load();
    assert.equal(classify(req("https://app.ferva.se/_next/static/chunks/main-abc.js"), "https://app.ferva.se"), "static");
    assert.equal(classify(req("https://app.ferva.se/icons/icon-192.png"), "https://app.ferva.se"), "asset");
    assert.equal(classify(req("https://app.ferva.se/manifest.webmanifest"), "https://app.ferva.se"), "asset");
    assert.equal(classify(req("https://app.ferva.se/offline"), "https://app.ferva.se"), "asset");
  });

  it("navigering går network-only med offline-reserv; allt känsligt lämnas orört", () => {
    const classify = load();
    const o = "https://app.ferva.se";
    assert.equal(classify(req(`${o}/uppdrag`, { mode: "navigate" }), o), "navigation");
    for (const p of [
      "/api/offline/sync",
      "/api/inbox/bilaga/x",
      "/auth/bekrafta",
      "/admin",
      "/admin/system",
      "/redovisning/x",
      "/offert/tok3n",
      "/faktura/tok3n",
      "/andring/tok3n",
      "/uppdrag-kund/tok3n",
      "/sajt/x",
      "/inbjudan/x",
      "/login",
      "/_next/data/x.json",
      "/_next/image?url=x",
    ]) {
      assert.equal(classify(req(`${o}${p}`, { mode: "navigate" }), o), "bypass", p);
    }
    // RSC-payloads och prefetch bär data – aldrig i cache.
    assert.equal(classify(req(`${o}/uppdrag?_rsc=abc`), o), "bypass");
    assert.equal(classify(req(`${o}/uppdrag`, { headers: headers({ RSC: "1" }) }), o), "bypass");
    assert.equal(classify(req(`${o}/uppdrag`, { headers: headers({ "Next-Router-Prefetch": "1" }) }), o), "bypass");
    // Andra origins, POST och vanliga fetch-anrop lämnas.
    assert.equal(classify(req("https://cdn.example.com/x.js"), o), "bypass");
    assert.equal(classify(req(`${o}/_next/static/x.js`, { method: "POST" }), o), "bypass");
    assert.equal(classify(req(`${o}/uppdrag`), o), "bypass");
  });
});
