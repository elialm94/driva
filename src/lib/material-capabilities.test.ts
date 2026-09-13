process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { can } from "./collaboration/permissions";

describe("behörighet för materialkedjan", () => {
  it("23. ägare, medlem, konsult och revisor följer capability-modellen", () => {
    assert.equal(can("owner", "order_materials"), true);
    assert.equal(can("owner", "manage_wholesalers"), true);
    assert.equal(can("owner", "change_jobs"), true);
    assert.equal(can("admin", "manage_wholesalers"), true);

    assert.equal(can("member", "order_materials"), true);
    assert.equal(can("member", "change_jobs"), true);
    assert.equal(can("member", "manage_wholesalers"), false);
    assert.equal(can("member", "write_accounting"), true);

    assert.equal(can("accounting_consultant", "order_materials"), false);
    assert.equal(can("accounting_consultant", "manage_wholesalers"), false);
    assert.equal(can("accounting_consultant", "change_jobs"), false);
    assert.equal(can("accounting_consultant", "write_accounting"), true);

    assert.equal(can("auditor", "order_materials"), false);
    assert.equal(can("auditor", "manage_wholesalers"), false);
    assert.equal(can("auditor", "change_jobs"), false);
    assert.equal(can("auditor", "write_accounting"), false);
    assert.equal(can("auditor", "read_accounting"), true);
  });
});
