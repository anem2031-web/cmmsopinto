import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { APP_ROLE, isDelegateRole, canRoleAccessPath, canRoleAccessCatalogModule, canRoleManagePmv2 } from "../../shared/roles";
import { delegateManagerAssignmentRpcAllowed } from "../../shared/delegate-role";
import { ROLE_PERMISSIONS } from "../../shared/types";
import { delegateDirectoryRpcAllowed } from "../../shared/delegate-directory-policy";
import { ACTION_POLICY, PO_STATUS, BYPASS_ALL_ROLES } from "../_core/authz/policy";
import { canPerformAction, canPerformItemStatusAction, canPerformItemAction, canRequestPOItemDelegateChange, canResolvePOItemDelegateChange, isPOVisible } from "../_core/authz/engine";
import { externalDelegateRpcAllowed } from "../../shared/external-delegate-access";
import { canReviewPurchaseItem } from "../../shared/purchase-item-review";

const f = vi.hoisted(() => ({ assignments: [] as any[], assigned: vi.fn(), scopes: [] as any[], sql: [] as any[], error: null as Error | null }));
vi.mock("../_core/db", () => ({ getPOItemsByDelegate: f.assigned, getDb: async () => ({ execute: async (query: any) => {
  const compiled = new MySqlDialect().sqlToQuery(query); f.sql.push(compiled);
  if (f.error) throw f.error;
  return [f.scopes.filter(row => compiled.params.includes(row.id)), []];
} }) }));
import { router, protectedProcedure, managerProcedure, accountantProcedure, warehouseProcedure } from "../routers/_shared/procedures";
import { createPurchaseOrderReadScope } from "../_core/authz/guard";
import { authorizePurchaseDocument, authorizePurchaseAttachment } from "../_core/authz/purchase-document";
import { loadExternalDelegateScopes, isExternalDelegateJob, requireExternalDelegateJobs } from "../_core/authz/external-delegate-access";
import { assertMediaAccess, mediaAccessPort } from "../_core/authz/media-access";

const identity = (role = "delegate_manager", id = 7, isActive = 1) => ({ id, role, isActive });
const action = vi.fn(({ ctx }: any) => ({ id: ctx.user.id, role: ctx.user.role }));
const directory = vi.fn(() => [{ id: 99, name: "Private directory" }]);
const api = router({
  users: router({ list: protectedProcedure.query(directory), byRole: protectedProcedure.input(z.any()).query(directory) }),
  purchaseOrders: router({
    assignOwnDelegateItem: protectedProcedure.input(z.any()).mutation(action), delegateAssignmentOptions: protectedProcedure.query(action),
    review: managerProcedure.mutation(action), accounting: accountantProcedure.mutation(action), warehouse: warehouseProcedure.mutation(action),
    ownIdentity: protectedProcedure.query(action),
  }),
});
const caller = (actor = identity(), projected = false) => api.createCaller({ user: projected ? { ...actor, role: "admin" } : actor, authenticatedUser: actor } as any);
const scope = (id = 1, delegateId = 7) => ({ id, ticketId: 20, ticketItemId: 30, delegateId, status: "waiting_delegate_receipt", purchaseOrderId: null,
  gateExitApprovedAt: null, assetBeforePhotoUrl: "/api/media?key=cmms%2Fexternal.jpg", ticketExistsId: 20, ticketMaintenancePath: "A", ticketStatus: "work_approved",
  itemTicketId: 20, itemMaintenancePath: "C", itemStatus: "work_approved" });
beforeEach(() => { vi.clearAllMocks(); f.assignments = [{ purchaseOrderId: 1 }]; f.assigned.mockImplementation(async () => f.assignments); f.scopes = [scope()]; f.sql = []; f.error = null; });

