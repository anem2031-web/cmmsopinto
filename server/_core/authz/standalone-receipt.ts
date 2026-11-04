import { TRPCError } from "@trpc/server";
import { isOwnerOrAdminRole } from "../../../shared/restricted-module-policy";
import { assertCanViewPurchaseOrder } from "./guard";
import type { POVisibilitySubject } from "./engine";

type ReceiptActor = { id: number; role: string; isActive?: number | null };
const denied = () => new TRPCError({ code: "FORBIDDEN", message: "الاستلام المستقل متاح للمالك ومدير النظام فقط" });
function active(actor: ReceiptActor | null | undefined): actor is ReceiptActor {
  return !!actor && Number.isSafeInteger(actor.id) && actor.id > 0 && actor.isActive === 1;
}

/** Uses the actual authenticated identity, never an observer/admin projection. */
export function assertStandaloneReceiptActor(actor: ReceiptActor | null | undefined): asserts actor is ReceiptActor {
  if (!active(actor) || !isOwnerOrAdminRole(actor.role)) throw denied();
}

/** OCR is shared by independent and ordinary PO receipts. A supplied PO must
 * exist; a fabricated parent cannot turn independent OCR into a PO operation. */
export async function assertReceiptAnalysisAccess(actor: ReceiptActor | null | undefined, purchaseOrderId: number | undefined,
  findOrder: (id: number) => Promise<POVisibilitySubject | null | undefined>) {
  if (purchaseOrderId == null) { assertStandaloneReceiptActor(actor); return; }
  if (!active(actor) || !["warehouse", "owner", "admin"].includes(actor.role)) throw denied();
  if (!Number.isSafeInteger(purchaseOrderId) || purchaseOrderId <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "مرجع طلب الشراء غير صالح" });
  const order = await findOrder(purchaseOrderId);
  if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
  await assertCanViewPurchaseOrder(actor, order);
}
