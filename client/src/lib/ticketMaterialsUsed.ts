/** Format the existing team-material snapshot without changing stored values. */
export function formatTicketMaterialsUsed(
  original: string | null | undefined,
  translated?: string | null,
  unspecifiedQuantity = "—",
  language: "ar" | "en" | "ur" = "ar",
): string {
  if (!original?.trim()) return "";

  try {
    const materials: unknown = JSON.parse(original);
    if (Array.isArray(materials) && materials.length === 0) return "";
    if (
      Array.isArray(materials) && materials.length > 0 &&
      materials.every((material) => material && typeof material === "object" &&
        typeof material.name === "string" && material.name.trim().length > 0)
    ) {
      // Names, units and quantities come from the original snapshot. A prose
      // translation of JSON must never replace or recalculate the usage values.
      return materials.map((material) => {
        const actual = material.actualDeliveries;
        if (Array.isArray(actual) && actual.length > 0 && actual.every(delivery =>
          delivery && typeof delivery.itemName === "string" && delivery.itemName.trim() && typeof delivery.unit === "string")) {
          const labels = language === "en" ? { original: "Original need", used: "Used", returned: "Returned" }
            : language === "ur" ? { original: "اصل ضرورت", used: "استعمال شدہ", returned: "واپس کردہ" }
            : { original: "الاحتياج الأصلي", used: "المستخدم", returned: "المرتجع" };
          const requested = typeof material.requested === "number" && Number.isFinite(material.requested)
            ? ` (${material.requested} ${typeof material.unit === "string" ? material.unit.trim() : ""})` : "";
          return [`${labels.original}: ${material.name.trim()}${requested}`, ...actual.map(delivery => {
            const used = typeof delivery.used === "number" && Number.isFinite(delivery.used) && delivery.used >= 0
              ? `${delivery.used} ${delivery.unit.trim()}` : unspecifiedQuantity;
            const returned = typeof delivery.returned === "number" && Number.isFinite(delivery.returned) && delivery.returned >= 0
              ? ` · ${labels.returned}: ${delivery.returned} ${delivery.unit.trim()}` : "";
            return `${delivery.itemName.trim()} — ${labels.used}: ${used}${returned}`;
          })].join("\n");
        }
        const used = material.used;
        const unit = typeof material.unit === "string" ? material.unit.trim() : "";
        const quantity = typeof used === "number" && Number.isFinite(used) && used >= 0
          ? `${used}${unit ? ` ${unit}` : ""}`
          : unspecifiedQuantity;
        return `${material.name.trim()} — ${quantity}`;
      }).join("\n");
    }
  } catch {
    // Legacy tickets hold free text rather than a structured materials list.
  }

  return translated?.trim() ? translated : original;
}
