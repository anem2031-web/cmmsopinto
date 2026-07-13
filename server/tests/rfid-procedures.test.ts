import { describe, it, expect } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

// Mock context for owner user (has managerProcedure access)
function makeCtx(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-owner",
      name: "Test Owner",
      role: "owner",
      username: "admin",
    },
    setCookie: () => {},
    clearCookie: () => {},
  } as unknown as TrpcContext;
}

const caller = appRouter.createCaller(makeCtx());

describe("RFID Tag in Asset Procedures", () => {
  let assetId: number;
  const testRfidTag = `TAG-TEST-${Date.now()}-001`;
  const newRfidTag = `TAG-TEST-${Date.now()}-002`;

  it("should create an asset WITH rfidTag (no translation fields)", async () => {
    const result = await caller.assets.create({
      name: "RFID_Test_Asset_Create",
      category: "mechanical",
      status: "active",
      brand: "TestBrand",
      model: "Model-X",
      serialNumber: "SN-RFID-001",
      rfidTag: testRfidTag,
      // Avoid notes/description to skip LLM translation
    });

    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    assetId = result.id as number;
    expect(assetId).toBeGreaterThan(0);
    expect(result.rfidTag).toBe(testRfidTag);
  }, 15000);

  it("should retrieve asset by ID and verify rfidTag is persisted", async () => {
    const asset = await caller.assets.getById({ id: assetId });
    expect(asset).toBeDefined();
    expect(asset?.name).toBe("RFID_Test_Asset_Create");
    expect(asset?.rfidTag).toBe(testRfidTag);
  }, 10000);

  it("should update asset rfidTag via update procedure", async () => {
    const result = await caller.assets.update({
      id: assetId,
      rfidTag: newRfidTag,
    });

    expect(result).toBeDefined();
    expect(result.rfidTag).toBe(newRfidTag);
  }, 10000);

  it("should verify rfidTag was updated in database", async () => {
    const asset = await caller.assets.getById({ id: assetId });
    expect(asset?.rfidTag).toBe(newRfidTag);
  }, 10000);

  it("should create asset WITHOUT rfidTag (optional field)", async () => {
    const result = await caller.assets.create({
      name: "RFID_Test_Asset_No_Tag",
      category: "electrical",
      status: "active",
      brand: "TestBrand",
      model: "Model-Y",
      serialNumber: "SN-RFID-002",
      // rfidTag intentionally omitted
    });

    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    expect(result.rfidTag).toBeNull();
  }, 15000);

  it("should retrieve asset by RFID tag using getByRfid procedure", async () => {
    const asset = await caller.assets.getByRfid({ rfidTag: newRfidTag });
    expect(asset).toBeDefined();
    expect(asset?.id).toBe(assetId);
    expect(asset?.name).toBe("RFID_Test_Asset_Create");
  }, 10000);

  it("should update asset status while preserving rfidTag", async () => {
    const result = await caller.assets.update({
      id: assetId,
      status: "under_maintenance",
    });

    expect(result).toBeDefined();
    expect(result.status).toBe("under_maintenance");
    expect(result.rfidTag).toBe(newRfidTag);
  }, 10000);

  it("should handle multiple assets with different RFID tags", async () => {
    const tag1 = `TAG-MULTI-${Date.now()}-A`;
    const tag2 = `TAG-MULTI-${Date.now()}-B`;

    const asset1 = await caller.assets.create({
      name: "Multi_Asset_1",
      rfidTag: tag1,
      status: "active",
    });

    const asset2 = await caller.assets.create({
      name: "Multi_Asset_2",
      rfidTag: tag2,
      status: "active",
    });

    const retrieved1 = await caller.assets.getByRfid({ rfidTag: tag1 });
    const retrieved2 = await caller.assets.getByRfid({ rfidTag: tag2 });

    expect(retrieved1?.id).toBe(asset1.id);
    expect(retrieved2?.id).toBe(asset2.id);
    expect(retrieved1?.name).toBe("Multi_Asset_1");
    expect(retrieved2?.name).toBe("Multi_Asset_2");
  }, 30000);
});
