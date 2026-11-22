export type LinkedWork = {
  kind: "ticket" | "pmv2";
  reference: string;
  quantity: number | null;
  unit: string;
  warehouseId: number;
};
export function linkedWorkMessage(links: LinkedWork[]): string {
  const references = links
    .map(
      link =>
        `${link.kind === "ticket" ? "بلاغ الصيانة" : "مهمة PMV2"} ${link.reference}${link.quantity == null ? "" : ` (${link.quantity} ${link.unit})`}`
    )
    .join("، ");
  const tabs = Array.from(
    new Set(
      links.map(link => (link.kind === "ticket" ? "تذاكر الصيانة" : "PMV2"))
    )
  ).join(" و ");
  return `لا يمكن إضافة الصنف للصرف التشغيلي. توجد كمية مرتبطة بـ ${references}. يرجى صرف الكمية أولًا من تبويب ${tabs}.`;
}
