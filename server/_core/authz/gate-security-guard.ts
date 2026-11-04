import { TRPCError } from "@trpc/server";
import { hasCurrentExternalDelegateReceipt } from "../../../shared/externalMaintenanceWorkflow";
import { readScopeChunks } from "./read-batch";
import {
  GATE_SECURITY_JOB_STATUSES,
  GATE_SECURITY_ROLE,
  GATE_SECURITY_TRANSLATION_FIELDS,
  gateSecurityRpcAllowed,
  type GateSecurityIdentity,
} from "../../../shared/gate-security-policy";

const denied = () => new TRPCError({ code: "FORBIDDEN", message: "صلاحيات حارس البوابة مقتصرة على خروج الأصول ودخولها وسجل الحراسة" });
const validId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;

export interface GateSecurityJobScope {
  id: number;
  ticketId: number;
  ticketItemId: number | null;
  status: string;
  ticketMaintenancePath: string | null;
  itemTicketId: number | null;
  itemMaintenancePath: string | null;
  purchaseTitle?:string|null;delegateId?:number|null;delegateReceiptStatus?:string|null;
  delegateReceiptById?:number|null;delegateReceiptAt?:unknown;warehousePreparedAt?:unknown;preparationRevision?:number|null;
  purchaseOrderId?:number|null;gateExitApprovedAt?:unknown;
}
export interface GateSecurityResourcePort {
  jobs(ids: number[]): Promise<GateSecurityJobScope[]>;
}

export const gateSecurityResourcePort: GateSecurityResourcePort = {
  async jobs(ids) {
    const { getDb } = await import("../db");
    const { externalMaintenanceJobs: jobs, tickets, ticketItems } = await import("../../../drizzle/schema");
    const { eq, inArray } = await import("drizzle-orm");
    const connection = await getDb();
    if (!connection) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر التحقق من سجل الحراسة" });
    return readScopeChunks(ids,part=>connection.select({
      id: jobs.id, ticketId: jobs.ticketId, ticketItemId: jobs.ticketItemId, status: jobs.status,
      purchaseTitle:jobs.purchaseTitle,delegateId:jobs.delegateId,delegateReceiptStatus:jobs.delegateReceiptStatus,
      delegateReceiptById:jobs.delegateReceiptById,delegateReceiptAt:jobs.delegateReceiptAt,warehousePreparedAt:jobs.warehousePreparedAt,
      preparationRevision:jobs.preparationRevision,purchaseOrderId:jobs.purchaseOrderId,gateExitApprovedAt:jobs.gateExitApprovedAt,
      ticketMaintenancePath: tickets.maintenancePath,
      itemTicketId: ticketItems.ticketId, itemMaintenancePath: ticketItems.maintenancePath,
    }).from(jobs).innerJoin(tickets, eq(tickets.id, jobs.ticketId))
      .leftJoin(ticketItems, eq(ticketItems.id, jobs.ticketItemId)).where(inArray(jobs.id, part)));
  },
};

/** A secondary Path C item is valid even when the parent's principal path differs. */
export function isGateSecurityJob(job: GateSecurityJobScope): boolean {
  return validId(job.id) && validId(job.ticketId)
    && (GATE_SECURITY_JOB_STATUSES as readonly string[]).includes(job.status)
    && (job.status!=="waiting_gate_exit" || (job.purchaseOrderId==null&&!job.gateExitApprovedAt&&hasCurrentExternalDelegateReceipt(job)))
    && (job.ticketItemId == null ? job.ticketMaintenancePath === "C"
      : validId(job.ticketItemId) && job.itemTicketId === job.ticketId && job.itemMaintenancePath === "C");
}

/** Run before parsing/resolving an RPC; unknown paths remain denied. */
export function assertGateSecurityRpc(user: GateSecurityIdentity | null | undefined, type: string, path: string): void {
  if (!gateSecurityRpcAllowed(user, type, path)) throw denied();
}

async function requireJobs(ids: number[], port: GateSecurityResourcePort): Promise<GateSecurityJobScope[]> {
  const uniqueIds = Array.from(new Set(ids));
  if (!uniqueIds.length) return [];
  const jobs = await port.jobs(uniqueIds);
  if (jobs.length !== uniqueIds.length || uniqueIds.some(id => !jobs.some(job => job.id === id && isGateSecurityJob(job)))) throw denied();
  return jobs;
}

/** Scope only the gate operations and the translations actually used by its workspace. */
export async function assertGateSecurityResourceAccess(
  user: GateSecurityIdentity | null | undefined,
  type: string,
  path: string,
  raw: unknown,
  port = gateSecurityResourcePort,
): Promise<void> {
  if (user?.role !== GATE_SECURITY_ROLE) return;
  assertGateSecurityRpc(user, type, path);
  const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  if (path === "translation.getEntityTranslations" || path === "translation.getBatchTranslations") {
    const values = path === "translation.getBatchTranslations" ? input.entityIds : [input.entityId];
    if (input.entityType !== "EXTERNAL_MAINTENANCE_JOB" || !Array.isArray(values)
      || values.some(value => !validId(value))
      || (input.fieldNames != null && (!Array.isArray(input.fieldNames)
        || input.fieldNames.some(field => !(GATE_SECURITY_TRANSLATION_FIELDS as readonly unknown[]).includes(field))))) throw denied();
    await requireJobs(values, port);
    return;
  }
  if (path === "externalMaintenance.approveGateExit" || path === "externalMaintenance.approveGateEntry") {
    if (!validId(input.jobId)) throw denied();
    const [job] = await requireJobs([input.jobId], port);
    const expected = path === "externalMaintenance.approveGateExit" ? "waiting_gate_exit" : "waiting_gate_entry";
    if (job.status !== expected) throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن اعتماد إجراء الحراسة في المرحلة الحالية" });
  }
}

/** Known media URLs never grant access to general ticket/PO/catalog documents. */
export async function assertGateSecurityMediaReference(
  user: GateSecurityIdentity,
  reference: { kind: string; id: number; parentId?: number | null },
  port = gateSecurityResourcePort,
): Promise<void> {
  if (user.role !== GATE_SECURITY_ROLE) return;
  if (user.isActive !== 1 || reference.kind !== "external" || !validId(reference.id) || !validId(reference.parentId)) throw denied();
  const [job] = await requireJobs([reference.id], port);
  if (job.ticketId !== reference.parentId) throw denied();
}
