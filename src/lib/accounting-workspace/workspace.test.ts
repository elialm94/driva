process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "../store";
import { emptyTestDb, labor } from "../invoices/test-db";
import { createInvoice, issueInvoice } from "../services/invoices";
import { runAsActor, type CollaborationActor } from "../collaboration/actor";
import { assertCan, can } from "../collaboration/permissions";
import { accountantHref } from "../collaboration/hrefs";
import { accountantActionHref } from "../collaboration/portfolio";
import type { BusinessAction } from "../services/actions";
import { BOKFORING_DETAIL_TABS, BOKFORING_REPORT_TABS, bokforingDetailTabForPath } from "../nav";
import {
  OWNER_WORKSPACE_BASE,
  isOwnerWorkspaceHref,
  ownerPathFor,
  portfolioBasePath,
  workspaceBaseFromPathname,
  workspaceHref,
  workspaceRelativePath,
} from "./tabs";
import { capabilitiesForRole, wsCan, wsHref, wsReadOnly, type AccountingWorkspace } from "./shared";
import { bankSummaryViewModel, momsViewModel, rapporterViewModel, verifikationerViewModel } from "./view-models";

const CLIENT = "biz-snickaren";
const PORTFOLIO = `/redovisning/k/${CLIENT}`;

function actor(role: CollaborationActor["role"], userId: string): CollaborationActor {
  return { userId, email: `${userId}@example.test`, name: userId, role, businessId: CLIENT };
}

function ws(surface: "owner" | "portfolio", role: AccountingWorkspace["role"]): AccountingWorkspace {
  const owner = surface === "owner";
  return {
    surface,
    businessId: CLIENT,
    businessName: "Snickaren AB",
    actor: { userId: "u", name: "U", email: "u@example.test" },
    role,
    capabilities: capabilitiesForRole(role),
    basePath: owner ? OWNER_WORKSPACE_BASE : PORTFOLIO,
    actionBusinessId: owner ? undefined : CLIENT,
    showPortfolioNav: !owner,
    demo: false,
  };
}

describe("Gemensam redovisningsarbetsyta – adresser", () => {
  it("ägarytan är identiteten, konsultytan får samma relativa väg och frågesträng", () => {
    assert.equal(workspaceHref(OWNER_WORKSPACE_BASE, "/bokforing/moms?ar=2025"), "/bokforing/moms?ar=2025");
    assert.equal(workspaceHref(PORTFOLIO, "/bokforing"), PORTFOLIO);
    assert.equal(workspaceHref(PORTFOLIO, "/bokforing/moms?ar=2025"), `${PORTFOLIO}/moms?ar=2025`);
    assert.equal(workspaceHref(PORTFOLIO, "/bokforing/bank?atgard=bank-tx1"), `${PORTFOLIO}/bank?atgard=bank-tx1`);
    assert.equal(workspaceHref(PORTFOLIO, "/bokforing/bokslut/bilagor"), `${PORTFOLIO}/bokslut/bilagor`);
    // Utanför bokföringen finns ingen motsvarighet: konsulten hamnar aldrig i ägarens layout.
    assert.equal(workspaceHref(PORTFOLIO, "/ekonomi?flik=utgifter"), PORTFOLIO);
    assert.equal(workspaceHref(PORTFOLIO, "/bokforingen"), PORTFOLIO, "prefix utan snedstreck är inte arbetsytan");
  });

  it("översätter tillbaka så flik- och ruttlogik för /bokforing kan återanvändas", () => {
    assert.equal(ownerPathFor(PORTFOLIO, `${PORTFOLIO}/huvudbok?konto=1930`), "/bokforing/huvudbok?konto=1930");
    assert.equal(ownerPathFor(PORTFOLIO, PORTFOLIO), "/bokforing");
    assert.equal(ownerPathFor(PORTFOLIO, "/redovisning"), "/redovisning");
    assert.equal(ownerPathFor(OWNER_WORKSPACE_BASE, "/bokforing/moms"), "/bokforing/moms");
    assert.equal(workspaceRelativePath(PORTFOLIO, `${PORTFOLIO}/lon/run-1`), "/lon/run-1");
    assert.equal(workspaceBaseFromPathname(`${PORTFOLIO}/moms`), PORTFOLIO);
    assert.equal(workspaceBaseFromPathname("/bokforing/moms"), OWNER_WORKSPACE_BASE);
    assert.equal(isOwnerWorkspaceHref("/api/bokforing/export?typ=sie"), false);
    assert.equal(isOwnerWorkspaceHref("/bokforing/verifikationer"), true);
  });

  it("varje ägarflik och rapportchip har en konsultmotsvarighet med samma aktiva flik", () => {
    for (const tab of [...BOKFORING_DETAIL_TABS, ...BOKFORING_REPORT_TABS]) {
      const translated = workspaceHref(PORTFOLIO, tab.href);
      assert.ok(translated.startsWith(PORTFOLIO), `${tab.href} → ${translated}`);
      assert.equal(bokforingDetailTabForPath(ownerPathFor(PORTFOLIO, translated)), bokforingDetailTabForPath(tab.href));
    }
  });

  it("accountantHref följer arbetsytan och skickar Ekonomi till banken", () => {
    assert.equal(accountantHref(CLIENT, "/bokforing/saldobalans?ar=2025"), `${PORTFOLIO}/saldobalans?ar=2025`);
    assert.equal(accountantHref(CLIENT, "/bokforing"), PORTFOLIO);
    assert.equal(accountantHref(CLIENT, "/ekonomi?flik=utgifter"), `${PORTFOLIO}/bank`);
    assert.equal(accountantHref(CLIENT, "/hemsida"), PORTFOLIO);
    assert.equal(portfolioBasePath(CLIENT), PORTFOLIO);
  });

  it("åtgärdskort med bokföringslänk behåller djuplänken på konsultytan", () => {
    const base = {
      priority: 50,
      category: "bank",
      title: "t",
      subtitle: "s",
      cta: { type: "link", label: "Öppna", href: "/bokforing/bank" },
    } as unknown as BusinessAction;
    assert.equal(
      accountantActionHref(CLIENT, { ...base, id: "bank-tx-1", href: "/bokforing/bank?atgard=bank-tx-1" }),
      `${PORTFOLIO}/bank?atgard=bank-tx-1`
    );
    assert.equal(accountantActionHref(CLIENT, { ...base, id: "vat-2025-q1", href: "/bokforing/moms?fokus=2025-Q1" }), `${PORTFOLIO}/moms?fokus=2025-Q1`);
    assert.equal(accountantActionHref(CLIENT, { ...base, id: "invoice-late-1", href: "/ekonomi/fakturor/1" }), `${PORTFOLIO}?sak=invoice-late-1`);
  });
});

