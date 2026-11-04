import { APP_ROLE } from "@shared/roles";

type DelegateCandidate = { id: number; role?: string | null; isActive?: number | boolean | null };
type ReviewItem = { id: number; delegateId?: number | null };
type ReviewDecision = { delegateId?: number | null };
const selectedId = (value: unknown): number | undefined => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : undefined;

/** Stable suggestion only: no account creation or asynchronous state writes. */
export function defaultDelegateManagerId(users: DelegateCandidate[]): number | undefined {
  const ids = users.filter(user => user.role === APP_ROLE.DELEGATE_MANAGER && Number(user.isActive) === 1)
    .map(user => selectedId(user.id)).filter((id): id is number => id !== undefined);
  return ids.length > 0 ? Math.min(...ids) : undefined;
}

export function reviewDelegateId(item: ReviewItem, decision: ReviewDecision | undefined, fallback?: number): number | undefined {
  return selectedId(decision?.delegateId) ?? selectedId(item.delegateId) ?? selectedId(fallback);
}

/** A mixed selection stays blank; it must not look as if one delegate was
 * applied to all selected items. An explicit bulk choice keeps its own value. */
export function reviewBulkDelegateValue(items: ReviewItem[], decisions: Record<number, ReviewDecision>, fallback?: number, explicit?: string): string | undefined {
  if (explicit !== undefined) return explicit;
  if (items.length === 0) return fallback ? String(fallback) : undefined;
  const values = items.map(item => reviewDelegateId(item, decisions[item.id], fallback));
  return values[0] !== undefined && values.every(id => id === values[0]) ? String(values[0]) : undefined;
}
