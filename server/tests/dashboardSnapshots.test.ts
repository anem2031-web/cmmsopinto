import { describe, expect, it, vi } from "vitest";
import { buildDashboard, dashboardDetails } from "../../shared/dashboard-overview";
import { createDashboardSnapshots } from "../services/dashboard/snapshots";
import { fixture, FILTERS, NOW } from "../../tools/dashboard-development/fixture";

const actor = { id: 42, role: "admin" };
function setup() {
  let now = NOW;
  const read = vi.fn(async filters => buildDashboard(fixture(), filters, now));
  const store = createDashboardSnapshots({ read, clock: () => now, ttlMs: 120_000, maxEntries: 2 });
  return { store, read, advance: (ms: number) => { now += ms; } };
}
describe("scoped dashboard read snapshots", () => {
  it("reuses the overview read for every card and page without reading again", async () => {
    const { store, read } = setup();
    const main = await store.create(actor, FILTERS);
    for (const metric of ["open_execution", "received_value", "completed_execution"] as const) {
      const snapshot = await store.resolve(actor, FILTERS, main.id);
      expect(snapshot.report).toBe(main.report);
      expect(dashboardDetails(snapshot.report, metric).total).toBe(main.report.counts[metric]);
      await store.resolve(actor, FILTERS, main.id);
    }
    expect(read).toHaveBeenCalledTimes(1);
  });
  it.each([
    { id: 43, role: "admin" }, { id: 42, role: "owner" }, { id: 42, role: "observer" },
  ])("never reuses another authenticated identity or role's snapshot", async other => {
    const { store, read } = setup();
    const main = await store.create(actor, FILTERS);
    expect((await store.resolve(other, FILTERS, main.id)).id).not.toBe(main.id);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("isolates different site and department filters", async () => {
    const { store, read } = setup();
    const main = await store.create(actor, FILTERS);
    const filtered = await store.resolve(actor, { ...FILTERS, siteId: 2, department: "construction" }, main.id);
    expect(filtered.id).not.toBe(main.id);
    expect(filtered.report.counts.open_execution).toBe(0);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("never reuses a snapshot for a different search, responsible person or work status", async () => {
    for (const change of [{ search: "MT-123" }, { responsibleId: 12 }, { workStatus: "overdue" as const }, { workType: "purchases" as const }]) {
      const { store, read } = setup(); const main = await store.create(actor, FILTERS);
      expect((await store.resolve(actor, { ...FILTERS, ...change }, main.id)).id).not.toBe(main.id);
      expect(read).toHaveBeenCalledTimes(2);
    }
  });
  it("expires after two minutes and manual refresh always produces a new read", async () => {
    const { store, read, advance } = setup();
    const main = await store.create(actor, FILTERS);
    advance(120_000);
    const fresh = await store.resolve(actor, FILTERS, main.id);
    expect(fresh.id).not.toBe(main.id);
    const refresh = await store.create(actor, FILTERS);
    expect(refresh.id).not.toBe(fresh.id);
    expect(read).toHaveBeenCalledTimes(3);
  });
  it("bounds stored reports and safely rereads an evicted snapshot", async () => {
    const { store, read } = setup();
    const main = await store.create(actor, FILTERS);
    await store.create(actor, { ...FILTERS, siteId: 1 });
    await store.create(actor, { ...FILTERS, siteId: 2 });
    expect((await store.resolve(actor, FILTERS, main.id)).id).not.toBe(main.id);
    expect(read).toHaveBeenCalledTimes(4);
  });
  it("shares concurrent identical reads and removes rejected reads for a retry", async () => {
    let complete!: (report: ReturnType<typeof buildDashboard>) => void;
    const read = vi.fn(() => new Promise<ReturnType<typeof buildDashboard>>(resolve => { complete = resolve; }));
    const store = createDashboardSnapshots({ read, clock: () => NOW });
    const first = store.create(actor, FILTERS), second = store.create(actor, FILTERS);
    complete(buildDashboard(fixture(), FILTERS, NOW));
    expect((await first).id).toBe((await second).id);
    expect(read).toHaveBeenCalledTimes(1);
    const failure = vi.fn().mockRejectedValueOnce(new Error("simulated failure")).mockResolvedValue(buildDashboard(fixture(), FILTERS, NOW));
    const retry = createDashboardSnapshots({ read: failure });
    await expect(retry.create(actor, FILTERS)).rejects.toThrow("simulated failure");
    await expect(retry.create(actor, FILTERS)).resolves.toHaveProperty("report");
    expect(failure).toHaveBeenCalledTimes(2);
  });
});
