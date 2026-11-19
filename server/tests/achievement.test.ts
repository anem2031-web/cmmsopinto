import { beforeEach, describe, expect, it, vi } from "vitest";
import { achievementElapsed, achievementDuration, achievementEventTitle, achievementStatus } from "../../shared/achievement";
import { isOwnerAdminOnlyPage, isOwnerAdminOnlyRpc } from "../../shared/restricted-module-policy";
import { createRequire } from "node:module";
import { MySqlDialect } from "drizzle-orm/mysql-core";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

const f = vi.hoisted(() => ({
  execute: vi.fn(), parents: vi.fn(), parent: vi.fn(), timeline: vi.fn(), scope: vi.fn(),
}));
vi.mock("../_core/db", () => ({
  getDb: async () => ({ execute: f.execute }), getPurchaseOrdersByIds: f.parents,
  getPurchaseOrderById: f.parent, getPOItemTimeline: f.timeline,
}));
vi.mock("../_core/authz/guard", () => ({ createPurchaseOrderReadScope: f.scope }));
import { router } from "../_core/trpc";
import { achievementRouter } from "../routers/achievement.router";
const api = router({ achievement: achievementRouter });
const caller = (role: string, isActive = 1) => api.createCaller({ user: { id: 7, role, isActive, name: "Test" } } as any).achievement;

beforeEach(() => {
  vi.clearAllMocks();
  f.scope.mockResolvedValue({ assert: () => {}, filterItems: (_parent: any, items: any[]) => items });
});

