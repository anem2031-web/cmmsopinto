import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

type Item = { id?: number; catalogItemId?: number | null; unit?: string | null };
type StoredItem = { id: number; catalogItemId?: number | null; unit?: string | null };
type Port = { execute(query: SQL): Promise<any> };

/** New catalog relationships and explicit unit edits use the catalog base unit.
 * An unchanged historical draft snapshot remains unchanged. Call inside the
 * authorized write transaction; receipt packaging/conversion is independent. */
export async function assertPurchaseCatalogBaseUnits(tx: Port, items: Item[], existing: StoredItem[] = []) {
  const previous = new Map(existing.map(item => [Number(item.id), item]));
  // updateDraft retains a stored identity when the optional field is omitted;
  // explicit null still means the caller deliberately removes that link.
  const effectiveItems = items.map(item => ({ ...item, catalogItemId: item.catalogItemId === undefined
    ? (item.id == null ? undefined : previous.get(item.id)?.catalogItemId)
    : item.catalogItemId }));
  const checked = effectiveItems.filter(item => {
    if (item.catalogItemId == null) return false;
    const before = item.id == null ? undefined : previous.get(item.id);
    return !before || Number(before.catalogItemId) !== item.catalogItemId || (before.unit || "").trim() !== (item.unit || "").trim();
  });
  const ids = Array.from(new Set(checked.map(item => Number(item.catalogItemId)))).sort((a, b) => a - b);
  if (!ids.length) return;
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new TRPCError({ code: "BAD_REQUEST", message: "مرجع صنف الكتالوج غير صالح" });
  const catalog = new Map<number, { unit: string; aliases: Set<string> }>();
  for (let offset = 0; offset < ids.length; offset += 500) {
    const result = await tx.execute(sql`SELECT c.id,c.unit,u.nameAr,u.nameEn,u.isActive AS unitActive
      FROM catalog_items c LEFT JOIN catalog_units u ON u.nameAr=c.unit OR u.nameEn=c.unit
      WHERE c.id IN (${sql.join(ids.slice(offset, offset + 500).map(id => sql`${id}`), sql`,`)}) ORDER BY c.id FOR UPDATE`);
    if (!Array.isArray(result?.[0])) throw Error("Invalid catalog base unit response");
    for (const row of result[0]) {
      const id = Number(row.id), unit = String(row.unit ?? "").trim();
      if (catalog.has(id) || !unit || Number(row.unitActive) !== 1) throw new TRPCError({ code: "BAD_REQUEST", message: "وحدة صنف الكتالوج غير محددة أو غير نشطة؛ راجع تعريف الصنف" });
      catalog.set(id, { unit, aliases: new Set([unit, row.nameAr, row.nameEn].filter(Boolean).map(value => String(value).trim().toLocaleLowerCase())) });
    }
  }
  for (const item of checked) {
    const master = catalog.get(Number(item.catalogItemId));
    if (!master) throw new TRPCError({ code: "BAD_REQUEST", message: "صنف الكتالوج غير موجود" });
    if (!master.aliases.has(String(item.unit ?? "").trim().toLocaleLowerCase())) throw new TRPCError({ code: "BAD_REQUEST", message: `وحدة الطلب لهذا الصنف هي «${master.unit}» حسب الكتالوج؛ راجع الكمية بهذه الوحدة` });
  }
}
