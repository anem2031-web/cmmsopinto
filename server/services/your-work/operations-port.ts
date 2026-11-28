import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { businessRpcAllowed } from "../../../shared/business-role-policy";
import type { YourWorkIdentity, YourWorkItem } from "../../../shared/your-work";

export type OperationsActor = YourWorkIdentity;
export interface OperationsDatabase { execute(statement: SQL): Promise<unknown> }
export async function operationRows(db: OperationsDatabase, statement: SQL): Promise<any[]> {
  const result = await db.execute(statement);
  if (!Array.isArray(result) || !Array.isArray(result[0]))
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر قراءة الأعمال المطلوبة منك" });
  return result[0];
}
export const operationIds = (ids: number[]) => sql.join(ids.map(id => sql`${id}`), sql`, `);
export const privilegedOperationActor = (actor: OperationsActor) => ["owner", "admin"].includes(actor.role);
export const operationCapability = (actor: OperationsActor, path: string) => businessRpcAllowed({ ...actor, isActive: Number(actor.isActive) }, "mutation", path);
export const operationTime = (value: unknown): number | null => value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
export function operationItem(row: Partial<YourWorkItem> & Pick<YourWorkItem, "key" | "kind" | "reference" | "action" | "href">): YourWorkItem {
  return { ...row, arrivedAt: operationTime(row.arrivedAt) };
}
