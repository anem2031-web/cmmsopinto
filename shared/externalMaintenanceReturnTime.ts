type ReturnTimeInput = { expectedReturnDate?: string | null; gateEntryApprovedAt?: Date | string | null; warehouseReceivedAt?: Date | string | null };
export type ExternalReturnTime = { state: "missing" | "remaining" | "today" | "late"; days: number; frozen: boolean };
function calendarDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date.getTime() / 86400000 : null;
}
function riyadhDay(value: Date | string): number | null {
  const date = parseExternalTimestamp(value);
  if (!date) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return calendarDay(`${parts.find(part => part.type === "year")!.value}-${parts.find(part => part.type === "month")!.value}-${parts.find(part => part.type === "day")!.value}`);
}
export function parseExternalTimestamp(value: Date | string): Date | null {
  const text = value instanceof Date ? "" : value.trim();
  const naive = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/.exec(text);
  const fraction = naive?.[3] ? `.${naive[3].slice(0, 3).padEnd(3, "0")}` : "";
  const date = value instanceof Date ? value : new Date(naive ? `${naive[1]}T${naive[2]}${fraction}Z` : text);
  return Number.isFinite(date.getTime()) ? date : null;
}
/** A date-only deadline is inclusive of the expected day in Riyadh. Gate entry
 * freezes the count; warehouse receipt controls archive membership, not delay. */
export function externalMaintenanceReturnTime(input: ReturnTimeInput, now = new Date()): ExternalReturnTime {
  const frozen = !!input.gateEntryApprovedAt;
  const due = input.expectedReturnDate ? calendarDay(input.expectedReturnDate) : null;
  const reference = riyadhDay(input.gateEntryApprovedAt || now);
  if (due == null || reference == null) return { state: "missing", days: 0, frozen };
  const difference = due - reference;
  return { state: difference > 0 ? "remaining" : difference === 0 ? "today" : "late", days: Math.abs(difference), frozen };
}
