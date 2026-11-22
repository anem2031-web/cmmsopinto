import { isPmv2RecurrenceDueOnDate, type Pmv2RecurrenceConfig } from "../checklists/recurrence";

export type SimplifiedRecurrenceKind = "daily" | "weekly" | "monthly" | "custom";

export interface PausedScheduleItem {
  id: number;
  kind: SimplifiedRecurrenceKind;
  schedule: Pmv2RecurrenceConfig;
  /** Dates that already produced an occurrence; these must never be recreated. */
  generatedDates?: readonly string[];
}

export interface MissedScheduledItem {
  itemId: number;
  /** The original earliest missed due date, retained for traceability. */
  originalDueDate: string;
}

const DAY_MS = 86_400_000;
function dateMillis(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid calendar date");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Invalid calendar date");
  return date.getTime();
}

/**
 * Return at most one not-yet-generated occurrence per non-daily item from the
 * paused calendar dates [pausedOn, resumedOn). Today is handled by the normal
 * scheduler. Caller is responsible for persisted pause boundaries, atomic
 * creation and duplicate protection; this function never touches the database.
 * `kind` is explicit because a custom every-N-days rule is not a daily rule.
 */
export function missedDuringPause(
  items: readonly PausedScheduleItem[], pausedOn: string, resumedOn: string,
): MissedScheduledItem[] {
  const first = dateMillis(pausedOn);
  const resume = dateMillis(resumedOn);
  if (resume < first) throw new Error("Resume date precedes pause date");
  const results: MissedScheduledItem[] = [];
  for (const item of items) {
    if (item.kind === "daily" || item.schedule.isActive === false) continue;
    const generated = new Set(item.generatedDates ?? []);
    for (let time = first; time < resume; time += DAY_MS) {
      const date = new Date(time).toISOString().slice(0, 10);
      if (!generated.has(date) && isPmv2RecurrenceDueOnDate(item.schedule, date)) {
        results.push({ itemId: item.id, originalDueDate: date });
        break;
      }
    }
  }
  return results;
}
