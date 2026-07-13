import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "../_core/db";
import { assets } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

describe("RFID Asset Management", () => {
  let db: any;
  const timestamp = Date.now();

  beforeAll(async () => {
    db = await getDb();
    if (!db) throw new Error("Database connection failed");
  });

  it("should create an asset with RFID tag", async () => {
    const result = await db.insert(assets).values({
      assetNumber: `RFID-${timestamp}-001`,
      name: "Test Asset with RFID",
      status: "active",
      rfidTag: `TAG-${timestamp}-001`,
      createdById: 1,
    });
    
    expect(result).toBeDefined();
  });

  it("should retrieve asset by RFID tag", async () => {
    const asset = await db
      .select()
      .from(assets)
      .where(eq(assets.rfidTag, `TAG-${timestamp}-001`))
      .limit(1);
    
    expect(asset).toHaveLength(1);
    expect(asset[0].name).toBe("Test Asset with RFID");
    expect(asset[0].rfidTag).toBe(`TAG-${timestamp}-001`);
  });

  it("should update asset RFID tag", async () => {
    const newTag = `TAG-${timestamp}-002`;
    
    await db
      .update(assets)
      .set({ rfidTag: newTag })
      .where(eq(assets.rfidTag, `TAG-${timestamp}-001`));
    
    const updated = await db
      .select()
      .from(assets)
      .where(eq(assets.rfidTag, newTag))
      .limit(1);
    
    expect(updated).toHaveLength(1);
    expect(updated[0].rfidTag).toBe(newTag);
  });

  it("should clear RFID tag (set to null)", async () => {
    const testTag = `TAG-${timestamp}-003`;
    
    // Create an asset with RFID
    await db.insert(assets).values({
      assetNumber: `RFID-${timestamp}-003`,
      name: "Null RFID Test",
      status: "active",
      rfidTag: testTag,
      createdById: 1,
    });
    
    // Update to null
    await db
      .update(assets)
      .set({ rfidTag: null })
      .where(eq(assets.rfidTag, testTag));
    
    // Verify it's cleared
    const asset = await db
      .select()
      .from(assets)
      .where(eq(assets.assetNumber, `RFID-${timestamp}-003`))
      .limit(1);
    
    expect(asset[0].rfidTag).toBeNull();
  });

  it("should handle multiple assets with different RFID tags", async () => {
    const tag1 = `TAG-${timestamp}-004`;
    const tag2 = `TAG-${timestamp}-005`;
    
    // Create two assets
    await db.insert(assets).values({
      assetNumber: `RFID-${timestamp}-004`,
      name: "Asset 1",
      status: "active",
      rfidTag: tag1,
      createdById: 1,
    });

    await db.insert(assets).values({
      assetNumber: `RFID-${timestamp}-005`,
      name: "Asset 2",
      status: "active",
      rfidTag: tag2,
      createdById: 1,
    });

    // Verify both can be retrieved
    const asset1 = await db
      .select()
      .from(assets)
      .where(eq(assets.rfidTag, tag1))
      .limit(1);
    
    const asset2 = await db
      .select()
      .from(assets)
      .where(eq(assets.rfidTag, tag2))
      .limit(1);
    
    expect(asset1).toHaveLength(1);
    expect(asset2).toHaveLength(1);
    expect(asset1[0].name).toBe("Asset 1");
    expect(asset2[0].name).toBe("Asset 2");
  });

  it("should verify RFID field is optional", async () => {
    const result = await db.insert(assets).values({
      assetNumber: `RFID-${timestamp}-006`,
      name: "Asset without RFID",
      status: "active",
      createdById: 1,
      // No rfidTag provided
    });
    
    expect(result).toBeDefined();
    
    const asset = await db
      .select()
      .from(assets)
      .where(eq(assets.assetNumber, `RFID-${timestamp}-006`))
      .limit(1);
    
    expect(asset[0].rfidTag).toBeNull();
  });
});
