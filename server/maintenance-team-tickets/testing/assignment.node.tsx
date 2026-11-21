import React from "react";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { TicketTeamAssignmentService } from "../assignment/service";
import { SqlTicketTeamAssignmentRepository, type TicketPromotionPort } from "../../routers/maintenance-teams/assignment.repository";
import { createTicketTeamAssignmentRouter } from "../../routers/maintenance-teams/assignment.router";
import { router } from "../../routers/_shared/procedures";
import { AssignedTicketsView } from "../../../client/src/features/maintenance-team-tickets/AssignedTicketsView";
import type { AssignmentContext, AssignmentTeam, TeamAssignmentRepository, AssignedTeamTicket } from "../../../shared/maintenance-team-tickets/assignment";
import type { TeamManagementActor } from "../../../shared/maintenance-team-tickets/team-management";
import { supportsTeamTaskAssignmentDepartment } from "../../../client/src/pages/maintenance-teams/TeamTaskAssignment";

const actor: TeamManagementActor = { id: 7, role: "general_maintenance_manager", active: true };
const input = { ticketId: 1, taskId: 2, teamId: 3, inspectionMinutes: 120 };
function fixture() {
  const context: AssignmentContext = { parent: { id: 1, ticketNumber: "MT-2026-00566", workflowModel: "department_tasks", status: "department_planning" }, department: { id: 4, ticketId: 1, department: "maintenance_report_department_general", responsibleManagerId: 7 }, task: { id: 2, ticketId: 1, ticketDepartmentId: 4, status: "pending_assignment", convertedTicketId: null } };
  const team: AssignmentTeam = { id: 3, name: "فريق الكهرباء", active: true, warehouseId: 8, warehouseActive: true, warehouseType: "branch", memberCount: 2 };
  let calls = 0, created = 0, names = 0;
  let previous: any = null;
  const repo: TeamAssignmentRepository = {
    candidates: async () => { calls++; return [team]; }, queue: async () => { calls++; return []; },
    transaction: async work => { calls++; return work({ lockContext: async () => context, existing: async () => previous, namedAssigneeCount: async () => names, lockTeam: async () => team,
      create: async () => { created++; context.task.convertedTicketId = 11; previous = { ticketId: 11, ticketNumber: "MT-2026-00566-01", assignmentId: 12, teamId: 3 }; return { ...previous, alreadyExisting: false }; } }); },
  };
  return { context, team, service: new TicketTeamAssignmentService(repo), calls: () => calls, created: () => created, setNames: (n: number) => { names = n; } };
}
test("assignment creates once and repeated request returns same ticket", async () => {
  const f = fixture(); const first = await f.service.assign(actor, input); const second = await f.service.assign(actor, input);
  assert.equal(first.ticketNumber, "MT-2026-00566-01"); assert.equal(second.alreadyExisting, true); assert.equal(f.created(), 1);
  await assert.rejects(f.service.assign(actor, { ...input, teamId: 9 }));
});
test("roles/inactive actor rejected before repository access", async () => {
  for (const a of [{ ...actor, role: "technician" }, { ...actor, active: false }]) {
    const f = fixture(); await assert.rejects(f.service.assign(a, input)); assert.equal(f.calls(), 0);
  }
});
test("construction manager can assign a team only to their own construction department", async () => {
  const construction = { ...actor, role: "construction_procurement_manager" };
  const allowed = fixture();
  allowed.context.department.department = "maintenance_report_department_construction";
  const result = await allowed.service.assign(construction, input);
  assert.equal(result.ticketNumber, "MT-2026-00566-01");

  const foreign = fixture();
  foreign.context.department.department = "maintenance_report_department_construction";
  foreign.context.department.responsibleManagerId = 99;
  await assert.rejects(foreign.service.assign(construction, input));
  assert.equal(foreign.created(), 0);

  const general = fixture();
  await assert.rejects(general.service.assign(construction, input));
  assert.equal(general.created(), 0);
});
test("construction team assignment does not expand to IT or unrelated maintenance roles", async () => {
  for (const role of ["maintenance_manager", "general_maintenance_manager"]) {
    const f = fixture();
    f.context.department.department = "maintenance_report_department_construction";
    await assert.rejects(f.service.assign({ ...actor, role }, input));
    assert.equal(f.created(), 0);
  }
  const it = fixture();
  it.context.department.department = "maintenance_report_department_it";
  await assert.rejects(it.service.assign({ ...actor, role: "owner" }, input));
  assert.equal(it.created(), 0);
});
test("team assignment selector is enabled only for general maintenance and construction", () => {
  assert.equal(supportsTeamTaskAssignmentDepartment("maintenance_report_department_general"), true);
  assert.equal(supportsTeamTaskAssignmentDepartment("maintenance_report_department_construction"), true);
  assert.equal(supportsTeamTaskAssignmentDepartment("maintenance_report_department_it"), false);
  assert.equal(supportsTeamTaskAssignmentDepartment(null), false);
});
test("ownership, cross-ticket task and foreign department rejected", async () => {
  for (const mutate of [(c: AssignmentContext) => c.department.responsibleManagerId = 99, (c: AssignmentContext) => c.task.ticketId = 99, (c: AssignmentContext) => c.department.department = "maintenance_report_department_it", (c: AssignmentContext) => c.task.ticketDepartmentId = 99]) {
    const f = fixture(); mutate(f.context); await assert.rejects(f.service.assign(actor, input)); assert.equal(f.created(), 0);
  }
});
test("closed parent, cancelled task, wrong workflow rejected for owner too", async () => {
  for (const mutate of [(c: AssignmentContext) => c.parent.status = "closed", (c: AssignmentContext) => c.parent.status = "requester_confirmed", (c: AssignmentContext) => c.task.status = "cancelled", (c: AssignmentContext) => c.parent.workflowModel = "sub_ticket"]) {
    const f = fixture(); mutate(f.context); await assert.rejects(f.service.assign({ ...actor, role: "owner" }, input)); assert.equal(f.created(), 0);
  }
});
test("existing assignment by name cannot be switched or overwritten", async () => {
  const f = fixture(); f.setNames(1); await assert.rejects(f.service.assign(actor, input)); assert.equal(f.created(), 0);
  const g = fixture(); g.context.task.status = "assigned"; await assert.rejects(g.service.assign(actor, input));
});
test("invalid team/warehouse/members rejected and excluded from candidates", async () => {
  for (const mutate of [(t: AssignmentTeam) => t.active = false, (t: AssignmentTeam) => t.warehouseActive = false, (t: AssignmentTeam) => t.warehouseType = "main", (t: AssignmentTeam) => t.memberCount = 0]) {
    const f = fixture(); mutate(f.team); await assert.rejects(f.service.assign(actor, input)); assert.equal(f.created(), 0); assert.deepEqual(await f.service.candidates(actor), []);
  }
});
test("invalid identifiers rejected before repository access", async () => {
  const f = fixture(); await assert.rejects(f.service.assign(actor, { ...input, taskId: -2 })); assert.equal(f.calls(), 0);
});
test("inspection duration is required and must be a whole positive number of minutes", async () => {
  for (const inspectionMinutes of [0, -1, 1.5, 525601, NaN]) {
    const f = fixture(); await assert.rejects(f.service.assign(actor, { ...input, inspectionMinutes })); assert.equal(f.calls(), 0);
  }
});
test("queue denies unsupported roles before loading repository", async () => {
  const f = fixture(); await assert.rejects(f.service.queue({ ...actor, role: "accountant" })); assert.equal(f.calls(), 0);
  await f.service.queue({ ...actor, role: "technician" }); assert.equal(f.calls(), 1);
  await f.service.queue({ ...actor, role: "warehouse" }); assert.equal(f.calls(), 2);
});

