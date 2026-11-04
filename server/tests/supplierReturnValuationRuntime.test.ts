import { it, expect, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { FollowupPort, FollowupTx } from "../supplier-return-followup/commands";
import { createTrialReturn, supplierReturnValuePreview } from "../supplier-return-followup/runtime";
import { newReturnRequest } from "../supplier-return-followup/create-once";

// Only the existing physical writer is substituted. The real followup transaction,
// idempotency, source checks, invoice calculation, case and event paths run below.
vi.mock("../_core/db/warehouse-returns", () => ({ createLotAwareSupplierReturn: (input: any, tx: any) => tx.physicalWrite(input) }));
const actor = { id: 1, role: "warehouse" };
const input = { operationKey: "valuation-create-0001", trackingToken: "LOT-31", warehouseId: 4, returnedQuantity: 3, delegateId: 2, reason: "تالف" };
function fixture() {
  const invoice = { lotId: 31, sourceType: "receipt", receiptId: 20, receiptItemId: 21, actualReceiptId: 20, actualReceiptItemId: 21, lineReceiptId: 20,
    purchaseOrderId: 11, actualOrderId: 11, purchaseOrderItemId: 12, actualOrderItemId: 12, linePurchaseOrderItemId: 12, itemOrderId: 11,
    catalogItemId: 41, lineCatalogItemId: 41, inventoryCatalogItemId: 41, inventoryUnit: "قطعة", inventoryId: 51, lotCode: "LOT-31",
    originalQuantity: "10.000", conversionFactor: "1.0000", purchaseUnit: "قطعة", issueUnit: "قطعة", receiptQuantity: "10.000", receiptPurchaseUnit: "قطعة",
    invoiceUnitCost: "100.0000", invoiceTaxAmount: "0.00", invoiceLineTotal: "1000.00", vendorName: "المورد", invoiceNumber: "INV-1", requestedById: 5 };
  let state: any = { quantity: 10, lotQuantity: 10, balanceQuantity: 10, active: true, source: invoice,
    cases: [], returns: [], events: [], notifications: [], movements: [] };
  let failEvent = false, databaseName = "copycmms2", serial = Promise.resolve();
  const queries: string[] = [];
  function adapter(s: any): FollowupTx & { physicalWrite(input: any): Promise<any> } {
    return {
      async physicalWrite(request: any) {
        expect(request.trackingToken).toBe("LOT-31"); expect(request.warehouseId).toBe(4);
        if (request.returnedQuantity > s.quantity) throw Error("insufficient stock");
        const id = s.returns.length + 100;
        s.quantity -= request.returnedQuantity; s.lotQuantity -= request.returnedQuantity; s.balanceQuantity -= request.returnedQuantity;
        s.movements.push({ quantity: request.returnedQuantity, unitCost: 70, value: request.returnedQuantity * 70 });
        s.returns.push({ id, returnedQuantity: request.returnedQuantity });
        return { returnId: id, returnNumber: `RTN-${id}` };
      },
      async execute(query) {
        const q = new MySqlDialect().sqlToQuery(query); queries.push(q.sql);
        if (q.sql.includes("SELECT DATABASE")) return [[{ databaseName }]];
        if (q.sql.includes("SELECT id,role,isActive")) return [[{ id: q.params[0], role: q.params[0] === 1 ? "warehouse" : "delegate", isActive: Number(s.active) }]];
        if (q.sql.includes("SELECT name,username")) return [[{ name: "المندوب" }]];
        if (q.sql.includes("FROM supplier_return_replacement_plans p INNER JOIN supplier_return_cases")) return [[]];
        if (q.sql.includes("FROM supplier_return_cases")) return [s.cases.filter((c: any) => c.createdById === q.params[0] && c.creationKey === q.params[1])];
        if (q.sql.includes("FROM inventory_lots l")) return [[{ ...s.source, availableQuantity: s.balanceQuantity, inventoryQuantity: s.quantity, remainingQuantity: s.lotQuantity }]];
        if (q.sql.includes("SUM(returnedQuantity)")) return [[{ quantity: String(s.returns.reduce((n: number, r: any) => n + r.returnedQuantity, 0)) }]];
        if (q.sql.includes("FROM warehouse_returns ret")) {
          const r = s.returns.find((r: any) => r.id === q.params[0]);
          return [[{ ...s.source, ...r, returnOrderId: 11, returnOrderItemId: 12, returnReceiptId: 20 }]];
        }
        if (q.sql.includes("SELECT id,returnedQuantity FROM warehouse_returns")) return [s.returns.filter((r: any) => r.id !== q.params[1])];
        if (q.sql.includes("SELECT r.*,p.requestedById")) return [[{ ...s.source, ...s.returns.find((r: any) => r.id === q.params[0]), unit: "قطعة" }]];
        if (q.sql.startsWith("INSERT INTO supplier_return_cases")) {
          const columns = q.sql.match(/\(([^)]+)\)/)![1].split(",").map(c => c.trim());
          const record = Object.fromEntries(columns.map((name, i) => [name, q.params[i]]));
          const id = s.cases.length + 1; s.cases.push({ id, ...record }); return [{ insertId: id }];
        }
        if (q.sql.startsWith("INSERT INTO supplier_return_events")) {
          if (failEvent) throw Error("event insert failed");
          s.events.push(JSON.parse(q.params[4] as string)); return [{ affectedRows: 1 }];
        }
        if (q.sql.startsWith("INSERT INTO notifications")) { s.notifications.push(q.params); return [{ affectedRows: 1 }]; }
        throw Error(`Unexpected query: ${q.sql}`);
      },
    };
  }
  const port: FollowupPort = { transaction(work) {
    const run = serial.then(async () => {
      const working = structuredClone(state);
      const result = await work(adapter(working));
      state = working;
      return result;
    });
    serial = run.then(() => {}, () => {});
    return run;
  } };
  return { port, read: () => adapter(state), state: () => state, queries, fail: () => { failEvent = true; }, database: (name: string) => { databaseName = name; } };
}
it("commits partial and full remaining returns with immutable source values and one physical deduction each", async () => {
  const f = fixture(); const source = structuredClone(f.state().source);
  const one = await createTrialReturn(actor, input, f.port);
  const first = f.state().cases[0];
  expect(first).toMatchObject({ originalPurchaseValue: "300.0000", currency: "SAR", valuationBasis: "tax_inclusive", returnedQuantity: 3, returnedUnit: "قطعة", purchaseOrderId: 11, purchaseOrderItemId: 12 });
  expect(f.state().movements).toEqual([{ quantity: 3, unitCost: 70, value: 210 }]);
  expect(f.state().events[0].invoice).toMatchObject({ lotId: 31, receiptItemId: 21, vendorName: "المورد", lineTotal: "1000.00" });
  const secondRequest = { ...input, operationKey: "valuation-create-0002", returnedQuantity: 7 };
  const two = await Promise.all([createTrialReturn(actor, secondRequest, f.port), createTrialReturn(actor, secondRequest, f.port)]);
  expect(two[0]).toEqual(two[1]); expect(two[0]).not.toEqual(one);
  expect(f.state().cases.map((c: any) => c.originalPurchaseValue)).toEqual(["300.0000", "700.0000"]);
  expect(f.state()).toMatchObject({ quantity: 0, lotQuantity: 0, balanceQuantity: 0 });
  expect(f.state().source).toEqual(source);
  for (const collection of ["cases", "movements", "events", "notifications"]) expect(f.state()[collection]).toHaveLength(2);
  expect(f.queries.some(q => /INSERT INTO supplier_return_settlements|UPDATE purchase_order/.test(q))).toBe(false);
});
it("recalculates from fresh source at save, never trusting an earlier preview", async () => {
  const f = fixture();
  await expect(supplierReturnValuePreview(actor, input, f.read())).rejects.toThrow(); // strict API refuses extra write-only fields
  const preview = await supplierReturnValuePreview(actor, { trackingToken: input.trackingToken, warehouseId: 4, returnedQuantity: 3 }, f.read());
  expect(preview.originalPurchaseValue).toBe("300.0000");
  f.state().source.invoiceUnitCost = "120.0000"; f.state().source.invoiceLineTotal = "1200.00";
  await createTrialReturn(actor, input, f.port);
  expect(f.state().cases[0].originalPurchaseValue).toBe("360.0000");
});
it("rejects client-supplied price, supplier or source IDs", () => {
  for (const extra of [{ originalPurchaseValue: "1" }, { supplierName: "غيره" }, { receiptItemId: 999 }, { returnedQuantity: 0.5 }]) {
    expect(() => newReturnRequest.parse({ ...input, ...extra })).toThrow();
  }
});
it.each(["event", "source"])("rolls back the physical deduction when %s persistence fails", async kind => {
  const f = fixture();
  if (kind === "event") f.fail(); else f.state().source.lineReceiptId = 999;
  await expect(createTrialReturn(actor, input, f.port)).rejects.toThrow();
  expect(f.state()).toMatchObject({ quantity: 10, lotQuantity: 10, balanceQuantity: 10, cases: [], returns: [], events: [], movements: [], notifications: [] });
});
it("unknown invoice totals still allow physical return, but do not fabricate a supplier credit", async () => {
  const f = fixture(); f.state().source.invoiceLineTotal = null;
  await createTrialReturn(actor, input, f.port);
  expect(f.state().cases[0]).toMatchObject({ originalPurchaseValue: null, currency: null, valuationBasis: null });
  expect(f.state().quantity).toBe(7);
  expect(f.state().events[0].valuation.unavailableReason).toBeTruthy();
});
it("fresh stock check, replay identity and production gate all prevent additional physical writes", async () => {
  const f = fixture(); await createTrialReturn(actor, input, f.port);
  await expect(createTrialReturn(actor, { ...input, operationKey: "valuation-create-0002", returnedQuantity: 8 }, f.port)).rejects.toThrow("insufficient stock");
  await expect(createTrialReturn(actor, { ...input, returnedQuantity: 4 }, f.port)).rejects.toThrow("مفتاح إنشاء");
  f.state().active = false;
  await expect(createTrialReturn(actor, input, f.port)).rejects.toMatchObject({ code: "FORBIDDEN" });
  f.state().active = true; f.database("cmms");
  await expect(createTrialReturn(actor, input, f.port)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(f.state().quantity).toBe(7); expect(f.state().movements).toHaveLength(1);
});
