import { getPmv2MaterialQuantityValidationMessage } from "../../../shared/pmv2MaterialQuantity";

/** Catalog is the base unit. Invoice package conversions stay at receipt. */
export function pmv2CatalogBaseUnit(value: unknown): string {
  const unit = String(value ?? "").trim();
  if (!unit || unit.length > 50) throw Error("وحدة صنف الكتالوج غير محددة؛ صحح بيانات الصنف قبل اعتماد المادة");
  return unit;
}

export function pmv2ApprovedMaterialQuantity(value: unknown, unit: string): number {
  const quantity = Number(value);
  const message = getPmv2MaterialQuantityValidationMessage(quantity, unit);
  if (message) throw Error(message);
  if (Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 0.000001)
    throw Error("دقة الكمية لا تتجاوز ثلاث منازل عشرية");
  return quantity;
}

/** Any historical procurement/stock link makes reinterpretation unsafe, even if
 * cancelled later. Only an untouched waiting request may adopt a new unit. */
export function assertPmv2UnitApprovalUntouched(input: {
  received: number; issued: number; hasProcurementOrUsage: boolean;
  actions: Array<{ action: string; note: string | null }>;
  requestItemId: number; routeActionId: number;
}) {
  if (input.received !== 0 || input.issued !== 0 || input.hasProcurementOrUsage)
    throw Error("لا يمكن تعديل وحدة أو كمية احتياج مرتبط بشراء أو حركة مواد سابقة");
  const materialHistory = new Set(["material_transfer_linked", "material_issue_linked", "material_issue_link_pending",
    "material_consumption_declared", "material_consumption_finalized", "material_return_part_linked", "material_return_completed"]);
  for (const row of input.actions) {
    if (!materialHistory.has(row.action)) continue;
    let note: any;
    try { note = JSON.parse(row.note || ""); } catch { throw Error("سجل حركة المواد غير مكتمل؛ يلزم مراجعته قبل تعديل الاحتياج"); }
    if (Number(note.materialRequestItemId) === input.requestItemId || Number(note.routeDecisionActionId) === input.routeActionId)
      throw Error("لا يمكن تعديل وحدة أو كمية احتياج مرتبط بشراء أو حركة مواد سابقة");
    // A malformed known material event cannot establish that this request is untouched.
    if (note.materialRequestItemId == null && note.routeDecisionActionId == null && row.action !== "material_return_completed")
      throw Error("تعذر التحقق من ارتباط حركة المواد؛ راجع المستودع قبل تعديل الاحتياج");
  }
}