function sqlFixture(failAt = "") {
  const dialect = new MySqlDialect();
  let committed: string[] = [], rolledBack = false;
  const queries: { text: string; params: unknown[] }[] = [];
  const lockOrder: string[] = [];
  const state = { sequence: 0, child: 0, item: 0, promoted: false };
  const port: TicketPromotionPort = {
    lockTicketForSubTicketSequence: async () => { lockOrder.push("parent"); }, lockTicketDepartmentForTaskSequence: async () => { lockOrder.push("department"); }, lockTicketTaskForPromotion: async () => { lockOrder.push("task"); },
    getTicketById: async () => ({ ...fixture().context.parent, title: "بلاغ", siteId: 1, sectionId: 2, reportedById: 5, priority: "medium" }),
    getTicketTaskById: async () => ({ ...fixture().context.task, convertedTicketId: state.promoted ? 11 : null, title: "إصلاح", taskNumber: 1, description: "افحص الكهرباء" }),
    getTicketDepartmentById: async () => fixture().context.department,
    allocateNextSubTicketSequence: async () => ++state.sequence,
    createTicket: async data => { assert.equal(data.assignedToId, null); assert.equal(data.workflowModel, "sub_ticket"); return state.child = 11; },
    createTicketItem: async data => { if (failAt === "item") throw new Error("injected item failure"); assert.equal(data.ticketId, 11); assert.equal(data.assignedToId, null); return state.item = 22; },
    updateTicketTask: async () => { state.promoted = true; }, updateTicketDepartment: async () => {},
  };
  const execute = async (q: any) => {
    const compiled = dialect.sqlToQuery(q); queries.push({ text: compiled.sql, params: compiled.params });
    const text = compiled.sql;
    if (text.startsWith("SELECT id AS assignmentId") && state.promoted) return [[{ assignmentId: 33, ticketId: 11, ticketNumber: "MT-2026-00566-01", teamId: 3 }], []];
    if (text.includes("FROM maintenance_teams") && text.includes("FOR UPDATE")) lockOrder.push("team");
    if (text.startsWith("SELECT id,name,warehouseId")) return [[{ id: 3, name: "فريق الكهرباء", warehouseId: 8, isActive: 1 }], []];
    if (text.startsWith("SELECT type,isActive")) return [[{ type: "branch", isActive: 1 }], []];
    if (text.startsWith("SELECT m.userId")) return [[{ userId: 10 }, { userId: 11 }], []];
    if (text.startsWith("SELECT COUNT")) return [[{ total: 0 }], []];
    if (failAt && text.includes(failAt)) throw new Error("injected write failure");
    if (text.startsWith("INSERT")) return [{ insertId: 33 }, []];
    return [[], []];
  };
  let tail: Promise<unknown> = Promise.resolve();
  const db = { execute, transaction: <T,>(work: (tx: any) => Promise<T>) => {
    const run = tail.then(async () => {
    const before = { ...state }; const start = queries.length;
    try { const result = await work({ execute }); committed = queries.slice(start).map(q => q.text); return result; }
    catch (e) { Object.assign(state, before); rolledBack = true; throw e; }
    });
    tail = run.catch(() => {}); return run;
  } };
  const repo = new SqlTicketTeamAssignmentRepository(async () => ({ db, tickets: port }));
  return { repo, state, queries, lockOrder, committed: () => committed, rolledBack: () => rolledBack };
}
test("SQL adapter writes original child/item plus team link/history/audit within one transaction", async () => {
  const f = sqlFixture(); const result = await new TicketTeamAssignmentService(f.repo).assign(actor, input);
  assert.equal(result.assignmentId, 33); assert.equal(f.state.promoted, true);
  assert.deepEqual(f.lockOrder, ["parent", "department", "task", "team"]);
  assert.ok(f.committed().some(q => q.includes("INSERT INTO ticket_team_assignments")));
  assert.ok(f.committed().some(q => q.includes("INSERT INTO audit_logs")));
  assert.ok(f.queries.some(q => q.text.includes("maintenance_teams") && q.text.includes("FOR UPDATE")));
  assert.ok(f.queries.some(q => q.text.includes("maintenance_team_members") && q.text.includes("FOR UPDATE")));
  const insert = f.queries.find(q => q.text.includes("INSERT INTO ticket_team_assignments"))!;
  assert.ok(insert.params.includes(22)); assert.ok(insert.params.includes("MT-2026-00566-01"));
  const protocol = f.queries.find(q => q.text.includes("INSERT INTO ticket_team_actions"))!;
  assert.ok(protocol.params.includes(JSON.stringify({ version: 1, inspectionMinutes: 120 })));
  assert.doesNotMatch(f.committed().join(" "), /pmv2_|INSERT INTO users|INSERT INTO warehouses|inventory_transactions/);
});
test("SQL adapter failures roll back sequence, ticket, item, task and links including audit failure", async () => {
  for (const table of ["item", "INSERT INTO ticket_team_assignments", "INSERT INTO ticket_status_history", "INSERT INTO audit_logs"]) {
    const f = sqlFixture(table); await assert.rejects(new TicketTeamAssignmentService(f.repo).assign(actor, input));
    assert.equal(f.rolledBack(), true); assert.deepEqual(f.state, { sequence: 0, child: 0, item: 0, promoted: false }); assert.deepEqual(f.committed(), []);
  }
});
test("parallel requests serialize on the existing promotion locks and create only one sub-ticket", async () => {
  const f = sqlFixture(); const service = new TicketTeamAssignmentService(f.repo);
  const results = await Promise.all([service.assign(actor, input), service.assign(actor, input)]);
  assert.equal(f.state.sequence, 1); assert.equal(results.filter(r => r.alreadyExisting).length, 1);
  assert.equal(f.queries.filter(q => q.text.startsWith("INSERT INTO ticket_team_assignments")).length, 1);
});
test("queue SQL scopes technicians by membership and lets authorized managers view all teams", async () => {
  const f = sqlFixture(); await f.repo.queue({ ...actor, role: "technician", id: 42 });
  const q = f.queries.at(-1)!; assert.match(q.text, /m.userId=\?/); assert.ok(q.params.includes(42)); assert.match(q.text, /m.isActive=1/); assert.match(q.text, /i.ticketId=a.ticketId/);
  for (const role of ["owner", "admin", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager"]) {
    await f.repo.queue({ ...actor, role }); assert.match(f.queries.at(-1)!.text, /WHERE TRUE/); assert.doesNotMatch(f.queries.at(-1)!.text, /a.responsibleManagerId=\?/);
  }
});
test("construction manager can read team queue and candidates without gaining general-maintenance assignment", async () => {
  const f = fixture(), construction = { ...actor, role: "construction_procurement_manager" };
  await f.service.queue(construction); assert.equal(f.calls(), 1);
  await f.service.candidates(construction); assert.equal(f.calls(), 2);
  await assert.rejects(f.service.assign(construction, input));
  assert.equal(f.calls(), 3);
});
test("warehouse material request queue rejects all other roles before repository access", async () => {
  for (const role of ["technician", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager", "accountant"]) {
    const f = fixture(); await assert.rejects(f.service.warehouseRequests({ ...actor, role })); assert.equal(f.calls(), 0);
  }
  const inactive = fixture(); await assert.rejects(inactive.service.warehouseRequests({ ...actor, role: "warehouse", active: false })); assert.equal(inactive.calls(), 0);
  for (const role of ["warehouse", "owner", "admin"]) {
    const f = fixture(); await f.service.warehouseRequests({ ...actor, role }); assert.equal(f.calls(), 1);
  }
});
test("warehouse API requests a materials-only list and retains completed assignments for pending returns", async () => {
  const f = sqlFixture(), service = new TicketTeamAssignmentService(f.repo);
  // Compose the router under its production namespace so the central capability
  // guard receives the real RPC path (`ticketTeamAssignments.warehouseRequests`).
  const caller = router({ ticketTeamAssignments: createTicketTeamAssignmentRouter(service) })
    .createCaller({ user: { id: 2, role: "warehouse", isActive: 1 } } as any);
  await caller.ticketTeamAssignments.warehouseRequests();
  const q = f.queries.at(-1)!;
  assert.match(q.text, /EXISTS \(SELECT 1 FROM ticket_team_material_needs n WHERE n.assignmentId=a.id\)/);
  assert.match(q.text, /i.ticketId=a.ticketId/);
  assert.doesNotMatch(q.text, /pmv2_|stage='waiting_material'|stage!='closed'/);
  await service.queue({ ...actor, role: "warehouse" });
  assert.doesNotMatch(f.queries.at(-1)!.text, /ticket_team_material_needs/);
});
test("API rejects forged actor fields and enforces server actor", async () => {
  const f = fixture(); const caller = createTicketTeamAssignmentRouter(f.service).createCaller({ user: { ...actor, isActive: 1 } } as any);
  await assert.rejects(caller.assign({ ...input, actorId: 99 } as any)); assert.equal(f.calls(), 0);
  const result = await caller.assign(input); assert.equal(result.ticketId, 11);
});
test("registering the assignment adapter and router never invokes the database provider", () => {
  let loaded = false;
  const repository = new SqlTicketTeamAssignmentRepository(async () => { loaded = true; throw new Error("must not load"); });
  createTicketTeamAssignmentRouter(new TicketTeamAssignmentService(repository));
  assert.equal(loaded, false);
});
test("assigned ticket view identifies ticket/team and has no enabled execution actions", () => {
  const row: AssignedTeamTicket = { assignmentId: 1, ticketId: 11, ticketNumber: "MT-2026-00566-01", title: "عطل", teamId: 3, teamName: "فريق الكهرباء", warehouseName: "مستودع الكهرباء", stage: "action_required", sourceStatus: "under_inspection", siteName: "المركز", sectionName: "الورشة", description: "افحص اللوحة" };
  const html = renderToStaticMarkup(<AssignedTicketsView tickets={[row]} language="ar" />);
  assert.match(html, /MT-2026-00566-01/); assert.match(html, /فريق الكهرباء/); assert.match(html, /افحص اللوحة/); assert.doesNotMatch(html, /<button|<form/);
});
