import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { isDelegateRole } from "../../../shared/roles";
import { router, protectedProcedure, warehouseProcedure } from "../_shared/procedures";
import { followupCommand } from "../../supplier-return-followup/commands";
import { newReturnRequest } from "../../supplier-return-followup/create-once";
import { ReturnFollowupError } from "../../supplier-return-followup/policy";
import { creatorCancellation, creatorReplacementChoice, runTrialCreatorCancellation, runTrialCreatorReplacement } from "../../supplier-return-followup/creator-choice";
import { confirmSupplierRefund, confirmSupplierRefundInput } from "../../supplier-return-followup/refund";
import { createTrialReturn, listInput, listSupplierReturns, readRows, runTrialCommand, supplierReturnStatus, trialPort, valuationInput, supplierReturnValuePreview } from "../../supplier-return-followup/runtime";

const scope = protectedProcedure.use(({ ctx, next }) => {
  if (!isDelegateRole(ctx.user.role)&&!["warehouse", "admin", "owner", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager", "it_manager", "purchase_manager", "accountant", "senior_management", "executive_director", "user", "operator", "technician", "it_member", "supervisor", "purchase_requester", "food_warehouse_manager", "food_warehouse_assistant"].includes(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
  return next({ ctx });
});
const commandScope = protectedProcedure.use(({ ctx, next }) => {
  if (!isDelegateRole(ctx.user.role)&&!["warehouse", "admin", "owner"].includes(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
  return next({ ctx });
});
async function errors<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof ReturnFollowupError) throw new TRPCError({ code: error.code === "INVALID" ? "BAD_REQUEST" : error.code, message: error.message });
    throw error;
  }
}
export const supplierReturnsRouter = router({
  status: scope.query(async ({ ctx }) => supplierReturnStatus(ctx.user, await trialPort())),
  list: scope.input(listInput).query(async ({ ctx, input }) => listSupplierReturns(ctx.user, input, await trialPort())),
  valuePreview: warehouseProcedure.input(valuationInput).query(async ({ ctx, input }) => errors(async () => supplierReturnValuePreview(ctx.user, input, await trialPort()))),
  delegates: warehouseProcedure.query(async ({ ctx }) => {
    const db = await trialPort();
    if (!(await supplierReturnStatus(ctx.user, db)).enabled) throw new TRPCError({ code: "FORBIDDEN" });
    return readRows(db, sql`SELECT id,name,username FROM users WHERE role IN ('delegate','delegate_manager') AND isActive=1 ORDER BY id`);
  }),
  command: commandScope.input(followupCommand).mutation(async ({ ctx, input }) => errors(async () => runTrialCommand(ctx.user, input, await trialPort()))),
  chooseReplacement: scope.input(creatorReplacementChoice).mutation(async ({ ctx, input }) => errors(async () => {
    const connection = await trialPort();
    return runTrialCreatorReplacement(ctx.user, input, { transaction: work => connection.transaction(work) });
  })),
  cancelAfterRefund: scope.input(creatorCancellation).mutation(async ({ ctx, input }) => errors(async () => {
    const connection = await trialPort();
    return runTrialCreatorCancellation(ctx.user, input, { transaction: work => connection.transaction(work) });
  })),
  confirmRefund: commandScope.input(confirmSupplierRefundInput).mutation(async ({ ctx, input }) => errors(async () => {
    const connection = await trialPort();
    return confirmSupplierRefund(ctx.user, input, { transaction: work => connection.transaction(work) });
  })),
  create: warehouseProcedure.input(newReturnRequest).mutation(async ({ ctx, input }) => errors(async () => createTrialReturn(ctx.user, input, await trialPort()))),
});
