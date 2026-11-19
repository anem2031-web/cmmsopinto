export type AchievementItem = {
  id: number; itemName: string; poNumber: string; quantity: number; unit?: string | null;
  status: string; orderStatus: string; reviewRole?: string | null; submittedAt?: Date | string | null; reviewStartedAt?: Date | string | null;
  delegateName?: string | null; delegateRole?: string | null; delegateAssignedAt?: Date | string | null; delegateWaitStartedAt?: Date | string | null;
  effectiveReviewedAt?: Date | string | null; purchasedAt?: Date | string | null;
  receivedAt?: Date | string | null; deliveredAt?: Date | string | null;
  pricingSubmittedAt?: Date | string | null; accountingApprovedAt?: Date | string | null;
  managementApprovedAt?: Date | string | null; batchStatus?: string | null;
  delegateChangeReason?: string | null; itemRevisionNote?: string | null;
  purchaseCancelReason?: string | null; managementRejectionReason?: string | null;
  ticketNumbers: string[]; ticketEvidenceAvailable: boolean; issues: any[];
};

export function achievementMillis(value: unknown): number | null {
  if (!value) return null;
  const time = typeof value === "number" ? value : value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(time) ? time : null;
}

export function achievementElapsed(start: unknown, end: unknown): number | null {
  const a = achievementMillis(start), b = achievementMillis(end);
  return a == null || b == null || b < a ? null : b - a;
}

export function achievementDuration(ms: number | null): string {
  if (ms == null) return "غير مسجل";
  const minutes = Math.floor(ms / 60000), hours = Math.floor(minutes / 60);
  return hours ? `${hours} ساعة${minutes % 60 ? ` و${minutes % 60} دقيقة` : ""}` : `${minutes} دقيقة`;
}

export function achievementStatus(item: AchievementItem): { text: string; since: unknown; reason?: string | null } {
  switch (item.status) {
    case "pending_review": return { text: `بانتظار مراجعة الصنف${item.reviewRole === "general_maintenance_manager" ? " لدى الصيانة العامة" : item.reviewRole === "construction_procurement_manager" ? " لدى الإنشاءات" : item.reviewRole === "senior_management" ? " لدى الإدارة العليا" : ""}`, since: item.reviewStartedAt };
    case "needs_item_revision": return { text: "بانتظار تعديل الصنف", since: null, reason: item.itemRevisionNote };
    case "pending": return item.delegateName
      ? { text: `عند ${item.delegateRole === "delegate_manager" ? "مسؤول المناديب" : "المندوب"} ${item.delegateName}، بانتظار التسعير`, since: item.delegateWaitStartedAt }
      : { text: "بانتظار إسناد الصنف أو تسعيره", since: null };
    case "estimated":
      if (item.batchStatus === "pending_accounting") return { text: "بانتظار اعتماد الحسابات", since: item.pricingSubmittedAt };
      if (item.batchStatus === "pending_management") return { text: "بانتظار اعتماد الإدارة", since: item.accountingApprovedAt };
      return { text: "تم حفظ التسعير", since: null };
    case "approved": case "funded": return { text: `بانتظار الشراء${item.delegateName ? ` لدى ${item.delegateName}` : ""}`, since: item.managementApprovedAt };
    case "purchased": return { text: "سُجّل شراء الصنف، بانتظار استلام المستودع", since: item.purchasedAt };
    case "delivered_to_warehouse": return item.issues.length
      ? { text: "سُجّل استلام الصنف وصرف مرتبط بالبلاغ، راجع الكمية في التفاصيل", since: null }
      : { text: item.ticketNumbers.length ? "سُجّل استلام المستودع؛ راجع الصرف للبلاغ في التفاصيل" : "سُجّل استلام المستودع", since: item.receivedAt };
    case "delivered_to_requester": return { text: "سُجّل تسليم الصنف", since: item.deliveredAt };
    case "rejected": return { text: "الصنف مرفوض", since: null, reason: item.managementRejectionReason };
    case "cancelled": case "purchase_cancelled": return { text: "الصنف ملغى", since: null, reason: item.purchaseCancelReason };
    default: return { text: "راجع تفاصيل الصنف", since: null };
  }
}

export function achievementEventTitle(event: any): string | null {
  if (event.eventType === "review_decision") return event.newStatus === "pending" ? "تمت مراجعة الصنف وإرساله للمندوب" : "قرار مراجعة الصنف";
  if (event.eventType === "delegate_changed") return "تغيّر إسناد الصنف";
  if (event.eventType === "delegate_change_requested") return "طُلب تغيير المندوب";
  if (event.eventType === "estimate_updated" || event.eventType === "pricing_submitted" ||
      event.eventType === "accounting_approved" || event.eventType === "management_approved" ||
      event.eventType === "pricing_rejected" || event.eventType === "warehouse_receipt" ||
      event.eventType === "purchased" || event.eventType === "received" || event.eventType === "delivered" ||
      event.eventType === "item_revision_requested" || event.eventType === "purchase_cancelled") return event.title || null;
  if (event.eventType === "status_changed" && ["needs_item_revision", "purchase_cancelled", "cancelled", "rejected", "purchased", "delivered_to_warehouse", "delivered_to_requester"].includes(event.newStatus)) return event.title || null;
  return null;
}
