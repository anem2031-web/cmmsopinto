import { sql, type SQL } from "drizzle-orm";
import { ticketExecutionSession } from "../../../shared/maintenance-team-tickets/execution-session";
import { TeamTicketError } from "../../../shared/maintenance-team-tickets/model";
import { materialSupplyRemaining } from "../../../shared/maintenance-team-tickets/material-routing";
import { ticketTeamQueueScope } from "./assignment-read-scope";
import { loadTeamReportMedia } from "../../maintenance-team-tickets/report-media";
import type {
  Snapshot,
  MaterialNeed,
} from "../../../shared/maintenance-team-tickets/model";
import type { TeamManagementActor } from "../../../shared/maintenance-team-tickets/team-management";
import type {
  TeamAssignmentRepository,
  TeamAssignmentTransaction,
  TeamAssignmentInput,
  AssignmentContext,
  AssignmentTeam,
  AssignedTeamTicket,
} from "../../../shared/maintenance-team-tickets/assignment";
import type { TeamDatabase, TeamDatabaseTransaction } from "./repository";

// Imported only on an authorized live request. Tests inject both dependencies.
export interface TicketPromotionPort {
  getTicketById(id: number, tx: any): Promise<any>;
  getTicketTaskById(id: number, tx: any): Promise<any>;
  getTicketDepartmentById(id: number, tx: any): Promise<any>;
  lockTicketForSubTicketSequence(id: number, tx: any): Promise<void>;
  lockTicketDepartmentForTaskSequence(id: number, tx: any): Promise<void>;
  lockTicketTaskForPromotion(id: number, tx: any): Promise<void>;
  allocateNextSubTicketSequence(id: number, tx: any): Promise<number>;
  createTicket(data: any, tx: any): Promise<any>;
  createTicketItem(data: any, tx: any): Promise<any>;
  updateTicketTask(id: number, data: any, tx: any): Promise<void>;
  updateTicketDepartment(id: number, data: any, tx: any): Promise<void>;
}
async function dependencies() {
  const [{ getDb }, tickets] = await Promise.all([
    import("../../_core/db/client"),
    import("../../_core/db/tickets"),
  ]);
  const db = await getDb();
  if (!db) throw new TeamTicketError("UNAVAILABLE", "قاعدة البيانات غير متاحة");
  return {
    db: db as unknown as TeamDatabase,
    tickets: tickets as TicketPromotionPort,
  };
}
function rows(value: unknown): any[] {
  if (!Array.isArray(value) || !Array.isArray(value[0]))
    throw new Error("نتيجة قراءة إسناد الفريق غير صحيحة");
  return value[0];
}
function team(r: any): AssignmentTeam {
  return {
    id: Number(r.id),
    name: r.name,
    active: Number(r.isActive) === 1,
    warehouseId: Number(r.warehouseId),
    warehouseActive: Number(r.warehouseActive) === 1,
    warehouseType: r.warehouseType,
    memberCount: Number(r.memberCount),
  };
}
class Transaction implements TeamAssignmentTransaction {
  constructor(
    private readonly db: TeamDatabaseTransaction,
    private readonly tickets: TicketPromotionPort
  ) {}
  private async select(query: SQL) {
    return rows(await this.db.execute(query));
  }
  async lockContext(
    input: TeamAssignmentInput
  ): Promise<AssignmentContext | null> {
    const p = this.tickets;
    await p.lockTicketForSubTicketSequence(input.ticketId, this.db);
    const parent = await p.getTicketById(input.ticketId, this.db);
    const initial = await p.getTicketTaskById(input.taskId, this.db);
    if (!parent || !initial || initial.ticketId !== input.ticketId) return null;
    await p.lockTicketDepartmentForTaskSequence(
      initial.ticketDepartmentId,
      this.db
    );
    await p.lockTicketTaskForPromotion(input.taskId, this.db);
    const task = await p.getTicketTaskById(input.taskId, this.db);
    const department =
      task &&
      (await p.getTicketDepartmentById(task.ticketDepartmentId, this.db));
    return task && department ? { parent, task, department } : null;
  }
  async existing(ticketId: number) {
    const [r] = await this.select(
      sql`SELECT id AS assignmentId,ticketId,ticketNumber,teamId FROM ticket_team_assignments WHERE ticketId=${ticketId} LIMIT 1`
    );
    return r
      ? {
          assignmentId: Number(r.assignmentId),
          ticketId: Number(r.ticketId),
          ticketNumber: r.ticketNumber,
          teamId: Number(r.teamId),
          alreadyExisting: true,
        }
      : null;
  }
  async namedAssigneeCount(taskId: number) {
    const [r] = await this.select(
      sql`SELECT COUNT(*) AS total FROM ticket_task_assignees WHERE taskId=${taskId}`
    );
    return Number(r.total);
  }
  async lockTeam(teamId: number) {
    // Lock the identical maintenance_teams parent row used by management.save/setActive.
    const [r] = await this.select(
      sql`SELECT id,name,warehouseId,isActive FROM maintenance_teams WHERE id=${teamId} FOR UPDATE`
    );
    if (!r) return null;
    const [w] = await this.select(
      sql`SELECT type,isActive FROM warehouses WHERE id=${Number(r.warehouseId)} FOR UPDATE`
    );
    const members = await this.select(
      sql`SELECT m.userId FROM maintenance_team_members m INNER JOIN users u ON u.id=m.userId WHERE m.teamId=${teamId} AND m.isActive=1 AND u.isActive=1 AND u.role='technician' ORDER BY m.userId FOR UPDATE`
    );
    return team({
      ...r,
      warehouseType: w?.type,
      warehouseActive: w?.isActive,
      memberCount: members.length,
    });
  }
  async create(
    c: AssignmentContext,
    selected: AssignmentTeam,
    actor: TeamManagementActor
  ) {
    const p = this.tickets;
    const parent = await p.getTicketById(c.parent.id, this.db);
    const task = await p.getTicketTaskById(c.task.id, this.db);
    if (!parent?.siteId || !parent.sectionId || !task)
      throw new TeamTicketError(
        "INVALID",
        "الموقع والقسم مطلوبان لإسناد الفريق"
      );
    const seq = await p.allocateNextSubTicketSequence(parent.id, this.db);
    const ticketNumber = `${parent.ticketNumber}-${String(seq).padStart(2, "0")}`;
    const title =
      task.title?.trim() || `${parent.title} — مهمة ${task.taskNumber}`;
    const now = new Date();
    const ticketId = Number(
      await p.createTicket(
        {
          ticketNumber,
          title,
          description: task.description,
          status: "under_inspection",
          priority: parent.priority,
          category: parent.category,
          categoryId: parent.categoryId ?? null,
          siteId: parent.siteId,
          sectionId: parent.sectionId,
          assetId: parent.assetId,
          locationDetail: parent.locationDetail,
          reportedById: parent.reportedById,
          beforePhotoUrl: parent.beforePhotoUrl,
          originalLanguage: parent.originalLanguage,
          ticketType: parent.ticketType || "internal",
          supervisorId: parent.supervisorId ?? actor.id,
          maintenanceResponsibleDepartment: c.department.department,
          maintenanceResponsibleManagerId: c.department.responsibleManagerId,
          maintenanceRoutedById: actor.id,
          maintenanceRoutedAt: now,
          maintenanceRoutingNote: `إسناد فريق من ${parent.ticketNumber} / مهمة ${task.taskNumber}`,
          // No primary individual and no synthetic PMV2 task. Membership governs the independent queue.
          assignedToId: null,
          assignedAt: now,
          workflowModel: "sub_ticket",
          parentTicketId: parent.id,
          sourceTaskId: task.id,
          subTicketSequence: seq,
        },
        this.db
      )
    );
    if (!ticketId) throw new Error("تعذر إنشاء البلاغ الفرعي");
    const itemId = Number(
      await p.createTicketItem(
        {
          ticketId,
          itemNumber: 1,
          title,
          description: task.description,
          descriptionAr: task.description,
          assetId: parent.assetId ?? null,
          responsibleDepartment: c.department.department,
          responsibleManagerId: c.department.responsibleManagerId,
          routedById: actor.id,
          routedAt: now,
          routingNote: `محول إلى فريق من ${parent.ticketNumber}`,
          status: "under_inspection",
          assignedToId: null,
          isLegacySingleItem: 0,
          createdById: actor.id,
        },
        this.db
      )
    );
    if (!itemId) throw new Error("تعذر إنشاء بند البلاغ الفرعي");
    const result = (await this.db.execute(
      sql`INSERT INTO ticket_team_assignments (ticketId,ticketItemId,ticketNumber,titleSnapshot,teamId,warehouseId,responsibleManagerId,siteId,sectionId,assetId,assignedById) VALUES (${ticketId},${itemId},${ticketNumber},${title.slice(0, 250)},${selected.id},${selected.warehouseId},${c.department.responsibleManagerId},${parent.siteId},${parent.sectionId},${parent.assetId ?? null},${actor.id})`
    )) as [{ insertId: number }];
    const assignmentId = Number(result[0].insertId);
    if (!assignmentId) throw new Error("تعذر ربط إسناد الفريق");
    // Opt in only newly assigned tickets. No schema migration or historical backfill.
    await this.db.execute(
      sql`INSERT INTO ticket_team_actions (assignmentId,actorId,kind,note,revision,operationKey) VALUES (${assignmentId},${actor.id},'execution_protocol','{"version":1}',0,${`ticket-team-protocol:${assignmentId}`})`
    );
    await p.updateTicketTask(
      task.id,
      { status: "promoted", convertedTicketId: ticketId },
      this.db
    );
    await p.updateTicketDepartment(
      c.department.id,
      { status: "active" },
      this.db
    );
    await this.db.execute(
      sql`INSERT INTO ticket_status_history (ticketId,toStatus,changedById,notes) VALUES (${ticketId},'under_inspection',${actor.id},${`إسناد الفريق ${selected.name} من البلاغ ${parent.ticketNumber}`})`
    );
    await this.db.execute(
      sql`INSERT INTO audit_logs (userId,action,entityType,entityId,newValues,ipAddress,userAgent) VALUES (${actor.id},'assign_ticket_maintenance_team','ticket',${parent.id},${JSON.stringify({ taskId: task.id, ticketId, ticketItemId: itemId, assignmentId, teamId: selected.id, warehouseId: selected.warehouseId, ticketNumber })},${actor.ipAddress ?? null},${actor.userAgent ?? null})`
    );
    return { ticketId, ticketNumber, assignmentId, alreadyExisting: false };
  }
}
export class SqlTicketTeamAssignmentRepository implements TeamAssignmentRepository {
  constructor(
    private readonly load: () => Promise<{
      db: TeamDatabase;
      tickets: TicketPromotionPort;
    }> = dependencies
  ) {}
  async transaction<T>(work: (tx: TeamAssignmentTransaction) => Promise<T>) {
    const { db, tickets } = await this.load();
    return db.transaction(tx => work(new Transaction(tx, tickets)));
  }
  async candidates() {
    const { db } = await this.load();
    return rows(
      await db.execute(
        sql`SELECT t.id,t.name,t.warehouseId,t.isActive,w.type AS warehouseType,w.isActive AS warehouseActive,(SELECT COUNT(*) FROM maintenance_team_members m INNER JOIN users u ON u.id=m.userId WHERE m.teamId=t.id AND m.isActive=1 AND u.role='technician' AND u.isActive=1) AS memberCount FROM maintenance_teams t INNER JOIN warehouses w ON w.id=t.warehouseId WHERE t.isActive=1 AND w.isActive=1 AND w.type='branch' ORDER BY t.name,t.id`
      )
    ).map(team);
  }
  async queue(
    actor: TeamManagementActor,
    options: { materialsOnly?: boolean } = {}
  ): Promise<AssignedTeamTicket[]> {
    const { db } = await this.load();
    const scope = ticketTeamQueueScope(actor);
    // Include received requests and completed executions too: their original-lot
    // returns may still need warehouse confirmation. No PMV2 task is fabricated.
    const materialScope = options.materialsOnly
      ? sql` AND EXISTS (SELECT 1 FROM ticket_team_material_needs n WHERE n.assignmentId=a.id)`
      : sql``;
    const tickets = rows(
      await db.execute(
        sql`SELECT a.id AS assignmentId,a.ticketId,a.ticketNumber,a.titleSnapshot AS title,a.teamId,t.name AS teamName,w.nameAr AS warehouseName,a.stage,k.status AS sourceStatus,s.name AS siteName,c.name AS sectionName,k.description FROM ticket_team_assignments a INNER JOIN maintenance_teams t ON t.id=a.teamId INNER JOIN tickets k ON k.id=a.ticketId INNER JOIN ticket_items i ON i.id=a.ticketItemId AND i.ticketId=a.ticketId LEFT JOIN warehouses w ON w.id=a.warehouseId LEFT JOIN sites s ON s.id=a.siteId LEFT JOIN sections c ON c.id=a.sectionId WHERE ${scope}${materialScope} ORDER BY a.createdAt DESC,a.id DESC LIMIT 200`
      )
    ).map(r => ({
      ...r,
      assignmentId: Number(r.assignmentId),
      ticketId: Number(r.ticketId),
      teamId: Number(r.teamId),
    }));
    if (!tickets.length) return tickets;
    if (!options.materialsOnly && actor.role === "warehouse") return tickets;
    if (!options.materialsOnly) {
      const ids = sql.join(tickets.map(t => sql`${t.assignmentId}`), sql`,`);
      const [historyRows, reportMedia] = await Promise.all([
        db.execute(sql`SELECT id,assignmentId,actorId,kind,CASE WHEN kind IN ('execution_started','execution_resumed','execution_joined','visit_ended') THEN note ELSE '' END AS note,revision,operationKey,createdAt FROM ticket_team_actions WHERE assignmentId IN (${ids}) AND kind IN ('execution_protocol','execution_started','execution_resumed','execution_joined','visit_ended','ok','fixed','blocked','external','materials_started','needs_material','return_to_team','external_handover','approve_result') ORDER BY assignmentId,revision`),
        loadTeamReportMedia(db, actor, tickets),
      ]);
      const history = rows(historyRows).map(x => ({
        id: Number(x.id), assignmentId: Number(x.assignmentId), actorId: Number(x.actorId), kind: String(x.kind), note: String(x.note), revision: Number(x.revision), operationKey: String(x.operationKey), at: x.createdAt instanceof Date ? x.createdAt.toISOString() : String(x.createdAt),
      }));
      return tickets.map(t => {
        const session = ticketExecutionSession({ actions: history }, { id: t.assignmentId, stage: t.stage });
        return { ...t, reportMedia: reportMedia.get(t.assignmentId) || [], executionInProgress: session.working, hasOpenVisit: !!session.openVisit };
      });
    }
    const needs = rows(
      await db.execute(sql`SELECT n.id,n.assignmentId,n.materialRound,n.catalogItemId,n.itemNameSnapshot,n.originalItemName,n.unitSnapshot,n.requestedQuantity,n.usedQuantity,
      COALESCE(d.issued,0) AS issued,COALESCE(d.returned,0) AS returned,
      CASE WHEN (SELECT COUNT(*) FROM inventory v WHERE v.warehouseId=n.warehouseId AND v.linkedItemId=n.catalogItemId)=1
      THEN COALESCE((SELECT LEAST(FLOOR(v.quantity),COALESCE((SELECT SUM(FLOOR(b.quantity)) FROM inventory_lot_balances b INNER JOIN inventory_lots l ON l.id=b.lotId WHERE b.inventoryId=v.id AND b.quantity>0 AND l.catalogItemId=n.catalogItemId AND (l.specificationStatus IS NULL OR l.specificationStatus='approved') AND COALESCE(NULLIF(l.issueUnit,''),NULLIF(v.issueUnit,''),v.unit)=n.unitSnapshot),0)) FROM inventory v INNER JOIN warehouses w ON w.id=v.warehouseId AND w.isActive=1 WHERE v.warehouseId=n.warehouseId AND v.linkedItemId=n.catalogItemId AND COALESCE(v.isFrozen,0)=0 AND COALESCE(NULLIF(v.issueUnit,''),v.unit)=n.unitSnapshot),0) ELSE 0 END AS available,
      a.materialRound AS currentRound
      FROM ticket_team_material_needs n INNER JOIN ticket_team_assignments a ON a.id=n.assignmentId
      LEFT JOIN (SELECT needId,SUM(issuedQuantity) AS issued,SUM(returnedQuantity) AS returned FROM ticket_team_delivery_links GROUP BY needId) d ON d.needId=n.id
      WHERE n.assignmentId IN (${sql.join(
        tickets.map(t => sql`${t.assignmentId}`),
        sql`,`
      )})`)
    );
    // Two bounded reads for the same authorized queue; no per-ticket stock writes.
    const queueIds = sql.join(
      tickets.map(t => sql`${t.assignmentId}`),
      sql`, `
    );
    const actions = rows(
      await db.execute(
        sql`SELECT assignmentId,kind,note,revision FROM ticket_team_actions WHERE assignmentId IN (${queueIds}) AND kind IN ('needs_material','material_resolved')`
      )
    ).map(r => ({
      ...r,
      assignmentId: Number(r.assignmentId),
      revision: Number(r.revision),
    })) as Snapshot["actions"];
    const supplies = rows(
      await db.execute(
        sql`SELECT s.needId,s.sourceKind AS kind,s.linkedQuantity AS quantity,s.status FROM ticket_team_supply_links s INNER JOIN ticket_team_material_needs n ON n.id=s.needId WHERE n.assignmentId IN (${queueIds}) AND s.sourceKind='transfer' AND s.status='received'`
      )
    ).map(r => ({
      ...r,
      needId: Number(r.needId),
      quantity: Number(r.quantity),
    })) as Snapshot["supplies"];
    return tickets.map(t => {
      const materialNeeds = needs
        .filter(n => Number(n.assignmentId) === t.assignmentId)
        .flatMap(n => {
          const entry = (section: "waiting" | "ready" | "returns") => [
            {
              needId: Number(n.id),
              name: String(n.itemNameSnapshot ?? ""),
              unit: String(n.unitSnapshot ?? ""),
              section,
            },
          ];
          const left = Number(n.requestedQuantity) - Number(n.issued);
          const pendingReturn =
            n.usedQuantity == null
              ? 0
              : Number(n.issued) - Number(n.usedQuantity) - Number(n.returned);
          if (pendingReturn > 0) return entry("returns");
          if (
            t.stage !== "waiting_material" ||
            Number(n.materialRound) !== Number(n.currentRound) ||
            left <= 0
          )
            return [];
          const supplyLeft =
            materialSupplyRemaining({ actions, supplies }, {
              id: Number(n.id),
              assignmentId: Number(n.assignmentId),
              round: Number(n.materialRound),
              catalogItemId:
                n.catalogItemId == null ? null : Number(n.catalogItemId),
              originalName: n.originalItemName,
            } as MaterialNeed) ?? 0;
          return entry(
            n.catalogItemId != null &&
              supplyLeft === 0 &&
              Number(n.available) >= left
              ? "ready"
              : "waiting"
          );
        });
      return {
        ...t,
        materialNeeds,
        materialSections: Array.from(
          new Set(materialNeeds.map(n => n.section))
        ),
      };
    });
  }
}
