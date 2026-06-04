import * as schema from "../../../drizzle/schema";
import ExcelJS from "exceljs";

export async function exportCatalogExcel(db: any): Promise<Buffer> {

  const workbook = new ExcelJS.Workbook();

  // ─────────────────────────────────────────────────────────
  // 1. جلب كل التصنيفات وبناء map (id → code)
  // ─────────────────────────────────────────────────────────

  const allNodes: any[] = await db
    .select()
    .from(schema.catalogNodes);

  // map من id إلى code لحل مشكلة parentCode
  const nodeIdToCode = new Map<number, string>();
  allNodes.forEach((n: any) => {
    if (n.id && n.code) nodeIdToCode.set(n.id, n.code);
  });

  // ─────────────────────────────────────────────────────────
  // 2. ورقة التصنيفات (taxonomy_nodes)
  // ─────────────────────────────────────────────────────────

  const taxonomySheet = workbook.addWorksheet("taxonomy_nodes");

  taxonomySheet.columns = [
    { header: "code",        key: "code",       width: 15 },
    { header: "parent_code", key: "parentCode", width: 15 },
    { header: "name_ar",     key: "nameAr",     width: 40 },
    { header: "name_en",     key: "nameEn",     width: 40 },
    { header: "level",       key: "level",      width: 10 },
  ];

  // ترتيب حسب طول الكود (الآباء قبل الأبناء)
  const sortedNodes = [...allNodes].sort((a, b) => {
    const la = (a.code || "").length;
    const lb = (b.code || "").length;
    return la - lb;
  });

  sortedNodes.forEach((node: any) => {
    // parentCode = كود الأب المشتق من الـ id
    const parentCode = node.parentId
      ? (nodeIdToCode.get(node.parentId) ?? "")
      : "";

    taxonomySheet.addRow({
      code:       node.code       ?? "",
      parentCode: parentCode,
      nameAr:     node.nameAr     ?? "",
      nameEn:     node.nameEn     ?? "",
      level:      node.level      ?? 1,
    });
  });

  // تنسيق رأس الجدول
  taxonomySheet.getRow(1).font = { bold: true };
  taxonomySheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD6E4F0" },
  };

  // ─────────────────────────────────────────────────────────
  // 3. جلب الأصناف
  // ─────────────────────────────────────────────────────────

  const allItems: any[] = await db
    .select()
    .from(schema.catalogItems);

  // map من nodeId → node.code
  const nodeIdToCodeForItems = new Map<number, string>();
  allNodes.forEach((n: any) => {
    nodeIdToCodeForItems.set(n.id, n.code ?? "");
  });

  // ─────────────────────────────────────────────────────────
  // 4. ورقة الأصناف (catalog_items)
  // ─────────────────────────────────────────────────────────

  const itemsSheet = workbook.addWorksheet("catalog_items");

  itemsSheet.columns = [
    { header: "code",         key: "code",         width: 20 },
    { header: "node_code",    key: "nodeCode",      width: 15 },
    { header: "name_ar",      key: "nameAr",        width: 40 },
    { header: "name_en",      key: "nameEn",        width: 40 },
    { header: "unit",         key: "unit",          width: 15 },
    { header: "manufacturer", key: "manufacturer",  width: 30 },
  ];

  allItems.forEach((item: any) => {
    // nodeCode = code التصنيف المرتبط بالصنف
    const nodeCode = item.nodeId
      ? (nodeIdToCodeForItems.get(item.nodeId) ?? "")
      : "";

    itemsSheet.addRow({
      code:         item.code         ?? "",
      nodeCode:     nodeCode,
      nameAr:       item.nameAr       ?? "",
      nameEn:       item.nameEn       ?? "",
      unit:         item.unit         ?? "",
      manufacturer: item.manufacturer ?? "",
    });
  });

  itemsSheet.getRow(1).font = { bold: true };
  itemsSheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD6E4F0" },
  };

  // ─────────────────────────────────────────────────────────
  // 5. كتابة الـ buffer وإرجاعه
  // ─────────────────────────────────────────────────────────

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