describe("Gemensam redovisningsarbetsyta – samma siffror, olika behörighet", () => {
  function seed() {
    replaceDb(emptyTestDb());
    const inv = createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({ unitPrice: 12_000 })], rot: null });
    issueInvoice(inv.id);
    assert.ok(db().verifications.length > 0, "fakturan bokfördes");
  }

  it("ägare och konsult får identiska vymodeller ur samma tillstånd", () => {
    seed();
    const asOwner = runAsActor(actor("owner", "owner-1"), () => ({
      moms: momsViewModel({}),
      rapporter: rapporterViewModel({}),
      bank: bankSummaryViewModel(),
      ver: verifikationerViewModel({}, 100),
    }));
    const asConsultant = runAsActor(actor("accounting_consultant", "byra-1"), () => ({
      moms: momsViewModel({}),
      rapporter: rapporterViewModel({}),
      bank: bankSummaryViewModel(),
      ver: verifikationerViewModel({}, 100),
    }));
    const asAuditor = runAsActor(actor("auditor", "rev-1"), () => ({
      moms: momsViewModel({}),
      rapporter: rapporterViewModel({}),
      bank: bankSummaryViewModel(),
      ver: verifikationerViewModel({}, 100),
    }));
    assert.deepEqual(asConsultant, asOwner);
    assert.deepEqual(asAuditor, asOwner);
    assert.equal(asOwner.ver.total, db().verifications.length);
    assert.ok(asOwner.rapporter.resultat.omsattning > 0);
  });

  it("behörigheten avgör knappar och server actions – inte vilken yta man står på", () => {
    const ownerWs = ws("owner", "owner");
    const consultantWs = ws("portfolio", "accounting_consultant");
    const auditorWs = ws("portfolio", "auditor");

    assert.equal(wsCan(ownerWs, "submit_filing"), true);
    assert.equal(wsCan(consultantWs, "prepare_filing"), true);
    assert.equal(wsCan(consultantWs, "submit_filing"), false, "konsulten förbereder, ägaren lämnar in");
    assert.equal(wsReadOnly(consultantWs, "vat"), false);
    assert.equal(wsReadOnly(auditorWs, "vat"), true);
    assert.equal(wsReadOnly(auditorWs, "match_payment"), true);
    assert.equal(wsCan(auditorWs, "read_accounting"), true);
    assert.equal(wsCan(auditorWs, "export_accounting"), true, "revisorn får alltid läsa och exportera");
    assert.throws(() => assertCan("auditor", "write_accounting"));
    assert.throws(() => assertCan("accounting_consultant", "submit_bank_payment"), "Ferva flyttar inga pengar åt byrån");
    assert.equal(can("accounting_consultant", "write_accounting"), true);

    // Samma ägarlänk, rätt yta.
    assert.equal(wsHref(ownerWs, "/bokforing/moms"), "/bokforing/moms");
    assert.equal(wsHref(consultantWs, "/bokforing/moms"), `${PORTFOLIO}/moms`);
    // Konsultytan skickar alltid businessId med sina server actions.
    assert.equal(ownerWs.actionBusinessId, undefined);
    assert.equal(consultantWs.actionBusinessId, CLIENT);
    assert.deepEqual(
      capabilitiesForRole("auditor").filter((c) => c.startsWith("write") || c.startsWith("submit")),
      []
    );
  });
});
