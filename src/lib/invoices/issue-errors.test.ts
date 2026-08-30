import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  INVOICE_ISSUE_FAILED,
  looksLikeInternalError,
  userFacingInvoiceSendError,
  userFacingIssueError,
} from "./issue-errors";
import { InvoiceNotReadyError } from "./validate";

describe("userFacingIssueError", () => {
  it("läcker aldrig issue_invalid eller andra API-koder", () => {
    const leaked = userFacingIssueError(new Error("issue_invalid: faktura-id och nummer krävs"));
    assert.notEqual(leaked, "issue_invalid: faktura-id och nummer krävs");
    assert.equal(leaked.includes("issue_invalid"), false);
    assert.match(leaked, /utfärdas/i);
  });

  it("översätter sequence_conflict och issue_conflict", () => {
    assert.equal(userFacingIssueError(new Error("sequence_conflict: fakturanummer 12 är redan använt")).includes("sequence_conflict"), false);
    assert.match(userFacingIssueError(new Error("sequence_conflict: fakturanummer 12 är redan använt")), /samtidigt|försök igen/i);
    assert.equal(userFacingIssueError(new Error("issue_conflict: fakturan är redan utfärdad eller ändrad")).includes("issue_conflict"), false);
  });

  it("behåller checklistans svenska text från InvoiceNotReadyError", () => {
    const err = new InvoiceNotReadyError([
      { code: "seller_vat", message: "Momsregistreringsnummer saknas i företagsuppgifterna." },
    ]);
    assert.equal(userFacingIssueError(err), "Momsregistreringsnummer saknas i företagsuppgifterna.");
  });

  it("behåller begripliga svenska domänfel", () => {
    assert.equal(userFacingIssueError(new Error("Fakturan finns inte")), "Fakturan finns inte");
  });

  it("döljer stackspår och SQLSTATE", () => {
    assert.equal(userFacingIssueError(new Error("P0001")), INVOICE_ISSUE_FAILED);
    assert.equal(
      looksLikeInternalError("error: column \"foo\" does not exist"),
      true
    );
    assert.equal(userFacingInvoiceSendError(new Error("immutability: fakturanummer tilldelas endast via app.issue_invoice")).includes("immutability"), false);
  });
});
