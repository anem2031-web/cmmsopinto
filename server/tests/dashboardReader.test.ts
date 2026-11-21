import { describe, expect, it } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { readDashboardData, loadDashboard, type DashboardReader } from "../services/dashboard/overview";
import { FILTERS, NOW } from "../../tools/dashboard-development/fixture";
const dialect = new MySqlDialect();
describe("dashboard database adapter using an injected fake reader", () => {
  it("issues only SELECT statements without locks, and reads raw actual cost fields", async () => {
    const statements: string[] = [];
    const reader: DashboardReader = { execute: async query => {
      const text = dialect.sqlToQuery(query).sql; statements.push(text);
      if (text.includes("FROM ticket_team_assignments")) return [[{ id: "9", ticketId: "5", managerId: "10", stage: "waiting_material", revision: "2", createdAt: String(NOW - 500000), teamName: "فريق اختبار" }], []];
      if (text.includes("FROM ticket_team_actions")) return [[
        { assignmentId: "9", actorId: "10", kind: "execution_protocol", note: JSON.stringify({ version: 1, inspectionMinutes: 120 }), createdAt: String(NOW - 500000) },
        { assignmentId: "9", actorId: "12", kind: "execution_started", note: "{}", createdAt: String(NOW - 450000) },
        { assignmentId: "9", actorId: "12", kind: "needs_material", note: "مادة", createdAt: String(NOW - 400000) },
      ], []];
      if (text.includes("FROM audit_logs")) return [[
        { entityId: "9", oldValues: JSON.stringify({ stage: "waiting_material" }), newValues: JSON.stringify({ stage: "waiting_material", note: "same stage" }), createdAt: String(NOW - 1000) },
        { entityId: "9", oldValues: JSON.stringify({ stage: "action_required" }), newValues: JSON.stringify({ stage: "waiting_material", note: "طلب مواد" }), createdAt: String(NOW - 400000) },
      ], []];
      return [[], []];
    } };
    const data = await readDashboardData(reader);
    expect(statements).toHaveLength(16);
    expect(statements.every(text => /^SELECT\s/i.test(text))).toBe(true);
    expect(statements.some(text => /FOR UPDATE|\b(?:INSERT|UPDATE|DELETE|ALTER)\b/i.test(text))).toBe(false);
    expect(statements.some(text => text.includes("actualTotalCost"))).toBe(true);
    expect(statements.some(text => /estimatedCost|estimatedTotalCost/.test(text))).toBe(false);
    expect(statements.some(text => /pmv2|pm_work_orders|preventive_plans/.test(text))).toBe(false);
    expect(statements.find(text => text.includes("FROM ticket_team_supply_links"))).toContain("a.materialRound=n.materialRound");
    expect(data.teams[0]).toMatchObject({ id: 9, ticketId: 5, enteredAt: NOW - 400000, note: "طلب مواد" });
    expect(data.teams[0]).toMatchObject({ inspectionMinutes: 120, startedById: 12, startedAt: NOW - 450000, outcomeKind: "needs_material", outcomeAt: NOW - 400000, currentWorkAt: null });
  });
  it("reads one consistent transaction snapshot when supported", async () => {
    let transactionCalls = 0, reads = 0;
    const reader: DashboardReader = {
      execute: async () => { throw new Error("read outside transaction"); },
      transaction: async work => {
        transactionCalls++;
        return work({ execute: async () => { reads++; return [[], []]; } });
      },
    };
    const report = await loadDashboard(FILTERS, reader, NOW);
    expect(transactionCalls).toBe(1);
    expect(reads).toBe(16);
    expect(report.counts.open_execution).toBe(0);
  });
  it("uses actual data supplied by the reader and does not replace errors with zeros", async () => {
    const reader: DashboardReader = { execute: async query => {
      if (dialect.sqlToQuery(query).sql.includes("FROM sites")) throw new Error("simulated read failure");
      return [[], []];
    } };
    await expect(loadDashboard(FILTERS, reader, NOW)).rejects.toThrow("simulated read failure");
  });
  it("rejects malformed driver results", async () => {
    await expect(readDashboardData({ execute: async () => ({ unexpected: true }) })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
