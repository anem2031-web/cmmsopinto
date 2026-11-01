import { inventoryBookTotalsQuery } from "../../services/inventory-book-summary";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { sql, type SQL } from "drizzle-orm";
import { inventoryReadProcedure } from "../_shared/procedures";
import { isInventoryLotsEnabled } from "../../_core/inventory-lots";

type Port = { execute(query: SQL): Promise<any> };
async function rows(db: Port, query: SQL): Promise<any[]> {
  const result = await db.execute(query);
  if (!Array.isArray(result?.[0]))
    throw Error("Invalid inventory book response");
  return result[0];
}
export function bookSearchCondition(search: string) {
  const term = `%${search}%`;
  return sql`(c.nameAr LIKE ${term} OR c.nameEn LIKE ${term} OR c.code LIKE ${term}
    OR EXISTS (SELECT 1 FROM inventory aliases WHERE aliases.linkedItemId=c.id AND (aliases.itemName LIKE ${term} OR aliases.internalCode LIKE ${term} OR aliases.manufacturerBarcode LIKE ${term}))
    OR EXISTS (SELECT 1 FROM inventory_lots aliases WHERE aliases.catalogItemId=c.id AND (aliases.supplierItemName LIKE ${term} OR aliases.lotCode LIKE ${term} OR aliases.trackingToken LIKE ${term}))
    OR EXISTS (SELECT 1 FROM catalog_item_candidates aliases WHERE aliases.resolvedCatalogItemId=c.id AND aliases.itemName LIKE ${term}))`;
}
const warehouseScope = (warehouseId?: number) =>
  warehouseId == null ? sql`1=1` : sql`i.warehouseId=${warehouseId}`;
