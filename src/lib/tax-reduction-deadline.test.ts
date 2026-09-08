process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rotApplicationDeadlineDate, rotDeadlineStatus } from "./tax-reduction-deadline";

describe("ROT 31 januari", () => {
  it("deadlinen är 31 januari året efter arbetet", () => {
    assert.equal(rotApplicationDeadlineDate(2025), "2026-01-31");
  });

  it("varnar i januari om underlaget inte är skapat", () => {
    const s = rotDeadlineStatus({
      today: "2026-01-10",
      workEndDate: "2025-11-02",
      paidAt: "2025-11-20",
      applied: false,
    });
    assert.ok(s);
    assert.equal(s?.deadline, "2026-01-31");
    assert.equal(s?.due, false);
    assert.ok((s?.daysLeft ?? 0) > 0);
  });

  it("är tyst när underlaget redan finns", () => {
    const s = rotDeadlineStatus({
      today: "2026-01-10",
      workEndDate: "2025-11-02",
      applied: true,
    });
    assert.equal(s, null);
  });
});
