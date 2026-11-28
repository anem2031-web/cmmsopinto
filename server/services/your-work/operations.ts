import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../../_core/context";
import { canReadYourWork, type YourWorkIdentity, type YourWorkItem } from "../../../shared/your-work";
import type { OperationsDatabase } from "./operations-port";
import { readTicketOperations } from "./operations-tickets";
import { readWarehouseOperations } from "./operations-warehouse";
import { readSettlementOperations } from "./operations-settlements";
import { readOtherOperations } from "./operations-other";
import { readPmv2Operations } from "./operations-pmv2";
import { readTicketMaterialOperations } from "./operations-ticket-materials";

/** One authenticated read snapshot; source permissions are re-evaluated on every call. */
export async function readYourWorkOperationsWithDatabase(actor: YourWorkIdentity, database: OperationsDatabase): Promise<YourWorkItem[]> {
  if (!canReadYourWork(actor)) throw new TRPCError({ code: "FORBIDDEN", message: "صفحة أعمالك غير متاحة لهذا الحساب" });
  const sources = await Promise.all([
    readTicketOperations(database, actor), readWarehouseOperations(database, actor),
    readSettlementOperations(database, actor), readOtherOperations(database, actor), readPmv2Operations(database, actor), readTicketMaterialOperations(database, actor),
  ]);
  return sources.flat();
}

export async function readYourWorkOperations(context: TrpcContext): Promise<YourWorkItem[]> {
  const actor = context.authenticatedUser ?? context.user;
  if (!canReadYourWork(actor)) throw new TRPCError({ code: "FORBIDDEN", message: "صفحة أعمالك غير متاحة لهذا الحساب" });
  const { getDb } = await import("../../_core/db");
  const database = await getDb();
  if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر قراءة الأعمال المطلوبة منك" });
  return readYourWorkOperationsWithDatabase(actor, database as unknown as OperationsDatabase);
}
