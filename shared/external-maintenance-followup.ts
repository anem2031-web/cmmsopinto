import { z } from "zod";
import { isDelegateRole } from "./delegate-role";

export const EXTERNAL_FOLLOWUP_QUERIES = ["externalMaintenance.listFollowup", "externalMaintenance.followupDetail"] as const;
export const externalFollowupListInput = z.object({
  view: z.enum(["active", "all", "received"]).default("active"),
  page: z.number().int().min(1).max(100000).default(1),
  pageSize: z.number().int().min(1).max(100).default(24),
}).strict();
export const externalFollowupDetailInput = z.object({ jobId: z.number().int().positive() }).strict();
export type ExternalFollowupListInput = z.infer<typeof externalFollowupListInput>;
export function canReadExternalFollowupRole(role?: string | null): boolean {
  return isDelegateRole(role) || ["warehouse", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager", "senior_management", "owner", "admin"].includes(role || "");
}
/** A narrow new read; it does not change ordinary PO/ticket/document permissions. */
export function externalFollowupRpcAllowed(user: { id: number; role: string; isActive?: number } | null | undefined, type: string, path: string): boolean {
  if (!(EXTERNAL_FOLLOWUP_QUERIES as readonly string[]).includes(path)) return true;
  return !!user && Number.isSafeInteger(user.id) && user.id > 0 && user.isActive === 1 && type === "query" && canReadExternalFollowupRole(user.role);
}
export type ExternalFollowupSummary = {
  jobId: number; purchaseTitle: string | null; assetBeforePhotoUrl: string | null;
  delegateId: number; delegateName: string | null; expectedReturnDate: string | null;
  status: string; gateEntryApprovedAt: string | null; warehouseReceivedAt: string | null;
};
export type ExternalFollowupDetail = ExternalFollowupSummary & {
  assetName: string | null; assetAfterReturnPhotoUrl: string | null;
  ticketId: number; ticketNumber: string; ticketDescription: string | null;
  purchaseOrderId: number; poNumber: string;
  workshopName: string | null; workshopPhone: string | null; workshopLocationUrl: string | null; workshopNotes: string | null;
  assetBeforeCondition: string | null; warehouseNotes: string | null;
  exitDocumentNumber: string | null; returnDocumentNumber: string | null;
  gateExitApprovedAt: string | null; gateExitApprovedByName: string | null; gateExitCarrierName: string | null; gateExitNotes: string | null;
  gateEntryApprovedByName: string | null; gateEntryCarrierName: string | null; gateEntryNotes: string | null;
  warehouseReceivedByName: string | null; returnCondition: string | null; warehouseReturnNotes: string | null;
};
