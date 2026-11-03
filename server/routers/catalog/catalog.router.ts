import { isInventoryLotsEnabled } from "../../_core/inventory-lots";
import { catalogImportExportRouter } from "./catalogImportExport.router";
import { catalogItemImageSchema, assertCatalogImageUpload, saveRequiredCatalogImage } from "./item-image";
import { attachments } from "../../../drizzle/schema";
import { matchSuppliers, normalizeSupplierName } from "../../_core/catalog-supplier-matching";
import { applyAiSemanticDiscovery, extractNormalizedMeasurements, normalizeCatalogItemText, normalizeSupplierItemCode, rankCatalogItemMatches, type CatalogAiUsageEvent } from "../../_core/catalog-item-matching";
import { candidateReviewDisplayName, decidedPeerIds, findExactCatalogDuplicate, findExactPendingCandidateDuplicate, normalizeCandidatePair, sameItemGroupIds, sameItemPrimaryForCandidate } from "../../_core/catalog-item-candidate-review";
import { isCatalogItemCodeForNode, nextCatalogItemCode } from "../../_core/catalog-item-code";
import { boundedDistinctCatalogCodeAliasEntityIds } from "../../_core/catalog-code-alias";
import { isCatalogNodeCodeForParent, isHierarchicalCatalogNodeCode, nextCatalogChildCode, nextCatalogRootCode } from "../../_core/catalog-code-format";
import { publishResolvedCatalogIdentity } from "../../_core/catalog-item-identity-publication";
import { catalogAuditJson, catalogAuditRequestMeta, pickAuditValues } from "../../_core/catalog-audit";
import { canShowCatalogBook, loadCatalogBookTotals } from "../../services/inventory-book-summary";
import { findCatalogUnitByName, getActiveCatalogUnitCanonicalName } from "../../_core/catalog-unit-governance";
import { executeCatalogTaxonomyMove, previewCatalogTaxonomyMove } from "../../services/catalog/catalogTaxonomyMove.service";
import { router, catalogAdminProcedure, catalogProcedure, catalogItemManagerProcedure, catalogItemDeactivateProcedure, catalogItemLifecycleProcedure, catalogReadProcedure, catalogReferenceReadProcedure } from "../_shared/procedures";
import { z } from "zod";
import { getTableColumns, eq, and, or, like, ne, count, desc, asc, inArray, sql, gte, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { APP_ROLE } from "@shared/roles";
import { getDb } from "../../_core/db";

import {
  catalogNodes,
  catalogItems,
  catalogItemSpecs,
  catalogItemNodes,
  catalogSettings,
  catalogAuditLogs,
  catalogCodeAliases,
  catalogUnits,
  catalogSuppliers,
  catalogSupplierPrices,
  catalogSupplierAliases,
  catalogSupplierItemAliases,
  catalogSupplierCandidates,
  catalogItemCandidates,
  catalogItemCandidateDuplicateDecisions,
  purchaseOrders,
  warehouseReceipts,
  type InsertCatalogNode,
  type InsertCatalogItem,
  type InsertCatalogItemSpec,
  type InsertCatalogAuditLog,
} from "../../../drizzle/schema";

async function loadCandidateDuplicateDecisions(db: any, candidateId: number): Promise<any[]> {
  return await db.select().from(catalogItemCandidateDuplicateDecisions).where(or(
    eq(catalogItemCandidateDuplicateDecisions.candidateLowId, candidateId),
    eq(catalogItemCandidateDuplicateDecisions.candidateHighId, candidateId),
  ));
}

async function loadResolutionGroup(tx: any, candidateId: number): Promise<any[]> {
  const decisions = await loadCandidateDuplicateDecisions(tx, candidateId);
  const parentCandidateId = sameItemPrimaryForCandidate(candidateId, decisions as any[]);
  if (parentCandidateId) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Candidate #${candidateId} تابع لنفس الصنف مع Candidate #${parentCandidateId}. احسم المرشح الأساسي أولاً.`,
    });
  }

  const groupIds = sameItemGroupIds(candidateId, decisions as any[]);
  const rows = await tx.select().from(catalogItemCandidates).where(inArray(catalogItemCandidates.id, groupIds));
  if (rows.length !== groupIds.length || rows.some((row: any) => row.status !== "pending")) {
    throw new TRPCError({ code: "CONFLICT", message: "أحد المرشحين المضمومين تمت معالجته بالفعل؛ حدّث قائمة الأصناف الجديدة" });
  }
  return rows as any[];
}

async function assertActiveCatalogNodePath(db: any, nodeId: number): Promise<any> {
  let currentId: number | null = nodeId;
  let selectedNode: any = null;
  const visited = new Set<number>();

  for (let depth = 0; currentId != null && depth < 8; depth += 1) {
    if (visited.has(currentId)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "مسار تصنيف الكتالوج يحتوي على علاقة دائرية غير صالحة" });
    }
    visited.add(currentId);

    const rows = await db.select().from(catalogNodes)
      .where(eq(catalogNodes.id, currentId))
      .limit(1);
    const node = rows[0] as any;
    if (!node) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "التصنيف المختار أو أحد آبائه غير موجود" });
    }
    if (Number(node.isActive) !== 1) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `لا يمكن استخدام التصنيف غير النشط «${node.nameAr || node.id}» في علاقة جديدة` });
    }
    if (!selectedNode) selectedNode = node;
    currentId = node.parentId == null ? null : Number(node.parentId);
  }

  if (currentId != null) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "تعذر التحقق من مسار التصنيف بالكامل" });
  }
  return selectedNode;
}


async function assertActiveCatalogMasterUnit(db: any, unitName: string | null | undefined): Promise<string | null> {
  const trimmed = (unitName || "").trim();
  if (!trimmed) return null;
  const unit = await findCatalogUnitByName(trimmed, db);
  if (!unit) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `وحدة القياس «${trimmed}» غير موجودة في تبويب الوحدات`,
    });
  }
  if (Number(unit.isActive) !== 1) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `وحدة القياس «${unit.nameAr || trimmed}» معطّلة ولا يمكن استخدامها في علاقة جديدة`,
    });
  }
  return String(unit.nameAr || trimmed).trim();
}

async function assertCatalogCodeAvailable(
  db: any,
  entityType: "node" | "item",
  codeInput: string,
  excludeEntityId?: number,
): Promise<void> {
  const code = String(codeInput || "").trim();
  if (!code) return;

  const table = entityType === "node" ? catalogNodes : catalogItems;
  const conditions: any[] = [eq((table as any).code, code)];
  if (excludeEntityId) conditions.push(ne((table as any).id, excludeEntityId));
  const live = await db.select({ id: (table as any).id }).from(table as any).where(and(...conditions)).limit(1);
  if (live.length > 0) {
    throw new TRPCError({ code: "CONFLICT", message: `الكود ${code} مستخدم مسبقاً` });
  }

  const alias = await db.select({ entityId: catalogCodeAliases.entityId }).from(catalogCodeAliases)
    .where(and(eq(catalogCodeAliases.entityType, entityType), eq(catalogCodeAliases.oldCode, code)))
    .limit(1);
  if (alias.length > 0) {
    throw new TRPCError({ code: "CONFLICT", message: `الكود ${code} كود تاريخي محجوز ولا يمكن إعادة استخدامه` });
  }
}

async function nextAvailableCatalogNodeCode(db: any, parentId?: number | null): Promise<string> {
  const [nodes, aliases] = await Promise.all([
    db.select().from(catalogNodes),
    db.select({ oldCode: catalogCodeAliases.oldCode }).from(catalogCodeAliases)
      .where(eq(catalogCodeAliases.entityType, "node")),
  ]);
  const used = new Set<string>([
    ...nodes.map((n: any) => String(n.code || "").trim()).filter(Boolean),
    ...aliases.map((a: any) => String(a.oldCode || "").trim()).filter(Boolean),
  ]);

  if (!parentId) {
    return nextCatalogRootCode(
      (nodes as any[]).filter(node => node.parentId == null).map(node => node.code),
      used,
    );
  }

  const parent = (nodes as any[]).find((n: any) => Number(n.id) === Number(parentId));
  const parentCode = String(parent?.code || "").trim();
  if (!parent) throw new TRPCError({ code: "BAD_REQUEST", message: "التصنيف الأب غير موجود" });
  const candidate = nextCatalogChildCode(
    parentCode,
    (nodes as any[]).filter((n: any) => Number(n.parentId) === Number(parentId)).map(n => n.code),
    used,
  );
  if (candidate.length > 50) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "تعذر توليد كود فرعي ضمن الحد الأقصى لطول الكود" });
  }
  return candidate;
}

async function getLeafCategoryCodeState(db: any, nodeId: number, lockNode = false): Promise<{ node: any; code: string }> {
  if (lockNode) {
    // Serialize code allocation per category during approveNew so two reviewers
    // cannot intentionally receive the same next code from the same leaf.
    await db.execute(sql`SELECT id FROM catalog_nodes WHERE id = ${nodeId} FOR UPDATE`);
  }

  // 2B-10-2B: ليس كافياً أن تكون العقدة نفسها نشطة؛ يجب أن يكون كامل
  // مسارها حتى الجذر نشطاً أيضاً قبل إنشاء علاقة Master Data جديدة.
  const node = await assertActiveCatalogNodePath(db, nodeId);

  const activeChildren = await db.select({ id: catalogNodes.id }).from(catalogNodes).where(and(
    eq(catalogNodes.parentId, nodeId),
    eq(catalogNodes.isActive, true),
  )).limit(1);
  if (activeChildren.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `لا يمكن إضافة صنف مباشرة إلى «${node.nameAr}» لأنه تصنيف رئيسي وله تفرعات. اختر آخر مستوى في الشجرة.`,
    });
  }

  const nodeCode = String(node.code || "").trim();
  // Keep the selected leaf as the source of sequence width / highest number.
  // A code can nevertheless be in use on a reclassified item in another leaf,
  // or reserved as an old item code following a taxonomy move. Include both
  // sources for previews as well as the locked approval/create transactions.
  const [existingItems, otherMatchingCodes, historicalCodes] = await Promise.all([
    db.select({ id: catalogItems.id, code: catalogItems.code })
      .from(catalogItems).where(eq(catalogItems.nodeId, nodeId)),
    db.select({ code: catalogItems.code }).from(catalogItems)
      .where(like(catalogItems.code, `${nodeCode}-%`)),
    db.select({ code: catalogCodeAliases.oldCode }).from(catalogCodeAliases)
      .where(and(
        eq(catalogCodeAliases.entityType, "item"),
        like(catalogCodeAliases.oldCode, `${nodeCode}-%`),
      )),
  ]);

  let code: string;
  try {
    code = nextCatalogItemCode(nodeCode, existingItems as any[], [
      ...otherMatchingCodes.map((row: any) => row.code),
      ...historicalCodes.map((row: any) => row.code),
    ]);
  } catch (error: any) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error?.message || "تعذر توليد كود الصنف" });
  }
  return { node, code };
}

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

  // Stable identity first. Legacy code 95 remains only as a one-time fallback
  // for installations that have not yet stored the root node ID in settings.
  const settingRows = await db.select({ settingValue: catalogSettings.settingValue })
    .from(catalogSettings)
    .where(and(eq(catalogSettings.settingKey, "food_warehouse_root_node_id"), eq(catalogSettings.isActive, 1)))
    .limit(1);
  const configuredId = Number(settingRows[0]?.settingValue || 0);
  const root = (configuredId > 0 ? allNodes.find((n: any) => Number(n.id) === configuredId) : null)
    || allNodes.find((n: any) => n.code === "95");
  if (!root) { _foodWarehouseNodeIdsCache = { ids: [], expiresAt: Date.now() + 30_000 }; return []; }

  const collect = (nodeId: number): number[] => {
    const children = allNodes.filter((n: any) => Number(n.parentId) === Number(nodeId));
    return [nodeId, ...children.flatMap((c: any) => collect(c.id))];
  };
  const ids = collect(Number(root.id));
  _foodWarehouseNodeIdsCache = { ids, expiresAt: Date.now() + 30_000 };
  return ids;
}


