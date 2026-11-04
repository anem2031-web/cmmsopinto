import { describe, expect, it } from "vitest";
import { pendingPurchaseCoverageQuantity } from "../pmv2/materials/specification-purchase-coverage";

describe("construction inspection coverage without duplicate PMV2 procurement", () => {
  it.each(["received", "closed"])("keeps a fully received %s purchase reserved while specification approval is pending", status => {
    const coverage = pendingPurchaseCoverageQuantity(6, status, "delivered_to_warehouse", 6, 6);
    expect(coverage).toBe(6);
    expect(Math.max(0, 6 - 0 - coverage)).toBe(0);
  });
  it("combines unreceived and inspection-held portions without exceeding the original linked amount", () => {
    expect(pendingPurchaseCoverageQuantity(10, "partial_purchase", "partially_delivered", 4, 4)).toBe(10);
    expect(pendingPurchaseCoverageQuantity(6, "purchased", "purchased", 2, 9)).toBe(6);
  });
  it("keeps rejected inspection quantities reserved for the native return and replacement workflow", () => {
    expect(pendingPurchaseCoverageQuantity(6, "received", "delivered_to_warehouse", 6, 6)).toBe(6);
  });
  it("fully returned rejected lots no longer reserve inspection stock after native resolution", () => {
    expect(pendingPurchaseCoverageQuantity(6, "received", "delivered_to_warehouse", 6, 0)).toBe(0);
  });
  it("ordinary and approved receipts retain existing coverage behavior", () => {
    expect(pendingPurchaseCoverageQuantity(6, "received", "delivered_to_warehouse", 6)).toBe(0);
    expect(pendingPurchaseCoverageQuantity(6, "purchased", "purchased", 2)).toBe(4);
    expect(pendingPurchaseCoverageQuantity(6, "rejected", "rejected", 0)).toBe(0);
    expect(pendingPurchaseCoverageQuantity(6, "purchased", "cancelled", 0)).toBe(0);
  });
});
