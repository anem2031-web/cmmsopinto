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

describe("Asset Management via tRPC", () => {
  let assetId: number;

  it("creates an asset successfully", async () => {
    const result = await caller.assets.create({
      name: "TEST_Generator_Unit",
      category: "mechanical",
      status: "active",
      brand: "Caterpillar",
      model: "CAT 3516",
      serialNumber: "SN-TEST-UNIT-001",
      notes: "Test asset for unit testing",
    });
    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    assetId = result.id as number;
    expect(assetId).toBeGreaterThan(0);
  });

  it("lists assets and finds the created one", async () => {
    const assets = await caller.assets.list({});
    const found = assets.find((a: any) => a.name === "TEST_Generator_Unit");
    expect(found).toBeDefined();
    expect(found?.brand).toBe("Caterpillar");
  });

  it("gets asset by id", async () => {
    const asset = await caller.assets.getById({ id: assetId });
    expect(asset).toBeDefined();
    expect(asset?.name).toBe("TEST_Generator_Unit");
  });

  it("updates an asset status", async () => {
    await caller.assets.update({ id: assetId, status: "under_maintenance" });
    const updated = await caller.assets.getById({ id: assetId });
    expect(updated?.status).toBe("under_maintenance");
  });

  it("deletes an asset", async () => {
    const result = await caller.assets.delete({ id: assetId });
    expect(result.success).toBe(true);
  });
});

describe("Preventive Maintenance Plans via tRPC", () => {
  let planId: number;

  it("creates a preventive plan successfully", async () => {
    const result = await caller.preventive.createPlan({
      title: "TEST_Monthly_Inspection_Plan",
      description: "Monthly inspection test plan",
      frequency: "monthly",
      frequencyValue: 1,
      nextDueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      estimatedDurationMinutes: 120,
      checklist: [
        { id: "c1", text: "Check oil level", required: true },
        { id: "c2", text: "Inspect belts", required: false },
      ],
    });
    expect(result).toBeDefined();
    expect(result.id).toBeGreaterThan(0);
    planId = result.id;
  });

  it("lists preventive plans and finds the created one", async () => {
    const plans = await caller.preventive.listPlans({});
    const found = plans.find((p: any) => p.title === "TEST_Monthly_Inspection_Plan");
    expect(found).toBeDefined();
    expect(found?.frequency).toBe("monthly");
    expect(found?.frequencyValue).toBe(1);
  });
});
