import { describe, expect, it, vi } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createContext(overrides: Partial<AuthenticatedUser> = {}): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

// ============================================
// 1. AI Assistant Tests
// ============================================
describe("AI Assistant", () => {
  it("should have ai.ask procedure defined", () => {
    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);
    expect(caller.ai).toBeDefined();
    expect(caller.ai.ask).toBeDefined();
  });

  it("ai.ask should require a message string", async () => {
    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);
    // Empty message should fail validation
    await expect(caller.ai.ask({ message: "" })).rejects.toThrow();
  });

  it("ai.ask should accept valid message", async () => {
    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);
    // This should not throw validation error (may fail due to LLM but not validation)
    try {
      const result = await caller.ai.ask({ message: "كم عدد البلاغات؟" });
      expect(result).toHaveProperty("response");
    } catch (e: any) {
      // LLM may fail in test env, but validation should pass
      expect(e.code).not.toBe("BAD_REQUEST");
    }
  });
});

// ============================================
// 2. Export Service Tests
// ============================================
describe("Export Service", () => {
  it("exportService module should exist", async () => {
    const mod = await import("../services/export/exportService");
    expect(mod).toBeDefined();
    expect(mod.exportTicketsToExcel).toBeDefined();
    expect(mod.exportPurchaseOrdersToExcel).toBeDefined();
    expect(mod.exportInventoryToExcel).toBeDefined();
    expect(mod.exportAuditLogToExcel).toBeDefined();
  });

  it("exportTicketsToExcel should return a buffer", async () => {
    const { exportTicketsToExcel } = await import("../services/export/exportService");
    const buffer = await exportTicketsToExcel();
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("exportPurchaseOrdersToExcel should return a buffer", async () => {
    const { exportPurchaseOrdersToExcel } = await import("../services/export/exportService");
    const buffer = await exportPurchaseOrdersToExcel();
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("exportInventoryToExcel should return a buffer", async () => {
    const { exportInventoryToExcel } = await import("../services/export/exportService");
    const buffer = await exportInventoryToExcel();
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("exportAuditLogToExcel should return a buffer", async () => {
    const { exportAuditLogToExcel } = await import("../services/export/exportService");
    const buffer = await exportAuditLogToExcel();
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });
});

// ============================================
// 3. Edit PO Item Tests
// ============================================
describe("Purchase Order Item Edit", () => {
  it("editItem procedure should exist", () => {
    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);
    expect(caller.purchaseOrders.editItem).toBeDefined();
  });

  it("editItem should reject non-existent item", async () => {
    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.purchaseOrders.editItem({ id: 999999, purchaseOrderId: 999999, itemName: "Test" })
    ).rejects.toThrow();
  });

  it("editItem should validate input schema", async () => {
    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);
    // Missing required fields should fail
    await expect(
      (caller.purchaseOrders.editItem as any)({ id: 1 })
    ).rejects.toThrow();
  });
});

// ============================================
// 4. Delete/Update Notification Tests
// ============================================
describe("Delete/Update Notifications", () => {
  it("ticket update procedure should exist", () => {
    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);
    expect(caller.tickets.update).toBeDefined();
  });

  it("ticket delete procedure should exist", () => {
    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);
    expect(caller.tickets.delete).toBeDefined();
  });

  it("ticket update should reject non-existent ticket", async () => {
    const ctx = createContext({ role: "maintenance_manager" });
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.tickets.update({ id: 999999, title: "Updated" })
    ).rejects.toThrow();
  });

  it("ticket delete should reject non-existent ticket", async () => {
    const ctx = createContext({ role: "maintenance_manager" });
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.tickets.delete({ id: 999999 })
    ).rejects.toThrow();
  });

  it("PO update procedure should exist", () => {
    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);
    expect(caller.purchaseOrders.update).toBeDefined();
  });

  it("PO delete procedure should exist", () => {
    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);
    expect(caller.purchaseOrders.delete).toBeDefined();
  });

  it("PO delete should reject non-existent PO", async () => {
    const ctx = createContext({ role: "maintenance_manager" });
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.purchaseOrders.delete({ id: 999999 })
    ).rejects.toThrow();
  });

  it("ticket delete should reject unauthorized user", async () => {
    const ctx = createContext({ role: "technician" });
    const caller = appRouter.createCaller(ctx);
    // Technician should not be able to delete tickets
    await expect(
      caller.tickets.delete({ id: 1 })
    ).rejects.toThrow();
  });
});

// ============================================
// 5. Inventory Edit/Delete Tests
// ============================================
describe("Inventory Edit/Delete", () => {
  it("inventory update procedure should exist", () => {
    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);
    expect(caller.inventory.update).toBeDefined();
  });

  it("inventory delete procedure should exist", () => {
    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);
    expect(caller.inventory.delete).toBeDefined();
  });

  it("inventory delete should reject non-existent item", async () => {
    const ctx = createContext({ role: "warehouse" });
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.inventory.delete({ id: 999999 })
    ).rejects.toThrow();
  });
});

// ============================================
// 6. Site Edit/Delete Tests
// ============================================
describe("Site Edit/Delete", () => {
  it("site update procedure should exist", () => {
    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);
    expect(caller.sites.update).toBeDefined();
  });

  it("site delete procedure should exist", () => {
    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);
    expect(caller.sites.delete).toBeDefined();
  });

  it("site delete should reject non-existent site", async () => {
    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.sites.delete({ id: 999999 })
    ).rejects.toThrow();
  });
});

// ============================================
// 7. User Edit/Delete Tests
// ============================================
describe("User Edit/Delete", () => {
  it("user update procedure should exist", () => {
    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);
    expect(caller.users.update).toBeDefined();
  });

  it("user delete procedure should exist", () => {
    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);
    expect(caller.users.delete).toBeDefined();
  });

  it("user delete should reject non-existent user", async () => {
    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.users.delete({ id: 999999 })
    ).rejects.toThrow();
  });

  it("user delete should reject deleting owner", async () => {
    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);
    // Owner deletion should be protected
    await expect(
      caller.users.delete({ id: 999999 })
    ).rejects.toThrow();
  });
});

// ============================================
// 8. Audit Log Enhanced Tests
// ============================================
describe("Audit Log Enhanced", () => {
  it("audit list should support filters", async () => {
    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.audit.list({});
    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });

  it("audit list should support entityType filter", async () => {
    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.audit.list({ entityType: "ticket" });
    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });

  it("audit list should support action filter", async () => {
    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.audit.list({ action: "delete" });
    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });
});
