import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { getTableColumns, getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import * as schema from "../../drizzle/schema";
import { MAINTENANCE_RESPONSIBLE_DEPARTMENT as DEPT } from "../../shared/roles";
import { MAINTENANCE_INSPECTION_WORKFLOW_STATUS as INSPECT } from "../../shared/roles";
const f = vi.hoisted(() => ({ enabled: false, procurement: false, stocks: [] as any[] }));
vi.mock("../_core/db", () => ({}));
vi.mock("../services/operational-issues/feature", () => ({ operationalIssuesEnabled: () => f.enabled }));
vi.mock("../services/operational-issues/stock-procurement", () => ({ operationalPurchaseReady: async () => f.procurement, loadOperationalStock: async (_db: any, lines: any[]) => f.stocks.filter(stock => lines.some(line => Number(line.id) === Number(stock.itemId))) }));
vi.mock("../services/operational-issues/replacement", () => ({ loadOperationalReplacements: async () => new Map(), replacementStockLines: () => [], applyOperationalReplacementStock: (rows: any[]) => rows }));
import { readTicketOperations, classifyLegacyTicketOperations } from "../services/your-work/operations-tickets";
import { classifyExternalOperations, readWarehouseOperations, readOperationalIssueOperations } from "../services/your-work/operations-warehouse";
import { classifySettlementOperations, readSettlementOperations } from "../services/your-work/operations-settlements";
import { readOtherOperations } from "../services/your-work/operations-other";

const actor = (role = "owner", id = 7) => ({ id, role, isActive: 1 });
const dialect = new MySqlDialect();
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
function database(data: Record<string, any[]> = {}) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  return { queries, execute: vi.fn(async (statement: any) => {
    const query = dialect.sqlToQuery(statement); queries.push(query);
    const key = /your-work:([a-z-]+)/.exec(query.sql)?.[1];
    return [key ? data[key] || [] : []];
  }) };
}
const ticket = (patch: any = {}) => ({ id: 1, itemId: 2, ticketNumber: "MT-1", title: "بلاغ", status: "under_inspection", itemStatus: "under_inspection",
  reportedById: 7, assignedToId: 9, maintenanceResponsibleDepartment: DEPT.GENERAL, maintenanceResponsibleManagerId: 7,
  itemDepartment: DEPT.GENERAL, itemManagerId: 7, inspectionWorkflowStatus: INSPECT.SUBMITTED_FOR_REVIEW,
  inspectionSubmittedAtMs: 9000, createdAtMs: 1000, enteredAt: 5000, itemCount: 1, incompleteItems: 1, ...patch });
beforeEach(() => { f.enabled = false; f.procurement = false; f.stocks = []; });

