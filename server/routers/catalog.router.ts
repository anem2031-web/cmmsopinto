import { catalogImportExportRouter } from "./catalogImportExport.router";
import { attachments } from "../../drizzle/schema";
import { router, publicProcedure, protectedProcedure } from "./_shared/procedures";
import { z } from "zod";
import { eq, and, or, like, isNull, ne, count, desc, asc, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";

import {
  catalogNodes,
  catalogItems,
  catalogItemSpecs,
  catalogItemNodes,
  catalogItemImages,
  catalogSettings,
  catalogAuditLogs,
  catalogUnits,
  catalogSuppliers,
  catalogSupplierPrices,
  type InsertCatalogNode,
  type InsertCatalogItem,
  type InsertCatalogItemSpec,
  type InsertCatalogAuditLog,
} from "../../drizzle/schema";

// ============================================================
// TAXONOMY LAYER - Hierarchical Classification
// ============================================================

// الأدوار المقيّدة بتصفح قسم "المطبخ" وشجرته الفرعية فقط بالكتالوج
const FOOD_WAREHOUSE_ROLES = ["food_warehouse_manager", "food_warehouse_assistant"];

// ── يجمع رقم عقدة "المطبخ" (كود التصنيف 95) وكل أحفادها بشكل تكراري ──
// نتيجة الدالة تُخزَّن مؤقتاً بالذاكرة لثوانٍ معدودة فقط (الشجرة نادراً ما تتغيّر)
// تفادياً لاستعلامَين إضافيَّين بكل نداء لأدوار المستودع الغذائي.
let _foodWarehouseNodeIdsCache: { ids: number[]; expiresAt: number } | null = null;
async function getFoodWarehouseNodeIds(): Promise<number[]> {
  if (_foodWarehouseNodeIdsCache && _foodWarehouseNodeIdsCache.expiresAt > Date.now()) {
    return _foodWarehouseNodeIdsCache.ids;
  }
  const db = await getDb();
  if (!db) return [];
  const allNodes = await db.select().from(catalogNodes);
  const root = allNodes.find((n: any) => n.code === "95");
  if (!root) { _foodWarehouseNodeIdsCache = { ids: [], expiresAt: Date.now() + 30_000 }; return []; }

  const collect = (nodeId: number): number[] => {
    const children = allNodes.filter((n: any) => n.parentId === nodeId);
    return [nodeId, ...children.flatMap((c: any) => collect(c.id))];
  };
  const ids = collect(root.id);
  _foodWarehouseNodeIdsCache = { ids, expiresAt: Date.now() + 30_000 };
  return ids;
}

export const catalogRouter = router({

  // ────────────────────────────────────────────────────────
  // IMPORT / EXPORT
  // ────────────────────────────────────────────────────────
  importExport: catalogImportExportRouter,

  // ────────────────────────────────────────────────────────
  // TAXONOMY NODES - CRUD Operations
  // ────────────────────────────────────────────────────────

  /**
   * Get all taxonomy nodes (with optional filtering)   */
  nodes: router({
    list: publicProcedure
      .input(
        z.object({
          parentId: z.number().optional(),
          isActive: z.boolean().optional(),
          level: z.number().optional(),
        }).optional()
      )
      .query(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        const conditions = [];

        // افتراضي: أظهر النشطين فقط — ما لم يُطلب صراحةً غير ذلك
        const activeFilter = input?.isActive !== undefined ? input.isActive : true;
        conditions.push(eq(catalogNodes.isActive, activeFilter === true ? 1 : 0));

        if (input?.parentId !== undefined) {
          conditions.push(eq(catalogNodes.parentId, input.parentId));
        }
        if (input?.level !== undefined) {
          conditions.push(eq(catalogNodes.level, input.level));
        }

        const results = await db.select().from(catalogNodes).where(and(...conditions));

        // تقييد أدوار المستودع الغذائي على قسم "المطبخ" وشجرته الفرعية فقط
        const role = (ctx as any)?.user?.role;
        if (role && FOOD_WAREHOUSE_ROLES.includes(role)) {
          const allowedIds = new Set(await getFoodWarehouseNodeIds());
          return results.filter((n: any) => allowedIds.has(n.id));
        }

        return results;
      }),

    /**
     * Get a single node by ID
     */
    getById: publicProcedure
      .input(z.number())
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        const result = await db
          .select()
          .from(catalogNodes)
          .where(eq(catalogNodes.id, input))
          .limit(1);
        return result[0] || null;
      }),

    /**
     * Get all children of a node (one level deep)
     */
    getChildren: publicProcedure
      .input(z.number())
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        return await db
          .select()
          .from(catalogNodes)
          .where(and(eq(catalogNodes.parentId, input), eq(catalogNodes.isActive, 1)));
      }),

    /**
     * Create a new taxonomy node
     */
    create: protectedProcedure
      .input(
        z.object({
          nameAr: z.string(),
          nameEn: z.string(),
          nameUr: z.string().optional(),
          code: z.string().regex(/^\d+$/, "الكود يجب أن يحتوي على أرقام فقط").optional(),
          parentId: z.number().optional(),
          level: z.number(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        // ── توليد الكود التلقائي ──────────────────────────────────────────
        let code = input.code?.trim();

        // توليد الكود التلقائي — يعمل فقط بعد db:push
        if (!code) {
          try {
            if (!input.parentId) {
              const roots = await db.select().from(catalogNodes)
                .where(isNull(catalogNodes.parentId));
              const maxCode = roots
                .map((n: any) => parseInt(n.code || "0", 10))
                .filter((n: number) => !isNaN(n) && n < 10)
                .sort((a: number, b: number) => b - a)[0] || 0;
              code = String(maxCode + 1);
            } else {
              const parent = await db.select().from(catalogNodes)
                .where(eq(catalogNodes.id, input.parentId))
                .limit(1);
              const parentCode = (parent[0] as any)?.code || "";

              const siblings = await db.select().from(catalogNodes)
                .where(eq(catalogNodes.parentId, input.parentId));
              const maxSiblingCode = siblings
                .map((n: any) => parseInt(n.code || "0", 10))
                .filter((n: number) => !isNaN(n))
                .sort((a: number, b: number) => b - a)[0];

              code = maxSiblingCode ? String(maxSiblingCode + 1) : parentCode + "1";
            }
          } catch {
            // عمود code غير موجود بعد — سيُضاف بعد db:push
            code = null as any;
          }
        }

        // ── التحقق من عدم التكرار ─────────────────────────────────────
        if (code) {
          const existing = await db.select().from(catalogNodes)
            .where(eq(catalogNodes.code, String(code)))
            .limit(1);
          if (existing.length > 0) {
            throw new Error(`الكود ${code} مستخدم مسبقاً`);
          }
        }

        // ── التحقق من الحد الأقصى للمستويات ─────────────────────────────
        if (input.level > 6) {
          throw new Error("الحد الأقصى للمستويات هو 6");
        }

        const result = await db.insert(catalogNodes).values({
          code: code ? String(code) : null,
          nameAr: input.nameAr,
          nameEn: input.nameEn,
          nameUr: input.nameUr || null,
          parentId: input.parentId ?? null,
          level: Number(input.level),
          isActive: 1,
        } as any);

        const insertId = (result as any)[0]?.insertId || 0;

        // Log the action
        if (ctx.user?.id) {
          await db.insert(catalogAuditLogs).values({
            userId: ctx.user.id,
            action: "create",
            entityType: "node",
            entityId: insertId,
            newValues: JSON.stringify(input),
          } as any);
        }

        return insertId;
      }),

    /**
     * Update a taxonomy node
     */
    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          nameAr: z.string().optional(),
          nameEn: z.string().optional(),
          nameUr: z.string().optional(),
          code: z.string().regex(/^\d+$/, "الكود يجب أن يحتوي على أرقام فقط").optional(),
          isActive: z.boolean().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        const { id, code, ...updateData } = input;

        // التحقق من عدم تكرار الكود — معطّل مؤقتاً حتى db:push
        if (code) {
          (updateData as any).code = code;
        }

        await db.update(catalogNodes).set(updateData as any).where(eq(catalogNodes.id, id));

        // Log the action
        if (ctx.user?.id) {
          await db.insert(catalogAuditLogs).values({
            userId: ctx.user.id,
            action: "update",
            entityType: "node",
            entityId: id,
            newValues: JSON.stringify(updateData),
          } as any);
        }
      }),

    /**
     * Delete a taxonomy node (soft delete)
     */
    delete: protectedProcedure
      .input(z.number())
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        // ── منع الحذف إذا فيه فروع مرتبطة ───────────────────────────────
        const children = await db.select().from(catalogNodes)
          .where(and(eq(catalogNodes.parentId, input), eq(catalogNodes.isActive, 1)));
        if (children.length > 0) {
          throw new Error(`لا يمكن الحذف — يوجد ${children.length} تصنيف فرعي مرتبط`);
        }

        // ── منع الحذف إذا فيه أصناف مرتبطة ──────────────────────────────
        const items = await db.select().from(catalogItems)
          .where(and(eq(catalogItems.nodeId, input), eq(catalogItems.isActive, 1)));
        if (items.length > 0) {
          throw new Error(`لا يمكن الحذف — يوجد ${items.length} صنف مرتبط`);
        }

        // حذف منطقي
        await db.update(catalogNodes).set({ isActive: 0 }).where(eq(catalogNodes.id, input));

        // Log the action
        if (ctx.user?.id) {
          await db.insert(catalogAuditLogs).values({
            userId: ctx.user.id,
            action: "delete",
            entityType: "node",
            entityId: input,
          } as any);
        }
      }),
  }),

  // ────────────────────────────────────────────────────────
  // CATALOG ITEMS - CRUD Operations
  // ────────────────────────────────────────────────────────

