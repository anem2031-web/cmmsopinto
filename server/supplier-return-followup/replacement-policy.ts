import { compensationAmounts, decimal4 } from "./amounts";
import { ReturnFollowupError } from "./policy";
import { isDelegateRole } from "../../shared/roles";
export type ReplacementStage = "draft" | "pricing" | "pending_accounting" | "pending_management" | "ready_to_purchase" | "purchased" | "partially_received" | "received" | "cancelled";
export interface ReplacementPlan {
  stage: ReplacementStage;
  revision: number;
  delegateId: number;
  creatorId: number;
  currency: string;
  valuationBasis: "tax_inclusive" | "tax_exclusive";
  total: string;
  creditAllocated: string;
  additionalFunding: string;
  accountingApprovedById: number | null;
  managementApprovedById: number | null;
}
type Actor = { id: number; role: string; active: boolean };
const fail = (message: string, code: "FORBIDDEN" | "CONFLICT" = "CONFLICT"): never => { throw new ReturnFollowupError(code, message); };
function check(actor: Actor, plan: ReplacementPlan, revision: number) {
  if (!actor.active) fail("الحساب غير متاح", "FORBIDDEN");
  if (revision !== plan.revision) fail("تغير طلب التعويض؛ حدّث الصفحة");
}
/** Repricing invalidates both approvals, including same-total edits. An adapter
 * must release only unspent reservations atomically before applying this result.
 */
export function quoteReplacement(actor: Actor, plan: ReplacementPlan, revision: number, total: string, credit: { available: string; currency: string; valuationBasis: ReplacementPlan["valuationBasis"]; confirmed: boolean }): ReplacementPlan {
  check(actor, plan, revision);
  if (!isDelegateRole(actor.role) || actor.id !== plan.delegateId) fail("التسعير للمندوب المسند إليه فقط", "FORBIDDEN");
  if (!["pricing", "pending_accounting", "pending_management", "ready_to_purchase"].includes(plan.stage)) fail("مرحلة التعويض لا تسمح بتعديل التسعير");
  if (!credit.confirmed || credit.currency !== plan.currency || credit.valuationBasis !== plan.valuationBasis) fail("يجب التحقق من رصيد المورد وعملته وأساس الضريبة");
  const money = compensationAmounts(total, credit.available);
  return { ...plan, total, creditAllocated: money.creditAllocated, additionalFunding: money.additionalFunding,
    stage: decimal4(money.additionalFunding) > BigInt(0) ? "pending_accounting" : "ready_to_purchase",
    accountingApprovedById: null, managementApprovedById: null, revision: revision + 1 };
}
export function approveReplacementFunding(actor: Actor, plan: ReplacementPlan, revision: number): ReplacementPlan {
  check(actor, plan, revision);
  if (decimal4(plan.additionalFunding) <= BigInt(0)) fail("لا يوجد فرق عهدة لاعتماده");
  if (plan.stage === "pending_accounting") {
    if (!["accountant", "admin", "owner"].includes(actor.role)) fail("اعتماد الحسابات غير مسموح لهذا الدور", "FORBIDDEN");
    return { ...plan, stage: "pending_management", accountingApprovedById: actor.id, revision: revision + 1 };
  }
  if (plan.stage === "pending_management") {
    if (!["senior_management", "admin", "owner"].includes(actor.role)) fail("اعتماد الإدارة العليا غير مسموح لهذا الدور", "FORBIDDEN");
    if (!plan.accountingApprovedById) fail("اعتماد الحسابات مفقود");
    return { ...plan, stage: "ready_to_purchase", managementApprovedById: actor.id, revision: revision + 1 };
  }
  return fail("مرحلة التعويض لا تسمح بهذا الاعتماد");
}
export function assertReplacementPurchase(actor: Actor, plan: ReplacementPlan, revision: number) {
  check(actor, plan, revision);
  if (!isDelegateRole(actor.role) || actor.id !== plan.delegateId) fail("الشراء للمندوب المسند إليه فقط", "FORBIDDEN");
  if (plan.stage !== "ready_to_purchase") fail("التعويض غير جاهز للشراء");
  if (decimal4(plan.additionalFunding) > BigInt(0) && (!plan.accountingApprovedById || !plan.managementApprovedById)) fail("فرق العهدة لم يكتمل اعتماده");
  if (decimal4(plan.total) !== decimal4(plan.creditAllocated) + decimal4(plan.additionalFunding)) fail("مصادر تمويل التعويض لا تطابق سعره");
}