describe("Personal operation work uses current action and actor scope", () => {
  it("timestamps an inspection review from submission rather than creation or assignment", () => {
    expect(classifyLegacyTicketOperations(actor("general_maintenance_manager"), [ticket()])).toMatchObject([{ action: "ticket_inspection_review", arrivedAt: 9000 }]);
    expect(classifyLegacyTicketOperations(actor("general_maintenance_manager", 8), [ticket()])).toEqual([]);
    expect(classifyLegacyTicketOperations(actor("senior_management"), [ticket()])).toEqual([]);
    expect(classifyLegacyTicketOperations(actor("general_maintenance_manager"), [ticket({ inspectionSubmittedAtMs: null })])[0].arrivedAt).toBeNull();
  });
  it("keeps technician waits out, including users with broad override permission", () => {
    expect(classifyLegacyTicketOperations(actor(), [ticket({ inspectionWorkflowStatus: INSPECT.PENDING_SUBMISSION })])).toEqual([]);
    expect(classifyLegacyTicketOperations(actor(), [ticket({ teamId: 10, teamStage: "action_required" })])).toEqual([]);
  });
  it("keeps route returns separate from the legacy path chooser", () => {
    const row = ticket({ routeReturnId: 11, routeReviewerId: 7, routeTicketId: 1, itemPath: "C", routeReturnedAt: 8000, itemApprovedById: 7, inspectionWorkflowStatus: INSPECT.APPROVED });
    expect(classifyLegacyTicketOperations(actor("general_maintenance_manager"), [row])).toMatchObject([{ action: "ticket_external_review", arrivedAt: 8000 }]);
    expect(classifyLegacyTicketOperations(actor("general_maintenance_manager"), [{ ...row, teamId: 3, teamStage: "blocked" }])).toMatchObject([{ action: "ticket_external_review", arrivedAt: 8000 }]);
    expect(classifyLegacyTicketOperations(actor("general_maintenance_manager", 8), [row])).toEqual([]);
  });
  it("never calls a partial parent complete or guesses time after an unrecorded cancellation", () => {
    const row = ticket({ workflowModel: "department_tasks", status: "department_planning", childCount: 2, childOpenCount: 0, pendingTaskCount: 0, lastChildClosedAt: 7000 });
    expect(classifyLegacyTicketOperations(actor(), [row])).toMatchObject([{ action: "ticket_close", arrivedAt: 7000 }]);
    expect(classifyLegacyTicketOperations(actor(), [{ ...row, childOpenCount: 1 }])).toEqual([]);
    expect(classifyLegacyTicketOperations(actor(), [{ ...row, pendingTaskCount: 1 }])).toEqual([]);
    expect(classifyLegacyTicketOperations(actor(), [{ ...row, childCount: 0 }])).toEqual([]);
    expect(classifyLegacyTicketOperations(actor(), [{ ...row, cancelledPendingTasks: 1 }])[0].arrivedAt).toBeNull();
  });
  it.each(["user", "operator", "purchase_requester"])("keeps %s completion confirmation personal", role => {
    expect(classifyLegacyTicketOperations(actor(role), [ticket({ status: "closed", closedAtMs: 7500 })])).toMatchObject([{ action: "ticket_confirm", arrivedAt: 7500 }]);
    expect(classifyLegacyTicketOperations(actor(role, 8), [ticket({ status: "closed", closedAtMs: 7500 })])).toEqual([]);
  });
  it("admits only the actually named IT task executor to promote it, never an admin override or a different manager", async () => {
    const plan = { departmentId: 1, ticketId: 2, ticketNumber: "MT-2", department: DEPT.IT, claimedById: 9, responsibleManagerId: 7,
      status: "department_planning", workflowModel: "department_tasks", taskId: 3, taskTitle: "IT task", namedAssignees: 1, actorNamedAssignee: 1, namedAssignedAt: 8000 };
    for (const role of ["owner", "admin"]) expect(await readTicketOperations(database({ "department-planning": [plan] }), actor(role))).toEqual([]);
    expect(await readTicketOperations(database({ "department-planning": [plan] }), actor("it_manager"))).toMatchObject([{ action: "ticket_promote", arrivedAt: 8000 }]);
    expect(await readTicketOperations(database({ "department-planning": [{ ...plan, actorNamedAssignee: 0 }] }), actor("it_manager"))).toEqual([]);
    expect(await readTicketOperations(database({ "department-planning": [plan] }), actor("it_member"))).toMatchObject([{ action: "ticket_promote" }]);
  });
  it("starts IT planning responsibility at the actual claim and does not ask owner/admin to plan an unclaimed IT ticket", async () => {
    const plan = { departmentId: 1, ticketId: 2, ticketNumber: "MT-2", department: DEPT.IT, claimedById: 7, responsibleManagerId: 7,
      status: "department_planning", workflowModel: "department_tasks", routedAt: 1000, claimedAt: 8000 };
    expect(await readTicketOperations(database({ "department-planning": [plan] }), actor("it_member"))).toMatchObject([{ action: "ticket_plan", arrivedAt: 8000 }]);
    expect(await readTicketOperations(database({ "department-planning": [{ ...plan, claimedById: null }] }), actor())).toEqual([]);
    expect(await readTicketOperations(database({ "department-planning": [{ ...plan, claimedById: null }] }), actor("it_manager"))).toMatchObject([{ action: "it_ticket_claim", arrivedAt: 1000 }]);
    expect(await readTicketOperations(database({ "department-planning": [{ ...plan, claimedById: 9 }] }), actor("it_manager"))).toMatchObject([{ action: "ticket_plan", arrivedAt: 8000 }]);
    expect(await readTicketOperations(database({ "department-planning": [{ ...plan, department: DEPT.GENERAL }] }), actor("supervisor"))).toEqual([]);
  });
  it("uses construction's exact ticket/item/assignment owner for result approval, not a general read grant", async () => {
    const row = { id: 10, ticketId: 11, ticketNumber: "MT-11", stage: "awaiting_review", responsibleManagerId: 7,
      responsibleDepartment: DEPT.CONSTRUCTION, ticketManagerId: 7, itemResponsibleDepartment: DEPT.CONSTRUCTION, itemResponsibleManagerId: 7, arrivedAt: 6000 };
    expect(await readTicketOperations(database({ "team-review": [row] }), actor("construction_procurement_manager"))).toMatchObject([{ action: "ticket_work_review", href: "/maintenance-team-tickets?teamExecution=10", arrivedAt: 6000 }]);
    expect(await readTicketOperations(database({ "team-review": [{ ...row, itemResponsibleManagerId: 8 }] }), actor("construction_procurement_manager"))).toEqual([]);
    expect(await readTicketOperations(database({ "team-review": [{ ...row, stage: "blocked" }] }), actor("construction_procurement_manager"))).toEqual([]);
  });
  it("keeps the manager queue bounded and joins all parents before enrichment", async () => {
    const rows = Array.from({ length: 1200 }, (_, id) => ({ id, ticketId: 11, ticketNumber: "MT-11", stage: "awaiting_review", responsibleManagerId: 7, arrivedAt: 6000 }));
    const db = database({ "team-review": rows });
    expect(await readTicketOperations(db, actor("general_maintenance_manager"))).toHaveLength(1200);
    expect(db.queries).toHaveLength(3);
    expect(db.queries.find(query => query.sql.includes("your-work:team-review"))!.sql).toContain("INNER JOIN ticket_items i ON i.id=a.ticketItemId AND i.ticketId=t.id");
    const own = database(); await readTicketOperations(own, actor("construction_procurement_manager"));
    expect(own.queries[0].params).toContain(7); expect(own.queries[0].sql).toContain("i.responsibleManagerId=?");
  });
});

