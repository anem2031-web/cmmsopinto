import { sql, type SQL } from "drizzle-orm";
import { observerReadActorRole } from "../../_core/authz/observer-read-scope";
import { MaintenanceTeamTicketService } from "../../maintenance-team-tickets/service";
import type {
  Store,
  MaterialGateway,
} from "../../maintenance-team-tickets/ports";
import {
  TeamTicketError,
  type Snapshot,
  type Assignment,
  type Action,
} from "../../../shared/maintenance-team-tickets/model";
import type { TeamManagementActor } from "../../../shared/maintenance-team-tickets/team-management";
import { canExecuteAllTicketTeams } from "../../../shared/maintenance-team-tickets/execution-permissions";
import type { TeamDatabase, TeamDatabaseTransaction } from "./repository";
import { limitReplacementSourceCoverage, loadReplacementFulfillments, replacementPhysicalToOriginal } from "../../supplier-return-followup/fulfillment";
import { decimal4 } from "../../supplier-return-followup/amounts";

export const resultRows = (value: unknown): any[] => {
  if (!Array.isArray(value) || !Array.isArray(value[0]))
    throw new Error("نتيجة قراءة تنفيذ الفريق غير صحيحة");
  return value[0];
};
export const selectRows = async (tx: TeamDatabaseTransaction, query: SQL) =>
  resultRows(await tx.execute(query));
export interface ExecutionDependencies {
  queueActionTranslations?: (actions: Action[]) => Promise<void>;
  db: TeamDatabase;
  gateway(
    tx: TeamDatabaseTransaction,
    state: Snapshot,
    actor: TeamManagementActor,
    options: ExecutionOptions
  ): MaterialGateway;
}
export interface ExecutionOptions {
  catalogIds?: number[];
  requiredDate?: string;
  recipientId?: number;
}
async function applicationDependencies(): Promise<ExecutionDependencies> {
  // Deliberately lazy: importing the router or testing an injected repository never connects.
  const [{ getDb }, { ProductionMaterialGateway }] = await Promise.all([
    import("../../_core/db/client"),
    import("./execution.materials"),
  ]);
  const db = await getDb();
  if (!db) throw new TeamTicketError("UNAVAILABLE", "قاعدة البيانات غير متاحة");
  return {
    db: db as unknown as TeamDatabase,
    queueActionTranslations: async actions => {
      const { queueActionTranslations } = await import("../../maintenance-team-tickets/action-translations");
      await queueActionTranslations(actions);
    },
    gateway: (tx, state, actor, options) =>
      new ProductionMaterialGateway(tx, state, actor, options),
  };
}
const num = (x: any) => Number(x);
const at = (x: any) => (x instanceof Date ? x.toISOString() : String(x));

