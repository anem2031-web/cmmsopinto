/**
 * Unified type exports
 * Import shared types from this single entry point.
 */

export type * from "../drizzle/schema";
export * from "./_core/errors";

// Shared types and constants for CMMS

export const ROLE_LABELS: Record<string, string> = {
  operator: "موظف تشغيل",
  technician: "فني صيانة",
  maintenance_manager: "مدير صيانة",
  purchase_manager: "مسؤول طلبات شراء",
  delegate: "مندوب مشتريات",
  accountant: "حسابات",
  senior_management: "إدارة عليا",
  warehouse: "مستودع",
  owner: "مالك",
  admin: "مدير النظام",
  user: "مستخدم",
};

export const STATUS_LABELS: Record<string, string> = {
  new: "جديد",
  approved: "معتمد",
  assigned: "مُسند",
  in_progress: "قيد التنفيذ",
  needs_purchase: "يحتاج شراء",
  purchase_pending_estimate: "بانتظار التسعير",
  purchase_pending_accounting: "بانتظار اعتماد الحسابات",
  purchase_pending_management: "بانتظار اعتماد الإدارة",
  purchase_approved: "تم اعتماد الشراء",
  partial_purchase: "شراء جزئي",
  purchased: "تم الشراء",
  received_warehouse: "تم الاستلام من المستودع",
  repaired: "تم الإصلاح",
  verified: "تم التحقق",
  closed: "مغلق",
  requester_confirmed: "تم تأكيد الإنهاء من مقدم الطلب",
};

export const PO_STATUS_LABELS: Record<string, string> = {
  draft: "مسودة",
  pending_estimate: "بانتظار التسعير",
  pending_accounting: "بانتظار اعتماد الحسابات",
  pending_management: "بانتظار اعتماد الإدارة",
  approved: "معتمد",
  partial_purchase: "شراء جزئي",
  purchased: "تم الشراء بالكامل",
  received: "تم الاستلام",
  closed: "مغلق",
  rejected: "مرفوض",
};

export const PO_ITEM_STATUS_LABELS: Record<string, string> = {
  pending: "معلّق",
  estimated: "تم التسعير",
  approved: "معتمد",
  purchased: "تم الشراء",
  received: "تم الاستلام",
};

export const PRIORITY_LABELS: Record<string, string> = {
  low: "منخفضة",
  medium: "متوسطة",
  high: "عالية",
  critical: "حرجة",
};

export const CATEGORY_LABELS: Record<string, string> = {
  electrical: "كهرباء",
  plumbing: "سباكة",
  hvac: "تكييف",
  structural: "إنشائي",
  mechanical: "ميكانيكي",
  general: "عام",
  safety: "سلامة",
  cleaning: "نظافة",
};

export const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-emerald-100 text-emerald-700 border-emerald-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  critical: "bg-red-100 text-red-700 border-red-200",
};

export const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  approved: "bg-indigo-100 text-indigo-700",
  assigned: "bg-violet-100 text-violet-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  needs_purchase: "bg-orange-100 text-orange-700",
  purchase_pending_estimate: "bg-amber-100 text-amber-700",
  purchase_pending_accounting: "bg-amber-100 text-amber-700",
  purchase_pending_management: "bg-amber-100 text-amber-700",
  purchase_approved: "bg-teal-100 text-teal-700",
  partial_purchase: "bg-cyan-100 text-cyan-700",
  purchased: "bg-emerald-100 text-emerald-700",
  received_warehouse: "bg-green-100 text-green-700",
  repaired: "bg-lime-100 text-lime-700",
  verified: "bg-sky-100 text-sky-700",
  closed: "bg-gray-100 text-gray-700",
  requester_confirmed: "bg-emerald-100 text-emerald-700",
};

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  operator: ["create_ticket", "view_own_tickets"],
  technician: ["view_assigned_tickets", "update_ticket_repair", "use_inventory"],
  maintenance_manager: ["view_all_tickets", "approve_ticket", "assign_ticket", "create_purchase_order", "close_ticket"],
  purchase_manager: ["create_purchase_order", "view_purchase_orders", "assign_delegate"],
  delegate: ["view_assigned_items", "estimate_cost", "confirm_purchase", "upload_invoice"],
  accountant: ["approve_accounting", "view_purchase_orders", "view_reports"],
  senior_management: ["approve_management", "view_all", "view_reports"],
  warehouse: ["receive_items", "manage_inventory", "dispatch_materials"],
  owner: ["view_all", "view_reports", "view_dashboard", "manage_users", "manage_sites"],
  admin: ["all"],
};
