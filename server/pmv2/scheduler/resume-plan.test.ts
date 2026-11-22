import { describe, expect, it } from "vitest";
import { planResumeOccurrences } from "./resume-plan";
import type { PausedScheduleItem } from "./pause-recovery";
const base = { frequencyValue: null, weekday: null, monthDay: null, anchorDate: null };
const items: PausedScheduleItem[] = [
  { id: 1, kind: "daily", schedule: { ...base, frequency: "daily" } },
  { id: 2, kind: "weekly", schedule: { ...base, frequency: "weekly", weekday: 3 } },
  { id: 3, kind: "monthly", schedule: { ...base, frequency: "monthly", monthDay: 7 } },
];
describe("resume day work plan", () => {
  it("places the missed weekly item and due monthly item before today's daily", () => {
    expect(planResumeOccurrences(items, "2026-11-01", "2026-11-07")).toEqual([
      { itemId: 2, scheduledDate: "2026-11-04", kind: "weekly", fromPause: true },
      { itemId: 3, scheduledDate: "2026-11-07", kind: "monthly", fromPause: false },
      { itemId: 1, scheduledDate: "2026-11-07", kind: "daily", fromPause: false },
    ]);
  });
  it("does not repeat generated dates and preserves today apart from missed dates", () => {
    const linked = items.map(item => item.id === 2 ? { ...item, generatedDates: ["2026-11-04"] } : item);
    expect(planResumeOccurrences(linked, "2026-11-01", "2026-11-07").map(row => row.itemId)).toEqual([3, 1]);
  });
  it("rejects duplicate item identities instead of misrouting work", () => {
    expect(() => planResumeOccurrences([items[0], items[0]], "2026-11-01", "2026-11-07")).toThrow();
  });
});
