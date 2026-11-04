import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertNoSpecificationAggregateBypass,
  assertSpecificationLotMovement,
  filterSpecificationLots,
  assertSpecificationPurchaseItemCompletion,
} from "../services/purchase-specification-guards";
import { purchaseSpecificationsDatabase } from "./fixtures/purchaseSpecificationsDatabase";

let f: ReturnType<typeof purchaseSpecificationsDatabase>;
beforeEach(() => {
  f = purchaseSpecificationsDatabase();
  for (const [id, specificationStatus] of [[1, null], [2, "pending"], [3, "approved"], [4, "rejected"], [5, "unrecognized"]] as const) {
    f.insert("inventory_lots", { id, specificationStatus, originalQuantity: 5, remainingQuantity: 5 });
    f.insert("inventory_lot_balances", { id, lotId: id, inventoryId: id === 1 || id === 2 ? 10 : id + 10, quantity: 5 });
  }
});
afterEach(() => f.close());

describe("Physical Lot specification movement guard", () => {
  it.each(["issue", "transfer", "supplier_return", "disposal"] as const)("preserves old NULL and approved lots for %s", async kind => {
    await expect(assertSpecificationLotMovement(f.db, { lotId: 1, kind })).resolves.toBeUndefined();
    await expect(assertSpecificationLotMovement(f.db, { lotId: 3, kind })).resolves.toBeUndefined();
  });
  it.each(["issue", "transfer", "supplier_return", "disposal"] as const)("blocks pending lot before %s without modifying any stock", async kind => {
    const before = f.memory.prepare("SELECT * FROM inventory_lot_balances ORDER BY id").all();
    await expect(assertSpecificationLotMovement(f.db, { lotId: 2, kind })).rejects.toThrow();
    expect(f.memory.prepare("SELECT * FROM inventory_lot_balances ORDER BY id").all()).toEqual(before);
  });
  it.each(["issue", "transfer", "disposal"] as const)("blocks rejected lot for %s", async kind => {
    await expect(assertSpecificationLotMovement(f.db, { lotId: 4, kind })).rejects.toThrow();
  });
  it("permits a rejected lot only for the existing supplier-return operation", async () => {
    await expect(assertSpecificationLotMovement(f.db, { lotId: 4, kind: "supplier_return" })).resolves.toBeUndefined();
    expect(f.memory.prepare("SELECT remainingQuantity FROM inventory_lots WHERE id=4").get()).toMatchObject({ remainingQuantity: 5 });
  });
  it.each([5, 999])("fails closed for unknown or missing lot %s", async lotId => {
    await expect(assertSpecificationLotMovement(f.db, { lotId, kind: "issue" })).rejects.toThrow();
  });
  it("rechecks the current row on independent consecutive operations", async () => {
    await expect(assertSpecificationLotMovement(f.db, { lotId: 2, kind: "issue" })).rejects.toThrow();
    f.memory.exec("UPDATE inventory_lots SET specificationStatus='approved' WHERE id=2");
    await expect(assertSpecificationLotMovement(f.db, { lotId: 2, kind: "issue" })).resolves.toBeUndefined();
    f.memory.exec("UPDATE inventory_lots SET specificationStatus='pending' WHERE id=2");
    await expect(assertSpecificationLotMovement(f.db, { lotId: 2, kind: "issue" })).rejects.toThrow();
    expect(f.queries.filter(query => /SELECT id,\s*specificationStatus/.test(query.sql))).toHaveLength(3);
  });
  it("propagates infrastructure failures", async () => {
    await expect(assertSpecificationLotMovement({ execute: async () => { throw Error("database read failed"); } }, { lotId: 1, kind: "issue" })).rejects.toThrow("database read failed");
  });
});

