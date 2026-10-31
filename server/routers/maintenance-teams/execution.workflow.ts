import { sql } from "drizzle-orm";
import {
  TeamTicketError,
  type Snapshot,
} from "../../../shared/maintenance-team-tickets/model";
import type { TeamManagementActor } from "../../../shared/maintenance-team-tickets/team-management";
import type { TeamDatabaseTransaction } from "./repository";
import { selectRows } from "./execution.repository";
import { TICKET_MATERIAL_REQUEST_EVENT } from "../../../shared/maintenance-team-tickets/warehouse-navigation";
import { materialActionMessage } from "../../../shared/maintenance-team-tickets/material-routing";

export async function bridgeTicketExecution(
  tx: TeamDatabaseTransaction,
  before: Snapshot,
  state: Snapshot,
  actor: TeamManagementActor
) {
  const a = state.assignments[0],
    old = before.assignments[0],
    action = state.actions.find(x => x.revision === a.revision);
  if (!action) throw new Error("إجراء الفريق مفقود");
  const [sourceTicket] = await selectRows(
    tx,
    sql`SELECT maintenanceResponsibleDepartment,assignedToId,reportedById FROM tickets WHERE id=${a.ticketId} FOR UPDATE`
  );
  const itExecutionResult =
    sourceTicket?.maintenanceResponsibleDepartment ===
      "maintenance_report_department_it" &&
    Number(sourceTicket.assignedToId) === actor.id &&
    ["ok", "fixed"].includes(action.kind);
  if (itExecutionResult) {
    const materials = state.needs.map(n => ({
      name: n.name,
      unit: n.unit,
      used: n.used,
      requested: n.requested,
      ...(state.deliveries.some(d => d.needId === n.id && d.replacementPlanId != null) ? { actualDeliveries: state.deliveries.filter(d => d.needId === n.id).map(d => ({ deliveryId: d.deliveryId, itemName: d.replacementName ?? n.name, quantity: d.quantity, unit: d.physicalUnit ?? n.unit, used: d.used, returned: d.returned })) } : {}),
    }));
    a.stage = "closed";
    await tx.execute(
      sql`UPDATE ticket_items SET status='closed',maintenancePath='B',repairNotes=${action.note},materialsUsed=${JSON.stringify(materials)},closedAt=CURRENT_TIMESTAMP WHERE id=${a.ticketItemId} AND ticketId=${a.ticketId}`
    );
    await tx.execute(
      sql`UPDATE tickets SET status='closed',maintenancePath='B',repairNotes=${action.note},materialsUsed=${JSON.stringify(materials)},closedAt=CURRENT_TIMESTAMP WHERE id=${a.ticketId}`
    );
    await tx.execute(
      sql`INSERT INTO ticket_status_history (ticketId,toStatus,changedById,notes) VALUES (${a.ticketId},'closed',${actor.id},'أنهى منفذ تقنية المعلومات الإصلاح بعد استلام المواد')`
    );
    if (sourceTicket.reportedById && Number(sourceTicket.reportedById) !== actor.id)
      await tx.execute(
        sql`INSERT INTO notifications (userId,title,message,type,relatedTicketId) VALUES (${Number(sourceTicket.reportedById)},'🔒 تم إغلاق بلاغك',${`أنهى فريق تقنية المعلومات البلاغ ${a.ticketNumber}. يرجى تأكيد إتمام العمل.`},'success',${a.ticketId})`
      );
  } else if (action.kind === "approve_result") {
    const [item] = await selectRows(
      tx,
      sql`SELECT id,ticketId,itemNumber,maintenancePath,status FROM ticket_items WHERE id=${a.ticketItemId} AND ticketId=${a.ticketId} FOR UPDATE`
    );
    const [count] = await selectRows(
      tx,
      sql`SELECT COUNT(*) AS total FROM ticket_items WHERE ticketId=${a.ticketId}`
    );
    if (!item || Number(count.total) !== 1)
      throw new TeamTicketError(
        "CONFLICT",
        "تنفيذ الفريق يتطلب البلاغ الفرعي وبنده الأصلي الوحيد"
      );
    if (!["ok", "fixed"].includes(a.outcome ?? ""))
      throw new TeamTicketError("CONFLICT", "لا توجد نتيجة إصلاح لاعتمادها");
    const path =
      item.maintenancePath === "C" ? "C" : state.needs.length ? "B" : "A";
    const result = state.actions
      .filter(x => ["ok", "fixed"].includes(x.kind))
      .at(-1)!;
    const materials = state.needs.map(n => ({
      name: n.name,
      unit: n.unit,
      used: n.used,
      requested: n.requested,
      ...(state.deliveries.some(d => d.needId === n.id && d.replacementPlanId != null) ? { actualDeliveries: state.deliveries.filter(d => d.needId === n.id).map(d => ({ deliveryId: d.deliveryId, itemName: d.replacementName ?? n.name, quantity: d.quantity, unit: d.physicalUnit ?? n.unit, used: d.used, returned: d.returned })) } : {}),
    }));
    if (path === "C") {
      const [job] = await selectRows(
        tx,
        sql`SELECT id,status FROM external_maintenance_jobs WHERE ticketItemId=${a.ticketItemId} AND ticketId=${a.ticketId} FOR UPDATE`
      );
      if (
        !job ||
        !["delivered_for_reinstall", "reinstall_in_progress"].includes(
          job.status
        )
      )
        throw new TeamTicketError(
          "CONFLICT",
          "الصيانة الخارجية لم تُسلّم لإعادة التركيب"
        );
      await tx.execute(
        sql`UPDATE external_maintenance_jobs SET status='ready_for_closure' WHERE id=${Number(job.id)}`
      );
    }
    // The responsible manager approves the result/path. Actual closure remains the existing ticket workflow.
    await tx.execute(
      sql`UPDATE ticket_items SET status='ready_for_closure',maintenancePath=${path},approvedById=${actor.id},approvedAt=CURRENT_TIMESTAMP,repairNotes=${result.note},materialsUsed=${JSON.stringify(materials)} WHERE id=${a.ticketItemId} AND ticketId=${a.ticketId}`
    );
    await tx.execute(
      sql`UPDATE tickets SET status='ready_for_closure',maintenancePath=${path},approvedById=${actor.id},repairNotes=${result.note},materialsUsed=${JSON.stringify(materials)} WHERE id=${a.ticketId}`
    );
    await tx.execute(
      sql`INSERT INTO ticket_status_history (ticketId,toStatus,changedById,notes) VALUES (${a.ticketId},'ready_for_closure',${actor.id},${`اعتماد تنفيذ الفريق: ${action.note}`})`
    );
    const [ticket] = await selectRows(
      tx,
      sql`SELECT supervisorId FROM tickets WHERE id=${a.ticketId}`
    );
    if (ticket?.supervisorId && Number(ticket.supervisorId) !== actor.id)
      await tx.execute(
        sql`INSERT INTO notifications (userId,title,message,type,relatedTicketId) VALUES (${Number(ticket.supervisorId)},'بلاغ جاهز للإغلاق',${`${a.ticketNumber}: تم اعتماد تنفيذ فريق الصيانة`},'ticket_updated',${a.ticketId})`
      );
  } else if (action.kind === "approve_external") {
    if (old.stage !== "external_requested")
      throw new TeamTicketError("CONFLICT", "لا يوجد طلب صيانة خارجية");
    await tx.execute(
      sql`UPDATE ticket_items SET status='work_approved',maintenancePath='C',justification=${action.note},approvedById=${actor.id},approvedAt=CURRENT_TIMESTAMP WHERE id=${a.ticketItemId} AND ticketId=${a.ticketId}`
    );
    await tx.execute(
      sql`UPDATE tickets SET status='work_approved',maintenancePath='C',justification=${action.note},approvedById=${actor.id} WHERE id=${a.ticketId}`
    );
    await tx.execute(
      sql`INSERT INTO ticket_status_history (ticketId,toStatus,changedById,notes) VALUES (${a.ticketId},'work_approved',${actor.id},${`اعتماد المسار C للفريق: ${action.note}`})`
    );
  } else if (action.kind === "external_handover") {
    const [job] = await selectRows(
      tx,
      sql`SELECT id,status,actualRecipientId FROM external_maintenance_jobs WHERE ticketItemId=${a.ticketItemId} AND ticketId=${a.ticketId} FOR UPDATE`
    );
    if (
      !job ||
      !["waiting_technician_handover", "delivered_for_reinstall"].includes(
        job.status
      )
    )
      throw new TeamTicketError(
        "CONFLICT",
        "أكمل دورة الخروج والعودة والاستلام في الصيانة الخارجية أولًا"
      );
    // Recipient is passed by the authorized router in the operation fingerprint, not parsed from notes.
    const operation = state.operations.find(x => x.key === action.operationKey);
    const recipientId =
      operation && JSON.parse(operation.fingerprint).payload.recipientId;
    if (!Number.isSafeInteger(recipientId))
      throw new TeamTicketError("INVALID", "حدد المستلم الفعلي");
    if (job.status === "delivered_for_reinstall") {
      if (Number(job.actualRecipientId) !== recipientId)
        throw new TeamTicketError(
          "CONFLICT",
          "المستلم لا يطابق سند التسليم الفعلي"
        );
    } else {
      const { handoverExternalMaintenanceAsset } =
        await import("../../_core/db/external-maintenance");
      await handoverExternalMaintenanceAsset(
        {
          jobId: Number(job.id),
          warehouseUserId: actor.id,
          actualRecipientId: recipientId,
          notes: action.note,
        },
        tx
      );
    }
  }
  const managerAction = ["ok", "fixed", "blocked", "external"].includes(
    action.kind
  );
  const recipients = managerAction
    ? [a.responsibleManagerId]
    : action.kind === "needs_material" || action.kind === "approve_external"
      ? (
          await selectRows(
            tx,
            sql`SELECT id FROM users WHERE isActive=1 AND role='warehouse'`
          )
        ).map(x => Number(x.id))
      : action.kind === "warehouse_issue"
        ? state.deliveries
            .filter(
              d =>
                !before.deliveries.some(old => old.deliveryId === d.deliveryId)
            )
            .map(d => d.receivedById)
        : [
              "return_to_team",
              "transfer_confirmed",
              "material_resolved",
              "purchase_received",
              "external_handover",
              "approve_result",
            ].includes(action.kind)
          ? state.memberships
              .filter(
                m =>
                  m.active &&
                  state.users.some(
                    u => {
                      const ticket = state.tickets.find(
                        t => t.ticketId === a.ticketId
                      );
                      return (
                        u.id === m.userId &&
                        u.active &&
                        (u.role === "technician" ||
                          (["it_manager", "it_member"].includes(u.role) &&
                            ticket?.responsibleDepartment ===
                              "maintenance_report_department_it" &&
                            ticket.assignedToId === u.id))
                      );
                    }
                  )
              )
              .map(m => m.userId)
          : [];
  for (const id of Array.from(new Set(recipients)).filter(
    id => id !== actor.id
  ))
    await tx.execute(
      sql`INSERT INTO notifications (userId,title,message,type,eventKey,relatedTicketId) VALUES (${id},'تذاكر الصيانة — إجراء الفريق',${`${a.ticketNumber}: ${materialActionMessage(action.note)}`},'ticket_updated',${action.kind === "needs_material" ? TICKET_MATERIAL_REQUEST_EVENT : "ticket_team_action"},${a.ticketId})`
    );
}
