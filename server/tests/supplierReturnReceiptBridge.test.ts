import { describe, expect, it } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { linkReplacementReceipt } from "../supplier-return-followup/receipt-bridge";

function fixture() {
  const writes: string[] = [];
  const plan = { id: 7, caseId: 3, status: "purchased", purchaseOrderId: 50, purchaseOrderItemId: 70,
    replacementQuantity: "2.000", replacementUnit: "قطعة", originalQuantityCovered: "2.000", returnedUnit: "قطعة",
    creditAllocationSettlementId: 15, fundingSettlementId: 16, additionalFunding: "20.0000", handoverStatus: "accepted", caseRevision: 4, caseClosedAt: null };
  const tx: any = { async execute(query: any) {
    const { sql: text } = new MySqlDialect().sqlToQuery(query);
    if (text.startsWith("SELECT DATABASE()")) return [[{ databaseName: "copycmms2" }]];
    if (text.includes("FROM supplier_return_replacement_plans p")) return [[plan]];
    if (text.includes("FROM supplier_return_replacement_links")) return [[{ received: "0.000", compensated: "0.000" }]];
    if (text.includes("FROM inventory_lots l")) return [[{ id: 62 }]];
    if (/^(INSERT|UPDATE)/.test(text)) { writes.push(text); return text.startsWith("INSERT") ? [{ insertId: 30 }] : [{ affectedRows: 1 }]; }
    throw Error(text);
  } };
  return { tx, plan, writes };
}
const receipt = { purchaseOrderId: 50, purchaseOrderItemId: 70, receiptId: 60, receiptItemId: 61,
  lotId: 62, quantityInOrderUnits: "2.000", orderUnit: "قطعة" };

describe("replacement receipt link uses existing stock receipt", () => {
  it("saves exactly one provenance link and completes approved funding", async () => {
    const f = fixture();
    expect(await linkReplacementReceipt(f.tx, 8, receipt)).toBe(true);
    expect(f.writes.filter(text => text.startsWith("INSERT INTO supplier_return_replacement_links"))).toHaveLength(1);
    expect(f.writes.filter(text => text.includes("UPDATE supplier_return_settlements"))).toHaveLength(2);
    expect(f.writes.some(text => text.includes("UPDATE supplier_return_replacement_plans SET status='received'"))).toBe(true);
    expect(f.writes.some(text => text.includes("UPDATE supplier_return_cases SET closedAt=CURRENT_TIMESTAMP"))).toBe(true);
    expect(f.writes.filter(text => text.startsWith("INSERT INTO supplier_return_events"))).toHaveLength(1);
    expect(f.writes.some(text => /inventory_transactions|inventory_lots|UPDATE inventory/.test(text))).toBe(false);
  });
  it("rejects a partial receipt because the current PO item receipt can only be confirmed once", async () => {
    const f = fixture();
    await expect(linkReplacementReceipt(f.tx, 8, { ...receipt, quantityInOrderUnits: "1.000" })).rejects.toThrow("كاملة");
    expect(f.writes).toHaveLength(0);
  });
  it("rejects a mismatched order, unit or stale plan before writing", async () => {
    const f = fixture();
    await expect(linkReplacementReceipt(f.tx, 8, { ...receipt, purchaseOrderId: 51 })).rejects.toThrow();
    await expect(linkReplacementReceipt(f.tx, 8, { ...receipt, orderUnit: "كرتون" })).rejects.toThrow();
    f.plan.status = "received";
    await expect(linkReplacementReceipt(f.tx, 8, receipt)).rejects.toThrow();
    expect(f.writes).toHaveLength(0);
  });
});
