process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb } from "./store";
import { buildSeed } from "./seed";
import { emptyTestDb, testCustomer } from "./invoices/test-db";
import { derivedJobStatus, isPaymentPlanPartDue, jobEconomyLine, jobWhenLabel } from "./services/job-lifecycle";
import { jobAdminState } from "./services/job-admin";
import { listJobsForTable, reconcileJobListFilters } from "./services/job-list";
import { jobsThisWeek } from "./services/attention";
import { getJob } from "./services/data";
import type { Job } from "./types";

function job(over: Partial<Job>): Job {
  return {
    id: over.id ?? "job-x",
    customerId: over.customerId ?? "cust-1",
    title: over.title ?? "Test",
    description: over.description ?? "",
    status: over.status ?? "kommande",
    checklist: [],
    notes: "",
    createdAt: over.createdAt ?? "2026-08-01T10:00:00.000Z",
    ...over,
  };
}

describe("derivedJobStatus", () => {
  it("framtida start är Planerat även om lagret säger pagar", () => {
    assert.equal(
      derivedJobStatus(job({ status: "pagar", startDate: "2026-09-01T09:00:00.000Z" }), new Date("2026-08-27T12:00:00")),
      "planerat"
    );
  });

  it("start idag eller passerat är Pågår utan att status skrivits till pagar", () => {
    assert.equal(
      derivedJobStatus(job({ status: "kommande", startDate: "2026-08-27T09:00:00.000Z" }), new Date("2026-08-27T18:00:00")),
      "pagar"
    );
    assert.equal(
      derivedJobStatus(job({ status: "kommande", startDate: "2026-08-01T09:00:00.000Z" }), new Date("2026-08-27T12:00:00")),
      "pagar"
    );
  });

  it("completedAt eller status klart är Klart", () => {
    assert.equal(
      derivedJobStatus(job({ status: "kommande", completedAt: "2026-08-18T16:00:00.000Z" }), new Date("2026-08-27")),
      "klart"
    );
    assert.equal(derivedJobStatus(job({ status: "klart" }), new Date("2026-08-27")), "klart");
  });

  it("saknat startdatum är Planerat, utom äldre pagar", () => {
    assert.equal(derivedJobStatus(job({ status: "kommande" })), "planerat");
    assert.equal(derivedJobStatus(job({ status: "pagar" })), "pagar");
  });
});

describe("betalningsplan", () => {
  it("50 % vid start blir fakturerbar när start infallit, 50 % vid klart först då", () => {
    assert.equal(isPaymentPlanPartDue({ label: "Vid arbetets start", isLast: false }, "planerat"), false);
    assert.equal(isPaymentPlanPartDue({ label: "Vid arbetets start", isLast: false }, "pagar"), true);
    assert.equal(isPaymentPlanPartDue({ label: "När arbetet är klart och godkänt", isLast: true }, "pagar"), false);
    assert.equal(isPaymentPlanPartDue({ label: "När arbetet är klart och godkänt", isLast: true }, "klart"), true);
    assert.equal(isPaymentPlanPartDue({ label: "Förskott före start", isLast: false }, "planerat"), true);
  });
});

describe("jobWhenLabel och ekonomi", () => {
  it("formaterar period och klart-datum", () => {
    const when = jobWhenLabel(
      job({ startDate: "2026-09-01T09:00:00.000Z", endDate: "2026-09-08T17:00:00.000Z", status: "kommande" })
    );
    assert.match(when, /1–8/);
    assert.match(when, /sep/i);
    assert.match(
      jobWhenLabel(job({ status: "klart", completedAt: "2026-08-18T16:00:00.000Z" })),
      /Klart 18/
    );
  });

  it("en ekonomirad: kvar, väntar, betalt", () => {
    assert.equal(jobEconomyLine({ remaining: 59500, unpaid: 0, paid: 25500 }).label.includes("kvar"), true);
    assert.equal(jobEconomyLine({ remaining: 0, unpaid: 25500, paid: 0 }).kind, "vantar");
    assert.equal(jobEconomyLine({ remaining: 0, unpaid: 0, paid: 51000 }).label, "Betalt ✓");
  });
});

