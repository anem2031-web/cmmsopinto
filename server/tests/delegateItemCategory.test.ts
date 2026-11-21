import { describe, expect, it } from "vitest";
import { matchesDelegateItemCategory } from "../../shared/delegateItemCategory";
import { comparePurchaseRequiredDates } from "../../shared/purchaseItemNeedDate";

describe("delegate item category filter", () => {
  it("filters across orders by the item's category and retains the existing need-date order", () => {
    const items = [
      { id: 1, categoryId: 3, purchaseOrderCategoryId: 8, requiredDate: "2026-11-25" },
      { id: 2, categoryId: 8, purchaseOrderCategoryId: 3, requiredDate: "2026-11-22" },
      { id: 3, categoryId: 3, purchaseOrderCategoryId: 3, requiredDate: "2026-11-23" },
      { id: 4, categoryId: null, purchaseOrderCategoryId: 3, requiredDate: "2026-11-24" },
      { id: 5, categoryId: null, purchaseOrderCategoryId: null, requiredDate: "2026-11-21" },
    ];
    expect(items.filter(item => matchesDelegateItemCategory(item, "3")).sort(comparePurchaseRequiredDates).map(item => item.id)).toEqual([3, 4, 1]);
    expect(items.filter(item => matchesDelegateItemCategory(item, "all"))).toHaveLength(5);
    expect(items.filter(item => matchesDelegateItemCategory(item, "8")).map(item => item.id)).toEqual([2]);
  });
});
