import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router } from "../_shared/procedures";
import { pmv2WarehouseProcedure } from "../../pmv2/security/procedures";
import {
  Pmv2WarehouseQueueError,
  pmv2WarehouseQueueService,
} from "../../pmv2/materials/warehouse-queue-service";
import {
  Pmv2WarehouseTransferHandoffError,
  pmv2WarehouseTransferHandoffService,
} from "../../pmv2/materials/warehouse-transfer-handoff-service";
import {
  Pmv2TeamIssueHandoffError,
  pmv2TeamIssueHandoffService,
} from "../../pmv2/materials/team-issue-handoff-service";
import {
  Pmv2WarehousePurchaseHandoffError,
  pmv2WarehousePurchaseHandoffService,
} from "../../pmv2/materials/warehouse-purchase-handoff-service";
import {
  Pmv2MaterialIdentityResolutionError,
  pmv2MaterialIdentityResolutionService,
} from "../../pmv2/materials/material-identity-resolution-service";

function mapWarehouseQueueError(error: unknown): never {
  if (
    error instanceof Pmv2WarehouseQueueError ||
    error instanceof Pmv2WarehouseTransferHandoffError ||
    error instanceof Pmv2WarehousePurchaseHandoffError ||
    error instanceof Pmv2TeamIssueHandoffError ||
    error instanceof Pmv2MaterialIdentityResolutionError
  ) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
  }
  throw error;
}

/** Phase 4 warehouse-facing PM V2 surface. Stock movement remains outside PM V2. */
export const pmv2WarehouseRouter = router({
  waitingMaterialQueue: pmv2WarehouseProcedure.query(async () => {
    try {
      return await pmv2WarehouseQueueService.listWaitingMaterialItems();
    } catch (error) {
      mapWarehouseQueueError(error);
    }
  }),

  /** Search the existing Catalog independently while resolving a free-text technician material. */
  searchMaterialIdentityCandidates: pmv2WarehouseProcedure
    .input(z.object({
      requestItemId: z.number().int().positive(),
      search: z.string().trim().max(120).default(""),
    }))
    .query(async ({ input }) => {
      try {
        return await pmv2MaterialIdentityResolutionService.searchCandidates(input.requestItemId, input.search);
      } catch (error) {
        mapWarehouseQueueError(error);
      }
    }),

  /** Resolve an unlisted PM V2 material to an existing Catalog item and reroute from live stock. */
  resolveMaterialIdentity: pmv2WarehouseProcedure
    .input(z.object({
      requestItemId: z.number().int().positive(),
      catalogItemId: z.number().int().positive(),
      requestedQuantity: z.number().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await pmv2MaterialIdentityResolutionService.resolveIdentity(ctx.user.id, input, {
          ipAddress: ctx.req.ip,
          userAgent: ctx.req.headers["user-agent"],
        });
      } catch (error) {
        mapWarehouseQueueError(error);
      }
    }),

  /**
   * Step 4.2B server-side recheck immediately before opening the existing
   * Warehouse Transfer workflow. This mutation performs no stock/PM V2 write.
   */
  prepareTransferHandoff: pmv2WarehouseProcedure
    .input(z.object({ requestItemId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      try {
        return await pmv2WarehouseTransferHandoffService.prepareTransferHandoff(
          input.requestItemId,
        );
      } catch (error) {
        mapWarehouseQueueError(error);
      }
    }),

  /**
   * Recheck the still-uncovered shortage before opening the existing Purchase
   * workflow. PM V2 does not create a PO here.
   */
  preparePurchaseHandoff: pmv2WarehouseProcedure
    .input(z.object({ requestItemId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      try {
        return await pmv2WarehousePurchaseHandoffService.preparePurchaseHandoff(input.requestItemId);
      } catch (error) {
        mapWarehouseQueueError(error);
      }
    }),

  /** Link one already-created authoritative PO Item back to the PM V2 shortage. */
  linkPurchaseOrder: pmv2WarehouseProcedure
    .input(z.object({
      requestItemId: z.number().int().positive(),
      purchaseOrderId: z.number().int().positive(),
      purchaseOrderItemId: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await pmv2WarehousePurchaseHandoffService.linkPurchaseOrder(ctx.user.id, input, {
          ipAddress: ctx.req.ip,
          userAgent: ctx.req.headers["user-agent"],
        });
      } catch (error) {
        mapWarehouseQueueError(error);
      }
    }),

  /**
   * Link only transfer rows that already exist in the authoritative Warehouse
   * Transfer workflow; then project their confirmed quantity into PM V2.
   */
  linkConfirmedTransfers: pmv2WarehouseProcedure
    .input(z.object({
      requestItemId: z.number().int().positive(),
      transferNumbers: z.array(z.string().trim().min(1).max(50)).min(1).max(20),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await pmv2WarehouseTransferHandoffService.linkConfirmedTransfers(
          ctx.user.id,
          input,
          {
            ipAddress: ctx.req.ip,
            userAgent: ctx.req.headers["user-agent"],
          },
        );
      } catch (error) {
        mapWarehouseQueueError(error);
      }
    }),

  /** Ready Team-Warehouse requirements. Task/material/quantity/Lots are resolved server-side. */
  readyToIssueQueue: pmv2WarehouseProcedure.query(async () => {
    try {
      return await pmv2TeamIssueHandoffService.listReadyToIssueQueue();
    } catch (error) {
      mapWarehouseQueueError(error);
    }
  }),

  /** Execute one complete PM V2 issue through the existing Inventory/Delivery service. */
  issueReadyRequirement: pmv2WarehouseProcedure
    .input(z.object({
      routeDecisionActionId: z.number().int().positive(),
      deliveredToId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await pmv2TeamIssueHandoffService.issueReadyRequirement(ctx.user.id, input, {
          ipAddress: ctx.req.ip,
          userAgent: ctx.req.headers["user-agent"],
        });
      } catch (error) {
        mapWarehouseQueueError(error);
      }
    }),

  /** Link-only recovery after a physical Delivery already exists. Never repeats stock movement. */
  linkConfirmedDelivery: pmv2WarehouseProcedure
    .input(z.object({
      routeDecisionActionId: z.number().int().positive(),
      deliveryNumber: z.string().trim().min(1).max(50),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await pmv2TeamIssueHandoffService.linkConfirmedDelivery(ctx.user.id, input, {
          ipAddress: ctx.req.ip,
          userAgent: ctx.req.headers["user-agent"],
        });
      } catch (error) {
        mapWarehouseQueueError(error);
      }
    }),

  pendingReturns: pmv2WarehouseProcedure.query(async () => {
    try {
      return await pmv2TeamIssueHandoffService.listPendingReturns();
    } catch (error) {
      mapWarehouseQueueError(error);
    }
  }),

  confirmPendingReturn: pmv2WarehouseProcedure
    .input(z.object({
      declarationActionId: z.number().int().positive(),
      lotAllocations: z.array(z.object({
        lotId: z.number().int().positive(),
        quantity: z.number().positive(),
      })).max(20).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await pmv2TeamIssueHandoffService.confirmPendingReturn(ctx.user.id, input);
      } catch (error) {
        mapWarehouseQueueError(error);
      }
    }),

});