async function rememberCandidateSupplierAlias(
  tx: any,
  params: {
    candidate: any;
    catalogItemId: number;
    createdById: number;
  },
): Promise<void> {
  const { candidate, catalogItemId, createdById } = params;
  const supplierId = Number(candidate.catalogSupplierId || 0);
  if (!supplierId) return;

  // 2B-10-2B: Candidate قد يكون تاريخياً ومربوطاً بمورد تم تعطيله لاحقاً.
  // نسمح بحسم الـCandidate نفسه، لكن لا ننشئ/ننشط Supplier-Item Alias جديداً
  // إلى Supplier Master مفقود أو غير نشط.
  const supplierRows = await tx.select({ id: catalogSuppliers.id, isActive: catalogSuppliers.isActive })
    .from(catalogSuppliers)
    .where(eq(catalogSuppliers.id, supplierId))
    .limit(1);
  const supplier = supplierRows[0] as any;
  if (!supplier || Number(supplier.isActive) !== 1) return;

  const supplierItemName = candidateReviewDisplayName(candidate);
  const normalizedName = normalizeCatalogItemText(supplierItemName);
  if (!normalizedName) return;

  const supplierItemCode = candidate.supplierItemCode?.trim() || null;
  const normalizedItemCode = supplierItemCode ? normalizeSupplierItemCode(supplierItemCode) : null;
  const measurements = extractNormalizedMeasurements(
    [supplierItemName, candidate.itemNameEn, candidate.purchaseUnit].filter(Boolean).join(" "),
  );

  const sameNameRows = await tx.select({
    id: catalogSupplierItemAliases.id,
    confirmationCount: catalogSupplierItemAliases.confirmationCount,
    normalizedItemCode: catalogSupplierItemAliases.normalizedItemCode,
  }).from(catalogSupplierItemAliases).where(and(
    eq(catalogSupplierItemAliases.supplierId, supplierId),
    eq(catalogSupplierItemAliases.catalogItemId, catalogItemId),
    eq(catalogSupplierItemAliases.normalizedName, normalizedName),
  ));

  const existing = (sameNameRows as any[]).find((row: any) =>
    (row.normalizedItemCode || null) === normalizedItemCode,
  );

  if (existing) {
    const nextConfirmationCount = Number(existing.confirmationCount || 1) + 1;
    await tx.update(catalogSupplierItemAliases).set({
      supplierItemName,
      supplierItemCode,
      normalizedItemCode,
      normalizedMeasurements: measurements as any,
      confirmationCount: nextConfirmationCount,
      lastConfirmedAt: new Date(),
      isActive: 1,
    } as any).where(eq(catalogSupplierItemAliases.id, existing.id));
    await tx.insert(catalogAuditLogs).values({
      userId: createdById,
      action: "confirm_supplier_item_alias",
      entityType: "supplier_item_alias",
      entityId: existing.id,
      oldValues: catalogAuditJson({ confirmationCount: Number(existing.confirmationCount || 1) }),
      newValues: catalogAuditJson({
        supplierId,
        catalogItemId,
        supplierItemName,
        supplierItemCode,
        confirmationCount: nextConfirmationCount,
        isActive: true,
      }),
    } as any);
    return;
  }

  const aliasResult = await tx.insert(catalogSupplierItemAliases).values({
    supplierId,
    catalogItemId,
    supplierItemName,
    normalizedName,
    supplierItemCode,
    normalizedItemCode,
    normalizedMeasurements: measurements as any,
    source: "manual",
    confirmationCount: 1,
    lastConfirmedAt: new Date(),
    createdById,
    isActive: 1,
  } as any);
  const aliasId = Number((aliasResult as any)[0]?.insertId || 0) || undefined;
  await tx.insert(catalogAuditLogs).values({
    userId: createdById,
    action: "create_supplier_item_alias",
    entityType: "supplier_item_alias",
    entityId: aliasId,
    newValues: catalogAuditJson({ supplierId, catalogItemId, supplierItemName, supplierItemCode, source: "manual", isActive: true }),
  } as any);
}

export const catalogRouter = router({

  // ────────────────────────────────────────────────────────
  // IMPORT / EXPORT
  // ────────────────────────────────────────────────────────
  importExport: catalogImportExportRouter,

  // ────────────────────────────────────────────────────────
  // 2B-10-2A — CATALOG AUDIT VIEW (OWNER / ADMIN ONLY)
  // ────────────────────────────────────────────────────────
  audit: router({
    list: catalogAdminProcedure
      .input(z.object({
        entityType: z.string().optional(),
        entityId: z.number().optional(),
        userId: z.number().optional(),
        action: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        limit: z.number().min(1).max(500).optional(),
      }).optional())
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        const conditions: any[] = [];
        if (input?.entityType) conditions.push(eq(catalogAuditLogs.entityType, input.entityType));
        if (input?.entityId) conditions.push(eq(catalogAuditLogs.entityId, input.entityId));
        if (input?.userId) conditions.push(eq(catalogAuditLogs.userId, input.userId));
        if (input?.action) conditions.push(eq(catalogAuditLogs.action, input.action));
        if (input?.dateFrom) conditions.push(gte(catalogAuditLogs.createdAt, input.dateFrom));
        if (input?.dateTo) conditions.push(lte(catalogAuditLogs.createdAt, input.dateTo));

        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const rows = await db
          .select()
          .from(catalogAuditLogs)
          .where(where)
          .orderBy(desc(catalogAuditLogs.createdAt))
          .limit(input?.limit || 500);

        return rows.map((row: any) => ({ ...row, auditSource: "catalog" as const }));
      }),
  }),

  // ────────────────────────────────────────────────────────
  // TAXONOMY NODES - CRUD Operations
  // ────────────────────────────────────────────────────────

  /**
   * Get all taxonomy nodes (with optional filtering)   */
  nodes: router({
    list: catalogReferenceReadProcedure
      .input(
        z.object({
          parentId: z.number().optional(),
          isActive: z.boolean().optional(),
          includeInactive: z.boolean().optional(),
          level: z.number().optional(),
        }).optional()
      )
      .query(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        const conditions = [];

        // افتراضي: أظهر النشطين فقط. ضمن إدارة الكتالوج يمكن لـOwner/Admin
        // طلب النشط + المعطّل لأغراض governance، بينما القراءات التشغيلية تبقى Active-only.
        const role = (ctx as any)?.user?.role;
        const canIncludeInactive = role === APP_ROLE.OWNER || role === APP_ROLE.ADMIN;
        const includeInactive = input?.includeInactive === true && canIncludeInactive;
        if (!includeInactive) {
          const activeFilter = input?.isActive !== undefined ? input.isActive : true;
          conditions.push(eq(catalogNodes.isActive, activeFilter === true ? 1 : 0));
        }

        if (input?.parentId !== undefined) {
          conditions.push(eq(catalogNodes.parentId, input.parentId));
        }
        if (input?.level !== undefined) {
          conditions.push(eq(catalogNodes.level, input.level));
        }

        const results = await db.select().from(catalogNodes).where(and(...conditions));

        // تقييد أدوار المستودع الغذائي على قسم "المطبخ" وشجرته الفرعية فقط
        if (role && FOOD_WAREHOUSE_ROLES.includes(role)) {
          const allowedIds = new Set(await getFoodWarehouseNodeIds());
          return results.filter((n: any) => allowedIds.has(n.id));
        }

        return results;
      }),

    /**
     * Get a single node by ID
     */
    getById: catalogProcedure
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
    getChildren: catalogProcedure
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
    create: catalogProcedure
      .input(
        z.object({
          nameAr: z.string(),
          nameEn: z.string(),
          nameUr: z.string().optional(),
          code: z.string().regex(/^\d+(?:-\d+)*$/, "الكود يجب أن يتكون من مقاطع رقمية تفصلها شرطة").optional(),
          parentId: z.number().optional(),
          level: z.number(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        // بنية الشجرة وترقيمها يجب أن يحددهما الخادم لا قيمة level القادمة
        // من الواجهة. هذا يمنع إنشاء فرع بمستوى أو Prefix لا يطابق أباه.
        let parentNode: any = null;
        if (input.parentId !== undefined) {
          parentNode = await assertActiveCatalogNodePath(db, input.parentId);
        }
        const actualLevel = parentNode ? Number(parentNode.level) + 1 : 1;
        if (actualLevel > 6) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "الحد الأقصى للمستويات هو 6" });
        }

        // ── توليد الكود التلقائي + حجز الأكواد التاريخية ───────────────
        let code = input.code?.trim();
        if (code && parentNode) {
          const parentCode = String(parentNode.code || "").trim();
          if (!isCatalogNodeCodeForParent(code, parentCode)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `كود التصنيف الفرعي يجب أن يكون بصيغة ${parentCode || "كود الأب"}-01`,
            });
          }
        } else if (code && !isHierarchicalCatalogNodeCode(code)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "كود التصنيف الرئيسي يبدأ من 01، وكل مقطع يجب أن يكون خانتين على الأقل",
          });
        }
        if (!code) {
          code = await nextAvailableCatalogNodeCode(db, input.parentId ?? null);
        }
        await assertCatalogCodeAvailable(db, "node", String(code));

        const insertData = {
          code: code ? String(code) : null,
          nameAr: input.nameAr,
          nameEn: input.nameEn,
          nameUr: input.nameUr || null,
          parentId: input.parentId ?? null,
          level: actualLevel,
          isActive: 1,
        } as any;

        let insertId = 0;
        await (db as any).transaction(async (tx: any) => {
          const result = await tx.insert(catalogNodes).values(insertData);
          insertId = Number((result as any)[0]?.insertId || 0);
          if (!insertId) throw new Error("تعذر تحديد رقم التصنيف الجديد");

          await tx.insert(catalogAuditLogs).values({
            userId: ctx.user.id,
            action: "create",
            entityType: "node",
            entityId: insertId,
            newValues: catalogAuditJson(insertData),
          } as any);
        });

        return insertId;
      }),

    /**
     * Update a taxonomy node
     */
    update: catalogProcedure
      .input(
        z.object({
          id: z.number(),
          nameAr: z.string().optional(),
          nameEn: z.string().optional(),
          nameUr: z.string().optional(),
          code: z.string().regex(/^\d+(?:-\d+)*$/, "الكود يجب أن يتكون من مقاطع رقمية تفصلها شرطة").optional(),
          isActive: z.boolean().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        if (ctx.user.role === APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER && input.isActive !== undefined) {
          throw new TRPCError({ code: "FORBIDDEN", message: "مدير الإنشاءات لا يملك صلاحية تعطيل التصنيفات" });
        }

        const { id, code, ...updateData } = input;

        const existingRows = await db.select().from(catalogNodes).where(eq(catalogNodes.id, id)).limit(1);
        const existing = existingRows[0] as any;
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "التصنيف غير موجود" });

        // تغيير كود عقدة منفردة يكسر أكواد الأبناء والأصناف. منذ إضافة إعادة
        // الهيكلة لا يُسمح بتغييره من التعديل العادي؛ النقل الآمن يعيد ترقيم
        // كامل الفرع داخل Transaction واحدة وبصلاحية Owner/Admin فقط.
        if (code !== undefined && String(code || "").trim() !== String(existing.code || "").trim()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "لا يمكن تغيير كود التصنيف من التعديل العادي. استخدم «نقل / إعادة هيكلة» لإعادة ترقيم الفرع بأمان.",
          });
        }

        await (db as any).transaction(async (tx: any) => {
          await tx.update(catalogNodes).set(updateData as any).where(eq(catalogNodes.id, id));
          await tx.insert(catalogAuditLogs).values({
            userId: ctx.user.id,
            action: "update",
            entityType: "node",
            entityId: id,
            oldValues: catalogAuditJson(pickAuditValues(existing, updateData)),
            newValues: catalogAuditJson(updateData),
          } as any);
        });
      }),

    /**
     * Preview moving/re-parenting a whole taxonomy subtree. Owner/Admin only.
     * No writes are performed; the result contains the exact node/item codes
     * that will change plus blockers such as open category counts.
     */
    previewMove: catalogAdminProcedure
      .input(z.object({
        nodeId: z.number().int().positive(),
        targetParentId: z.number().int().positive().nullable(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        try {
          return await previewCatalogTaxonomyMove(db, input);
        } catch (error: any) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error?.message || "تعذر معاينة نقل التصنيف" });
        }
      }),

    /**
     * Execute the complete subtree move atomically. Category/item identities are
     * preserved; only parent/level/current codes are changed. Historical codes
     * are kept as aliases so supported imports can still resolve old files.
     */
    moveSubtree: catalogAdminProcedure
      .input(z.object({
        nodeId: z.number().int().positive(),
        targetParentId: z.number().int().positive().nullable(),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        try {
          const meta = catalogAuditRequestMeta(ctx);
          const result = await executeCatalogTaxonomyMove(db, {
            ...input,
            userId: ctx.user.id,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
          });
          _foodWarehouseNodeIdsCache = null;
          return result;
        } catch (error: any) {
          const message = error?.message || "تعذر نقل التصنيف";
          throw new TRPCError({ code: message.includes("مستخدم") || message.includes("محجوز") ? "CONFLICT" : "BAD_REQUEST", message });
        }
      }),

    /**
     * Delete a taxonomy node (soft delete)
     */
    delete: catalogAdminProcedure
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

        const existingRows = await db.select().from(catalogNodes).where(eq(catalogNodes.id, input)).limit(1);
        const existing = existingRows[0] as any;
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "التصنيف غير موجود" });
        if (Number(existing.isActive) !== 1) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "التصنيف معطّل بالفعل" });
        }

        // حذف منطقي + Audit إلزامي داخل نفس المعاملة
        await (db as any).transaction(async (tx: any) => {
          await tx.update(catalogNodes).set({ isActive: 0 }).where(eq(catalogNodes.id, input));
          await tx.insert(catalogAuditLogs).values({
            userId: ctx.user.id,
            action: "delete",
            entityType: "node",
            entityId: input,
            oldValues: catalogAuditJson({ isActive: Boolean(existing.isActive) }),
            newValues: catalogAuditJson({ isActive: false }),
          } as any);
        });
      }),

    /**
     * Reactivate a taxonomy node after soft delete/deactivation.
     * Owner/Admin only. Keeps the same node identity and records Audit.
     */
    reactivate: catalogAdminProcedure
      .input(z.number())
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        const existingRows = await db.select().from(catalogNodes).where(eq(catalogNodes.id, input)).limit(1);
        const existing = existingRows[0] as any;
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "التصنيف غير موجود" });
        if (Number(existing.isActive) === 1) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "التصنيف نشط بالفعل" });
        }

        // إعادة التفعيل تجعل التصنيف متاحاً لعلاقات جديدة؛ لذلك يجب أن يكون
        // الأب وكامل المسار الأعلى نشطاً. الجذر لا يحتاج هذا الفحص.
        if (existing.parentId != null) {
          await assertActiveCatalogNodePath(db, Number(existing.parentId));
        }

        await (db as any).transaction(async (tx: any) => {
          await tx.update(catalogNodes).set({ isActive: 1 }).where(eq(catalogNodes.id, input));
          await tx.insert(catalogAuditLogs).values({
            userId: ctx.user.id,
            action: "update",
            entityType: "node",
            entityId: input,
            oldValues: catalogAuditJson({ isActive: false }),
            newValues: catalogAuditJson({ isActive: true }),
          } as any);
        });
      }),
  }),

  // ────────────────────────────────────────────────────────
  // CATALOG ITEMS - CRUD Operations
  // ────────────────────────────────────────────────────────

