import { db, replaceDb } from "../store";
import { buildSeed } from "../seed";
import { createCustomer } from "../services/customers";
import { createJob } from "../services/jobs";
import { sendUserMessage, dispatchRules } from "../services/assistant";
import { executeTool, ASSISTANT_TOOL_NAMES } from "./tools";
import { isAiConfigured } from "./provider";
import { isBankIdApprovalRequest } from "./resolve";
import { financeOverview } from "../services/finance";
import { getBusinessActions } from "../services/actions";
import { invoiceTotals, currentVersion, isOpenReceivable } from "../services/data";
import { remainingToInvoiceForJob } from "../services/attention";
import { FREE_TEXT_FALLBACK_MESSAGE, parseFreeText } from "../command-bar";
import {
  interpretFreeTextViaAi,
  invoiceTargetOptionsFor,
  runBarCommand,
  searchCustomersForCommand,
} from "../services/command-bar";
import { kr } from "../format";

type Check = { name: string; ok: boolean; detail: string };

function reset() {
  replaceDb(buildSeed());
}

function lastAssistant() {
  const msgs = db().assistantMessages.filter((m) => m.role === "assistant");
  return msgs[msgs.length - 1];
}

function assert(name: string, ok: boolean, detail: string): Check {
  return { name, ok, detail };
}

