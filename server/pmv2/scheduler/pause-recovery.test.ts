import { describe, expect, it } from "vitest";
import { missedDuringPause, type PausedScheduleItem } from "./pause-recovery";

const base = { frequencyValue: null, weekday: null, monthDay: null, anchorDate: null };
const daily: PausedScheduleItem = { id: 1, kind: "daily", schedule: { ...base, frequency: "daily" } };
const weekly: PausedScheduleItem = { id: 2, kind: "weekly", schedule: { ...base, frequency: "weekly", weekday: 3 } };
const monthly: PausedScheduleItem = { id: 3, kind: "monthly", schedule: { ...base, frequency: "monthly", monthDay: 31 } };

describe("scheduled maintenance pause recovery", () => {
  it("drops daily dates and brings one missed weekly item back after resumption", () => {
    expect(missedDuringPause([daily, weekly], "2026-11-01", "2026-11-07")).toEqual([{ itemId: 2, originalDueDate: "2026-11-04" }]);
  });
  it("limits repeated weekly occurrences to one and skips already generated dates", () => {
    expect(missedDuringPause([{ ...weekly, generatedDates: ["2026-11-04"] }], "2026-11-01", "2026-11-22")).toEqual([{ itemId: 2, originalDueDate: "2026-11-11" }]);
  });
  it("preserves end-of-month scheduling for short months", () => {
    expect(missedDuringPause([monthly], "2027-02-01", "2027-03-01")).toEqual([{ itemId: 3, originalDueDate: "2027-02-28" }]);
  });
  it("recovers custom every-two-days even though its underlying frequency is daily", () => {
    const custom: PausedScheduleItem = { id: 4, kind: "custom", schedule: { ...base, frequency: "daily", frequencyValue: 2, anchorDate: "2026-11-01" } };
    expect(missedDuringPause([custom], "2026-11-02", "2026-11-07")).toEqual([{ itemId: 4, originalDueDate: "2026-11-03" }]);
  });
  it("does not invent future, inactive, or already-generated occurrences", () => {
    expect(missedDuringPause([{ ...weekly, schedule: { ...weekly.schedule, isActive: false } }, { ...weekly, id: 5, generatedDates: ["2026-11-04"] }], "2026-11-01", "2026-11-07")).toEqual([]);
  });
  it("rejects invalid or reversed pause ranges", () => {
    expect(() => missedDuringPause([], "2026-11-07", "2026-11-01")).toThrow();
    expect(() => missedDuringPause([], "2026-02-30", "2026-03-01")).toThrow();
  });
});