items: router({

  count: catalogItemManagerProcedure
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
    list: catalogReferenceReadProcedure
      .input(
        z.object({
          search: z.string().optional(),
          nodeId: z.number().optional(),
          nodeIds: z.array(z.number()).optional(),
          isActive: z.boolean().optional(),
          includeInactive: z.boolean().optional(),
          limit: z.number().default(50),
          offset: z.number().default(0),
        }).optional()
      )
      .query(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

const conditions = [];

// افتراضي: أظهر النشطين فقط.
// 2B-10-2B UAT: Owner/Admin داخل إدارة الكتالوج يمكنهما طلب النشط + المعطّل
// لأغراض governance/visibility، بينما جميع القراءات التشغيلية تبقى Active-only افتراضياً.
const role = (ctx as any)?.user?.role;
const canIncludeInactive = role === APP_ROLE.OWNER || role === APP_ROLE.ADMIN
  || role === APP_ROLE.MAINTENANCE_MANAGER || role === APP_ROLE.WAREHOUSE
  || (role === APP_ROLE.IT_MANAGER && ctx.user.isActive === 1);
const includeInactive = input?.includeInactive === true && canIncludeInactive;
if (!includeInactive) {
  const activeFilter = input?.isActive !== undefined ? input.isActive : true;
  conditions.push(eq(catalogItems.isActive, activeFilter === true ? 1 : 0));
}

// تقييد أدوار المستودع الغذائي على قسم "المطبخ" وشجرته الفرعية فقط — يُطبَّق
// من السيرفر بغض النظر عمّا يرسله العميل، لمنع أي تحايل على القيد من الواجهة
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
  // Keep historical Catalog Item codes searchable after a taxonomy/code migration.
  // This is one bounded, actor/RPC-scoped lookup; it does not add a per-row read or
  // bypass the active/category scope applied to the final catalog_items query.
  const aliasRows = await db
    .select({ entityId: catalogCodeAliases.entityId })
    .from(catalogCodeAliases)
    .where(and(
      eq(catalogCodeAliases.entityType, "item"),
      like(catalogCodeAliases.oldCode, term),
    ))
    .limit(500);
  const aliasItemIds = boundedDistinctCatalogCodeAliasEntityIds(aliasRows);

  conditions.push(
    or(
      like(catalogItems.nameAr, term),
      like(catalogItems.nameEn, term),
      like(catalogItems.code, term),
      like(catalogItems.manufacturer, term),
      like(catalogItems.unit, term),
      sql`EXISTS (SELECT 1 FROM inventory aliases WHERE aliases.linkedItemId=${catalogItems.id} AND aliases.itemName LIKE ${term})`,
      isInventoryLotsEnabled() ? sql`EXISTS (SELECT 1 FROM inventory_lots aliases WHERE aliases.catalogItemId=${catalogItems.id} AND aliases.supplierItemName LIKE ${term})` : undefined,
      sql`EXISTS (SELECT 1 FROM catalog_item_candidates aliases WHERE aliases.resolvedCatalogItemId=${catalogItems.id} AND aliases.itemName LIKE ${term})`,
      ...(aliasItemIds.length > 0 ? [inArray(catalogItems.id, aliasItemIds)] : []),
    )
  );
}

        let query = db.select({ ...getTableColumns(catalogItems), inventoryPageCount: sql<number>`(SELECT COUNT(*) FROM inventory book_pages WHERE book_pages.linkedItemId=${catalogItems.id})` }).from(catalogItems);
        if (conditions.length > 0) {
          query = query.where(and(...conditions)) as any;
        }

const results = await (query as any)
  .orderBy(desc(catalogItems.id))
  .limit(input?.limit || 50)
  .offset(input?.offset || 0);

// جلب الصور الرئيسية للأصناف (استعلام واحد لكل الأصناف بدل استعلام لكل صنف)
const itemIds = results.map((item: any) => item.id);
const showBook=isInventoryLotsEnabled() && canShowCatalogBook(ctx.user);
const bookTotals = showBook ? await loadCatalogBookTotals(db, itemIds) : [];

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
      .orderBy(asc(attachments.id))
  : [];

const imagesByItemId = new Map<number, typeof allImages[number]>();
for (const img of allImages) {
  // نحتفظ بآخر صورة لكل صنف (نفس سلوك latestImage السابق)
  imagesByItemId.set(img.entityId, img);
}

const itemsWithImages = results.map((item: any) => ({
  ...item,
  inventoryPageCount: showBook ? Number(item.inventoryPageCount || 0) : undefined,
  inventoryBookTotals: showBook ? bookTotals.filter(row => Number(row.catalogItemId) === Number(item.id)) : undefined,
  primaryImageUrl: imagesByItemId.get(item.id)?.fileUrl || null,
}));

return itemsWithImages;

      }),

    /**
     * Get a single item with all its details
     */
    getById: catalogItemManagerProcedure
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

        // Images use the same authoritative source as items.list and the upload flow.
        // Preserve the historical `images` response shape so existing consumers do not
        // need to know that catalog images are stored as generic attachments.
        const imageAttachments = await db
          .select()
          .from(attachments)
          .where(and(
            eq(attachments.entityType, "catalog_item"),
            eq(attachments.entityId, input),
          ))
          .orderBy(asc(attachments.id));

        const images = imageAttachments.map((image) => ({
          id: image.id,
          itemId: image.entityId,
          imageUrl: image.fileUrl,
          imageType: "gallery" as const,
          sortOrder: 0,
          createdAt: image.createdAt,
        }));

        return {
          ...item[0],
          specs,
          images,
        };
      }),

    /**
     * Preview the next automatic Catalog Item code for the selected category.
     * The backend is authoritative; create() allocates again inside its DB transaction.
     */
    previewNextCode: catalogItemManagerProcedure
      .input(z.object({ nodeId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const state = await getLeafCategoryCodeState(db, input.nodeId, false);
        return {
          code: state.code,
          nodeId: state.node.id,
          nodeCode: state.node.code,
          nodeNameAr: state.node.nameAr,
        };
      }),

    /**
     * Create a new catalog item
     */
// بعد التعديل
create: catalogItemManagerProcedure
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
      unit: z.string().optional(),
      manufacturer: z.string().optional(),
      image: catalogItemImageSchema,
    })
  )
  .mutation(async ({ input, ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");

    assertCatalogImageUpload(input.image, ctx.user.id);
    const activeUnitName = await assertActiveCatalogMasterUnit(db, input.unit);
    const requestedCode = input.code?.trim() || "";

    let insertId = 0;
    await (db as any).transaction(async (tx: any) => {
      // Allocate/validate the code under the category row lock so automatic
      // numbering stays safe when two users create items concurrently.
      const categoryState = await getLeafCategoryCodeState(tx, input.nodeId, true);
      const categoryCode = String(categoryState.node.code || "").trim();
      const finalCode = requestedCode || categoryState.code;

      if (requestedCode && !isCatalogItemCodeForNode(requestedCode, categoryCode)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `كود الصنف يجب أن يكون بصيغة ${categoryCode}-001 (كود التصنيف-تسلسل رقمي)`,
        });
      }

      await assertCatalogCodeAvailable(tx, "item", finalCode);

      const insertData: any = {
        nameAr: input.nameAr,
        nameEn: input.nameEn,
        nodeId: input.nodeId,
        code: finalCode,
        isActive: 1,
      };

      if (input.nameUr) insertData.nameUr = input.nameUr;
      if (input.descriptionAr) insertData.descriptionAr = input.descriptionAr;
      if (input.descriptionEn) insertData.descriptionEn = input.descriptionEn;
      if (input.descriptionUr) insertData.descriptionUr = input.descriptionUr;
      if (activeUnitName) insertData.unit = activeUnitName;
      if (input.manufacturer) insertData.manufacturer = input.manufacturer;

      const result = await tx.insert(catalogItems).values(insertData);
      insertId = Number((result as any)[0]?.insertId || 0);
      if (!insertId) throw new Error("تعذر تحديد رقم صنف الكتالوج الجديد");
      await saveRequiredCatalogImage(tx, insertId, ctx.user.id, input.image, true, catalogAuditRequestMeta(ctx));

      await tx.insert(catalogAuditLogs).values({
        userId: ctx.user.id,
        action: "create",
        entityType: "item",
        entityId: insertId,
        newValues: catalogAuditJson(insertData),
      } as any);
    });

    return insertId;
  }),

    /**
     * Update a catalog item
     */
    update: catalogItemManagerProcedure
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
          nodeId: z.number().optional(),
          unit: z.string().optional(),
          manufacturer: z.string().optional(),
          image: catalogItemImageSchema.optional(),
          isActive: z.boolean().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role === APP_ROLE.IT_MANAGER && input.isActive === true) {
          throw new TRPCError({ code: "FORBIDDEN", message: "صلاحية مدير IT تشمل تعديل الأصناف وتعطيلها فقط" });
        }

        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        if (ctx.user.role === APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER && input.isActive !== undefined) {
          throw new TRPCError({ code: "FORBIDDEN", message: "مدير الإنشاءات لا يملك صلاحية تعطيل الأصناف" });
        }

        const { id, image, ...updateData } = input;
        if (image) assertCatalogImageUpload(image, ctx.user.id);
        const existingRows = await db.select().from(catalogItems).where(eq(catalogItems.id, id)).limit(1);
        const existing = existingRows[0] as any;
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "صنف الكتالوج غير موجود" });

        const existingNodeId = Number(existing.nodeId);
        const targetNodeId = updateData.nodeId !== undefined ? Number(updateData.nodeId) : existingNodeId;
        const nodeChanged = targetNodeId !== existingNodeId;
        const submittedCode = updateData.code !== undefined ? String(updateData.code || "").trim() : undefined;
        const existingCode = String(existing.code || "").trim();
        const codeChanged = submittedCode !== undefined && submittedCode !== existingCode;

        // The edit dialog allows moving an item to another leaf category. Validate
        // the code against the category selected by the user, not the item's old
        // category. This keeps codes such as 94-015 valid when moving to node 94.
        if (nodeChanged || codeChanged) {
          const targetCategory = await getLeafCategoryCodeState(db, targetNodeId, false);
          const targetNodeCode = String(targetCategory.node.code || "").trim();

          if (nodeChanged && !submittedCode) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `عند تغيير التصنيف يجب أن يكون كود الصنف بصيغة ${targetNodeCode || "11"}-001 (كود التصنيف-تسلسل رقمي)`,
            });
          }

          if (submittedCode && !isCatalogItemCodeForNode(submittedCode, targetNodeCode)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `كود الصنف يجب أن يبدأ بكود التصنيف المختار ${targetNodeCode}- ثم تسلسل رقمي (مثال ${targetNodeCode}-001)`,
            });
          }
        }

        if (updateData.code !== undefined) {
          if (!submittedCode) {
            delete (updateData as any).code;
          } else if (submittedCode !== existingCode) {
            await assertCatalogCodeAvailable(db, "item", submittedCode, id);
            (updateData as any).code = submittedCode;
          } else {
            // Historical no-hyphen codes remain untouched when the user edits
            // other fields; no historical renumbering is performed.
            (updateData as any).code = existingCode;
          }
        }

        if (updateData.unit !== undefined) {
          const submittedUnit = (updateData.unit || "").trim();
          const existingUnit = (existing.unit || "").trim();
          if (submittedUnit && submittedUnit !== existingUnit) {
            updateData.unit = await assertActiveCatalogMasterUnit(db, submittedUnit);
          }
        }

        await (db as any).transaction(async (tx: any) => {
          await saveRequiredCatalogImage(tx, id, ctx.user.id, image, false, catalogAuditRequestMeta(ctx));
          await tx.update(catalogItems).set(updateData).where(eq(catalogItems.id, id));
          await tx.insert(catalogAuditLogs).values({
            userId: ctx.user.id,
            action: "update",
            entityType: "item",
            entityId: id,
            oldValues: catalogAuditJson(pickAuditValues(existing, updateData)),
            newValues: catalogAuditJson(updateData),
          } as any);
        });
      }),

    /**
     * Delete (deactivate) a catalog item (soft delete).
     * Owner/Admin/Maintenance Manager/Warehouse/IT Manager; no physical deletion.
     */
    delete: catalogItemDeactivateProcedure
      .input(z.number())
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        const existingRows = await db.select().from(catalogItems).where(eq(catalogItems.id, input)).limit(1);
        const existing = existingRows[0] as any;
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "صنف الكتالوج غير موجود" });
        if (Number(existing.isActive) !== 1) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "الصنف معطّل بالفعل" });
        }

        await (db as any).transaction(async (tx: any) => {
          await tx.update(catalogItems).set({ isActive: 0 }).where(eq(catalogItems.id, input));
          await tx.insert(catalogAuditLogs).values({
            userId: ctx.user.id,
            action: "delete",
            entityType: "item",
            entityId: input,
            oldValues: catalogAuditJson({ isActive: Boolean(existing.isActive) }),
            newValues: catalogAuditJson({ isActive: false }),
          } as any);
        });
      }),

    /**
     * Reactivate a catalog item after soft delete/deactivation.
     * Owner/Admin/Maintenance Manager/Warehouse. Keeps the same master identity and records Audit.
     */
    reactivate: catalogItemLifecycleProcedure
      .input(z.number())
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        const existingRows = await db.select().from(catalogItems).where(eq(catalogItems.id, input)).limit(1);
        const existing = existingRows[0] as any;
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "صنف الكتالوج غير موجود" });
        if (Number(existing.isActive) === 1) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "الصنف نشط بالفعل" });
        }

        // إعادة التفعيل تجعل الصنف متاحاً للعمليات الجديدة، لذلك يجب أن يكون مسار التصنيف نشطاً.
        await assertActiveCatalogNodePath(db, Number(existing.nodeId));

        await (db as any).transaction(async (tx: any) => {
          await tx.update(catalogItems).set({ isActive: 1 }).where(eq(catalogItems.id, input));
          await tx.insert(catalogAuditLogs).values({
            userId: ctx.user.id,
            action: "update",
            entityType: "item",
            entityId: input,
            oldValues: catalogAuditJson({ isActive: false }),
            newValues: catalogAuditJson({ isActive: true }),
          } as any);
        });
      }),
  }),


  // ────────────────────────────────────────────────────────
  // 2B-6 — CATALOG ITEM CANDIDATE REVIEW
  // ────────────────────────────────────────────────────────
  itemCandidates: router({
    listPending: catalogProcedure
      .input(z.object({ limit: z.number().min(1).max(300).default(100) }).optional())
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        const requestedLimit = input?.limit ?? 100;
        const pendingRows = await db
          .select()
          .from(catalogItemCandidates)
          .where(eq(catalogItemCandidates.status, "pending"))
          .orderBy(desc(catalogItemCandidates.createdAt))
          .limit(Math.min(300, Math.max(requestedLimit * 2, requestedLimit)));

        const sameItemDecisions = await db.select().from(catalogItemCandidateDuplicateDecisions)
          .where(eq(catalogItemCandidateDuplicateDecisions.decision, "same_item"));
        const hiddenSecondaryIds = new Set<number>();
        for (const decision of sameItemDecisions as any[]) {
          if (!decision.primaryCandidateId) continue;
          const secondaryId = decision.candidateLowId === decision.primaryCandidateId
            ? decision.candidateHighId
            : decision.candidateLowId;
          hiddenSecondaryIds.add(secondaryId);
        }
        const candidates = (pendingRows as any[])
          .filter((row: any) => !hiddenSecondaryIds.has(row.id))
          .slice(0, requestedLimit);

        const supplierIds = [...new Set(candidates.map((row: any) => row.catalogSupplierId).filter(Boolean))] as number[];
        const poIds = [...new Set(candidates.map((row: any) => row.purchaseOrderId).filter(Boolean))] as number[];

        const suppliers = supplierIds.length
          ? await db.select({ id: catalogSuppliers.id, nameAr: catalogSuppliers.nameAr, nameEn: catalogSuppliers.nameEn })
              .from(catalogSuppliers).where(inArray(catalogSuppliers.id, supplierIds))
          : [];
        const purchaseOrdersRows = poIds.length
          ? await db.select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber })
              .from(purchaseOrders).where(inArray(purchaseOrders.id, poIds))
          : [];

        const supplierMap = new Map<number, { id: number; nameAr: string; nameEn: string }>(suppliers.map((row: any) => [row.id, row]));
        const poMap = new Map<number, { id: number; poNumber: string }>(purchaseOrdersRows.map((row: any) => [row.id, row]));

        return candidates.map((candidate: any) => ({
          ...candidate,
          supplierNameAr: candidate.catalogSupplierId ? supplierMap.get(candidate.catalogSupplierId)?.nameAr ?? null : null,
          supplierNameEn: candidate.catalogSupplierId ? supplierMap.get(candidate.catalogSupplierId)?.nameEn ?? null : null,
          poNumber: candidate.purchaseOrderId ? poMap.get(candidate.purchaseOrderId)?.poNumber ?? null : null,
        }));
      }),

    suggestExisting: catalogProcedure
      .input(z.object({ candidateId: z.number(), limit: z.number().min(1).max(8).default(5) }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        const rows = await db.select().from(catalogItemCandidates)
          .where(eq(catalogItemCandidates.id, input.candidateId)).limit(1);
        const candidate = rows[0] as any;
        if (!candidate || candidate.status !== "pending") {
          throw new TRPCError({ code: "NOT_FOUND", message: "مرشح الصنف غير موجود أو تمت معالجته" });
        }
        const candidateDecisions = await loadCandidateDuplicateDecisions(db, candidate.id);
        const primaryCandidateId = sameItemPrimaryForCandidate(candidate.id, candidateDecisions as any[]);
        if (primaryCandidateId) {
          throw new TRPCError({ code: "CONFLICT", message: `هذا المرشح تم ضمه إلى Candidate #${primaryCandidateId}. راجع المرشح الأساسي.` });
        }
        const excludedPendingCandidateIds = new Set(decidedPeerIds(candidate.id, candidateDecisions as any[]));

        const catalogRows = await db.select({
          id: catalogItems.id,
          code: catalogItems.code,
          nameAr: catalogItems.nameAr,
          nameEn: catalogItems.nameEn,
          unit: catalogItems.unit,
          manufacturer: catalogItems.manufacturer,
        }).from(catalogItems).where(eq(catalogItems.isActive, true));

        const supplierAliases = candidate.catalogSupplierId
          ? await db.select().from(catalogSupplierItemAliases).where(and(
              eq(catalogSupplierItemAliases.supplierId, candidate.catalogSupplierId),
              eq(catalogSupplierItemAliases.isActive, true),
            ))
          : [];

        const query = {
          itemName: candidateReviewDisplayName(candidate),
          itemNameEn: candidate.itemNameEn || undefined,
          supplierItemCode: candidate.supplierItemCode || undefined,
          unit: candidate.purchaseUnit || undefined,
        };

        let matches = rankCatalogItemMatches({
          query,
          catalogItems: catalogRows as any[],
          supplierAliases: supplierAliases as any[],
          limit: input.limit,
        });

        const top = matches[0];
        const strongDeterministic = !!top && (
          top.reason === "supplier_code_exact" ||
          top.reason === "supplier_alias_exact" ||
          top.score >= 92
        );

        // 2B-6 UAT gap: فحص التكرار يجب أن يبحث أيضاً بين Candidates pending،
        // لأن نفس الصنف قد يكون أنشأ أكثر من inventoryId قبل اعتماد Master Item.
        const otherPendingCandidateRows = await db.select().from(catalogItemCandidates).where(and(
          eq(catalogItemCandidates.status, "pending"),
          ne(catalogItemCandidates.id, candidate.id),
        ));
        const otherPendingCandidates = (otherPendingCandidateRows as any[])
          .filter((row: any) => !excludedPendingCandidateIds.has(row.id));
        const pendingById = new Map<number, any>((otherPendingCandidates as any[]).map((row: any) => [row.id, row]));
        const pendingAsCatalogItems = (otherPendingCandidates as any[]).map((row: any) => ({
          id: row.id,
          code: null,
          nameAr: candidateReviewDisplayName(row),
          nameEn: row.itemNameEn || null,
          unit: row.purchaseUnit || null,
          manufacturer: null,
        }));
        const pendingSupplierAliases = candidate.catalogSupplierId
          ? (otherPendingCandidates as any[])
              .filter((row: any) => row.catalogSupplierId === candidate.catalogSupplierId)
              .map((row: any) => ({
                id: row.id,
                supplierId: candidate.catalogSupplierId,
                catalogItemId: row.id,
                supplierItemName: candidateReviewDisplayName(row),
                normalizedName: normalizeCatalogItemText(candidateReviewDisplayName(row)),
                supplierItemCode: row.supplierItemCode || null,
                normalizedItemCode: row.supplierItemCode ? normalizeSupplierItemCode(row.supplierItemCode) : null,
              }))
          : [];

        let pendingMatches = rankCatalogItemMatches({
          query,
          catalogItems: pendingAsCatalogItems,
          supplierAliases: pendingSupplierAliases,
          limit: input.limit,
        });
        const pendingTop = pendingMatches[0];
        const pendingStrongDeterministic = !!pendingTop && (
          pendingTop.reason === "supplier_code_exact" ||
          pendingTop.reason === "supplier_alias_exact" ||
          pendingTop.score >= 92
        );
        if (!pendingStrongDeterministic && pendingAsCatalogItems.length > 0) {
          pendingMatches = await applyAiSemanticDiscovery({
            query,
            catalogItems: pendingAsCatalogItems,
            deterministicCandidates: pendingMatches,
            limit: input.limit,
          });
        }

        const hasStrongPendingCandidate = pendingMatches.some(match =>
          match.measurementStatus !== "conflict" && match.score >= 85,
        );
        // إذا كان هناك Candidate pending قوي، فهو أهم Duplicate يجب حسمه أولاً.
        // لا ندفع DeepSeek إضافياً لمسح Catalog في نفس الضغط؛ تبقى نتائج Catalog الحتمية
        // القوية ظاهرة، ويمكن فحص المرشح الأصلي بعد حسم الـCandidate المتكرر.
        if (!strongDeterministic && !hasStrongPendingCandidate) {
          matches = await applyAiSemanticDiscovery({
            query,
            catalogItems: catalogRows as any[],
            deterministicCandidates: matches,
            limit: input.limit,
          });
        }

        const visibleCatalogMatches = matches
          .filter(match => match.score >= 75 || match.reason === "supplier_code_exact" || match.reason === "supplier_alias_exact")
          .slice(0, input.limit);
        const visibleCandidateMatches = pendingMatches
          .filter(match => match.score >= 75 || match.reason === "supplier_code_exact" || match.reason === "supplier_alias_exact")
          .slice(0, input.limit)
          .map(match => {
            const duplicate = pendingById.get(match.catalogItemId);
            return {
              candidateId: match.catalogItemId,
              itemName: duplicate?.itemName ?? match.nameAr,
              itemNameAr: duplicate?.itemNameAr ?? match.nameAr,
              itemNameEn: duplicate?.itemNameEn ?? match.nameEn ?? null,
              inventoryId: duplicate?.inventoryId ?? null,
              purchaseOrderId: duplicate?.purchaseOrderId ?? null,
              invoiceNumber: duplicate?.invoiceNumber ?? null,
              catalogSupplierId: duplicate?.catalogSupplierId ?? null,
              supplierItemCode: duplicate?.supplierItemCode ?? null,
              purchaseUnit: duplicate?.purchaseUnit ?? null,
              score: match.score,
              reason: match.reason,
              measurementStatus: match.measurementStatus,
              measurementNote: match.measurementNote ?? null,
            };
          });

        return {
          catalogMatches: visibleCatalogMatches,
          candidateMatches: visibleCandidateMatches,
        };
      }),

    markSameItem: catalogProcedure
      .input(z.object({
        candidateId: z.number(),
        otherCandidateId: z.number(),
        primaryCandidateId: z.number(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (input.candidateId === input.otherCandidateId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن دمج Candidate مع نفسه" });
        }
        if (![input.candidateId, input.otherCandidateId].includes(input.primaryCandidateId)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "المرشح الأساسي يجب أن يكون أحد المرشحين المحددين" });
        }

        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const pair = normalizeCandidatePair(input.candidateId, input.otherCandidateId);
        const secondaryCandidateId = input.primaryCandidateId === input.candidateId ? input.otherCandidateId : input.candidateId;

        await (db as any).transaction(async (tx: any) => {
          const candidateRows = await tx.select().from(catalogItemCandidates)
            .where(inArray(catalogItemCandidates.id, [input.candidateId, input.otherCandidateId]));
          if (candidateRows.length !== 2 || candidateRows.some((row: any) => row.status !== "pending")) {
            throw new TRPCError({ code: "CONFLICT", message: "أحد المرشحين غير موجود أو تمت معالجته؛ حدّث القائمة" });
          }

          const primaryDecisions = await loadCandidateDuplicateDecisions(tx, input.primaryCandidateId);
          const primaryParent = sameItemPrimaryForCandidate(input.primaryCandidateId, primaryDecisions as any[]);
          if (primaryParent) {
            throw new TRPCError({ code: "CONFLICT", message: `Candidate #${input.primaryCandidateId} تابع بالفعل لـCandidate #${primaryParent}; اختر المرشح الأساسي الحقيقي` });
          }
          const secondaryDecisions = await loadCandidateDuplicateDecisions(tx, secondaryCandidateId);
          const secondaryParent = sameItemPrimaryForCandidate(secondaryCandidateId, secondaryDecisions as any[]);
          if (secondaryParent && secondaryParent !== input.primaryCandidateId) {
            throw new TRPCError({ code: "CONFLICT", message: `Candidate #${secondaryCandidateId} تابع بالفعل لـCandidate #${secondaryParent}` });
          }
          const secondaryOwnsGroup = (secondaryDecisions as any[]).some((decision: any) =>
            decision.decision === "same_item" && decision.primaryCandidateId === secondaryCandidateId,
          );
          if (secondaryOwnsGroup && secondaryCandidateId !== input.primaryCandidateId) {
            throw new TRPCError({
              code: "CONFLICT",
              message: `Candidate #${secondaryCandidateId} هو المرشح الأساسي لمجموعة أخرى. اختره كمرشح أساسي أو احسم مجموعته أولاً.`,
            });
          }

          await tx.insert(catalogItemCandidateDuplicateDecisions).values({
            ...pair,
            decision: "same_item",
            primaryCandidateId: input.primaryCandidateId,
            decidedById: ctx.user.id,
          } as any).onDuplicateKeyUpdate({ set: {
            decision: "same_item",
            primaryCandidateId: input.primaryCandidateId,
            decidedById: ctx.user.id,
            updatedAt: new Date(),
          } as any });

          await tx.insert(catalogAuditLogs).values({
            userId: ctx.user.id,
            action: "merge_item_candidates",
            entityType: "catalog_item_candidate",
            entityId: input.primaryCandidateId,
            newValues: catalogAuditJson({ secondaryCandidateId, decision: "same_item" }),
          } as any);
        });

        return { success: true, primaryCandidateId: input.primaryCandidateId, secondaryCandidateId };
      }),

    markNotSameItem: catalogProcedure
      .input(z.object({ candidateId: z.number(), otherCandidateId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        if (input.candidateId === input.otherCandidateId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن مقارنة Candidate مع نفسه" });
        }
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const pair = normalizeCandidatePair(input.candidateId, input.otherCandidateId);

        const candidateRows = await db.select().from(catalogItemCandidates)
          .where(inArray(catalogItemCandidates.id, [input.candidateId, input.otherCandidateId]));
        if (candidateRows.length !== 2 || candidateRows.some((row: any) => row.status !== "pending")) {
          throw new TRPCError({ code: "CONFLICT", message: "أحد المرشحين غير موجود أو تمت معالجته؛ حدّث القائمة" });
        }
        const existing = await db.select().from(catalogItemCandidateDuplicateDecisions).where(and(
          eq(catalogItemCandidateDuplicateDecisions.candidateLowId, pair.candidateLowId),
          eq(catalogItemCandidateDuplicateDecisions.candidateHighId, pair.candidateHighId),
        )).limit(1);
        if (existing[0]?.decision === "same_item") {
          throw new TRPCError({ code: "CONFLICT", message: "تم اعتماد هذين المرشحين مسبقاً كنفس الصنف. فك الدمج يحتاج إجراء إداري منفصل." });
        }

        await (db as any).transaction(async (tx: any) => {
          await tx.insert(catalogItemCandidateDuplicateDecisions).values({
            ...pair,
            decision: "not_same_item",
            primaryCandidateId: null,
            decidedById: ctx.user.id,
          } as any).onDuplicateKeyUpdate({ set: {
            decision: "not_same_item",
            primaryCandidateId: null,
            decidedById: ctx.user.id,
            updatedAt: new Date(),
          } as any });

          await tx.insert(catalogAuditLogs).values({
            userId: ctx.user.id,
            action: "separate_item_candidates",
            entityType: "catalog_item_candidate",
            entityId: input.candidateId,
            newValues: catalogAuditJson({ otherCandidateId: input.otherCandidateId, decision: "not_same_item" }),
          } as any);
        });
        return { success: true };
      }),

    linkExisting: catalogProcedure
      .input(z.object({ candidateId: z.number(), catalogItemId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        const candidateRows = await db.select().from(catalogItemCandidates)
          .where(eq(catalogItemCandidates.id, input.candidateId)).limit(1);
        const candidate = candidateRows[0] as any;
        if (!candidate || candidate.status !== "pending") {
          throw new TRPCError({ code: "NOT_FOUND", message: "مرشح الصنف غير موجود أو تمت معالجته" });
        }

        const itemRows = await db.select().from(catalogItems)
          .where(and(eq(catalogItems.id, input.catalogItemId), eq(catalogItems.isActive, true))).limit(1);
        const catalogItem = itemRows[0] as any;
        if (!catalogItem) throw new TRPCError({ code: "NOT_FOUND", message: "صنف الكتالوج المختار غير موجود أو غير نشط" });

        let resolvedCandidateIds: number[] = [];
        await (db as any).transaction(async (tx: any) => {
          // Serialize "link to existing" decisions for the same Catalog Item.
          // This closes the no-existing-stock race where two candidates could otherwise
          // both become separate Inventory rows for the same Catalog Item + warehouse.
          await tx.execute(sql`SELECT id FROM catalog_items WHERE id = ${catalogItem.id} FOR UPDATE`);

          const groupCandidates = await loadResolutionGroup(tx, candidate.id);
          resolvedCandidateIds = groupCandidates.map((row: any) => row.id);
          const resolved = await tx.update(catalogItemCandidates).set({
            status: "linked_existing",
            resolvedCatalogItemId: catalogItem.id,
            resolvedById: ctx.user.id,
            resolvedAt: new Date(),
          } as any).where(and(
            inArray(catalogItemCandidates.id, resolvedCandidateIds),
            eq(catalogItemCandidates.status, "pending"),
          ));
          const affectedRows = Number((resolved as any)?.[0]?.affectedRows ?? (resolved as any)?.affectedRows ?? 0);
          if (affectedRows !== groupCandidates.length) {
            throw new TRPCError({ code: "CONFLICT", message: "تمت معالجة أحد المرشحين المضمومين بواسطة مستخدم آخر؛ حدّث القائمة" });
          }

          for (const groupedCandidate of groupCandidates) {
            if (!groupedCandidate.catalogSupplierId) continue;
            await rememberCandidateSupplierAlias(tx, {
              candidate: groupedCandidate,
              catalogItemId: catalogItem.id,
              createdById: ctx.user.id,
            });
          }

          // Publish the catalog identity in the existing transaction; stock pages
          // retain their own quantities, units, lots and document references.
          await publishResolvedCatalogIdentity(tx, groupCandidates as any[], catalogItem.id);
          // Catalog is the master identity; historical inventory records/lots
          // remain independent pages. Linking never relocates stock or documents.
          const inventoryMerges: never[] = [];

          await tx.insert(catalogAuditLogs).values({
            userId: ctx.user.id,
            action: "link_item_candidate",
            entityType: "catalog_item_candidate",
            entityId: candidate.id,
            newValues: catalogAuditJson({ catalogItemId: catalogItem.id, resolvedCandidateIds, inventoryMerges }),
          } as any);
        });

        return { success: true, catalogItemId: catalogItem.id };
      }),

    previewNextCode: catalogProcedure
      .input(z.object({ nodeId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const state = await getLeafCategoryCodeState(db, input.nodeId, false);
        return {
          code: state.code,
          nodeId: state.node.id,
          nodeCode: state.node.code,
          nodeNameAr: state.node.nameAr,
        };
      }),

    approveNew: catalogProcedure
      .input(z.object({
        candidateId: z.number(),
        nameAr: z.string().min(1),
        nameEn: z.string().min(1),
        nameUr: z.string().optional(),
        descriptionAr: z.string().optional(),
        descriptionEn: z.string().optional(),
        nodeId: z.number(),
        unit: z.string().optional(),
        manufacturer: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        const candidateRows = await db.select().from(catalogItemCandidates)
          .where(eq(catalogItemCandidates.id, input.candidateId)).limit(1);
        const candidate = candidateRows[0] as any;
        if (!candidate || candidate.status !== "pending") {
          throw new TRPCError({ code: "NOT_FOUND", message: "مرشح الصنف غير موجود أو تمت معالجته" });
        }

        // Preflight validation for UX; actual code allocation is repeated under
        // a row lock inside the transaction immediately before insert.
        await getLeafCategoryCodeState(db, input.nodeId, false);

        const candidateDecisions = await loadCandidateDuplicateDecisions(db, candidate.id);
        const parentCandidateId = sameItemPrimaryForCandidate(candidate.id, candidateDecisions as any[]);
        if (parentCandidateId) {
          throw new TRPCError({ code: "CONFLICT", message: `هذا المرشح تابع لـCandidate #${parentCandidateId}. اعتمد المرشح الأساسي أولاً.` });
        }
        const decidedPeers = new Set(decidedPeerIds(candidate.id, candidateDecisions as any[]));
        const otherPendingCandidateRows = await db.select().from(catalogItemCandidates).where(and(
          eq(catalogItemCandidates.status, "pending"),
          ne(catalogItemCandidates.id, candidate.id),
        ));
        const otherPendingCandidates = (otherPendingCandidateRows as any[]).filter((row: any) => !decidedPeers.has(row.id));
        const exactPendingDuplicate = findExactPendingCandidateDuplicate({
          nameAr: input.nameAr.trim(),
          nameEn: input.nameEn.trim(),
          code: candidate.supplierItemCode?.trim() || null,
          catalogSupplierId: candidate.catalogSupplierId,
        }, otherPendingCandidates as any[]);
        if (exactPendingDuplicate) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `يوجد مرشح آخر بانتظار المراجعة قد يمثل نفس الصنف (Candidate #${exactPendingDuplicate.id}). احسم المرشح الآخر أولاً أو عدّل بيانات Master إذا كان هذا صنفاً مختلفاً فعلاً.`,
          });
        }

        const allCatalogItems = await db.select({
          id: catalogItems.id,
          code: catalogItems.code,
          nameAr: catalogItems.nameAr,
          nameEn: catalogItems.nameEn,
        }).from(catalogItems);

        const exactDuplicate = findExactCatalogDuplicate({
          nameAr: input.nameAr.trim(),
          nameEn: input.nameEn.trim(),
          code: null,
        }, allCatalogItems as any[]);
        if (exactDuplicate) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `يوجد صنف مطابق في الكتالوج (#${exactDuplicate.id})؛ اربط المرشح بالصنف الموجود بدلاً من إنشاء نسخة جديدة`,
          });
        }

        let newCatalogItemId = 0;
        let generatedCatalogCode = "";
        const selectedUnitName = input.unit?.trim()
          ? await assertActiveCatalogMasterUnit(db, input.unit)
          : await getActiveCatalogUnitCanonicalName(candidate.purchaseUnit, db);
        await (db as any).transaction(async (tx: any) => {
          const categoryState = await getLeafCategoryCodeState(tx, input.nodeId, true);
          generatedCatalogCode = categoryState.code;

          // Final safety check mirrors catalog.items.create and also protects
          // historical aliases. In ordinary operation the allocator above has
          // already skipped every reserved code.
          await assertCatalogCodeAvailable(tx, "item", generatedCatalogCode);

          const newItemValues = {
            nameAr: input.nameAr.trim(),
            nameEn: input.nameEn.trim(),
            nameUr: input.nameUr?.trim() || null,
            descriptionAr: input.descriptionAr?.trim() || null,
            descriptionEn: input.descriptionEn?.trim() || null,
            code: generatedCatalogCode,
            nodeId: input.nodeId,
            unit: selectedUnitName,
            manufacturer: input.manufacturer?.trim() || null,
            isActive: 1,
          } as any;
          const result = await tx.insert(catalogItems).values(newItemValues);
          newCatalogItemId = Number((result as any)[0]?.insertId || 0);
          if (!newCatalogItemId) throw new Error("تعذر تحديد رقم صنف الكتالوج الجديد");

          const groupCandidates = await loadResolutionGroup(tx, candidate.id);
          const resolvedCandidateIds = groupCandidates.map((row: any) => row.id);
          const resolved = await tx.update(catalogItemCandidates).set({
            status: "approved_new",
            resolvedCatalogItemId: newCatalogItemId,
            resolvedById: ctx.user.id,
            resolvedAt: new Date(),
          } as any).where(and(
            inArray(catalogItemCandidates.id, resolvedCandidateIds),
            eq(catalogItemCandidates.status, "pending"),
          ));
          const affectedRows = Number((resolved as any)?.[0]?.affectedRows ?? (resolved as any)?.affectedRows ?? 0);
          if (affectedRows !== groupCandidates.length) {
            throw new TRPCError({ code: "CONFLICT", message: "تمت معالجة أحد المرشحين المضمومين بواسطة مستخدم آخر؛ أُلغي إنشاء الصنف وارجع لتحديث القائمة" });
          }

          for (const groupedCandidate of groupCandidates) {
            if (!groupedCandidate.catalogSupplierId) continue;
            await rememberCandidateSupplierAlias(tx, {
              candidate: groupedCandidate,
              catalogItemId: newCatalogItemId,
              createdById: ctx.user.id,
            });
          }

          // 2B-7: نفس قاعدة النشر الآمن لمسار «اعتماد جديد».
          // إذا ظهر تعارض في هوية قائمة، تُلغى المعاملة بما فيها إنشاء الصنف.
          await publishResolvedCatalogIdentity(tx, groupCandidates as any[], newCatalogItemId);

          await tx.insert(catalogAuditLogs).values({
            userId: ctx.user.id,
            action: "approve_item_candidate",
            entityType: "catalog_item_candidate",
            entityId: candidate.id,
            newValues: catalogAuditJson({ catalogItemId: newCatalogItemId, catalogItemCode: generatedCatalogCode, nameAr: input.nameAr, nodeId: input.nodeId }),
          } as any);

          await tx.insert(catalogAuditLogs).values({
            userId: ctx.user.id,
            action: "create",
            entityType: "item",
            entityId: newCatalogItemId,
            newValues: catalogAuditJson(newItemValues),
          } as any);
        });

        return { success: true, catalogItemId: newCatalogItemId, catalogItemCode: generatedCatalogCode };
      }),
  }),

  // ────────────────────────────────────────────────────────
  // CATALOG SETTINGS
  // ────────────────────────────────────────────────────────

  settings: router({
    list: catalogAdminProcedure.query(async () => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      return await db.select().from(catalogSettings);
    }),

    get: catalogAdminProcedure
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

    list: catalogReferenceReadProcedure
      .input(z.object({ includeInactive: z.boolean().optional() }).optional())
      .query(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const role = (ctx as any)?.user?.role;
        const canIncludeInactive = role === APP_ROLE.OWNER || role === APP_ROLE.ADMIN;
        if (input?.includeInactive === true && canIncludeInactive) {
          return db.select().from(catalogUnits).orderBy(asc(catalogUnits.nameAr));
        }
        return db.select().from(catalogUnits)
          .where(eq(catalogUnits.isActive, true))
          .orderBy(asc(catalogUnits.nameAr));
      }),

    create: catalogProcedure
      .input(z.object({
        nameAr: z.string().min(1),
        nameEn: z.string().min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const insertData = {
          nameAr: input.nameAr,
          nameEn: input.nameEn,
          isActive: 1,
        } as any;
        let insertId = 0;
        await (db as any).transaction(async (tx: any) => {
          const result = await tx.insert(catalogUnits).values(insertData);
          insertId = Number((result as any)[0]?.insertId || 0);
          if (!insertId) throw new Error("تعذر تحديد رقم وحدة القياس الجديدة");
          await tx.insert(catalogAuditLogs).values({
            userId: ctx.user.id,
            action: "create",
            entityType: "unit",
            entityId: insertId,
            newValues: catalogAuditJson(insertData),
          } as any);
        });
        return insertId;
      }),

    update: catalogProcedure
      .input(z.object({
        id: z.number(),
        nameAr: z.string().min(1).optional(),
        nameEn: z.string().min(1).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const { id, ...data } = input;
        const existingRows = await db.select().from(catalogUnits).where(eq(catalogUnits.id, id)).limit(1);
        const existing = existingRows[0] as any;
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "وحدة القياس غير موجودة" });
        await (db as any).transaction(async (tx: any) => {
          await tx.update(catalogUnits).set(data).where(eq(catalogUnits.id, id));
          await tx.insert(catalogAuditLogs).values({
            userId: ctx.user.id,
            action: "update",
            entityType: "unit",
            entityId: id,
            oldValues: catalogAuditJson(pickAuditValues(existing, data)),
            newValues: catalogAuditJson(data),
          } as any);
        });
      }),

    delete: catalogAdminProcedure
      .input(z.number())
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const existingRows = await db.select().from(catalogUnits).where(eq(catalogUnits.id, input)).limit(1);
        const existing = existingRows[0] as any;
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "وحدة القياس غير موجودة" });
        if (Number(existing.isActive) !== 1) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "وحدة القياس معطّلة بالفعل" });
        }
        await (db as any).transaction(async (tx: any) => {
          await tx.update(catalogUnits).set({ isActive: 0 } as any).where(eq(catalogUnits.id, input));
          await tx.insert(catalogAuditLogs).values({
            userId: ctx.user.id,
            action: "delete",
            entityType: "unit",
            entityId: input,
            oldValues: catalogAuditJson({ isActive: Boolean(existing.isActive) }),
            newValues: catalogAuditJson({ isActive: false }),
          } as any);
        });
      }),

    reactivate: catalogAdminProcedure
      .input(z.number())
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const existingRows = await db.select().from(catalogUnits).where(eq(catalogUnits.id, input)).limit(1);
        const existing = existingRows[0] as any;
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "وحدة القياس غير موجودة" });
        if (Number(existing.isActive) === 1) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "وحدة القياس نشطة بالفعل" });
        }
        await (db as any).transaction(async (tx: any) => {
          await tx.update(catalogUnits).set({ isActive: 1 } as any).where(eq(catalogUnits.id, input));
          await tx.insert(catalogAuditLogs).values({
            userId: ctx.user.id,
            action: "update",
            entityType: "unit",
            entityId: input,
            oldValues: catalogAuditJson({ isActive: false }),
            newValues: catalogAuditJson({ isActive: true }),
          } as any);
        });
      }),
  }),
