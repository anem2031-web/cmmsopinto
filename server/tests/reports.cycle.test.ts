import { describe, expect, it, vi } from "vitest";

// ─── Hoisted mocks ─────────────────────────────────────────────────────────────
// routers.ts uses: import * as db from "../_core/db"
// so we mock named exports directly (not a { db } object)
const mockFns = vi.hoisted(() => ({
  getPurchaseOrders: vi.fn().mockResolvedValue([]),
  getAllPOItems: vi.fn().mockResolvedValue([]),
  getAllUsers: vi.fn().mockResolvedValue([]),
  getTickets: vi.fn().mockResolvedValue([]),
  getAllSites: vi.fn().mockResolvedValue([]),
  getTicketHistory: vi.fn().mockResolvedValue([]),
  getDashboardStats: vi.fn().mockResolvedValue({}),
  getTicketById: vi.fn().mockResolvedValue(null),
  createTicket: vi.fn().mockResolvedValue(null),
  updateTicket: vi.fn().mockResolvedValue(null),
  getPurchaseOrderById: vi.fn().mockResolvedValue(null),
  createPurchaseOrder: vi.fn().mockResolvedValue(null),
  updatePurchaseOrder: vi.fn().mockResolvedValue(null),
  getInventoryItems: vi.fn().mockResolvedValue([]),
  getNotifications: vi.fn().mockResolvedValue([]),
  getAuditLogs: vi.fn().mockResolvedValue([]),
  getAuditLogsEnhanced: vi.fn().mockResolvedValue([]),
  getAllAssets: vi.fn().mockResolvedValue([]),
  getAllPreventiveTasks: vi.fn().mockResolvedValue([]),
  getTechnicianPerformance: vi.fn().mockResolvedValue([]),
  getPurchaseOrderItems: vi.fn().mockResolvedValue([]),
  getUnreadNotificationCount: vi.fn().mockResolvedValue(0),
  getNotificationById: vi.fn().mockResolvedValue(null),
  markNotificationRead: vi.fn().mockResolvedValue(null),
  markAllNotificationsRead: vi.fn().mockResolvedValue(null),
  createNotification: vi.fn().mockResolvedValue(null),
  getSites: vi.fn().mockResolvedValue([]),
  createSite: vi.fn().mockResolvedValue(null),
  updateSite: vi.fn().mockResolvedValue(null),
  deleteSite: vi.fn().mockResolvedValue(null),
  getUserById: vi.fn().mockResolvedValue(null),
  updateUser: vi.fn().mockResolvedValue(null),
  getAssetById: vi.fn().mockResolvedValue(null),
  createAsset: vi.fn().mockResolvedValue(null),
  updateAsset: vi.fn().mockResolvedValue(null),
  deleteAsset: vi.fn().mockResolvedValue(null),
  getAssetHistory: vi.fn().mockResolvedValue([]),
  createAssetHistory: vi.fn().mockResolvedValue(null),
  getPreventiveTaskById: vi.fn().mockResolvedValue(null),
  createPreventiveTask: vi.fn().mockResolvedValue(null),
  updatePreventiveTask: vi.fn().mockResolvedValue(null),
  deletePreventiveTask: vi.fn().mockResolvedValue(null),
  getInventoryItemById: vi.fn().mockResolvedValue(null),
  createInventoryItem: vi.fn().mockResolvedValue(null),
  updateInventoryItem: vi.fn().mockResolvedValue(null),
  deleteInventoryItem: vi.fn().mockResolvedValue(null),
  getInventoryTransactions: vi.fn().mockResolvedValue([]),
  createInventoryTransaction: vi.fn().mockResolvedValue(null),
  getBackupData: vi.fn().mockResolvedValue({}),
  getGateEntries: vi.fn().mockResolvedValue([]),
  createGateEntry: vi.fn().mockResolvedValue(null),
  updateGateEntry: vi.fn().mockResolvedValue(null),
  upsertUser: vi.fn().mockResolvedValue(null),
  getUserByOpenId: vi.fn().mockResolvedValue(null),
  getUserByUsername: vi.fn().mockResolvedValue(null),
  createLocalUser: vi.fn().mockResolvedValue(null),
  updateUserPassword: vi.fn().mockResolvedValue(null),
  getUsersByRole: vi.fn().mockResolvedValue([]),
  getManagerUsers: vi.fn().mockResolvedValue([]),
  updateUserRole: vi.fn().mockResolvedValue(null),
  getDb: vi.fn().mockResolvedValue(null),
}));

