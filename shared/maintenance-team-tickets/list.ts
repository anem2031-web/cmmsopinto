import { z } from "zod";
import type { AssignedTeamTicket } from "./assignment";

export const ticketTeamListDepartments = [
  "maintenance_report_department_general",
  "maintenance_report_department_construction",
  "maintenance_report_department_it",
] as const;
export const ticketTeamListStatuses = [
  "open", "all", "not_started", "in_progress", "action_required", "waiting_material",
  "ready_to_repair", "awaiting_review", "blocked", "external_requested",
  "external_in_progress", "reinstall_required", "closed",
] as const;
export const ticketTeamListInput = z.object({
  department: z.enum(ticketTeamListDepartments).default(ticketTeamListDepartments[0]),
  search: z.string().max(200).optional(),
  status: z.enum(ticketTeamListStatuses).default("open"),
  teamId: z.number().int().positive().optional(),
  executorId: z.number().int().positive().optional(),
  siteId: z.number().int().positive().optional(),
  sectionId: z.number().int().positive().optional(),
  sort: z.enum(["oldest", "newest"]).default("oldest"),
  page: z.number().int().positive().max(1000000).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
  language: z.enum(["ar", "en", "ur"]).default("ar"),
}).strict();
export type TicketTeamListInput = z.infer<typeof ticketTeamListInput>;
export type ItExecutionListState = "not_started" | "in_progress" | "waiting_material" | "ready_to_repair" | "awaiting_review" | "blocked" | "external_requested" | "external_in_progress" | "reinstall_required" | "closed" | "other";
export type ItExecutionListRow = {
  id: number;
  ticketNumber: string;
  title: string;
  description: string;
  status: string;
  state: ItExecutionListState;
  assignedToId: number | null;
  assignedToName: string | null;
  siteId: number | null;
  sectionId: number | null;
  siteName: string;
  sectionName: string;
  parentTicketNumber: string | null;
  assignedAt: string | null;
};
export type TicketTeamListResult = {
  items: AssignedTeamTicket[];
  itTickets?: ItExecutionListRow[];
  total: number;
  page: number;
  pageSize: number;
  options: {
    teams: Array<{ id: number; name: string }>;
    executors?: Array<{ id: number; name: string }>;
    sites: Array<{ id: number; name: string }>;
    sections: Array<{ id: number; name: string; siteId: number }>;
  };
  /** Open assignments in each authorized department, independent of list filters. */
  departmentCounts: { general: number; construction: number; it?: number };
};
