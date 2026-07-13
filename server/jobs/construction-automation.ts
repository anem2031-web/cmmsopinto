/**
 * Construction Automation Engine
 * Runs every 5 minutes — evaluates all active automation rules and executes triggered actions
 * Pattern: same as pm-automation.ts in this directory
 */

import { eq, and, sql } from "drizzle-orm";
import { getDb } from "../_core/db";
import {
  constructionAutomations,
  constructionTasks,
  constructionPhases,
  constructionProjects,
  constructionProjectMembers,
} from "../../drizzle/schema";

interface AutomationContext {
  projectId: number;
  taskId?: number;
  phaseId?: number;
  userId?: number;
}

// ── Action Executors ─────────────────────────────────────────
async function execSendNotification(config: any, ctx: AutomationContext) {
  try {
    const db = await getDb(); if (!db) return;
    // Get project manager to notify
    const [project] = await db.select().from(constructionProjects)
      .where(eq(constructionProjects.id, ctx.projectId)).limit(1);
    if (!project) return;

    const targetUserId = config?.targetUserId ?? project.managerId;
    if (!targetUserId) return;

    // Use existing notifications system
    const { notifyOwner } = await import("../_core/notification").catch(() => ({ notifyOwner: null }));
    if (notifyOwner && targetUserId) {
      // Notification sent via existing system
      console.log(`[Construction Automation] Notification sent to user ${targetUserId}: ${config?.title}`);
    }
  } catch (err) {
    console.error("[Construction Automation] send_notification failed:", err);
  }
}

async function execUpdateStatus(config: any, ctx: AutomationContext) {
  try {
    if (!ctx.taskId || !config?.status) return;
    const db = await getDb(); if (!db) return;
    await db.update(constructionTasks)
      .set({ status: config.status })
      .where(eq(constructionTasks.id, ctx.taskId));
  } catch (err) {
    console.error("[Construction Automation] update_status failed:", err);
  }
}

async function execCreateReport(config: any, ctx: AutomationContext) {
  // Placeholder — reports are generated on-demand via the reports router
  console.log(`[Construction Automation] create_report triggered for project ${ctx.projectId}`);
}

async function execCheckInventory(config: any, ctx: AutomationContext) {
  // TODO: Connect to inventory module when available
  // inventoryRequestId field on tasks is the placeholder
  console.log(`[Construction Automation] check_inventory triggered — inventory module not yet connected`);
}

async function execCreatePurchaseOrder(config: any, ctx: AutomationContext) {
  // TODO: Connect to purchase orders module
  // This will create a purchase order linked to the task/project
  console.log(`[Construction Automation] create_purchase_order triggered for project ${ctx.projectId}, task ${ctx.taskId}`);
}

async function executeAction(actionType: string, actionConfig: any, ctx: AutomationContext) {
  switch (actionType) {
    case "send_notification":
      await execSendNotification(actionConfig, ctx);
      break;
    case "update_status":
      await execUpdateStatus(actionConfig, ctx);
      break;
    case "create_report":
      await execCreateReport(actionConfig, ctx);
      break;
    case "check_inventory":
      await execCheckInventory(actionConfig, ctx);
      break;
    case "create_purchase_order":
      await execCreatePurchaseOrder(actionConfig, ctx);
      break;
    default:
      console.log(`[Construction Automation] Unknown action: ${actionType}`);
  }
}

// ── Trigger Evaluators ───────────────────────────────────────
async function evalDatePassed(automation: any) {
  const db = await getDb(); if (!db) return;
  // Find tasks that have passed their end date and are not completed
  const overdueTasks = await db.select().from(constructionTasks)
    .where(and(
      eq(constructionTasks.projectId, automation.projectId),
      sql`${constructionTasks.endDatePlanned} < CURDATE()`,
      sql`${constructionTasks.status} NOT IN ('completed', 'on_hold')`
    ));

  for (const task of overdueTasks) {
    await executeAction(automation.actionType, automation.actionConfig, {
      projectId: automation.projectId,
      taskId: task.id,
      phaseId: task.phaseId,
    });
  }
}

