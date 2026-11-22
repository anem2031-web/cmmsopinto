import type { TeamManagementActor } from "./team-management";
import type { Stage } from "./model";

export interface TeamAssignmentInput {
  ticketId: number;
  taskId: number;
  teamId: number;
  inspectionMinutes: number;
}
export interface AssignmentContext {
  parent: {
    id: number;
    ticketNumber: string;
    workflowModel: string;
    status: string;
  };
  department: {
    id: number;
    ticketId: number;
    department: string;
    responsibleManagerId: number;
  };
  task: {
    id: number;
    ticketId: number;
    ticketDepartmentId: number;
    status: string;
    convertedTicketId: number | null;
  };
}
export interface AssignmentTeam {
  id: number;
  name: string;
  active: boolean;
  warehouseId: number;
  warehouseActive: boolean;
  warehouseType: string;
  memberCount: number;
}
export interface TicketReportMedia {
  url: string;
  type: "image" | "video";
  name: string;
}
export interface AssignedTeamTicket {
  assignmentId: number;
  ticketId: number;
  ticketNumber: string;
  title: string;
  teamId: number;
  teamName: string;
  warehouseName: string;
  stage: Stage;
  sourceStatus: string;
  siteName: string;
  sectionName: string;
  description: string;
  executionInProgress?: boolean;
  hasOpenVisit?: boolean;
  reportMedia?: TicketReportMedia[];
  materialSections?: Array<"waiting" | "ready" | "returns">;
  materialNeeds?: Array<{
    needId: number;
    name: string;
    unit: string;
    section: "waiting" | "ready" | "returns";
    requestCreatorName?: string | null;
    requestCreatedAt?: string | null;
    requestedQuantity?: number;
    issuedQuantity?: number;
    returnedQuantity?: number;
    availableQuantity?: number;
    usedQuantity?: number | null;
  }>;
}
export interface AssignmentResult {
  ticketId: number;
  ticketNumber: string;
  assignmentId: number;
  alreadyExisting: boolean;
}
export interface TeamAssignmentTransaction {
  lockContext(input: TeamAssignmentInput): Promise<AssignmentContext | null>;
  existing(
    ticketId: number
  ): Promise<(AssignmentResult & { teamId: number }) | null>;
  namedAssigneeCount(taskId: number): Promise<number>;
  lockTeam(teamId: number): Promise<AssignmentTeam | null>;
  create(
    context: AssignmentContext,
    team: AssignmentTeam,
    actor: TeamManagementActor,
    inspectionMinutes: number
  ): Promise<AssignmentResult>;
}
export interface TeamAssignmentRepository {
  transaction<T>(
    work: (tx: TeamAssignmentTransaction) => Promise<T>
  ): Promise<T>;
  candidates(): Promise<AssignmentTeam[]>;
  queue(
    actor: TeamManagementActor,
    options?: { materialsOnly?: boolean; search?: string }
  ): Promise<AssignedTeamTicket[]>;
}
