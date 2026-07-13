import { describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createMockContext(role: string = "admin", userId: number = 1): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
    openId: `test-user-${userId}`,
    email: `user${userId}@test.com`,
    name: `Test User ${userId}`,
    loginMethod: "manus",
    role: role as any,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

function createUnauthContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("CMMS System Tests", () => {
  describe("Auth", () => {
    it("auth.me returns user for authenticated context", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.auth.me();
      expect(result).toBeDefined();
      expect(result?.id).toBe(1);
      expect(result?.role).toBe("admin");
    });

    it("auth.me returns null for unauthenticated context", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);
      const result = await caller.auth.me();
      expect(result).toBeNull();
    });

    it("auth.logout clears cookie and returns success", async () => {
      const clearedCookies: string[] = [];
      const ctx = createMockContext("admin", 1);
      ctx.res = {
        clearCookie: (name: string) => { clearedCookies.push(name); },
      } as any;
      const caller = appRouter.createCaller(ctx);
      const result = await caller.auth.logout();
      expect(result).toEqual({ success: true });
      expect(clearedCookies.length).toBe(1);
    });
  });

  describe("Dashboard", () => {
    it("dashboard.stats returns stats object", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const stats = await caller.dashboard.stats();
      expect(stats).toBeDefined();
      expect(typeof stats.openTickets).toBe("number");
      expect(typeof stats.closedToday).toBe("number");
      expect(typeof stats.criticalTickets).toBe("number");
      expect(typeof stats.pendingApprovals).toBe("number");
      expect(typeof stats.purchasedItems).toBe("number");
      expect(typeof stats.pendingPurchaseItems).toBe("number");
    });
  });

  describe("Tickets", () => {
    it("tickets.list returns array", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const tickets = await caller.tickets.list({});
      expect(Array.isArray(tickets)).toBe(true);
    });

    it("tickets.create creates a new ticket", async () => {
      const ctx = createMockContext("operations", 1);
      const caller = appRouter.createCaller(ctx);
      const ticket = await caller.tickets.create({
        title: "Test Ticket - تجربة بلاغ",
        description: "وصف تجريبي للبلاغ",
        priority: "medium",
        category: "electrical",
      });
      expect(ticket).toBeDefined();
      expect(ticket.ticketNumber).toMatch(/^MT-/);
      expect(ticket.id).toBeGreaterThan(0);
    });

    it("tickets.create fails without title", async () => {
      const ctx = createMockContext("operations", 1);
      const caller = appRouter.createCaller(ctx);
      await expect(caller.tickets.create({
        title: "",
        priority: "medium",
        category: "general",
      })).rejects.toThrow();
    });

    it("tickets.getById returns ticket details", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      // Create first
      const created = await caller.tickets.create({
        title: "Detail Test Ticket",
        priority: "high",
        category: "plumbing",
      });
      const ticket = await caller.tickets.getById({ id: created.id });
      expect(ticket).toBeDefined();
      expect(ticket?.title).toBe("Detail Test Ticket");
    });
  });

  describe("Sites", () => {
    it("sites.list returns array", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const sites = await caller.sites.list();
      expect(Array.isArray(sites)).toBe(true);
    });

    it("sites.create creates a new site", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const site = await caller.sites.create({
        name: "Test Site - موقع تجريبي",
        address: "123 Test Street",
        description: "موقع للاختبار",
      });
      expect(site).toBeDefined();
      expect(site.id).toBeGreaterThan(0);
    });
  });

  describe("Users", () => {
    it("users.list returns array", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const users = await caller.users.list();
      expect(Array.isArray(users)).toBe(true);
    });
  });

  describe("Purchase Orders", () => {
    it("purchaseOrders.list returns array", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const pos = await caller.purchaseOrders.list();
      expect(Array.isArray(pos)).toBe(true);
    });
  });

  describe("Inventory", () => {
    it("inventory.list returns array", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const items = await caller.inventory.list();
      expect(Array.isArray(items)).toBe(true);
    });

    it("inventory.create adds new item", async () => {
      const ctx = createMockContext("warehouse", 1);
      const caller = appRouter.createCaller(ctx);
      const item = await caller.inventory.create({
        itemName: "Test Item - صنف تجريبي",
        quantity: 10,
        unit: "قطعة",
        minQuantity: 2,
        location: "رف A-1",
      });
      expect(item).toBeDefined();
      expect(item.id).toBeGreaterThan(0);
    });
  });

  describe("Notifications", () => {
    it("notifications.list returns array", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const notifications = await caller.notifications.list();
      expect(Array.isArray(notifications)).toBe(true);
    });
  });

  describe("Audit Log", () => {
    it("audit.list returns array", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const logs = await caller.audit.list();
      expect(Array.isArray(logs)).toBe(true);
    });
  });

  describe("Reports", () => {
    it("reports.ticketsByStatus returns array", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const data = await caller.reports.ticketsByStatus();
      expect(Array.isArray(data)).toBe(true);
    });

    it("reports.ticketsByCategory returns array", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const data = await caller.reports.ticketsByCategory();
      expect(Array.isArray(data)).toBe(true);
    });

    it("reports.ticketsByPriority returns array", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const data = await caller.reports.ticketsByPriority();
      expect(Array.isArray(data)).toBe(true);
    });

    it("reports.technicianPerformance returns array of technician data", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const data = await caller.reports.technicianPerformance({ period: "all" });
      expect(Array.isArray(data)).toBe(true);
      // Verify structure of each technician record
      if (data.length > 0) {
        const tech = data[0];
        expect(tech).toHaveProperty("technician");
        expect(tech).toHaveProperty("totalAssigned");
        expect(tech).toHaveProperty("completed");
        expect(tech).toHaveProperty("inProgress");
        expect(tech).toHaveProperty("pending");
        expect(tech).toHaveProperty("completionRate");
        expect(tech).toHaveProperty("avgResolutionHours");
        expect(tech).toHaveProperty("minResolutionHours");
        expect(tech).toHaveProperty("maxResolutionHours");
        expect(tech).toHaveProperty("priorityBreakdown");
        expect(tech).toHaveProperty("categoryBreakdown");
        expect(tech).toHaveProperty("monthlyTrend");
        expect(tech).toHaveProperty("performanceScore");
        // Validate data types
        expect(typeof tech.totalAssigned).toBe("number");
        expect(typeof tech.completed).toBe("number");
        expect(typeof tech.completionRate).toBe("number");
        expect(typeof tech.performanceScore).toBe("number");
        expect(tech.completionRate).toBeGreaterThanOrEqual(0);
        expect(tech.completionRate).toBeLessThanOrEqual(100);
        expect(tech.performanceScore).toBeGreaterThanOrEqual(0);
        expect(tech.performanceScore).toBeLessThanOrEqual(100);
        // Validate technician object
        expect(tech.technician).toHaveProperty("id");
        expect(tech.technician).toHaveProperty("name");
        // Validate monthly trend
        expect(Array.isArray(tech.monthlyTrend)).toBe(true);
        expect(tech.monthlyTrend.length).toBe(6); // Last 6 months
        if (tech.monthlyTrend.length > 0) {
          expect(tech.monthlyTrend[0]).toHaveProperty("month");
          expect(tech.monthlyTrend[0]).toHaveProperty("assigned");
          expect(tech.monthlyTrend[0]).toHaveProperty("completed");
        }
      }
    }, 30000);

    it("reports.technicianPerformance is sorted by performance score descending", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const data = await caller.reports.technicianPerformance({ period: "all" });
      if (data.length > 1) {
        for (let i = 0; i < data.length - 1; i++) {
          expect(data[i].performanceScore).toBeGreaterThanOrEqual(data[i + 1].performanceScore);
        }
      }
    }, 30000);

    it("reports.technicianPerformance completion rate is consistent", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const data = await caller.reports.technicianPerformance({ period: "all" });
      for (const tech of data) {
        if (tech.totalAssigned > 0) {
          const expectedRate = Math.round((tech.completed / tech.totalAssigned) * 100);
          expect(tech.completionRate).toBe(expectedRate);
        } else {
          expect(tech.completionRate).toBe(0);
        }
        // pending = total - completed - inProgress
        expect(tech.pending).toBe(tech.totalAssigned - tech.completed - tech.inProgress);
      }
    }, 30000);

    it("reports.technicianPerformance with week filter returns array", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const data = await caller.reports.technicianPerformance({ period: "week" });
      expect(Array.isArray(data)).toBe(true);
      for (const tech of data) {
        expect(tech).toHaveProperty("technician");
        expect(tech).toHaveProperty("totalAssigned");
        expect(tech.completionRate).toBeGreaterThanOrEqual(0);
        expect(tech.completionRate).toBeLessThanOrEqual(100);
      }
    }, 30000);

    it("reports.technicianPerformance with month filter returns array", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const data = await caller.reports.technicianPerformance({ period: "month" });
      expect(Array.isArray(data)).toBe(true);
    }, 30000);

    it("reports.technicianPerformance with quarter filter returns array", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const data = await caller.reports.technicianPerformance({ period: "quarter" });
      expect(Array.isArray(data)).toBe(true);
    }, 30000);

    it("reports.technicianPerformance with custom date range returns array", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const data = await caller.reports.technicianPerformance({
        period: "custom",
        dateFrom: "2026-01-01",
        dateTo: "2026-12-31",
      });
      expect(Array.isArray(data)).toBe(true);
      for (const tech of data) {
        expect(tech).toHaveProperty("technician");
        expect(tech).toHaveProperty("totalAssigned");
        expect(tech).toHaveProperty("performanceScore");
        expect(tech.completionRate).toBeGreaterThanOrEqual(0);
        expect(tech.completionRate).toBeLessThanOrEqual(100);
      }
    }, 30000);

    it("reports.technicianPerformance with no input defaults to all", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const dataNoInput = await caller.reports.technicianPerformance();
      expect(Array.isArray(dataNoInput)).toBe(true);
      // Should return all technicians when no filter
      if (dataNoInput.length > 0) {
        expect(dataNoInput[0]).toHaveProperty("technician");
        expect(dataNoInput[0]).toHaveProperty("totalAssigned");
        expect(dataNoInput[0]).toHaveProperty("performanceScore");
      }
    }, 30000);
  });
});
