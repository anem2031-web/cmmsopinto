import { pmv2ExecutionActor, pmv2ExecutionActorCondition, pmv2ExecutionTeamCondition } from "../security/execution-access";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  pmv2ItemActions,
  pmv2TaskItems,
  pmv2Tasks,
  pmv2VisitMembers,
  pmv2Visits,
} from "../../../drizzle/schema";
import { getDb } from "../../_core/db/client";
import { writePmv2AuditWithDb } from "../audit/service";
import { pmv2TeamIssueHandoffService } from "../materials/team-issue-handoff-service";
import { Pmv2TechnicianAccessError } from "./read-service";
import { queuePmv2Translation } from "../translation-queue";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");
  return db;
}

export class Pmv2TechnicianTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Pmv2TechnicianTransitionError";
  }
}

export class Pmv2TechnicianLeaderRequiredError extends Error {
  constructor(message = "فقط قائد الزيارة يمكنه إنهاء الزيارة") {
    super(message);
    this.name = "Pmv2TechnicianLeaderRequiredError";
  }
}

type StartItemInput = {
  taskId: number;
  taskItemId: number;
};

type ResumeItemInput = {
  taskId: number;
  taskItemId: number;
};

type EndVisitInput = {
  taskId: number;
};

type BasicResult = "ok" | "fixed";
type DependencyResult = "needs_material" | "needs_ticket";

type SubmitBasicResultInput = {
  taskId: number;
  taskItemId: number;
  result: BasicResult;
  note?: string;
  materialUsages?: Array<{ catalogItemId: number; usedQuantity: number; physicalUsages?:Array<{deliveryDocumentId:number;usedQuantity:number}> }>;
};

type SubmitDependencyResultInput = {
  taskId: number;
  taskItemId: number;
  result: DependencyResult;
  note?: string;
};

type ItemStatus =
  | "pending"
  | "in_progress"
  | "waiting_material"
  | "waiting_ticket"
  | "ready_to_complete"
  | "completed";

type TaskStatus = ItemStatus | "cancelled";

function isTaskOpenForStart(status: TaskStatus) {
  return status !== "completed" && status !== "cancelled";
}

function isTaskOpenForResult(status: TaskStatus) {
  return status !== "pending" && status !== "completed" && status !== "cancelled";
}

/**
 * Cached Task status projection from Task Items.
 * Dependency priority is intentionally fixed: material before ticket.
 * Item-level states remain authoritative and visible independently.
 */
function deriveTaskStatus(itemStatuses: ItemStatus[]): Exclude<TaskStatus, "cancelled"> {
  if (itemStatuses.length > 0 && itemStatuses.every(status => status === "completed")) return "completed";
  if (itemStatuses.includes("waiting_material")) return "waiting_material";
  if (itemStatuses.includes("waiting_ticket")) return "waiting_ticket";
  if (itemStatuses.includes("in_progress")) return "in_progress";
  if (itemStatuses.includes("ready_to_complete")) return "ready_to_complete";
  if (itemStatuses.includes("completed")) return "in_progress";
  return "pending";
}

/**
 * Phase 3 technician write boundary.
 * Step 3.2: pending -> in_progress and Visit start/reuse.
 * Step 3.3A: in_progress -> completed for ok/fixed.
 * Step 3.3B: in_progress -> waiting_material/waiting_ticket for dependency results only.
 * Step 3.4: the active Visit Leader may end the open Visit without forcing Task/Item closure.
 * External Material/Ticket workflow creation remains outside this slice.
 */
