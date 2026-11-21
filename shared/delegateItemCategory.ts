/** Older purchase items may inherit their classification from the order. */
export function matchesDelegateItemCategory(
  item: { categoryId?: number | null; purchaseOrderCategoryId?: number | null },
  filter: string,
): boolean {
  if (filter === "all") return true;
  const categoryId = item.categoryId ?? item.purchaseOrderCategoryId;
  return categoryId != null && String(categoryId) === filter;
}
