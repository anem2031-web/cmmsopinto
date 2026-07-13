import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "../_core/db";
import { tickets, assets } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

describe("Ticket-Asset Linking", () => {
  let db: any;
  const ts = Math.floor(Date.now() / 1000); // Shorter timestamp

  beforeAll(async () => {
    db = await getDb();
    if (!db) throw new Error("Database connection failed");
  });

  it("should create an asset first", async () => {
    const result = await db.insert(assets).values({
      assetNumber: `AST${ts}1`,
      name: "Test Asset for Ticket",
      status: "active",
      createdById: 1,
    });
    
    expect(result).toBeDefined();
  });

  it("should create a ticket linked to an asset", async () => {
    // Get the asset we just created
    const asset = await db
      .select()
      .from(assets)
      .where(eq(assets.assetNumber, `AST${ts}1`))
      .limit(1);
    
    expect(asset).toHaveLength(1);
    const assetId = asset[0].id;

    // Create a ticket linked to this asset
    const result = await db.insert(tickets).values({
      ticketNumber: `TKT${ts}1`,
      title: "Test Ticket Linked to Asset",
      description: "This ticket is linked to an asset",
      status: "new",
      priority: "high",
      category: "mechanical",
      assetId: assetId,
      reportedById: 1,
    });

    expect(result).toBeDefined();
  });

  it("should retrieve ticket by asset ID", async () => {
    // Get the asset
    const asset = await db
      .select()
      .from(assets)
      .where(eq(assets.assetNumber, `AST${ts}1`))
      .limit(1);
    
    const assetId = asset[0].id;

    // Get tickets for this asset
    const ticketsForAsset = await db
      .select()
      .from(tickets)
      .where(eq(tickets.assetId, assetId));

    expect(ticketsForAsset.length).toBeGreaterThan(0);
    expect(ticketsForAsset[0].assetId).toBe(assetId);
  });

  it("should handle tickets without asset (optional field)", async () => {
    const result = await db.insert(tickets).values({
      ticketNumber: `TKT${ts}2`,
      title: "Ticket without Asset",
      description: "This ticket has no asset linked",
      status: "new",
      priority: "medium",
      category: "general",
      reportedById: 1,
      // assetId is optional
    });

    expect(result).toBeDefined();

    // Verify the ticket was created with null assetId
    const ticket = await db
      .select()
      .from(tickets)
      .where(eq(tickets.ticketNumber, `TKT${ts}2`))
      .limit(1);

    expect(ticket[0].assetId).toBeNull();
  });

  it("should update ticket with asset ID", async () => {
    // Get the asset
    const asset = await db
      .select()
      .from(assets)
      .where(eq(assets.assetNumber, `AST${ts}1`))
      .limit(1);
    
    const assetId = asset[0].id;

    // Get the ticket without asset
    const ticket = await db
      .select()
      .from(tickets)
      .where(eq(tickets.ticketNumber, `TKT${ts}2`))
      .limit(1);

    // Update it with asset ID
    await db
      .update(tickets)
      .set({ assetId: assetId })
      .where(eq(tickets.id, ticket[0].id));

    // Verify update
    const updated = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, ticket[0].id))
      .limit(1);

    expect(updated[0].assetId).toBe(assetId);
  });

  it("should filter tickets by asset ID", async () => {
    // Create multiple assets
    await db.insert(assets).values({
      assetNumber: `AST${ts}2`,
      name: "Asset 1",
      status: "active",
      createdById: 1,
    });

    await db.insert(assets).values({
      assetNumber: `AST${ts}3`,
      name: "Asset 2",
      status: "active",
      createdById: 1,
    });

    // Get the actual asset IDs
    const assets1 = await db
      .select()
      .from(assets)
      .where(eq(assets.assetNumber, `AST${ts}2`))
      .limit(1);

    const assets2 = await db
      .select()
      .from(assets)
      .where(eq(assets.assetNumber, `AST${ts}3`))
      .limit(1);

    const assetId1 = assets1[0].id;
    const assetId2 = assets2[0].id;

    // Create tickets for each asset
    await db.insert(tickets).values({
      ticketNumber: `TKT${ts}3`,
      title: "Ticket for Asset 1",
      status: "new",
      priority: "medium",
      category: "general",
      assetId: assetId1,
      reportedById: 1,
    });

    await db.insert(tickets).values({
      ticketNumber: `TKT${ts}4`,
      title: "Ticket for Asset 2",
      status: "new",
      priority: "medium",
      category: "general",
      assetId: assetId2,
      reportedById: 1,
    });

    // Filter by asset 1
    const ticketsForAsset1 = await db
      .select()
      .from(tickets)
      .where(eq(tickets.assetId, assetId1));

    expect(ticketsForAsset1.length).toBeGreaterThan(0);
    expect(ticketsForAsset1.every((t: any) => t.assetId === assetId1)).toBe(true);
  });

  it("should maintain referential integrity", async () => {
    // Create a ticket with a valid asset
    const asset = await db
      .select()
      .from(assets)
      .where(eq(assets.assetNumber, `AST${ts}1`))
      .limit(1);

    const assetId = asset[0].id;

    const result = await db.insert(tickets).values({
      ticketNumber: `TKT${ts}5`,
      title: "Integrity Test Ticket",
      status: "new",
      priority: "medium",
      category: "general",
      assetId: assetId,
      reportedById: 1,
    });

    expect(result).toBeDefined();

    // Verify the ticket has the correct asset reference
    const ticket = await db
      .select()
      .from(tickets)
      .where(eq(tickets.ticketNumber, `TKT${ts}5`))
      .limit(1);

    expect(ticket[0].assetId).toBe(assetId);
  });
});