describe("Available Lot filtering", () => {
  it("keeps original order, row shape and repeated objects while excluding pending, rejected and missing lots", async () => {
    const rows = [{ lotId: 3, code: "approved" }, { lotId: 2, code: "pending" }, { lotId: 1, code: "old" }, { lotId: 3, code: "again" }, { lotId: 4, code: "reject" }, { lotId: 999, code: "missing" }];
    expect(await filterSpecificationLots(f.db, rows)).toEqual([rows[0], rows[2], rows[3]]);
  });
  it("uses supplied ID extraction and permits rejected supplier-return candidates", async () => {
    const rows = [{ row: 4 }, { row: 2 }, { row: 1 }, { row: 3 }];
    expect(await filterSpecificationLots(f.db, rows, value => value.row, "supplier_return")).toEqual([rows[0], rows[2], rows[3]]);
  });
  it("uses bounded distinct chunks rather than one query per displayed row", async () => {
    const rows = Array.from({ length: 1101 }, (_, n) => ({ id: n + 100 }));
    for (const row of rows) f.insert("inventory_lots", { id: row.id, specificationStatus: null });
    f.queries.length = 0;
    expect(await filterSpecificationLots(f.db, [...rows, ...rows])).toHaveLength(2202);
    expect(f.queries.map(query => query.params.length)).toEqual([500, 500, 101]);
  });
  it("returns an empty list without a query and rejects malformed IDs", async () => {
    expect(await filterSpecificationLots(f.db, [])).toEqual([]);
    expect(f.queries).toHaveLength(0);
    for (const id of [0, -1, NaN, 1.5]) await expect(filterSpecificationLots(f.db, [{ id }])).rejects.toThrow();
  });
  it("does not reuse a previous result after a specification decision changes", async () => {
    expect(await filterSpecificationLots(f.db, [{ id: 2 }])).toEqual([]);
    f.memory.exec("UPDATE inventory_lots SET specificationStatus='approved' WHERE id=2");
    expect(await filterSpecificationLots(f.db, [{ id: 2 }])).toEqual([{ id: 2 }]);
  });
  it("fails closed on a filtering read failure", async () => {
    await expect(filterSpecificationLots({ execute: async () => { throw Error("unavailable"); } }, [{ id: 1 }])).rejects.toThrow("unavailable");
  });
});

describe("Aggregate-only writes cannot bypass held physical lots", () => {
  it("blocks the aggregate containing a held lot but leaves an unrelated lot's physical operations available", async () => {
    await expect(assertNoSpecificationAggregateBypass(f.db, 10)).rejects.toThrow();
    await expect(assertSpecificationLotMovement(f.db, { lotId: 1, kind: "issue" })).resolves.toBeUndefined();
    await expect(assertNoSpecificationAggregateBypass(f.db, 13)).resolves.toBeUndefined();
  });
  it("does not block an exhausted held lot", async () => {
    f.memory.exec("UPDATE inventory_lot_balances SET quantity=0 WHERE lotId=2");
    await expect(assertNoSpecificationAggregateBypass(f.db, 10)).resolves.toBeUndefined();
  });
  it("blocks rejected quantities and stops blocking after approval", async () => {
    await expect(assertNoSpecificationAggregateBypass(f.db, 14)).rejects.toThrow();
    f.memory.exec("UPDATE inventory_lots SET specificationStatus='approved' WHERE id=4");
    await expect(assertNoSpecificationAggregateBypass(f.db, 14)).resolves.toBeUndefined();
  });
});

describe("Linked purchase item completion has its own fresh boundary", () => {
  beforeEach(() => f.memory.exec("UPDATE inventory_lots SET purchaseOrderItemId=100 WHERE id IN (1,2); UPDATE inventory_lots SET purchaseOrderItemId=200 WHERE id IN (3,4)"));
  it("denies completion while a pending receipt remains, without denying the old physical lot", async () => {
    await expect(assertSpecificationPurchaseItemCompletion(f.db, 100)).rejects.toThrow();
    await expect(assertSpecificationLotMovement(f.db, { lotId: 1, kind: "issue" })).resolves.toBeUndefined();
    await expect(assertSpecificationPurchaseItemCompletion(f.db, 999)).resolves.toBeUndefined();
  });
  it("rechecks approval and rejection on each completion attempt, then stops holding exhausted rejected stock", async () => {
    f.memory.exec("UPDATE inventory_lots SET specificationStatus='approved' WHERE id=2");
    await expect(assertSpecificationPurchaseItemCompletion(f.db, 100)).resolves.toBeUndefined();
    f.memory.exec("UPDATE inventory_lots SET specificationStatus='rejected' WHERE id=2");
    await expect(assertSpecificationPurchaseItemCompletion(f.db, 100)).rejects.toThrow();
    f.memory.exec("UPDATE inventory_lot_balances SET quantity=0 WHERE lotId=2");
    await expect(assertSpecificationPurchaseItemCompletion(f.db, 100)).resolves.toBeUndefined();
    await expect(assertSpecificationPurchaseItemCompletion(f.db, 200)).rejects.toThrow();
  });
  it("propagates a completion infrastructure failure rather than allowing the linked item", async () => {
    await expect(assertSpecificationPurchaseItemCompletion({ execute: async () => { throw Error("completion unavailable"); } }, 100)).rejects.toThrow("completion unavailable");
  });
});