export class Pmv2TechnicianExecutionService {
  async startItem(
    userId: number,
    input: StartItemInput,
    auditContext?: { ipAddress?: string; userAgent?: string },
  ) {
    const db = await requireDb();

    return db.transaction(async (tx: any) => {
      // Serialize all visit creation/item-start writes for the same task.
      // This enforces one open Visit per Task at the PM V2 write boundary.
      await tx.execute(sql`SELECT id FROM pmv2_tasks WHERE id = ${input.taskId} FOR UPDATE`);

      const accessible = await tx
        .select({
          taskId: pmv2Tasks.id,
          taskStatus: pmv2Tasks.status,
          taskTeamId: pmv2Tasks.teamId,
          taskItemId: pmv2TaskItems.id,
          itemStatus: pmv2TaskItems.status,
        })
        .from(pmv2TaskItems)
        .innerJoin(pmv2Tasks, eq(pmv2Tasks.id, pmv2TaskItems.taskId))
        .innerJoin(
          pmv2ExecutionActor, pmv2ExecutionActorCondition(userId),
        )
        .where(
          and(
            pmv2ExecutionTeamCondition(userId, pmv2Tasks.teamId),
            eq(pmv2Tasks.id, input.taskId),
            eq(pmv2TaskItems.id, input.taskItemId),
          ),
        )
        .limit(1);

      const row = accessible[0];
      if (!row) throw new Pmv2TechnicianAccessError();

      if (row.taskStatus === "cancelled") {
        throw new Pmv2TechnicianTransitionError("لا يمكن بدء بند في مهمة ملغاة");
      }
      if (!isTaskOpenForStart(row.taskStatus as TaskStatus)) {
        throw new Pmv2TechnicianTransitionError("حالة المهمة الحالية لا تسمح ببدء بند جديد");
      }
      if (row.itemStatus !== "pending") {
        throw new Pmv2TechnicianTransitionError("يمكن بدء التنفيذ فقط للبند الذي حالته بانتظار البدء");
      }

      const openVisits = await tx
        .select({ id: pmv2Visits.id })
        .from(pmv2Visits)
        .where(and(eq(pmv2Visits.taskId, row.taskId), isNull(pmv2Visits.endedAt)))
        .orderBy(desc(pmv2Visits.startedAt), desc(pmv2Visits.id))
        .limit(2);

      if (openVisits.length > 1) {
        throw new Pmv2TechnicianTransitionError("توجد أكثر من زيارة مفتوحة للمهمة؛ يلزم مراجعة الحالة قبل المتابعة");
      }

      let visitId = openVisits[0]?.id ?? 0;
      let visitCreated = false;
      let joinedVisit = false;
      let isLeader = false;

      if (!visitId) {
        const visitResult = await tx.insert(pmv2Visits).values({ taskId: row.taskId });
        visitId = Number(visitResult[0]?.insertId ?? 0);
        if (!visitId) throw new Error("تعذر تحديد رقم زيارة PM V2 الجديدة");

        await tx.insert(pmv2VisitMembers).values({
          visitId,
          userId,
          isLeader: 1,
        });
        visitCreated = true;
        joinedVisit = true;
        isLeader = true;
      } else {
        const existingMember = await tx
          .select({ id: pmv2VisitMembers.id, isLeader: pmv2VisitMembers.isLeader })
          .from(pmv2VisitMembers)
          .where(
            and(
              eq(pmv2VisitMembers.visitId, visitId),
              eq(pmv2VisitMembers.userId, userId),
            ),
          )
          .limit(1);

        if (existingMember[0]) {
          isLeader = Number(existingMember[0].isLeader) === 1;
        } else {
          const existingLeader = await tx
            .select({ id: pmv2VisitMembers.id })
            .from(pmv2VisitMembers)
            .where(
              and(
                eq(pmv2VisitMembers.visitId, visitId),
                eq(pmv2VisitMembers.isLeader, 1),
              ),
            )
            .limit(1);

          isLeader = !existingLeader[0];
          await tx.insert(pmv2VisitMembers).values({
            visitId,
            userId,
            isLeader: isLeader ? 1 : 0,
          });
          joinedVisit = true;
        }
      }

      await tx
        .update(pmv2TaskItems)
        .set({ status: "in_progress" })
        .where(
          and(
            eq(pmv2TaskItems.id, row.taskItemId),
            eq(pmv2TaskItems.taskId, row.taskId),
            eq(pmv2TaskItems.status, "pending"),
          ),
        );

      const nextTaskStatus = row.taskStatus === "pending" ? "in_progress" : row.taskStatus;
      if (row.taskStatus === "pending") {
        await tx
          .update(pmv2Tasks)
          .set({ status: nextTaskStatus })
          .where(and(eq(pmv2Tasks.id, row.taskId), eq(pmv2Tasks.status, "pending")));
      }

      await tx.insert(pmv2ItemActions).values({
        taskItemId: row.taskItemId,
        visitId,
        action: "start_execution",
        performedById: userId,
      });

      await writePmv2AuditWithDb(tx, {
        actorUserId: userId,
        action: "item_start_execution",
        entity: "task_item",
        entityId: row.taskItemId,
        oldValues: {
          taskId: row.taskId,
          taskStatus: row.taskStatus,
          itemStatus: row.itemStatus,
        },
        newValues: {
          taskId: row.taskId,
          taskStatus: nextTaskStatus,
          itemStatus: "in_progress",
          visitId,
          visitCreated,
          joinedVisit,
          isLeader,
        },
        ipAddress: auditContext?.ipAddress,
        userAgent: auditContext?.userAgent,
      });

      return {
        taskId: row.taskId,
        taskItemId: row.taskItemId,
        taskStatus: nextTaskStatus,
        itemStatus: "in_progress" as const,
        visitId,
        visitCreated,
        joinedVisit,
        isLeader,
      };
    });
  }

