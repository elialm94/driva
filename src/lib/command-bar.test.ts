process.env.DRIVA_TEST = "1";
process.env.AI_PROVIDER = "none";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COMMANDS,
  FALLBACK_COMMAND_IDS,
  FREE_TEXT_FALLBACK_MESSAGE,
  commandWorkspace,
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
      "create_reminder",
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

  it("intern påminnelse är SAFE_WRITE – betalningspåminnelse kräver bekräftelse", () => {
    assert.equal(getCommand("create_reminder").risk, "SAFE_WRITE");
    assert.equal(getCommand("create_reminder").label, "Skapa påminnelse");
    assert.equal(getCommand("remind_late_invoices").risk, "CONFIRM_REQUIRED");
    assert.equal(getCommand("remind_late_invoices").label, "Skicka betalningspåminnelse");
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

  it("”påm” och ”påminnelse” ger Skapa påminnelse först – inte kund-e-post", () => {
    assert.equal(matchCommands("påm")[0]?.command.id, "create_reminder");
    assert.equal(matchCommands("påminnelse")[0]?.command.id, "create_reminder");
    assert.equal(matchCommands("påminn")[0]?.command.id, "create_reminder");
  });

  it("Skapa påminnelse ryms bland Vanliga åtgärder (idle)", () => {
    const idle = [...COMMANDS]
      .filter((c) => commandWorkspace(c) === "owner")
      .sort((a, b) => b.priority - a.priority || a.label.localeCompare(b.label, "sv"))
      .slice(0, 6)
      .map((c) => c.id);
    assert.ok(idle.includes("create_reminder"), idle.join(","));
  });

  it("redovisningsytan föreslår inte offert/uppdrag", () => {
    const ids = matchCommands("offert", 8, "accountant").map((m) => m.command.id);
    assert.equal(ids.includes("create_quote"), false);
    assert.ok(matchCommands("vilka klienter", 6, "accountant").some((m) => m.command.id === "accountant_who_needs_help"));
    const offert = parseFreeText("skapa offert", "accountant");
    assert.equal(offert.confidence === "high" && "commandId" in offert && offert.commandId === "create_quote", false);
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

  it("”påminnelse” / ”påminn mig” → intern create_reminder, inte kund-e-post", () => {
    assert.deepEqual(parseFreeText("påminnelse"), { confidence: "high", commandId: "create_reminder" });
    assert.deepEqual(parseFreeText("påminn mig"), { confidence: "high", commandId: "create_reminder" });
    assert.deepEqual(parseFreeText("skapa påminnelse"), { confidence: "high", commandId: "create_reminder" });
  });

  it("”skicka påminnelse …” → extern betalningspåminnelse, CONFIRM_REQUIRED", () => {
    assert.deepEqual(parseFreeText("skicka påminnelse"), { confidence: "high", commandId: "remind_late_invoices" });
    const p = parseFreeText("skicka påminnelse till Johan om fakturan");
    assert.equal(p.confidence, "high");
    assert.equal(p.confidence === "high" && p.commandId, "remind_late_invoices");
    assert.notEqual(p.confidence === "high" && p.commandId, "create_reminder");
  });

  it("”påminn Johan” e-postar inte Johan – HIGH_PATTERNS stjäl inte NL-frasen", () => {
    const johan = parseFreeText("påminn Johan");
    assert.ok(!(johan.confidence === "high" && johan.commandId === "remind_late_invoices"));
    const nl = parseFreeText("påminn mig imorgon att ringa Göran");
    assert.ok(!(nl.confidence === "high" && nl.commandId === "create_reminder"));
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
