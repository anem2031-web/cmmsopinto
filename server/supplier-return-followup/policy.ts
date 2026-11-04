/** Pure policy foundation. Not mounted as an RPC and never posts stock/money.
 * Persistence adapters must load the actor/source/links again under transaction
 * locks, enforce central capabilities, and persist the event + revision atomically.
 */
import { isDelegateRole } from "../../shared/roles";
export type Handover = "awaiting_delegate" | "rejected" | "accepted";
export type Resolution = "same_item" | "change_item" | "refund";
export interface Followup {
  delegateId: number;
  creatorId: number | null;
  returnedQuantity: number;
  revision: number;
  handover: Handover;
  resolution: Resolution | null;
  rejectionReason: string | null;
  creatorDecision: "pending" | "replace" | "cancel" | null;
}
export interface Actor { id: number; role: string; active: boolean; }
export class ReturnFollowupError extends Error {
  constructor(public code: "FORBIDDEN" | "CONFLICT" | "INVALID", message: string) { super(message); }
}
const reject = (code: ReturnFollowupError["code"], message: string): never => { throw new ReturnFollowupError(code, message); };
function check(actor: Actor, state: Followup, expectedRevision: number) {
  if (!actor.active || !Number.isSafeInteger(actor.id) || actor.id <= 0) reject("FORBIDDEN", "الحساب غير متاح");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== state.revision) reject("CONFLICT", "تغير المرتجع؛ حدّث الصفحة");
}
function delegate(actor: Actor, state: Followup) {
  if (!isDelegateRole(actor.role) || actor.id !== state.delegateId) reject("FORBIDDEN", "الإجراء للمندوب المسند إليه المرتجع فقط");
}
function reason(value: string) {
  const text = value.trim();
  if (!text || text.length > 4000) reject("INVALID", "السبب إلزامي وبحد أقصى 4000 حرف");
  return text;
}
export function decideHandover(actor: Actor, state: Followup, expectedRevision: number, accepted: boolean, rejectionReason = ""): Followup {
  check(actor,state,expectedRevision); delegate(actor,state);
  if (state.handover !== "awaiting_delegate" || state.resolution) reject("CONFLICT", "المرتجع ليس بانتظار الاستلام");
  return { ...state, handover: accepted ? "accepted" : "rejected", rejectionReason: accepted ? null : reason(rejectionReason), revision: state.revision+1 };
}
export function resendHandover(actor: Actor, state: Followup, expectedRevision: number): Followup {
  check(actor,state,expectedRevision);
  if (!["warehouse","admin","owner"].includes(actor.role)) reject("FORBIDDEN", "إعادة التسليم للمستودع فقط");
  if (state.handover !== "rejected" || state.resolution) reject("CONFLICT", "لا يوجد تسليم مرفوض لإعادته");
  // Keep the previous reason in the snapshot and in the event ledger. This action
  // does not call the original supplier-return writer or change returned quantity.
  return { ...state, handover: "awaiting_delegate", revision: state.revision+1 };
}
export function chooseResolution(actor: Actor, state: Followup, expectedRevision: number, resolution: Resolution): Followup {
  check(actor,state,expectedRevision); delegate(actor,state);
  if (state.handover !== "accepted" || state.resolution) reject("CONFLICT", "يلزم استلام المرتجع قبل اختيار إجراء واحد");
  if (!["same_item","change_item","refund"].includes(resolution)) reject("INVALID", "إجراء مرتجع غير صحيح");
  if (resolution !== "same_item" && !state.creatorId) reject("CONFLICT", "لا يوجد منشئ طلب مرتبط؛ يلزم تحديد المسؤول قبل المتابعة");
  return { ...state, resolution, creatorDecision: resolution === "same_item" ? null : "pending", revision: state.revision+1 };
}
/** Facts are supplied only by the fresh server-side link resolver, not UI input. */
export interface CurrentSourceLinks { verified: boolean; hasMaintenance: boolean; hasTask: boolean; hasMaterialNeed: boolean; }
export function decideCreator(actor: Actor, state: Followup, expectedRevision: number, decision: "replace" | "cancel", links: CurrentSourceLinks): Followup {
  check(actor,state,expectedRevision);
  if (actor.id !== state.creatorId) reject("FORBIDDEN", "القرار لمنشئ الطلب");
  if (state.handover !== "accepted" || state.creatorDecision !== "pending") reject("CONFLICT", "البند ليس بانتظار منشئ الطلب");
  if (!links.verified) reject("CONFLICT", "تعذر التحقق من ارتباطات البند");
  if (decision !== "replace" && decision !== "cancel") reject("INVALID", "قرار غير صحيح");
  if (decision === "cancel" && (state.resolution !== "refund" || links.hasMaintenance || links.hasTask || links.hasMaterialNeed)) reject("CONFLICT", "لا يمكن إلغاء بند مرتبط بصيانة أو مهمة أو احتياج مواد");
  return { ...state, creatorDecision: decision, revision: state.revision+1 };
}
/** SAR amounts in minor units; no floats, currency conversion, or tax inference.
 * Both amounts must cover the same compensation scope and the same tax basis.
 * creditAvailable is verified supplier credit, not an already-refunded amount.
 */
export function compareCompensationValue(replacementValue: number, creditAvailable: number) {
  for (const value of [replacementValue, creditAvailable]) if (!Number.isSafeInteger(value) || value < 0) reject("INVALID", "قيمة التسوية غير صحيحة");
  return { additionalCustody: Math.max(0,replacementValue-creditAvailable), supplierRefundDue: Math.max(0,creditAvailable-replacementValue) };
}
