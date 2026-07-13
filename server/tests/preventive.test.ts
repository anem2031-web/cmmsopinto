import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db module
vi.mock("./db", () => ({
  listPreventivePlans: vi.fn().mockResolvedValue([
    { id: 1, planNumber: "PM-00001", title: "فحص المكيفات", frequency: "monthly", frequencyValue: 1, isActive: true, nextDueDate: new Date("2026-01-01"), checklist: [{ id: "1", text: "فحص الفلتر", done: false }], createdAt: new Date() },
    { id: 2, planNumber: "PM-00002", title: "فحص المصاعد", frequency: "quarterly", frequencyValue: 1, isActive: false, nextDueDate: null, checklist: [], createdAt: new Date() },
  ]),
  listPMWorkOrders: vi.fn().mockResolvedValue([
    { id: 1, workOrderNumber: "WO-00001", title: "فحص المكيفات", status: "completed", scheduledDate: new Date("2026-01-15"), completedDate: new Date("2026-01-16"), completionPhotoUrl: "https://example.com/photo.jpg", checklistResults: [{ id: "1", done: true }], createdAt: new Date() },
    { id: 2, workOrderNumber: "WO-00002", title: "فحص المصاعد", status: "overdue", scheduledDate: new Date("2026-01-10"), completedDate: null, completionPhotoUrl: null, checklistResults: [{ id: "1", done: false }, { id: "2", done: false }], createdAt: new Date() },
    { id: 3, workOrderNumber: "WO-00003", title: "فحص الكهرباء", status: "scheduled", scheduledDate: new Date("2026-05-01"), completedDate: null, completionPhotoUrl: null, checklistResults: [], createdAt: new Date() },
  ]),
  calcNextDueDate: vi.fn().mockReturnValue(new Date("2026-06-01")),
  generateWorkOrderNumber: vi.fn().mockResolvedValue("WO-00004"),
  createPMWorkOrder: vi.fn().mockResolvedValue({ id: 4 }),
  updatePreventivePlan: vi.fn().mockResolvedValue({ success: true }),
  getDb: vi.fn(),
}));

vi.mock("../../drizzle/schema", () => ({
  preventivePlans: {},
  pmWorkOrders: {},
}));

vi.mock("../db", () => ({
  listPreventivePlans: vi.fn().mockResolvedValue([]),
  listPMWorkOrders: vi.fn().mockResolvedValue([]),
  calcNextDueDate: vi.fn().mockReturnValue(new Date("2026-06-01")),
  generateWorkOrderNumber: vi.fn().mockResolvedValue("WO-00004"),
  createPMWorkOrder: vi.fn().mockResolvedValue({ id: 4 }),
  updatePreventivePlan: vi.fn().mockResolvedValue({ success: true }),
  getDb: vi.fn(),
}));

vi.mock("../_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

// Test the PM report logic directly
describe("Preventive Maintenance Report Logic", () => {
  it("calculates summary correctly from plans", () => {
    const plans = [
      { isActive: true, nextDueDate: new Date("2020-01-01"), frequency: "monthly" },
      { isActive: true, nextDueDate: new Date("2030-01-01"), frequency: "weekly" },
      { isActive: false, nextDueDate: null, frequency: "annual" },
    ];
    const now = new Date();
    const totalPlans = plans.length;
    const activePlans = plans.filter(p => p.isActive !== false).length;
    const inactivePlans = totalPlans - activePlans;
    const overduePlans = plans.filter(p => {
      if (!p.nextDueDate || p.isActive === false) return false;
      return new Date(p.nextDueDate) < now;
    }).length;
    expect(totalPlans).toBe(3);
    expect(activePlans).toBe(2);
    expect(inactivePlans).toBe(1);
    expect(overduePlans).toBe(1);
  });

  it("calculates work order completion rate correctly", () => {
    const workOrders = [
      { status: "completed" },
      { status: "completed" },
      { status: "overdue" },
      { status: "scheduled" },
    ];
    const total = workOrders.length;
    const completed = workOrders.filter(wo => wo.status === "completed").length;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    expect(completionRate).toBe(50);
  });

  it("calculates checklist completion rate correctly", () => {
    const workOrders = [
      { checklistResults: [{ done: true }, { done: false }, { done: true }] },
      { checklistResults: [{ done: true }, { done: true }] },
    ];
    let total = 0;
    let done = 0;
    workOrders.forEach(wo => {
      if (Array.isArray(wo.checklistResults)) {
        total += wo.checklistResults.length;
        done += wo.checklistResults.filter(c => c.done).length;
      }
    });
    const rate = total > 0 ? Math.round((done / total) * 100) : 0;
    expect(total).toBe(5);
    expect(done).toBe(4);
    expect(rate).toBe(80);
  });

  it("groups plans by frequency correctly", () => {
    const plans = [
      { frequency: "monthly" },
      { frequency: "monthly" },
      { frequency: "weekly" },
      { frequency: "annual" },
    ];
    const byFrequency: Record<string, number> = {};
    plans.forEach(p => {
      byFrequency[p.frequency] = (byFrequency[p.frequency] || 0) + 1;
    });
    expect(byFrequency["monthly"]).toBe(2);
    expect(byFrequency["weekly"]).toBe(1);
    expect(byFrequency["annual"]).toBe(1);
  });

  it("filters work orders by date range correctly", () => {
    const workOrders = [
      { scheduledDate: new Date("2026-01-10") },
      { scheduledDate: new Date("2026-02-15") },
      { scheduledDate: new Date("2026-03-20") },
    ];
    const from = new Date("2026-01-15");
    const to = new Date("2026-03-01");
    const filtered = workOrders.filter(wo => {
      if (new Date(wo.scheduledDate) < from) return false;
      if (new Date(wo.scheduledDate) > to) return false;
      return true;
    });
    expect(filtered.length).toBe(1);
    expect(filtered[0].scheduledDate.toISOString().slice(0, 10)).toBe("2026-02-15");
  });
});

// Test PM Automation logic
describe("PM Automation Job Logic", () => {
  it("identifies plans that are due for work order creation", () => {
    const now = new Date();
    const pastDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); // yesterday
    const futureDate = new Date(now.getTime() + 24 * 60 * 60 * 1000); // tomorrow
    const plans = [
      { id: 1, nextDueDate: pastDate, isActive: true },
      { id: 2, nextDueDate: futureDate, isActive: true },
      { id: 3, nextDueDate: pastDate, isActive: false },
    ];
    const duePlans = plans.filter(p => p.isActive && p.nextDueDate && new Date(p.nextDueDate) <= now);
    expect(duePlans.length).toBe(1);
    expect(duePlans[0].id).toBe(1);
  });
});
