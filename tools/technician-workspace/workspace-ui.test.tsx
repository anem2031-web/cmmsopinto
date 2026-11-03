import React from "react";
import fs from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import ar from "../../client/src/i18n/ar";
import { canRoleAccessPath } from "../../shared/roles";
import { currentExecutionStep, nextExecutionStep, ticketStepRecorded } from "../../shared/technician-workspace";
const f = vi.hoisted(() => ({ role: "technician", hooks: [] as any[], index: 0, buttons: new Map<string, any>(), calls: [] as any[], queries: [] as any[], data: {} as Record<string, any>, close: vi.fn(), onSelect: vi.fn(), renderItem: vi.fn(), navigate: vi.fn() }));
vi.mock("../../client/src/pages/maintenance-teams/team-execution-navigation", () => ({ useOpenTeamExecution: () => f.navigate, useRestoreTeamTicketList: () => {} }));
const text = (node: any): string => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);
const capture = (type: any, props: any) => { if (type === "button" && props?.onClick) f.buttons.set(text(props.children), props); };
vi.mock("react", async original => { const actual = await original<any>(); return { ...actual, useState: (initial: any) => { const index = f.index++; if (!(index in f.hooks)) f.hooks[index] = typeof initial === "function" ? initial() : initial; return [f.hooks[index], (value: any) => { f.hooks[index] = typeof value === "function" ? value(f.hooks[index]) : value; }]; } }; });
vi.mock("react/jsx-runtime", async original => { const actual = await original<any>(); return { ...actual, jsx: (...args: any[]) => { capture(args[0], args[1]); return actual.jsx(...args); }, jsxs: (...args: any[]) => { capture(args[0], args[1]); return actual.jsxs(...args); } }; });
vi.mock("react/jsx-dev-runtime", async original => { const actual = await original<any>(); return { ...actual, jsxDEV: (...args: any[]) => { capture(args[0], args[1]); return actual.jsxDEV(...args); } }; });
vi.mock("../../client/src/components/ui/dialog", () => ({ Dialog: (props: any) => props.open ? <div role="dialog">{props.children}</div> : null, DialogContent: ({ onEscapeKeyDown, onPointerDownOutside, ...props }: any) => <div {...props} />, DialogHeader: (props: any) => <div {...props} />, DialogTitle: (props: any) => <h2 {...props} />, DialogDescription: (props: any) => <p {...props} /> }));
vi.mock("../../client/src/components/ui/alert-dialog", () => ({ AlertDialog: (props: any) => props.open ? <div>{props.children}</div> : null, AlertDialogContent: (props: any) => <div {...props} />, AlertDialogHeader: (props: any) => <div {...props} />, AlertDialogTitle: (props: any) => <h2 {...props} />, AlertDialogDescription: (props: any) => <p {...props} />, AlertDialogFooter: (props: any) => <div {...props} />, AlertDialogCancel: (props: any) => <button {...props} />, AlertDialogAction: (props: any) => <button {...props} /> }));
vi.mock("../../client/src/components/ui/button", async original => { const actual = await original<any>(); return { ...actual, Button: (props: any) => { f.buttons.set(text(props.children), props); return <actual.Button {...props} />; } }; });
vi.mock("../../client/src/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 3, role: f.role, isActive: 1 }, loading: false }) }));
vi.mock("../../client/src/contexts/LanguageContext", () => ({ useTranslation: () => ({ t: ar, language: "ar", dir: "rtl" }), useLanguage: () => ({ t: ar, language: "ar", dir: "rtl" }) }));
vi.mock("../../client/src/hooks/useContentTranslation", () => ({ useStaticLabels: () => ({ getStatusLabel: (value: string) => value }) }));
vi.mock("../../client/src/components/i18n/EntityTranslatedText", () => ({ EntityTranslatedText: ({ original }: any) => <span>{original}</span> }));
vi.mock("../../client/src/pages/tickets/CreateTicket", () => ({ default: ({ linkedPmv2ItemId }: any) => <div>embedded-linked-item:{linkedPmv2ItemId}</div> }));
vi.mock("wouter", () => ({ useLocation: () => ["/scheduled-maintenance/my-tasks", f.navigate] }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../client/src/lib/trpc", () => {
  const proxy = (path: string[] = []): any => new Proxy(() => {}, { get: (_target, key: string) => {
    if (key === "useUtils") return () => proxy();
    if (key === "useQuery") return (input: any, options: any = {}) => { const name = path.join("."); f.queries.push({ name, input, options }); return { data: options.enabled === false ? undefined : (f.data[name] ?? (name === "pmv2.technician.workspace" ? f.data["pmv2.technician.today"] : undefined)), isLoading: false, isFetching: false, error: null, refetch: vi.fn() }; };
    if (key === "useMutation") return () => ({ isPending: false, mutate: (input: any) => f.calls.push({ name: path.join("."), input }), mutateAsync: async (input: any) => { f.calls.push({ name: path.join("."), input }); return {}; } });
    if (key === "invalidate") return async () => {};
    return proxy([...path, key]);
  } }); return { trpc: proxy() };
});
import { TechnicianExecutionWindow, ExecutionElapsedTime } from "../../client/src/components/maintenance/TechnicianExecutionWindow";
import { TicketSequentialTasksView } from "../../client/src/pages/maintenance-teams/TicketSequentialTasksView";
import Pmv2MyTasks from "../../client/src/pages/pmv2/Pmv2MyTasks";
import { TechnicianTicketDashboard } from "../../client/src/pages/maintenance-teams/TechnicianTicketDashboard";
const ticket = (id: number, ticketId = 10, stage = "action_required") => ({ assignmentId: id, ticketId, ticketNumber: `MOCK-${ticketId}`, title: `ticket item ${id}`, description: "test", teamName: "team", warehouseName: "store", siteName: "site", sectionName: "section", stage } as any);
function render(node: React.ReactNode) { f.index = 0; f.buttons.clear(); return renderToStaticMarkup(node); }
function click(label: string) { const props = f.buttons.get(label); expect(props).toBeDefined(); expect(props.disabled).toBeFalsy(); props.onClick({ preventDefault() {} }); }
beforeEach(() => { f.role = "technician"; f.hooks = []; f.index = 0; f.calls = []; f.queries = []; f.data = { "pmv2.technician.today": { date: "2026-10-14", items: [{ id: 7, taskNumber: "MOCK-PMV2-7", status: "pending", itemCount: 2, completedItemCount: 0, dueDate: "2026-10-14", teamCode: "TEAM", siteName: "Site" }] }, "pmv2.technician.materialAttention": { count: 0, items: [] }, "pmv2.technician.items": [{ id: 71, titleSnapshot: "FIRST ITEM", sortOrderSnapshot: 1, status: "pending" }, { id: 72, titleSnapshot: "SECOND ITEM", sortOrderSnapshot: 2, status: "pending" }], "pmv2.technician.visitState": { hasOpenVisit: false } }; f.close.mockReset(); f.onSelect.mockReset(); f.renderItem.mockReset(); f.navigate.mockReset(); });
it("technician has exactly one business route, including direct URLs and nested/spoofed paths", () => { for (const path of ["/", "/tickets", "/tickets/42", "/preventive", "/scheduled-maintenance", "/scheduled-maintenance/my-tasks/other", "/inventory", "/maintenance-team-tickets", "/users"]) expect(canRoleAccessPath("technician", path)).toBe(false); expect(canRoleAccessPath("technician", "/scheduled-maintenance/my-tasks?source=pmv2")).toBe(true); });
it("other roles retain access to their existing technician/management/warehouse routes", () => { for (const role of ["owner", "admin", "observer", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager"]) expect(canRoleAccessPath(role, "/scheduled-maintenance/my-tasks")).toBe(true); expect(canRoleAccessPath("warehouse", "/scheduled-maintenance/warehouse-requests")).toBe(true); expect(canRoleAccessPath("operator", "/tickets")).toBe(true); });
it("waiting materials is not completed; explicit next can leave it pending and auto-advance never skips unrecorded work", () => { const steps = [{ id: 1, title: "waiting", status: "waiting_material", recorded: false }, { id: 2, title: "pending", status: "pending", recorded: false }]; expect(currentExecutionStep(steps, 1)?.id).toBe(1); expect(nextExecutionStep(steps, 1)?.id).toBe(2); steps[0].recorded = true; expect(currentExecutionStep(steps, 1)?.id).toBe(2); steps[1].recorded = true; expect(currentExecutionStep(steps, 2)).toBeUndefined(); expect(ticketStepRecorded("waiting_material")).toBe(false); expect(ticketStepRecorded("awaiting_review")).toBe(true); });
it("the window does not start or close a visit, and disables next/close while saving", () => { const html = render(<TechnicianExecutionWindow open title="mock" description="mock" language="ar" steps={[{ id: 1, title: "one", status: "pending", recorded: false }, { id: 2, title: "two", status: "pending", recorded: false }]} currentId={1} onSelect={f.onSelect} onClose={f.close} busy><p>active only</p></TechnicianExecutionWindow>); expect(html).toContain('role="dialog"'); expect(f.buttons.get("متابعة البند التالي").disabled).toBe(true); expect(f.buttons.get("إغلاق النافذة").disabled).toBe(true); expect(f.calls).toEqual([]); });
it("team card navigates to a dedicated execution page, which renders only its ticket group", () => {
  const tickets = [ticket(1), ticket(2), ticket(3, 20)];
  const renderExecution = (item: any) => { f.renderItem(item.assignmentId); return <p>execute:{item.assignmentId}</p>; };
  render(<TicketSequentialTasksView tickets={tickets} language="ar" renderExecution={renderExecution} />);
  expect(f.renderItem).not.toHaveBeenCalled();
  const first = [...f.buttons.entries()].find(([label]) => label.includes("MOCK-10")); first![1].onClick();
  expect(f.navigate).toHaveBeenCalledWith(1);
  f.hooks = [];
  const node = <TicketSequentialTasksView tickets={tickets} language="ar" executionAssignmentId={1} onExit={f.close} renderExecution={renderExecution} />;
  let html = render(node); expect(html).toContain("execute:1"); expect(html).not.toContain("execute:2"); expect(html).not.toContain("execute:3"); expect(html).not.toContain('role="dialog"'); expect(html).not.toContain("MOCK-20");
  tickets[0].stage = "awaiting_review"; html = render(node); expect(html).toContain("execute:2"); expect(html).not.toContain("execute:1");
});
it("a ticket with recorded outcomes retains the real end-visit controls until the visit is closed", () => { const item = { ...ticket(1, 10, "awaiting_review"), hasOpenVisit: true }; f.hooks = [null, false]; const html = render(<TicketSequentialTasksView executionAssignmentId={1} tickets={[item]} language="ar" renderExecution={() => <button>end existing visit</button>} />); expect(html).toContain("end existing visit"); expect(html).toContain("هذا لا يغلق التذكرة"); });
it("PMV2 opens in a window on task selection without starting a visit, shows one pending item and submits the exact original start API", () => { const first = render(<Pmv2MyTasks />); expect(first).not.toContain('role="dialog"'); const task = [...f.buttons.entries()].find(([label]) => label.includes("MOCK-PMV2-7")); task![1].onClick(); const html = render(<Pmv2MyTasks />); expect(html).toContain('role="dialog"'); expect(html).toContain("FIRST ITEM"); expect(html).not.toContain('data-active-execution-item="72"'); expect(f.calls).toEqual([]); click(ar.workflow.pmv2.startExecution); expect(f.calls).toEqual([{ name: "pmv2.technician.startItem", input: { taskId: 7, taskItemId: 71 } }]); });
it("PMV2 automatically advances past completed items, with explicit access back to waiting materials", () => { f.hooks = [7, null, null, null]; f.data["pmv2.technician.items"][0].status = "completed"; const html = render(<Pmv2MyTasks />); expect(html).toContain("SECOND ITEM"); expect(html).not.toContain("1. <span>FIRST ITEM"); expect(f.calls).toEqual([]); });
it("admin keeps the original inline PMV2 presentation rather than a forced technician window", () => { f.role = "admin"; f.hooks = [7, null, null, null]; const html = render(<Pmv2MyTasks />); expect(html).toContain("FIRST ITEM"); expect(html).toContain("SECOND ITEM"); expect(html).not.toContain('role="dialog"'); });
it("visit timer uses real visit timestamps and stops at the recorded end time", () => { const html = render(<ExecutionElapsedTime language="ar" startedAt="2026-10-14T09:00:00Z" endedAt="2026-10-14T09:12:30Z" />); expect(html).toContain("00:12:30"); });
it("login, path guard, named tickets and linked-ticket creation preserve the single workspace boundary", () => { expect(fs.readFileSync("client/src/pages/auth/Login.tsx", "utf8")).toContain('data.user.role === "technician" ? "/scheduled-maintenance/my-tasks"'); expect(fs.readFileSync("client/src/pages/maintenance-teams/NamedTechnicianTickets.tsx", "utf8")).toContain("embeddedTicketId={selected}"); expect(fs.readFileSync("client/src/pages/pmv2/Pmv2MyTasks.tsx", "utf8")).toContain("linkedPmv2ItemId={createLinkedItemId}"); });
it("PMV2 start/resume/result/end-visit mutations retain their original implementation byte for byte", () => { const before = fs.readFileSync("tools/technician-workspace/artifacts/client__src__pages__pmv2__Pmv2MyTasks.tsx.before", "utf8"); const after = fs.readFileSync("client/src/pages/pmv2/Pmv2MyTasks.tsx", "utf8"); const extract = (value: string) => value.slice(value.indexOf("  const startItem ="), value.indexOf("  const resultMutationPending =")); expect(extract(after)).toBe(extract(before)); });
it("the historical route policy remains identical outside the approved technician and business-role gates", () => {
  const before = fs.readFileSync("tools/technician-workspace/artifacts/shared__roles.ts.before", "utf8");
  const after = fs.readFileSync("shared/roles.ts", "utf8")
    .replace('import { technicianPageAllowed } from "./technician-policy";\n', "")
    .replace('  if (role === APP_ROLE.TECHNICIAN) return technicianPageAllowed(normalizedPath);\n', "")
    .replace('import { businessPageAllowed, isBusinessGuardedRole } from "./business-role-policy";\n', "")
    .replace('  if (isBusinessGuardedRole(role)) return businessPageAllowed(role, normalizedPath);\n', "")
    // Approved pricing/operational routes postdate this historical baseline.
    .replace(/^  if \(matchesPrefix\(normalizedPath, "\/(delegate-pricing-bundles|operational-issues)"\)\).*\n/gm, "");
  expect(after).toBe(before);
});
it("layout waits for authentication before mounting a direct-link page and redirects technicians to their workspace", () => { const source = fs.readFileSync("client/src/components/layout/DashboardLayout.tsx", "utf8"); expect(source).toContain("!authLoading && canRoleAccessPath(role, location)"); expect(source).toContain("if (authLoading || canAccessCurrentPath) return;"); expect(source).toContain('const fallback = role === "technician"\n      ? "/scheduled-maintenance/my-tasks"'); });
it("PMV2 status cards filter the actual task list and do not mutate tasks on card selection", () => {
  const base = f.data["pmv2.technician.today"].items[0];
  f.data["pmv2.technician.workspace"] = { date: "2026-10-14", items: [
    { ...base, hasOpenVisit: false, activeItemCount: 2 },
    { ...base, id: 8, taskNumber: "MATERIAL-TASK", status: "waiting_material", hasOpenVisit: false, activeItemCount: 0, waitingMaterialCount: 2 },
    { ...base, id: 9, taskNumber: "MANAGER-TASK", status: "waiting_ticket", hasOpenVisit: false, activeItemCount: 0, waitingTicketCount: 2 },
    { ...base, id: 10, taskNumber: "DONE-TASK", status: "completed", hasOpenVisit: false, activeItemCount: 0, completedItemCount: 2 },
  ] };
  const node = <Pmv2MyTasks />;
  const first = render(node); expect(first).toContain("MOCK-PMV2-7"); expect(first).not.toContain("MATERIAL-TASK"); expect(first).not.toContain("DONE-TASK");
  click("بانتظار المواد1"); const material = render(node); expect(material).toContain("MATERIAL-TASK"); expect(material).not.toContain("MOCK-PMV2-7");
  click("بانتظار المسؤول1"); const manager = render(node); expect(manager).toContain("MANAGER-TASK"); expect(manager).not.toContain("MATERIAL-TASK");
  click("تم تنفيذها1"); const done = render(node); expect(done).toContain("DONE-TASK"); expect(done).toContain("أحدث 100"); expect(done).not.toContain("MANAGER-TASK"); expect(f.calls).toEqual([]);
});
it("ticket cards combine team and name assignment counts without counting the same document twice", () => {
  f.data["ticketTeamAssignments.queue"] = [{ ...ticket(1, 10), hasOpenVisit: false }, { ...ticket(2, 20, "awaiting_review"), hasOpenVisit: false }];
  f.data["tickets.list"] = [{ id: 10, title: "duplicate team doc", ticketNumber: "DUP", status: "assigned" }, { id: 30, title: "named open", ticketNumber: "NAMED-OPEN", status: "assigned" }, { id: 31, title: "named done", ticketNumber: "NAMED-DONE", status: "ready_for_closure" }];
  const node = <TechnicianTicketDashboard />; const html = render(node); expect(f.buttons.has("مهام التنفيذ2")).toBe(true); expect(f.buttons.has("تم تنفيذها2")).toBe(true); expect(html).toContain("NAMED-OPEN"); expect(html).not.toContain("duplicate team doc"); expect(html).not.toContain("NAMED-DONE");
  click("تم تنفيذها2"); const done = render(node); expect(done).toContain("NAMED-DONE"); expect(done).toContain("MOCK-20"); expect(done).not.toContain("NAMED-OPEN"); expect(done).not.toContain("MOCK-10"); expect(f.calls).toEqual([]);
});
