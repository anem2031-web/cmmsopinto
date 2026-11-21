import { randomUUID } from "node:crypto";
import { loadDashboard } from "./overview";
import type { DashboardFilters } from "../../../shared/dashboard-overview";

type Report = Awaited<ReturnType<typeof loadDashboard>>;
export type DashboardReadActor = { id: number; role: string };
type Snapshot = { id: string; report: Report; scope: string; expiresAt: number };
export const DASHBOARD_SNAPSHOT_TTL_MS = 120_000;

/** Short-lived, bounded read snapshots. Authorization still runs at every RPC. */
export function createDashboardSnapshots(options: {
  read?: (filters: DashboardFilters) => Promise<Report>;
  clock?: () => number;
  ttlMs?: number;
  maxEntries?: number;
} = {}) {
  const read = options.read ?? loadDashboard;
  const clock = options.clock ?? Date.now;
  const ttlMs = options.ttlMs ?? DASHBOARD_SNAPSHOT_TTL_MS;
  const maxEntries = options.maxEntries ?? 12;
  const entries = new Map<string, Snapshot>();
  const pending = new Map<string, Promise<Snapshot>>();
  const scopeKey = (actor: DashboardReadActor, filters: DashboardFilters) => JSON.stringify([
    actor.id, actor.role, filters.period, filters.department, filters.siteId ?? null, filters.search ?? "", filters.responsibleId ?? null, filters.workStatus ?? "all", filters.workType ?? "all",
    filters.period === "custom" ? filters.dateFrom : null,
    filters.period === "custom" ? filters.dateTo : null,
  ]);
  const prune = () => {
    const now = clock();
    for (const [id, snapshot] of Array.from(entries)) if (snapshot.expiresAt <= now) entries.delete(id);
  };
  async function create(actor: DashboardReadActor, filters: DashboardFilters): Promise<Snapshot> {
    const scope = scopeKey(actor, filters);
    const running = pending.get(scope);
    if (running) return running;
    const work = (async () => {
      const report = await read(filters);
      prune();
      const snapshot = { id: randomUUID(), report, scope, expiresAt: clock() + ttlMs };
      // Two recent reads of one user's view can coexist during a refresh.
      entries.set(snapshot.id, snapshot);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
      return snapshot;
    })();
    pending.set(scope, work);
    try { return await work; }
    finally { pending.delete(scope); }
  }
  async function resolve(actor: DashboardReadActor, filters: DashboardFilters, id?: string) {
    prune();
    const snapshot = id ? entries.get(id) : null;
    if (snapshot?.scope === scopeKey(actor, filters)) return snapshot;
    // Expired, evicted or foreign snapshots never bypass a fresh authorized read.
    return create(actor, filters);
  }
  return { create, resolve };
}

export const dashboardSnapshots = createDashboardSnapshots();
