import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
const state = vi.hoisted(() => ({ rows: [] as any[], enabled: true, calls: [] as any[], error: null as Error | null }));
vi.mock("../supplier-return-followup/runtime", () => ({
  trialEnabled: async () => state.enabled,
  readRows: async (_tx: any, query: any) => { state.calls.push(query); if (state.error) throw state.error; return state.rows; },
}));
import { exactOriginalAllocation, limitReplacementSourceCoverage, loadReplacementFulfillments, representableReplacementAllocation, replacementOriginalToPhysical, replacementPhysicalToOriginal, type ReplacementFulfillment } from "../supplier-return-followup/fulfillment";
const row = () => ({ planId: 5, caseId: 6, sourceItemId: 7, sourcePurchaseOrderId: 8, sourceCatalogItemId: 9,
  sourceUnit: "حبة", originalQuantityCovered: "4", replacementItemId: 10, replacementPurchaseOrderId: 11,
  catalogItemId: 12, itemName: "بديل", replacementUnit: "علبة", replacementQuantity: "2",
  receiptLinkId: 13, receivedQuantity: "2", receivedUnit: "علبة", compensatedOriginalQuantity: "4", originalUnit: "حبة",
  lotId: 14, trackingToken: "LOT-TEST", issueUnit: "قطعة", lotQuantity: "6" });
