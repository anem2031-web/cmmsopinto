import { protectedProcedure, router } from "../_shared/procedures";
import { supplyWaitListInput, supplyWaitSaveInput } from "../../../shared/purchase-supply-wait";
import { PurchaseSupplyWaitService, type SupplyWaitPorts } from "../../services/purchase-supply-wait";

export function createPurchaseSupplyWaitRouter(ports: SupplyWaitPorts) {
  const service = new PurchaseSupplyWaitService(ports);
  return router({
    list: protectedProcedure.input(supplyWaitListInput).query(({ ctx, input }) => service.list(ctx.authenticatedUser ?? ctx.user, input)),
    save: protectedProcedure.input(supplyWaitSaveInput).mutation(({ ctx, input }) => service.save(ctx.authenticatedUser ?? ctx.user, input)),
  });
}