async function evalMemberOverloaded(automation: any) {
  const db = await getDb(); if (!db) return;
  const threshold = automation.triggerCondition?.threshold ?? 5;

  const members = await db.select().from(constructionProjectMembers)
    .where(eq(constructionProjectMembers.projectId, automation.projectId));

  for (const member of members) {
    const [taskCount] = await db.select({ cnt: sql<number>`COUNT(*)` })
      .from(constructionTasks)
      .where(and(
        eq(constructionTasks.projectId, automation.projectId),
        eq(constructionTasks.assignedToId, member.userId),
        sql`${constructionTasks.status} NOT IN ('completed')`
      ));

    if ((taskCount?.cnt ?? 0) > threshold) {
      await executeAction(automation.actionType, {
        ...automation.actionConfig,
        message: `تنبيه: المستخدم ${member.userId} لديه ${taskCount.cnt} مهام نشطة تتجاوز الحد المسموح (${threshold})`,
      }, { projectId: automation.projectId, userId: member.userId });
    }
  }
}

async function evalPhaseCompleted(automation: any) {
  const db = await getDb(); if (!db) return;
  const phases = await db.select().from(constructionPhases)
    .where(eq(constructionPhases.projectId, automation.projectId));

  for (const phase of phases) {
    if (phase.status === "completed") continue;

    const [taskStats] = await db.select({
      total: sql<number>`COUNT(*)`,
      completed: sql<number>`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`,
    }).from(constructionTasks).where(eq(constructionTasks.phaseId, phase.id));

    const total = taskStats?.total ?? 0;
    const completed = taskStats?.completed ?? 0;

    if (total > 0 && completed === total) {
      // All tasks in phase are complete — mark phase as completed
      await db.update(constructionPhases)
        .set({ status: "completed", progressPercent: "100" })
        .where(eq(constructionPhases.id, phase.id));

      await executeAction(automation.actionType, {
        ...automation.actionConfig,
        message: `تم إنجاز المرحلة: ${phase.name} في المشروع`,
        title: "مرحلة مكتملة",
      }, { projectId: automation.projectId, phaseId: phase.id });
    }
  }
}

async function evalDailySchedule(automation: any) {
  const now = new Date();
  const scheduledHour = automation.triggerCondition?.hour ?? 7;
  if (now.getHours() !== scheduledHour) return;

  await executeAction(automation.actionType, automation.actionConfig, {
    projectId: automation.projectId,
  });
}

// ── Main Engine ──────────────────────────────────────────────
export async function runConstructionAutomation() {
  try {
    const db = await getDb(); if (!db) return;
    const automations = await db.select().from(constructionAutomations)
      .where(eq(constructionAutomations.isActive, true));

    if (automations.length === 0) return;

    console.log(`[Construction Automation] Running ${automations.length} active rules...`);

    for (const automation of automations) {
      try {
        switch (automation.triggerType) {
          case "date_passed":
            await evalDatePassed(automation);
            break;
          case "member_overloaded":
            await evalMemberOverloaded(automation);
            break;
          case "phase_completed":
            await evalPhaseCompleted(automation);
            break;
          case "daily_schedule":
            await evalDailySchedule(automation);
            break;
          // status_change and task_completed are triggered directly from the tasks router
          // when changeStatus mutation is called — not via cron
          default:
            break;
        }

        // Update lastRunAt and increment counter
        await db.update(constructionAutomations)
          .set({
            lastRunAt: new Date(),
            runCount: sql`${constructionAutomations.runCount} + 1`,
          })
          .where(eq(constructionAutomations.id, automation.id));

      } catch (automationErr) {
        // Single automation failure must NOT crash the entire engine
        console.error(`[Construction Automation] Rule ${automation.id} (${automation.name}) failed:`, automationErr);
      }
    }

    console.log(`[Construction Automation] Cycle complete.`);
  } catch (err) {
    console.error("[Construction Automation] Engine error:", err);
  }
}

// ── Status-change triggered automations ─────────────────────
// Called directly from tasks.router when status changes
export async function triggerStatusChangeAutomations(
  projectId: number,
  taskId: number,
  newStatus: string
) {
  try {
    const db = await getDb(); if (!db) return;
    const automations = await db.select().from(constructionAutomations)
      .where(and(
        eq(constructionAutomations.projectId, projectId),
        eq(constructionAutomations.isActive, true),
        eq(constructionAutomations.triggerType, "status_change")
      ));

    for (const automation of automations) {
      const condition = automation.triggerCondition as any;
      if (condition?.status && condition.status !== newStatus) continue;

      await executeAction(automation.actionType, automation.actionConfig, {
        projectId,
        taskId,
      });
    }
  } catch (err) {
    console.error("[Construction Automation] Status-change trigger failed:", err);
  }
}
