import { beforeEach, describe, expect, it, vi } from "vitest";
const sources = vi.hoisted(() => ({ purchases: vi.fn(), operations: vi.fn() }));
vi.mock("../services/your-work/purchases", () => ({ readYourWorkPurchases: sources.purchases }));
vi.mock("../services/your-work/operations", () => ({ readYourWorkOperations: sources.operations }));
import { readYourWork } from "../services/your-work";
import type { YourWorkItem } from "../../shared/your-work";
const identity = (id = 30, role = "warehouse", isActive = 1) => ({ id, role, isActive });
const context = (actual = identity()) => ({ user: identity(999, "admin"), authenticatedUser: actual } as any);
const now = Date.parse("2026-11-29T00:00:00+03:00");
const item = (key: string, arrivedAt: number | null): YourWorkItem => ({ key, kind: "purchase", reference: "PR-1", action: "purchase_receive", href: "/purchase-orders/1", arrivedAt });
beforeEach(() => { sources.purchases.mockReset().mockResolvedValue([]); sources.operations.mockReset().mockResolvedValue([]); });
describe("Personal action source aggregation", () => {
  it("registers both read-only sources with the actual identity, never a display projection", async () => {
    await readYourWork(context());
    for (const source of [sources.purchases, sources.operations]) {
      expect(source).toHaveBeenCalledTimes(1);
      expect(source.mock.calls[0][0]).toMatchObject({ user: identity(), authenticatedUser: identity() });
    }
  });
  it.each([identity(30, "observer"), identity(30, "delegate"), identity(30, "owner", 0)])("rejects an ineligible actual actor before either source", async actual => {
    await expect(readYourWork(context(actual))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(sources.purchases).not.toHaveBeenCalled(); expect(sources.operations).not.toHaveBeenCalled();
  });
  it("merges independent actions, removes duplicate rows, and applies the next Riyadh calendar day", async () => {
    sources.purchases.mockResolvedValue([item("purchase:1", null)]);
    sources.operations.mockResolvedValue([item("purchase:1", now - 60_000), item("purchase:2", now)]);
    const result = await readYourWork(context(), undefined, now);
    expect(result.counts).toEqual({ overdue: 1, required: 1 });
    expect(result.overdue[0].key).toBe("purchase:1"); expect(result.required[0].key).toBe("purchase:2");
  });
  it("propagates a failed source instead of claiming there is no required work", async () => {
    const failure = new Error("isolated source failure"); sources.operations.mockRejectedValue(failure);
    await expect(readYourWork(context())).rejects.toBe(failure);
  });
  it("takes fresh data and identity for each consecutive request", async () => {
    sources.purchases.mockResolvedValueOnce([item("purchase:1", now)]).mockResolvedValueOnce([]);
    expect((await readYourWork(context(identity(30)), undefined, now)).counts.required).toBe(1);
    expect((await readYourWork(context(identity(31)), undefined, now)).counts.required).toBe(0);
    expect(sources.purchases.mock.calls.map(([ctx]) => ctx.user.id)).toEqual([30, 31]);
  });
});