export async function loadExecution(
  tx: TeamDatabaseTransaction,
  id: number,
  actor: TeamManagementActor,
  options: ExecutionOptions,
  lock: boolean
): Promise<Snapshot> {
  const suffix = lock ? sql` FOR UPDATE` : sql``;
  // Team management locks this parent first too, so membership edits cannot race execution.
  const [ref] = await selectRows(
    tx,
    sql`SELECT teamId,ticketId FROM ticket_team_assignments WHERE id=${id}`
  );
  if (!ref) throw new TeamTicketError("NOT_FOUND", "إسناد الفريق غير موجود");
  const teams = await selectRows(
    tx,
    sql`SELECT * FROM maintenance_teams WHERE id=${num(ref.teamId)}${suffix}`
  );
  await selectRows(
    tx,
    sql`SELECT id FROM tickets WHERE id=${num(ref.ticketId)}${suffix}`
  );
  const [r] = await selectRows(
    tx,
    sql`SELECT a.*,k.status AS ticketStatus,k.workflowModel,k.assignedToId,k.maintenanceResponsibleDepartment,i.status AS itemStatus,i.ticketId AS itemTicketId FROM ticket_team_assignments a INNER JOIN tickets k ON k.id=a.ticketId INNER JOIN ticket_items i ON i.id=a.ticketItemId WHERE a.id=${id}${suffix}`
  );
  if (
    !r ||
    num(r.itemTicketId) !== num(r.ticketId) ||
    r.workflowModel !== "sub_ticket"
  )
    throw new TeamTicketError(
      "CONFLICT",
      "ربط إسناد الفريق بالبلاغ وبنده غير صحيح"
    );
  const memberships = await selectRows(
    tx,
    sql`SELECT * FROM maintenance_team_members WHERE teamId=${num(r.teamId)} ORDER BY userId${suffix}`
  );
  const userIds = Array.from(
    new Set([
      actor.id,
      ...(options.recipientId ? [options.recipientId] : []),
      num(r.responsibleManagerId),
      ...memberships.map(m => num(m.userId)),
    ])
  );
  const users = await selectRows(
    tx,
    sql`SELECT id,name,role,isActive FROM users WHERE id IN (${sql.join(
      userIds.map(x => sql`${x}`),
      sql`,`
    )}) ${!lock ? sql` OR (isActive=1 AND role IN ('owner','admin','maintenance_manager','general_maintenance_manager','construction_procurement_manager'))` : sql``} ORDER BY id${suffix}`
  );
  const u = users.find(
    u =>
      num(u.id) === actor.id && num(u.isActive) === 1 && observerReadActorRole(num(u.id), u.role) === actor.role
  );
  const privileged =
    canExecuteAllTicketTeams(u && observerReadActorRole(num(u.id), u.role)) || u?.role === "warehouse";
  const member =
    (u?.role === "technician" ||
      (["it_manager", "it_member"].includes(u?.role) &&
        num(r.assignedToId) === actor.id &&
        r.maintenanceResponsibleDepartment === "maintenance_report_department_it")) &&
    num(teams[0]?.isActive) === 1 &&
    memberships.some(m => num(m.userId) === actor.id && num(m.isActive) === 1);
  if (!actor.active || !u || !(privileged || member))
    throw new TeamTicketError("FORBIDDEN", "لا توجد صلاحية لتنفيذ هذه التذكرة");
  const [warehouse] = await selectRows(
    tx,
    sql`SELECT id,nameAr,isActive FROM warehouses WHERE id=${num(r.warehouseId)}${suffix}`
  );
  const needs = await selectRows(
    tx,
    sql`SELECT * FROM ticket_team_material_needs WHERE assignmentId=${id} ORDER BY id${suffix}`
  );
  const catalogs = Array.from(
    new Set([
      ...needs
        .map(n => n.catalogItemId)
        .filter(x => x != null)
        .map(num),
      ...(options.catalogIds ?? []),
    ])
  );
  const catalog = catalogs.length
    ? await selectRows(
        tx,
        sql`SELECT c.id,c.nameAr,c.unit,c.isActive,EXISTS (SELECT 1 FROM catalog_units u WHERE u.isActive=0 AND (u.nameAr=c.unit OR u.nameEn=c.unit)) AS inactiveUnit FROM catalog_items c WHERE c.id IN (${sql.join(
          catalogs.map(x => sql`${x}`),
          sql`,`
        )}) ORDER BY c.id${suffix}`
      )
    : [];
  const deliveries = await selectRows(
    tx,
    sql`SELECT d.* FROM ticket_team_delivery_links d INNER JOIN ticket_team_material_needs n ON n.id=d.needId WHERE n.assignmentId=${id} ORDER BY d.id${suffix}`
  );
  const supplies = await selectRows(
    tx,
    sql`SELECT d.* FROM ticket_team_supply_links d INNER JOIN ticket_team_material_needs n ON n.id=d.needId WHERE n.assignmentId=${id} ORDER BY d.id${suffix}`
  );
  const replacementBySource = await loadReplacementFulfillments(tx,
    supplies.filter(s => s.sourceKind === "purchase").map(s => num(s.sourceId)));
  const equivalentByDelivery = new Map<number, number>();
  const replacementDelivery = new Map<number, { replacementPlanId: number; replacementName: string; physicalUnit: string; physicalCatalogItemId: number }>();
  const equivalentBySupply = new Map<number, number>();
  const replacementSupply = new Map<number, { physicalUnit: string; replacementName: string }>();
  const transferIds = supplies.filter(s => s.sourceKind === "transfer").map(s => num(s.sourceId));
  const transferLots = new Map<number, number>();
  if (replacementBySource.size) {
    for (let offset = 0; offset < transferIds.length; offset += 500) {
      const rows = await selectRows(tx, sql`SELECT id,lotId FROM warehouse_transfers WHERE id IN (${sql.join(transferIds.slice(offset, offset + 500).map(id => sql`${id}`), sql`,`)})`);
      for (const row of rows) transferLots.set(num(row.id), num(row.lotId));
    }
    for (const source of supplies.filter(s => s.sourceKind === "purchase")) {
      const need = needs.find(n => num(n.id) === num(source.needId));
      for (const plan of limitReplacementSourceCoverage(replacementBySource.get(num(source.sourceId)) ?? [], String(source.linkedQuantity))) {
        if (!need || plan.sourceCatalogItemId !== num(need.catalogItemId) || plan.originalUnit !== need.unitSnapshot
          || plan.sourceTicketId !== num(r.ticketId) || plan.sourceTicketItemId !== num(r.ticketItemId))
          throw new TeamTicketError("CONFLICT", "تعويض المورد لا يطابق احتياج الفريق");
        let deliveredCoverage = BigInt(0), transferredCoverage = BigInt(0);
        for (const d of deliveries.filter(d => num(d.needId) === num(need.id) && plan.lots.some(l => l.lotId === num(d.lotId)))) {
          const coverage = replacementPhysicalToOriginal(plan, String(d.issuedQuantity)); deliveredCoverage += decimal4(coverage);
          equivalentByDelivery.set(num(d.id), Number(coverage));
          replacementDelivery.set(num(d.id), { replacementPlanId: plan.planId, replacementName: plan.itemName, physicalUnit: plan.lots.find(l => l.lotId === num(d.lotId))!.unit, physicalCatalogItemId: plan.catalogItemId });
        }
        for (const s of supplies.filter(s => num(s.needId) === num(need.id) && s.sourceKind === "transfer" && plan.lots.some(l => l.lotId === transferLots.get(num(s.sourceId))))) {
          const coverage = replacementPhysicalToOriginal(plan, String(s.linkedQuantity)); transferredCoverage += decimal4(coverage);
          equivalentBySupply.set(num(s.id), Number(coverage));
          replacementSupply.set(num(s.id), { physicalUnit: plan.lots.find(l => l.lotId === transferLots.get(num(s.sourceId)))!.unit, replacementName: plan.itemName });
        }
        if (deliveredCoverage > decimal4(plan.maximumOriginalQuantity) || transferredCoverage > decimal4(plan.maximumOriginalQuantity))
          throw new TeamTicketError("CONFLICT", "تغطية البديل تتجاوز كمية مصدر الشراء المرتبطة بالاحتياج");
      }
    }
  }
  // Re-read canonical procurement decisions. Never infer physical receipt, and a
  // reopened purchase blocks replacement again instead of retaining a stale cancellation.
  for (const s of supplies.filter(
    s => s.sourceKind === "purchase" && s.status !== "received"
  )) {
    const [p] = await selectRows(
      tx,
      sql`SELECT i.status,i.catalogItemId,i.unit,i.receivedQuantity,i.receivedAt,p.status AS poStatus,p.ticketId,p.ticketItemId FROM purchase_order_items i INNER JOIN purchase_orders p ON p.id=i.purchaseOrderId WHERE i.id=${num(s.sourceId)}${suffix}`
    );
    if (
      !p ||
      num(p.ticketId) !== num(r.ticketId) ||
      num(p.ticketItemId) !== num(r.ticketItemId)
    )
      throw new TeamTicketError(
        "CONFLICT",
        "مرجع شراء مواد الفريق غير مطابق للبلاغ"
      );
    s.status =
      ["rejected", "cancelled", "purchase_cancelled"].includes(p.status) ||
      p.poStatus === "rejected"
        ? "cancelled"
        : "pending";
    const need = needs.find(n => num(n.id) === num(s.needId));
    if (
      s.status === "pending" &&
      need &&
      p.receivedAt &&
      num(p.receivedQuantity) >= num(s.linkedQuantity) &&
      num(p.catalogItemId) === num(need.catalogItemId) &&
      p.unit === need.unitSnapshot &&
      [
        "approved",
        "partial_purchase",
        "purchased",
        "received",
        "closed",
      ].includes(p.poStatus)
    ) {
      // A procurement status alone never counts as stock. Use the original PO
      // item's physically received lots in the single active main warehouse.
      const [receipt] = await selectRows(
        tx,
        sql`SELECT COALESCE(SUM(b.quantity),0) AS quantity FROM inventory_lots l INNER JOIN inventory_lot_balances b ON b.lotId=l.id INNER JOIN inventory v ON v.id=b.inventoryId INNER JOIN warehouses w ON w.id=v.warehouseId WHERE l.purchaseOrderItemId=${num(s.sourceId)} AND w.type='main' AND w.isActive=1 AND (SELECT COUNT(*) FROM warehouses WHERE type='main' AND isActive=1)=1 AND (l.specificationStatus IS NULL OR l.specificationStatus='approved')`
      );
      if (num(receipt?.quantity) >= num(s.linkedQuantity))
        s.status = "received";
    }
  }
  const returns = await selectRows(
    tx,
    sql`SELECT d.* FROM ticket_team_return_links d INNER JOIN ticket_team_delivery_links l ON l.id=d.deliveryLinkId INNER JOIN ticket_team_material_needs n ON n.id=l.needId WHERE n.assignmentId=${id} ORDER BY d.id${suffix}`
  );
  const actions = await selectRows(
    tx,
    sql`SELECT * FROM ticket_team_actions WHERE assignmentId=${id} ORDER BY revision`
  );
  // Display the actual executor/recipient even when they are not a team member.
  // Authorization above uses only the current, locked actor; these names grant no permission.
  const historyUserIds = Array.from(
    new Set([
      ...actions.map(x => num(x.actorId)),
      ...deliveries.map(x => num(x.receivedById)),
    ])
  ).filter(
    id =>
      Number.isSafeInteger(id) && id > 0 && !users.some(u => num(u.id) === id)
  );
  if (historyUserIds.length) {
    users.push(
      ...(await selectRows(
        tx,
        sql`SELECT id,name,role,isActive FROM users WHERE id IN (${sql.join(
          historyUserIds.map(x => sql`${x}`),
          sql`,`
        )}) ORDER BY id`
      ))
    );
  }
  const operations = lock
    ? await selectRows(
        tx,
        sql`SELECT operationKey,fingerprint,resultJson FROM ticket_team_operations WHERE assignmentId=${id}`
      )
    : [];
  const a: Assignment = {
    id: num(r.id),
    ticketId: num(r.ticketId),
    ticketItemId: num(r.ticketItemId),
    ticketNumber: r.ticketNumber,
    title: r.titleSnapshot,
    teamId: num(r.teamId),
    warehouseId: num(r.warehouseId),
    responsibleManagerId: num(r.responsibleManagerId),
    location: {
      siteId: num(r.siteId),
      sectionId: num(r.sectionId),
      ...(r.assetId == null ? {} : { assetId: num(r.assetId) }),
    },
    stage: r.stage,
    outcome: r.outcome ?? undefined,
    revision: num(r.revision),
    materialRound: num(r.materialRound),
    assignedById: num(r.assignedById),
  };
  const closed =
    [
      "closed",
      "verified",
      "requester_confirmed",
      "cancelled",
      "rejected",
    ].includes(r.itemStatus) ||
    ["closed", "cancelled", "rejected"].includes(r.ticketStatus);
  if (lock && closed && a.stage !== "closed")
    throw new TeamTicketError(
      "CONFLICT",
      "انتهى البلاغ الأصلي؛ لا يمكن متابعة التنفيذ"
    );
  return {
    users: users.map(u => ({
      id: num(u.id),
      name: u.name || `#${u.id}`,
      role: observerReadActorRole(num(u.id), u.role),
      active: num(u.isActive) === 1,
    })),
    teams: teams.map(t => ({
      id: num(t.id),
      name: t.name,
      warehouseId: num(t.warehouseId),
      active: num(t.isActive) === 1,
      createdById: num(t.createdById),
      updatedById: num(t.updatedById),
    })),
    memberships: memberships.map(m => ({
      teamId: num(m.teamId),
      userId: num(m.userId),
      active: num(m.isActive) === 1,
      joinedAt: at(m.joinedAt),
      leftAt: m.leftAt == null ? null : at(m.leftAt),
      updatedById: num(m.updatedById),
    })),
    warehouses: warehouse
      ? [
          {
            id: num(warehouse.id),
            name: warehouse.nameAr,
            active: num(warehouse.isActive) === 1,
          },
        ]
      : [],
    catalog: catalog.map(c => ({
      id: num(c.id),
      name: c.nameAr,
      unit: c.unit,
      active: num(c.isActive) === 1 && !num(c.inactiveUnit),
    })),
    locations: [a.location],
    tickets: [
      {
        ticketId: a.ticketId,
        ticketItemId: a.ticketItemId,
        ticketNumber: a.ticketNumber,
        title: a.title,
        location: a.location,
        responsibleManagerId: a.responsibleManagerId,
        closed,
        assignmentMode: "team",
        assignedToId: r.assignedToId == null ? null : num(r.assignedToId),
        responsibleDepartment: r.maintenanceResponsibleDepartment ?? null,
      },
    ],
    assignments: [a],
    needs: needs.map(n => ({
      id: num(n.id),
      assignmentId: id,
      catalogItemId: n.catalogItemId == null ? null : num(n.catalogItemId),
      name: n.itemNameSnapshot,
      originalName: n.originalItemName,
      unit: n.unitSnapshot,
      requested: num(n.requestedQuantity),
      used: n.usedQuantity == null ? null : num(n.usedQuantity),
      requestedById: num(n.requestedById),
      warehouseId: num(n.warehouseId),
      round: num(n.materialRound),
    })),
    deliveries: deliveries.map(d => ({
      id: num(d.id),
      needId: num(d.needId),
      deliveryId: num(d.deliveryDocumentId),
      deliveryNumber: d.deliveryNumber,
      lotId: num(d.lotId),
      inventoryTransactionId: num(d.inventoryTransactionId),
      quantity: num(d.issuedQuantity),
      receivedById: num(d.receivedById),
      used: d.usedQuantity == null ? null : num(d.usedQuantity),
      returned: num(d.returnedQuantity),
      ...(equivalentByDelivery.has(num(d.id)) ? { originalEquivalent: equivalentByDelivery.get(num(d.id)) } : {}),
      ...(replacementDelivery.get(num(d.id)) ?? {}),
    })),
    supplies: supplies.map(s => ({
      id: num(s.id),
      needId: num(s.needId),
      kind: s.sourceKind,
      sourceId: num(s.sourceId),
      sourceNumber: s.sourceNumber,
      quantity: num(s.linkedQuantity),
      status: s.status,
      ...(equivalentBySupply.has(num(s.id)) ? { originalEquivalent: equivalentBySupply.get(num(s.id)) } : {}),
      ...(replacementSupply.get(num(s.id)) ?? {}),
    })),
    returns: returns.map(x => ({
      id: num(x.id),
      deliveryLinkId: num(x.deliveryLinkId),
      sourceDeliveryId: num(x.sourceDeliveryDocumentId),
      returnId: num(x.warehouseReturnId),
      returnNumber: x.returnNumber,
      quantity: num(x.quantity),
      actorId: num(x.actorId),
    })),
    actions: actions.map(x => ({
      id: num(x.id),
      assignmentId: id,
      actorId: num(x.actorId),
      kind: x.kind,
      note: x.note,
      revision: num(x.revision),
      operationKey: x.operationKey,
      at: at(x.createdAt),
    })),
    operations: operations.map(x => ({
      key: x.operationKey,
      fingerprint: x.fingerprint,
      result:
        typeof x.resultJson === "string"
          ? JSON.parse(x.resultJson)
          : x.resultJson,
    })),
    nextId:
      Math.max(
        0,
        ...needs.map(x => num(x.id)),
        ...deliveries.map(x => num(x.id)),
        ...supplies.map(x => num(x.id)),
        ...returns.map(x => num(x.id)),
        ...actions.map(x => num(x.id))
      ) + 1,
  };
}
async function insert(
  tx: TeamDatabaseTransaction,
  query: SQL
): Promise<number> {
  const [r] = (await tx.execute(query)) as [{ insertId?: number }];
  if (!Number(r?.insertId)) throw new Error("تعذر حفظ سجل تنفيذ الفريق");
  return Number(r.insertId);
}
export async function persistExecution(
  tx: TeamDatabaseTransaction,
  before: Snapshot,
  state: Snapshot,
  actor: TeamManagementActor,
  committedActions: Action[] = []
) {
  const a = state.assignments[0],
    old = before.assignments[0];
  if (a.revision === old.revision) return; // Preview and successful retries are read-only.
  const needIds = new Map<number, number>(),
    deliveryIds = new Map<number, number>();
  for (const n of state.needs) {
    if (before.needs.some(x => x.id === n.id)) {
      needIds.set(n.id, n.id);
      await tx.execute(
        sql`UPDATE ticket_team_material_needs SET catalogItemId=${n.catalogItemId},itemNameSnapshot=${n.name},unitSnapshot=${n.unit},requestedQuantity=${n.requested},usedQuantity=${n.used} WHERE id=${n.id} AND assignmentId=${a.id}`
      );
    } else
      needIds.set(
        n.id,
        await insert(
          tx,
          sql`INSERT INTO ticket_team_material_needs (assignmentId,materialRound,catalogItemId,itemNameSnapshot,originalItemName,unitSnapshot,requestedQuantity,usedQuantity,requestedById,warehouseId) VALUES (${a.id},${n.round},${n.catalogItemId},${n.name},${n.originalName},${n.unit},${n.requested},${n.used},${n.requestedById},${n.warehouseId})`
        )
      );
  }
  for (const d of state.deliveries) {
    if (before.deliveries.some(x => x.id === d.id)) {
      deliveryIds.set(d.id, d.id);
      await tx.execute(
        sql`UPDATE ticket_team_delivery_links SET usedQuantity=${d.used},returnedQuantity=${d.returned} WHERE id=${d.id}`
      );
    } else
      deliveryIds.set(
        d.id,
        await insert(
          tx,
          sql`INSERT INTO ticket_team_delivery_links (needId,deliveryDocumentId,deliveryNumber,lotId,inventoryTransactionId,issuedQuantity,receivedById,usedQuantity,returnedQuantity) VALUES (${needIds.get(d.needId)!},${d.deliveryId},${d.deliveryNumber},${d.lotId},${d.inventoryTransactionId},${d.quantity},${d.receivedById},${d.used},${d.returned})`
        )
      );
  }
  for (const s of state.supplies) {
    if (before.supplies.some(x => x.id === s.id))
      await tx.execute(
        sql`UPDATE ticket_team_supply_links SET status=${s.status} WHERE id=${s.id}`
      );
    else
      await insert(
        tx,
        sql`INSERT INTO ticket_team_supply_links (needId,sourceKind,sourceId,sourceNumber,linkedQuantity,status) VALUES (${needIds.get(s.needId)!},${s.kind},${s.sourceId},${s.sourceNumber},${s.quantity},${s.status})`
      );
  }
  for (const r of state.returns.filter(
    r => !before.returns.some(x => x.id === r.id)
  ))
    await insert(
      tx,
      sql`INSERT INTO ticket_team_return_links (deliveryLinkId,sourceDeliveryDocumentId,warehouseReturnId,returnNumber,quantity,actorId) VALUES (${deliveryIds.get(r.deliveryLinkId)!},${r.sourceDeliveryId},${r.returnId},${r.returnNumber},${r.quantity},${r.actorId})`
    );
  for (const x of state.actions.filter(x => x.revision > old.revision)) {
    const actionId = await insert(
      tx,
      sql`INSERT INTO ticket_team_actions (assignmentId,actorId,kind,note,revision,operationKey) VALUES (${a.id},${x.actorId},${x.kind},${x.note},${x.revision},${x.operationKey})`
    );
    committedActions.push({ ...x, id: actionId });
    await tx.execute(
      sql`INSERT INTO audit_logs (userId,action,entityType,entityId,oldValues,newValues,ipAddress,userAgent) VALUES (${actor.id},${`ticket_team_${x.kind}`},'ticket_team_assignment',${a.id},${JSON.stringify({ stage: old.stage, revision: old.revision })},${JSON.stringify({ stage: a.stage, revision: a.revision, note: x.note, ticketId: a.ticketId })},${actor.ipAddress ?? null},${actor.userAgent ?? null})`
    );
  }
  const update = (await tx.execute(
    sql`UPDATE ticket_team_assignments SET stage=${a.stage},outcome=${a.outcome ?? null},revision=${a.revision},materialRound=${a.materialRound} WHERE id=${a.id} AND revision=${old.revision}`
  )) as [{ affectedRows: number }];
  if (Number(update[0]?.affectedRows) !== 1)
    throw new TeamTicketError(
      "CONFLICT",
      "تغيرت نسخة تنفيذ الفريق؛ أعد تحميل البيانات"
    );
  for (const op of state.operations.filter(
    op => !before.operations.some(x => x.key === op.key)
  ))
    await tx.execute(
      sql`INSERT INTO ticket_team_operations (operationKey,assignmentId,actorId,fingerprint,resultJson) VALUES (${op.key},${a.id},${actor.id},${op.fingerprint},${JSON.stringify(op.result)})`
    );
}
export class SqlExecutionStore implements Store {
  constructor(
    private readonly assignmentId: number,
    private readonly actor: TeamManagementActor,
    private readonly options: ExecutionOptions = {},
    private readonly load: () => Promise<ExecutionDependencies> = applicationDependencies
  ) {}
  async read() {
    const { db } = await this.load();
    return db.transaction(tx =>
      loadExecution(tx, this.assignmentId, this.actor, this.options, false)
    );
  }
  async transaction<T>(
    work: (s: Snapshot, effects: MaterialGateway) => Promise<T>
  ): Promise<T> {
    const deps = await this.load();
    const committedActions: Action[] = [];
    const outcome = await deps.db.transaction(async tx => {
      const state = await loadExecution(
          tx,
          this.assignmentId,
          this.actor,
          this.options,
          true
        ),
        before = structuredClone(state);
      const result = await work(
        state,
        deps.gateway(tx, state, this.actor, this.options)
      );
      if (state.assignments[0].revision !== before.assignments[0].revision) {
        const { bridgeTicketExecution } = await import("./execution.workflow");
        await bridgeTicketExecution(tx, before, state, this.actor);
        await persistExecution(tx, before, state, this.actor, committedActions);
      }
      return result;
    });
    // Translation is best effort after commit: neither latency nor failure changes execution.
    if (committedActions.length && deps.queueActionTranslations) {
      void Promise.resolve().then(() => deps.queueActionTranslations!(committedActions))
        .catch(error => console.error("[TICKET_TEAM_ACTION] translation queue failed", error));
    }
    return outcome;
  }
}
export const executionService = (
  id: number,
  actor: TeamManagementActor,
  options: ExecutionOptions = {}
) =>
  new MaintenanceTeamTicketService(new SqlExecutionStore(id, actor, options));
