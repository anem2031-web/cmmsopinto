import type { ParsedCatalog } from "./catalogImport.service";

export async function validateCatalogImport(
  db:     any,
  parsed: ParsedCatalog
) {

  const errors:   any[] = [];
  const warnings: any[] = [];

  // ── Taxonomy ──────────────────────────────────────────────

  const taxonomyCodes = new Set<string>();

  for (const node of parsed.taxonomyNodes) {

    if (!node.code) {
      errors.push({ type: "taxonomy", message: "كود التصنيف مطلوب" });
      continue;
    }

    if (!node.nameAr) {
      errors.push({ type: "taxonomy", message: `الاسم العربي مطلوب للتصنيف: ${node.code}` });
    }

    if (taxonomyCodes.has(node.code)) {
      errors.push({ type: "taxonomy", message: `كود مكرر في التصنيفات: ${node.code}` });
    }

    taxonomyCodes.add(node.code);

    // تحقق أن الأب موجود في نفس الملف (إذا كان محدداً)
    if (node.parentCode && !taxonomyCodes.has(node.parentCode)) {
      // قد يكون الأب موجوداً في DB، هذا مجرد تحذير
      warnings.push({
        type: "taxonomy",
        message: `كود الأب "${node.parentCode}" للتصنيف "${node.code}" غير موجود في الملف (قد يكون موجوداً في قاعدة البيانات)`,
      });
    }
  }

  // ── Items ─────────────────────────────────────────────────

  const itemCodes = new Set<string>();

  for (const item of parsed.items) {

    if (!item.code) {
      errors.push({ type: "item", message: "كود الصنف مطلوب" });
      continue;
    }

    if (!item.nameAr) {
      errors.push({ type: "item", message: `الاسم العربي مطلوب للصنف: ${item.code}` });
    }

    if (!item.nodeCode) {
      errors.push({ type: "item", message: `كود التصنيف مطلوب للصنف: ${item.code}` });
    }

    if (itemCodes.has(item.code)) {
      errors.push({ type: "item", message: `كود مكرر في الأصناف: ${item.code}` });
    }

    itemCodes.add(item.code);

    // تحذير إذا كان التصنيف غير موجود في الملف
    if (item.nodeCode && !taxonomyCodes.has(item.nodeCode)) {
      warnings.push({
        type: "item",
        message: `التصنيف "${item.nodeCode}" للصنف "${item.code}" غير موجود في الملف`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