/** Real SQLite execution, with columns derived from the application schema/manual DDL rather than hand-invented query fixtures. */
function operationMemory() {
  const memory = new DatabaseSync(":memory:");
  memory.function("UNIX_TIMESTAMP", (value: any) => value == null ? null : Date.parse(String(value).replace(" ", "T") + (String(value).endsWith("Z") ? "" : "Z")) / 1000);
  memory.function("JSON_UNQUOTE", (value: any) => value);
  const tables = [schema.tickets, schema.ticketItems, schema.ticketStatusHistory, schema.ticketDepartments, schema.ticketTasks, schema.ticketTaskAssignees,
    schema.auditLogs, schema.externalMaintenanceJobs, schema.inventorySettlementDrafts, schema.inventorySettlementDraftEvents, schema.inventoryCountCorrections,
    schema.inventoryCountOperations, schema.inventorySettlements, schema.improvementIdeas, schema.itPurchaseNeeds, schema.purchaseOrders, schema.purchaseOrderItems,
    schema.catalogItems, schema.catalogUnits, schema.sites, schema.sections];
  for (const table of tables) {
    const fields: any[] = Object.values(getTableColumns(table));
    memory.exec(`CREATE TABLE \`${getTableName(table)}\` (${fields.map(c => `\`${c.name}\` ${c.name === "id" ? "INTEGER PRIMARY KEY" : c.dataType === "number" ? "NUMERIC" : "TEXT"}`).join(",")})`);
  }
  // These independently deployed tables intentionally live in reviewed manual DDL instead of Drizzle.
  for (const [file, wanted] of [
    ["docs/maintenance-team-tickets/sql/03_create_ticket_team_assignments.sql", "ticket_team_assignments"],
    ["docs/maintenance-team-tickets/sql/04_create_ticket_team_actions.sql", "ticket_team_actions"],
    ["drizzle/2026_10_17_operational_issues_manual.sql", "operational_issue_orders"],
    ["drizzle/2026_10_17_operational_issues_manual.sql", "operational_issue_items"],
    ["drizzle/2026_10_17_operational_issues_manual.sql", "operational_issue_deliveries"],
    ["drizzle/2026_10_18_operational_purchase_links_manual.sql", "operational_issue_purchase_links"],
  ]) {
    const ddl = readFileSync(file, "utf8"), matcher = /CREATE TABLE\s+(?:(?:`[^`]+`|\w+)\.)?`?(\w+)`?\s*\(([\s\S]*?)\)\s*ENGINE=/g;
    let body: string | null = null, found: RegExpExecArray | null;
    while ((found = matcher.exec(ddl))) if (found[1] === wanted) body = found[2];
    if (!body) throw Error(`Missing actual DDL: ${wanted}`);
    const parts: string[] = []; let depth = 0, quote = "", start = 0;
    for (let i = 0; i < body.length; i++) {
      const c = body[i]; if (quote) { if (c === quote && body[i - 1] !== "\\") quote = ""; continue; }
      if (c === "'" || c === '"' || c === "`") { quote = c; continue; }
      if (c === "(") depth++; else if (c === ")") depth--; else if (c === "," && depth === 0) { parts.push(body.slice(start, i)); start = i + 1; }
    }
    parts.push(body.slice(start));
    const names = parts.map(part => /^\s*`?(\w+)`?/.exec(part)?.[1]).filter((name): name is string => !!name && !/^(UNIQUE|KEY|CONSTRAINT|PRIMARY|FOREIGN|CHECK)$/i.test(name));
    memory.exec(`CREATE TABLE ${wanted} (${names.map(name => `\`${name}\` ${name === "id" ? "INTEGER PRIMARY KEY" : "TEXT"}`).join(",")})`);
  }
  const dispatch = readFileSync("docs/operational-dispatch/01_copycmms2_manual.sql", "utf8");
  if (!/operational_issue_items` ADD COLUMN `dispatchContext` JSON NULL/.test(dispatch)) throw Error("Dispatch DDL changed; recheck operational read");
  memory.exec("ALTER TABLE operational_issue_items ADD COLUMN dispatchContext TEXT");
  const statements: string[] = [];
  const db = { execute: async (statement: any) => {
    const rendered = dialect.sqlToQuery(statement); statements.push(rendered.sql);
    if (!/^\s*(?:\/\*[^]*?\*\/\s*)?SELECT\b/i.test(rendered.sql)) throw Error("Operational inbox must be read only");
    return [memory.prepare(rendered.sql).all(...rendered.params as any[])];
  } };
  const insert = (table: string, row: Record<string, any>) => {
    const keys = Object.keys(row); memory.prepare(`INSERT INTO ${table} (${keys.map(k => `\`${k}\``).join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(row));
  };
  return { memory, db, insert, statements };
}

