import { validatePmv2ChecklistItemWrite } from "./validation";
import type { SimplifiedRecurrenceKind } from "../scheduler/pause-recovery";

export type SimplifiedScheduleInput =
  | { kind: "daily"; startDate: string }
  | { kind: "weekly"; startDate: string; weekday: number }
  | { kind: "monthly"; startDate: string; monthDay: number }
  | { kind: "custom"; startDate: string; interval: number; unit: "day" | "week" | "month" };

/** Convert the simplified UI choices to the existing PMV2 recurrence format. */
export function buildSimplifiedSchedule(input: SimplifiedScheduleInput) {
  const start = new Date(`${input.startDate}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== input.startDate) {
    throw new Error("تاريخ بداية المهمة غير صالح");
  }
  const kind: SimplifiedRecurrenceKind = input.kind;
  let frequency: "daily" | "weekly" | "monthly";
  let frequencyValue = 1;
  let weekday: number | null = null;
  let monthDay: number | null = null;
  if (input.kind === "custom") {
    if (!Number.isSafeInteger(input.interval) || input.interval < 1 || input.interval > 3650) throw new Error("فترة التكرار غير صالحة");
    frequencyValue = input.interval;
    frequency = input.unit === "day" ? "daily" : input.unit === "week" ? "weekly" : input.unit === "month" ? "monthly" : (() => { throw new Error("وحدة التكرار غير صالحة"); })();
    if (frequency === "weekly") weekday = start.getUTCDay();
    if (frequency === "monthly") monthDay = start.getUTCDate();
  } else {
    frequency = input.kind;
    if (input.kind === "weekly") weekday = input.weekday;
    if (input.kind === "monthly") monthDay = input.monthDay;
  }
  const validated = validatePmv2ChecklistItemWrite({ checklistId: 1, title: "validation", sortOrder: 0, isRequired: true, isActive: true, frequency, frequencyValue, weekday, monthDay, anchorDate: input.startDate });
  return { kind, frequency: validated.frequency, frequencyValue: validated.frequencyValue, weekday: validated.weekday, monthDay: validated.monthDay, anchorDate: validated.anchorDate, scheduleConfigJson: validated.scheduleConfigJson ?? null };
}