items: router({

  count: publicProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      const items = await db
        .select()
        .from(catalogItems)
        .where(eq(catalogItems.isActive, 1));

      return {
        total: items.length,
      };
    }),

    /**
     * List all catalog items with search and filtering
     */
    list: publicProcedure
      .input(
        z.object({
          search: z.string().optional(),
          nodeId: z.number().optional(),
          nodeIds: z.array(z.number()).optional(),
          isActive: z.boolean().optional(),
          limit: z.number().default(50),
          offset: z.number().default(0),
        }).optional()
      )
      .query(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

const conditions = [];

// افتراضي: أظهر النشطين فقط
const activeFilter = input?.isActive !== undefined ? input.isActive : true;
conditions.push(eq(catalogItems.isActive, activeFilter === true ? 1 : 0));

// تقييد أدوار المستودع الغذائي على قسم "المطبخ" وشجرته الفرعية فقط — يُطبَّق
// من السيرفر بغض النظر عمّا يرسله العميل، لمنع أي تحايل على القيد من الواجهة
const role = (ctx as any)?.user?.role;
let effectiveNodeIds = input?.nodeIds;
if (role && FOOD_WAREHOUSE_ROLES.includes(role)) {
  const allowedIds = await getFoodWarehouseNodeIds();
  effectiveNodeIds = effectiveNodeIds && effectiveNodeIds.length > 0
    ? effectiveNodeIds.filter(id => allowedIds.includes(id))
    : allowedIds;
}

// إصلاح فلترة التصنيف — يدعم nodeId واحد أو مصفوفة nodeIds (للتصنيفات الأب وأحفادها)
if (effectiveNodeIds && effectiveNodeIds.length > 0) {
  conditions.push(inArray(catalogItems.nodeId, effectiveNodeIds));
} else if (input?.nodeId !== undefined && !(role && FOOD_WAREHOUSE_ROLES.includes(role))) {
  conditions.push(eq(catalogItems.nodeId, input.nodeId));
}

if (input?.search) {
  const term = `%${input.search}%`;
  conditions.push(
    or(
      like(catalogItems.nameAr, term),
      like(catalogItems.nameEn, term),
      like(catalogItems.code, term),
      like(catalogItems.manufacturer, term),
      like(catalogItems.unit, term),
    )
  );
}

        let query = db.select().from(catalogItems);
        if (conditions.length > 0) {
          query = query.where(and(...conditions)) as any;
        }

const results = await (query as any)
  .orderBy(desc(catalogItems.id))
  .limit(input?.limit || 50)
  .offset(input?.offset || 0);

// جلب الصور الرئيسية للأصناف (استعلام واحد لكل الأصناف بدل استعلام لكل صنف)
const itemIds = results.map((item: any) => item.id);

const allImages = itemIds.length > 0
  ? await db
      .select()
      .from(attachments)
      .where(
        and(
          eq(attachments.entityType, "catalog_item"),
          inArray(attachments.entityId, itemIds)
        )
      )
  : [];

const imagesByItemId = new Map<number, typeof allImages[number]>();
for (const img of allImages) {
  // نحتفظ بآخر صورة لكل صنف (نفس سلوك latestImage السابق)
  imagesByItemId.set(img.entityId, img);
}

const itemsWithImages = results.map((item: any) => ({
  ...item,
  primaryImageUrl: imagesByItemId.get(item.id)?.fileUrl || null,
}));

return itemsWithImages;

      }),

    /**
     * Get a single item with all its details
     */
    getById: publicProcedure
      .input(z.number())
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        const item = await db
          .select()
          .from(catalogItems)
          .where(eq(catalogItems.id, input))
          .limit(1);

        if (!item[0]) return null;

        // Get specs
        const specs = await db
          .select()
          .from(catalogItemSpecs)
          .where(eq(catalogItemSpecs.itemId, input));

        // Get images
        const images = await db
          .select()
          .from(catalogItemImages)
          .where(eq(catalogItemImages.itemId, input));

        return {
          ...item[0],
          specs,
          images,
        };
      }),

    /**
     * Create a new catalog item
     */
