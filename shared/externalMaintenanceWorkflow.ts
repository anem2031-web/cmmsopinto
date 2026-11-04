export const EXTERNAL_MAINTENANCE_STATUS = {
  WAITING_WAREHOUSE_PREPARATION: "waiting_warehouse_preparation",
  WAITING_DELEGATE_RECEIPT: "waiting_delegate_receipt",
  WAITING_GATE_EXIT: "waiting_gate_exit",
  PURCHASE_CYCLE: "purchase_cycle",
  WAITING_GATE_ENTRY: "waiting_gate_entry",
  WAITING_WAREHOUSE_RECEIPT: "waiting_warehouse_receipt",
  WAITING_TECHNICIAN_HANDOVER: "waiting_technician_handover",
  DELIVERED_FOR_REINSTALL: "delivered_for_reinstall",
  REINSTALL_IN_PROGRESS: "reinstall_in_progress",
  READY_FOR_CLOSURE: "ready_for_closure",
  CLOSED: "closed",
} as const;

export type ExternalMaintenanceStatus =
  typeof EXTERNAL_MAINTENANCE_STATUS[keyof typeof EXTERNAL_MAINTENANCE_STATUS];

export function canWarehousePrepareExternalAsset(status?: string | null): boolean {
  return !status || status === EXTERNAL_MAINTENANCE_STATUS.WAITING_WAREHOUSE_PREPARATION;
}

export function canDelegateReceiveExternalAsset(status?: string | null): boolean {
  return status === EXTERNAL_MAINTENANCE_STATUS.WAITING_DELEGATE_RECEIPT;
}

export function hasCurrentExternalDelegateReceipt(job: {
  purchaseTitle?: string | null; delegateId?: number | null; delegateReceiptStatus?: string | null;
  delegateReceiptById?: number | null; delegateReceiptAt?: unknown; warehousePreparedAt?: unknown; preparationRevision?: number | null;
}): boolean {
  const prepared = new Date(String(job.warehousePreparedAt ?? "")).getTime(), received = new Date(String(job.delegateReceiptAt ?? "")).getTime();
  return Boolean(job.purchaseTitle?.trim()) && Number.isSafeInteger(Number(job.preparationRevision)) && Number(job.preparationRevision) > 0
    && Number.isSafeInteger(Number(job.delegateId)) && Number(job.delegateId) > 0 && job.delegateReceiptStatus === "accepted"
    && Number(job.delegateReceiptById) === Number(job.delegateId) && Number.isFinite(prepared) && Number.isFinite(received) && received >= prepared;
}

/** Legacy rows are repaired only through an explicit warehouse preparation. */
export function canWarehouseReprepareExternalAsset(job: {
  status?: string | null; purchaseOrderId?: number | null; gateExitApprovedAt?: unknown;
  purchaseTitle?: string | null; delegateReceiptStatus?: string | null; preparationRevision?: number | null;
  delegateId?: number | null; delegateReceiptById?: number | null; delegateReceiptAt?: unknown; warehousePreparedAt?: unknown;
}): boolean {
  if (job.purchaseOrderId != null || job.gateExitApprovedAt) return false;
  return job.status === EXTERNAL_MAINTENANCE_STATUS.WAITING_WAREHOUSE_PREPARATION ||
    (job.status === EXTERNAL_MAINTENANCE_STATUS.WAITING_GATE_EXIT &&
      !hasCurrentExternalDelegateReceipt(job));
}

export function canGateApproveExternalExit(status?: string | null): boolean {
  return status === EXTERNAL_MAINTENANCE_STATUS.WAITING_GATE_EXIT;
}

export function canDelegateWorkExternalPurchaseCycle(status?: string | null): boolean {
  return status === EXTERNAL_MAINTENANCE_STATUS.PURCHASE_CYCLE;
}

export function canGateApproveExternalEntry(status?: string | null): boolean {
  return status === EXTERNAL_MAINTENANCE_STATUS.WAITING_GATE_ENTRY;
}

export function canWarehouseReceiveExternalAsset(status?: string | null): boolean {
  return status === EXTERNAL_MAINTENANCE_STATUS.WAITING_WAREHOUSE_RECEIPT;
}

export function canWarehouseHandOverExternalAsset(status?: string | null): boolean {
  return status === EXTERNAL_MAINTENANCE_STATUS.WAITING_TECHNICIAN_HANDOVER;
}

export function canStartExternalReinstall(status?: string | null): boolean {
  return status === EXTERNAL_MAINTENANCE_STATUS.DELIVERED_FOR_REINSTALL;
}

export function isExternalMaintenancePurchaseItem(ticketPath?: string | null): boolean {
  return ticketPath === "C";
}
