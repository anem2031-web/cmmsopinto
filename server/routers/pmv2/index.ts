import { router } from "../_shared/procedures";
import { pmv2OrganizationRouter } from "./organization";
import { pmv2TargetsRouter } from "./targets";
import { pmv2ChecklistsRouter } from "./checklists";
import { pmv2ProgramsRouter } from "./programs";
import { pmv2SchedulerRouter } from "./scheduler";
import { pmv2TasksRouter } from "./tasks";
import { pmv2TechnicianRouter } from "./technician";
import { pmv2WarehouseRouter } from "./warehouse";
import { pmv2MonitoringRouter } from "./monitoring";
import { pmv2ReportsRouter } from "./reports";
import { pmv2SimplifiedRouter } from "./simplified";
import { ensurePmv2AlertScheduler } from "../../pmv2/monitoring/alert-scheduler";

/**
 * PM V2 bounded-module API namespace.
 * Additive only: existing Ticket/Purchase/Inventory/Legacy PM routers are untouched.
 */
ensurePmv2AlertScheduler();

export const pmv2Router = router({
  simplified: pmv2SimplifiedRouter,
  organization: pmv2OrganizationRouter,
  targets: pmv2TargetsRouter,
  checklists: pmv2ChecklistsRouter,
  programs: pmv2ProgramsRouter,
  scheduler: pmv2SchedulerRouter,
  tasks: pmv2TasksRouter,
  technician: pmv2TechnicianRouter,
  warehouse: pmv2WarehouseRouter,
  monitoring: pmv2MonitoringRouter,
  reports: pmv2ReportsRouter,
});
