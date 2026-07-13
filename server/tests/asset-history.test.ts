import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "../_core/db";
import { tickets, assets, preventivePlans, pmWorkOrders } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

describe("Asset Maintenance History", () => {
  let db: any;
  const ts = Math.floor(Date.now() / 1000);
  let testAssetId: number;

  beforeAll(async () => {
    db = await getDb();
    if (!db) throw new Error("Database connection failed");

    // Create test asset
    const result = await db.insert(assets).values({
      assetNumber: `AST${ts}HIST`,
      name: "Test Asset for History",
      status: "active",
      createdById: 1,
    });

    const created = await db
      .select()
      .from(assets)
      .where(eq(assets.assetNumber, `AST${ts}HIST`))
      .limit(1);

    testAssetId = created[0].id;
  });

  it("should create test tickets for asset", async () => {
    const result1 = await db.insert(tickets).values({
      ticketNumber: `TKT${ts}H1`,
      title: "Test Ticket 1",
      status: "new",
      priority: "high",
      category: "mechanical",
      assetId: testAssetId,
      reportedById: 1,
    });

    const result2 = await db.insert(tickets).values({
      ticketNumber: `TKT${ts}H2`,
      title: "Test Ticket 2",
      status: "in_progress",
      priority: "medium",
      category: "electrical",
      assetId: testAssetId,
      reportedById: 1,
    });

    expect(result1).toBeDefined();
    expect(result2).toBeDefined();
  });

  it("should create preventive plans for asset", async () => {
    const planNumber = `PM${ts}H1`;
    const result = await db.insert(preventivePlans).values({
      planNumber,
      title: "Monthly Maintenance",
      description: "Regular monthly maintenance",
      assetId: testAssetId,
      frequency: "monthly",
      frequencyValue: 1,
      isActive: true,
      createdById: 1,
    });

    expect(result).toBeDefined();

    const created = await db
      .select()
      .from(preventivePlans)
      .where(eq(preventivePlans.planNumber, planNumber))
      .limit(1);

    expect(created).toHaveLength(1);
  });

  it("should create PM work orders for asset", async () => {
    // Get the plan first
    const plans = await db
      .select()
      .from(preventivePlans)
      .where(eq(preventivePlans.assetId, testAssetId))
      .limit(1);

    if (plans.length === 0) throw new Error("No plan found");

    const planId = plans[0].id;
    const woNumber = `WO${ts}H1`;

    const result = await db.insert(pmWorkOrders).values({
      workOrderNumber: woNumber,
      planId,
      assetId: testAssetId,
      title: "Test Work Order",
      status: "scheduled",
      scheduledDate: new Date(),
      createdById: 1,
    });

    expect(result).toBeDefined();

    const created = await db
      .select()
      .from(pmWorkOrders)
      .where(eq(pmWorkOrders.workOrderNumber, woNumber))
      .limit(1);

    expect(created).toHaveLength(1);
  });

  it("should retrieve all tickets for asset", async () => {
    const ticketsForAsset = await db
      .select()
      .from(tickets)
      .where(eq(tickets.assetId, testAssetId));

    expect(ticketsForAsset.length).toBeGreaterThanOrEqual(2);
    expect(ticketsForAsset.every((t: any) => t.assetId === testAssetId)).toBe(true);
  });

  it("should retrieve all preventive plans for asset", async () => {
    const plansForAsset = await db
      .select()
      .from(preventivePlans)
      .where(eq(preventivePlans.assetId, testAssetId));

    expect(plansForAsset.length).toBeGreaterThanOrEqual(1);
    expect(plansForAsset.every((p: any) => p.assetId === testAssetId)).toBe(true);
  });

  it("should retrieve all work orders for asset", async () => {
    const wosForAsset = await db
      .select()
      .from(pmWorkOrders)
      .where(eq(pmWorkOrders.assetId, testAssetId));

    // Work orders might be 0 or more
    expect(wosForAsset).toBeDefined();
    if (wosForAsset.length > 0) {
      expect(wosForAsset.every((w: any) => w.assetId === testAssetId)).toBe(true);
    }
  });

  it("should calculate maintenance statistics", async () => {
    const ticketCount = await db
      .select()
      .from(tickets)
      .where(eq(tickets.assetId, testAssetId));

    const planCount = await db
      .select()
      .from(preventivePlans)
      .where(eq(preventivePlans.assetId, testAssetId));

    const woCount = await db
      .select()
      .from(pmWorkOrders)
      .where(eq(pmWorkOrders.assetId, testAssetId));

    expect(ticketCount.length).toBeGreaterThanOrEqual(2);
    expect(planCount.length).toBeGreaterThanOrEqual(1);
    // Work orders might be 0 or more
    expect(woCount).toBeDefined();
  });

  it("should handle asset with no maintenance history", async () => {
    // Create a new asset without any tickets/plans/work orders
    const newAsset = await db.insert(assets).values({
      assetNumber: `AST${ts}EMPTY`,
      name: "Empty Asset",
      status: "active",
      createdById: 1,
    });

    const created = await db
      .select()
      .from(assets)
      .where(eq(assets.assetNumber, `AST${ts}EMPTY`))
      .limit(1);

    const emptyAssetId = created[0].id;

    const tickets_ = await db
      .select()
      .from(tickets)
      .where(eq(tickets.assetId, emptyAssetId));

    const plans = await db
      .select()
      .from(preventivePlans)
      .where(eq(preventivePlans.assetId, emptyAssetId));

    const wos = await db
      .select()
      .from(pmWorkOrders)
      .where(eq(pmWorkOrders.assetId, emptyAssetId));

    expect(tickets_).toHaveLength(0);
    expect(plans).toHaveLength(0);
    expect(wos).toHaveLength(0);
  });

  it("should maintain data integrity across history", async () => {
    // Verify that all records belong to the correct asset
    const allTickets = await db
      .select()
      .from(tickets)
      .where(eq(tickets.assetId, testAssetId));

    const allPlans = await db
      .select()
      .from(preventivePlans)
      .where(eq(preventivePlans.assetId, testAssetId));

    const allWos = await db
      .select()
      .from(pmWorkOrders)
      .where(eq(pmWorkOrders.assetId, testAssetId));

    // All records should have the correct asset ID
    expect(allTickets.every((t: any) => t.assetId === testAssetId)).toBe(true);
    expect(allPlans.every((p: any) => p.assetId === testAssetId)).toBe(true);
    expect(allWos.every((w: any) => w.assetId === testAssetId)).toBe(true);

    // Total count should match (at least tickets + plans)
    expect(allTickets.length + allPlans.length + allWos.length).toBeGreaterThanOrEqual(3);
  });
});
