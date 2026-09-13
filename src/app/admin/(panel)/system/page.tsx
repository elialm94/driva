import { recordRestoreDrillAction, sendTestEmailAction } from "@/app/admin/actions";
import { PendingButton, StateForm, adminInputClass, adminTextareaClass } from "@/components/admin/forms";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { recentFailures, systemStatus, type HealthState } from "@/lib/platform/system";
import { listAdminAudit, listEmailEvents } from "@/lib/platform/store";
import { SUPER_ADMIN } from "@/lib/platform/types";
import { AdminBadge, AdminCard, AdminTable, KeyValueList, Th, Td, datumTidKort } from "@/components/admin/ui";

export const metadata = { title: "System" };

function HealthBadge({ state }: { state: HealthState }) {
  if (state === "ok") return <AdminBadge tone="ok">OK</AdminBadge>;
  if (state === "fel") return <AdminBadge tone="danger">Fel</AdminBadge>;
  // Ärlighet före grönt ljus: "Okänd" när hälsan inte kan verifieras (spec §24).
  return <AdminBadge tone="neutral">Okänd</AdminBadge>;
}

export default async function AdminSystemPage() {
  const ctx = await requirePlatformAdmin();
  const isSuper = ctx.admin.role === SUPER_ADMIN;
  const [status, failures, emailEvents, audit] = await Promise.all([
    systemStatus(),
    recentFailures(30),
    listEmailEvents({ limit: 25 }),
    listAdminAudit({ limit: 40 }),
  ]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-white">System</h1>
        <p className="mt-0.5 text-[13px] text-neutral-500">
          Drifthälsa och fel. Extern leverantörshälsa som inte kan verifieras visas som Okänd –
          aldrig som falskt grönt.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <AdminCard title="Databas & lagring">
          <KeyValueList
            rows={[
              {
                label: "Lagringsläge",
                value:
                  status.storageMode === "supabase" ? (
                    "Supabase/Postgres"
                  ) : (
                    <span>
                      Lokal JSON <AdminBadge tone="warn">endast utveckling</AdminBadge>
                    </span>
                  ),
              },
              {
                label: "Databas",
                value: (
                  <span className="inline-flex items-center gap-2">
                    <HealthBadge state={status.db.state} />
                    {status.db.latencyMs != null ? `${status.db.latencyMs} ms` : null}
                    {status.db.error ? <span className="text-red-400">{status.db.error}</span> : null}
                  </span>
                ),
              },
              {
                label: "Supabase-projekt",
                value: status.supabase.configured ? (status.supabase.projectUrl ?? "Konfigurerat") : "Ej konfigurerat",
              },
              {
                label: "Auth admin-API (service role)",
                value: status.authAdmin.serviceRoleAvailable ? (
                  <AdminBadge tone="ok">Tillgängligt (endast server)</AdminBadge>
                ) : (
                  <AdminBadge tone="warn">Saknas – kontoåtgärder inaktiva</AdminBadge>
                ),
              },
            ]}
          />
        </AdminCard>

        <AdminCard title="Mejl (Resend)">
          <KeyValueList
            rows={[
              {
                label: "Status",
                value: status.resend.configured ? (
                  <HealthBadge state={status.resend.state} />
                ) : (
                  <AdminBadge tone="warn">Ej konfigurerat</AdminBadge>
                ),
              },
              { label: "Avsändare", value: status.resend.fromAddress || "–" },
              {
                label: "Misslyckade utskick 7 d",
                value: status.resend.failures7d,
              },
              {
                label: "Senaste utgående test",
                value: status.emailTest.last
                  ? `${datumTidKort(status.emailTest.last.createdAt)} · ${status.emailTest.last.status === "ok" ? "levererat till Resend" : "misslyckades"}`
                  : "Inget test gjort",
              },
              {
                label: "Inkommande (webhook)",
                value: (
                  <span className="inline-flex items-center gap-2">
                    <HealthBadge state={status.inboundMail.state} />
                    {status.inboundMail.lastEvent
                      ? `senast ${datumTidKort(status.inboundMail.lastEvent.createdAt)} (HTTP ${String(status.inboundMail.lastEvent.summary.httpStatus)})`
                      : "Inget mottaget ännu"}
                  </span>
                ),
              },
            ]}
          />
          <div className="border-t border-neutral-800 px-4 py-3">
            <StateForm action={sendTestEmailAction} className="flex flex-wrap items-center gap-2">
              <PendingButton>Skicka testmejl till {ctx.admin.email}</PendingButton>
              <span className="text-[12px] text-neutral-600">Loggas utan innehåll. Kontrollera SPF/DKIM/DMARC i mottagna rubriker.</span>
            </StateForm>
          </div>
        </AdminCard>

        <AdminCard title="Abonnemang (Stripe)">
          <KeyValueList
            rows={[
              {
                label: "Status",
                value: status.stripe.configured ? (
                  <HealthBadge state={status.stripe.state} />
                ) : (
                  <AdminBadge tone="warn">Ej konfigurerat</AdminBadge>
                ),
              },
              {
                label: "Läge",
                value: status.stripe.mode ? (
                  <AdminBadge tone={status.stripe.mode === "live" ? "ok" : "neutral"}>{status.stripe.mode}</AdminBadge>
                ) : (
                  "–"
                ),
              },
              { label: "Webhookfel 7 d", value: status.stripe.webhookFailures7d },
              { label: "Senaste webhook", value: status.stripe.lastEventAt ? datumTidKort(status.stripe.lastEventAt) : "Ingen mottagen" },
              ...(status.stripe.problems.length
                ? [
                    {
                      label: "Att åtgärda",
                      value: (
                        <ul className="list-disc space-y-0.5 pl-4 text-[12px]">
                          {status.stripe.problems.map((p) => (
                            <li key={p}>{p}</li>
                          ))}
                        </ul>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </AdminCard>

        <AdminCard title="Version & migrationer">
          <KeyValueList
            rows={[
              { label: "Applikationsversion", value: <code className="text-[11px]">{status.version.release}</code> },
              {
                label: "Migrationer",
                value: (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <HealthBadge state={status.migrations.state} />
                    <span className="text-[12px]">
                      DB: <code>{status.migrations.applied ?? "okänd"}</code> · kod: <code>{status.migrations.expected}</code>
                    </span>
                  </span>
                ),
              },
              ...(status.migrations.behind
                ? [{ label: "Att åtgärda", value: <span className="text-red-400">Databasen saknar migrationer – kör `npx supabase db push` (runbook: docs/runbooks/incident.md).</span> }]
                : []),
              ...(status.migrations.error ? [{ label: "Fel", value: <span className="text-amber-300">{status.migrations.error}</span> }] : []),
            ]}
          />
        </AdminCard>

        <AdminCard title="Felövervakning (Sentry)">
          <KeyValueList
            rows={[
              {
                label: "Status",
                value: status.sentry.configured ? (
                  <AdminBadge tone="ok">Konfigurerat</AdminBadge>
                ) : (
                  <AdminBadge tone="warn">Ej konfigurerat (SENTRY_DSN saknas)</AdminBadge>
                ),
              },
              { label: "Server/edge", value: status.sentry.server ? "Ja" : "Nej" },
              { label: "Klient", value: status.sentry.client ? "Ja" : "Nej (NEXT_PUBLIC_SENTRY_DSN saknas)" },
              { label: "Source maps i build", value: status.sentry.sourceMaps ? "Ja" : "Nej" },
              {
                label: "Skrubbning",
                value: "Personnummer, tokens, banktext, dokument- och mejlinnehåll tas bort innan sändning (beforeSend). Korrelations-id sätts som tagg.",
              },
            ]}
          />
        </AdminCard>

        <AdminCard title="Cron, webhooks & integrationer">
          <KeyValueList
            rows={[
              {
                label: "Påminnelsecron",
                value: (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <HealthBadge state={status.cron.state} />
                    {status.cron.lastRun
                      ? `senast ${datumTidKort(status.cron.lastRun.createdAt)} (${status.cron.lastRun.status}, ${String(status.cron.lastRun.summary.businesses ?? 0)} företag, ${String(status.cron.lastRun.summary.errors ?? 0)} fel)`
                      : "Ingen körning loggad ännu"}
                  </span>
                ),
              },
              { label: "Senaste Stripe-webhook", value: status.stripe.lastEventAt ? datumTidKort(status.stripe.lastEventAt) : "Ingen mottagen" },
              { label: "Köade / misslyckade webhooks (7 d)", value: `${status.webhooks.queued} / ${status.webhooks.failed7d}` },
              {
                label: "Bank (Tink)",
                value: status.tink.configured ? (
                  <span className="inline-flex items-center gap-2">
                    <AdminBadge tone="ok">Konfigurerat</AdminBadge>
                    <HealthBadge state={status.tink.state} />
                  </span>
                ) : (
                  <AdminBadge tone="warn">Ej konfigurerat – bankkoppling visas som otillgänglig</AdminBadge>
                ),
              },
              {
                label: "Myndighetsinlämning",
                value:
                  status.filing.provider === "live" ? (
                    <AdminBadge tone="ok">Live-leverantör</AdminBadge>
                  ) : status.filing.provider === "mock" ? (
                    <AdminBadge tone="neutral">Mock (endast demo/dev)</AdminBadge>
                  ) : (
                    <AdminBadge tone="neutral">Manuell inlämning (ingen leverantör)</AdminBadge>
                  ),
              },
            ]}
          />
        </AdminCard>

        <AdminCard title="Backup & återställning">
          <KeyValueList
            rows={[
              {
                label: "PITR/backup i Supabase",
                value: status.backup.lastDrill?.summary.pitrConfirmedOn ? (
                  <span>
                    Bekräftat påslaget {String(status.backup.lastDrill.summary.pitrConfirmedOn)} (manuell kontroll i dashboarden)
                  </span>
                ) : (
                  <AdminBadge tone="warn">Ej verifierat – kan inte läsas via API, se runbook</AdminBadge>
                ),
              },
              {
                label: "Senaste dokumenterade restore drill",
                value: status.backup.lastDrill ? (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <AdminBadge tone={status.backup.stale ? "warn" : "ok"}>
                      {String(status.backup.lastDrill.summary.performedOn)} · {status.backup.lastDrill.status === "ok" ? "godkänd" : "underkänd"}
                    </AdminBadge>
                    <span className="text-[12px]">
                      mot {status.backup.lastDrill.environment} · {status.backup.daysSinceDrill} dagar sedan
                      {status.backup.stale ? " · förfallen (>180 d eller underkänd)" : ""}
                    </span>
                  </span>
                ) : (
                  <AdminBadge tone="danger">Ej verifierat – ingen drill registrerad</AdminBadge>
                ),
              },
              {
                label: "RPO / RTO (observerat)",
                value: status.backup.lastDrill
                  ? `${String(status.backup.lastDrill.summary.rpoMinutes)} min / ${String(status.backup.lastDrill.summary.rtoMinutes)} min`
                  : "Ej verifierat",
              },
              { label: "Ansvarig", value: status.backup.lastDrill ? String(status.backup.lastDrill.summary.responsible) : "Ej angiven" },
            ]}
          />
          {isSuper ? (
            <details className="border-t border-neutral-800 px-4 py-3">
              <summary className="cursor-pointer text-[12.5px] font-medium text-neutral-300">Registrera genomförd restore drill</summary>
              <StateForm action={recordRestoreDrillAction} className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-[12px] text-neutral-400">
                  Datum (ÅÅÅÅ-MM-DD)
                  <input name="performedOn" required pattern="\d{4}-\d{2}-\d{2}" className={adminInputClass} />
                </label>
                <label className="flex flex-col gap-1 text-[12px] text-neutral-400">
                  Staging-miljö (projektref/namn)
                  <input name="targetEnvironment" required className={adminInputClass} placeholder="t.ex. ferva-staging" />
                </label>
                <label className="flex flex-col gap-1 text-[12px] text-neutral-400">
                  Ansvarig
                  <input name="responsible" required className={adminInputClass} />
                </label>
                <label className="flex flex-col gap-1 text-[12px] text-neutral-400">
                  Resultat
                  <select name="result" className={adminInputClass} defaultValue="ok">
                    <option value="ok">Godkänd</option>
                    <option value="fel">Underkänd</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[12px] text-neutral-400">
                  RPO observerat (minuter)
                  <input name="rpoMinutes" type="number" min={0} required className={adminInputClass} />
                </label>
                <label className="flex flex-col gap-1 text-[12px] text-neutral-400">
                  RTO observerat (minuter)
                  <input name="rtoMinutes" type="number" min={0} required className={adminInputClass} />
                </label>
                <label className="flex flex-col gap-1 text-[12px] text-neutral-400">
                  PITR bekräftat påslaget i dashboarden (datum, valfritt)
                  <input name="pitrConfirmedOn" pattern="\d{4}-\d{2}-\d{2}" className={adminInputClass} />
                </label>
                <label className="flex flex-col gap-1 text-[12px] text-neutral-400 sm:col-span-2">
                  RESULT-raden från scripts/restore-drill.ts (JSON, valfritt)
                  <textarea name="checksJson" rows={3} className={adminTextareaClass} />
                </label>
                <label className="flex flex-col gap-1 text-[12px] text-neutral-400 sm:col-span-2">
                  Anteckningar (max 500 tecken, inga kunduppgifter)
                  <textarea name="notes" rows={2} maxLength={500} className={adminTextareaClass} />
                </label>
                <div className="sm:col-span-2">
                  <PendingButton variant="primary">Registrera drill</PendingButton>
                </div>
              </StateForm>
            </details>
          ) : (
            <p className="border-t border-neutral-800 px-4 py-2.5 text-[12px] text-neutral-600">
              Endast super_admin kan registrera en genomförd restore drill.
            </p>
          )}
        </AdminCard>

        <AdminCard title="AI (OpenRouter)">
          <KeyValueList
            rows={[
              {
                label: "Status",
                value: status.ai.configured ? (
                  <HealthBadge state={status.ai.state} />
                ) : (
                  <AdminBadge tone="warn">Ej konfigurerat</AdminBadge>
                ),
              },
              { label: "Leverantör", value: status.ai.provider },
              { label: "Modell (snabb)", value: <code className="text-[11px]">{status.ai.modelFast}</code> },
              { label: "Modell (smart)", value: <code className="text-[11px]">{status.ai.modelSmart}</code> },
              { label: "AI-fel 7 d", value: status.ai.errors7d },
            ]}
          />
        </AdminCard>

        <AdminCard title="Deployment & säkerhet">
          <KeyValueList
            rows={[
              { label: "Miljö", value: status.deployment.vercelEnv ?? status.deployment.nodeEnv },
              {
                label: "Commit",
                value: status.deployment.commitSha ? (
                  <code className="text-[11px]">{status.deployment.commitSha.slice(0, 12)}</code>
                ) : (
                  "Okänd"
                ),
              },
              { label: "Region", value: status.deployment.region ?? "Okänd" },
              {
                label: "MFA-krav för admins",
                value: status.mfa.required ? (
                  <AdminBadge tone="ok">Påslaget (AAL2 krävs)</AdminBadge>
                ) : (
                  <AdminBadge tone="neutral">Av (kan slås på med PLATFORM_ADMIN_REQUIRE_MFA=1)</AdminBadge>
                ),
              },
            ]}
          />
        </AdminCard>
      </div>

      <AdminCard title={`Senaste fel (${failures.length})`}>
        {failures.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-neutral-500">Inga fel loggade. Bra.</p>
        ) : (
          <AdminTable
            head={
              <>
                <Th>Tid</Th>
                <Th>Typ</Th>
                <Th>Händelse</Th>
                <Th>Detalj</Th>
              </>
            }
          >
            {failures.map((f, i) => (
              <tr key={`${f.at}-${i}`}>
                <Td className="whitespace-nowrap tabular-nums">{datumTidKort(f.at)}</Td>
                <Td>
                  <AdminBadge tone={f.kind === "email" ? "warn" : "info"}>
                    {f.kind === "email" ? "Mejl" : "AI"}
                  </AdminBadge>
                </Td>
                <Td className="max-w-64 truncate">{f.label}</Td>
                <Td className="max-w-80 truncate text-neutral-400">{f.detail}</Td>
              </tr>
            ))}
          </AdminTable>
        )}
      </AdminCard>

      <AdminCard title="Senaste mejlutskick">
        {emailEvents.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-neutral-500">
            Inga utskick loggade ännu (loggen börjar när första mejlet skickas efter driftsättning).
          </p>
        ) : (
          <AdminTable
            head={
              <>
                <Th>Tid</Th>
                <Th>Typ</Th>
                <Th>Mottagare</Th>
                <Th>Status</Th>
                <Th>Fel</Th>
              </>
            }
          >
            {emailEvents.map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap tabular-nums">{datumTidKort(e.createdAt)}</Td>
                <Td>{e.kind}</Td>
                <Td className="max-w-56 truncate">{e.toEmail}</Td>
                <Td>
                  {e.status === "sent" ? (
                    <AdminBadge tone="ok">Skickat</AdminBadge>
                  ) : e.status === "failed" ? (
                    <AdminBadge tone="danger">Misslyckades</AdminBadge>
                  ) : (
                    <AdminBadge tone="neutral">Ej konfigurerat</AdminBadge>
                  )}
                </Td>
                <Td className="max-w-72 truncate text-neutral-400">{e.error ?? "–"}</Td>
              </tr>
            ))}
          </AdminTable>
        )}
      </AdminCard>

      <AdminCard title="Admin-auditlogg (senaste 40)">
        {audit.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-neutral-500">Inga administrativa händelser ännu.</p>
        ) : (
          <AdminTable
            head={
              <>
                <Th>Tid</Th>
                <Th>Admin</Th>
                <Th>Händelse</Th>
                <Th>Mål</Th>
              </>
            }
          >
            {audit.map((a) => (
              <tr key={a.id}>
                <Td className="whitespace-nowrap tabular-nums">{datumTidKort(a.createdAt)}</Td>
                <Td className="max-w-52 truncate">{a.adminEmail}</Td>
                <Td>
                  <code className="text-[12px]">{a.action}</code>
                </Td>
                <Td className="max-w-64 truncate text-neutral-400">
                  {a.targetType ? `${a.targetType}: ${a.targetId ?? ""}` : "–"}
                </Td>
              </tr>
            ))}
          </AdminTable>
        )}
        <p className="border-t border-neutral-800 px-4 py-2.5 text-[12px] text-neutral-600">
          Loggen är insert-only (databastrigger) – administrativa händelser kan aldrig redigeras
          eller raderas härifrån.
        </p>
      </AdminCard>
    </div>
  );
}
