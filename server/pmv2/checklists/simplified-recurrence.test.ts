import { describe, expect, it } from "vitest";
import { buildSimplifiedSchedule } from "./simplified-recurrence";
import { isPmv2RecurrenceDueOnDate } from "./recurrence";

describe("simplified PMV2 schedule", () => {
  it("starts daily schedules on the chosen date", () => {
    const schedule = buildSimplifiedSchedule({ kind: "daily", startDate: "2026-11-07" });
    expect(isPmv2RecurrenceDueOnDate(schedule, "2026-11-06")).toBe(false);
    expect(isPmv2RecurrenceDueOnDate(schedule, "2026-11-07")).toBe(true);
  });
  it("uses the selected weekly weekday", () => {
    const schedule = buildSimplifiedSchedule({ kind: "weekly", startDate: "2026-11-01", weekday: 3 });
    expect(isPmv2RecurrenceDueOnDate(schedule, "2026-11-04")).toBe(true);
    expect(isPmv2RecurrenceDueOnDate(schedule, "2026-11-05")).toBe(false);
  });
  it("clamps day 31 in shorter months", () => {
    const schedule = buildSimplifiedSchedule({ kind: "monthly", startDate: "2027-01-01", monthDay: 31 });
    expect(isPmv2RecurrenceDueOnDate(schedule, "2027-02-28")).toBe(true);
  });
  it("supports custom every three months from the chosen date", () => {
    const schedule = buildSimplifiedSchedule({ kind: "custom", startDate: "2026-01-01", unit: "month", interval: 3 });
    expect(isPmv2RecurrenceDueOnDate(schedule, "2026-04-01")).toBe(true);
    expect(isPmv2RecurrenceDueOnDate(schedule, "2026-03-01")).toBe(false);
  });
  it("rejects invalid dates, selected days and intervals", () => {
    expect(() => buildSimplifiedSchedule({ kind: "daily", startDate: "2026-02-30" })).toThrow();
    expect(() => buildSimplifiedSchedule({ kind: "weekly", startDate: "2026-11-01", weekday: 7 })).toThrow();
    expect(() => buildSimplifiedSchedule({ kind: "custom", startDate: "2026-11-01", unit: "day", interval: 0 })).toThrow();
  });
});
