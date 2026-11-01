import { sql } from "drizzle-orm";

/** Catalog-page enrichment only for roles already granted warehouse history reads. */
export function canShowCatalogBook(
  user: { role: string; isActive?: unknown } | null | undefined
) {
  return (
    !!user &&
    Number(user.isActive) === 1 &&
    [
      "owner",
      "admin",
      "warehouse",
      "maintenance_manager",
      "senior_management",
      "observer",
    ].includes(user.role)
  );
}
export function inventoryBookTotalsQuery(ids: number[], warehouseId?: number) {
  const group = sql.join(
    ids.map(id => sql`${id}`),
    sql`,`
  );
  const scope =
    warehouseId == null ? sql`1=1` : sql`i.warehouseId=${warehouseId}`;
  return sql`SELECT catalogItemId,unit,isFrozen,SUM(quantity) AS quantity,SUM(incoming) AS incoming,SUM(outgoing) AS outgoing FROM (
    SELECT i.linkedItemId AS catalogItemId,COALESCE(NULLIF(TRIM(i.issueUnit),''),i.unit) AS unit,i.isFrozen,SUM(i.quantity) AS quantity,0 AS incoming,0 AS outgoing
      FROM inventory i WHERE i.linkedItemId IN (${group}) AND ${scope}
      GROUP BY i.linkedItemId,COALESCE(NULLIF(TRIM(i.issueUnit),''),i.unit),i.isFrozen
    UNION ALL
    SELECT i.linkedItemId AS catalogItemId,COALESCE(NULLIF(TRIM(l.issueUnit),''),NULLIF(TRIM(i.issueUnit),''),i.unit) AS unit,i.isFrozen,0 AS quantity,
      SUM(CASE WHEN t.type='in' THEN t.quantity ELSE 0 END) AS incoming,SUM(CASE WHEN t.type='out' THEN t.quantity ELSE 0 END) AS outgoing
      FROM inventory_transactions t JOIN inventory i ON i.id=t.inventoryId LEFT JOIN inventory_lots l ON l.id=t.lotId
      WHERE i.linkedItemId IN (${group}) AND ${scope}
      GROUP BY i.linkedItemId,COALESCE(NULLIF(TRIM(l.issueUnit),''),NULLIF(TRIM(i.issueUnit),''),i.unit),i.isFrozen
    ) book_totals GROUP BY catalogItemId,unit,isFrozen`;
}
export async function loadCatalogBookTotals(database: any, rawIds: number[]) {
  const ids = Array.from(new Set(rawIds));
  const totals: any[] = [];
  for (let offset = 0; offset < ids.length; offset += 500) {
    const [rows] = await database.execute(
      inventoryBookTotalsQuery(ids.slice(offset, offset + 500))
    );
    if (!Array.isArray(rows)) throw Error("Invalid book summary response");
    totals.push(...rows);
  }
  return totals;
}
