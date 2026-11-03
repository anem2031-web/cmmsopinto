import { warehouseLotSelectionSchema, type WarehouseLotOption } from "../../../shared/warehouse-lot-selection";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { router, protectedProcedure } from "../_shared/procedures";
import { TeamTicketError } from "../../../shared/maintenance-team-tickets/model";
import {
  executionService,
  SqlExecutionStore,
  selectRows,
} from "./execution.repository";
import type { MaintenanceTeamTicketService } from "../../maintenance-team-tickets/service";
import type { TeamManagementActor } from "../../../shared/maintenance-team-tickets/team-management";
import { canReadTicketTeamExecution } from "../../../shared/maintenance-team-tickets/execution-permissions";
import { searchTicketIdentityCandidates } from "../../maintenance-team-tickets/material-identity-reader";
import { readTicketMaterialUnits } from "../../maintenance-team-tickets/material-catalog-search";
import { localizeActionSnapshot } from "../../maintenance-team-tickets/action-translations";
const id = z.number().int().positive();
const command = z.object({
  assignmentId: id,
  expectedRevision: z.number().int().nonnegative(),
  operationKey: z.string().trim().min(1).max(120),
});
const need = z
  .object({
    catalogItemId: id.optional(),
    name: z.string().trim().max(250).optional(),
    unit: z.string().trim().max(50).optional(),
    quantity: z.number().int().positive(),
  })
  .strict();
