import { describe, expect, it } from "vitest";
import { externalMaintenanceReturnTime, parseExternalTimestamp } from "../../shared/externalMaintenanceReturnTime";

describe("External-maintenance return day in Riyadh", () => {
  it("changes at Riyadh midnight, not the browser or UTC date", () => {
    const input = { expectedReturnDate: "2026-11-05" };
    expect(externalMaintenanceReturnTime(input, new Date("2026-11-04T20:59:59Z"))).toEqual({ state: "remaining", days: 1, frozen: false });
    expect(externalMaintenanceReturnTime(input, new Date("2026-11-04T21:00:00Z"))).toEqual({ state: "today", days: 0, frozen: false });
    expect(externalMaintenanceReturnTime(input, new Date("2026-11-05T21:00:00Z"))).toEqual({ state: "late", days: 1, frozen: false });
  });
  it.each([
    ["2026-12-01", "2026-11-30T08:00:00Z", "remaining", 1],
    ["2027-01-01", "2026-12-31T08:00:00Z", "remaining", 1],
    ["2028-03-01", "2028-02-28T08:00:00Z", "remaining", 2],
    ["2026-11-01", "2026-11-04T08:00:00Z", "late", 3],
  ])("counts actual calendar days across boundaries: %s %s", (expectedReturnDate, now, state, days) => {
    expect(externalMaintenanceReturnTime({ expectedReturnDate }, new Date(now))).toMatchObject({ state, days });
  });
  it.each([null, "", "not-a-date", "2026-02-29", "2026-13-01", "2026-11-04junk", "2026-11-04T00:00:00Z"])("does not invent a deadline from %s", expectedReturnDate => {
    expect(externalMaintenanceReturnTime({ expectedReturnDate }, new Date("2026-11-04T00:00:00Z"))).toMatchObject({ state: "missing", days: 0 });
  });
  it.each(["2026-11-07 09:00:00", "2026-11-07T09:00:00", "2026-11-07T09:00:00Z", "2026-11-07T12:00:00+03:00"])("freezes lateness at actual gate entry %s", gateEntryApprovedAt => {
    const input = { expectedReturnDate: "2026-11-04", gateEntryApprovedAt };
    expect(externalMaintenanceReturnTime(input, new Date("2026-11-08T00:00:00Z"))).toEqual({ state: "late", days: 3, frozen: true });
    expect(externalMaintenanceReturnTime({ ...input, warehouseReceivedAt: "2026-11-09T09:00:00Z" }, new Date("2026-12-25T00:00:00Z"))).toEqual({ state: "late", days: 3, frozen: true });
  });
  it("counts the entry's Riyadh day even when UTC is the previous day", () => {
    expect(externalMaintenanceReturnTime({ expectedReturnDate: "2026-11-04", gateEntryApprovedAt: "2026-11-06 22:00:00" })).toEqual({ state: "late", days: 3, frozen: true });
  });
  it("handles fractional SQL timestamp and preserves explicit instants", () => {
    expect(parseExternalTimestamp("2026-11-04T21:00:00.123456")?.toISOString()).toBe("2026-11-04T21:00:00.123Z");
    expect(parseExternalTimestamp("2026-11-05T00:00:00+03:00")?.toISOString()).toBe("2026-11-04T21:00:00.000Z");
    expect(parseExternalTimestamp("invalid")).toBeNull();
  });
});