  /**
   * Patch 138: resume a material-blocked item after the dependency is cleared.
   * This opens/reuses a Visit for the SAME Task, records a dedicated resume action,
   * and moves ready_to_complete back to in_progress without creating a new Task.
   */
  async resumeItem(
    userId: number,
    input: ResumeItemInput,
    auditContext?: { ipAddress?: string; userAgent?: string },
  ) {
    const db = await requireDb();

    return db.transaction(async (tx: any) => {
      await tx.execute(sql`SELECT id FROM pmv2_tasks WHERE id = ${input.taskId} FOR UPDATE`);

      const accessible = await tx
        .select({
          taskId: pmv2Tasks.id,
          taskStatus: pmv2Tasks.status,
          taskItemId: pmv2TaskItems.id,
          itemStatus: pmv2TaskItems.status,
          itemResult: pmv2TaskItems.result,
        })
        .from(pmv2TaskItems)
        .innerJoin(pmv2Tasks, eq(pmv2Tasks.id, pmv2TaskItems.taskId))
        .innerJoin(
          pmv2ExecutionActor, pmv2ExecutionActorCondition(userId),
        )
        .where(and(pmv2ExecutionTeamCondition(userId, pmv2Tasks.teamId), eq(pmv2Tasks.id, input.taskId), eq(pmv2TaskItems.id, input.taskItemId)))
        .limit(1);

      const row = accessible[0];
      if (!row) throw new Pmv2TechnicianAccessError();
      if (row.taskStatus === "cancelled" || row.taskStatus === "completed") {
        throw new Pmv2TechnicianTransitionError("حالة المهمة الحالية لا تسمح باستكمال العمل");
      }
      if (row.itemStatus !== "ready_to_complete" || row.itemResult !== "needs_material") {
        throw new Pmv2TechnicianTransitionError("استكمال العمل متاح فقط للبند الجاهز للإكمال بعد استلام المواد");
      }

      const openVisits = await tx
        .select({ id: pmv2Visits.id })
        .from(pmv2Visits)
        .where(and(eq(pmv2Visits.taskId, row.taskId), isNull(pmv2Visits.endedAt)))
        .orderBy(desc(pmv2Visits.startedAt), desc(pmv2Visits.id))
        .limit(2);

      if (openVisits.length > 1) {
        throw new Pmv2TechnicianTransitionError("توجد أكثر من زيارة مفتوحة للمهمة؛ يلزم مراجعة الحالة قبل المتابعة");
      }

      let visitId = openVisits[0]?.id ?? 0;
      let visitCreated = false;
      let joinedVisit = false;
      let isLeader = false;

      if (!visitId) {
        const visitResult = await tx.insert(pmv2Visits).values({ taskId: row.taskId });
        visitId = Number(visitResult[0]?.insertId ?? 0);
        if (!visitId) throw new Error("تعذر تحديد رقم زيارة استكمال PM V2");
        await tx.insert(pmv2VisitMembers).values({ visitId, userId, isLeader: 1 });
        visitCreated = true;
        joinedVisit = true;
        isLeader = true;
      } else {
        const existingMember = await tx
          .select({ id: pmv2VisitMembers.id, isLeader: pmv2VisitMembers.isLeader })
          .from(pmv2VisitMembers)
          .where(and(eq(pmv2VisitMembers.visitId, visitId), eq(pmv2VisitMembers.userId, userId)))
          .limit(1);

        if (existingMember[0]) {
          isLeader = Number(existingMember[0].isLeader) === 1;
        } else {
          const existingLeader = await tx
            .select({ id: pmv2VisitMembers.id })
            .from(pmv2VisitMembers)
            .where(and(eq(pmv2VisitMembers.visitId, visitId), eq(pmv2VisitMembers.isLeader, 1)))
            .limit(1);
          isLeader = !existingLeader[0];
          await tx.insert(pmv2VisitMembers).values({ visitId, userId, isLeader: isLeader ? 1 : 0 });
          joinedVisit = true;
        }
      }

      await tx
        .update(pmv2TaskItems)
        .set({ status: "in_progress" })
        .where(and(
          eq(pmv2TaskItems.id, row.taskItemId),
          eq(pmv2TaskItems.taskId, row.taskId),
          eq(pmv2TaskItems.status, "ready_to_complete"),
          eq(pmv2TaskItems.result, "needs_material"),
        ));

      await tx.insert(pmv2ItemActions).values({
        taskItemId: row.taskItemId,
        visitId,
        action: "resume_execution",
        performedById: userId,
      });

      const taskItems = await tx
        .select({ status: pmv2TaskItems.status })
        .from(pmv2TaskItems)
        .where(eq(pmv2TaskItems.taskId, row.taskId));
      const taskStatus = deriveTaskStatus(taskItems.map((item: { status: ItemStatus }) => item.status));
      await tx.update(pmv2Tasks).set({ status: taskStatus }).where(eq(pmv2Tasks.id, row.taskId));

      await writePmv2AuditWithDb(tx, {
        actorUserId: userId,
        action: "item_resume_execution",
        entity: "task_item",
        entityId: row.taskItemId,
        oldValues: {
          taskId: row.taskId,
          taskStatus: row.taskStatus,
          itemStatus: row.itemStatus,
          itemResult: row.itemResult,
        },
        newValues: {
          taskId: row.taskId,
          taskStatus,
          itemStatus: "in_progress",
          itemResult: row.itemResult,
          visitId,
          visitCreated,
          joinedVisit,
          isLeader,
          continuationOfSameTask: true,
        },
        ipAddress: auditContext?.ipAddress,
        userAgent: auditContext?.userAgent,
      });

      return {
        taskId: row.taskId,
        taskItemId: row.taskItemId,
        taskStatus,
        itemStatus: "in_progress" as const,
        itemResult: row.itemResult,
        visitId,
        visitCreated,
        joinedVisit,
        isLeader,
        continuationOfSameTask: true as const,
      };
    });
  }