const actor = (ctx: any): TeamManagementActor => ({
  id: ctx.user.id,
  role: ctx.user.role,
  active: ctx.user.isActive === 1,
  ipAddress: ctx.req?.ip,
  userAgent: ctx.req?.get?.("user-agent"),
});
async function result<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (e) {
    if (e instanceof TeamTicketError) {
      const codes = {
        INVALID: "BAD_REQUEST",
        CONFLICT: "CONFLICT",
        FORBIDDEN: "FORBIDDEN",
        NOT_FOUND: "NOT_FOUND",
        UNAVAILABLE: "INTERNAL_SERVER_ERROR",
      } as const;
      throw new TRPCError({ code: codes[e.code], message: e.message });
    }
    const code = (e as { code?: string })?.code;
    if (
      ["ER_DUP_ENTRY", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(
        code ?? ""
      )
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "حدث إجراء متزامن؛ حدّث البيانات وأعد المحاولة بنفس الإجراء",
      });
    throw e;
  }
}
export function createTicketTeamExecutionRouter(
  factory: (
    id: number,
    actor: TeamManagementActor,
    options?: {
      catalogIds?: number[];
      requiredDate?: string;
      recipientId?: number;
    }
  ) => MaintenanceTeamTicketService = executionService,
  identityReader = searchTicketIdentityCandidates,
  unitsReader = readTicketMaterialUnits,
  warehouseTicketReader = async (user: { id: number; role: string; isActive: number }, ticketId: number) => {
    const { getDb } = await import("../../_core/db/client");
    const { readWarehouseMaterialTicket } = await import("../../maintenance-team-tickets/warehouse-ticket-reader");
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
    return readWarehouseMaterialTicket(db, user, ticketId);
  }
) {
  const service = (ctx: any, input: { assignmentId: number }, options = {}) => {
    const a = actor(ctx);
    if (!a.active || !canReadTicketTeamExecution(a.role))
      throw new TeamTicketError(
        "FORBIDDEN",
        "لا توجد صلاحية لطبقة تنفيذ الفريق"
      );
    return factory(input.assignmentId, a, options);
  };
  return router({
    warehouseTicket: protectedProcedure.input(z.object({ ticketId: id }).strict()).query(({ ctx, input }) => {
      if (ctx.user.role !== "warehouse" || ctx.user.isActive !== 1) throw new TRPCError({ code: "FORBIDDEN" });
      return warehouseTicketReader(ctx.user, input.ticketId);
    }),
    units: protectedProcedure
      .input(z.object({ assignmentId: id }).strict())
      .query(({ ctx, input }) => result(async () => {
        await service(ctx, input).materialUnitsContext(ctx.user.id, input.assignmentId);
        return unitsReader();
      })),
    searchMaterialIdentityCandidates: protectedProcedure
      .input(z.object({ assignmentId: id, needId: id, search: z.string().trim().max(120).default("") }).strict())
      .query(({ ctx, input }) => result(async () => {
        if (!["warehouse", "owner", "admin"].includes(ctx.user.role)) throw new TeamTicketError("FORBIDDEN", "مطابقة المواد للمستودع فقط");
        const context = await service(ctx, input).materialIdentityContext(ctx.user.id, input.assignmentId, input.needId);
        return identityReader(context, input.search);
      })),
    startItem: protectedProcedure
      .input(command.strict())
      .mutation(({ ctx, input }) => result(() => service(ctx, input).startExecution(ctx.user.id, input))),
    resumeItem: protectedProcedure
      .input(command.strict())
      .mutation(({ ctx, input }) => result(() => service(ctx, input).startExecution(ctx.user.id, input, true))),
    endVisit: protectedProcedure
      .input(command.strict())
      .mutation(({ ctx, input }) => result(() => service(ctx, input).endVisit(ctx.user.id, input))),
    beginMaterialNeed: protectedProcedure
      .input(command.strict())
      .mutation(({ ctx, input }) =>
        result(() => service(ctx, input).beginMaterialNeed(ctx.user.id, input))
      ),
    registerMaterialNeed: protectedProcedure
      .input(
        command
          .extend({ need, confirmReceipt: z.boolean().default(false) })
          .strict()
      )
      .mutation(({ ctx, input }) =>
        result(() =>
          service(ctx, input, {
            catalogIds: input.need.catalogItemId
              ? [input.need.catalogItemId]
              : [],
          }).registerMaterialNeed(
            ctx.user.id,
            input,
            input.need,
            input.confirmReceipt
          )
        )
      ),
    prepareSupply: protectedProcedure
      .input(
        z
          .object({
            assignmentId: id,
            needId: id,
            kind: z.enum(["purchase", "transfer"]),
          })
          .strict()
      )
      .mutation(({ ctx, input }) =>
        result(() =>
          service(ctx, input).prepareSupply(
            ctx.user.id,
            input.assignmentId,
            input.needId,
            input.kind
          )
        )
      ),
    issue: protectedProcedure
      .input(command.extend({ needId: id, recipientId: id, selection: warehouseLotSelectionSchema.optional() }).strict())
      .mutation(({ ctx, input }) =>
        result(() =>
          service(ctx, input, {
            recipientId: input.recipientId,
          }).issueByWarehouse(
            ctx.user.id,
            input,
            input.needId,
            input.recipientId,
            input.selection
          )
        )
      ),
    transferFromForm: protectedProcedure
      .input(
        command
          .extend({
            needId: id,
            form: z
              .object({
                fromWarehouseId: id,
                toWarehouseId: id,
                notes: z.string().max(4000).optional(),
                items: z
                  .array(
                    z
                      .object({
                        fromInventoryId: id,
                        quantity: id,
                        lotTrackingToken: z.string().trim().min(1).max(250),
                        notes: z.string().max(4000).optional(),
                      })
                      .strict()
                  )
                  .min(1)
                  .max(20),
              })
              .strict(),
          })
          .strict()
      )
      .mutation(({ ctx, input }) =>
        result(() =>
          service(ctx, input).transferFromForm(
            ctx.user.id,
            input,
            input.needId,
            input.form
          )
        )
      ),
    details: protectedProcedure
      .input(z.object({ assignmentId: id, language: z.enum(["ar", "en", "ur"]).optional() }).strict())
      .query(({ ctx, input }) =>
        result(async () => localizeActionSnapshot(await service(ctx, input).read(ctx.user.id), input.language))
      ),
    balances: protectedProcedure
      .input(z.object({ assignmentId: id, issueNeedId: id.optional() }).strict())
      .query(({ ctx, input }) =>
        result(async () => {
          if (input.issueNeedId && !["warehouse", "owner", "admin"].includes((ctx.authenticatedUser ?? ctx.user).role)) throw new TeamTicketError("FORBIDDEN", "اختيار اللوتات للمستودع فقط");
          await service(ctx, input).read(ctx.user.id);
          return new SqlExecutionStore(
            input.assignmentId,
            actor(ctx)
          ).transaction(async (s, effects) => {
            const a = s.assignments[0],
              main = await effects.mainWarehouseId();
            const balances: Array<{needId:number;branch:number;main:number;lots?:WarehouseLotOption[]}> = [];
            if (input.issueNeedId) {
              const need = s.needs.find(row => row.id === input.issueNeedId && row.assignmentId === a.id && row.round === a.materialRound);
              if (!need || a.stage !== "waiting_material" || !effects.issueLots) throw new TeamTicketError("CONFLICT", "الاحتياج غير متاح لاختيار اللوتات");
              return [{ needId: need.id, branch: 0, main: 0, lots: await effects.issueLots(need.id, a.warehouseId) }];
            }
            for (const n of s.needs.filter(n => n.round === a.materialRound))
              balances.push({
                needId: n.id,
                branch:
                  n.catalogItemId == null
                    ? 0
                    : await effects.availability(
                        a.warehouseId,
                        n.catalogItemId
                      ),
                main:
                  n.catalogItemId == null
                    ? 0
                    : await effects.availability(main, n.catalogItemId),
              });
            return balances;
          });
        })
      ),
    outcome: protectedProcedure
      .input(
        command
          .extend({
            outcome: z.enum(["ok", "fixed", "blocked", "external"]),
            note: z.string().max(4000),
            usages: z
              .array(
                z
                  .object({
                    catalogItemId: id,
                    used: z.number().int().nonnegative(),
                  })
                  .strict()
              )
              .max(20),
            otherMaterials: z.string().max(4000).optional(),
            physicalUsages: z.array(z.object({ deliveryId: id, used: z.number().int().nonnegative() }).strict()).max(100).optional(),
          })
          .strict()
      )
      .mutation(({ ctx, input }) =>
        result(() =>
          service(ctx, input).submitOutcome(ctx.user.id, input, input.outcome, {
            note: input.note,
            usages: input.usages,
            otherMaterials: input.otherMaterials,
            physicalUsages: input.physicalUsages,
          })
        )
      ),
    preview: protectedProcedure
      .input(
        z
          .object({ assignmentId: id, needs: z.array(need).min(1).max(20) })
          .strict()
      )
      .query(({ ctx, input }) =>
        result(() =>
          service(ctx, input, {
            catalogIds: input.needs.flatMap(n =>
              n.catalogItemId ? [n.catalogItemId] : []
            ),
          }).previewMaterials(ctx.user.id, input.assignmentId, input.needs)
        )
      ),
    request: protectedProcedure
      .input(
        command
          .extend({
            needs: z.array(need).min(1).max(20),
            confirmedCatalogIds: z.array(id).max(20).default([]),
          })
          .strict()
      )
      .mutation(({ ctx, input }) =>
        result(() =>
          service(ctx, input, {
            catalogIds: input.needs.flatMap(n =>
              n.catalogItemId ? [n.catalogItemId] : []
            ),
          }).requestMaterials(
            ctx.user.id,
            input,
            input.needs,
            input.confirmedCatalogIds
          )
        )
      ),
    receive: protectedProcedure
      .input(command.extend({ needId: id }).strict())
      .mutation(({ ctx, input }) =>
        result(() =>
          service(ctx, input).receiveMaterial(ctx.user.id, input, input.needId)
        )
      ),
    resolve: protectedProcedure
      .input(
        command
          .extend({
            needId: id,
            catalogItemId: id,
            requestedQuantity: z.number().int().positive().optional(),
            note: z.string().trim().min(1).max(4000),
          })
          .strict()
      )
      .mutation(({ ctx, input }) =>
        result(() =>
          service(ctx, input, {
            catalogIds: [input.catalogItemId],
          }).resolveMaterial(
            ctx.user.id,
            input,
            input.needId,
            input.catalogItemId,
            input.note,
            input.requestedQuantity
          )
        )
      ),
    provide: protectedProcedure
      .input(
        command
          .extend({
            needId: id,
            kind: z.enum(["purchase", "transfer"]),
            requiredDate: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional(),
          })
          .strict()
      )
      .mutation(({ ctx, input }) =>
        result(() =>
          service(ctx, input, {
            requiredDate: input.requiredDate,
          }).provideMaterial(
            ctx.user.id,
            input,
            input.needId,
            input.kind,
            input.requiredDate
              ? { requiredDate: input.requiredDate }
              : undefined
          )
        )
      ),
    purchaseReceipt: protectedProcedure
      .input(command.extend({ supplyId: id }).strict())
      .mutation(({ ctx, input }) =>
        result(() =>
          service(ctx, input).receivePurchase(
            ctx.user.id,
            input,
            input.supplyId
          )
        )
      ),
    returnMaterial: protectedProcedure
      .input(
        command
          .extend({
            needId: id,
            allocations: z
              .array(
                z
                  .object({ lotId: id, quantity: z.number().int().positive() })
                  .strict()
              )
              .min(1)
              .max(100)
              .optional(),
          })
          .strict()
      )
      .mutation(({ ctx, input }) =>
        result(() =>
          service(ctx, input).confirmReturn(
            ctx.user.id,
            input,
            input.needId,
            input.allocations
          )
        )
      ),
    review: protectedProcedure
      .input(
        command
          .extend({
            decision: z.enum([
              "return_to_team",
              "approve_external",
              "external_handover",
              "approve_result",
            ]),
            note: z.string().trim().min(1).max(4000),
            recipientId: id.optional(),
          })
          .strict()
      )
      .mutation(({ ctx, input }) =>
        result(() =>
          service(ctx, input).review(
            ctx.user.id,
            input,
            input.decision,
            input.note,
            input.recipientId
          )
        )
      ),
    catalog: protectedProcedure
      .input(
        z
          .object({
            assignmentId: id,
            search: z.string().trim().max(100).default(""),
          })
          .strict()
      )
      .query(({ ctx, input }) =>
        result(async () => {
          // Membership/manager scope is checked before any catalog lookup.
          const snapshot = await service(ctx, input).read(ctx.user.id);
          const assignment = snapshot.assignments.find(
            a => a.id === input.assignmentId
          );
          if (!assignment)
            throw new TeamTicketError("NOT_FOUND", "إسناد الفريق غير موجود");
          const { getDb } = await import("../../_core/db/client"),
            db = await getDb();
          if (!db)
            throw new TeamTicketError(
              "UNAVAILABLE",
              "قاعدة البيانات غير متاحة"
            );
          const term = `%${input.search}%`;
          const rows = await selectRows(
            db,
            sql`SELECT c.id,c.nameAr AS name,c.nameEn,c.unit,c.code,COALESCE(teamStock.quantity,0) AS availableQuantity,(history.catalogItemId IS NOT NULL) AS usedByTeam FROM catalog_items c
              LEFT JOIN (SELECT v.linkedItemId,SUM(b.quantity) AS quantity FROM inventory v
                INNER JOIN inventory_lot_balances b ON b.inventoryId=v.id
                WHERE v.warehouseId=${assignment.warehouseId} AND COALESCE(v.isFrozen,0)=0 AND v.quantity>0 AND b.quantity>0
                GROUP BY v.linkedItemId) teamStock ON teamStock.linkedItemId=c.id
              LEFT JOIN (SELECT DISTINCT n.catalogItemId FROM ticket_team_material_needs n
                INNER JOIN ticket_team_assignments a ON a.id=n.assignmentId
                WHERE a.teamId=${assignment.teamId} OR (a.siteId=${assignment.location.siteId} AND a.sectionId=${assignment.location.sectionId}
                  AND a.assetId <=> ${assignment.location.assetId ?? null})) history ON history.catalogItemId=c.id
              WHERE c.isActive=1 AND (c.nameAr LIKE ${term} OR c.nameEn LIKE ${term} OR c.code LIKE ${term})
                AND NOT EXISTS (SELECT 1 FROM catalog_units u WHERE u.isActive=0 AND (u.nameAr=c.unit OR u.nameEn=c.unit))
              ORDER BY (COALESCE(teamStock.quantity,0)>0) DESC,(history.catalogItemId IS NOT NULL) DESC,c.nameAr,c.id LIMIT 50`
          );
          return rows.map(r => ({
            id: Number(r.id),
            name: String(r.name),
            nameEn: String(r.nameEn ?? ""),
            availableQuantity: Number(r.availableQuantity ?? 0),
            usedByTeam: Number(r.usedByTeam) === 1,
            unit: String(r.unit ?? ""),
            code: String(r.code ?? ""),
          }));
        })
      ),
  });
}
