import { isPmv2RecurrenceDueOnDate } from "../checklists/recurrence";
import { missedDuringPause, type PausedScheduleItem } from "./pause-recovery";

export interface ResumeOccurrence {
  itemId: number;
  /** Its original scheduled date, not the date on which the program resumes. */
  scheduledDate: string;
  kind: PausedScheduleItem["kind"];
  fromPause: boolean;
}

/**
 * Build the resume-day work in priority order. The persistent writer must
 * acquire the program lock and commit these rows with the state transition;
 * this planner deliberately makes no DB changes and does not grant access.
 */
export function planResumeOccurrences(items: readonly PausedScheduleItem[], pausedOn: string, resumedOn: string): ResumeOccurrence[] {
  const byId = new Map<number, PausedScheduleItem>();
  for (const item of items) {
    if (byId.has(item.id)) throw new Error("Duplicate scheduled item identity");
    byId.set(item.id, item);
  }
  const backlogged = missedDuringPause(items, pausedOn, resumedOn).map(row => ({
    itemId: row.itemId, scheduledDate: row.originalDueDate, kind: byId.get(row.itemId)!.kind, fromPause: true,
  }));
  const today: ResumeOccurrence[] = [];
  for (const item of items) {
    if (item.schedule.isActive === false || item.generatedDates?.includes(resumedOn)) continue;
    if (isPmv2RecurrenceDueOnDate(item.schedule, resumedOn)) {
      today.push({ itemId: item.id, scheduledDate: resumedOn, kind: item.kind, fromPause: false });
    }
  }
  // Sorting is stable within each group: preserve configured subtask order.
  return [...backlogged, ...today].sort((a, b) => Number(a.kind === "daily") - Number(b.kind === "daily"));
}