describe("Operations actual SQL runs against real schema/DDL columns", () => {
  it("compiles every scoped ticket, external, settlement, idea and IT candidate query", async () => {
    const m = operationMemory();
    try {
      expect(await readTicketOperations(m.db, actor())).toEqual([]);
      expect(await readTicketOperations(m.db, actor("it_manager"))).toEqual([]);
      expect(await readWarehouseOperations(m.db, actor("warehouse"))).toEqual([]);
      expect(await readSettlementOperations(m.db, actor("senior_management"))).toEqual([]);
      expect(await readOtherOperations(m.db, actor())).toEqual([]);
      expect(await readOtherOperations(m.db, actor("it_manager"))).toEqual([]);
      expect(m.statements.some(text => text.includes("your-work:it-purchase-create"))).toBe(true);
    } finally { m.memory.close(); }
  });
  it("uses actual history and claimed department times without leaking another named IT task", async () => {
    const m = operationMemory();
    try {
      m.insert("tickets", { id: 1, ticketNumber: "MT-1", title: "Main", status: "department_planning", workflowModel: "department_tasks", reportedById: 5 });
      m.insert("ticket_items", { id: 2, ticketId: 1 });
      m.insert("ticket_departments", { id: 3, ticketId: 1, department: DEPT.IT, responsibleManagerId: 7, claimedById: 8, routedAt: "2026-11-26 06:00:00", claimedAt: "2026-11-28 06:00:00", status: "planning" });
      const planned = await readTicketOperations(m.db, actor("it_manager"));
      expect(planned).toMatchObject([{ action: "ticket_plan", arrivedAt: Date.parse("2026-11-28T06:00:00Z") }]);
      m.insert("ticket_tasks", { id: 4, ticketId: 1, ticketDepartmentId: 3, title: "Task", status: "assigned" });
      m.insert("ticket_task_assignees", { id: 5, taskId: 4, userId: 8, assignedAt: "2026-11-28 07:00:00" });
      expect(await readTicketOperations(m.db, actor("it_manager"))).toEqual([]);
      expect(await readTicketOperations(m.db, actor("it_member", 8))).toMatchObject([{ action: "ticket_promote", arrivedAt: Date.parse("2026-11-28T07:00:00Z") }]);
    } finally { m.memory.close(); }
  });
  it("executes approved operational lines, JSON destinations, unit checks and purchase coverage using the actual SQL", async () => {
    const m = operationMemory(); f.enabled = true; f.procurement = true;
    try {
      m.insert("sites", { id: 1 }); m.insert("sections", { id: 2, siteId: 1 }); m.insert("catalog_items", { id: 3, isActive: 1 });
      m.insert("operational_issue_orders", { id: 4, orderNumber: "OPR-4", status: "approved", siteId: 1, sectionId: 2 });
      m.insert("operational_issue_items", { id: 5, orderId: 4, catalogItemId: 3, itemName: "Cable", unit: "piece", quantity: 2 });
      f.stocks = [{ itemId: 5, totalQuantity: 0, needsReview: false, unit: "piece", lots: [] }];
      expect(await readOperationalIssueOperations(m.db, actor("warehouse"))).toMatchObject([{ action: "operational_purchase", title: "Cable", arrivedAt: null }]);
      m.insert("purchase_orders", { id: 6, status: "draft" }); m.insert("purchase_order_items", { id: 7, purchaseOrderId: 6, status: "pending" });
      m.insert("operational_issue_purchase_links", { orderItemId: 5, purchaseOrderId: 6, purchaseOrderItemId: 7 });
      expect(await readOperationalIssueOperations(m.db, actor("warehouse"))).toEqual([]);
      m.memory.exec("DELETE FROM operational_issue_purchase_links"); m.insert("catalog_units", { id: 8, nameAr: "piece", isActive: 0 });
      expect(await readOperationalIssueOperations(m.db, actor("warehouse"))).toEqual([]);
    } finally { m.memory.close(); }
  });
  it("retains a warehouse route return on a blocked team item even when the header reflects another item's approved stage", async () => {
    const m = operationMemory();
    try {
      m.insert("tickets", { id: 1, ticketNumber: "MT-1", status: "work_approved", workflowModel: "sub_ticket", maintenanceResponsibleDepartment: DEPT.GENERAL, maintenanceResponsibleManagerId: 7 });
      m.insert("ticket_items", { id: 2, ticketId: 1, itemNumber: 2, status: "under_inspection", maintenancePath: "C", responsibleDepartment: DEPT.GENERAL, responsibleManagerId: 7, approvedById: 7 });
      m.insert("ticket_team_assignments", { id: 3, ticketId: 1, ticketItemId: 2, ticketNumber: "MT-1", stage: "blocked", responsibleManagerId: 7 });
      m.insert("ticket_team_actions", { id: 4, assignmentId: 3, kind: "external_route_returned", revision: 2 });
      m.insert("audit_logs", { id: 5, entityType: "ticket_item", entityId: 2, action: "external_route_returned", newValues: JSON.stringify({ ticketId: 1, reviewerId: 7 }), createdAt: "2026-11-28 08:00:00" });
      const output = await readTicketOperations(m.db, actor("general_maintenance_manager"));
      expect(output).toMatchObject([{ action: "ticket_external_review", arrivedAt: Date.parse("2026-11-28T08:00:00Z"), href: "/tickets/1?workItem=2&workAction=ticket_external_review" }]);
      m.insert("audit_logs", { id: 6, entityType: "ticket_item", entityId: 2, action: "external_route_decided" });
      expect(await readTicketOperations(m.db, actor("general_maintenance_manager"))).toEqual([]);
    } finally { m.memory.close(); }
  });
});