  async submitBasicResult(
    userId: number,
    input: SubmitBasicResultInput,
    auditContext?: { ipAddress?: string; userAgent?: string },
  ) {
    const db = await requireDb();
    const normalizedNote = input.note?.trim() || null;

    return db.transaction(async (tx: any) => {
      // Serialize result writes for the same Task so the cached Task projection
      // cannot race when two technicians complete different items together.
      await tx.execute(sql`SELECT id FROM pmv2_tasks WHERE id = ${input.taskId} FOR UPDATE`);

      const accessible = await tx
        .select({
          taskId: pmv2Tasks.id,
          taskStatus: pmv2Tasks.status,
          taskItemId: pmv2TaskItems.id,
          itemStatus: pmv2TaskItems.status,
          itemResult: pmv2TaskItems.result,
        })
        .from(pmv2TaskItems)
        .innerJoin(pmv2Tasks, eq(pmv2Tasks.id, pmv2TaskItems.taskId))
        .innerJoin(
          pmv2ExecutionActor, pmv2ExecutionActorCondition(userId),
        )
        .where(
          and(
            pmv2ExecutionTeamCondition(userId, pmv2Tasks.teamId),
            eq(pmv2Tasks.id, input.taskId),
            eq(pmv2TaskItems.id, input.taskItemId),
          ),
        )
        .limit(1);

      const row = accessible[0];
      if (!row) throw new Pmv2TechnicianAccessError();

      if (!isTaskOpenForResult(row.taskStatus as TaskStatus)) {
        throw new Pmv2TechnicianTransitionError("حالة المهمة الحالية لا تسمح بتسجيل نتيجة تنفيذ");
      }
      if (row.itemStatus !== "in_progress" && row.itemStatus !== "ready_to_complete") {
        throw new Pmv2TechnicianTransitionError("يمكن تسجيل النتيجة فقط لبند قيد التنفيذ أو جاهز للإكمال");
      }
      if (input.result !== "ok" && input.result !== "fixed") {
        throw new Pmv2TechnicianTransitionError("هذه الخطوة تدعم فقط نتيجتي سليم وتم الإصلاح");
      }
      const resumedMaterialCompletion = row.itemStatus === "in_progress" && row.itemResult === "needs_material";
      // Preserve the original ready_to_complete guard and extend the same fixed-only
      // rule to PATCH138 continuation after the item moves back to in_progress.
      if (row.itemStatus === "ready_to_complete" && input.result !== "fixed") {
        throw new Pmv2TechnicianTransitionError("البند العائد من انتظار المواد يُستكمل بنتيجة تم الإصلاح مع تسجيل الكمية المستخدمة");
      }
      if (resumedMaterialCompletion && input.result !== "fixed") {
        throw new Pmv2TechnicianTransitionError("استكمال العمل بعد وصول المواد يُغلق بنتيجة تم الإصلاح مع تسجيل الكمية المستخدمة");
      }

      const openVisits = await tx
        .select({ id: pmv2Visits.id })
        .from(pmv2Visits)
        .where(and(eq(pmv2Visits.taskId, row.taskId), isNull(pmv2Visits.endedAt)))
        .orderBy(desc(pmv2Visits.startedAt), desc(pmv2Visits.id))
        .limit(2);

      if (openVisits.length !== 1) {
        throw new Pmv2TechnicianTransitionError(
          openVisits.length === 0
            ? "لا توجد زيارة مفتوحة للمهمة؛ ابدأ التنفيذ أولًا"
            : "توجد أكثر من زيارة مفتوحة للمهمة؛ يلزم مراجعة الحالة قبل تسجيل النتيجة",
        );
      }

      const visitId = openVisits[0].id;
      let joinedVisit = false;
      let isLeader = false;

      const existingMember = await tx
        .select({ id: pmv2VisitMembers.id, isLeader: pmv2VisitMembers.isLeader })
        .from(pmv2VisitMembers)
        .where(
          and(
            eq(pmv2VisitMembers.visitId, visitId),
            eq(pmv2VisitMembers.userId, userId),
          ),
        )
        .limit(1);

      if (existingMember[0]) {
        isLeader = Number(existingMember[0].isLeader) === 1;
      } else {
        const existingLeader = await tx
          .select({ id: pmv2VisitMembers.id })
          .from(pmv2VisitMembers)
          .where(
            and(
              eq(pmv2VisitMembers.visitId, visitId),
              eq(pmv2VisitMembers.isLeader, 1),
            ),
          )
          .limit(1);

        isLeader = !existingLeader[0];
        await tx.insert(pmv2VisitMembers).values({
          visitId,
          userId,
          isLeader: isLeader ? 1 : 0,
        });
        joinedVisit = true;
      }

      let materialSettlement = { pendingReturnQuantity: 0,hasPhysicalReturns:false, declarations: [] as any[] };
      if (row.itemStatus === "ready_to_complete" || resumedMaterialCompletion) {
        materialSettlement = await pmv2TeamIssueHandoffService.declareConsumptionWithDb(
          tx,
          userId,
          row.taskId,
          row.taskItemId,
          visitId,
          input.materialUsages || [],
        );
      }

      await tx
        .update(pmv2TaskItems)
        .set({
          status: "completed",
          result: input.result,
        })
        .where(
          and(
            eq(pmv2TaskItems.id, row.taskItemId),
            eq(pmv2TaskItems.taskId, row.taskId),
            eq(pmv2TaskItems.status, row.itemStatus),
          ),
        );

      const actionInsert = await tx.insert(pmv2ItemActions).values({
        taskItemId: row.taskItemId,
        visitId,
        action: "submit_result",
        result: input.result,
        note: normalizedNote,
        performedById: userId,
      });
      const actionId = Number(actionInsert[0]?.insertId || 0);
      if (normalizedNote && actionId) {
        await queuePmv2Translation("PMV2_ITEM_ACTION", actionId, [{ fieldName: "note", text: normalizedNote }], userId);
      }

      const taskItems = await tx
        .select({ status: pmv2TaskItems.status })
        .from(pmv2TaskItems)
        .where(eq(pmv2TaskItems.taskId, row.taskId));

      const taskStatus = deriveTaskStatus(taskItems.map((item: { status: ItemStatus }) => item.status));

      await tx
        .update(pmv2Tasks)
        .set({ status: taskStatus })
        .where(eq(pmv2Tasks.id, row.taskId));

      await writePmv2AuditWithDb(tx, {
        actorUserId: userId,
        action: "item_result_submitted",
        entity: "task_item",
        entityId: row.taskItemId,
        oldValues: {
          taskId: row.taskId,
          taskStatus: row.taskStatus,
          itemStatus: row.itemStatus,
          itemResult: row.itemResult,
        },
        newValues: {
          taskId: row.taskId,
          taskStatus,
          itemStatus: "completed",
          itemResult: input.result,
          note: normalizedNote,
          materialSettlement,
          visitId,
          joinedVisit,
          isLeader,
        },
        ipAddress: auditContext?.ipAddress,
        userAgent: auditContext?.userAgent,
      });

      return {
        taskId: row.taskId,
        taskItemId: row.taskItemId,
        taskStatus,
        itemStatus: "completed" as const,
        result: input.result,
        note: normalizedNote,
        visitId,
        joinedVisit,
        isLeader,
        pendingReturnQuantity: materialSettlement.pendingReturnQuantity,
        hasPhysicalReturns:materialSettlement.hasPhysicalReturns,
        materialDeclarations: materialSettlement.declarations,
        taskCompleted: taskStatus === "completed",
      };
    });
  }