// ────────────────────────────────────────────────────────
  // CATALOG SUPPLIERS — إدارة الموردين
  // ────────────────────────────────────────────────────────
  suppliers: router({

    // 2B-2: مطابقة هجينة — AI/OCR يستخرج الاسم والرقم الضريبي، ثم
    // قواعد deterministic تبحث في Supplier Master وAliases، والمستخدم يؤكد.
    match: catalogReadProcedure
      .input(z.object({
        query: z.string().optional(),
        taxNumber: z.string().optional(),
        limit: z.number().min(1).max(10).default(5),
      }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        const suppliers = await db
          .select()
          .from(catalogSuppliers)
          .where(eq(catalogSuppliers.isActive, true));

        const aliases = await db.select().from(catalogSupplierAliases);
        const aliasesBySupplier = new Map<number, string[]>();
        for (const alias of aliases as any[]) {
          const list = aliasesBySupplier.get(alias.supplierId) || [];
          list.push(alias.aliasName);
          aliasesBySupplier.set(alias.supplierId, list);
        }

        return matchSuppliers(
          (suppliers as any[]).map(s => ({
            id: s.id,
            nameAr: s.nameAr,
            nameEn: s.nameEn,
            taxNumber: s.taxNumber,
            commercialRegistration: s.commercialRegistration,
            aliases: aliasesBySupplier.get(s.id) || [],
          })),
          input.query,
          input.taxNumber,
          input.limit,
        );
      }),

    // قائمة جميع الموردين
    list: catalogProcedure
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
    getById: catalogProcedure
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
    create: catalogProcedure
      .input(z.object({
        nameAr:         z.string().min(1, "الاسم بالعربية مطلوب"),
        nameEn:         z.string().min(1, "الاسم بالإنجليزية مطلوب"),
        contactName:    z.string().optional(),
        phone:          z.string().optional(),
        email:          z.string().email("البريد الإلكتروني غير صحيح").optional().or(z.literal("")),
        address:        z.string().optional(),
        taxNumber:      z.string().optional(),
        commercialRegistration: z.string().optional(),
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

        const insertData = {
          nameAr:         input.nameAr.trim(),
          nameEn:         input.nameEn.trim(),
          contactName:    input.contactName?.trim() || null,
          phone:          input.phone?.trim()       || null,
          email:          input.email?.trim()       || null,
          address:        input.address?.trim()     || null,
          taxNumber:      input.taxNumber?.trim()   || null,
          commercialRegistration: input.commercialRegistration?.trim() || null,
          country:        input.country?.trim()     || null,
          notes:          input.notes?.trim()       || null,
          isManufacturer: input.isManufacturer ?? false,
          isActive:       1,
        } as any;

        let newId = 0;
        await (db as any).transaction(async (tx: any) => {
          const result = await tx.insert(catalogSuppliers).values(insertData);
          newId = Number((result as any)[0]?.insertId || 0);
          if (!newId) throw new Error("تعذر تحديد رقم المورد الجديد");
          await tx.insert(catalogAuditLogs).values({
            userId:     ctx.user.id,
            action:     "create",
            entityType: "supplier",
            entityId:   newId,
            newValues:  catalogAuditJson(insertData),
          } as any);
        });

        return newId;
      }),

    // تعديل مورد
    update: catalogProcedure
      .input(z.object({
        id:             z.number(),
        nameAr:         z.string().min(1).optional(),
        nameEn:         z.string().min(1).optional(),
        contactName:    z.string().optional(),
        phone:          z.string().optional(),
        email:          z.string().email().optional().or(z.literal("")),
        address:        z.string().optional(),
        taxNumber:      z.string().optional(),
        commercialRegistration: z.string().optional(),
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
        if (data.taxNumber      !== undefined) updateData.taxNumber      = data.taxNumber?.trim()   || null;
        if (data.commercialRegistration !== undefined) updateData.commercialRegistration = data.commercialRegistration?.trim() || null;
        if (data.country        !== undefined) updateData.country        = data.country?.trim()     || null;
        if (data.notes          !== undefined) updateData.notes          = data.notes?.trim()       || null;
        if (data.isManufacturer !== undefined) updateData.isManufacturer = data.isManufacturer;
        if (data.isActive       !== undefined) updateData.isActive       = data.isActive;

        const existingRows = await db.select().from(catalogSuppliers).where(eq(catalogSuppliers.id, id)).limit(1);
        const existing = existingRows[0] as any;
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "المورد غير موجود" });

        await (db as any).transaction(async (tx: any) => {
          await tx
            .update(catalogSuppliers)
            .set(updateData)
            .where(eq(catalogSuppliers.id, id));
          await tx.insert(catalogAuditLogs).values({
            userId:     ctx.user.id,
            action:     "update",
            entityType: "supplier",
            entityId:   id,
            oldValues:  catalogAuditJson(pickAuditValues(existing, updateData)),
            newValues:  catalogAuditJson(updateData),
          } as any);
        });

        return { success: true };
      }),

    // 2B-2: الموردون الذين تم تعليمهم "مورد جديد" أثناء إدخال الفاتورة.
    candidates: router({
      listPending: catalogProcedure.query(async () => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        return await db
          .select()
          .from(catalogSupplierCandidates)
          .where(eq(catalogSupplierCandidates.status, "pending"))
          .orderBy(desc(catalogSupplierCandidates.createdAt));
      }),

      linkExisting: catalogProcedure
        .input(z.object({ candidateId: z.number(), supplierId: z.number() }))
        .mutation(async ({ input, ctx }) => {
          const db = await getDb();
          if (!db) throw new Error("Database unavailable");

          const candidateRows = await db.select().from(catalogSupplierCandidates)
            .where(eq(catalogSupplierCandidates.id, input.candidateId)).limit(1);
          const candidate = candidateRows[0] as any;
          if (!candidate || candidate.status !== "pending") {
            throw new TRPCError({ code: "NOT_FOUND", message: "مرشح المورد غير موجود أو تمت معالجته" });
          }

          const supplierRows = await db.select().from(catalogSuppliers)
            .where(and(eq(catalogSuppliers.id, input.supplierId), eq(catalogSuppliers.isActive, true))).limit(1);
          const supplier = supplierRows[0] as any;
          if (!supplier) throw new TRPCError({ code: "NOT_FOUND", message: "المورد المختار غير موجود" });

          const now = new Date();
          await (db as any).transaction(async (tx: any) => {
            await tx.update(catalogSupplierCandidates).set({
              status: "linked_existing",
              resolvedSupplierId: supplier.id,
              resolvedById: ctx.user.id,
              resolvedAt: now,
            } as any).where(eq(catalogSupplierCandidates.id, candidate.id));

            if (candidate.receiptId) {
              await tx.update(warehouseReceipts).set({ catalogSupplierId: supplier.id } as any)
                .where(eq(warehouseReceipts.id, candidate.receiptId));
            }

            const normalizedAlias = normalizeSupplierName(candidate.extractedName);
            if (normalizedAlias) {
              const existingAlias = await tx.select({ id: catalogSupplierAliases.id })
                .from(catalogSupplierAliases)
                .where(and(
                  eq(catalogSupplierAliases.supplierId, supplier.id),
                  eq(catalogSupplierAliases.normalizedAlias, normalizedAlias),
                )).limit(1);
              if (existingAlias.length === 0 && normalizeSupplierName(supplier.nameAr) !== normalizedAlias) {
                const aliasResult = await tx.insert(catalogSupplierAliases).values({
                  supplierId: supplier.id,
                  aliasName: candidate.extractedName,
                  normalizedAlias,
                  source: "invoice",
                  createdById: ctx.user.id,
                } as any);
                const aliasId = Number((aliasResult as any)[0]?.insertId || 0) || undefined;
                await tx.insert(catalogAuditLogs).values({
                  userId: ctx.user.id,
                  action: "create_supplier_alias",
                  entityType: "supplier_alias",
                  entityId: aliasId,
                  newValues: catalogAuditJson({ supplierId: supplier.id, aliasName: candidate.extractedName, source: "invoice" }),
                  ...catalogAuditRequestMeta(ctx),
                } as any);
              }
            }

            await tx.insert(catalogAuditLogs).values({
              userId: ctx.user.id,
              action: "link_supplier_candidate",
              entityType: "supplier_candidate",
              entityId: candidate.id,
              newValues: catalogAuditJson({ supplierId: supplier.id }),
            } as any);
          });

          return { success: true, supplierId: supplier.id };
        }),

      approveNew: catalogProcedure
        .input(z.object({
          candidateId: z.number(),
          nameAr: z.string().min(1),
          nameEn: z.string().min(1),
          taxNumber: z.string().optional(),
          commercialRegistration: z.string().optional(),
          contactName: z.string().optional(),
          phone: z.string().optional(),
          email: z.string().email().optional().or(z.literal("")),
          address: z.string().optional(),
          country: z.string().optional(),
          notes: z.string().optional(),
        }))
        .mutation(async ({ input, ctx }) => {
          const db = await getDb();
          if (!db) throw new Error("Database unavailable");

          const candidateRows = await db.select().from(catalogSupplierCandidates)
            .where(eq(catalogSupplierCandidates.id, input.candidateId)).limit(1);
          const candidate = candidateRows[0] as any;
          if (!candidate || candidate.status !== "pending") {
            throw new TRPCError({ code: "NOT_FOUND", message: "مرشح المورد غير موجود أو تمت معالجته" });
          }

          const duplicate = await db.select({ id: catalogSuppliers.id }).from(catalogSuppliers)
            .where(eq(catalogSuppliers.nameAr, input.nameAr.trim())).limit(1);
          if (duplicate.length > 0) {
            throw new TRPCError({ code: "CONFLICT", message: "يوجد مورد بنفس الاسم؛ اربط المرشح بالمورد الموجود بدلاً من إنشاء مورد جديد" });
          }

          let newSupplierId = 0;
          await (db as any).transaction(async (tx: any) => {
            const newSupplierValues = {
              nameAr: input.nameAr.trim(),
              nameEn: input.nameEn.trim(),
              taxNumber: input.taxNumber?.trim() || candidate.taxNumber || null,
              commercialRegistration: input.commercialRegistration?.trim() || null,
              contactName: input.contactName?.trim() || null,
              phone: input.phone?.trim() || null,
              email: input.email?.trim() || null,
              address: input.address?.trim() || null,
              country: input.country?.trim() || null,
              notes: input.notes?.trim() || null,
              isManufacturer: 0,
              isActive: 1,
            } as any;
            const result = await tx.insert(catalogSuppliers).values(newSupplierValues);
            newSupplierId = Number((result as any)[0]?.insertId || 0);
            if (!newSupplierId) throw new Error("تعذر تحديد رقم المورد الجديد");

            await tx.update(catalogSupplierCandidates).set({
              status: "approved_new",
              resolvedSupplierId: newSupplierId,
              resolvedById: ctx.user.id,
              resolvedAt: new Date(),
            } as any).where(eq(catalogSupplierCandidates.id, candidate.id));

            if (candidate.receiptId) {
              await tx.update(warehouseReceipts).set({ catalogSupplierId: newSupplierId } as any)
                .where(eq(warehouseReceipts.id, candidate.receiptId));
            }

            const aliasNormalized = normalizeSupplierName(candidate.extractedName);
            if (aliasNormalized && aliasNormalized !== normalizeSupplierName(input.nameAr)) {
              const aliasResult = await tx.insert(catalogSupplierAliases).values({
                supplierId: newSupplierId,
                aliasName: candidate.extractedName,
                normalizedAlias: aliasNormalized,
                source: "invoice",
                createdById: ctx.user.id,
              } as any);
              const aliasId = Number((aliasResult as any)[0]?.insertId || 0) || undefined;
              await tx.insert(catalogAuditLogs).values({
                userId: ctx.user.id,
                action: "create_supplier_alias",
                entityType: "supplier_alias",
                entityId: aliasId,
                newValues: catalogAuditJson({ supplierId: newSupplierId, aliasName: candidate.extractedName, source: "invoice" }),
                ...catalogAuditRequestMeta(ctx),
              } as any);
            }

            await tx.insert(catalogAuditLogs).values({
              userId: ctx.user.id,
              action: "approve_supplier_candidate",
              entityType: "supplier_candidate",
              entityId: candidate.id,
              newValues: catalogAuditJson({ supplierId: newSupplierId, nameAr: input.nameAr }),
            } as any);

            await tx.insert(catalogAuditLogs).values({
              userId: ctx.user.id,
              action: "create",
              entityType: "supplier",
              entityId: newSupplierId,
              newValues: catalogAuditJson(newSupplierValues),
            } as any);
          });

          return { success: true, supplierId: newSupplierId };
        }),
    }),

    // حذف منطقي
    delete: catalogProcedure
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

        const existingRows = await db.select().from(catalogSuppliers).where(eq(catalogSuppliers.id, id)).limit(1);
        const existing = existingRows[0] as any;
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "المورد غير موجود" });

        await (db as any).transaction(async (tx: any) => {
          await tx
            .update(catalogSuppliers)
            .set({ isActive: 0 } as any)
            .where(eq(catalogSuppliers.id, id));
          await tx.insert(catalogAuditLogs).values({
            userId:     ctx.user.id,
            action:     "delete",
            entityType: "supplier",
            entityId:   id,
            oldValues:  catalogAuditJson({ isActive: Boolean(existing.isActive) }),
            newValues:  catalogAuditJson({ isActive: false }),
          } as any);
        });

        return { success: true };
      }),

    // إحصائيات للـ Dashboard
    stats: catalogProcedure.query(async () => {
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

    // 2B-3: مطابقة أصناف الفاتورة مع Catalog Item.
    // نبحث أولاً في ذاكرة المورد (Alias/SKU)، ثم الكتالوج العام،
    // ونستدعي AI فقط للحالات الدلالية الملتبسة. تعارض المقاس المحسوب
    // خوارزمياً لا يمكن للـAI تجاوزه ولا يؤدي إلى ربط تلقائي.
    matchInvoiceItems: catalogReadProcedure
      .input(z.object({
        supplierId: z.number().optional(),
        items: z.array(z.object({
          itemName: z.string().min(1),
          itemNameEn: z.string().optional(),
          supplierItemCode: z.string().optional(),
          unit: z.string().optional(),
        })).min(1).max(100),
        limitPerItem: z.number().min(1).max(8).default(5),
        useAiFallback: z.boolean().default(true),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        if (input.supplierId) {
          const supplier = await db.select({ id: catalogSuppliers.id })
            .from(catalogSuppliers)
            .where(and(eq(catalogSuppliers.id, input.supplierId), eq(catalogSuppliers.isActive, true)))
            .limit(1);
          if (supplier.length === 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "المورد المركزي غير موجود أو غير نشط" });
          }
        }

        const catalogRows = await db.select({
          id: catalogItems.id,
          code: catalogItems.code,
          nameAr: catalogItems.nameAr,
          nameEn: catalogItems.nameEn,
          unit: catalogItems.unit,
          manufacturer: catalogItems.manufacturer,
        }).from(catalogItems).where(eq(catalogItems.isActive, true));

        const supplierAliases = input.supplierId
          ? await db.select().from(catalogSupplierItemAliases).where(and(
              eq(catalogSupplierItemAliases.supplierId, input.supplierId),
              eq(catalogSupplierItemAliases.isActive, true),
            ))
          : [];

        const results = [];
        const aiUsageEvents: CatalogAiUsageEvent[] = [];
        let deterministicBypassCount = 0;
        let aiEligibleCount = 0;
        let aiBudgetSkippedCount = 0;
        // حد تكلفة: AI fallback للحالات الملتبسة فقط وبحد أقصى 5 أسطر في الفاتورة الواحدة.
        // بقية الأسطر تبقى على نتيجة الخوارزمية ويمكن للمستخدم تأكيدها يدوياً.
        let aiFallbackBudget = 5;
        for (const item of input.items) {
          let matches = rankCatalogItemMatches({
            query: item,
            catalogItems: catalogRows as any[],
            supplierAliases: supplierAliases as any[],
            limit: input.limitPerItem,
          });

          const top = matches[0];
          const strongDeterministic = !!top && (
            top.reason === "supplier_code_exact" ||
            top.reason === "supplier_alias_exact" ||
            top.score >= 92
          );
          // إذا لم توجد ذاكرة مورد/مطابقة حتمية قوية، يبني السيرفر Shortlist
          // محلية سريعة من الكتالوج ثم يستخدم DeepSeek فقط لترتيبها دلالياً.
          // إذا كانت إشارة البحث المحلي شبه معدومة، يسمح بطلب صغير إضافي لتوليد
          // مرادفات بحث ثم يعيد بناء الـShortlist؛ لا يتم إرسال الكتالوج على دفعات.
          const needsAiSemanticDiscovery = !strongDeterministic;
          if (strongDeterministic) deterministicBypassCount++;
          if (needsAiSemanticDiscovery) aiEligibleCount++;

          if (input.useAiFallback && aiFallbackBudget > 0 && needsAiSemanticDiscovery) {
            aiFallbackBudget--;
            matches = await applyAiSemanticDiscovery({
              query: item,
              catalogItems: catalogRows as any[],
              deterministicCandidates: matches,
              limit: input.limitPerItem,
              reportUsage: event => aiUsageEvents.push(event),
            });
          } else if (input.useAiFallback && needsAiSemanticDiscovery && aiFallbackBudget <= 0) {
            aiBudgetSkippedCount++;
          }

          results.push({
            query: item,
            matches,
            autoSelectedCatalogItemId: matches.find(match => match.autoSelect)?.catalogItemId ?? null,
          });
        }

        // Zero-quality-loss instrumentation: one compact Catalog audit row per matching
        // request, not one row per DeepSeek call. This keeps the audit table usable while
        // still preserving exact per-call token/cache details in newValues.events.
        try {
          const deepSeekCalls = aiUsageEvents.filter(event => event.source === "deepseek");
          const memoryCacheHits = aiUsageEvents.filter(event => event.source === "memory_cache").length;
          const persistentCacheHits = aiUsageEvents.filter(event => event.source === "persistent_cache").length;
          const inFlightDedupeHits = aiUsageEvents.filter(event => event.source === "inflight_dedupe").length;
          const totals = deepSeekCalls.reduce((sum, event) => ({
            promptTokens: sum.promptTokens + event.promptTokens,
            completionTokens: sum.completionTokens + event.completionTokens,
            totalTokens: sum.totalTokens + event.totalTokens,
            promptCacheHitTokens: sum.promptCacheHitTokens + event.promptCacheHitTokens,
            promptCacheMissTokens: sum.promptCacheMissTokens + event.promptCacheMissTokens,
            durationMs: sum.durationMs + event.durationMs,
          }), {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            promptCacheHitTokens: 0,
            promptCacheMissTokens: 0,
            durationMs: 0,
          });

          await db.insert(catalogAuditLogs).values({
            userId: ctx.user.id,
            action: "ai_catalog_match_usage",
            entityType: "catalog_ai_matching",
            newValues: catalogAuditJson({
              feature: "catalog_invoice_matching",
              itemCount: input.items.length,
              deterministicBypassCount,
              aiEligibleCount,
              aiBudgetSkippedCount,
              deepSeekCallCount: deepSeekCalls.length,
              memoryCacheHits,
              persistentCacheHits,
              inFlightDedupeHits,
              ...totals,
              events: aiUsageEvents,
            }),
          } as any);
        } catch (error) {
          // Usage telemetry must never break invoice matching.
          console.warn("[CatalogItemMatch] Could not persist AI usage telemetry", error);
        }

        return results;
      }),

    listByItem: catalogProcedure
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

    assign: catalogProcedure
      .input(z.object({
        itemId:           z.number(),
        supplierId:       z.number(),
        supplierItemCode: z.string().optional(),
        price:            z.number().min(0),
        currency:         z.string().default("SAR"),
        isPreferred:      z.boolean().optional().default(false),
        notes:            z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        const itemRows = await db.select({ id: catalogItems.id, code: catalogItems.code, nameAr: catalogItems.nameAr })
          .from(catalogItems).where(eq(catalogItems.id, input.itemId)).limit(1);
        const supplierRows = await db.select({ id: catalogSuppliers.id, nameAr: catalogSuppliers.nameAr })
          .from(catalogSuppliers).where(eq(catalogSuppliers.id, input.supplierId)).limit(1);
        const itemSnapshot = itemRows[0] as any;
        const supplierSnapshot = supplierRows[0] as any;

        let resultId = 0;
        let resultAction: "created" | "updated" = "created";

        await (db as any).transaction(async (tx: any) => {
          const existingRows = await tx.select().from(catalogSupplierPrices).where(and(
            eq(catalogSupplierPrices.itemId, input.itemId),
            eq(catalogSupplierPrices.supplierId, input.supplierId),
          )).limit(1);
          const existing = existingRows[0] as any;

          // If a different supplier was preferred, record every implicit preference
          // change as its own catalog movement instead of silently clearing it.
          if (input.isPreferred) {
            const preferredRows = await tx.select().from(catalogSupplierPrices).where(and(
              eq(catalogSupplierPrices.itemId, input.itemId),
              eq(catalogSupplierPrices.isPreferred, true),
            ));
            for (const row of preferredRows as any[]) {
              if (existing && Number(row.id) === Number(existing.id)) continue;
              await tx.update(catalogSupplierPrices).set({ isPreferred: false } as any)
                .where(eq(catalogSupplierPrices.id, row.id));
              await tx.insert(catalogAuditLogs).values({
                userId: ctx.user.id,
                action: "unset_preferred_supplier",
                entityType: "item_supplier",
                entityId: row.id,
                oldValues: catalogAuditJson({ itemId: row.itemId, supplierId: row.supplierId, isPreferred: true }),
                newValues: catalogAuditJson({ itemId: row.itemId, supplierId: row.supplierId, isPreferred: false }),
                ...catalogAuditRequestMeta(ctx),
              } as any);
            }
          }

          const nextValues = {
            itemId:           input.itemId,
            supplierId:       input.supplierId,
            supplierItemCode: input.supplierItemCode?.trim() || null,
            price:            String(input.price),
            currency:         input.currency,
            isPreferred:      input.isPreferred ?? false,
            notes:            input.notes?.trim() || null,
            isActive:         1,
          } as any;

          if (existing) {
            resultId = Number(existing.id);
            resultAction = "updated";
            await tx.update(catalogSupplierPrices).set(nextValues).where(eq(catalogSupplierPrices.id, existing.id));
            await tx.insert(catalogAuditLogs).values({
              userId: ctx.user.id,
              action: Number(existing.isActive) === 1 ? "update_item_supplier_link" : "restore_item_supplier_link",
              entityType: "item_supplier",
              entityId: existing.id,
              oldValues: catalogAuditJson({
                itemId: existing.itemId,
                supplierId: existing.supplierId,
                supplierItemCode: existing.supplierItemCode,
                price: existing.price,
                currency: existing.currency,
                isPreferred: Boolean(existing.isPreferred),
                notes: existing.notes,
                isActive: Boolean(existing.isActive),
              }),
              newValues: catalogAuditJson({
                ...nextValues,
                itemCode: itemSnapshot?.code || null,
                itemNameAr: itemSnapshot?.nameAr || null,
                supplierNameAr: supplierSnapshot?.nameAr || null,
              }),
              ...catalogAuditRequestMeta(ctx),
            } as any);
          } else {
            const insertResult = await tx.insert(catalogSupplierPrices).values(nextValues);
            resultId = Number((insertResult as any)[0]?.insertId || 0);
            if (!resultId) throw new Error("تعذر تحديد رقم ربط المورد بالصنف");
            await tx.insert(catalogAuditLogs).values({
              userId: ctx.user.id,
              action: "assign_supplier_to_item",
              entityType: "item_supplier",
              entityId: resultId,
              newValues: catalogAuditJson({
                ...nextValues,
                itemCode: itemSnapshot?.code || null,
                itemNameAr: itemSnapshot?.nameAr || null,
                supplierNameAr: supplierSnapshot?.nameAr || null,
              }),
              ...catalogAuditRequestMeta(ctx),
            } as any);
          }
        });

        return { id: resultId, action: resultAction };
      }),

    remove: catalogProcedure
      .input(z.object({
        itemId:     z.number(),
        supplierId: z.number(),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        const existingRows = await db.select().from(catalogSupplierPrices).where(and(
          eq(catalogSupplierPrices.itemId, input.itemId),
          eq(catalogSupplierPrices.supplierId, input.supplierId),
        )).limit(1);
        const existing = existingRows[0] as any;
        if (!existing || Number(existing.isActive) !== 1) return { success: true };

        await (db as any).transaction(async (tx: any) => {
          await tx.update(catalogSupplierPrices).set({ isActive: 0 } as any)
            .where(eq(catalogSupplierPrices.id, existing.id));
          await tx.insert(catalogAuditLogs).values({
            userId: ctx.user.id,
            action: "remove_supplier_from_item",
            entityType: "item_supplier",
            entityId: existing.id,
            oldValues: catalogAuditJson({
              itemId: existing.itemId,
              supplierId: existing.supplierId,
              supplierItemCode: existing.supplierItemCode,
              price: existing.price,
              currency: existing.currency,
              isPreferred: Boolean(existing.isPreferred),
              notes: existing.notes,
              isActive: true,
            }),
            newValues: catalogAuditJson({ itemId: existing.itemId, supplierId: existing.supplierId, isActive: false }),
            ...catalogAuditRequestMeta(ctx),
          } as any);
        });

        return { success: true };
      }),

    setPreferred: catalogProcedure
      .input(z.object({
        itemId:     z.number(),
        supplierId: z.number(),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");

        await (db as any).transaction(async (tx: any) => {
          const itemSupplierRows = await tx.select().from(catalogSupplierPrices)
            .where(eq(catalogSupplierPrices.itemId, input.itemId));

          for (const row of itemSupplierRows as any[]) {
            const shouldBePreferred = Number(row.supplierId) === Number(input.supplierId);
            const wasPreferred = Boolean(row.isPreferred);
            if (wasPreferred === shouldBePreferred) continue;

            await tx.update(catalogSupplierPrices).set({ isPreferred: shouldBePreferred } as any)
              .where(eq(catalogSupplierPrices.id, row.id));
            await tx.insert(catalogAuditLogs).values({
              userId: ctx.user.id,
              action: shouldBePreferred ? "set_preferred_supplier" : "unset_preferred_supplier",
              entityType: "item_supplier",
              entityId: row.id,
              oldValues: catalogAuditJson({ itemId: row.itemId, supplierId: row.supplierId, isPreferred: wasPreferred }),
              newValues: catalogAuditJson({ itemId: row.itemId, supplierId: row.supplierId, isPreferred: shouldBePreferred }),
              ...catalogAuditRequestMeta(ctx),
            } as any);
          }
        });

        return { success: true };
      }),
  }),
});
