import "dotenv/config";
import { createTRPCProxyClient, httpLink } from "@trpc/client";
import superjson from "superjson";
import { createInterface } from "node:readline";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { AppRouter } from "../../server/routers";
import { ticketExecutionSession } from "../../shared/maintenance-team-tickets/execution-session";

if (new URL(process.env.DATABASE_URL || "").pathname.slice(1).toLowerCase() !== "copycmms2") throw Error("COPYCMMS2 only");
const input = createInterface({ input: process.stdin });
const line = await new Promise<string>(resolve => input.once("line", value => { input.close(); resolve(value); }));
const credentials = JSON.parse(line) as { username: string; password: string };
let cookie = "";
const api = createTRPCProxyClient<AppRouter>({ links: [httpLink({ url: "http://localhost:4002/api/trpc", transformer: superjson,
  fetch: async (url, options) => {
    if (!String(url).startsWith("http://localhost:4002/api/trpc")) throw Error("Trial endpoint only");
    const response = await fetch(url, { ...options, headers: { ...options?.headers, ...(cookie ? { cookie } : {}) } });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) cookie = cookies.map(value => value.split(";")[0]).join("; ");
    return response;
  },
})] });
const directory = "docs/runtime-uat/2026-10-31-material-units";
const file = `${directory}/ticket-fixture.json`;
function check(condition: unknown, message: string): asserts condition { if (!condition) throw Error(message); }
try {
  await api.auth.login.mutate(credentials); credentials.password = "";
  const me = await api.auth.me.query();
  let state: any = {}; try { state = JSON.parse(await readFile(file, "utf8")); } catch {}
  const save = async () => { await mkdir(directory, { recursive: true }); await writeFile(file, JSON.stringify(state, null, 2)); };
  const action = process.argv[2] || "inspect";
  if (action === "setup") {
    check(me && ["owner", "admin"].includes(me.role), "Owner/admin setup only");
    state.label ??= `TEST-MATERIAL-UNITS-${new Date().toISOString()}`;
    if (!state.parentTicketId) {
      const photo = await api.tickets.getById.query({ id: 2010107 });
      const ticket = await api.tickets.create.mutate({ title: state.label, description: "اختبار وحدة الكتالوج وطلب مادة دون وحدة — COPYCMMS2",
        priority: "low", siteId: 390001, sectionId: 150011, categoryId: 2, beforePhotoUrl: photo!.beforePhotoUrl! });
      state.parentTicketId = ticket.id; await save();
    }
    const parent = await api.tickets.getById.query({ id: state.parentTicketId });
    check(parent?.title === state.label && state.label.startsWith("TEST-MATERIAL-UNITS-"), "Unexpected trial ticket");
    let plan = await api.tickets.departmentPlan.query({ ticketId: state.parentTicketId });
    if (!plan.departments.length) {
      await api.tickets.triageMulti.mutate({ id: state.parentTicketId, ticketType: "internal", assignments: [{ department: "maintenance_report_department_general", responsibleManagerId: 19080005, organizationalTitle: "اختبار وحدات مواد الفريق" }] });
    }
    plan = await api.tickets.departmentPlan.query({ ticketId: state.parentTicketId });
    check(plan.departments.length, "Trial ticket has no triaged department");
    if (!state.taskId) {
      const task = await api.tickets.createDepartmentTask.mutate({ ticketId: state.parentTicketId, ticketDepartmentId: plan.departments[0].id,
        title: "TEST — طلب مواد دون اختيار الوحدة", description: "اعتماد وحدة الكتالوج والكمية من المستودع" });
      state.taskId = task.taskId; await save();
    }
    if (!state.assignmentId) {
      const assigned = await api.ticketTeamAssignments.assign.mutate({ ticketId: state.parentTicketId, taskId: state.taskId, teamId: 2 });
      state.assignmentId = assigned.assignmentId; state.ticketId = assigned.ticketId; state.ticketNumber = assigned.ticketNumber; await save();
    }
    let details = await api.ticketTeamExecution.details.query({ assignmentId: state.assignmentId, language: "ar" });
    const command = (operationKey: string) => ({ assignmentId: state.assignmentId, expectedRevision: details.assignments[0].revision, operationKey });
    if (!details.needs.length) {
      const session = ticketExecutionSession(details, details.assignments[0]);
      if (!session.working) {
        if (session.openVisit) await api.ticketTeamExecution.resumeItem.mutate(command(`unit-resume:${state.assignmentId}`));
        else await api.ticketTeamExecution.startItem.mutate(command(`unit-start:${state.assignmentId}`));
        details = await api.ticketTeamExecution.details.query({ assignmentId: state.assignmentId, language: "ar" });
      }
      await api.ticketTeamExecution.request.mutate({ ...command(`unit-request:${state.assignmentId}`),
        needs: [{ name: "TEST مادة كتبها الفني دون وحدة", quantity: 2 }, { catalogItemId: 180213, unit: "كرتون", quantity: 1 }], confirmedCatalogIds: [] });
      details = await api.ticketTeamExecution.details.query({ assignmentId: state.assignmentId, language: "ar" });
    }
    const unlisted = details.needs.find(item => item.originalName === "TEST مادة كتبها الفني دون وحدة");
    const listed = details.needs.find(item => item.catalogItemId === 180213);
    check(unlisted && unlisted.catalogItemId == null && !unlisted.unit, "Free-text need must wait without a unit");
    const master = details.catalog.find(item => item.id === 180213);
    check(listed && master && listed.unit === master.unit && listed.unit !== "كرتون", "Catalog unit must override forged client unit");
    state.needId = unlisted.id; state.catalogNeedId = listed.id; state.catalogUnit = listed.unit;
    await save(); console.log(JSON.stringify({ action, ...state }));
  } else {
    check(state.assignmentId && state.needId, "Create the trial fixture first");
    const details = await api.ticketTeamExecution.details.query({ assignmentId: state.assignmentId, language: "ar" });
    const need = details.needs.find(item => item.id === state.needId);
    check(need, "Trial need unavailable");
    if (action === "verify") {
      check(need.catalogItemId === 180228 && need.unit === "قطعة" && need.requested === 1, "Approved warehouse quantity/unit missing");
      check(need.originalName === "TEST مادة كتبها الفني دون وحدة", "Original technician description changed");
      check(details.actions.some(item => item.kind === "material_resolved" && item.note.includes("identityReview")), "Quantity audit missing");
      state.approvedNeed = need; state.revision = details.assignments[0].revision; state.deliveries = details.deliveries.filter(item => item.needId === need.id);
      state.balances = await api.ticketTeamExecution.balances.query({ assignmentId: state.assignmentId }); await save();
    }
    console.log(JSON.stringify({ action, ticketId: state.ticketId, assignmentId: state.assignmentId, need, deliveries: details.deliveries.filter(item => item.needId === need.id) }));
  }
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