  async submitDependencyResult(
    userId: number,
    input: SubmitDependencyResultInput,
    auditContext?: { ipAddress?: string; userAgent?: string },
  ) {
    const db = await requireDb();
    const normalizedNote = input.note?.trim() || null;

    return db.transaction(async (tx: any) => {
      // Serialize the dependency result and Task cached-state projection together.
      await tx.execute(sql`SELECT id FROM pmv2_tasks WHERE id = ${input.taskId} FOR UPDATE`);

      const accessible = await tx
        .select({
          taskId: pmv2Tasks.id,
          taskStatus: pmv2Tasks.status,
          taskItemId: pmv2TaskItems.id,
          itemStatus: pmv2TaskItems.status,
          itemResult: pmv2TaskItems.result,
        })
        .from(pmv2TaskItems)
        .innerJoin(pmv2Tasks, eq(pmv2Tasks.id, pmv2TaskItems.taskId))
        .innerJoin(
          pmv2ExecutionActor, pmv2ExecutionActorCondition(userId),
        )
        .where(
          and(
            pmv2ExecutionTeamCondition(userId, pmv2Tasks.teamId),
            eq(pmv2Tasks.id, input.taskId),
            eq(pmv2TaskItems.id, input.taskItemId),
          ),
        )
        .limit(1);

      const row = accessible[0];
      if (!row) throw new Pmv2TechnicianAccessError();

      if (!isTaskOpenForResult(row.taskStatus as TaskStatus)) {
        throw new Pmv2TechnicianTransitionError("حالة المهمة الحالية لا تسمح بتسجيل نتيجة تنفيذ");
      }
      if (row.itemStatus !== "in_progress") {
        throw new Pmv2TechnicianTransitionError("يمكن تسجيل تحتاج مواد أو تحتاج بلاغ فقط لبند قيد التنفيذ");
      }
      if (input.result !== "needs_material" && input.result !== "needs_ticket") {
        throw new Pmv2TechnicianTransitionError("هذه الخطوة تدعم فقط نتيجتي تحتاج مواد وتحتاج بلاغ");
      }

      const openVisits = await tx
        .select({ id: pmv2Visits.id })
        .from(pmv2Visits)
        .where(and(eq(pmv2Visits.taskId, row.taskId), isNull(pmv2Visits.endedAt)))
        .orderBy(desc(pmv2Visits.startedAt), desc(pmv2Visits.id))
        .limit(2);

      if (openVisits.length !== 1) {
        throw new Pmv2TechnicianTransitionError(
          openVisits.length === 0
            ? "لا توجد زيارة مفتوحة للمهمة؛ ابدأ التنفيذ أولًا"
            : "توجد أكثر من زيارة مفتوحة للمهمة؛ يلزم مراجعة الحالة قبل تسجيل النتيجة",
        );
      }

      const visitId = openVisits[0].id;
      let joinedVisit = false;
      let isLeader = false;

      const existingMember = await tx
        .select({ id: pmv2VisitMembers.id, isLeader: pmv2VisitMembers.isLeader })
        .from(pmv2VisitMembers)
        .where(
          and(
            eq(pmv2VisitMembers.visitId, visitId),
            eq(pmv2VisitMembers.userId, userId),
          ),
        )
        .limit(1);

      if (existingMember[0]) {
        isLeader = Number(existingMember[0].isLeader) === 1;
      } else {
        const existingLeader = await tx
          .select({ id: pmv2VisitMembers.id })
          .from(pmv2VisitMembers)
          .where(
            and(
              eq(pmv2VisitMembers.visitId, visitId),
              eq(pmv2VisitMembers.isLeader, 1),
            ),
          )
          .limit(1);

        isLeader = !existingLeader[0];
        await tx.insert(pmv2VisitMembers).values({
          visitId,
          userId,
          isLeader: isLeader ? 1 : 0,
        });
        joinedVisit = true;
      }

      const itemStatus: ItemStatus = input.result === "needs_material"
        ? "waiting_material"
        : "waiting_ticket";

      await tx
        .update(pmv2TaskItems)
        .set({
          status: itemStatus,
          result: input.result,
        })
        .where(
          and(
            eq(pmv2TaskItems.id, row.taskItemId),
            eq(pmv2TaskItems.taskId, row.taskId),
            eq(pmv2TaskItems.status, "in_progress"),
          ),
        );

      const actionInsert = await tx.insert(pmv2ItemActions).values({
        taskItemId: row.taskItemId,
        visitId,
        action: "submit_result",
        result: input.result,
        note: normalizedNote,
        performedById: userId,
      });
      const actionId = Number(actionInsert[0]?.insertId || 0);
      if (normalizedNote && actionId) {
        await queuePmv2Translation("PMV2_ITEM_ACTION", actionId, [{ fieldName: "note", text: normalizedNote }], userId);
      }

      const taskItems = await tx
        .select({ status: pmv2TaskItems.status })
        .from(pmv2TaskItems)
        .where(eq(pmv2TaskItems.taskId, row.taskId));

      const taskStatus = deriveTaskStatus(taskItems.map((item: { status: ItemStatus }) => item.status));

      await tx
        .update(pmv2Tasks)
        .set({ status: taskStatus })
        .where(eq(pmv2Tasks.id, row.taskId));

      await writePmv2AuditWithDb(tx, {
        actorUserId: userId,
        action: "item_result_submitted",
        entity: "task_item",
        entityId: row.taskItemId,
        oldValues: {
          taskId: row.taskId,
          taskStatus: row.taskStatus,
          itemStatus: row.itemStatus,
          itemResult: row.itemResult,
        },
        newValues: {
          taskId: row.taskId,
          taskStatus,
          itemStatus,
          itemResult: input.result,
          note: normalizedNote,
          visitId,
          joinedVisit,
          isLeader,
          externalIntegrationCreated: false,
        },
        ipAddress: auditContext?.ipAddress,
        userAgent: auditContext?.userAgent,
      });

      return {
        taskId: row.taskId,
        taskItemId: row.taskItemId,
        taskStatus,
        itemStatus,
        result: input.result,
        note: normalizedNote,
        visitId,
        joinedVisit,
        isLeader,
        externalIntegrationCreated: false as const,
      };
    });
  }
  async endVisit(
    userId: number,
    input: EndVisitInput,
    auditContext?: { ipAddress?: string; userAgent?: string },
  ) {
    const db = await requireDb();

    return db.transaction(async (tx: any) => {
      // Serialize Visit end against item starts/results for the same Task.
      await tx.execute(sql`SELECT id FROM pmv2_tasks WHERE id = ${input.taskId} FOR UPDATE`);

      const accessible = await tx
        .select({
          taskId: pmv2Tasks.id,
          taskStatus: pmv2Tasks.status,
        })
        .from(pmv2Tasks)
        .innerJoin(
          pmv2ExecutionActor, pmv2ExecutionActorCondition(userId),
        )
        .where(and(pmv2ExecutionTeamCondition(userId, pmv2Tasks.teamId), eq(pmv2Tasks.id, input.taskId)))
        .limit(1);

      const row = accessible[0];
      if (!row) throw new Pmv2TechnicianAccessError();

      const openVisits = await tx
        .select({ id: pmv2Visits.id, startedAt: pmv2Visits.startedAt })
        .from(pmv2Visits)
        .where(and(eq(pmv2Visits.taskId, row.taskId), isNull(pmv2Visits.endedAt)))
        .orderBy(desc(pmv2Visits.startedAt), desc(pmv2Visits.id))
        .limit(2);

      if (openVisits.length !== 1) {
        throw new Pmv2TechnicianTransitionError(
          openVisits.length === 0
            ? "لا توجد زيارة مفتوحة للمهمة"
            : "توجد أكثر من زيارة مفتوحة للمهمة؛ يلزم مراجعة الحالة قبل إنهاء الزيارة",
        );
      }

      const visit = openVisits[0];
      const leader = await tx
        .select({ id: pmv2VisitMembers.id })
        .from(pmv2VisitMembers)
        .where(
          and(
            eq(pmv2VisitMembers.visitId, visit.id),
            eq(pmv2VisitMembers.userId, userId),
            eq(pmv2VisitMembers.isLeader, 1),
          ),
        )
        .limit(1);

      if (!leader[0]) throw new Pmv2TechnicianLeaderRequiredError();

      const activeItem = await tx
        .select({ id: pmv2TaskItems.id })
        .from(pmv2TaskItems)
        .where(
          and(
            eq(pmv2TaskItems.taskId, row.taskId),
            eq(pmv2TaskItems.status, "in_progress"),
          ),
        )
        .limit(1);

      if (activeItem[0]) {
        throw new Pmv2TechnicianTransitionError(
          "لا يمكن إنهاء الزيارة بينما يوجد بند قيد التنفيذ؛ سجّل نتيجة البند أولًا",
        );
      }

      await tx
        .update(pmv2Visits)
        .set({ endedAt: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(pmv2Visits.id, visit.id), isNull(pmv2Visits.endedAt)));

      const endedVisit = await tx
        .select({ endedAt: pmv2Visits.endedAt })
        .from(pmv2Visits)
        .where(eq(pmv2Visits.id, visit.id))
        .limit(1);

      const endedAt = endedVisit[0]?.endedAt ?? null;
      if (!endedAt) throw new Error("تعذر تثبيت وقت انتهاء زيارة PM V2");

      await writePmv2AuditWithDb(tx, {
        actorUserId: userId,
        action: "visit_ended",
        entity: "visit",
        entityId: visit.id,
        oldValues: {
          taskId: row.taskId,
          taskStatus: row.taskStatus,
          startedAt: visit.startedAt,
          endedAt: null,
        },
        newValues: {
          taskId: row.taskId,
          taskStatus: row.taskStatus,
          startedAt: visit.startedAt,
          endedAt,
          endedByLeaderId: userId,
        },
        ipAddress: auditContext?.ipAddress,
        userAgent: auditContext?.userAgent,
      });

      return {
        taskId: row.taskId,
        taskStatus: row.taskStatus,
        visitId: visit.id,
        endedAt,
      };
    });
  }

}

export const pmv2TechnicianExecutionService = new Pmv2TechnicianExecutionService();
