import { describe, expect, it } from "vitest";
import { SimplifiedScheduler } from "./scheduler";
import type { SimplifiedSchedulerRepository } from "./scheduler";
import type { SimplifiedSetupTx } from "./setup-service";

function fixture(state: "active" | "paused" = "active") {
  const generated: any[] = []; const events: string[] = [];
  const tx = {
    lockPlan: async () => { events.push("lock"); return { id: 1, state, pausedOn: state === "paused" ? "2026-11-01" : null, teamId: 3, siteId: 1, sectionId: 2 }; },
    validateSiteSection: async () => { events.push("site"); return true; },
    validateTeam: async () => { events.push("team"); return true; },
    listItems: async () => { events.push("items"); return [
      { id: 1, kind: "daily", schedule: { frequency: "daily", frequencyValue: null, weekday: null, monthDay: null, anchorDate: null } },
      { id: 2, kind: "weekly", schedule: { frequency: "weekly", frequencyValue: null, weekday: 6, monthDay: null, anchorDate: null } },
    ]; },
    generate: async (_id: number, _date: string, rows: any[]) => { events.push("generate"); generated.push(...rows); },
  } as unknown as SimplifiedSetupTx;
  const repo: SimplifiedSchedulerRepository = { listActiveAfter: async last => last === 0 ? [1] : [], transaction: async work => work(tx) };
  return { scheduler: new SimplifiedScheduler(repo), generated, events };
}
describe("simplified scheduler", () => {
  it("generates weekly work before daily under the plan lock", async () => {
    const f = fixture(); const result = await f.scheduler.runForDate("2026-11-07");
    expect(result).toMatchObject({ checked: 1, failed: 0 });
    expect(f.events).toEqual(["lock", "site", "team", "items", "generate"]);
    expect(f.generated.map(x => x.itemId)).toEqual([2, 1]);
  });
  it("rechecks pause under lock and does not generate during a pause", async () => {
    const f = fixture("paused"); await f.scheduler.runForDate("2026-11-07");
    expect(f.events).toEqual(["lock"]); expect(f.generated).toEqual([]);
  });
  it("rejects invalid calendar dates", async () => {
    await expect(fixture().scheduler.runForDate("2026-02-30")).rejects.toThrow();
  });
});
