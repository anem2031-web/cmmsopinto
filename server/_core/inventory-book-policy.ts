import { and, eq, or, sql } from "drizzle-orm";
import { inventory } from "../../drizzle/schema";

/** Reuse one compatible operational page; never merge historical pages. */
export function activeBookStockUnit(unit: string) {
  const stored = sql`COALESCE(NULLIF(TRIM(${inventory.issueUnit}), ''), TRIM(${inventory.unit}))`;
  return and(
    eq(inventory.isFrozen, 0),
    or(
      sql`${stored}=${unit.trim()}`,
      sql`EXISTS (SELECT 1 FROM catalog_units u WHERE u.isActive=1
      AND (u.nameAr=${unit.trim()} OR u.nameEn=${unit.trim()}) AND (u.nameAr=${stored} OR u.nameEn=${stored}))`
    )
  );
}
