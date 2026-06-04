import ExcelJS from "exceljs";
import * as schema from "../../../drizzle/schema";
import { eq } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export interface ParsedNode {
  code:       string;
  parentCode: string;
  nameAr:     string;
  nameEn:     string;
  level:      number;
}

export interface ParsedItem {
  code:         string;
  nodeCode:     string;
  nameAr:       string;
  nameEn:       string;
  unit:         string;
  manufacturer: string;
}

export interface ParsedCatalog {
  taxonomyNodes: ParsedNode[];
  items:         ParsedItem[];
}

// ─────────────────────────────────────────────────────────────────────────
// parseCatalogImportFile
// قراءة ملف Excel وتحويله إلى كائنات
// ─────────────────────────────────────────────────────────────────────────

export async function parseCatalogImportFile(
  fileBase64: string
): Promise<ParsedCatalog> {

  const workbook = new ExcelJS.Workbook();
  const buffer   = Buffer.from(fileBase64, "base64");
  await workbook.xlsx.load(buffer as any);

  // ── Taxonomy ──────────────────────────────────────────────

  const taxonomySheet = workbook.getWorksheet("taxonomy_nodes");
  const taxonomyNodes: ParsedNode[] = [];

  if (taxonomySheet) {
    taxonomySheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // تخطي الرأس

      const code = row.getCell(1).value?.toString().trim() ?? "";
      if (!code) return; // تخطي الصفوف الفارغة

      taxonomyNodes.push({
        code,
        parentCode: row.getCell(2).value?.toString().trim() ?? "",
        nameAr:     row.getCell(3).value?.toString().trim() ?? "",
        nameEn:     row.getCell(4).value?.toString().trim() ?? "",
        level:      Number(row.getCell(5).value) || code.length,
      });
    });
  }

  // ── Items ─────────────────────────────────────────────────

  const itemsSheet = workbook.getWorksheet("catalog_items");
  const items: ParsedItem[] = [];

  if (itemsSheet) {
    itemsSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const code = row.getCell(1).value?.toString().trim() ?? "";
      if (!code) return;

      items.push({
        code,
        nodeCode:     row.getCell(2).value?.toString().trim() ?? "",
        nameAr:       row.getCell(3).value?.toString().trim() ?? "",
        nameEn:       row.getCell(4).value?.toString().trim() ?? "",
        unit:         row.getCell(5).value?.toString().trim() ?? "",
        manufacturer: row.getCell(6).value?.toString().trim() ?? "",
      });
    });
  }

  return { taxonomyNodes, items };
}

// ─────────────────────────────────────────────────────────────────────────
// commitCatalogImport
// كتابة البيانات في قاعدة البيانات (upsert حقيقي)
// ─────────────────────────────────────────────────────────────────────────

export async function commitCatalogImport(
  db:     any,
  parsed: ParsedCatalog
): Promise<{ success: boolean; taxonomyCount: number; itemsCount: number }> {

  // ── 1. ترتيب النودز: الآباء أولاً (أقصر كود = أعلى مستوى) ───────────────

  const sortedNodes = [...parsed.taxonomyNodes].sort(
    (a, b) => a.code.length - b.code.length
  );

  // ── 2. upsert التصنيفات (بدون parent أولاً) ──────────────────────────────

  // map من code → id لاستخدامه لاحقاً
  const codeToId = new Map<string, number>();

  // أولاً: اجلب التصنيفات الموجودة حالياً
  const existingNodes: any[] = await db
    .select()
    .from(schema.catalogNodes);

  existingNodes.forEach((n: any) => {
    if (n.code) codeToId.set(n.code, n.id);
  });

  for (const node of sortedNodes) {

    if (codeToId.has(node.code)) {
      // تحديث الموجود
      await db
        .update(schema.catalogNodes)
        .set({
          nameAr: node.nameAr,
          nameEn: node.nameEn,
          level:  node.level,
        })
        .where(eq(schema.catalogNodes.code, node.code));

    } else {
      // إدراج جديد بدون parentId أولاً
      const result = await db
        .insert(schema.catalogNodes)
        .values({
          code:     node.code,
          nameAr:   node.nameAr,
          nameEn:   node.nameEn,
          level:    node.level,
          isActive: 1,
        });

      // استخرج الـ id المُولَّد
      const insertId =
        result[0]?.insertId ??
        result?.insertId   ??
        result[0]?.id;

      if (insertId) {
        codeToId.set(node.code, insertId);
      } else {
        // fallback: اقرأ من DB
        const fresh: any[] = await db
          .select()
          .from(schema.catalogNodes)
          .where(eq(schema.catalogNodes.code, node.code))
          .limit(1);
        if (fresh[0]) codeToId.set(node.code, fresh[0].id);
      }
    }
  }

  // ── 3. ربط الـ parentId بعد ما صارت كل النودز موجودة ────────────────────

  for (const node of sortedNodes) {
    if (!node.parentCode) continue;

    const parentId = codeToId.get(node.parentCode);
    if (!parentId) continue;

    await db
      .update(schema.catalogNodes)
      .set({ parentId })
      .where(eq(schema.catalogNodes.code, node.code));
  }

  // ── 4. upsert الأصناف ─────────────────────────────────────────────────────

  let itemsCount = 0;

  for (const item of parsed.items) {

    const nodeId = codeToId.get(item.nodeCode);

    if (!nodeId) {
      // التصنيف غير موجود، تخطي هذا الصنف
      console.warn(`SKIP item ${item.code}: nodeCode "${item.nodeCode}" not found`);
      continue;
    }

    const existing: any[] = await db
      .select()
      .from(schema.catalogItems)
      .where(eq(schema.catalogItems.code, item.code))
      .limit(1);

    if (existing.length > 0) {
      // تحديث
      await db
        .update(schema.catalogItems)
        .set({
          nameAr:       item.nameAr,
          nameEn:       item.nameEn,
          unit:         item.unit        || null,
          manufacturer: item.manufacturer || null,
          nodeId,
        })
        .where(eq(schema.catalogItems.code, item.code));
    } else {
      // إدراج جديد
      await db
        .insert(schema.catalogItems)
        .values({
          code:         item.code,
          nameAr:       item.nameAr,
          nameEn:       item.nameEn,
          unit:         item.unit        || null,
          manufacturer: item.manufacturer || null,
          nodeId,
          isActive:     1,
        });
    }

    itemsCount++;
  }

  return {
    success:       true,
    taxonomyCount: sortedNodes.length,
    itemsCount,
  };
}
