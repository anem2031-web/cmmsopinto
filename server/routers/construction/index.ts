import { router } from "../_shared/procedures";
import { projectsRouter } from "./projects.router";
import { phasesRouter } from "./phases.router";
import { activitiesRouter } from "./activities.router";
import { tasksRouter } from "./tasks.router";
import {
  taskCommentsRouter,
  taskDependenciesRouter,
  membersRouter,
  timeLogsRouter,
  customFieldsRouter,
  automationsRouter,
  goalsRouter,
  dailyReportsRouter,
  quantityTrackingRouter,
  changeOrdersRouter,
  safetyLogsRouter,
  constructionReportsRouter,
} from "./other-routers";

export const constructionRouter = router({
  projects: projectsRouter,
  phases: phasesRouter,
  activities: activitiesRouter,
  tasks: tasksRouter,
  taskComments: taskCommentsRouter,
  taskDependencies: taskDependenciesRouter,
  members: membersRouter,
  timeLogs: timeLogsRouter,
  customFields: customFieldsRouter,
  automations: automationsRouter,
  goals: goalsRouter,
  dailyReports: dailyReportsRouter,
  quantityTracking: quantityTrackingRouter,
  changeOrders: changeOrdersRouter,
  safetyLogs: safetyLogsRouter,
  reports: constructionReportsRouter,
});

export type ConstructionRouter = typeof constructionRouter;
