"use client";

import { useEffect, useState } from "react";
import { useOffline } from "next/offline";
import { CloudOff, RefreshCw, AlertTriangle } from "lucide-react";
import { queueSummary, subscribeOffline, syncNow } from "@/lib/offline/client";
import type { QueueSummary } from "@/lib/offline/queue";
import { AppLink } from "@/components/app-link";
import { cx } from "@/components/ui-classes";

const EMPTY: QueueSummary = { pending: 0, syncing: 0, synced: 0, parked: 0 };

/**
 * Statuspill för anslutning och offline-kö (spec §9). Syns bara när något
 * avviker: offline, ärenden som väntar/synkar, eller parkerade konflikter.
 * Online utan kö = ingenting – vardagen ska inte ha en permanent bricka.
 *
 * Synkar automatiskt när nätet kommer tillbaka och när kön ändras online.
 */
export function ConnectivityStatus() {
  const offline = useOffline();
  const [summary, setSummary] = useState<QueueSummary>(EMPTY);

  useEffect(() => {
    let alive = true;
    const refresh = () => void queueSummary().then((s) => alive && setSummary(s));
    refresh();
    const unsub = subscribeOffline(refresh);
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  const outstanding = summary.pending + summary.syncing;
  useEffect(() => {
    if (offline || outstanding === 0) return;
    const t = window.setTimeout(() => void syncNow().catch(() => {}), 400);
    return () => window.clearTimeout(t);
  }, [offline, outstanding]);

  useEffect(() => {
    const onOnline = () => void syncNow().catch(() => {});
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  // Backoff-omgångar: så länge något väntar prövas kön igen med jämna
  // mellanrum; nextBatch släpper bara igenom det vars backoff löpt ut.
  useEffect(() => {
    if (offline || outstanding === 0) return;
    const t = window.setInterval(() => void syncNow().catch(() => {}), 15_000);
    return () => window.clearInterval(t);
  }, [offline, outstanding]);

  if (!offline && outstanding === 0 && summary.parked === 0) return null;

  const tone = offline ? "bg-ink text-canvas" : summary.parked > 0 ? "bg-danger/10 text-danger" : "bg-accent/10 text-accent";
  const Icon = offline ? CloudOff : summary.parked > 0 && outstanding === 0 ? AlertTriangle : RefreshCw;
  const label = offline
    ? outstanding > 0
      ? `Offline · ${outstanding} ${outstanding === 1 ? "ändring väntar" : "ändringar väntar"}`
      : "Offline"
    : outstanding > 0
      ? `Synkar ${outstanding} ${outstanding === 1 ? "ändring" : "ändringar"} …`
      : `${summary.parked} ${summary.parked === 1 ? "ändring behöver dig" : "ändringar behöver dig"}`;

  return (
    <AppLink
      href="/falt"
      className={cx(
        "fixed bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-full px-3.5 py-1.5 text-xs font-medium shadow-lg backdrop-blur md:bottom-4 md:left-auto md:right-4 md:translate-x-0",
        "inline-flex items-center gap-2 transition-colors",
        tone
      )}
      aria-live="polite"
    >
      <Icon className={cx("size-3.5", !offline && outstanding > 0 && "animate-spin")} strokeWidth={2} />
      {label}
    </AppLink>
  );
}
