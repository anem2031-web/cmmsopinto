import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { router, protectedProcedure } from "../_core/trpc";
import { ticketProcedure } from "../routers/_shared/procedures";
import { APP_ROLE, MAINTENANCE_RESPONSIBLE_DEPARTMENT, isItTeamRole, isTicketReporterRole, canRoleAccessPath } from "../../shared/roles";
import { assertTicketReadable, isRoleDeniedFromTickets, isTicketVisible, canManageTicketWorkflow } from "../routers/tickets/tickets.access";
import { isPOVisible, canPerformAction } from "../_core/authz/engine";
import { RETURNS_CENTER_PATH, RETURNS_CENTER_SUPPLIER_ROLES } from "../../shared/returns-center";

// Execute the actual handlers without importing a live DB or translation workers.
const db = vi.hoisted(() => ({
  getTicketById: vi.fn(), getTicketItems: vi.fn(async () => []),
  getTickets: vi.fn(async (_filters: any = {}) => [] as any[]),
  getTicketsPaginated: vi.fn(async (_filters: any, _page: number, _size: number, _options: any) => ({ tickets: [], total: 0 })),
  getTicketsInboxCounts: vi.fn(async (_filters: any) => ({ all: 0 })),
  createTicketConfirmation: vi.fn(), updateTicket: vi.fn(), syncSingleTicketItem: vi.fn(),
  addTicketStatusHistory: vi.fn(), createAuditLog: vi.fn(),
  getTicketWorkflowManagerUsers: vi.fn(async () => []), createNotification: vi.fn(),
}));
vi.mock("../_core/db", () => db);
function expression(file: string, name: string) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  let found = "";
  const walk = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === name) found = node.initializer.getText(source);
    ts.forEachChild(node, walk);
  };
  walk(source);
  if (!found) throw Error(`Missing production handler: ${name}`);
  return found;
}
const evaluate = (code: string, scope: object) => vm.runInNewContext(ts.transpileModule(`(${code})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, scope);
const scope = { z, TRPCError, APP_ROLE, MAINTENANCE_RESPONSIBLE_DEPARTMENT, isItTeamRole, isTicketReporterRole, protectedProcedure, ticketProcedure, db,
  isRoleDeniedFromTickets, assertTicketReadable,
  localizeTicketDisplayRows: async (rows: any[]) => rows,
  localizeTicketDetail: async (row: any) => row,
};
const path = "server/routers/tickets/tickets.router.ts";
const api = router({ tickets: router({
  list: evaluate(expression(path, "list"), scope),
  listPaginated: evaluate(expression(path, "listPaginated"), scope),
  inboxCounts: evaluate(expression(path, "inboxCounts"), scope),
  getById: evaluate(expression(path, "getById"), scope),
  items: evaluate(expression(path, "items"), scope),
  confirmCompletion: evaluate(expression("server/routers/tickets/tickets.closure.ts", "confirmCompletion"), scope),
}) });
const user = (role = "purchase_requester", id = 7) => ({ id, role, isActive: 1, preferredLanguage: "ar" });
const caller = (role = "purchase_requester", id = 7): any => api.createCaller({ user: user(role, id), req: {}, res: {} } as any);
const ticket = (reportedById = 7) => ({ id: 90, reportedById, assignedToId: null, status: "closed", ticketNumber: "TEST-90" });
beforeEach(() => { vi.clearAllMocks(); db.getTicketById.mockResolvedValue(ticket()); });

describe.each(["operator", "purchase_requester"])("%s reporter capability", role => {
  it("retains own-only ticket visibility and denies foreign tickets even if assigned", () => {
    expect(isTicketReporterRole(role)).toBe(true);
    expect(isRoleDeniedFromTickets(role)).toBe(false);
    expect(isTicketVisible(user(role), ticket())).toBe(true);
    expect(isTicketVisible(user(role), { ...ticket(8), assignedToId: 7 })).toBe(false);
    expect(canManageTicketWorkflow(user(role), ticket())).toBe(false);
  });
  it("forces the reporter filter in list, paginated families and inbox counters", async () => {
    const c = caller(role);
    await c.tickets.list({ search: "pump" });
    expect(db.getTickets).toHaveBeenCalledWith({ search: "pump", reportedById: 7 });
    await c.tickets.listPaginated({ groupSubTickets: true, page: 2 });
    expect(db.getTicketsPaginated).toHaveBeenCalledWith({ reportedById: 7 }, 2, 10, expect.objectContaining({ childVisibilityFilters: { reportedById: 7 } }));
    await c.tickets.inboxCounts({ status: "closed" });
    expect(db.getTicketsInboxCounts).toHaveBeenCalledWith({ status: "closed", reportedById: 7 });
  });
  it("denies raw reporter filter injection", async () => {
    await caller(role).tickets.list({ reportedById: 8 });
    expect(db.getTickets).toHaveBeenCalledWith({ reportedById: 7 });
  });
  it("reads own detail and rechecks the current owner for the next direct request", async () => {
    const c = caller(role);
    expect((await c.tickets.getById({ id: 90 })).id).toBe(90);
    db.getTicketById.mockResolvedValue(ticket(8));
    await expect(c.tickets.getById({ id: 90 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    db.getTicketById.mockResolvedValue(undefined);
    await expect(c.tickets.getById({ id: 404 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("does not expose foreign child items", async () => {
    db.getTicketById.mockResolvedValue(ticket(8));
    await expect(caller(role).tickets.items({ ticketId: 90 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("confirms its closed ticket but cannot confirm a foreign one", async () => {
    const c = caller(role);
    await expect(c.tickets.confirmCompletion({ id: 90, note: "Done", photoUrls: [] })).resolves.toEqual({ success: true });
    expect(db.createTicketConfirmation).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 90, confirmedById: 7 }));
    db.getTicketById.mockResolvedValue(ticket(8));
    await expect(c.tickets.confirmCompletion({ id: 90, note: "Done" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.createTicketConfirmation).toHaveBeenCalledTimes(1);
  });
  it("cannot confirm before closure", async () => {
    db.getTicketById.mockResolvedValue({ ...ticket(), status: "in_progress" });
    await expect(caller(role).tickets.confirmCompletion({ id: 90, note: "Done" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.createTicketConfirmation).not.toHaveBeenCalled();
  });
});

it("keeps each request identity independent, with one list reader call for a large list", async () => {
  db.getTickets.mockResolvedValueOnce(Array.from({ length: 600 }, (_, id) => ({ ...ticket(), id })));
  expect(await caller().tickets.list()).toHaveLength(600);
  await caller("purchase_requester", 8).tickets.list();
  expect(db.getTickets.mock.calls.map(call => (call[0] as any).reportedById)).toEqual([7, 8]);
  expect(db.getTicketById).not.toHaveBeenCalled();
  expect(db.getTicketItems).not.toHaveBeenCalled();
});

it("preserves other roles' existing ticket gates", async () => {
  for (const role of ["warehouse", "accountant", "purchase_manager", "gate_security", "food_warehouse_manager", "food_warehouse_assistant"]) {
    expect(isRoleDeniedFromTickets(role)).toBe(true);
    if (["warehouse", "accountant", "gate_security", "food_warehouse_assistant"].includes(role)) {
      await expect(caller(role).tickets.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    } else {
      expect(await caller(role).tickets.list()).toEqual([]);
    }
  }
  await caller("admin").tickets.list();
  expect(db.getTickets).toHaveBeenLastCalledWith({});
  await caller("technician").tickets.list();
  expect(db.getTickets).toHaveBeenLastCalledWith({ assignedToId: 7 });
  expect(isTicketReporterRole("user")).toBe(false);
});

it("keeps requester purchase ownership and approval denials", () => {
  const ctx = { role: "purchase_requester", userId: 7 };
  expect(canPerformAction("create", ctx)).toBe(true);
  expect(isPOVisible(ctx, { id: 1, requestedById: 7, status: "draft" })).toBe(true);
  expect(isPOVisible(ctx, { id: 2, requestedById: 8, status: "approved" })).toBe(false);
  expect(canPerformAction("approveAccounting", ctx, { status: "pending_accounting" })).toBe(false);
});

it("exposes the same operator navigation while retaining requester purchase entries", () => {
  const file = "client/src/components/layout/DashboardLayout.tsx";
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer = "";
  const walk = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "NAV_SECTIONS") initializer = node.initializer!.getText(source);
    ts.forEachChild(node, walk);
  };
  walk(source);
  // Icon identifiers are irrelevant to navigation grants.
  const clean = initializer.replace(/icon:\s*\w+/g, "icon: null");
  const sections = evaluate(clean, { RETURNS_CENTER_PATH, RETURNS_CENTER_SUPPLIER_ROLES }) as any[];
  const items = sections.flatMap(section => section.items);
  for (const item of items.filter(item => item.roles?.includes("operator"))) {
    expect(item.roles).toContain("purchase_requester");
    expect(canRoleAccessPath("purchase_requester", item.path)).toBe(true);
  }
  for (const path of ["/purchase-orders", "/documents"]) expect(items.find(item => item.path === path).roles).toContain("purchase_requester");
  expect(canRoleAccessPath("purchase_requester", "/operational-issues")).toBe(false);
  expect(canRoleAccessPath("purchase_requester", "/catalog")).toBe(false);
});
