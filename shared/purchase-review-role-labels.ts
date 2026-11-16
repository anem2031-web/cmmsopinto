import type { PurchaseReviewRole } from "./purchase-item-review";

export const purchaseReviewRoleLabels: Record<
  "ar" | "en" | "ur",
  Record<PurchaseReviewRole, string>
> = {
  ar: {
    general_maintenance_manager: "الصيانة العامة والتشغيل",
    construction_procurement_manager: "الإنشاءات",
    senior_management: "أخرى — الإدارة العليا",
  },
  en: {
    general_maintenance_manager: "General maintenance and operations",
    construction_procurement_manager: "Construction",
    senior_management: "Other — Senior management",
  },
  ur: {
    general_maintenance_manager: "عمومی دیکھ بھال اور آپریشنز",
    construction_procurement_manager: "تعمیرات",
    senior_management: "دیگر — اعلیٰ انتظامیہ",
  },
};
