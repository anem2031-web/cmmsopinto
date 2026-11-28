import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "../_core/trpc";
import {
  externalMaintenanceWarehouseReadProcedure,
  warehouseProcedure,
} from "../routers/_shared/procedures";
import { APP_ROLE, canRoleAccessPath } from "../../shared/roles";
import { businessPageAllowed, businessRpcAllowed } from "../../shared/business-role-policy";
import { observerRpcAllowed } from "../../shared/observer-policy";

const f = vi.hoisted(() => ({
  waiting: vi.fn(), jobs: vi.fn(), write: vi.fn(),
}));
// A closed mock keeps the isolated guard tests away from environment/live DB code.
vi.mock("../_core/db", () => ({}));

const sourcePath = "server/routers/external-maintenance/external-maintenance.router.ts";
function actualProcedure(name: string) {
  const source = ts.createSourceFile(sourcePath, readFileSync(sourcePath, "utf8"), ts.ScriptTarget.Latest, true);
  let expression = "";
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === name) expression = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!expression) throw new Error(`Missing production procedure ${name}`);
  return vm.runInNewContext(ts.transpileModule(`(${expression})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    z, TRPCError, warehouseProcedure, externalMaintenanceWarehouseReadProcedure,
    db: {
      listPathCTicketsWaitingWarehousePreparation: f.waiting,
      listExternalMaintenanceJobs: f.jobs,
    },
    returnExternalRoute: f.write,
  });
}
const writers = ["returnForRouteReview", "prepareByWarehouse", "receiveByWarehouse", "handoverByWarehouse"] as const;
const api = router({ externalMaintenance: router({
  listForWarehouse: actualProcedure("listForWarehouse"),
  ...Object.fromEntries(writers.map(name => [name, actualProcedure(name)])),
}) });
const identity = (role = "senior_management", isActive = 1) => ({ id: 37, role, isActive });
const context = (role = "senior_management", isActive = 1, projected = false): any => {
  const actual = identity(role, isActive);
  return { user: projected ? { ...actual, role: "admin" } : actual, authenticatedUser: actual, req: {}, res: {} };
};
const call = (role = "senior_management", isActive = 1, projected = false): any => api.createCaller(context(role, isActive, projected)).externalMaintenance;
const routeInput = { ticketId: 100, ticketItemId: 200, reason: "Review the selected maintenance path" };
beforeEach(() => {
  vi.clearAllMocks();
  f.waiting.mockResolvedValue([{ ticketId: 100, ticketItemId: 200, ticketNumber: "MT-100" }]);
  f.jobs.mockResolvedValue([{ job: { id: 10, ticketId: 100, ticketItemId: 201, status: "purchase_cycle" }, ticketNumber: "MT-100" }]);
  f.write.mockResolvedValue({ success: true });
});

describe("External maintenance senior oversight", () => {
  it("grants the existing page and only its read capability", () => {
    expect(canRoleAccessPath("senior_management", "/external-maintenance")).toBe(true);
    expect(canRoleAccessPath("senior_management", "/external-maintenance?view=receipt")).toBe(true);
    expect(businessPageAllowed("senior_management", "/external-maintenance")).toBe(true);
    expect(businessRpcAllowed(identity(), "query", "externalMaintenance.listForWarehouse")).toBe(true);
    expect(businessRpcAllowed(identity(), "mutation", "externalMaintenance.listForWarehouse")).toBe(false);
    for (const name of writers) expect(businessRpcAllowed(identity(), "mutation", `externalMaintenance.${name}`)).toBe(false);
    for (const name of ["approveGateExit", "approveGateEntry", "decideDelegateReceipt", "confirmDelegateReadyForReturn"])
      expect(businessRpcAllowed(identity(), "mutation", `externalMaintenance.${name}`)).toBe(false);
    expect(businessRpcAllowed(identity(), "query", "externalMaintenance.listForGate")).toBe(false);
    expect(businessRpcAllowed(identity(), "query", "externalMaintenance.listForDelegate")).toBe(false);
  });
  it.each(["accountant", "executive_director", "food_warehouse_assistant"] as const)("does not grant the page to %s", role => {
    expect(businessPageAllowed(role, "/external-maintenance")).toBe(false);
    expect(businessRpcAllowed(identity(role), "query", "externalMaintenance.listForWarehouse")).toBe(false);
  });
  it.each(["warehouse", "senior_management", "admin", "owner"])("retains the same list response for %s", async role => {
    const value = await call(role).listForWarehouse();
    expect(value).toEqual({ waitingPreparation: await f.waiting.mock.results[0].value, jobs: await f.jobs.mock.results[0].value });
    expect(f.waiting).toHaveBeenCalledTimes(1);
    expect(f.jobs).toHaveBeenCalledTimes(1);
    expect(f.jobs).toHaveBeenCalledWith(expect.arrayContaining(["waiting_delegate_receipt", "waiting_warehouse_receipt", "closed"]));
    expect(f.write).not.toHaveBeenCalled();
  });
  it.each(Object.values(APP_ROLE).filter(role => !["warehouse", "senior_management", "admin", "owner", "observer"].includes(role)))("denies list access to %s before the reader", async role => {
    await expect(call(role).listForWarehouse()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.waiting).not.toHaveBeenCalled(); expect(f.jobs).not.toHaveBeenCalled();
  });
  it("preserves the existing observer policy rather than granting a new observer capability", async () => {
    const result = call("observer").listForWarehouse();
    if (observerRpcAllowed("observer", "query", "externalMaintenance.listForWarehouse")) await expect(result).resolves.toHaveProperty("jobs");
    else await expect(result).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("rejects disabled senior and warehouse identities and missing authentication", async () => {
    for (const role of ["senior_management", "warehouse"]) await expect(call(role, 0).listForWarehouse()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect((api.createCaller({ user: null, req: {}, res: {} } as any).externalMaintenance as any).listForWarehouse()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(f.waiting).not.toHaveBeenCalled(); expect(f.jobs).not.toHaveBeenCalled();
  });
  it.each(writers)("blocks senior direct %s even with an admin display projection", async name => {
    await expect(call()[name](name === "returnForRouteReview" ? routeInput : {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(call("senior_management", 1, true)[name](name === "returnForRouteReview" ? routeInput : {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.write).not.toHaveBeenCalled(); expect(f.waiting).not.toHaveBeenCalled(); expect(f.jobs).not.toHaveBeenCalled();
  });
  it.each(["warehouse", "admin", "owner"])("preserves warehouse route-review writing for %s", async role => {
    await expect(call(role).returnForRouteReview(routeInput)).resolves.toEqual({ success: true });
    expect(f.write).toHaveBeenCalledWith(expect.objectContaining({ role }), routeInput);
    expect(f.write).toHaveBeenCalledTimes(1);
  });
  it("keeps the two batched reads bounded for large repeated-parent queues and rechecks the next request", async () => {
    const jobs = Array.from({ length: 1200 }, (_, index) => ({ job: { id: index + 1, ticketId: 100, status: "purchase_cycle" }, ticketNumber: "MT-100" }));
    f.jobs.mockResolvedValue(jobs); f.waiting.mockResolvedValue([]);
    expect((await call().listForWarehouse()).jobs).toEqual(jobs);
    expect(f.waiting).toHaveBeenCalledTimes(1); expect(f.jobs).toHaveBeenCalledTimes(1);
    await expect(call("senior_management", 0).listForWarehouse()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(call("accountant").listForWarehouse()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.waiting).toHaveBeenCalledTimes(1); expect(f.jobs).toHaveBeenCalledTimes(1);
    f.jobs.mockResolvedValue([]);
    expect((await call().listForWarehouse()).jobs).toEqual([]);
    expect(f.waiting).toHaveBeenCalledTimes(2); expect(f.jobs).toHaveBeenCalledTimes(2);
  });
  it("propagates infrastructure failures rather than returning an empty success", async () => {
    f.jobs.mockRejectedValue(new Error("Fixture database unavailable"));
    await expect(call().listForWarehouse()).rejects.toThrow("Fixture database unavailable");
  });
});