export async function readInventoryBooks(
  db: Port,
  input: {
    search?: string;
    warehouseId?: number;
    afterId?: number;
    limit?: number;
    includeZero?: boolean;
    nodeIds?: number[];
    sort?: string;
    dateFrom?: string;
    dateTo?: string;
  }
) {
  const limit = Math.min(50, Math.max(1, input.limit || 36));
  // Page the distinct master identities before enriching their stock summaries.
  const nodeScope =
    input.nodeIds == null
      ? sql`1=1`
      : input.nodeIds.length
        ? sql`c.nodeId IN (${sql.join(
            input.nodeIds.map(id => sql`${id}`),
            sql`,`
          )})`
        : sql`1=0`;
  const latestDate = sql`(SELECT r.invoiceDate FROM inventory_transactions t LEFT JOIN warehouse_receipts r ON r.id=t.receiptId
    WHERE t.inventoryId=i.id AND t.type='in' AND t.transactionType='purchase' ORDER BY t.createdAt DESC LIMIT 1)`;
  const dates = sql`EXISTS (SELECT 1 FROM inventory i WHERE i.linkedItemId=c.id AND ${warehouseScope(input.warehouseId)}
    ${input.dateFrom ? sql`AND ${latestDate}>=${input.dateFrom}` : sql``} ${input.dateTo ? sql`AND ${latestDate}<=${input.dateTo}` : sql``})`;
  const order =
    input.sort === "name"
      ? sql`c.nameAr,c.id`
      : input.sort === "quantity"
        ? sql`(SELECT SUM(i.quantity) FROM inventory i WHERE i.linkedItemId=c.id AND ${warehouseScope(input.warehouseId)} AND i.isFrozen=0) DESC,c.id`
        : sql`(SELECT MAX(i.updatedAt) FROM inventory i WHERE i.linkedItemId=c.id AND ${warehouseScope(input.warehouseId)}) DESC,c.id`;
  const books = await rows(
    db,
    sql`SELECT c.id,c.code,c.nameAr,c.nameEn,c.unit,
    (SELECT COUNT(*) FROM inventory i WHERE i.linkedItemId=c.id AND ${warehouseScope(input.warehouseId)}) AS pageCount
    FROM catalog_items c WHERE ${nodeScope} AND ${bookSearchCondition(input.search || "")} AND ${dates}
    AND EXISTS (SELECT 1 FROM inventory i WHERE i.linkedItemId=c.id AND ${warehouseScope(input.warehouseId)}
      ${input.includeZero ? sql`` : sql`AND i.isFrozen=0 AND i.quantity>0`}) ORDER BY ${order} LIMIT ${limit + 1} OFFSET ${input.afterId || 0}`
  );
  const hasMore = books.length > limit;
  const page = books.slice(0, limit);
  if (!page.length) return { books: [], nextId: null };
  const totals = await rows(
    db,
    inventoryBookTotalsQuery(
      page.map(book => Number(book.id)),
      input.warehouseId
    )
  );
  return {
    books: page.map(book => ({
      ...book,
      id: Number(book.id),
      totals: totals.filter(
        row => Number(row.catalogItemId) === Number(book.id)
      ),
    })),
    nextId: hasMore ? (input.afterId || 0) + limit : null,
  };
}
export async function readInventoryBookPages(
  db: Port,
  input: {
    catalogItemId: number;
    warehouseId?: number;
    afterId?: number;
    limit?: number;
  }
) {
  const master = await rows(
    db,
    sql`SELECT id,code,nameAr,nameEn,unit FROM catalog_items WHERE id=${input.catalogItemId} LIMIT 1`
  );
  if (!master.length)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "صنف الكتالوج غير موجود",
    });
  const limit = Math.min(50, Math.max(1, input.limit || 25));
  const records = await rows(
    db,
    sql`SELECT i.id,i.itemName,COALESCE(NULLIF(TRIM(i.issueUnit),''),i.unit) AS unit,i.unit AS storedUnit,i.quantity,i.isFrozen,i.warehouseId,i.createdAt
    FROM inventory i WHERE i.linkedItemId=${input.catalogItemId} AND ${warehouseScope(input.warehouseId)}
    AND i.id>${input.afterId || 0} ORDER BY i.id LIMIT ${limit + 1}`
  );
  const page = records.slice(0, limit);
  if (!page.length) return { master: master[0], pages: [], nextId: null };
  const ids = sql.join(
    page.map(record => sql`${Number(record.id)}`),
    sql`,`
  );
  const lots = await rows(
    db,
    sql`SELECT b.inventoryId,b.quantity AS balanceQuantity,l.id AS lotId,l.lotCode,l.trackingToken,
    l.catalogItemId,l.sourceType,l.supplierItemName,l.purchaseUnit,l.issueUnit,l.originalQuantity,l.remainingQuantity,
    l.issueUnitCost,l.createdAt,l.receiptId,l.receiptItemId,
    r.invoiceDate,r.receiptNumber,r.invoiceNumber,COALESCE(s.nameAr,r.vendorName,s.nameEn) AS supplierName
    FROM inventory_lot_balances b JOIN inventory_lots l ON l.id=b.lotId
    LEFT JOIN warehouse_receipts r ON r.id=l.receiptId LEFT JOIN catalog_suppliers s ON s.id=l.catalogSupplierId
    WHERE b.inventoryId IN (${ids}) ORDER BY l.createdAt,l.id,b.inventoryId LIMIT 1001`
  );
  // Never offer a truncated set as a complete FIFO pool.
  if (lots.length > 1000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "اختر عددًا أقل من سجلات الدفتر لاستعراض اللوتات",
    });
  const movementTotals = await rows(
    db,
    sql`SELECT t.inventoryId,COALESCE(NULLIF(TRIM(l.issueUnit),''),NULLIF(TRIM(i.issueUnit),''),i.unit) AS unit,
    SUM(CASE WHEN t.type='in' THEN t.quantity ELSE 0 END) AS incoming,SUM(CASE WHEN t.type='out' THEN t.quantity ELSE 0 END) AS outgoing
    FROM inventory_transactions t JOIN inventory i ON i.id=t.inventoryId LEFT JOIN inventory_lots l ON l.id=t.lotId
    WHERE t.inventoryId IN (${ids}) GROUP BY t.inventoryId,COALESCE(NULLIF(TRIM(l.issueUnit),''),NULLIF(TRIM(i.issueUnit),''),i.unit)`
  );
  return {
    master: master[0],
    pages: page.map(record => ({
      ...record,
      id: Number(record.id),
      lots: lots.filter(lot => Number(lot.inventoryId) === Number(record.id)),
      movementUnits: movementTotals.filter(
        total => Number(total.inventoryId) === Number(record.id)
      ),
      movements: movementTotals.find(
        total => Number(total.inventoryId) === Number(record.id)
      ) || { incoming: 0, outgoing: 0 },
    })),
    nextId: records.length > limit ? Number(page[page.length - 1].id) : null,
  };
}
export function createInventoryBookProcedures(
  getDatabase: () => Promise<Port | null>,
  lotsEnabled: () => boolean = isInventoryLotsEnabled
) {
  const database = async (user: any) => {
    if (Number(user?.isActive) !== 1)
      throw new TRPCError({ code: "FORBIDDEN", message: "الحساب غير نشط" });
    if (!lotsEnabled())
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "دفاتر اللوتات غير مفعّلة",
      });
    const db = await getDatabase();
    if (!db) throw Error("تعذر تحميل دفتر الصنف");
    return db;
  };
  return {
    books: inventoryReadProcedure
      .input(
        z.object({
          search: z.string().max(300).optional(),
          warehouseId: z.number().int().positive().optional(),
          afterId: z.number().int().nonnegative().optional(),
          limit: z.number().int().min(1).max(50).optional(),
          includeZero: z.boolean().optional(),
          nodeIds: z.array(z.number().int().positive()).max(500).optional(),
          sort: z.enum(["name", "recent", "quantity"]).optional(),
          dateFrom: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          dateTo: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
        })
      )
      .query(async ({ input, ctx }) =>
        readInventoryBooks(
          await database(ctx.authenticatedUser ?? ctx.user),
          input
        )
      ),
    bookPages: inventoryReadProcedure
      .input(
        z.object({
          catalogItemId: z.number().int().positive(),
          warehouseId: z.number().int().positive().optional(),
          afterId: z.number().int().nonnegative().optional(),
          limit: z.number().int().min(1).max(50).optional(),
        })
      )
      .query(async ({ input, ctx }) =>
        readInventoryBookPages(
          await database(ctx.authenticatedUser ?? ctx.user),
          input
        )
      ),
  };
}