describe("Delegate manager has delegate capability and the same record constraints", () => {
  it("is a delegate family role with no generic management, warehouse, catalog or reviewer rights", () => {
    expect(isDelegateRole(APP_ROLE.DELEGATE_MANAGER)).toBe(true);
    expect(ROLE_PERMISSIONS.delegate_manager).toEqual(ROLE_PERMISSIONS.delegate);
    expect(BYPASS_ALL_ROLES).not.toContain("delegate_manager");
    expect(canRoleAccessCatalogModule("delegate_manager")).toBe(false); expect(canRoleManagePmv2("delegate_manager")).toBe(false);
    for (const path of ["/", "/purchase-orders", "/purchase-packages", "/delegate-pricing-bundles", "/documents", "/warehouse-returns-followup", "/users", "/audit-log", "/tickets/inbox", "/catalog", "/scheduled-maintenance", "/construction", "/inventory-settlement-review"])
      expect(canRoleAccessPath("delegate_manager", path), path).toBe(canRoleAccessPath("delegate", path));
    expect(canReviewPurchaseItem(identity(), { reviewRole: "construction_procurement_manager", status: "pending_review" })).toBe(false);
  });

  it("matches every existing PO action/status/creator decision without granting approval or delegate-change resolution", () => {
    for (const status of Object.values(PO_STATUS)) for (const isCreator of [false, true]) for (const actionName of Object.keys(ACTION_POLICY)) {
      expect(canPerformAction(actionName as any, { role: "delegate_manager", userId: 7, isCreator }, { status }), `${actionName}:${status}:${isCreator}`)
        .toBe(canPerformAction(actionName as any, { role: "delegate", userId: 7, isCreator }, { status }));
    }
    for (const status of ["pending", "estimated", "approved", "purchased", "delivered_to_warehouse", "needs_item_revision", "cancelled"]) {
      for (const actionName of ["confirmDeliveryToWarehouse", "confirmDeliveryToRequester"] as const)
        expect(canPerformItemStatusAction(actionName, { role: "delegate_manager", userId: 7 }, status)).toBe(canPerformItemStatusAction(actionName, { role: "delegate", userId: 7 }, status));
      for (const isCreator of [false, true]) for (const actionName of ["editItem", "deleteItem"] as const) {
        const subject = { poStatus: "pending_review", itemStatus: status };
        expect(canPerformItemAction(actionName, { role: "delegate_manager", userId: 7, isCreator }, subject)).toBe(canPerformItemAction(actionName, { role: "delegate", userId: 7, isCreator }, subject));
      }
    }
    const pending = { delegateId: 7, itemStatus: "pending", batchId: null, estimatedUnitCost: null, delegateChangeRequestedAt: null };
    expect(canRequestPOItemDelegateChange({ role: "delegate_manager", userId: 7 }, pending)).toBe(true);
    expect(canRequestPOItemDelegateChange({ role: "delegate_manager", userId: 8 }, pending)).toBe(false);
    expect(canResolvePOItemDelegateChange({ role: "delegate_manager", userId: 7 }, { ...pending, delegateChangeRequestedAt: new Date() })).toBe(false);
  });

  it.each(["delegate", "delegate_manager"])("keeps %s out of the global directory even through an admin projection", async role => {
    for (const projected of [false, true]) {
      await expect(caller(identity(role), projected).users.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(identity(role), projected).users.byRole({ role: "delegate" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await caller(identity(role), projected).purchaseOrders.ownIdentity()).toEqual({ id: 7, role });
    }
    expect(directory).not.toHaveBeenCalled();
    for (const path of ["users.list", "users.byRole", "audit.list", "translation.getJobs", "tickets.inboxCounts"])
      expect(delegateDirectoryRpcAllowed(role, path)).toBe(false);
  });

  it.each(["delegate", "delegate_manager"])("does not grant manager/accountant/warehouse procedures to %s", async role => {
    for (const run of [() => caller(identity(role)).purchaseOrders.review(), () => caller(identity(role)).purchaseOrders.accounting(), () => caller(identity(role)).purchaseOrders.warehouse()])
      await expect(run()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(action).not.toHaveBeenCalled();
  });

  it("grants only the two exact manager assignment RPC types to an active actual manager", async () => {
    expect(await caller().purchaseOrders.delegateAssignmentOptions()).toEqual({ id: 7, role: "delegate_manager" });
    expect(await caller(identity(), true).purchaseOrders.assignOwnDelegateItem({ purchaseOrderId: 1, itemId: 2, delegateId: 8 })).toEqual({ id: 7, role: "delegate_manager" });
    for (const role of ["delegate", "admin", "owner", "observer", "maintenance_manager", "accountant", "warehouse"]) {
      await expect(caller(identity(role)).purchaseOrders.assignOwnDelegateItem({})).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(identity(role)).purchaseOrders.delegateAssignmentOptions()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(caller(identity("delegate_manager", 7, 0)).purchaseOrders.delegateAssignmentOptions()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(delegateManagerAssignmentRpcAllowed(identity(), "query", "purchaseOrders.assignOwnDelegateItem")).toBe(false);
    expect(delegateManagerAssignmentRpcAllowed(identity(), "mutation", "purchaseOrders.delegateAssignmentOptions")).toBe(false);
  });

  it.each(["delegate", "delegate_manager"])("loads %s assignment scope once per large list and refreshes on the next operation", async role => {
    const actor = identity(role), orders = Array.from({ length: 1001 }, (_, id) => ({ id: id % 3 + 1, requestedById: 99, status: "pending_estimate" }));
    const reader = await createPurchaseOrderReadScope(actor, orders);
    expect(reader.filter(orders)).toHaveLength(334); expect(f.assigned).toHaveBeenCalledTimes(1);
    expect(() => reader.assert({ id: 9, requestedById: 99, status: "approved" })).toThrow();
    f.assignments = [{ purchaseOrderId: 2 }];
    const fresh = await createPurchaseOrderReadScope(actor, orders);
    expect(() => fresh.assert({ id: 1, requestedById: 99, status: "approved" })).toThrow();
    expect(fresh.filter(orders)).toHaveLength(334); expect(f.assigned).toHaveBeenCalledTimes(2);
  });

  it.each(["delegate", "delegate_manager"])("checks %s PDF ownership, all members and parents anew at download time", async role => {
    let submittedById = 7, missing = false, failure = false;
    const source = { order: vi.fn(async (id: number) => { if (failure) throw Error("offline"); return missing ? null : { id, status: "pending_accounting", requestedById: 99 }; }),
      batch: async () => ({ purchaseOrderId: 1, submittedById }), submission: async () => ({ id: 4 }), batches: async () => [{ purchaseOrderId: 1, submittedById: 7 }, { purchaseOrderId: 2, submittedById }],
      authorize: async (user: any, order: any) => { if (!isPOVisible({ role: user.role, userId: user.id, delegateAssignedPoIds: [1] }, order)) throw Error("foreign parent denied"); } };
    await authorizePurchaseDocument(identity(role), 1, 3, undefined, source);
    submittedById = 8;
    await expect(authorizePurchaseDocument(identity(role), 1, 3, undefined, source)).rejects.toThrow();
    await expect(authorizePurchaseDocument(identity(role), 1, undefined, 4, source)).rejects.toThrow();
    submittedById = 7;
    await expect(authorizePurchaseDocument(identity(role), 1, undefined, 4, source)).rejects.toThrow("foreign parent denied");
    missing = true;
    await expect(authorizePurchaseDocument(identity(role), 1, 3, undefined, source)).rejects.toMatchObject({ code: "NOT_FOUND" });
    missing = false; failure = true;
    await expect(authorizePurchaseDocument(identity(role), 1, 3, undefined, source)).rejects.toThrow("offline");
    await expect(authorizePurchaseAttachment(identity(role), "po_financial_batch", 3, source)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(source.order).toHaveBeenCalledTimes(7);
  });

  it("batch-loads the manager's external scope by 500 IDs, denying foreign/missing parents and refreshing changes", async () => {
    f.scopes = Array.from({ length: 1001 }, (_, id) => scope(id + 1, id % 2 ? 8 : 7));
    const ids = f.scopes.map(row => row.id), loaded = await loadExternalDelegateScopes([...ids, ...ids]);
    expect([...loaded.values()].filter(row => isExternalDelegateJob(identity(), row))).toHaveLength(501);
    expect(f.sql.map(query => query.params.length)).toEqual([500, 500, 1]);
    await expect(requireExternalDelegateJobs(identity(), [1, 2])).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(requireExternalDelegateJobs(identity(), [9999])).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.scopes[0].delegateId = 8;
    await expect(requireExternalDelegateJobs(identity(), [1])).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.error = Error("offline");
    await expect(requireExternalDelegateJobs(identity(), [1])).rejects.toThrow("offline");
  });

  it.each(["delegate", "delegate_manager"])("limits %s external media to the exact assigned pre-gate asset photo", async role => {
    const port = { references: async () => [{ kind: "external", id: 1, parentId: 20 }], authorize: mediaAccessPort.authorize };
    await expect(assertMediaAccess(identity(role), "cmms/external.jpg", port)).resolves.toBe("cmms/external.jpg");
    await expect(assertMediaAccess(identity(role), "cmms/other.jpg", port)).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.scopes[0].itemTicketId = 99;
    await expect(assertMediaAccess(identity(role), "cmms/external.jpg", port)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(externalDelegateRpcAllowed(identity(role), "mutation", "externalMaintenance.decideDelegateReceipt")).toBe(true);
    expect(externalDelegateRpcAllowed(identity(role), "mutation", "externalMaintenance.listForDelegate")).toBe(false);
  });
});
