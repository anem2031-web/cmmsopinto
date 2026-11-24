import { MAINTENANCE_RESPONSIBLE_DEPARTMENT } from "@shared/roles";
import {
  ticketTeamListStatuses,
  type TicketTeamListInput,
} from "@shared/maintenance-team-tickets/list";

export type TicketListDepartment = TicketTeamListInput["department"];
export type TicketListStatus = TicketTeamListInput["status"];
export type TicketListState = {
  department: TicketListDepartment;
  search: string;
  status: TicketListStatus;
  teamId?: number;
  siteId?: number;
  sectionId?: number;
  sort: "oldest" | "newest";
  page: number;
};
export const ticketListStatuses = ticketTeamListStatuses.filter(
  status => status !== "action_required"
);
const positiveId = (value: string | null) =>
  value != null &&
  /^[1-9]\d*$/.test(value) &&
  Number.isSafeInteger(Number(value))
    ? Number(value)
    : undefined;
export function readTicketListState(
  search: string,
  role?: string
): TicketListState {
  const params = new URLSearchParams(search);
  const requestedDepartment = params.get("department");
  const department =
    requestedDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.GENERAL ||
    requestedDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION
      ? requestedDepartment
      : role === "construction_procurement_manager"
        ? MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION
        : MAINTENANCE_RESPONSIBLE_DEPARTMENT.GENERAL;
  const status = params.get("status");
  const page = positiveId(params.get("page")) || 1;
  return {
    department,
    search: (params.get("search") || "").slice(0, 200),
    status: ticketTeamListStatuses.includes(status as TicketListStatus)
      ? (status as TicketListStatus)
      : "open",
    teamId: positiveId(params.get("teamId")),
    siteId: positiveId(params.get("siteId")),
    sectionId: positiveId(params.get("sectionId")),
    sort: params.get("sort") === "newest" ? "newest" : "oldest",
    page: page <= 1_000_000 ? page : 1,
  };
}
export function ticketListUrl(
  path: string,
  search: string,
  state: TicketListState
) {
  const params = new URLSearchParams(search);
  for (const key of [
    "department",
    "search",
    "status",
    "teamId",
    "siteId",
    "sectionId",
    "sort",
    "page",
  ] as const) {
    const value = state[key];
    if (value == null || value === "") params.delete(key);
    else params.set(key, String(value));
  }
  return `${path}?${params.toString()}`;
}
export function updateTicketListState(
  current: TicketListState,
  changes: Partial<TicketListState>
): TicketListState {
  return {
    ...current,
    ...changes,
    ...(changes.department != null && changes.department !== current.department
      ? { teamId: undefined }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(changes, "siteId") &&
    changes.siteId !== current.siteId
      ? { sectionId: undefined }
      : {}),
    page: changes.page ?? 1,
  };
}
