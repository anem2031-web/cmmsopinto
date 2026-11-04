import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { warehouseProcedure } from "../routers/_shared/procedures";
vi.mock("../_core/db", () => ({}));
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { returnExternalRoute, decideExternalRoute, readExternalRouteReviews, type RouteReviewPort } from "../services/external-route-review";
import { businessRpcAllowed } from "../../shared/business-role-policy";
import { createDemo } from "../maintenance-team-tickets/testing/fixture";

const warehouse = { id: 2, role: "warehouse", isActive: 1 };
const manager = { id: 3, role: "maintenance_manager" };
describe("existing workflow boundaries", () => {
  it("does not let the previous team-review action bypass the returned request", async () => {
    const d = createDemo();
    await d.service.assign(1, { ticketId: 1001, ticketItemId: 5001, ticketNumber: "SIM-MT-001", title: "عطل لوحة الإنارة", teamId: 21, responsibleManagerId: 1, location: { siteId: 1, sectionId: 11, assetId: 111 } });
    await d.store.transaction(async s => {
      const a = s.assignments[0]; a.stage = "blocked";
      s.actions.push({ id: 999, assignmentId: a.id, actorId: 2, kind: "external_route_returned", note: "Review", revision: a.revision, operationKey: "return-test", at: new Date().toISOString() });
    });
    const a = (await d.store.read()).assignments[0];
    await expect(d.service.review(1, { assignmentId: a.id, expectedRevision: a.revision, operationKey: "old-review" }, "return_to_team", "Review")).rejects.toThrow("A / B / C");
    expect((await d.store.read()).assignments[0].stage).toBe("blocked");
  });
  it.each([null, { maintenancePath: "C", status: "under_inspection" }, { maintenancePath: "A", status: "work_approved" }])("preparation rechecks the locked item before any write: %j", async item => {
    const source = ts.createSourceFile("db.ts", readFileSync("server/_core/db/external-maintenance.ts", "utf8"), ts.ScriptTarget.Latest, true);
    const fn = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "prepareExternalMaintenanceJob")!;
    const sourceLock = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "lockExternalSource")!;
    const lock = vi.fn(); const insert = vi.fn(); let read = 0;
    const tx = { insert, select: () => ({ from: () => ({ where: () => ({ for: async (mode: string) => { lock(mode); return ++read === 1 ? [{ id: 10 }] : item ? [item] : []; } }) }) }) };
    // Actor allow/deny is exercised by the real core transaction suite. This
    // focused AST contract still executes the production parent-lock helper.
    const context = vm.createContext({ withTransaction: (work: any) => work(tx), assertExternalActor: async () => {}, tickets: { id: "id" }, ticketItems: { id: "id", ticketId: "ticketId" }, eq: (...args: any[]) => args, and: (...args: any[]) => args });
    vm.runInContext(ts.transpileModule(sourceLock.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    const prepare = vm.runInContext(ts.transpileModule(`(${fn.getText(source).replace("export ", "")})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    await expect(prepare({ ticketId: 10, ticketItemId: 11, purchaseTitle: "إصلاح الأصل", assetName: "الأصل", assetBeforePhotoUrl: "/before.jpg", assetBeforeCondition: "عطل" })).rejects.toThrow("EXTERNAL_TICKET_INVALID_EXIT_STAGE");
    expect(lock).toHaveBeenCalledTimes(2); expect(insert).not.toHaveBeenCalled();
  });
});
function fixture(teamEnabled = true) {
  let state: any = {
    item: { id: 11, ticketId: 10, itemNumber: 1, status: "work_approved", maintenancePath: "C", approvedById: 3, assignedToId: 4 },
    team: teamEnabled ? { id: 21, teamId: 31, revision: 1, materialRound: 1, stage: "external_in_progress" } : null,
    history: [], notifications: [], jobs: [], needs: [], actions: [], active: true, reviewerRole: "maintenance_manager", readRows: null,
  };
  let serial = Promise.resolve();
  const queries: any[] = [];
  let failOn = "";
  const port: RouteReviewPort = { transaction(work) {
    const run = serial.then(async () => {
      const next = structuredClone(state);
      const result = await work({ async execute(query) {
        const q = new MySqlDialect().sqlToQuery(query); const s = q.sql.replace(/\s+/g, " ").trim(); const p = q.params;
        queries.push({ sql: s, params: p });
        if (failOn && s.includes(failOn)) throw Error("injected failure");
        if (s.startsWith("SELECT id,role,isActive FROM users")) return [[{ id: p[0], role: p[0] === 2 ? "warehouse" : p[0] === 1 ? "owner" : next.reviewerRole, isActive: next.active ? 1 : 0 }]];
        if (s.startsWith("SELECT id,teamId FROM ticket_team_assignments")) return [next.team ? [{ id: 21, teamId: 31 }] : []];
        if (s.startsWith("SELECT id FROM maintenance_teams")) return [[{ id: 31 }]];
        if (s.startsWith("SELECT * FROM tickets")) return [p[0] === 10 ? [{ id: 10 }] : []];
        if (s.startsWith("SELECT * FROM ticket_items")) return [p[0] === 11 && p[1] === 10 ? [next.item] : []];
        if (s.startsWith("SELECT * FROM ticket_team_assignments")) return [next.team ? [next.team] : []];
        if (s.startsWith("SELECT id FROM external_maintenance_jobs")) return [next.jobs];
        if (s.startsWith("SELECT id,action,newValues FROM audit_logs")) return [[...next.history].reverse().slice(0, 1)];
        if (s.startsWith("SELECT i.id AS ticketItemId")) {
          if (next.readRows) return [next.readRows];
          const last = next.history.at(-1);
          return [last?.action === "external_route_returned" && next.item.status === "under_inspection" ? [{ ...next.item, ticketItemId: 11, returnId: last.id, newValues: last.newValues }] : []];
        }
        if (s.startsWith("SELECT n.id,n.requestedQuantity")) return [next.needs];
        if (s.startsWith("SELECT id FROM users") || s.startsWith("SELECT DISTINCT u.id")) return [[{ id: 4 }]];
        if (s.startsWith("UPDATE ticket_items SET status='under_inspection'")) next.item.status = "under_inspection";
        else if (s.startsWith("UPDATE ticket_items SET status='work_approved',maintenancePath=")) { next.item.status = "work_approved"; next.item.maintenancePath = p[0]; next.item.approvedById = p[2]; }
        else if (s.startsWith("UPDATE ticket_team_assignments")) { next.team.stage = p[0]; next.team.outcome = p[1]; next.team.revision = p[2]; }
        else if (s.startsWith("INSERT INTO audit_logs")) next.history.push({ id: next.history.length + 1, action: p[1], newValues: p[3] });
        else if (s.startsWith("INSERT INTO notifications")) next.notifications.push(p);
        else if (s.startsWith("INSERT INTO ticket_team_actions")) next.actions.push(p);
        else if (!(s.startsWith("UPDATE tickets") || s.startsWith("INSERT INTO ticket_status_history"))) throw Error(`Unhandled query: ${s}`);
        return [{ affectedRows: 1 }];
      } });
      state = next;
      return result;
    });
    serial = run.then(() => {}, () => {});
    return run;
  } };
  return { port, queries, get state() { return state; }, fail: (text: string) => { failOn = text; } };
}
const input = { ticketId: 10, ticketItemId: 11, reason: "Internal repair is possible" };
describe("external route review: atomic same workflow from either window", () => {
  it.each([true, false])("returns team=%s only before preparation and preserves original item", async team => {
    const f = fixture(team);
    await returnExternalRoute(warehouse, input, f.port);
    expect(f.state.item.status).toBe("under_inspection");
    expect(f.state.item.id).toBe(11);
    if (team) expect(f.state.team.stage).toBe("blocked");
    expect(f.state.history[0].action).toBe("external_route_returned");
    expect(f.state.notifications[0][0]).toBe(3);
  });
  it.each(["A", "B", "C"] as const)("applies %s once and rejects the other window's stale decision", async path => {
    const f = fixture(); await returnExternalRoute(warehouse, input, f.port);
    const decision = { ...input, returnId: 1, path };
    await decideExternalRoute(manager, decision, f.port);
    expect(f.state.item.maintenancePath).toBe(path);
    expect(f.state.team.stage).toBe({ A: "action_required", B: "waiting_material", C: "external_in_progress" }[path]);
    const notifications = f.state.notifications.length;
    await expect(decideExternalRoute(manager, decision, f.port)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.state.notifications).toHaveLength(notifications);
  });
  it("serializes concurrent decisions and duplicate warehouse returns", async () => {
    const f = fixture();
    const first = await Promise.allSettled([returnExternalRoute(warehouse, input, f.port), returnExternalRoute(warehouse, input, f.port)]);
    expect(first.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const second = await Promise.allSettled([decideExternalRoute(manager, { ...input, returnId: 1, path: "A" }, f.port), decideExternalRoute(manager, { ...input, returnId: 1, path: "C" }, f.port)]);
    expect(second.filter(r => r.status === "fulfilled")).toHaveLength(1);
  });
  it("rejects prepared, foreign, missing and non-C items without any write", async () => {
    const prepared = fixture(); prepared.state.jobs = [{ id: 99 }];
    await expect(returnExternalRoute(warehouse, input, prepared.port)).rejects.toMatchObject({ code: "CONFLICT" });
    const f = fixture();
    await expect(returnExternalRoute(warehouse, { ...input, ticketId: 999 }, f.port)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(returnExternalRoute(warehouse, { ...input, ticketItemId: 999 }, f.port)).rejects.toMatchObject({ code: "NOT_FOUND" });
    f.state.item.maintenancePath = "A";
    await expect(returnExternalRoute(warehouse, input, f.port)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.state.history).toHaveLength(0);
  });
  it("checks exact approver again at write; other managers and warehouse cannot decide", async () => {
    const f = fixture(); await returnExternalRoute(warehouse, input, f.port);
    await expect(decideExternalRoute({ ...manager, id: 99 }, { ...input, returnId: 1, path: "A" }, f.port)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(decideExternalRoute(warehouse, { ...input, returnId: 1, path: "A" }, f.port)).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.state.active = false;
    await expect(decideExternalRoute(manager, { ...input, returnId: 1, path: "A" }, f.port)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.state.item.status).toBe("under_inspection");
  });
  it("uses one scoped read join, with no reuse between actors or after decision", async () => {
    const f = fixture(); await returnExternalRoute(warehouse, input, f.port);
    const start = f.queries.length;
    expect(await readExternalRouteReviews(manager, 10, f.port)).toHaveLength(1);
    expect(f.queries.length - start).toBe(2);
    expect(await readExternalRouteReviews({ ...manager, id: 99 }, 10, f.port)).toHaveLength(0);
    await decideExternalRoute(manager, { ...input, returnId: 1, path: "A" }, f.port);
    expect(await readExternalRouteReviews(manager, 10, f.port)).toHaveLength(0);
  });
  it("rolls back path, team, audit and notification on failure", async () => {
    const f = fixture(); f.fail("INSERT INTO notifications");
    await expect(returnExternalRoute(warehouse, input, f.port)).rejects.toThrow("injected failure");
    expect(f.state.item.maintenancePath).toBe("C");
    expect(f.state.team.stage).toBe("external_in_progress");
    expect(f.state.history).toHaveLength(0);
  });
  it("rolls back a decision if notification persistence fails", async () => {
    const f = fixture(); await returnExternalRoute(warehouse, input, f.port);
    f.fail("INSERT INTO notifications");
    await expect(decideExternalRoute(manager, { ...input, returnId: 1, path: "B" }, f.port)).rejects.toThrow("injected failure");
    expect(f.state.item.status).toBe("under_inspection");
    expect(f.state.team.stage).toBe("blocked");
    expect(f.state.history).toHaveLength(1);
  });
  it("supports the exact IT approver and admin-owner recovery without granting IT members", async () => {
    const f = fixture(); f.state.reviewerRole = "it_manager";
    await returnExternalRoute(warehouse, input, f.port);
    expect(await readExternalRouteReviews({ id: 3, role: "it_manager" }, 10, f.port)).toHaveLength(1);
    await expect(decideExternalRoute({ id: 3, role: "it_member" }, { ...input, returnId: 1, path: "C" }, f.port)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await decideExternalRoute({ id: 1, role: "owner" }, { ...input, returnId: 1, path: "C" }, f.port);
    expect(f.state.item.approvedById).toBe(1);
  });
  it("does not update the ticket header for a secondary item", async () => {
    const f = fixture(false); f.state.item.itemNumber = 2;
    await returnExternalRoute(warehouse, input, f.port);
    await decideExternalRoute(manager, { ...input, returnId: 1, path: "A" }, f.port);
    expect(f.queries.some(q => q.sql.startsWith("UPDATE tickets"))).toBe(false);
  });
  it("a large mixed list keeps each decision independent without per-row reads", async () => {
    const f = fixture();
    f.state.readRows = Array.from({ length: 1001 }, (_, i) => ({ ticketItemId: i + 1, itemNumber: i + 1, returnId: i + 1, approvedById: i % 2 ? 99 : 3, newValues: JSON.stringify({ ticketId: 10, reviewerId: i % 2 ? 99 : 3, reason: "Review" }) }));
    expect(await readExternalRouteReviews(manager, 10, f.port)).toHaveLength(501);
    expect(f.queries).toHaveLength(2);
    expect(await readExternalRouteReviews({ ...manager, id: 99 }, 10, f.port)).toHaveLength(500);
    expect(f.queries).toHaveLength(4);
  });
  it("keeps active material needs; received B needs resume repair", async () => {
    const f = fixture(); await returnExternalRoute(warehouse, input, f.port);
    f.state.needs = [{ id: 4, requestedQuantity: 2, usedQuantity: 0, delivered: 2 }];
    await expect(decideExternalRoute(manager, { ...input, returnId: 1, path: "A" }, f.port)).rejects.toMatchObject({ code: "CONFLICT" });
    await decideExternalRoute(manager, { ...input, returnId: 1, path: "B" }, f.port);
    expect(f.state.team.stage).toBe("ready_to_repair");
  });
  it("grants only the warehouse return capability to guarded business roles", () => {
    expect(businessRpcAllowed(warehouse, "mutation", "externalMaintenance.returnForRouteReview")).toBe(true);
    for (const role of ["accountant", "senior_management", "executive_director", "food_warehouse_assistant"]) {
      expect(businessRpcAllowed({ id: 2, role, isActive: 1 }, "mutation", "externalMaintenance.returnForRouteReview")).toBe(false);
    }
    expect(businessRpcAllowed(warehouse, "mutation", "externalMaintenance.decideRouteReview")).toBe(false);
  });
});

describe("direct RPC boundary uses the production endpoint declarations", () => {
  function api(f: ReturnType<typeof fixture>) {
    const source = ts.createSourceFile("router.ts", readFileSync("server/routers/external-maintenance/external-maintenance.router.ts", "utf8"), ts.ScriptTarget.Latest, true);
    const fields: Record<string, any> = {};
    function visit(node: ts.Node) {
      if (ts.isPropertyAssignment(node) && ["returnForRouteReview", "routeReviews", "decideRouteReview"].includes(node.name.getText(source))) {
        fields[node.name.getText(source)] = vm.runInNewContext(ts.transpileModule(`(${node.initializer.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
          z, protectedProcedure, warehouseProcedure,
          returnExternalRoute: (a: any, i: any) => returnExternalRoute(a, i, f.port),
          readExternalRouteReviews: (a: any, id: number) => readExternalRouteReviews(a, id, f.port),
          decideExternalRoute: (a: any, i: any) => decideExternalRoute(a, i, f.port),
        });
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    return router({ externalMaintenance: router(fields) });
  }
  it("allows warehouse return, denies direct unauthorized decision, and shares the same manager save", async () => {
    const f = fixture(); const root = api(f);
    const call = (user: any) => root.createCaller({ user: { ...user, isActive: 1 } } as any).externalMaintenance as any;
    await call(warehouse).returnForRouteReview(input);
    await expect(call(warehouse).decideRouteReview({ ...input, returnId: 1, path: "A" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(call({ id: 3, role: "it_member" }).decideRouteReview({ ...input, returnId: 1, path: "A" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await call(manager).routeReviews({ ticketId: 10 })).toHaveLength(1);
    await call(manager).decideRouteReview({ ...input, returnId: 1, path: "A" });
    await expect(call(manager).decideRouteReview({ ...input, returnId: 1, path: "B" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

