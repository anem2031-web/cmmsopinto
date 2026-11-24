import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, inArray, sql } from "drizzle-orm";
import { catalogItems, catalogUnits, inventory, warehouses } from "../../../drizzle/schema";
import { APP_ROLE, canRoleReadPurchaseCatalogStock } from "../../../shared/roles";
import { isBusinessGuardedRole } from "../../../shared/business-role-policy";
import { summarizeCatalogStock } from "../../../shared/catalog-stock";
import { protectedProcedure } from "../_shared/procedures";

/** A bounded batch read for the purchase form; no prices, suppliers, lots or stock writes. */
export function createCatalogStockProcedure(getDatabase: () => Promise<any>) {
  return protectedProcedure.use(({ ctx, next }) => {
    const role = ctx.user.role;
    const construction = role === APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER;
    if (role === APP_ROLE.GENERAL_MAINTENANCE_MANAGER
      || construction && Number(ctx.user.isActive) !== 1
      || !isBusinessGuardedRole(role) && !canRoleReadPurchaseCatalogStock(role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لعرض أرصدة المخزون" });
    }
    return next({ ctx });
  }).input(z.object({
    catalogItemIds: z.array(z.number().int().positive()).min(1).max(500),
  })).query(async ({ input }) => {
    const database = await getDatabase();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر تحميل أرصدة المخزون" });
    const [rows, units] = await Promise.all([
      database.select({
        catalogItemId: catalogItems.id,
        catalogUnit: catalogItems.unit,
        inventoryId: inventory.id,
        warehouseId: inventory.warehouseId,
        nameAr: warehouses.nameAr,
        nameEn: warehouses.nameEn,
        quantity: inventory.quantity,
        unit: sql<string>`COALESCE(NULLIF(TRIM(${inventory.issueUnit}), ''), ${inventory.unit})`,
      }).from(catalogItems)
        .leftJoin(inventory, eq(inventory.linkedItemId, catalogItems.id))
        .leftJoin(warehouses, eq(warehouses.id, inventory.warehouseId))
        .where(inArray(catalogItems.id, Array.from(new Set(input.catalogItemIds)))),
      database.select({ nameAr: catalogUnits.nameAr, nameEn: catalogUnits.nameEn }).from(catalogUnits),
    ]);
    return summarizeCatalogStock(rows, units);
  });
}