describe("Original operational links select the exact existing action without a write", () => {
  function effect(file: string, marker: string) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let body: string | null = null;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.arguments[0].getText(source).includes(marker)) body = node.arguments[0].getText(source);
      if (!body) ts.forEachChild(node, visit);
    };
    visit(source); if (!body) throw Error(`Missing actual focus effect ${marker}`);
    return ts.transpileModule(`(${body})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  }
  it.each([
    ["?workItem=21&workAction=ticket_external_review", "sub_ticket", "work-route-review-21"],
    ["?workAction=ticket_close", "department_tasks", "work-ticket-parent-close"],
    ["?workAction=ticket_close", "sub_ticket", "work-ticket-actions"],
  ])("focuses %s at the original permitted decision section", (query, workflowModel, expected) => {
    const scroll = vi.fn(), focus = vi.fn(), lookup = vi.fn((id: string) => id === expected ? { setAttribute: vi.fn(), classList: { add: vi.fn() }, scrollIntoView: scroll, focus } : null);
    const run = vm.runInNewContext(effect("client/src/pages/tickets/TicketDetail.tsx", "workFocusApplied"), {
      ticket: { workflowModel }, ticketId: 1, ticketItems: [], workFocusApplied: { current: "" }, Number, URLSearchParams,
      window: { location: { search: query } }, document: { getElementById: lookup },
    });
    run(); expect(lookup).toHaveBeenCalledWith(expected); expect(scroll).toHaveBeenCalledOnce(); expect(focus).toHaveBeenCalledOnce();
  });
  it("focuses the operational source line only after its original detail query has loaded", () => {
    const scroll = vi.fn(), lookup = vi.fn(() => ({ scrollIntoView: scroll, setAttribute: vi.fn(), focus: vi.fn(), classList: { add: vi.fn() } }));
    const run = vm.runInNewContext(effect("client/src/pages/operational-issues/OperationalIssueQueue.tsx", "workFocused.current"), {
      process: true, detail: { data: { order: { id: 11 } } }, workFocused: { current: false }, Number, URLSearchParams,
      window: { location: { search: "?orderId=11&workLine=12" } }, document: { getElementById: lookup },
    });
    run(); expect(lookup).toHaveBeenCalledWith("work-operational-line-12"); expect(scroll).toHaveBeenCalledOnce();
  });
  it("selects the material's current section before focusing it, never another need on the ticket", () => {
    const item = { ticket: { assignmentId: 30 }, need: { needId: 40, section: "ready" } };
    const setSection = vi.fn(), setLimit = vi.fn(), scroll = vi.fn(), lookup = vi.fn(() => ({ setAttribute: vi.fn(), classList: { add: vi.fn() }, scrollIntoView: scroll, focus: vi.fn() }));
    const scope = { returnsOnly: false, hasWorkTarget: true, allowed: true, workFocused: { current: "" }, workAssignment: 30, workNeed: 40,
      sorted: [item], section: "waiting", limit: 20, setSection, setLimit, Number, Math, document: { getElementById: lookup } };
    const script = effect("client/src/pages/maintenance-teams/TicketWarehouseRequests.tsx", "workFocused.current");
    vm.runInNewContext(script, scope)(); expect(setSection).toHaveBeenCalledWith("ready"); expect(lookup).not.toHaveBeenCalled();
    vm.runInNewContext(script, { ...scope, section: "ready" })();
    expect(lookup).toHaveBeenCalledWith("ticket-material-30-40"); expect(scroll).toHaveBeenCalledOnce();
  });
});

describe("Personal external maintenance and settlement actions", () => {
  const external = (patch: any = {}) => ({ ticketId: 1, itemId: 2, ticketNumber: "MT-1", itemPath: "C", itemStatus: "work_approved", itemApprovedAt: 3000, ...patch });
  it("keeps warehouse-only actions and does not mistake an editable delegate wait for warehouse work", () => {
    expect(classifyExternalOperations(actor("warehouse"), [external()])).toMatchObject([{ action: "external_prepare", arrivedAt: 3000 }]);
    expect(classifyExternalOperations(actor("senior_management"), [external()])).toEqual([]);
    expect(classifyExternalOperations(actor("warehouse"), [external({ jobId: 3, jobStatus: "waiting_delegate_receipt", delegateReceiptStatus: "pending" })])).toEqual([]);
    expect(classifyExternalOperations(actor("warehouse"), [external({ jobId: 3, jobStatus: "waiting_warehouse_receipt", gateEntryAt: 9000 })])).toMatchObject([{ action: "external_receive", arrivedAt: 9000 }]);
    expect(classifyExternalOperations(actor("warehouse"), [external({ jobId: 3, jobStatus: "waiting_technician_handover", assignedToId: 9, receivedAt: 10000 })])).toMatchObject([{ action: "external_handover", arrivedAt: 10000 }]);
    expect(classifyExternalOperations(actor("warehouse"), [external({ jobId: 3, jobStatus: "waiting_technician_handover", assignedToId: null })])).toEqual([]);
    expect(classifyExternalOperations(actor("warehouse"), [external({ itemStatus: "under_inspection" })])).toEqual([]);
  });
  it("returns the same request after delegate rejection, from rejection time rather than first preparation", () => {
    expect(classifyExternalOperations(actor("warehouse"), [external({ jobId: 3, jobStatus: "waiting_warehouse_preparation", delegateReceiptStatus: "rejected", delegateReceiptAtMs: 9000 })]))
      .toMatchObject([{ action: "external_prepare", arrivedAt: 9000, href: "/external-maintenance?workJob=3" }]);
  });
  it("does not turn senior warehouse oversight into operational obligations or read disabled optional tables", async () => {
    const db = database(); expect(await readWarehouseOperations(db, actor("senior_management"))).toEqual([]); expect(db.execute).not.toHaveBeenCalled();
    const warehouse = database(); await readWarehouseOperations(warehouse, actor("warehouse")); expect(warehouse.queries).toHaveLength(1);
    expect(warehouse.queries[0].sql).toContain("your-work:external");
  });
  it("checks settlement participation, pending corrections and exact preparer ownership", () => {
    const row = { id: 1, status: "pending_review", operationNumber: "CNT-1", preparedById: 9, lastSubmittedById: 9, submittedAtMs: 8000 };
    expect(classifySettlementOperations(actor("senior_management"), [row])).toMatchObject([{ action: "settlement_review", arrivedAt: 8000 }]);
    for (const patch of [{ preparedById: 7 }, { lastSubmittedById: 7 }, { contributed: 1 }, { correctionId: 2 }]) expect(classifySettlementOperations(actor("senior_management"), [{ ...row, ...patch }])).toEqual([]);
    expect(classifySettlementOperations(actor("warehouse"), [{ ...row, status: "returned", preparedById: 7, returnedAt: 9000, correctionId: 3 }])).toMatchObject([{ action: "settlement_correct", arrivedAt: 9000 }]);
    expect(classifySettlementOperations(actor("warehouse", 8), [{ ...row, status: "returned", preparedById: 7 }])).toEqual([]);
  });
  it("loads settlement status and evidence in one query and propagates database failures", async () => {
    const db = database(); await readSettlementOperations(db, actor("senior_management")); expect(db.queries).toHaveLength(1);
    expect(db.queries[0].sql).toContain("inventory_settlement_draft_events"); expect(db.queries[0].sql).toContain("correction.status='pending'");
    await expect(readTicketOperations({ execute: async () => { throw Error("fixture infrastructure failure"); } }, actor())).rejects.toThrow("fixture infrastructure failure");
  });
  it("keeps approved operational issues out until a valid stock allocation can actually be made", async () => {
    f.enabled = true;
    const data = { "operational-orders": [{ id: 1, orderNumber: "OPR-1", status: "approved", approvedAt: 8000 }],
      "operational-lines": [{ id: 2, orderId: 1, catalogItemId: 3, quantity: 2, issuedQuantity: 0, unit: "piece" }] };
    expect(await readOperationalIssueOperations(database(data), actor("warehouse"))).toEqual([]);
    f.stocks = [{ itemId: 2, totalQuantity: 2, needsReview: false, unit: "piece", lots: [{ inventoryId: 4, lotId: 5, quantity: 2, receivedAt: "2026-11-28", unit: "piece" }] }];
    expect(await readOperationalIssueOperations(database(data), actor("warehouse"))).toMatchObject([{ action: "operational_issue", arrivedAt: null, href: expect.stringContaining("orderId=1") }]);
    f.stocks[0].lots[0].quantity = 0.5;
    expect(await readOperationalIssueOperations(database(data), actor("warehouse"))).toEqual([]);
  });
  it("only offers the operational shortage draft after real rollout and current uncovered valid stock, in batches", async () => {
    f.enabled = true;
    const line = { id: 2, orderId: 1, catalogItemId: 3, itemName: "Cable", quantity: 2, issuedQuantity: 0, unit: "piece", activeCatalogItemId: 3, validDestination: 1, inactiveUnit: 0 };
    const data = { "operational-orders": [{ id: 1, orderNumber: "OPR-1", status: "approved", approvedAt: 8000 }], "operational-lines": [line] };
    f.stocks = [{ itemId: 2, totalQuantity: 1, needsReview: false, unit: "piece", lots: [{ inventoryId: 4, lotId: 5, quantity: 1, receivedAt: "2026-11-28", unit: "piece" }] }];
    expect(await readOperationalIssueOperations(database(data), actor("warehouse"))).toEqual([]);
    f.procurement = true;
    const db = database(data);
    expect(await readOperationalIssueOperations(db, actor("warehouse"))).toMatchObject([{ action: "operational_purchase", title: "Cable", arrivedAt: null, href: expect.stringContaining("workLine=2") }]);
    expect(db.queries.filter(query => query.sql.includes("your-work:operational-purchase-links"))).toHaveLength(1);
    expect(await readOperationalIssueOperations(database({ ...data, "operational-purchase-links": [{ orderItemId: 2 }] }), actor("warehouse"))).toEqual([]);
    for (const patch of [{ activeCatalogItemId: null }, { validDestination: 0 }, { inactiveUnit: 1 }])
      expect(await readOperationalIssueOperations(database({ ...data, "operational-lines": [{ ...line, ...patch }] }), actor("warehouse"))).toEqual([]);
    f.stocks[0].needsReview = true;
    expect(await readOperationalIssueOperations(database(data), actor("warehouse"))).toEqual([]);
  });
  it("uses actual IT manager IDs, and only queries purchase creation at an uncovered legacy B stage", async () => {
    const db = database({ "it-purchase-needs": [{ id: 2, ticketId: 3, ticketNumber: "MT-3", managerId: 7, maintenanceResponsibleDepartment: DEPT.IT, maintenanceResponsibleManagerId: 7, arrivedAt: 8000 }] });
    expect(await readOtherOperations(db, actor("it_manager"))).toMatchObject([{ action: "it_purchase_review", arrivedAt: 8000 }]);
    expect(db.queries.find(query => query.sql.includes("it-purchase-create"))!.sql).toContain("NOT EXISTS (SELECT 1 FROM ticket_team_assignments");
    const wrong = database({ "it-purchase-needs": [{ id: 2, ticketId: 3, ticketNumber: "MT-3", managerId: 8, maintenanceResponsibleDepartment: DEPT.IT, maintenanceResponsibleManagerId: 8 }] });
    expect(await readOtherOperations(wrong, actor("it_manager"))).toEqual([]);
  });
  it("waits for the required complete cost study before asking management to decide, with its own arrival time", async () => {
    const idea = { id: 1, requestNumber: "IDEA-1", status: "classified", costStudyRequired: 1, executionTrackingVersion: 1, classifiedAt: 1000 };
    expect(await readOtherOperations(database({ ideas: [idea] }), actor("senior_management"))).toEqual([]);
    expect(await readOtherOperations(database({ ideas: [idea] }), actor("general_maintenance_manager"))).toMatchObject([{ action: "idea_study", arrivedAt: 1000 }]);
    const complete = { ...idea, costStudiedAt: "2026-11-28", costStudiedAtMs: 9000, costStudyById: 7, costStudyNotes: "Ready", estimatedMaterialsCost: "1.00", estimatedLaborCost: "0.00", estimatedServicesCost: "0.00" };
    expect(await readOtherOperations(database({ ideas: [complete] }), actor("senior_management"))).toMatchObject([{ action: "idea_decide", arrivedAt: 9000 }]);
    expect(await readOtherOperations(database({ ideas: [{ ...complete, costStudyNotes: "" }] }), actor("senior_management"))).toEqual([]);
  });
});
