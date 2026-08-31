process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

describe("Konto-fliken visar demoläge bara i demoläge", () => {
  it("settings-form grindar DEMOLÄGE bakom account.demo", () => {
    const form = readFileSync(join(here, "../components/settings-form.tsx"), "utf8");
    assert.match(form, /account\.demo/);
    assert.match(form, /Du är inloggad som/);
    const demoCard = form.slice(form.indexOf("account.demo"));
    assert.match(demoCard, /Demoläge/);
    assert.match(demoCard, /utan inloggning/);
  });

  it("sidan sätter demo från JSON-store eller demosession, inte för godtycklig Supabase-användare", () => {
    const page = readFileSync(join(here, "../app/(app)/installningar/page.tsx"), "utf8");
    assert.match(page, /isJsonDemoStore\(\) \|\| \(await isDemoSession\(\)\)/);
    assert.match(page, /account=\{\{\s*demo: demoAccount/);
  });
});