describe("seedade uppdrag", () => {
  beforeEach(() => replaceDb(buildSeed()));

  it("Altanrenovering är Planerat utan start-CTA", () => {
    const altan = getJob("job-altan");
    assert.ok(altan);
    assert.equal(derivedJobStatus(altan), "planerat");
    const admin = jobAdminState(altan);
    assert.equal(admin.lifecycle, "planerat");
    assert.notEqual(admin.primary, "skapa_faktura");
    assert.equal(admin.canMarkDone, false);
  });

  it("Köksrenovering är Pågår, kan markeras klart, ingen startfaktura-CTA för sista delen", () => {
    const kok = getJob("job-kok");
    assert.ok(kok);
    assert.equal(derivedJobStatus(kok), "pagar");
    const admin = jobAdminState(kok);
    assert.equal(admin.canMarkDone, true);
    assert.equal(admin.primary, null);
    assert.equal(admin.secondary, "visa_offert");
  });

  it("Betalt släpper Aktiva/Planerade så listan inte blir tom", () => {
    assert.deepEqual(
      reconcileJobListFilters({ lifecycle: "aktiva", economy: "alla", patch: { economy: "betalt" } }),
      { lifecycle: "alla", economy: "betalt" },
    );
    assert.deepEqual(
      reconcileJobListFilters({ lifecycle: "planerade", economy: "alla", patch: { economy: "betalt" } }),
      { lifecycle: "alla", economy: "betalt" },
    );
    assert.deepEqual(
      reconcileJobListFilters({ lifecycle: "alla", economy: "betalt", patch: { lifecycle: "aktiva" } }),
      { lifecycle: "aktiva", economy: "alla" },
    );
    assert.deepEqual(
      reconcileJobListFilters({ lifecycle: "klart", economy: "alla", patch: { economy: "betalt" } }),
      { lifecycle: "klart", economy: "betalt" },
    );
    assert.deepEqual(
      reconcileJobListFilters({ lifecycle: "aktiva", economy: "alla", patch: { economy: "kvar" } }),
      { lifecycle: "aktiva", economy: "kvar" },
    );
  });

  it("listan är en tabellmodell: aktiva default, sök och paginering", () => {
    const aktiva = listJobsForTable({ lifecycle: "aktiva" });
    assert.ok(aktiva.rows.every((r) => r.lifecycle !== "klart"));
    assert.ok(aktiva.rows.some((r) => r.title === "Altanrenovering"));
    assert.ok(aktiva.rows.some((r) => r.title === "Köksrenovering"));
    assert.ok(aktiva.rows[0].lifecycle === "pagar");

    const altan = aktiva.rows.find((r) => r.id === "job-altan");
    assert.equal(altan?.lifecycle, "planerat");
    assert.ok(!("invoices" in (altan ?? {})));

    const search = listJobsForTable({ q: "tantogatan", lifecycle: "alla" });
    assert.ok(search.rows.every((r) => /altan|köksö/i.test(r.title)));

    const brf = listJobsForTable({ q: "eken", lifecycle: "alla" });
    assert.ok(brf.rows.some((r) => r.customerName === "Brf Eken"));
  });

  it("paginerar utan att lägga hela registret i resultatet", () => {
    const customers = [testCustomer({ id: "cust-bulk" })];
    const jobs: Job[] = Array.from({ length: 120 }, (_, i) =>
      job({
        id: `job-bulk-${i}`,
        customerId: "cust-bulk",
        title: `Uppdrag ${String(i).padStart(3, "0")}`,
        status: "kommande",
        startDate: new Date(Date.now() + (i + 1) * 86_400_000).toISOString(),
      })
    );
    replaceDb(emptyTestDb({ customers, jobs }));
    const page = listJobsForTable({ lifecycle: "alla", page: 2, pageSize: 50, sort: "kund" });
    assert.equal(page.rows.length, 50);
    assert.equal(page.total, 120);
    assert.equal(page.totalPages, 3);
    assert.equal(page.page, 2);
  });

  it("jobsThisWeek räknar pågående och start inom 7 dagar från datum", () => {
    replaceDb(buildSeed());
    const week = jobsThisWeek();
    assert.ok(week.some((j) => j.id === "job-kok"));
    assert.ok(week.some((j) => j.id === "job-altan"));
    assert.ok(!week.some((j) => j.status === "klart"));
  });
});