describe("achievement access and bounded reads", () => {
  it.each(["warehouse", "delegate", "delegate_manager", "senior_management", "observer"])("denies %s before reading", async role => {
    await expect(caller(role).purchaseItems({ search: "" })).rejects.toThrow();
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("denies an inactive owner and guards both the page and API", async () => {
    await expect(caller("owner", 0).purchaseItems({ search: "" })).rejects.toThrow();
    expect(isOwnerAdminOnlyPage("/achievement")).toBe(true);
    expect(isOwnerAdminOnlyRpc("achievement.purchaseItem")).toBe(true);
    expect(f.execute).not.toHaveBeenCalled();
  });
  it.each(["owner", "admin"])("allows %s, batches repeated parents, and bounds the page", async role => {
    const page = Array.from({ length: 51 }, (_, i) => ({ id: 100 - i, purchaseOrderId: i % 2 + 1, itemName: `Item ${i}` }));
    f.execute.mockResolvedValueOnce([page]);
    f.execute.mockResolvedValueOnce([[]]); // optional ticket-team tables are absent
    f.parents.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const result = await caller(role).purchaseItems({ search: "" });
    expect(result.items).toHaveLength(50);
    expect(result.nextId).toBe(51);
    expect(f.parents).toHaveBeenCalledTimes(1);
    expect(new Set(f.parents.mock.calls[0][0]).size).toBe(2);
    expect(f.execute).toHaveBeenCalledTimes(2);
    expect(result.items[0].ticketEvidenceAvailable).toBe(false);
  });
  it("denies missing parents and recalculates the scope on independent requests", async () => {
    f.execute.mockResolvedValue([[{ id: 10, purchaseOrderId: 9 }]]);
    f.parents.mockResolvedValue([]);
    const call = caller("owner");
    expect((await call.purchaseItems({ search: "" })).items).toEqual([]);
    expect((await call.purchaseItems({ search: "" })).items).toEqual([]);
    expect(f.scope).toHaveBeenCalledTimes(2);
  });
  it("propagates infrastructure failures instead of treating them as empty results", async () => {
    f.execute.mockRejectedValue(new Error("database unavailable"));
    await expect(caller("owner").purchaseItems({ search: "" })).rejects.toThrow("database unavailable");
  });
  it("reads real linked issue evidence by the same purchase item's lot and keeps different items separate", async () => {
    const mem = new DatabaseSync(":memory:");
    try {
      mem.exec(`
        CREATE TABLE purchase_orders(id INTEGER,poNumber TEXT,status TEXT,submittedAt TEXT,requestedById INTEGER,ticketId INTEGER,reviewedAt TEXT,reviewedById INTEGER);
        CREATE TABLE purchase_order_items(id INTEGER,purchaseOrderId INTEGER,itemName TEXT,quantity INTEGER,unit TEXT,status TEXT,delegateId INTEGER,reviewRole TEXT,reviewedAt TEXT,delegateAssignedAt TEXT,purchasedAt TEXT,receivedAt TEXT,deliveredAt TEXT,delegateChangeReason TEXT,itemRevisionNote TEXT,purchaseCancelReason TEXT,managementRejectionReason TEXT,reviewedById INTEGER,batchId INTEGER);
        CREATE TABLE purchase_order_item_history(purchaseOrderItemId INTEGER,newStatus TEXT,eventType TEXT,createdAt TEXT);
        CREATE TABLE users(id INTEGER,name TEXT,role TEXT);
        CREATE TABLE tickets(id INTEGER,ticketNumber TEXT);
        CREATE TABLE po_pricing_batches(id INTEGER,status TEXT,submittedAt TEXT,accountingApprovedAt TEXT,managementApprovedAt TEXT);
        CREATE TABLE ticket_team_supply_links(sourceId INTEGER,sourceKind TEXT,status TEXT,needId INTEGER);
        CREATE TABLE ticket_team_material_needs(id INTEGER,assignmentId INTEGER);
        CREATE TABLE ticket_team_assignments(id INTEGER,ticketId INTEGER);
        CREATE TABLE ticket_team_delivery_links(id INTEGER,needId INTEGER,createdAt TEXT,issuedQuantity INTEGER,deliveryNumber TEXT,receivedById INTEGER,inventoryTransactionId INTEGER,lotId INTEGER);
        CREATE TABLE inventory_lots(id INTEGER,purchaseOrderItemId INTEGER);
        CREATE TABLE inventory_transactions(id INTEGER,performedById INTEGER);
        INSERT INTO purchase_orders VALUES(1,'PR-1','pending_estimate','2026-11-01 10:00:00',1,1,NULL,NULL);
        INSERT INTO tickets VALUES(1,'MT-1'); INSERT INTO users VALUES(1,'المنشئ','warehouse'),(2,'الفني','technician'),(3,'المستودع','warehouse');
        INSERT INTO purchase_order_items(id,purchaseOrderId,itemName,quantity,unit,status) VALUES(10,1,'أول',1,'قطعة','delivered_to_warehouse'),(11,1,'ثان',1,'قطعة','pending_review');
        INSERT INTO purchase_order_item_history VALUES(11,'pending_review','item_updated','2026-11-02 11:00:00');
        INSERT INTO ticket_team_assignments VALUES(1,1); INSERT INTO ticket_team_material_needs VALUES(1,1);
        INSERT INTO ticket_team_supply_links VALUES(10,'purchase','pending',1),(11,'purchase','pending',1);
        INSERT INTO inventory_lots VALUES(20,10),(21,999);
        INSERT INTO inventory_transactions VALUES(30,3),(31,3);
        INSERT INTO ticket_team_delivery_links VALUES(40,1,'2026-11-03 10:00:00',1,'ISS-1',2,30,20),(41,1,'2026-11-03 11:00:00',1,'ISS-OTHER',2,31,21);
      `);
      const dialect = new MySqlDialect();
      f.execute.mockImplementation(async query => {
        const compiled = dialect.sqlToQuery(query);
        if (compiled.sql.includes("information_schema.TABLES")) return [[
          "ticket_team_supply_links", "ticket_team_material_needs", "ticket_team_assignments",
          "ticket_team_delivery_links", "inventory_lots", "inventory_transactions",
        ].map(name => ({ name }))];
        return [mem.prepare(compiled.sql).all(...(compiled.params as any[]))];
      });
      f.parents.mockResolvedValue([{ id: 1 }]);
      const result = await caller("owner").purchaseItems({ search: "" });
      const first = result.items.find((item: any) => item.id === 10)!;
      const second = result.items.find((item: any) => item.id === 11)!;
      expect(first.ticketNumbers).toEqual(["MT-1"]);
      expect(first.issues).toHaveLength(1);
      expect(first.issues[0]).toMatchObject({ documentNumber: "ISS-1", recipientName: "الفني", actorName: "المستودع" });
      expect(second.issues).toEqual([]);
      expect(second.reviewStartedAt).toBe("2026-11-02 11:00:00");
    } finally { mem.close(); }
  });
});

describe("honest timeline calculations", () => {
  it("counts only from the recorded submission and never invents missing or negative times", () => {
    expect(achievementElapsed("2026-11-11T17:00:00Z", "2026-11-13T05:00:00Z")).toBe(36 * 3600000);
    expect(achievementElapsed(null, new Date())).toBeNull();
    expect(achievementElapsed("2026-11-13T05:00:00Z", "2026-11-11T17:00:00Z")).toBeNull();
    expect(achievementDuration(36 * 3600000)).toBe("36 ساعة");
  });
  it("uses the assigned delegate and does not present a delegate-change note as a delay reason", () => {
    const status = achievementStatus({ id: 1, itemName: "x", poNumber: "PR", quantity: 1, status: "pending", orderStatus: "pending_estimate", delegateName: "عمر", delegateWaitStartedAt: "2026-11-13T05:00:00Z", delegateChangeReason: "نقل المندوب", ticketNumbers: [], ticketEvidenceAvailable: true, issues: [] });
    expect(status.text).toContain("عمر"); expect(status.since).toBe("2026-11-13T05:00:00Z"); expect(status.reason).toBeUndefined();
  });
  it("does not claim that a warehouse receipt proves no issue to the ticket", () => {
    const status = achievementStatus({ id: 1, itemName: "x", poNumber: "PR", quantity: 1, status: "delivered_to_warehouse", orderStatus: "received", ticketNumbers: ["MT-1"], ticketEvidenceAvailable: false, issues: [] });
    expect(status.text).toContain("راجع الصرف"); expect(status.text).not.toContain("لم يُصرف");
    expect(achievementEventTitle({ eventType: "review_decision", newStatus: "pending" })).toContain("مراجعة");
  });
});