// بعد التعديل
create: protectedProcedure
  .input(
    z.object({
      nameAr: z.string(),
      nameEn: z.string(),
      nameUr: z.string().optional(),
      descriptionAr: z.string().optional(),
      descriptionEn: z.string().optional(),
      descriptionUr: z.string().optional(),
      code: z.string().optional(),
      nodeId: z.number(),
      unit: z.string().optional(),         // تمت الإضافة
      manufacturer: z.string().optional(), // تمت الإضافة
    })
  )
  .mutation(async ({ input, ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");

    // بناء كائن البيانات ديناميكياً
    const insertData: any = {
      nameAr: input.nameAr,
      nameEn: input.nameEn,
      nodeId: input.nodeId,
      isActive: 1,
    };

    if (input.nameUr) insertData.nameUr = input.nameUr;
    if (input.descriptionAr) insertData.descriptionAr = input.descriptionAr;
    if (input.descriptionEn) insertData.descriptionEn = input.descriptionEn;
    if (input.descriptionUr) insertData.descriptionUr = input.descriptionUr;
    if (input.code) insertData.code = input.code;
    if (input.unit) insertData.unit = input.unit;
    if (input.manufacturer) insertData.manufacturer = input.manufacturer;

    const result = await db.insert(catalogItems).values(insertData);
    const insertId = (result as any)[0]?.insertId || 0;

    // ... (كود الـ log)
    return insertId;
  }),

    /**
     * Update a catalog item
     */
    update: protectedProcedure
.input(
  z.object({
    id: z.number(),
    nameAr: z.string().optional(),
    nameEn: z.string().optional(),
    nameUr: z.string().optional(),
    descriptionAr: z.string().optional(),
    descriptionEn: z.string().optional(),
    descriptionUr: z.string().optional(),
    code: z.string().optional(),

    unit: z.string().optional(),
    manufacturer: z.string().optional(),

    isActive: z.boolean().optional(),
  })
)

      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        const { id, ...updateData } = input;

        await db.update(catalogItems).set(updateData).where(eq(catalogItems.id, id));

        // Log the action
        if (ctx.user?.id) {
          await db.insert(catalogAuditLogs).values({
            userId: ctx.user.id,
            action: "update",
            entityType: "item",
            entityId: id,
            newValues: JSON.stringify(updateData),
          } as any);
        }
      }),

    /**
     * Delete a catalog item (soft delete)
     */
    delete: protectedProcedure
      .input(z.number())
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        await db.update(catalogItems).set({ isActive: 0 }).where(eq(catalogItems.id, input));

        // Log the action
        if (ctx.user?.id) {
          await db.insert(catalogAuditLogs).values({
            userId: ctx.user.id,
            action: "delete",
            entityType: "item",
            entityId: input,
          } as any);
        }
      }),
  }),

  // ────────────────────────────────────────────────────────
  // CATALOG SETTINGS
  // ────────────────────────────────────────────────────────

  settings: router({
    list: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      return await db.select().from(catalogSettings);
    }),

    get: publicProcedure
      .input(z.string())
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        const result = await db
          .select()
          .from(catalogSettings)
          .where(eq(catalogSettings.settingKey, input))
          .limit(1);

        return result[0] || null;
      }),
  }),

  // ────────────────────────────────────────────────────────
  // CATALOG UNITS - وحدات القياس
  // ────────────────────────────────────────────────────────
  units: router({

    list: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      return db.select().from(catalogUnits).where(eq(catalogUnits.isActive, true));
    }),

    create: protectedProcedure
      .input(z.object({
        nameAr: z.string().min(1),
        nameEn: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const result = await db.insert(catalogUnits).values({
          nameAr: input.nameAr,
          nameEn: input.nameEn,
          isActive: 1,
        } as any);
        return (result as any)[0]?.insertId || 0;
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        nameAr: z.string().min(1).optional(),
        nameEn: z.string().min(1).optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const { id, ...data } = input;
        await db.update(catalogUnits).set(data).where(eq(catalogUnits.id, id));
      }),

    delete: protectedProcedure
      .input(z.number())
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        await db.update(catalogUnits).set({ isActive: 0 } as any).where(eq(catalogUnits.id, input));
      }),
  }),
