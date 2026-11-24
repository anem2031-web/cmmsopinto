import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { purchaseOrders, purchaseOrderItems, users } from "../../drizzle/schema";
import { isDelegateRole } from "../../shared/roles";
import { summarizePurchasePricingStage } from "../../shared/purchasePricingStage";
import {
  assertEmergencyPurchaseAllowed,
  cancelEmergencyBundleItem,
  loadEmergencyItemStates,
  lockEmergencyBundleRootsForItems,
  syncEmergencyBundleReceipts,
} from "../services/emergency-purchases/service";
import { purchaseSpecificationsDatabase } from "./fixtures/purchaseSpecificationsDatabase";

const file = "server/routers/purchase/purchase-orders.router.ts";
const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
const handlers = ["cancelItemPurchase", "confirmItemPurchase"] as const;
const dependencies = ["emergencyState", "withEmergencyPurchaseExecution", "syncIndependentPurchasePricingStage"];
const source = ast.statements.filter(node =>
  ts.isFunctionDeclaration(node) && !!node.name && dependencies.includes(node.name.text)
).map(node => node.getText(ast));
let routerBody: ts.ObjectLiteralExpression | undefined;
for (const statement of ast.statements) {
  if (!ts.isVariableStatement(statement)) continue;
  for (const declaration of statement.declarationList.declarations) {
    if (declaration.name.getText(ast) !== "purchaseOrdersRouter") continue;
    if (declaration.initializer && ts.isCallExpression(declaration.initializer)) {
      const argument = declaration.initializer.arguments[0];
      if (argument && ts.isObjectLiteralExpression(argument)) routerBody = argument;
    }
  }
}
if (source.length !== dependencies.length || !routerBody) throw Error("Emergency purchase handlers not found");
const properties = handlers.map(name => {
  const property = routerBody!.properties.find(node => ts.isPropertyAssignment(node) && node.name.getText(ast) === name);
  if (!property || !ts.isPropertyAssignment(property) || !ts.isCallExpression(property.initializer)) {
    throw Error("Emergency purchase mutation not found");
  }
  return name + ":" + property.initializer.arguments[0].getText(ast);
});
const runnable = ts.transpileModule(source.join("\n") + "\n({" + properties.join(",") + "});", {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

const assignee = { id: 10, role: "delegate", name: "Buyer" };
const submitPurchase = { itemId: 701, purchasedPhotoUrl: "product.jpg", invoicePhotoUrl: "invoice.jpg" };
const cancelPurchase = { itemId: 701, note: "تعذر الشراء من المورد" };

describe("Delegate emergency purchase execution", () => {
  let fixture: ReturnType<typeof purchaseSpecificationsDatabase>;
  let run: Record<typeof handlers[number], (args: any) => Promise<any>>;
  const selected = () => fixture.memory.prepare("SELECT * FROM purchase_order_items WHERE id=701").get();
  const root = () => fixture.memory.prepare("SELECT * FROM emergency_pricing_bundles WHERE bundleId=33").get();
  const sidecar = () => fixture.memory.prepare("SELECT * FROM emergency_purchase_items WHERE purchaseOrderItemId=701").get();

  beforeEach(() => {
    fixture = purchaseSpecificationsDatabase();
    fixture.memory.exec(`
      ALTER TABLE purchase_order_items ADD COLUMN delegateId INTEGER;
      ALTER TABLE purchase_order_items ADD COLUMN batchId INTEGER;
      ALTER TABLE purchase_order_items ADD COLUMN purchasedAt TEXT;
      ALTER TABLE purchase_order_items ADD COLUMN purchasedById INTEGER;
      ALTER TABLE purchase_order_items ADD COLUMN delegateChangeRequestedAt TEXT;
      ALTER TABLE purchase_order_items ADD COLUMN purchaseCancelReason TEXT;
      ALTER TABLE purchase_order_items ADD COLUMN purchaseCancelledById INTEGER;
      ALTER TABLE purchase_order_items ADD COLUMN purchaseCancelledByName TEXT;
      ALTER TABLE purchase_order_items ADD COLUMN purchaseCancelledAt TEXT;
      CREATE TABLE emergency_purchase_items(purchaseOrderItemId INTEGER PRIMARY KEY,bundleId INTEGER,cancelledAt TEXT,cancelledById INTEGER,cancellationReason TEXT);
      CREATE TABLE emergency_pricing_bundles(bundleId INTEGER PRIMARY KEY,submittedAt TEXT,cancelledAt TEXT,receivedItemCount INTEGER,requiredItemCount INTEGER);
      CREATE TABLE delegate_pricing_bundles(id INTEGER PRIMARY KEY,delegateId INTEGER);
      CREATE TABLE delegate_pricing_bundle_approvals(bundleId INTEGER PRIMARY KEY,status TEXT,revision INTEGER,accountingApprovedById INTEGER,accountingApprovedAt TEXT,managementApprovedById INTEGER,managementApprovedAt TEXT);
      CREATE TABLE delegate_pricing_bundle_batches(bundleId INTEGER,purchaseOrderId INTEGER,pricingBatchId INTEGER);
      CREATE TABLE po_pricing_batches(id INTEGER PRIMARY KEY,purchaseOrderId INTEGER,status TEXT);
      INSERT INTO users(id,role,isActive,name) VALUES (10,'delegate',1,'Buyer'), (11,'delegate_manager',1,'Other');
      INSERT INTO purchase_orders(id,status,poNumber,requestedById) VALUES (7,'pending_estimate','PR-7',22);
      INSERT INTO purchase_order_items(id,purchaseOrderId,delegateId,batchId,status) VALUES (701,7,10,103,'estimated'),(702,7,10,103,'estimated'),(703,7,10,104,'estimated');
      INSERT INTO emergency_purchase_items(purchaseOrderItemId,bundleId) VALUES (701,33),(702,33);
      INSERT INTO emergency_pricing_bundles VALUES (33,'2026-11-24',NULL,0,2);
      INSERT INTO delegate_pricing_bundles VALUES (33,10);
      INSERT INTO delegate_pricing_bundle_approvals VALUES (33,'awaiting_receipt',0,NULL,NULL,NULL,NULL);
      INSERT INTO delegate_pricing_bundle_batches VALUES (33,7,103);
      INSERT INTO po_pricing_batches VALUES (103,7,'awaiting_receipt'),(104,7,'pending_management');
    `);
    run = vm.runInNewContext(runnable, {
      db: {
        getDb: async () => fixture.db,
        withTransaction: fixture.db.transaction,
        getPOItemById: async (id: number) => fixture.memory.prepare("SELECT * FROM purchase_order_items WHERE id=?").get(id),
        getPurchaseOrderById: async (id: number) => fixture.memory.prepare("SELECT * FROM purchase_orders WHERE id=?").get(id),
        getPOItems: async (id: number) => fixture.memory.prepare("SELECT * FROM purchase_order_items WHERE purchaseOrderId=?").all(id),
        getPOPricingBatches: async (id: number) => fixture.memory.prepare("SELECT * FROM po_pricing_batches WHERE purchaseOrderId=?").all(id),
        updatePOItem: (id: number, data: any, tx = fixture.db) => tx.update(purchaseOrderItems).set(data).where(eq(purchaseOrderItems.id, id)),
        updatePurchaseOrder: (id: number, data: any, tx = fixture.db) => tx.update(purchaseOrders).set(data).where(eq(purchaseOrders.id, id)),
        getUsersByRole: async () => [],
        getPurchaseManagerUsers: async () => [],
        createNotification: vi.fn(),
        createAuditLog: vi.fn(),
      },
      purchaseOrders, purchaseOrderItems, users, eq, isDelegateRole, TRPCError,
      loadEmergencyItemStates, lockEmergencyBundleRootsForItems, assertEmergencyPurchaseAllowed,
      cancelEmergencyBundleItem, syncEmergencyBundleReceipts, summarizePurchasePricingStage,
      assertPOItemAssignedToDelegate: (actor: typeof assignee, item: { delegateId: number }) => {
        if (actor.id !== item.delegateId) throw new TRPCError({ code: "FORBIDDEN" });
      },
      getPurchaseOrderTicketContext: async () => ({ po: { id: 7, status: "pending_estimate" } }),
      trialEnabled: async () => false,
      syncPathBTicketFromPurchaseOrder: vi.fn(),
      queuePurchaseTranslation: vi.fn(),
      createTranslatedProcurementComment: vi.fn(),
    });
  });
  afterEach(() => fixture.close());

  it("records purchase before finance for the submitted emergency assignee and preserves the normal sibling's stage", async () => {
    await expect(run.confirmItemPurchase({ input: submitPurchase, ctx: { user: assignee } })).resolves.toMatchObject({
      itemStatus: "purchased", purchaseOrderStatus: "pending_management",
    });
    expect(selected()).toMatchObject({ status: "purchased", purchasedById: 10, purchasedPhotoUrl: "product.jpg", invoicePhotoUrl: "invoice.jpg" });
    expect(root()).toMatchObject({ requiredItemCount: 2, receivedItemCount: 0 });
    await expect(run.cancelItemPurchase({ input: cancelPurchase, ctx: { user: assignee } })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(sidecar()).toMatchObject({ cancelledAt: null });
  });

  it("rejects both operations from another delegate or an unsubmitted bundle", async () => {
    for (const [handler, input] of [[run.confirmItemPurchase, submitPurchase], [run.cancelItemPurchase, cancelPurchase]] as const) {
      await expect(handler({ input, ctx: { user: { id: 11, role: "delegate_manager" } } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    fixture.memory.exec("UPDATE emergency_pricing_bundles SET submittedAt=NULL");
    await expect(run.confirmItemPurchase({ input: submitPurchase, ctx: { user: assignee } })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(run.cancelItemPurchase({ input: cancelPurchase, ctx: { user: assignee } })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(selected()).toMatchObject({ status: "estimated", purchasedAt: null });
    expect(sidecar()).toMatchObject({ cancelledAt: null });
  });

  it("cancels final and excludes only the cancelled member from the required receipt count", async () => {
    await expect(run.cancelItemPurchase({ input: cancelPurchase, ctx: { user: assignee } })).resolves.toEqual({ success: true });
    expect(selected()).toMatchObject({ status: "cancelled", purchaseCancelReason: cancelPurchase.note, batchId: 103 });
    expect(sidecar()).toMatchObject({ bundleId: 33, cancelledAt: expect.any(String), cancelledById: 10, cancellationReason: cancelPurchase.note });
    expect(root()).toMatchObject({ requiredItemCount: 1, receivedItemCount: 0 });
    await expect(run.confirmItemPurchase({ input: submitPurchase, ctx: { user: assignee } })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rolls back the item and cancellation if receipt progress cannot be saved", async () => {
    fixture.memory.exec("CREATE TRIGGER fail_progress BEFORE UPDATE ON emergency_pricing_bundles BEGIN SELECT RAISE(ABORT,'progress unavailable'); END");
    await expect(run.cancelItemPurchase({ input: cancelPurchase, ctx: { user: assignee } })).rejects.toThrow("progress unavailable");
    expect(selected()).toMatchObject({ status: "estimated", purchaseCancelReason: null });
    expect(sidecar()).toMatchObject({ cancelledAt: null, cancellationReason: null });
    expect(root()).toMatchObject({ requiredItemCount: 2 });
  });
});
