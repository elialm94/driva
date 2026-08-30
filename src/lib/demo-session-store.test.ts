process.env.DRIVA_TEST = "1";

import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __resetDemoSessionStoreForTests,
  createDemoSessionStore,
  loadDemoSessionStore,
  resetDemoSessionStore,
  saveDemoSessionStore,
} from "./storage/demo-session-store";

afterEach(() => {
  __resetDemoSessionStoreForTests();
});

describe("isolerad publik demosession", () => {
  it("ny session startar från Södermalms-seed med demo-flagga", async () => {
    const a = await createDemoSessionStore("sess-a", Date.now() + 60_000);
    assert.equal(a.settings.name, "Södermalms Snickeri AB");
    assert.equal(a.meta.demo, true);
    assert.ok(a.customers.length > 0);
    assert.ok(a.quotes.length > 0);
    assert.ok(a.invoices.length > 0);
    assert.ok(a.inboxItems.length > 0);
    assert.ok(a.website);
  });

  it("två sessioner påverkar inte varandra", async () => {
    const first = await createDemoSessionStore("sess-1", Date.now() + 60_000);
    await createDemoSessionStore("sess-2", Date.now() + 60_000);
    first.customers[0].name = "Ändrad i session 1";
    await saveDemoSessionStore("sess-1", first);

    const loaded1 = await loadDemoSessionStore("sess-1");
    const loaded2 = await loadDemoSessionStore("sess-2");
    assert.equal(loaded1?.customers[0].name, "Ändrad i session 1");
    assert.notEqual(loaded2?.customers[0].name, "Ändrad i session 1");
    assert.equal(loaded2?.settings.name, "Södermalms Snickeri AB");
  });

  it("återställning ger känt seed igen", async () => {
    const store = await createDemoSessionStore("sess-reset", Date.now() + 60_000);
    store.customers = [];
    await saveDemoSessionStore("sess-reset", store);
    const reset = await resetDemoSessionStore("sess-reset");
    assert.ok(reset.customers.length > 0);
    assert.equal(reset.settings.name, "Södermalms Snickeri AB");
    const loaded = await loadDemoSessionStore("sess-reset");
    assert.ok((loaded?.customers.length ?? 0) > 0);
  });

  it("utgången session går inte att läsa", async () => {
    await createDemoSessionStore("sess-old", Date.now() - 1000);
    assert.equal(await loadDemoSessionStore("sess-old"), null);
  });
});

describe("demo-sidans copy", () => {
  it("landningssidan är kort och alltid har Öppna demo", () => {
    const src = readFileSync(join(process.cwd(), "src/app/(auth)/demo/page.tsx"), "utf8");
    assert.match(src, /Testa Driva/);
    assert.match(src, /Öppna demo/);
    assert.match(src, /Har du redan ett konto\?/);
    assert.doesNotMatch(src, /Demon är inte tillgänglig/);
    assert.doesNotMatch(src, /Utforska en färdig demo/);
    assert.doesNotMatch(src, /isDemoLoginConfigured/);
  });

  it("login länkar alltid till demon", () => {
    const src = readFileSync(join(process.cwd(), "src/app/(auth)/login/page.tsx"), "utf8");
    assert.match(src, /Vill du testa först\?/);
    assert.match(src, /Öppna demo/);
    assert.doesNotMatch(src, /isDemoLoginConfigured/);
  });
});