// ────────────────────────────────────────────────────────
  // CATALOG SUPPLIERS — إدارة الموردين
  // ────────────────────────────────────────────────────────
  suppliers: router({

    // قائمة جميع الموردين
    list: publicProcedure
      .input(z.object({
        activeOnly:     z.boolean().optional().default(true),
        isManufacturer: z.boolean().optional(),
      }).optional())
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        const conditions = [];
        if (input?.activeOnly !== false) {
          conditions.push(eq(catalogSuppliers.isActive, true));
        }
        if (input?.isManufacturer !== undefined) {
          conditions.push(eq(catalogSuppliers.isManufacturer, input.isManufacturer));
        }

        let query = db.select().from(catalogSuppliers);
        if (conditions.length > 0) {
          query = query.where(and(...conditions)) as any;
        }
        return await (query as any).orderBy(asc(catalogSuppliers.nameAr));
      }),

    // تفاصيل مورد واحد
    getById: publicProcedure
      .input(z.number())
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        const result = await db
          .select()
          .from(catalogSuppliers)
          .where(eq(catalogSuppliers.id, input))
          .limit(1);

        return result[0] || null;
      }),

    // إنشاء مورد جديد
    create: protectedProcedure
      .input(z.object({
        nameAr:         z.string().min(1, "الاسم بالعربية مطلوب"),
        nameEn:         z.string().min(1, "الاسم بالإنجليزية مطلوب"),
        contactName:    z.string().optional(),
        phone:          z.string().optional(),
        email:          z.string().email("البريد الإلكتروني غير صحيح").optional().or(z.literal("")),
        address:        z.string().optional(),
        country:        z.string().optional(),
        notes:          z.string().optional(),
        isManufacturer: z.boolean().optional().default(false),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        const existing = await db
          .select({ id: catalogSuppliers.id })
          .from(catalogSuppliers)
          .where(eq(catalogSuppliers.nameAr, input.nameAr))
          .limit(1);

        if (existing.length > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "يوجد مورد بنفس الاسم العربي مسبقاً",
          });
        }

        const result = await db.insert(catalogSuppliers).values({
          nameAr:         input.nameAr.trim(),
          nameEn:         input.nameEn.trim(),
          contactName:    input.contactName?.trim() || null,
          phone:          input.phone?.trim()       || null,
          email:          input.email?.trim()       || null,
          address:        input.address?.trim()     || null,
          country:        input.country?.trim()     || null,
          notes:          input.notes?.trim()       || null,
          isManufacturer: input.isManufacturer ?? false,
          isActive:       1,
        } as any);

        const newId = (result as any)[0]?.insertId;

        try {
          await db.insert(catalogAuditLogs).values({
            userId:     ctx.user.id,
            action:     "create",
            entityType: "supplier",
            entityId:   newId,
            newValues:  JSON.stringify(input),
          } as any);
        } catch { /* audit log اختياري */ }

        return newId;
      }),

    // تعديل مورد
    update: protectedProcedure
      .input(z.object({
        id:             z.number(),
        nameAr:         z.string().min(1).optional(),
        nameEn:         z.string().min(1).optional(),
        contactName:    z.string().optional(),
        phone:          z.string().optional(),
        email:          z.string().email().optional().or(z.literal("")),
        address:        z.string().optional(),
        country:        z.string().optional(),
        notes:          z.string().optional(),
        isManufacturer: z.boolean().optional(),
        isActive:       z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        const { id, ...data } = input;

        if (data.nameAr) {
          const duplicate = await db
            .select({ id: catalogSuppliers.id })
            .from(catalogSuppliers)
            .where(and(
              eq(catalogSuppliers.nameAr, data.nameAr),
              ne(catalogSuppliers.id, id),
            ))
            .limit(1);

          if (duplicate.length > 0) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "يوجد مورد آخر بنفس الاسم العربي",
            });
          }
        }

        const updateData: Record<string, any> = {};
        if (data.nameAr         !== undefined) updateData.nameAr         = data.nameAr.trim();
        if (data.nameEn         !== undefined) updateData.nameEn         = data.nameEn.trim();
        if (data.contactName    !== undefined) updateData.contactName    = data.contactName?.trim() || null;
        if (data.phone          !== undefined) updateData.phone          = data.phone?.trim()       || null;
        if (data.email          !== undefined) updateData.email          = data.email?.trim()       || null;
        if (data.address        !== undefined) updateData.address        = data.address?.trim()     || null;
        if (data.country        !== undefined) updateData.country        = data.country?.trim()     || null;
        if (data.notes          !== undefined) updateData.notes          = data.notes?.trim()       || null;
        if (data.isManufacturer !== undefined) updateData.isManufacturer = data.isManufacturer;
        if (data.isActive       !== undefined) updateData.isActive       = data.isActive;

        await db
          .update(catalogSuppliers)
          .set(updateData)
          .where(eq(catalogSuppliers.id, id));

        try {
          await db.insert(catalogAuditLogs).values({
            userId:     ctx.user.id,
            action:     "update",
            entityType: "supplier",
            entityId:   id,
            newValues:  JSON.stringify(updateData),
          } as any);
        } catch { /* اختياري */ }

        return { success: true };
      }),

    // حذف منطقي
    delete: protectedProcedure
      .input(z.number())
      .mutation(async ({ input: id, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        const linkedItems = await db
          .select({ id: catalogSupplierPrices.id })
          .from(catalogSupplierPrices)
          .where(and(
            eq(catalogSupplierPrices.supplierId, id),
            eq(catalogSupplierPrices.isActive, true),
          ))
          .limit(1);

        if (linkedItems.length > 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "لا يمكن حذف المورد لأنه مرتبط بأصناف في الكاتلوج",
          });
        }

        await db
          .update(catalogSuppliers)
          .set({ isActive: 0 } as any)
          .where(eq(catalogSuppliers.id, id));

        try {
          await db.insert(catalogAuditLogs).values({
            userId:     ctx.user.id,
            action:     "delete",
            entityType: "supplier",
            entityId:   id,
          } as any);
        } catch { /* اختياري */ }

        return { success: true };
      }),

    // إحصائيات للـ Dashboard
    stats: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return { total: 0, active: 0, manufacturers: 0 };

      const [all] = await db
        .select({ total: count() })
        .from(catalogSuppliers);

      const [active] = await db
        .select({ active: count() })
        .from(catalogSuppliers)
        .where(eq(catalogSuppliers.isActive, true));

      const [mfr] = await db
        .select({ manufacturers: count() })
        .from(catalogSuppliers)
        .where(and(
          eq(catalogSuppliers.isActive, true),
          eq(catalogSuppliers.isManufacturer, true),
        ));

      return {
        total:         Number(all?.total         ?? 0),
        active:        Number(active?.active      ?? 0),
        manufacturers: Number(mfr?.manufacturers  ?? 0),
      };
    }),
  }),

  // ────────────────────────────────────────────────────────
  // ITEM-SUPPLIER LINKS — ربط الموردين بالأصناف
  // ────────────────────────────────────────────────────────
  itemSuppliers: router({

    listByItem: publicProcedure
      .input(z.number())
      .query(async ({ input: itemId }) => {
        const db = await getDb();
        if (!db) return [];

        return await db
          .select({
            id:               catalogSupplierPrices.id,
            itemId:           catalogSupplierPrices.itemId,
            supplierId:       catalogSupplierPrices.supplierId,
            supplierItemCode: catalogSupplierPrices.supplierItemCode,
            price:            catalogSupplierPrices.price,
            currency:         catalogSupplierPrices.currency,
            isPreferred:      catalogSupplierPrices.isPreferred,
            notes:            catalogSupplierPrices.notes,
            isActive:         catalogSupplierPrices.isActive,
            updatedAt:        catalogSupplierPrices.updatedAt,
            supplierNameAr:   catalogSuppliers.nameAr,
            supplierNameEn:   catalogSuppliers.nameEn,
            supplierPhone:    catalogSuppliers.phone,
            supplierEmail:    catalogSuppliers.email,
            supplierCountry:  catalogSuppliers.country,
          })
          .from(catalogSupplierPrices)
          .innerJoin(
            catalogSuppliers,
            eq(catalogSupplierPrices.supplierId, catalogSuppliers.id),
          )
          .where(and(
            eq(catalogSupplierPrices.itemId,   itemId),
            eq(catalogSupplierPrices.isActive, true),
            eq(catalogSuppliers.isActive,      true),
          ))
          .orderBy(desc(catalogSupplierPrices.isPreferred));
      }),

    assign: protectedProcedure
      .input(z.object({
        itemId:           z.number(),
        supplierId:       z.number(),
        supplierItemCode: z.string().optional(),
        price:            z.number().min(0),
        currency:         z.string().default("SAR"),
        isPreferred:      z.boolean().optional().default(false),
        notes:            z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        if (input.isPreferred) {
          await db
            .update(catalogSupplierPrices)
            .set({ isPreferred: false } as any)
            .where(eq(catalogSupplierPrices.itemId, input.itemId));
        }

        const existing = await db
          .select({ id: catalogSupplierPrices.id })
          .from(catalogSupplierPrices)
          .where(and(
            eq(catalogSupplierPrices.itemId,     input.itemId),
            eq(catalogSupplierPrices.supplierId, input.supplierId),
          ))
          .limit(1);

        if (existing.length > 0) {
          await db
            .update(catalogSupplierPrices)
            .set({
              supplierItemCode: input.supplierItemCode?.trim() || null,
              price:            String(input.price),
              currency:         input.currency,
              isPreferred:      input.isPreferred ?? false,
              notes:            input.notes?.trim() || null,
              isActive:         1,
            } as any)
            .where(eq(catalogSupplierPrices.id, existing[0].id));

          return { id: existing[0].id, action: "updated" };
        }

        const result = await db.insert(catalogSupplierPrices).values({
          itemId:           input.itemId,
          supplierId:       input.supplierId,
          supplierItemCode: input.supplierItemCode?.trim() || null,
          price:            String(input.price),
          currency:         input.currency,
          isPreferred:      input.isPreferred ?? false,
          notes:            input.notes?.trim() || null,
          isActive:         1,
        } as any);

        return { id: (result as any)[0]?.insertId, action: "created" };
      }),

    remove: protectedProcedure
      .input(z.object({
        itemId:     z.number(),
        supplierId: z.number(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        await db
          .update(catalogSupplierPrices)
          .set({ isActive: 0 } as any)
          .where(and(
            eq(catalogSupplierPrices.itemId,     input.itemId),
            eq(catalogSupplierPrices.supplierId, input.supplierId),
          ));

        return { success: true };
      }),

    setPreferred: protectedProcedure
      .input(z.object({
        itemId:     z.number(),
        supplierId: z.number(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        await db
          .update(catalogSupplierPrices)
          .set({ isPreferred: false } as any)
          .where(eq(catalogSupplierPrices.itemId, input.itemId));

        await db
          .update(catalogSupplierPrices)
          .set({ isPreferred: true } as any)
          .where(and(
            eq(catalogSupplierPrices.itemId,     input.itemId),
            eq(catalogSupplierPrices.supplierId, input.supplierId),
          ));

        return { success: true };
      }),
  }),
});