vi.mock("../_core/db", () => mockFns);

// ─── Import after mock setup ──────────────────────────────────────────────────
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

// ─── Context factory ──────────────────────────────────────────────────────────
type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAdminContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "admin-user",
    email: "admin@example.com",
    name: "Admin User",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { headers: { cookie: "" } } as any,
    res: { clearCookie: vi.fn(), cookie: vi.fn() } as any,
  };
}

// ─── Purchase Cycle Report Tests ──────────────────────────────────────────────
describe("reports.purchaseCycleReport", () => {
  it("returns correct top-level structure with empty data", async () => {
    mockFns.getPurchaseOrders.mockResolvedValueOnce([]);
    mockFns.getAllPOItems.mockResolvedValueOnce([]);
    mockFns.getAllUsers.mockResolvedValueOnce([]);

    const caller = appRouter.createCaller(createAdminContext());
    const result = await caller.reports.purchaseCycleReport({});

    expect(result).toHaveProperty("pos");
    expect(result).toHaveProperty("avgTotalHours");
    expect(result).toHaveProperty("phaseAvgs");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.pos)).toBe(true);
    expect(Array.isArray(result.phaseAvgs)).toBe(true);
    expect(result.total).toBe(0);
    expect(result.avgTotalHours).toBeNull();
  });

  it("phaseAvgs items have required fields", async () => {
    mockFns.getPurchaseOrders.mockResolvedValueOnce([]);
    mockFns.getAllPOItems.mockResolvedValueOnce([]);
    mockFns.getAllUsers.mockResolvedValueOnce([]);

    const caller = appRouter.createCaller(createAdminContext());
    const result = await caller.reports.purchaseCycleReport({});

    result.phaseAvgs.forEach((phase) => {
      expect(phase).toHaveProperty("phase");
      expect(phase).toHaveProperty("avgHours");
      expect(phase).toHaveProperty("count");
      expect(typeof phase.phase).toBe("string");
      expect(typeof phase.count).toBe("number");
    });
  });
});

// ─── Maintenance Cycle Report Tests ──────────────────────────────────────────
describe("reports.maintenanceCycleReport", () => {
  it("returns correct top-level structure with empty data", async () => {
    mockFns.getTickets.mockResolvedValueOnce([]);
    mockFns.getAllUsers.mockResolvedValueOnce([]);
    mockFns.getAllSites.mockResolvedValueOnce([]);

    const caller = appRouter.createCaller(createAdminContext());
    const result = await caller.reports.maintenanceCycleReport({});

    expect(result).toHaveProperty("tickets");
    expect(result).toHaveProperty("avgTotalHours");
    expect(result).toHaveProperty("avgTotalDays");
    expect(result).toHaveProperty("phaseAvgs");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("closedCount");
    expect(Array.isArray(result.tickets)).toBe(true);
    expect(Array.isArray(result.phaseAvgs)).toBe(true);
    expect(result.total).toBe(0);
    expect(result.closedCount).toBe(0);
    expect(result.avgTotalHours).toBeNull();
    expect(result.avgTotalDays).toBeNull();
  });

  it("phaseAvgs items have required fields", async () => {
    mockFns.getTickets.mockResolvedValueOnce([]);
    mockFns.getAllUsers.mockResolvedValueOnce([]);
    mockFns.getAllSites.mockResolvedValueOnce([]);

    const caller = appRouter.createCaller(createAdminContext());
    const result = await caller.reports.maintenanceCycleReport({});

    result.phaseAvgs.forEach((phase) => {
      expect(phase).toHaveProperty("phase");
      expect(phase).toHaveProperty("avgHours");
      expect(phase).toHaveProperty("count");
      expect(typeof phase.phase).toBe("string");
    });
  });
});
