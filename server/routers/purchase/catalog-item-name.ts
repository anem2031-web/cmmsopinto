import { TRPCError } from "@trpc/server";

/** Preserve the stored catalog-linked name, including historical snapshots. */
export function assertCatalogItemNameUnchanged(item: { catalogItemId?: number | null; itemName: string }, name?: string) {
  if (item.catalogItemId != null && name !== undefined && name !== item.itemName) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "اسم الصنف المرتبط بالكتالوج غير قابل للتعديل؛ اكتب التوضيح في المواصفات أو الملاحظات" });
  }
}
