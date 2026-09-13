process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { buildSeed } from "./seed";
import { cloneState, runInTenantContext, type TenantContext } from "./storage/context";
import { getJob } from "./services/data";
import { ensureJobPurchaseRef } from "./services/jobs";
import { inboundAddressForBusiness } from "./services/inbox";
import { invoiceReadiness } from "./services/invoice-readiness";
import { jobInvoiceChoice, quotedLaborPrefill, actualEntries } from "./services/job-work";
import { jobAdminState } from "./services/job-admin";
import { jobPurchaseOrderRows, jobWholesalerContext } from "./services/job-wholesalers";
import { getInvoiceDefaults } from "./services/settings";

function readCtx(): TenantContext {
  const state = db();
  return {
    businessId: "biz-page",
    userId: "user-page",
    writable: false,
    state,
    baseline: cloneState(state),
    stateVersion: 1,
    dirty: false,
  };
}

function writeCtx(): TenantContext {
  return { ...readCtx(), writable: true };
}

/** Samma läsningar som uppdragssidan gör efter ensurePageBusiness. */
function loadJobPageReads(jobId: string) {
  const job = getJob(jobId);
  assert.ok(job, jobId);
  jobAdminState(job);
  actualEntries(job.id);
  jobInvoiceChoice(job.id);
  quotedLaborPrefill(job.id);
  jobWholesalerContext(job.id);
  jobPurchaseOrderRows(job.id);
  getInvoiceDefaults();
  inboundAddressForBusiness();
  invoiceReadiness(job.id);
  return job.purchaseRef;
}

describe("uppdragssidan i läskontext (produktion/demo RSC)", () => {
  beforeEach(() => {
    replaceDb(buildSeed());
  });

  it("ensureJobPurchaseRef kastar – det var kraschen på /uppdrag/job-kok", () => {
    assert.throws(
      () => runInTenantContext(readCtx(), () => ensureJobPurchaseRef("job-kok")),
      /läskontext/,
    );
  });

  it("sidans läsningar kastar inte, och tilldelar inte inköpsreferens", () => {
    for (const id of ["job-kok", "job-fasad", "job-garderob"]) {
      const ref = runInTenantContext(readCtx(), () => loadJobPageReads(id));
      assert.equal(ref, undefined, id);
    }
  });

  it("skrivkontext tilldelar en stabil FV-referens", () => {
    const first = runInTenantContext(writeCtx(), () => ensureJobPurchaseRef("job-kok"));
    assert.match(first, /^FV-\d+$/);
    const again = runInTenantContext(writeCtx(), () => ensureJobPurchaseRef("job-kok"));
    assert.equal(again, first);
    const peeked = runInTenantContext(readCtx(), () => getJob("job-kok")?.purchaseRef);
    assert.equal(peeked, first);
  });
});
