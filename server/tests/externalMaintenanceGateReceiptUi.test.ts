import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import { hasCurrentExternalDelegateReceipt } from "../../shared/externalMaintenanceWorkflow";

function gateExitRows(rows: any[]) {
  const path = "client/src/pages/assets/GateSecurity.tsx";
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = "";
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "exitRows" && node.initializer) expression = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source); expect(expression).not.toBe("");
  return vm.runInNewContext(ts.transpileModule(expression, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { rows, hasCurrentExternalDelegateReceipt });
}
const job = { id: 1, status: "waiting_gate_exit", delegateId: 7, delegateReceiptById: 7,
  delegateReceiptAt: "2026-11-04T08:00:00Z", warehousePreparedAt: "2026-11-04T07:00:00Z",
  preparationRevision: 1, delegateReceiptStatus: "accepted", purchaseTitle: "إصلاح الأصل" };

describe("Gate workspace offers exit only after the assigned delegate accepted the current preparation", () => {
  it("retains only accepted titled jobs and leaves other cards out of the exit-action queue", () => {
    const valid = { job };
    const rows = [valid, { job: { ...job, id: 2, status: "waiting_delegate_receipt", delegateReceiptStatus: "pending" } },
      { job: { ...job, id: 3, status: "waiting_warehouse_preparation", delegateReceiptStatus: "rejected" } },
      { job: { ...job, id: 4, status: "waiting_gate_entry" } }];
    expect(gateExitRows(rows)).toEqual([valid]);
  });
  it.each([{ purchaseTitle: "   " }, { delegateReceiptAt: null }, { delegateReceiptStatus: null },
    { delegateReceiptStatus: "pending" }, { delegateReceiptStatus: "rejected" }, { delegateId: 8 }, { delegateReceiptById: null },
    { preparationRevision: 0 }, { warehousePreparedAt: "2026-11-04T09:00:00Z" }])("does not expose a stale/legacy exit action for %j", changed => {
    expect(gateExitRows([{ job: { ...job, ...changed } }])).toEqual([]);
  });
});
