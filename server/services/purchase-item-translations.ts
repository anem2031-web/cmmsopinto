import { detectLanguage } from "./translation/translation";
import { queueTranslation } from "./translation/translationEngine";

type TranslatingPurchaseItem = {
  id?: number;
  itemName?: string | null;
  description?: string | null;
  notes?: string | null;
};

export async function queuePOItemsTranslation(
  items: TranslatingPurchaseItem[],
  userId: number
): Promise<void> {
  for (const item of items) {
    if (!item.itemName || !item.id) continue;
    const fields = [
      { fieldName: "itemName", text: item.itemName },
      ...(item.description
        ? [{ fieldName: "description", text: item.description }]
        : []),
      ...(item.notes ? [{ fieldName: "notes", text: item.notes }] : []),
    ];
    queueTranslation({
      entityType: "PO_ITEM",
      entityId: item.id,
      fields,
      sourceLanguage: await detectLanguage(item.itemName).catch(
        () => "ar" as const
      ),
      userId,
    }).catch(e => console.error("[PO_ITEM] Queue translation failed:", e));
  }
}
