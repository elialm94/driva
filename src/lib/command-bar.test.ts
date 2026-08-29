process.env.DRIVA_TEST = "1";
process.env.AI_PROVIDER = "none";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COMMANDS,
  FALLBACK_COMMAND_IDS,
  FREE_TEXT_FALLBACK_MESSAGE,
  getCommand,
  matchCommands,
  parseFreeText,
  type CommandId,
} from "./command-bar";
import { ASSISTANT_TOOL_NAMES } from "./ai/tools";
import { getAiIntentProvider, NoopAiIntentProvider } from "./ai/intent";

/* ------------------------------ Registret ------------------------------ */

describe("kommandoregistret", () => {
  it("innehåller minimikommandona ur specen", () => {
    const required: CommandId[] = [
      "create_invoice",
      "create_quote",
      "create_assignment",
      "create_customer",
      "find_customer",
      "show_unpaid_invoices",
      "show_overdue_invoices",
      "show_open_quotes",
      "show_today_actions",
      "upload_receipt",
    ];
    const ids = new Set(COMMANDS.map((c) => c.id));
    for (const id of required) assert.ok(ids.has(id), `saknar ${id}`);
  });

  it("pekar bara på verktyg som finns i verktygslagret (exporterbart till LLM)", () => {
    const tools = new Set(ASSISTANT_TOOL_NAMES);
    for (const cmd of COMMANDS) {
      if (cmd.run.kind === "tool") assert.ok(tools.has(cmd.run.tool), `${cmd.id} → okänt verktyg ${cmd.run.tool}`);
      if (cmd.run.kind === "flow") assert.ok(tools.has(cmd.run.finishTool), `${cmd.id} → okänt verktyg ${cmd.run.finishTool}`);
    }
  });

  it("varje kommando har risknivå, alias och ikon", () => {
    for (const cmd of COMMANDS) {
      assert.ok(["READ_ONLY", "SAFE_WRITE", "CONFIRM_REQUIRED"].includes(cmd.risk), cmd.id);
      assert.ok(cmd.aliases.length > 0, `${cmd.id} saknar alias`);
      assert.ok(cmd.label.length > 0 && cmd.icon.length > 0, cmd.id);
    }
  });

  it("påminnelser kräver bekräftelse – läskommandon är READ_ONLY", () => {
    assert.equal(getCommand("remind_late_invoices").risk, "CONFIRM_REQUIRED");
    assert.equal(getCommand("show_unpaid_invoices").risk, "READ_ONLY");
    assert.equal(getCommand("show_today_actions").risk, "READ_ONLY");
    assert.equal(getCommand("find_customer").risk, "READ_ONLY");
  });
});

/* --------------------------- Klientmatchning --------------------------- */

describe("matchCommands (autocomplete utan nätverk)", () => {
  it("”fak” ger Skapa faktura först, sedan Visa fakturor och obetalda", () => {
    const ids = matchCommands("fak").map((m) => m.command.id);
    assert.equal(ids[0], "create_invoice");
    assert.ok(ids.includes("show_invoices"), `saknar show_invoices: ${ids.join(",")}`);
    assert.ok(ids.includes("show_unpaid_invoices"), `saknar show_unpaid_invoices: ${ids.join(",")}`);
  });

  it("alias ”fakturera” och ”ny faktura” träffar Skapa faktura", () => {
    assert.equal(matchCommands("fakturera")[0]?.command.id, "create_invoice");
    assert.equal(matchCommands("ny faktura")[0]?.command.id, "create_invoice");
  });

  it("”visa sena fakturor” träffar show_overdue_invoices först", () => {
    assert.equal(matchCommands("visa sena fakturor")[0]?.command.id, "show_overdue_invoices");
  });

  it("”off” ger Skapa offert överst", () => {
    assert.equal(matchCommands("off")[0]?.command.id, "create_quote");
  });

  it("skräptext ger inga förslag", () => {
    assert.equal(matchCommands("zzzq").length, 0);
  });
});

/* ------------------------ Deterministisk fri text ----------------------- */

describe("parseFreeText (regler, ingen modell)", () => {
  it("hög konfidens: ”fakturera Johan” → create_invoice med kundnamn", () => {
    const p = parseFreeText("fakturera Johan");
    assert.deepEqual(p, { confidence: "high", commandId: "create_invoice", entityQuery: "johan" });
  });

  it("hög konfidens: ”Skapa offert till Anna” → create_quote med kundnamn", () => {
    const p = parseFreeText("Skapa offert till Anna");
    assert.deepEqual(p, { confidence: "high", commandId: "create_quote", entityQuery: "anna" });
  });

  it("kundnamnet rensas från innehållsfraser: ”fakturera Johan för altanen”", () => {
    const p = parseFreeText("fakturera Johan för altanen");
    assert.deepEqual(p, { confidence: "high", commandId: "create_invoice", entityQuery: "johan" });
  });

  it("hög konfidens utan kundnamn: exakta alias", () => {
    assert.deepEqual(parseFreeText("visa sena fakturor"), { confidence: "high", commandId: "show_overdue_invoices" });
    assert.deepEqual(parseFreeText("Vem har inte betalat?"), { confidence: "high", commandId: "show_unpaid_invoices" });
    assert.deepEqual(parseFreeText("Vad behöver jag göra idag?"), { confidence: "high", commandId: "show_today_actions" });
    assert.deepEqual(parseFreeText("Vad är på gång?"), { confidence: "high", commandId: "show_watching" });
  });

  it("frågevarianter: ”vilka kunder har inte betalat än”", () => {
    const p = parseFreeText("vilka kunder har inte betalat än");
    assert.equal(p.confidence, "high");
    assert.equal(p.confidence === "high" && p.commandId, "show_unpaid_invoices");
  });

  it("låg konfidens: ensamt ämnesord ger ”Menade du?”-förslag", () => {
    const p = parseFreeText("fakturor");
    assert.equal(p.confidence, "low");
    assert.ok(p.confidence === "low" && p.suggestions.length >= 1 && p.suggestions.length <= 3);
  });

  it("ingen konfidens: oförståelig text → ärligt none, aldrig ett fejkat svar", () => {
    assert.deepEqual(parseFreeText("hur mår du idag kompis"), { confidence: "none" });
    assert.deepEqual(parseFreeText(""), { confidence: "none" });
  });

  it("fallbacktexten är ärlig och fallback-kommandona finns i registret", () => {
    assert.match(FREE_TEXT_FALLBACK_MESSAGE, /kan ännu inte tolka helt fri text/i);
    for (const id of FALLBACK_COMMAND_IDS) assert.ok(getCommand(id));
  });
});

/* ----------------------------- LLM-abstraktion -------------------------- */

describe("AiIntentProvider", () => {
  it("Noop-leverantören svarar typat ”not_configured” – inget fejkat modellsvar", async () => {
    const provider = new NoopAiIntentProvider();
    const result = await provider.interpret();
    assert.deepEqual(result, { kind: "not_configured" });
  });

  it("utan API-nyckel är Noop den aktiva leverantören", () => {
    assert.equal(getAiIntentProvider().name, "noop");
  });
});
