type Values = Record<string, unknown>;

const fields = [
  ["itemName", "اسم الصنف"],
  ["description", "المواصفات"],
  ["quantity", "الكمية"],
  ["unit", "الوحدة"],
  ["photoUrl", "الصورة"],
  ["notes", "الملاحظات"],
  ["estimatedUnitCost", "السعر التقديري للوحدة"],
  ["estimatedTotalCost", "الإجمالي التقديري"],
] as const;
const numbers = new Set(["quantity", "estimatedUnitCost", "estimatedTotalCost"]);
const text = (value: unknown) => value == null ? "" : String(value).replace(/\r\n/g, "\n");

function comparable(field: string, value: unknown) {
  const raw = text(value);
  if (!numbers.has(field)) return raw;
  // Compare persisted decimal strings without floating-point rounding; 2 and
  // 2.000 mean the same quantity, while an empty price remains different from 0.
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw.trim());
  if (!match) return raw;
  const whole = match[2].replace(/^0+(?=\d)/, "");
  const fraction = (match[3] || "").replace(/0+$/, "");
  const sign = whole === "0" && !fraction ? "" : match[1];
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** Only fields actually written are compared with the freshly locked item. */
export function buildItemRevisionComment(before: Values, updates: Values): string {
  const changes = fields.flatMap(([field, label]) => {
    if (updates[field] === undefined || comparable(field, before[field]) === comparable(field, updates[field])) return [];
    const previous = text(before[field]) || "فارغ";
    const next = text(updates[field]) || "فارغ";
    return [`${label}:\nقبل: «${previous}»\nبعد: «${next}»`];
  });
  return changes.length
    ? `تم حفظ التغييرات التالية وإعادة إرسال الصنف للمندوب للتسعير:\n\n${changes.join("\n\n")}`
    : "أُعيد الإرسال دون تعديل بيانات الصنف.";
}
