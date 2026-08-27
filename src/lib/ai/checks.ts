import { db, replaceDb } from "../store";
import { buildSeed } from "../seed";
import { createCustomer } from "../services/customers";
import { createJob } from "../services/jobs";
import { sendUserMessage, dispatchRules } from "../services/assistant";
import { executeTool, ASSISTANT_TOOL_NAMES } from "./tools";
import { isAiConfigured } from "./provider";
import { isBankIdApprovalRequest } from "./resolve";
import { financeOverview } from "../services/finance";
import { invoiceTotals, currentVersion } from "../services/data";
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
    const req = db().requests.find((r) => r.id === "req-karin");
    const quote = db().quotes.find((q) => q.requestId === "req-karin" && q.status === "utkast");
    checks.push(
      assert(
        "Offert för Karins bokhylla kopplar förfrågan",
        Boolean(handled && quote && req?.status === "offert_skapad" && req.quoteId === quote?.id),
        `handled=${handled} status=${req?.status} quote=${quote?.id}`
      )
    );
  }

  return checks;
}
