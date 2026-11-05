import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import ts from "typescript";
import vm from "node:vm";
import { warehouseReturnBackLink } from "../../shared/returns-center";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const returnsDb = () => read("server/_core/db/warehouse-returns.ts");
const returnsRouter = () => read("server/routers/inventory/returns.router.ts");
const receiptsDb = () => read("server/_core/db/warehouse-receipts.ts");
const schema = () => read("drizzle/schema.ts");
const returnPage = () => read("client/src/pages/inventory/WarehouseReturn.tsx");
const returnPrint = () => read("client/src/lib/printReturnDocument.ts");

describe("Main Phase 5 / 5.2 — Supplier return hardening", () => {
  it("keeps the Lot-aware supplier return fully transactional and server-valued", () => {
    const source = returnsDb();
    const start = source.indexOf("export async function createLotAwareSupplierReturn");
    const end = source.indexOf("export async function createLegacySupplierReturn", start);
    const block = source.slice(start, end);

    expect(block).toContain("return existingTx ? executeReturn(existingTx) : database.transaction(executeReturn)");
    expect(block).toContain("resolveInventoryLotForSupplierReturn");
    expect(block).toContain("consumeInventoryLotForIssue");
    expect(block).toContain("FOR UPDATE");
    expect(block).toContain("const movementUnitCost = parseFloat(inventoryItem.averageCost || \"0\")");
    expect(block).toContain("const movementTotalCost = calculateMovementTotal(returnedQuantity, movementUnitCost)");
    expect(block).toContain("gte(inventory.quantity, returnedQuantity)");
    expect(block).toContain('transactionType: "return"');
    expect(block).toContain("await createReturnDocument({");
    expect(block).toContain("}, tx);");
  });

  it("generates the return number through the active transaction writer", () => {
    expect(receiptsDb()).toContain("export async function getNextReturnNumber(tx?: any)");
    expect(receiptsDb()).toContain("const db = tx || await getDb();");
    expect(returnsDb()).toContain("const returnNumber = await getNextReturnNumber(tx);");
    expect(returnsRouter()).not.toContain("const returnNumber = await db.getNextReturnNumber();");
  });

  it("keeps the legacy non-Lot supplier return workflow but makes core posting atomic", () => {
    const source = returnsDb();
    const start = source.indexOf("export async function createLegacySupplierReturn");
    const end = source.indexOf("export async function getInventoryTransactions", start);
    const block = source.slice(start, end);

    expect(block).toContain("return database.transaction(async (tx: any) => {");
    expect(block).toContain("FOR UPDATE");
    expect(block).toContain("await tx.insert(warehouseReturns)");
    expect(block).toContain("await tx.insert(inventoryTransactions)");
    expect(block).toContain("await tx.update(inventory).set({");
    expect(block).toContain("await createReturnDocument({");
    expect(block).toContain("transactionType: \"return\"");
  });

  it("preserves receipt/PO source linkage and partial-return behavior", () => {
    const source = returnsDb();
    expect(source).toContain("resolveInventoryLotForSupplierReturn");
    expect(source).toContain("receiptId: resolvedLot.receiptId");
    expect(source).toContain("purchaseOrderItemId");
    expect(source).toContain("returnedQuantity: sql`COALESCE(${purchaseOrderItems.returnedQuantity}, 0) + ${returnedQuantity}`");
  });

  it("syncs the approved future-only original Delivery link without backfill semantics", () => {
    const source = schema();
    expect(source).toContain("sourceDeliveryDocumentId: int()");
    expect(source).toContain('index("idx_warehouse_returns_source_delivery").on(table.sourceDeliveryDocumentId)');
    expect(source).toContain("NULL keeps all historical/supplier returns unchanged");
  });

  it("implements Recipient → Warehouse as same original Lot + original issue cost + atomic posting", () => {
    const source = returnsDb();
    const start = source.indexOf("export async function createRecipientWarehouseReturn");
    const end = source.indexOf("export async function getInventoryTransactions", start);
    const block = source.slice(start, end);

    expect(block).toContain("const executeReturn = async (tx: any) => {");
    expect(block).toContain("return existingTx ? executeReturn(existingTx) : database.transaction(executeReturn);");
    expect(block).toContain("SELECT id FROM delivery_documents");
    expect(block).toContain("FOR UPDATE");
    expect(block).toContain("source.returnableQuantity");
    expect(block).toContain("inventoryLotBalances");
    expect(block).toContain("newLotRemaining");
    expect(block).toContain("const originalIssueUnitCost = roundTo(Number(source.originalIssueUnitCost || 0), 4)");
    expect(block).toContain("const newValue = roundTo(currentValue + returnValue, 2)");
    expect(block).toContain("const newAverageCost = newQuantity > 0 ? roundTo(newValue / newQuantity, 4) : 0");
    expect(block).toContain('type: "in"');
    expect(block).toContain('transactionType: "return"');
    expect(block).toContain("sourceDeliveryDocumentId: source.sourceDeliveryDocumentId");
    expect(block).toContain("await createReturnDocument({");
  });

  it("guards old/unlinked deliveries and cumulative over-return instead of backfilling them", () => {
    const source = returnsDb();
    expect(source).toContain("سند الصرف قديم أو غير مكتمل الربط بالـInventory/Lot/Movement");
    expect(source).toContain("previouslyReturnedQuantity");
    expect(source).toContain("أكبر من المتبقي القابل للإرجاع من سند الصرف");
    expect(source).not.toContain("UPDATE delivery_documents SET lotId");
  });

  it("exposes the approved recipient-return path in the router/UI and printed traceability", () => {
    expect(returnsRouter()).toContain("resolveRecipientReturnSource");
    expect(returnsRouter()).toContain("createRecipientReturn");
    expect(returnPage()).toContain("مرتجع من الجهة إلى المخزن");
    expect(returnPage()).toContain("تكلفة الصرف الأصلية");
    expect(returnPage()).toContain("المتبقي القابل للإرجاع");
    expect(returnPrint()).toContain("سند الصرف الأصلي");
    expect(returnPrint()).toContain("توقيع مُعيد الصنف");
  });

  it("leaves a completed return form safely even when a legacy response has no document number", () => {
    const page = ts.createSourceFile("WarehouseReturn.tsx", returnPage(), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const callbacks: string[] = [];
    function visit(node: ts.Node) {
      if (ts.isVariableDeclaration(node) && ["recipientReturnMut", "returnMut", "followupMut"].includes(node.name.getText(page)) && node.initializer && ts.isCallExpression(node.initializer)) {
        const options = node.initializer.arguments[0];
        if (options && ts.isObjectLiteralExpression(options)) {
          const success = options.properties.find(prop => ts.isPropertyAssignment(prop) && prop.name.getText(page) === "onSuccess") as ts.PropertyAssignment;
          if (success) callbacks.push(success.initializer.getText(page));
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(page);
    expect(callbacks).toHaveLength(3);
    for (const search of ["", "?returnTo=returns-center&returnTab=specifications"]) {
      const destination = warehouseReturnBackLink(search);
      for (const code of callbacks) {
        const navigate = vi.fn();
        const callback = vm.runInNewContext(ts.transpileModule(`(${code})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
          navigate, backLink: destination, toast: { success: vi.fn() }, t: { common: { savedSuccessfully: "Saved" } },
        });
        expect(() => callback(undefined)).not.toThrow();
        expect(navigate).toHaveBeenCalledTimes(1);
        expect(navigate).toHaveBeenCalledWith(destination);
      }
    }
  });

});
