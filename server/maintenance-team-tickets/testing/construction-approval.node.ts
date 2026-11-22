import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemo } from "./fixture";
import { TeamTicketError } from "../../../shared/maintenance-team-tickets/model";
import { canApproveTicketTeamResult, canReviewTicketTeamExecution } from "../../../shared/maintenance-team-tickets/execution-permissions";
import { createTicketTeamExecutionRouter } from "../../routers/maintenance-teams/execution.router";
import { router } from "../../routers/_shared/procedures";

const role = "construction_procurement_manager", department = "maintenance_report_department_construction";
const proof = { responsibleDepartment: department, ticketManagerId: 90, itemResponsibleDepartment: department, itemResponsibleManagerId: 90 };
let operation = 0;
const cmd = (a: { id: number; revision: number }) => ({ assignmentId: a.id, expectedRevision: a.revision, operationKey: `construction-approve:${++operation}` });

async function ready() {
  const d = createDemo();
  await d.store.transaction(async s => { s.users.push({ id: 90, name: "مدير الإنشاءات", role, active: true }); s.users.push({ id: 91, name: "مدير آخر", role, active: true }); });
  const original = (await d.store.read()).tickets[0];
  const a = await d.service.assign(1, { ...original, teamId: 21 });
  await d.store.transaction(async s => {
    Object.assign(s.tickets[0], { ...proof, responsibleManagerId: 90 });
    s.assignments[0].responsibleManagerId = 90;
  });
  await d.service.submitOutcome(3, cmd(a), "fixed", { note: "تم الإصلاح", usages: [] });
  return { ...d, current: async () => (await d.store.read()).assignments[0] };
}
const forbidden = (work: Promise<unknown>) => assert.rejects(work, e => e instanceof TeamTicketError && e.code === "FORBIDDEN");

test("construction result approval requires matching actor, assignment, ticket and item ownership", () => {
  assert.equal(canApproveTicketTeamResult(role, 90, 90, proof), true);
  assert.equal(canApproveTicketTeamResult(role, 91, 90, proof), false);
  for (const mismatch of [{ ticketManagerId: 91 }, { itemResponsibleManagerId: 91 }, { responsibleDepartment: "maintenance_report_department_general" }, { itemResponsibleDepartment: "maintenance_report_department_it" }, { itemResponsibleManagerId: null }])
    assert.equal(canApproveTicketTeamResult(role, 90, 90, { ...proof, ...mismatch }), false);
  assert.equal(canApproveTicketTeamResult(role, 90, 90, undefined), false);
  assert.equal(canReviewTicketTeamExecution(role, 90, 90), false);
  assert.equal(canApproveTicketTeamResult("owner", 1, 90), true);
  assert.equal(canApproveTicketTeamResult("admin", 1, 90), true);
});
test("assigned construction manager approves result and the existing team workflow closes", async () => {
  const d = await ready(); const request = cmd(await d.current());
  await d.service.review(90, request, "approve_result", "اعتماد النتيجة");
  const state = await d.store.read();
  assert.equal(state.assignments[0].stage, "closed");
  assert.equal(state.actions.at(-1)?.kind, "approve_result"); assert.equal(state.actions.at(-1)?.actorId, 90);
  await d.service.review(90, request, "approve_result", "اعتماد النتيجة");
  assert.equal((await d.store.read()).actions.filter(a => a.kind === "approve_result").length, 1);
});
test("denies foreign manager, stale ticket ownership, mismatched item, inactive user and other decisions", async () => {
  for (const mutate of [
    (s: any) => { s.assignments[0].responsibleManagerId = 91; },
    (s: any) => { s.tickets[0].ticketManagerId = 91; },
    (s: any) => { s.tickets[0].itemResponsibleManagerId = 91; },
    (s: any) => { s.tickets[0].responsibleDepartment = "maintenance_report_department_general"; },
    (s: any) => { s.tickets[0].itemResponsibleDepartment = "maintenance_report_department_it"; },
    (s: any) => { s.tickets[0].ticketItemId = 999; },
    (s: any) => { s.users.find((u: any) => u.id === 90).active = false; },
  ]) {
    const d = await ready(); await d.store.transaction(async s => mutate(s));
    await forbidden(d.service.review(90, cmd(await d.current()), "approve_result", "اعتماد"));
    assert.equal((await d.current()).stage, "awaiting_review");
  }
  const d = await ready();
  await forbidden(d.service.review(91, cmd(await d.current()), "approve_result", "اعتماد"));
  await forbidden(d.service.review(90, cmd(await d.current()), "return_to_team", "إعادة"));
  await forbidden(d.service.review(90, cmd(await d.current()), "approve_external", "اعتماد خارجي"));
});
test("direct review API enforces the real actor and reevaluates ownership on each request", async () => {
  const d = await ready();
  const api = router({ ticketTeamExecution: createTicketTeamExecutionRouter(() => d.service) });
  const caller = api.createCaller({ user: { id: 90, name: "مدير الإنشاءات", role, isActive: 1 } } as any);
  await d.store.transaction(async s => { s.tickets[0].ticketManagerId = 91; });
  await assert.rejects(caller.ticketTeamExecution.review({ ...cmd(await d.current()), decision: "approve_result", note: "اعتماد" }), (e: any) => e.code === "FORBIDDEN");
  await d.store.transaction(async s => { s.tickets[0].ticketManagerId = 90; });
  const result = await caller.ticketTeamExecution.review({ ...cmd(await d.current()), decision: "approve_result", note: "اعتماد" });
  assert.equal(result.stage, "closed");
});
