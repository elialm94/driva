process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

describe("server actions kraschar inte React-trädet", () => {
  it("settings-actionen fångar commit-fel utanför withBusiness", () => {
    const actions = readFileSync(join(here, "../app/actions.ts"), "utf8");
    const settings = actions.slice(actions.indexOf("export async function updateCompanySettingsAction"));
    const block = settings.slice(0, settings.indexOf("export async function saveLogoAction"));
    assert.match(block, /normalizeCompanySettingsInput/);
    assert.match(block, /try \{[\s\S]*return await withBusiness/);
    assert.match(block, /userFacingStorageError/);
  });

  it("hemside-AI returnerar strukturerat fel i stället för att kasta", () => {
    const actions = readFileSync(join(here, "../app/actions.ts"), "utf8");
    const gen = actions.slice(actions.indexOf("export async function generateWebsiteAction"));
    const block = gen.slice(0, gen.indexOf("export async function activateOptionalFeatureAction"));
    assert.match(block, /Promise<\{ ok: true \} \| \{ ok: false; error: string \}>/);
    assert.match(block, /userFacingStorageError/);
    const ui = readFileSync(join(here, "../components/site-widgets.tsx"), "utf8");
    assert.match(ui, /result\.ok === false/);
    assert.match(ui, /setError\(result\.error\)/);
  });

  /** Källtexten för en exporterad server action, fram till nästa export. */
  function actionBlock(file: string, name: string): string {
    const source = readFileSync(join(here, file), "utf8");
    const start = source.indexOf(`export async function ${name}`);
    assert.ok(start >= 0, `${name} finns i ${file}`);
    const rest = source.slice(start);
    const next = rest.indexOf("\nexport ", 1);
    return next > 0 ? rest.slice(0, next) : rest;
  }

  it("kvittouppladdningen returnerar aldrig rå Postgres-/RLS-/Storage-text", () => {
    const block = actionBlock("../app/actions.ts", "uploadReceiptAction");
    assert.match(block, /try \{[\s\S]*return await withBusiness/);
    assert.match(block, /userFacingStorageError\(e, "Kunde inte spara kvittot/);
    assert.doesNotMatch(block, /e instanceof Error \? e\.message/);
  });

  it("kvittouppladdningen sparar filen FÖRE kvittoraden och lyckas bara med sparad fil", () => {
    const block = actionBlock("../app/actions.ts", "uploadReceiptAction");
    const precheck = block.indexOf("expenseAwaitingReceipt(expenseId)");
    const store = block.indexOf("await storeReceiptFile(");
    const link = block.indexOf("uploadReceiptForExpense(");
    assert.ok(precheck > 0 && store > precheck && link > store, "ordning: förkontroll → spara fil → koppla kvitto");
    assert.match(block, /if \(!upload\) throw/);
    assert.match(block, /receiptFileFromForm\(form\)/);
    assert.match(block, /receiptFileStored\(receipt\)/);
    assert.match(block, /fileStored: true as const/);
  });

  it("faktura-utfärdande fångar issue-fel och lämnar utkastet orört vid fel", () => {
    const actions = readFileSync(join(here, "../app/actions.ts"), "utf8");
    const send = actions.slice(actions.indexOf("export async function sendInvoiceAction"));
    const block = send.slice(0, send.indexOf("export async function deliverInvoiceAction"));
    assert.match(block, /issueInvoice\(invoiceId\)/);
    assert.match(block, /userFacingIssueError/);
    assert.match(block, /InvoiceNotReadyError/);
  });
});
