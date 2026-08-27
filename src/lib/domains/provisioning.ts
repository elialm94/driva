import { save } from "../store";
import { getBusinessProfile } from "../services/settings";
import { logActivity } from "../services/activity";
import { logDomainAudit } from "./audit";
import { DomainError } from "./errors";
import { getHostingProvider } from "./hosting";
import { missingRegistrantFields, registrantFromProfile } from "./profile";
import { getDomainRegistrar } from "./registrar";
import { requireOwnedDomain, touchDomain } from "./store";
import type { Domain, DomainErrorCategory } from "../types";

function fail(domain: Domain, category: DomainErrorCategory, message: string): Domain {
  domain.status = domain.provisioning.registered ? domain.status === "active" ? "active" : "failed" : "failed";
  if (domain.provisioning.registered && category === "hosting_failed") {
    domain.status = "registered";
  }
  domain.provisioning.lastError = { category, message, at: new Date().toISOString() };
  domain.updatedAt = new Date().toISOString();
  save();
  logDomainAudit("domain_failed", message, { domainId: domain.id, hostname: domain.hostname });
  return domain;
}

/**
 * Återupptagbar orkestrering. Ett anrop tar nästa steg (eller några korta)
 * och returnerar – webbläsaren väntar inte på SSL. Poll-routen anropar igen.
 */
export async function advanceProvisioning(domainId: string): Promise<Domain> {
  const domain = requireOwnedDomain(domainId);
  domain.provisioning.ticks += 1;
  domain.updatedAt = new Date().toISOString();

  if (domain.source === "existing") {
    return advanceExisting(domain);
  }

  if (domain.billing.status !== "paid") {
    return domain;
  }

  try {
    if (!domain.provisioning.registrantCreated) {
      const missing = missingRegistrantFields();
      if (missing.length) {
        return fail(domain, "profile_incomplete", "En uppgift saknas innan domänen kan registreras");
      }
      domain.status = "registering";
      domain.provisioning.step = "registrant";
      save();
      const registrar = getDomainRegistrar();
      const handle = await registrar.createRegistrant(
        registrantFromProfile(getBusinessProfile()),
        `registrant:${domain.businessId}`,
      );
      domain.registrarRegistrantId = handle.id;
      domain.provisioning.registrantCreated = true;
      save();
      logDomainAudit("domain_registrant_created", "Företaget registrerades som innehavare.", {
        domainId: domain.id,
        hostname: domain.hostname,
      });
    }

    if (!domain.provisioning.registered) {
      domain.status = "registering";
      domain.provisioning.step = "register";
      save();
      const registrar = getDomainRegistrar();
      const rec = await registrar.registerDomain({
        hostname: domain.hostname,
        tld: domain.tld,
        registrantId: domain.registrarRegistrantId!,
        periodYears: 1,
        idempotencyKey: `register:${domain.idempotencyKey}`,
      });
      domain.registrarDomainId = rec.registrarDomainId;
      domain.registeredAt = rec.registeredAt;
      domain.expiresAt = rec.expiresAt;
      domain.billing.renewsAt = rec.expiresAt;
      domain.provisioning.registered = true;
      domain.status = "registered";
      domain.provisioning.step = "nameservers";
      save();
      logDomainAudit("domain_registered", `${domain.hostname} är registrerad.`, {
        domainId: domain.id,
        hostname: domain.hostname,
      });
      logActivity(`${domain.hostname} registrerades på ${getBusinessProfile().name}.`, {
        entity: { type: "doman", id: domain.id },
      });
    }

    const hosting = getHostingProvider();

    if (!domain.provisioning.nameserversConfigured) {
      domain.status = "configuring";
      domain.provisioning.step = "nameservers";
      save();
      const ns = await hosting.nameservers();
      await getDomainRegistrar().configureNameservers(domain.hostname, ns);
      domain.provisioning.nameserversConfigured = true;
      save();
      logDomainAudit("domain_nameservers_set", "Adressen kopplades.", {
        domainId: domain.id,
        hostname: domain.hostname,
      });
    }

    if (!domain.provisioning.hostingAttached) {
      domain.status = "configuring";
      domain.provisioning.step = "hosting";
      save();
      await hosting.addCustomDomain(domain.hostname, `hosting:${domain.idempotencyKey}`);
      domain.provisioning.hostingAttached = true;
      save();
      logDomainAudit("domain_hosting_attached", "Hemsidan kopplades.", {
        domainId: domain.id,
        hostname: domain.hostname,
      });
    }

    if (!domain.provisioning.dnsVerified) {
      domain.status = "verifying";
      domain.provisioning.step = "dns";
      save();
      const status = await hosting.verifyDomain(domain.hostname);
      if (!status.verified) {
        domain.verificationStatus = "pending";
        touchDomain(domain);
        return domain;
      }
      domain.provisioning.dnsVerified = true;
      domain.verificationStatus = "verified";
      save();
      logDomainAudit("domain_dns_verified", "Kopplingen är bekräftad.", {
        domainId: domain.id,
        hostname: domain.hostname,
      });
      return domain;
    }

    if (!domain.provisioning.sslReady) {
      domain.status = "verifying";
      domain.provisioning.step = "ssl";
      save();
      const ssl = await hosting.sslStatus(domain.hostname);
      if (!ssl.ready) {
        domain.sslStatus = "pending";
        touchDomain(domain);
        return domain;
      }
      domain.provisioning.sslReady = true;
      domain.sslStatus = "active";
      save();
      logDomainAudit("domain_ssl_active", "Säker anslutning är aktiv.", {
        domainId: domain.id,
        hostname: domain.hostname,
      });
    }

    domain.status = "active";
    domain.provisioning.step = "done";
    domain.provisioning.lastError = undefined;
    domain.updatedAt = new Date().toISOString();
    save();
    logDomainAudit("domain_active", `${domain.hostname} är live.`, {
      domainId: domain.id,
      hostname: domain.hostname,
    });
    return domain;
  } catch (e) {
    const message = e instanceof DomainError ? e.message : "Något gick fel. Domänen är din om köpet gick igenom.";
    const category: DomainErrorCategory =
      e instanceof DomainError ? e.category : domain.provisioning.registered ? "hosting_failed" : "registrar_failed";
    if (category === "registrar_failed") {
      logDomainAudit("domain_register_failed", message, { domainId: domain.id, hostname: domain.hostname });
    }
    if (category === "hosting_failed") {
      logDomainAudit("domain_hosting_failed", message, { domainId: domain.id, hostname: domain.hostname });
    }
    return fail(domain, category, message);
  }
}

