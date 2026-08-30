import { requirePlatformAdmin } from "@/lib/platform/auth";
import { recentFailures, systemStatus, type HealthState } from "@/lib/platform/system";
import { listAdminAudit, listEmailEvents } from "@/lib/platform/store";
import { AdminBadge, AdminCard, AdminTable, KeyValueList, Th, Td, datumTidKort } from "@/components/admin/ui";

export const metadata = { title: "System" };

function HealthBadge({ state }: { state: HealthState }) {
  if (state === "ok") return <AdminBadge tone="ok">OK</AdminBadge>;
  if (state === "fel") return <AdminBadge tone="danger">Fel</AdminBadge>;
  // Ärlighet före grönt ljus: "Okänd" när hälsan inte kan verifieras (spec §24).
  return <AdminBadge tone="neutral">Okänd</AdminBadge>;
}

export default async function AdminSystemPage() {
  await requirePlatformAdmin();
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
            ]}
          />
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
