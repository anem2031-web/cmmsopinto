import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { isDelegateRole } from "../../shared/roles";
import { z } from "zod";
import type { FollowupPort, FollowupTx } from "./commands";
import { ReturnFollowupError } from "./policy";

export const newReturnRequest = z.object({
  operationKey: z.string().min(16).max(100),
  trackingToken: z.string().trim().min(1).max(150),
  warehouseId: z.number().int().positive(),
  delegateId: z.number().int().positive(),
  returnedQuantity: z.number().int().positive(),
  reason: z.string().trim().min(1).max(4000),
}).strict();
export type NewReturnRequest = z.infer<typeof newReturnRequest>;
type Created = { caseId: number; returnId: number };
type CreationMetadata = { creationKey: string; creationRequestHash: string; createdById: number };
async function read(tx: FollowupTx, query: Parameters<FollowupTx["execute"]>[0]) {
  const result = await tx.execute(query);
  if (!Array.isArray(result?.[0])) throw Error("Invalid supplier return creation response");
  return result[0];
}
/** Integration contract: writer must use this SAME transaction for the existing
 * stock writer and the case insert. It must never start a nested transaction.
 * All source IDs and values are resolved server-side by that writer.
 */
export async function createSupplierReturnOnce(
  port: FollowupPort,
  actor: { id: number; role: string },
  raw: NewReturnRequest,
  writer: (tx: FollowupTx, input: NewReturnRequest, metadata: CreationMetadata) => Promise<Created>,
): Promise<Created> {
  const input = newReturnRequest.parse(raw);
  if (!["warehouse", "admin", "owner"].includes(actor.role)) throw new ReturnFollowupError("FORBIDDEN", "إنشاء المرتجع للمستودع فقط");
  const metadata = { createdById: actor.id, creationKey: input.operationKey,
    creationRequestHash: createHash("sha256").update(JSON.stringify(input)).digest("hex") };
  return port.transaction(async tx => {
    // Same actor lock serializes concurrent retries, including the first insert.
    const [identity] = await read(tx, sql`SELECT id,role,isActive FROM users WHERE id=${actor.id} FOR UPDATE`);
    if (!identity || identity.role !== actor.role || Number(identity.isActive) !== 1) throw new ReturnFollowupError("FORBIDDEN", "الحساب غير متاح");
    const [existing] = await read(tx, sql`SELECT id,returnId,creationRequestHash FROM supplier_return_cases WHERE createdById=${actor.id} AND creationKey=${input.operationKey} FOR UPDATE`);
    if (existing) {
      if (existing.creationRequestHash !== metadata.creationRequestHash) throw new ReturnFollowupError("CONFLICT", "مفتاح إنشاء المرتجع مستخدم لطلب مختلف");
      return { caseId: Number(existing.id), returnId: Number(existing.returnId) };
    }
    const [delegate] = await read(tx, sql`SELECT id,role,isActive FROM users WHERE id=${input.delegateId}`);
    if (!delegate || !isDelegateRole(delegate.role) || Number(delegate.isActive) !== 1) throw new ReturnFollowupError("CONFLICT", "المندوب المحدد غير متاح");
    const result = await writer(tx, input, metadata);
    // Enforce the adapter contract before committing the stock deduction.
    const [saved] = await read(tx, sql`SELECT id,returnId,creationRequestHash FROM supplier_return_cases WHERE createdById=${actor.id} AND creationKey=${input.operationKey} FOR UPDATE`);
    if (!saved || Number(saved.id) !== result.caseId || Number(saved.returnId) !== result.returnId || saved.creationRequestHash !== metadata.creationRequestHash) throw Error("Supplier return writer did not persist its atomic creation key");
    return result;
  });
}