async function advanceExisting(domain: Domain): Promise<Domain> {
  const hosting = getHostingProvider();
  try {
    if (!domain.provisioning.hostingAttached) {
      domain.status = "configuring";
      await hosting.addCustomDomain(domain.hostname, `hosting:${domain.idempotencyKey}`);
      domain.provisioning.hostingAttached = true;
      save();
      logDomainAudit("domain_hosting_attached", "Befintlig adress tillagd.", {
        domainId: domain.id,
        hostname: domain.hostname,
      });
    }
    if (!domain.provisioning.dnsVerified) {
      domain.status = "verifying";
      const status = await hosting.verifyDomain(domain.hostname);
      if (!status.verified) {
        domain.verificationStatus = "pending";
        touchDomain(domain);
        return domain;
      }
      domain.provisioning.dnsVerified = true;
      domain.verificationStatus = "verified";
    }
    const ssl = await hosting.sslStatus(domain.hostname);
    if (!ssl.ready) {
      domain.sslStatus = "pending";
      domain.status = "verifying";
      touchDomain(domain);
      return domain;
    }
    domain.provisioning.sslReady = true;
    domain.sslStatus = "active";
    domain.status = "active";
    domain.provisioning.step = "done";
    domain.provisioning.lastError = undefined;
    touchDomain(domain);
    logDomainAudit("domain_existing_verified", `${domain.hostname} är ansluten.`, {
      domainId: domain.id,
      hostname: domain.hostname,
    });
    return domain;
  } catch (e) {
    const message = e instanceof DomainError ? e.message : "Kunde inte kontrollera anslutningen.";
    return fail(domain, "hosting_failed", message);
  }
}

/** Försök igen – aldrig ett nytt köp. Fortsätter från där det bröts. */
export async function retryProvisioning(domainId: string): Promise<Domain> {
  const domain = requireOwnedDomain(domainId);
  if (domain.source === "purchased" && domain.billing.status !== "paid") {
    throw new DomainError("payment_failed", "Betalningen gick inte igenom. Sök och köp igen.");
  }
  domain.status = domain.provisioning.hostingAttached ? "verifying" : domain.provisioning.registered ? "configuring" : "registering";
  domain.provisioning.lastError = undefined;
  save();
  logDomainAudit("domain_retry", "Försöker koppla igen.", { domainId: domain.id, hostname: domain.hostname });
  return advanceProvisioning(domain.id);
}
