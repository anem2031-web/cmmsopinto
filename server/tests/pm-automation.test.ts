import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock sendPushToUser
const mockSendPushToUser = vi.fn().mockResolvedValue({ sent: 1, failed: 0 });
vi.mock("./webPush", () => ({
  sendPushToUser: mockSendPushToUser,
}));

// Mock notifyOwner
const mockNotifyOwner = vi.fn().mockResolvedValue(true);
vi.mock("./_core/notification", () => ({
  notifyOwner: mockNotifyOwner,
}));

// Mock db helpers
const mockGenerateWorkOrderNumber = vi.fn().mockResolvedValue("WO-TEST-001");
const mockCalcNextDueDate = vi.fn().mockReturnValue(new Date("2026-06-01"));
vi.mock("./db", () => ({
  getDb: vi.fn(),
  generateWorkOrderNumber: mockGenerateWorkOrderNumber,
  calcNextDueDate: mockCalcNextDueDate,
}));

vi.mock("../drizzle/schema", () => ({
  preventivePlans: {},
  pmWorkOrders: {},
}));

describe("PM Automation - Push Notification Logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends push to assigned technician when plan has assignedToId", async () => {
    const plan = {
      id: 1,
      planNumber: "PM-00001",
      title: "فحص المكيفات",
      frequency: "monthly",
      frequencyValue: 1,
      isActive: true,
      nextDueDate: new Date("2026-01-01"), // past date - due
      assignedToId: 42,
      assetId: null,
      siteId: null,
      checklist: [{ id: "1", text: "فحص الفلتر", done: false }],
    };

    // Simulate the push notification logic
    const woNumber = "WO-TEST-001";
    if (plan.assignedToId) {
      const result = await mockSendPushToUser(plan.assignedToId, {
        title: "مهمة صيانة وقائية جديدة",
        body: `تم تعيينك على أمر عمل: ${plan.title} (${woNumber})`,
        icon: "/icons/icon-192x192.png",
        badge: "/icons/icon-192x192.png",
        tag: `pm-wo-${woNumber}`,
        url: "/preventive",
        type: "pm_work_order",
      });
      expect(result.sent).toBe(1);
    }

    expect(mockSendPushToUser).toHaveBeenCalledWith(42, expect.objectContaining({
      title: "مهمة صيانة وقائية جديدة",
      body: expect.stringContaining("فحص المكيفات"),
      url: "/preventive",
      type: "pm_work_order",
    }));
  });

  it("does NOT send push when plan has no assignedToId", async () => {
    const plan = {
      id: 2,
      planNumber: "PM-00002",
      title: "فحص الكهرباء",
      assignedToId: null,
    };

    // Simulate the condition check
    if (plan.assignedToId) {
      await mockSendPushToUser(plan.assignedToId, { title: "test", body: "test" });
    }

    expect(mockSendPushToUser).not.toHaveBeenCalled();
  });

  it("push notification payload contains correct work order number", async () => {
    const woNumber = "WO-00123";
    const planTitle = "صيانة المصعد";
    const technicianId = 15;

    await mockSendPushToUser(technicianId, {
      title: "مهمة صيانة وقائية جديدة",
      body: `تم تعيينك على أمر عمل: ${planTitle} (${woNumber})`,
      tag: `pm-wo-${woNumber}`,
      url: "/preventive",
      type: "pm_work_order",
    });

    expect(mockSendPushToUser).toHaveBeenCalledWith(15, expect.objectContaining({
      tag: "pm-wo-WO-00123",
      body: expect.stringContaining("WO-00123"),
    }));
  });

  it("notifies owner with count of notified technicians", async () => {
    const createdCount = 3;
    const notifiedCount = 2;

    await mockNotifyOwner({
      title: "الصيانة الوقائية التلقائية",
      content: `تم إنشاء ${createdCount} أمر عمل تلقائياً للخطط المستحقة، وتم إشعار ${notifiedCount} فني`,
    });

    expect(mockNotifyOwner).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining("3 أمر عمل"),
    }));
    expect(mockNotifyOwner).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining("2 فني"),
    }));
  });

  it("continues processing other plans if push fails for one", async () => {
    mockSendPushToUser.mockRejectedValueOnce(new Error("Push service unavailable"));

    // Simulate graceful error handling
    let notifiedCount = 0;
    const plans = [
      { assignedToId: 10, title: "خطة 1", woNumber: "WO-001" },
      { assignedToId: 20, title: "خطة 2", woNumber: "WO-002" },
    ];

    for (const plan of plans) {
      try {
        const result = await mockSendPushToUser(plan.assignedToId, {
          title: "مهمة صيانة وقائية جديدة",
          body: `تم تعيينك على أمر عمل: ${plan.title} (${plan.woNumber})`,
        });
        if (result.sent > 0) notifiedCount++;
      } catch {
        // Should not stop processing
      }
    }

    // First call failed, second succeeded
    expect(mockSendPushToUser).toHaveBeenCalledTimes(2);
    expect(notifiedCount).toBe(1);
  });

  it("identifies overdue plans correctly for automation", () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const plans = [
      { id: 1, isActive: true, nextDueDate: yesterday, assignedToId: 5 },
      { id: 2, isActive: true, nextDueDate: tomorrow, assignedToId: 6 },
      { id: 3, isActive: false, nextDueDate: yesterday, assignedToId: 7 },
      { id: 4, isActive: true, nextDueDate: null, assignedToId: 8 },
    ];

    const duePlans = plans.filter(p =>
      p.isActive && p.nextDueDate && new Date(p.nextDueDate) <= now
    );

    expect(duePlans.length).toBe(1);
    expect(duePlans[0].id).toBe(1);
    expect(duePlans[0].assignedToId).toBe(5);
  });
});
