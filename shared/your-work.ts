/** Personal, read-only action inbox. No role projection or workflow writes. */
export const YOUR_WORK_PATH = "/your-work";
export const YOUR_WORK_ROLES = [
  "user", "operator", "admin", "owner", "it_manager", "it_member", "maintenance_manager",
  "general_maintenance_manager", "construction_procurement_manager", "supervisor", "purchase_requester",
  "accountant", "senior_management", "executive_director", "warehouse", "food_warehouse_manager", "food_warehouse_assistant",
] as const;
export function yourWorkRpcAllowed(actor: YourWorkIdentity | null | undefined, type: string, path: string): boolean {
  if (path !== "yourWork" && !path.startsWith("yourWork.")) return true;
  return path === "yourWork.list" && type === "query" && canReadYourWork(actor);
}
export type YourWorkIdentity = { id: number; role: string; isActive?: number | boolean; preferredLanguage?: string | null };
export function canAccessYourWork(role?: string | null): boolean {
  return !!role && (YOUR_WORK_ROLES as readonly string[]).includes(role);
}
export function canReadYourWork(actor?: YourWorkIdentity | null): actor is YourWorkIdentity {
  return !!actor && Number.isSafeInteger(actor.id) && actor.id > 0 && (actor.isActive === 1 || actor.isActive === true) && canAccessYourWork(actor.role);
}
export type YourWorkKind = "purchase" | "pricing_bundle" | "pricing_submission" | "ticket" | "team_task" | "external" | "settlement" | "pmv2" | "operational" | "supplier_return" | "idea" | "it_purchase_need" | "specification";
export type YourWorkAction =
  "purchase_draft" | "purchase_review" | "purchase_revision" | "purchase_delegate_change" | "purchase_cancel_review" |
  "purchase_accounting" | "purchase_management" | "purchase_receive" | "purchase_deliver" |
  "ticket_triage" | "ticket_plan" | "ticket_assign" | "ticket_inspection_review" | "ticket_work_review" |
  "ticket_blocker" | "ticket_external_review" | "ticket_close" | "ticket_confirm" |
  "ticket_path_select" | "ticket_promote" | "it_ticket_claim" | "it_ticket_execute" |
  "external_prepare" | "external_receive" | "external_handover" |
  "settlement_prepare" | "settlement_correct" | "settlement_review" |
  "pmv2_review" | "pmv2_blocker" | "material_provide" | "material_issue" | "material_resolve" | "material_link" | "material_return" |
  "operational_approve" | "operational_purchase" | "operational_issue" | "return_followup" | "return_refund" |
  "idea_review" | "idea_classify" | "idea_study" | "idea_decide" | "it_purchase_review" | "it_purchase_submit" | "it_purchase_create" | "specification_review";
export type YourWorkItem = {
  key: string; kind: YourWorkKind; reference: string; title?: string | null;
  action: YourWorkAction; href: string; arrivedAt: number | null;
};
export type YourWorkResponse = {
  overdue: YourWorkItem[]; required: YourWorkItem[];
  counts: { overdue: number; required: number }; generatedAt: number;
};
export function yourWorkMillis(value: unknown): number | null {
  if (value == null || value === "") return null;
  const text = typeof value === "string" ? value.trim() : "";
  // Persisted SQL TIMESTAMP strings are UTC; never interpret them in the host's local zone.
  const timestamp = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text) ? text.replace(" ", "T") + "Z" : text;
  const at = typeof value === "number" ? value : value instanceof Date ? value.getTime() : Date.parse(timestamp);
  return Number.isFinite(at) ? at : null;
}
const DAY_MS = 86400000;
const RIYADH_OFFSET_MS = 10800000;
// Unix day zero was Thursday; normalize the modulo for dates before 1970 too.
const isFriday = (day: number) => ((day + 4) % 7 + 7) % 7 === 5;
/** Allow the arrival date and one further eligible date. Friday is excluded;
 * the overdue boundary is midnight on the following non-Friday Riyadh date. */
export function yourWorkOverdueAt(arrivedAt: number | null): number | null {
  if (arrivedAt == null || !Number.isFinite(arrivedAt)) return null;
  let day = Math.floor((arrivedAt + RIYADH_OFFSET_MS) / DAY_MS);
  if (!Number.isSafeInteger(day)) return null;
  for (let allowed = 0; allowed < 2; day++) if (!isFriday(day)) allowed++;
  if (isFriday(day)) day++;
  return day * DAY_MS - RIYADH_OFFSET_MS;
}
/** Elapsed overdue time excludes Friday as well. An already overdue action
 * stays overdue on Friday, while its duration pauses until Saturday. */
export function yourWorkOverdueMillis(arrivedAt: number | null, now: number): number | null {
  const start = yourWorkOverdueAt(arrivedAt);
  if (start == null || !Number.isFinite(now)) return null;
  if (now <= start) return 0;
  const startDay = Math.floor((start + RIYADH_OFFSET_MS) / DAY_MS);
  const currentDay = Math.floor((now + RIYADH_OFFSET_MS) / DAY_MS);
  const fullDays = currentDay - startDay;
  let eligibleDays = Math.floor(fullDays / 7) * 6;
  for (let offset = 0; offset < fullDays % 7; offset++) if (!isFriday(startDay + offset)) eligibleDays++;
  const partialDay = isFriday(currentDay) ? 0 : now - (currentDay * DAY_MS - RIYADH_OFFSET_MS);
  return eligibleDays * DAY_MS + partialDay;
}
export function splitYourWork(rows: readonly YourWorkItem[], now: number): YourWorkResponse {
  const unique = new Map<string, YourWorkItem>();
  for (const row of rows) {
    if (!row.key || !row.reference || !/^\/(?!\/)[a-z]/i.test(row.href)) continue;
    const arrivedAt = yourWorkMillis(row.arrivedAt);
    const previous = unique.get(row.key);
    // A repeated current action is one row; prefer the recorded transition over missing evidence.
    if (!previous || (previous.arrivedAt == null && arrivedAt != null)) unique.set(row.key, { ...row, arrivedAt });
  }
  const overdue: YourWorkItem[] = [], required: YourWorkItem[] = [];
  for (const row of Array.from(unique.values())) {
    const overdueAt = yourWorkOverdueAt(row.arrivedAt);
    (overdueAt != null && now >= overdueAt ? overdue : required).push(row);
  }
  const compare = (a: YourWorkItem, b: YourWorkItem) => (a.arrivedAt ?? Infinity) - (b.arrivedAt ?? Infinity) || a.key.localeCompare(b.key);
  overdue.sort(compare); required.sort(compare);
  return { overdue, required, counts: { overdue: overdue.length, required: required.length }, generatedAt: now };
}
