type CategorizedDelegateItem = { categoryId?: number | null; purchaseOrderCategoryId?: number | null };

/** Older purchase items may inherit their classification from the order. */
export function delegateItemCategoryId(item: CategorizedDelegateItem): number | null {
  return item.categoryId ?? item.purchaseOrderCategoryId ?? null;
}

export function matchesDelegateItemCategory(
  item: CategorizedDelegateItem,
  filter: string,
): boolean {
  if (filter === "all") return true;
  const categoryId = delegateItemCategoryId(item);
  return categoryId != null && String(categoryId) === filter;
}

export function availableDelegateItemCategories<T extends { id: number }>(
  items: CategorizedDelegateItem[], categories: T[],
): T[] {
  const ids = new Set(items.map(delegateItemCategoryId).filter(id => id != null).map(String));
  return categories.filter(category => ids.has(String(category.id)));
}
