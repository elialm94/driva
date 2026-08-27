import type { Domain } from "../types";
import { isMockDomainMode } from "./config";
import { kr } from "../format";
import { getHostingProvider, type DnsRecordInstruction } from "./hosting";

export type DomainUiPhase = "search" | "progress" | "live" | "failed" | "existing";

export interface DomainProgressStep {
  key: "registered" | "connected" | "https";
  label: string;
  done: boolean;
  current: boolean;
}

export interface DomainCardView {
  id: string;
  hostname: string;
  source: Domain["source"];
  status: Domain["status"];
  live: boolean;
  demo: boolean;
  autoRenew: boolean;
  renewalFailed: boolean;
  registeredOn: { companyName: string; orgNumber: string };
  priceLabel: string | null;
  expiresLabel: string | null;
  errorMessage: string | null;
  canRetry: boolean;
  retryIsHostingOnly: boolean;
  steps: DomainProgressStep[];
  phase: DomainUiPhase;
  /** Endast befintlig, inte-live: CNAME-rader att visa. Aldrig för Driva-köpta adresser. */
  dnsChanges: DnsRecordInstruction[];
}

export function domainCardView(
  domain: Domain,
  company: { name: string; orgNumber: string },
): DomainCardView {
  const registered = domain.provisioning.registered || domain.source === "existing";
  const connected = domain.provisioning.hostingAttached && (domain.provisioning.dnsVerified || domain.status === "active");
  const https = domain.sslStatus === "active" || domain.provisioning.sslReady;
  const live = domain.status === "active";
  const failed = domain.status === "failed" || Boolean(domain.provisioning.lastError && !live);
  const steps: DomainProgressStep[] = [
    {
      key: "registered",
      label: domain.source === "existing" ? "Adressen är tillagd" : "Domänen är din",
      done: registered,
      current: !registered && !failed,
    },
    {
      key: "connected",
      label: "Kopplad till hemsidan",
      done: connected,
      current: registered && !connected && !failed,
    },
    {
      key: "https",
      label: "Aktiverar säker anslutning",
      done: https,
      current: connected && !https && !failed,
    },
  ];

  let phase: DomainUiPhase = "progress";
  if (live) phase = "live";
  else if (failed) phase = "failed";
  else if (domain.source === "existing" && !live) phase = "existing";

  const retryIsHostingOnly = domain.provisioning.registered && !live;
  const canRetry = failed && (retryIsHostingOnly || domain.provisioning.billed);

  return {
    id: domain.id,
    hostname: domain.hostname,
    source: domain.source,
    status: domain.status,
    live,
    demo: isMockDomainMode(),
    autoRenew: domain.autoRenew,
    renewalFailed: domain.billing.status === "renewal_failed",
    registeredOn: { companyName: company.name, orgNumber: company.orgNumber },
    priceLabel:
      domain.source === "purchased" && domain.billing.customerPrice
        ? `${kr(domain.billing.customerPrice)}/år`
        : null,
    expiresLabel: domain.expiresAt
      ? new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "long", year: "numeric" }).format(new Date(domain.expiresAt))
      : null,
    errorMessage: domain.provisioning.lastError?.message ?? (failed ? "Något gick fel." : null),
    canRetry,
    retryIsHostingOnly,
    steps,
    phase,
    dnsChanges: [],
  };
}

export async function enrichDomainView(
  domain: Domain,
  company: { name: string; orgNumber: string },
): Promise<DomainCardView> {
  const view = domainCardView(domain, company);
  if (domain.source !== "existing" || view.live) return view;
  const records = await getHostingProvider().requiredDns(domain.hostname);
  view.dnsChanges = records.filter((r) => r.type === "CNAME" || r.purpose === "verify");
  return view;
}