export async function runAssistantChecks(): Promise<Check[]> {
  process.env.AI_PROVIDER = "none";
  const checks: Check[] = [];

  reset();
  await sendUserMessage("Vem har inte betalat?");
  {
    const unpaid = db().invoices.filter((i) => i.status === "skickad");
    const reply = lastAssistant();
    const ok =
      unpaid.length > 0 &&
      reply.card?.kind === "list" &&
      (reply.card.rows?.length ?? 0) === unpaid.length &&
      reply.text.includes(String(unpaid.length));
    checks.push(
      assert(
        "1. Obetalda kunder använder riktiga fakturor",
        ok,
        `skickade=${unpaid.length} rader=${reply.card?.kind === "list" ? reply.card.rows.length : 0}`
      )
    );
  }

  reset();
  {
    const before = db().jobs.length;
    await sendUserMessage("Skapa uppdrag för Anna Andersson badrum nästa måndag");
    const jobs = db().jobs.filter((j) => j.customerId === "cust-anna" && /badrum/i.test(j.title));
    const viaService = createJob({
      customerId: "cust-anna",
      title: "Badrum (service)",
      startDate: jobs[0]?.startDate,
    });
    const reply = lastAssistant();
    const ok =
      jobs.length === 1 &&
      Boolean(jobs[0].startDate) &&
      viaService.customerId === "cust-anna" &&
      db().jobs.length === before + 2 &&
      reply.card?.kind === "entity" &&
      reply.card.entity === "uppdrag";
    checks.push(
      assert(
        "2. Skapa uppdrag för Anna Andersson badrum nästa måndag",
        ok,
        `jobb=${jobs[0]?.id} start=${jobs[0]?.startDate ?? "saknas"} service=${viaService.id}`
      )
    );
  }

  reset();
  {
    const quotesBefore = db().quotes.length;
    await sendUserMessage("Skapa en offert till Johan för altan, 45 000 kr");
    const q = db().quotes[db().quotes.length - 1];
    const ok =
      db().quotes.length === quotesBefore + 1 &&
      q.customerId === "cust-johan" &&
      q.status === "utkast" &&
      !q.sentAt;
    checks.push(assert("3. Offertutkast till Johan 45 000 – inte skickad", ok, `status=${q?.status} nr=${q?.number}`));
  }

  reset();
  {
    createCustomer({
      kind: "privat",
      name: "Anna Berg",
      email: "anna.berg@example.com",
      phone: "070-000 00 00",
    });
    await sendUserMessage("Skapa en offert till Anna för kök, 10 000 kr");
    const reply = lastAssistant();
    const ok = reply.card?.kind === "list" && (reply.card.rows?.length ?? 0) >= 2 && /flera/i.test(reply.text);
    checks.push(assert("4. Tvetydig Anna", ok, `kort=${reply.card?.kind} text=${reply.text.slice(0, 80)}`));
  }

  reset();
  {
    await sendUserMessage("Skapa en offert till Erik för altan, 20 000 kr");
    const reply = lastAssistant();
    const pending = db().pendingActions.find((a) => a.type === "skapa_kund");
    const ok =
      reply.card?.kind === "create_customer" && pending?.type === "skapa_kund" && pending.name.toLowerCase().includes("erik");
    checks.push(assert("5. Saknad Erik → skapa kund", ok, `kort=${reply.card?.kind} pending=${pending?.type}`));
  }

  reset();
  {
    const created = await executeTool("create_invoice", {
      customerId: "cust-anna",
      title: "Testfaktura",
      amountInclVat: 12500,
    });
    const invoiceId = created.forModel.invoiceId as string;
    const send = await executeTool("send_invoice", { invoiceId });
    const after = db().invoices.find((i) => i.id === invoiceId);
    const pending = db().pendingActions.find((a) => a.type === "skicka_faktura");
    const ok =
      after?.status === "utkast" &&
      pending?.type === "skicka_faktura" &&
      send.requiresConfirmation === true &&
      send.card?.kind === "confirm";
    checks.push(assert("6. Skicka faktura kräver bekräftelse", ok, `status=${after?.status} pending=${pending?.type}`));
  }

  reset();
  {
    await sendUserMessage("Hur mycket kan jag spendera utan att riskera momsen?");
    const f = financeOverview();
    const reply = lastAssistant();
    const ok = reply.text.includes(kr(f.available));
    checks.push(assert("7. Tillgängligt kassa använder financeOverview", ok, `available=${kr(f.available)}`));
  }

  reset();
  {
    const refuse = isBankIdApprovalRequest("Godkänn Annas offert");
    await sendUserMessage("Godkänn Annas offert");
    const reply = lastAssistant();
    const stillWaiting = db().quotes.filter((q) => q.customerId === "cust-anna" && q.status === "skickad");
    const ok = refuse && /kan inte godkänna/i.test(reply.text) && stillWaiting.length > 0;
    checks.push(assert("8. Godkänn Annas offert → vägrar BankID", ok, reply.text.slice(0, 100)));
  }

  checks.push(
    assert(
      "Verktygsregistret exponerar inte BankID-godkännande",
      !ASSISTANT_TOOL_NAMES.some((n) => /bankid|finalize|approve_quote|godkann/i.test(n)),
      ASSISTANT_TOOL_NAMES.join(", ")
    )
  );

  checks.push(assert("LLM avstängd i testerna (AI_PROVIDER=none)", !isAiConfigured(), `configured=${isAiConfigured()}`));

  reset();
  {
    const handled = dispatchRules("Skapa uppdrag för Karin Ek, bokhylla, imorgon");
    const job = db().jobs.find((j) => j.customerId === "cust-karin" && /bokhylla/i.test(j.title));
    checks.push(assert("Regel-fallback skapa uppdrag", Boolean(handled && job), `job=${job?.id}`));
  }

  reset();
  {
    await sendUserMessage("Skapa en ROT-offert till Anna");
    const q = db().quotes[db().quotes.length - 1];
    const v = currentVersion(q);
    const ok =
      q.customerId === "cust-anna" &&
      q.status === "utkast" &&
      v.rot?.type === "rot" &&
      Boolean(v.taxReductionTerms) &&
      !v.terms.includes("Skatteverket");
    checks.push(assert("ROT-offert via assistent använder systemvillkor", ok, `rot=${v.rot?.type} version=${v.taxReductionTerms?.version}`));
  }

  reset();
  {
    const invoicesBefore = db().invoices.length;
    await sendUserMessage("Fakturera extrajobbet hos Anna");
    const reply = lastAssistant();
    const ok =
      /eluttag/i.test(reply.text) &&
      /belopp|hittar inte på pris/i.test(reply.text) &&
      db().invoices.length === invoicesBefore;
    checks.push(assert("Extrajobb hos Anna läser anteckning och hittar inte på pris", ok, reply.text.slice(0, 160)));
  }

  reset();
  {
    const handled = dispatchRules("Skapa offert för Karins bokhylla, 28000 kr");
    const job = db().jobs.find((j) => j.id === "job-karin");
    const quote = db().quotes.find((q) => q.jobId === "job-karin" && q.status === "utkast");
    checks.push(
      assert(
        "Offert för Karins bokhylla kopplar uppdraget",
        Boolean(handled && quote && job && quote.jobId === job.id),
        `handled=${handled} job=${job?.id} quote=${quote?.id}`
      )
    );
  }

  reset();
  {
    const engine = getBusinessActions().watching;
    const result = await executeTool("list_watching", {});
    const forModel = result.forModel as { count?: number };
    const ok = result.ok && forModel.count === engine.length;
    checks.push(
      assert(
        "list_watching svarar ur samma På gång-feed som Hem",
        ok,
        `motor=${engine.length} verktyg=${forModel.count ?? "saknas"}`
      )
    );
  }

  reset();
  {
    const engine = getBusinessActions().attention;
    const result = await executeTool("list_actions", {});
    const forModel = result.forModel as { count?: number };
    const ok = result.ok && engine.length > 0 && forModel.count === engine.length;
    checks.push(
      assert(
        "list_actions svarar ur samma åtgärdsmotor som Hem",
        ok,
        `motor=${engine.length} verktyg=${forModel.count ?? "saknas"}`
      )
    );
  }

  reset();
  {
    const engine = getBusinessActions().attention;
    const handled = dispatchRules("Vad behöver jag göra idag?");
    const reply = lastAssistant();
    const rows = reply.card?.kind === "list" ? reply.card.rows : [];
    const ok =
      Boolean(handled) &&
      reply.text.includes(String(engine.length)) &&
      rows.length === Math.min(engine.length, 8) &&
      rows[0]?.label === engine[0]?.title;
    checks.push(
      assert(
        "”Vad behöver jag göra idag?” listar samma åtgärder som Hem",
        ok,
        `motor=${engine.length} rader=${rows.length} första=${rows[0]?.label?.slice(0, 50) ?? "—"}`
      )
    );
  }

  /* ------------------------------ Kommandofältet ------------------------------ */

  reset();
  {
    // Hela kedjan för "fakturera Johan": deterministisk tolkning → serversidigt
    // kundsök → uppdragsval med kvar-att-fakturera från tjänstelagret →
    // fakturautkast via SAMMA verktygslager. Beloppet räknas aldrig om i fältet.
    const parsed = parseFreeText("fakturera Johan");
    const hits = parsed.confidence === "high" && parsed.entityQuery ? searchCustomersForCommand(parsed.entityQuery) : [];
    const johan = hits.find((h) => h.label === "Johan Lindberg");
    const options = johan ? invoiceTargetOptionsFor(johan.id) : [];
    const jobOption = options.find((o) => o.kind === "job");
    const expected = jobOption?.kind === "job" ? remainingToInvoiceForJob(jobOption.jobId) : 0;
    const run =
      johan && jobOption?.kind === "job"
        ? await runBarCommand("create_invoice", { customerId: johan.id, jobId: jobOption.jobId })
        : null;
    const created = db().invoices[db().invoices.length - 1];
    const ok =
      parsed.confidence === "high" &&
      parsed.commandId === "create_invoice" &&
      Boolean(johan) &&
      jobOption?.kind === "job" &&
      expected > 0 &&
      jobOption.amount === expected &&
      run?.ok === true &&
      created.status === "utkast" &&
      invoiceTotals(created).toPay === expected &&
      run.href === `/ekonomi/fakturor/${created.id}`;
    checks.push(
      assert(
        "Kommandofältet: ”fakturera Johan” → utkast via verktygslagret",
        ok,
        `kvar=${kr(expected)} utkast=${created ? kr(invoiceTotals(created).toPay) : "—"} status=${created?.status}`
      )
    );
  }

  reset();
  {
    const run = await runBarCommand("show_unpaid_invoices");
    const open = db().invoices.filter(isOpenReceivable);
    const rows = run.card?.kind === "list" ? run.card.rows : [];
    const ok =
      run.ok &&
      open.length > 0 &&
      open.every((i) => i.type !== "kredit") &&
      rows.length === open.length &&
      run.text.includes(String(open.length));
    checks.push(
      assert(
        "Kommandofältet: obetalda = riktiga fordringar, aldrig kreditfakturor",
        ok,
        `öppna=${open.length} rader=${rows.length}`
      )
    );
  }

  reset();
  {
    const engine = getBusinessActions().watching;
    const run = await runBarCommand("show_watching");
    const rows = run.card?.kind === "list" ? run.card.rows : [];
    const ok = run.ok && rows.length === Math.min(engine.length, 8);
    checks.push(
      assert(
        "Kommandofältet: ”på gång” = getBusinessActions().watching",
        ok,
        `motor=${engine.length} rader=${rows.length}`
      )
    );
  }

  reset();
  {
    const engine = getBusinessActions().attention;
    const run = await runBarCommand("show_today_actions");
    const rows = run.card?.kind === "list" ? run.card.rows : [];
    const ok =
      run.ok && engine.length > 0 && rows.length === Math.min(engine.length, 8) && rows[0]?.label === engine[0]?.title;
    checks.push(
      assert(
        "Kommandofältet: ”idag” = getBusinessActions()",
        ok,
        `motor=${engine.length} rader=${rows.length}`
      )
    );
  }

  reset();
  {
    // Utan LLM ska fri text som reglerna inte klarar ge det ÄRLIGA svaret –
    // typat not_configured, aldrig ett fejkat modellsvar.
    const parsed = parseFreeText("hjälp mig planera veckan och skriv ett kärleksbrev");
    const viaAi = await interpretFreeTextViaAi("hjälp mig planera veckan");
    const ok =
      parsed.confidence === "none" &&
      !viaAi.ok &&
      viaAi.notConfigured === true &&
      viaAi.text === FREE_TEXT_FALLBACK_MESSAGE;
    checks.push(
      assert(
        "Kommandofältet: okänd fri text utan LLM → ärlig fallback, inget fejkat svar",
        ok,
        `parse=${parsed.confidence} text=${viaAi.text.slice(0, 60)}`
      )
    );
  }

  return checks;
}