beforeEach(() => { state.rows = [row()]; state.enabled = true; state.calls = []; state.error = null; });
describe("approved supplier replacement fulfillment provenance", () => {
  it("converts from actual lot issue units rather than purchase units, without changing source identity", async () => {
    const map = await loadReplacementFulfillments({} as any, [7, 7]);
    const p = map.get(7)![0];
    expect(p.sourceCatalogItemId).toBe(9); expect(p.catalogItemId).toBe(12);
    expect(replacementPhysicalToOriginal(p, "3")).toBe("2.000");
    expect(replacementOriginalToPhysical(p, "4")).toBe("6.000");
    expect(state.calls).toHaveLength(1);
  });
  it("rejects incomplete provenance allocation and duplicate lot reuse", async () => {
    state.rows[0].receivedQuantity = "1";
    await expect(loadReplacementFulfillments({} as any, [7])).rejects.toThrow("لا تغطي");
    state.rows = [row(), { ...row(), receiptLinkId: 15 }];
    await expect(loadReplacementFulfillments({} as any, [7])).rejects.toThrow("أكثر من مرة");
  });
  it("does not round partial fulfillment upward or accept mixed lot units", async () => {
    const p = (await loadReplacementFulfillments({} as any, [7])).get(7)![0];
    expect(() => replacementPhysicalToOriginal(p, "1")).toThrow("دقيق");
    const mixed = { ...p, lots: [...p.lots, { ...p.lots[0], lotId: 99, unit: "كرتون" }] } satisfies ReplacementFulfillment;
    expect(() => replacementPhysicalToOriginal(mixed, "1")).toThrow("غير متوافقة");
  });
  it("selects a smaller exact mixed-stock allocation rather than rejecting the greedy partial amount", async () => {
    const p = (await loadReplacementFulfillments({} as any, [7])).get(7)![0];
    expect(representableReplacementAllocation(p, { availablePhysical: "5", maxOriginal: "4", physicalStep: "1", originalStep: "1" }))
      .toEqual({ physicalQuantity: "3.000", originalQuantity: "2.000" });
    expect(representableReplacementAllocation(p, { availablePhysical: "5", maxOriginal: "1", physicalStep: "1", originalStep: "1" }))
      .toEqual({ physicalQuantity: "0.000", originalQuantity: "0.000" });
    expect(representableReplacementAllocation(p, { availablePhysical: "6", maxOriginal: "4", physicalStep: "1", originalStep: "1" }))
      .toEqual({ physicalQuantity: "6.000", originalQuantity: "4.000" });
    expect(representableReplacementAllocation(p, { availablePhysical: "9", maxOriginal: "6", physicalStep: "1", originalStep: "1" }))
      .toEqual({ physicalQuantity: "6.000", originalQuantity: "4.000" });
  });
  it("skips an incompatible greedy plan when a later plan fills the exact remainder", () => {
    expect(exactOriginalAllocation("4", [{ maximum: "3", quantum: "3" }, { maximum: "4", quantum: "2" }])).toEqual(["0.000", "4.000"]);
  });
  it("matches exhaustive small bounded allocations without rounding coverage", () => {
    for (let qa = 1; qa <= 4; qa++) for (let qb = 1; qb <= 4; qb++) for (let qc = 1; qc <= 3; qc++) {
      const candidates = [{ maximum: String(qa * 2), quantum: String(qa) }, { maximum: String(qb * 2), quantum: String(qb) }, { maximum: String(qc * 2), quantum: String(qc) }];
      const possible = new Set<number>();
      for (let a = 0; a <= 2; a++) for (let b = 0; b <= 2; b++) for (let c = 0; c <= 2; c++) possible.add(a * qa + b * qb + c * qc);
      for (let target = 0; target <= 12; target++) {
        const selected = exactOriginalAllocation(String(target), candidates);
        expect(selected !== null, JSON.stringify({ qa, qb, qc, target })).toBe(possible.has(target));
        if (selected) {
          expect(selected.reduce((sum, value) => sum + Number(value), 0)).toBe(target);
          selected.forEach((value, index) => { expect(Number(value) % Number(candidates[index].quantum)).toBe(0); expect(Number(value)).toBeLessThanOrEqual(Number(candidates[index].maximum)); });
        }
      }
    }
  });
  it("caps plans by their unique source link while preserving the approved physical ratio", async () => {
    const p = (await loadReplacementFulfillments({} as any, [7])).get(7)![0];
    const scoped = limitReplacementSourceCoverage([p, { ...p, planId: 105 }], "5");
    expect(scoped.map(plan => plan.maximumOriginalQuantity)).toEqual(["4.000", "1.000"]);
    expect(scoped.map(plan => plan.originalQuantityCovered)).toEqual(["4", "4"]);
    expect(p.originalQuantityCovered).toBe("4");
  });
  it("chunks repeated source IDs and does not cache between requests", async () => {
    state.rows = [];
    const ids = Array.from({ length: 1001 }, (_, i) => i + 1);
    await loadReplacementFulfillments({} as any, [...ids, ...ids, ...ids]);
    expect(state.calls).toHaveLength(3);
    await loadReplacementFulfillments({} as any, [7]); expect(state.calls).toHaveLength(4);
  });
  it("retains historical replacement identity after catalog deactivation", async () => {
    state.rows[0].catalogIsActive = 0;
    const plans = await loadReplacementFulfillments({} as any, [7]);
    expect(plans.get(7)![0].itemName).toBe("بديل");
    const query = new MySqlDialect().sqlToQuery(state.calls[0]).sql;
    expect(query).not.toMatch(/catalog_items|catalog_units/);
  });
  it("requires parent/receipt joins and propagates infrastructure failure instead of treating it as missing provenance", async () => {
    state.rows = [];
    expect((await loadReplacementFulfillments({} as any, [7])).size).toBe(0);
    const query = new MySqlDialect().sqlToQuery(state.calls[0]).sql;
    expect(query).toContain("INNER JOIN purchase_orders sourceOrder");
    expect(query).toContain("INNER JOIN warehouse_receipt_items receipt");
    state.error = new Error("test infrastructure unavailable");
    await expect(loadReplacementFulfillments({} as any, [7])).rejects.toThrow("test infrastructure unavailable");
  });
  it("avoids all replacement SQL when the production gate is disabled", async () => {
    state.enabled = false;
    expect((await loadReplacementFulfillments({} as any, [7])).size).toBe(0);
    expect(state.calls).toHaveLength(0);
  });
});
