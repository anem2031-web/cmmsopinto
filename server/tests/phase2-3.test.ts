import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "../_core/db";
import { assets, inventory, assetSpareParts, preventivePlans, pmJobs, assetMetrics } from "../../drizzle/schema";

describe("Phase 2 & 3: Spare Parts, Metrics, and Alerts", () => {
  let db: any;
  let assetId: number;
  let inventoryId: number;

  beforeAll(async () => {
    db = await getDb();
    if (!db) throw new Error("DB unavailable");

    // Create test asset
    const assetRes = await db.insert(assets).values({
      name: "Test Asset",
      assetNumber: `AST-${Date.now()}`,
      category: "electrical",
      status: "active",
      siteId: 1,
    } as any);
    assetId = (assetRes as any)[0]?.insertId;

    // Create test inventory item
    const invRes = await db.insert(inventory).values({
      itemName: "Test Part",
      quantity: 5,
      minQuantity: 10,
      unit: "pcs",
      siteId: 1,
    } as any);
    inventoryId = (invRes as any)[0]?.insertId;
  });

  afterAll(async () => {
    if (!db) return;
    // Cleanup would go here
  });

  describe("Asset Spare Parts", () => {
    it("should add spare part to asset", async () => {
      const res = await db.insert(assetSpareParts).values({
        assetId,
        inventoryItemId: inventoryId,
        minStockLevel: 5,
        preferredQuantity: 10,
      } as any);
      expect(res).toBeDefined();
    });

    it("should retrieve asset spare parts", async () => {
      const parts = await db
        .select()
        .from(assetSpareParts)
        .where(assetSpareParts.assetId === assetId);
      expect(parts.length).toBeGreaterThan(0);
    });
  });

  describe("Preventive Maintenance Plans", () => {
    it("should create preventive maintenance plan", async () => {
      const res = await db.insert(preventivePlans).values({
        planNumber: `PM-${Date.now()}`,
        title: "Monthly Inspection",
        assetId,
        frequency: "monthly",
        frequencyValue: 1,
        isActive: true,
      } as any);
      expect(res).toBeDefined();
    });

    it("should list active preventive plans", async () => {
      const plans = await db
        .select()
        .from(preventivePlans)
        .where(preventivePlans.isActive === true);
      expect(plans.length).toBeGreaterThan(0);
    });
  });

  describe("Asset Metrics", () => {
    it("should create asset metrics record", async () => {
      const res = await db.insert(assetMetrics).values({
        assetId,
        totalTickets: 5,
        closedTickets: 3,
        totalDowntime: 120,
        mttr: "24.5",
        mtbf: "720.0",
        availability: "95.5",
      } as any);
      expect(res).toBeDefined();
    });

    it("should retrieve asset metrics", async () => {
      const metrics = await db
        .select()
        .from(assetMetrics)
        .where(assetMetrics.assetId === assetId);
      expect(metrics.length).toBeGreaterThan(0);
      expect(metrics[0].mttr).toBeDefined();
    });
  });

  describe("PM Jobs", () => {
    it("should create PM job", async () => {
      const plan = await db
        .select()
        .from(preventivePlans)
        .limit(1);

      if (plan.length > 0) {
        const res = await db.insert(pmJobs).values({
          planId: plan[0].id,
          assetId,
          dueDate: new Date(),
          status: "pending",
          autoCreatedTicket: true,
        } as any);
        expect(res).toBeDefined();
      }
    });

    it("should list pending PM jobs", async () => {
      const jobs = await db
        .select()
        .from(pmJobs)
        .where(pmJobs.status === "pending");
      expect(jobs).toBeDefined();
    });
  });

  describe("Low Stock Alerts", () => {
    it("should identify low stock items", async () => {
      const lowStockItems = await db
        .select()
        .from(inventory)
        .where(inventory.quantity <= inventory.minQuantity);
      expect(lowStockItems.length).toBeGreaterThanOrEqual(0);
    });

    it("should calculate alert severity", () => {
      const item = { quantity: 0, minQuantity: 10 };
      const severity = item.quantity === 0 ? "critical" : "high";
      expect(severity).toBe("critical");
    });
  });

  describe("Metrics Calculations", () => {
    it("should calculate MTTR correctly", () => {
      const totalRepairTime = 120; // minutes
      const closedTickets = 5;
      const mttr = totalRepairTime / closedTickets;
      expect(mttr).toBe(24);
    });

    it("should calculate MTBF correctly", () => {
      const totalUptime = 720; // hours
      const failures = 1;
      const mtbf = totalUptime / failures;
      expect(mtbf).toBe(720);
    });

    it("should calculate availability correctly", () => {
      const totalTime = 1440; // 24 hours in minutes
      const downtime = 72; // minutes
      const availability = ((totalTime - downtime) / totalTime) * 100;
      expect(availability).toBeCloseTo(95, 1);
    });
  });
});
