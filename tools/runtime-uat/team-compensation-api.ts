/** Callable UAT steps only. No execution, credentials, SQL or environment loading
 * at module import. The driver must verify the running server is COPYCMMS2. */
import { randomUUID } from "node:crypto";
import type { AcceptanceRpc } from "./operational-compensation-api";
import { ticketExecutionSession } from "../../shared/maintenance-team-tickets/execution-session";
import { issued } from "../../shared/maintenance-team-tickets/model";

export type TeamSourceRefs = {
  teamId: number; managerId: number; siteId: number; sectionId: number; categoryId: number;
  assetId?: number; photoUrl: string; catalogItemId: number; itemName: string; unit: string; quantity: number;
};
type Checkpoint = (stage: string, ids: Record<string, unknown>) => Promise<void>;
const assertId = (value: unknown, label: string) => {
  if (!Number.isSafeInteger(Number(value)) || Number(value) <= 0) throw Error(`UAT ${label} missing`);
  return Number(value);
};
export async function createTeamCompensationSource(rpc: AcceptanceRpc, refs: TeamSourceRefs,
  assertTrialEnvironment: () => Promise<void>, checkpoint: Checkpoint = async () => {}) {
  await assertTrialEnvironment();
  const me = await rpc.query("auth.me");
  if (!["owner", "admin"].includes(me?.role)) throw Error("Use the real authenticated owner/admin trial session");
  const candidates = await rpc.query("ticketTeamAssignments.candidates");
  if (!candidates.some((team: any) => Number(team.id) === refs.teamId)) throw Error("UAT team is not active/assignable");
  const created = await rpc.mutate("tickets.create", { title: `UAT supplier compensation team ${new Date().toISOString()}`,
    description: "بيانات تجريبية لاختبار تعويض مرتجع المورد واستكمال احتياج فريق الصيانة",
    priority: "low", siteId: refs.siteId, sectionId: refs.sectionId, categoryId: refs.categoryId,
    assetId: refs.assetId, beforePhotoUrl: refs.photoUrl });
  const parentTicketId = assertId(created.id, "parent ticket");
  await checkpoint("team-parent", { parentTicketId, ticketNumber: created.ticketNumber });
  await rpc.mutate("tickets.triageMulti", { id: parentTicketId, ticketType: "internal", assignments: [{
    department: "maintenance_report_department_general", responsibleManagerId: refs.managerId, organizationalTitle: "اختبار التعويض — فريق الصيانة",
  }] });
  const plan = await rpc.query("tickets.departmentPlan", { ticketId: parentTicketId });
  const department = plan.departments.find((row: any) => row.department === "maintenance_report_department_general");
  const task = await rpc.mutate("tickets.createDepartmentTask", { ticketId: parentTicketId,
    ticketDepartmentId: assertId(department?.id, "department"), title: "احتياج تجريبي لتعويض المرتجع", description: "اختبار مصدر مواد الفريق مع إبقاء وصف الاحتياج الأصلي" });
  const assigned = await rpc.mutate("ticketTeamAssignments.assign", { ticketId: parentTicketId, taskId: assertId(task.taskId, "task"), teamId: refs.teamId });
  const assignmentId = assertId(assigned.assignmentId, "assignment"), ticketId = assertId(assigned.ticketId, "execution ticket");
  await checkpoint("team-assigned", { parentTicketId, assignmentId, ticketId, ticketNumber: assigned.ticketNumber });
  return continueTeamCompensationSource(rpc, { parentTicketId, assignmentId, ticketId }, refs, assertTrialEnvironment, checkpoint);
}

/** Resume only the explicitly checkpointed trial assignment. Each existing
 * need/source is read through its normal authenticated API before reuse. */
export async function continueTeamCompensationSource(rpc: AcceptanceRpc,
  source: { parentTicketId: number; assignmentId: number; ticketId: number }, refs: TeamSourceRefs,
  assertTrialEnvironment: () => Promise<void>, checkpoint: Checkpoint = async () => {}) {
  await assertTrialEnvironment();
  const me = await rpc.query("auth.me");
  if (!["owner", "admin"].includes(me?.role)) throw Error("Use the real authenticated owner/admin trial session");
  const parentTicketId = assertId(source.parentTicketId, "parent ticket"), assignmentId = assertId(source.assignmentId, "assignment"), ticketId = assertId(source.ticketId, "execution ticket");
  const details = () => rpc.query("ticketTeamExecution.details", { assignmentId, language: "ar" });
  const command = async () => ({ assignmentId, expectedRevision: (await details()).assignments[0].revision, operationKey: `uat-team:${randomUUID()}` });
  let state = await details(), a = state.assignments[0];
  if (!a || Number(a.id) !== assignmentId || Number(a.ticketId) !== ticketId || Number(a.teamId) !== refs.teamId)
    throw Error("Checkpoint assignment does not match the expected trial ticket/team");
  const parent = await rpc.query("tickets.getById", { id: ticketId });
  if (Number(parent.parentTicketId) !== parentTicketId) throw Error("Checkpoint source parent mismatch");
  let need = state.needs.find((row: any) => row.assignmentId === assignmentId && row.round === a.materialRound && row.catalogItemId === refs.catalogItemId);
  if (!need) {
    if (!["action_required", "waiting_material"].includes(a.stage)) throw Error(`Cannot add a source need at stage ${a.stage}`);
    if (a.stage === "action_required") {
      const session = ticketExecutionSession(state, a);
      if (!session.working) {
        if (session.openVisit) await rpc.mutate("ticketTeamExecution.resumeItem", { ...await command(), operationKey: `uat-team-resume:${assignmentId}` });
        else await rpc.mutate("ticketTeamExecution.startItem", { ...await command(), operationKey: `uat-team-start:${assignmentId}` });
      }
      await rpc.mutate("ticketTeamExecution.request", { ...await command(), operationKey: `uat-team-need:${assignmentId}:${a.materialRound}:${refs.catalogItemId}`,
        needs: [{ catalogItemId: refs.catalogItemId, unit: refs.unit, quantity: refs.quantity }], confirmedCatalogIds: [] });
    } else {
      await rpc.mutate("ticketTeamExecution.registerMaterialNeed", { ...await command(), operationKey: `uat-team-need:${assignmentId}:${a.materialRound}:${refs.catalogItemId}`,
        need: { catalogItemId: refs.catalogItemId, unit: refs.unit, quantity: refs.quantity }, confirmReceipt: false });
    }
    state = await details(); a = state.assignments[0];
    need = state.needs.find((row: any) => row.assignmentId === assignmentId && row.round === a.materialRound && row.catalogItemId === refs.catalogItemId);
  }
  const needId = assertId(need?.id, "material need");
  if (Number(need.requested) !== refs.quantity || need.unit !== refs.unit) throw Error("Checkpoint material need quantity/unit changed");
  await checkpoint("team-need", { parentTicketId, ticketId, ticketItemId: a.ticketItemId, assignmentId, needId });
  const existingSources = state.supplies.filter((row: any) => row.needId === needId && row.kind === "purchase");
  if (existingSources.length) {
    if (existingSources.length !== 1) throw Error("Multiple source purchase links require explicit trial review");
    const existing = existingSources[0];
    const orders = await rpc.query("purchaseOrders.list", { requestedById: me.id });
    const order = orders.find((row: any) => row.poNumber === existing.sourceNumber);
    const purchaseOrderId = assertId(order?.id, "existing source PO");
    const full = await rpc.query("purchaseOrders.getById", { id: purchaseOrderId });
    const item = full.items?.find((row: any) => Number(row.id) === Number(existing.sourceId));
    if (!item || Number(full.ticketId) !== ticketId || Number(full.ticketItemId) !== Number(a.ticketItemId)
      || Number(item.catalogItemId) !== refs.catalogItemId || item.unit !== refs.unit) throw Error("Existing source PO does not match this trial need");
    const result = { parentTicketId, ticketId, ticketItemId: a.ticketItemId, assignmentId, needId,
      purchaseOrderId, purchaseOrderItemId: Number(existing.sourceId), poNumber: full.poNumber, sourceQuantity: existing.quantity, sourceUnit: refs.unit, existing: true };
    await checkpoint("team-source-po", result);
    return result;
  }
  const handoff = await rpc.mutate("ticketTeamExecution.prepareSupply", { assignmentId, needId, kind: "purchase" });
  const order = await rpc.mutate("purchaseOrders.create", { ticketId, ticketItemId: handoff.ticketItemId,
    siteId: handoff.location.siteId, sectionId: handoff.location.sectionId, assetId: handoff.location.assetId,
    categoryId: refs.categoryId, notes: "UAT COPYCMMS2 — طلب مصدر لاختبار تعويض مرتجع الفريق",
    ticketTeam: { assignmentId, needId, expectedRevision: handoff.revision, operationKey: `uat-team-source-po:${assignmentId}:${needId}`, warehouseExtraQuantity: 0 },
    items: [{ catalogItemId: handoff.catalogItemId, itemName: handoff.name, quantity: handoff.quantity, unit: handoff.unit,
      deliveryLeadDays: 0, photoUrl: refs.photoUrl, siteId: handoff.location.siteId, sectionId: handoff.location.sectionId,
      assetId: handoff.location.assetId, categoryId: refs.categoryId }] });
  const result = { parentTicketId, ticketId, ticketItemId: handoff.ticketItemId, assignmentId, needId,
    purchaseOrderId: assertId(order.id, "source PO"), poNumber: order.poNumber, sourceQuantity: handoff.quantity, sourceUnit: handoff.unit };
  await checkpoint("team-source-po", result);
  return result;
}

export interface TeamCompletionResume {
  physicalUsages?: Array<{ deliveryId: number; used: number }>;
  transferOperationKey?: string;
  receiveOperationKey?: string;
  resumeOperationKey?: string;
  outcomeOperationKey?: string;
  returnOperationKey?: string;
}
export async function completeTeamCompensationNeed(rpc: AcceptanceRpc, source: { assignmentId: number; needId: number },
  assertTrialEnvironment: () => Promise<void>, returnOneActualUnit = true,
  options: { resume?: TeamCompletionResume; checkpoint?: Checkpoint } = {}) {
  await assertTrialEnvironment();
  const me = await rpc.query("auth.me");
  if (!["owner", "admin"].includes(me?.role)) throw Error("Use the real authenticated owner/admin trial session");
  const assignmentId = assertId(source.assignmentId, "assignment"), needId = assertId(source.needId, "material need");
  const progress: TeamCompletionResume = { physicalUsages: options.resume?.physicalUsages,
    transferOperationKey: options.resume?.transferOperationKey ?? `uat-team-transfer:${assignmentId}:${needId}`,
    receiveOperationKey: options.resume?.receiveOperationKey ?? `uat-team-receive:${assignmentId}:${needId}`,
    resumeOperationKey: options.resume?.resumeOperationKey ?? `uat-team-complete-resume:${assignmentId}:${needId}`,
    outcomeOperationKey: options.resume?.outcomeOperationKey ?? `uat-team-fixed:${assignmentId}:${needId}`,
    returnOperationKey: options.resume?.returnOperationKey ?? `uat-team-return:${assignmentId}:${needId}` };
  const checkpoint = async (stage: string, metadata: Record<string, unknown> = {}) => options.checkpoint?.(stage, { assignmentId, needId, ...progress, ...metadata });
  const details = () => rpc.query("ticketTeamExecution.details", { assignmentId, language: "ar" });
  const command = async (operationKey: string) => ({ assignmentId, expectedRevision: (await details()).assignments[0].revision, operationKey });
  let state = await details();
  let a = state.assignments[0], need = state.needs.find((row: any) => row.id === needId && row.assignmentId === assignmentId && row.round === a.materialRound);
  if (!need || state.needs.filter((row: any) => row.assignmentId === assignmentId && row.round === a.materialRound).length !== 1)
    throw Error("UAT completion must match its single current material need");
  if (issued(state, needId) < need.requested) {
    if (a.stage !== "waiting_material") throw Error(`Incomplete UAT need is not waiting for materials (${a.stage})`);
    const balanceRows = await rpc.query("ticketTeamExecution.balances", { assignmentId });
    const balance = balanceRows.find((row: any) => row.needId === needId);
    if (!balance) throw Error("UAT current team stock balance is unavailable");
    if (Number(balance.branch) < Number(need.requested) - issued(state, needId)) {
      const handoff = await rpc.mutate("ticketTeamExecution.prepareSupply", { assignmentId, needId, kind: "transfer" });
      if (!handoff.replacementFulfillment) throw Error("UAT compensation source has no verified received replacement");
      await checkpoint("team-transfer-intent");
      const transferred = await rpc.mutate("ticketTeamExecution.provide", { assignmentId, needId, kind: "transfer", expectedRevision: handoff.revision, operationKey: progress.transferOperationKey });
      await checkpoint("team-transferred", { transferred });
    }
    // A committed transfer whose HTTP response was lost is detected by the
    // current branch balance on the next call; it is never transferred again.
    await checkpoint("team-receive-intent");
    const received = await rpc.mutate("ticketTeamExecution.receive", { ...await command(progress.receiveOperationKey!), needId });
    await checkpoint("team-received", { received });
    state = await details(); a = state.assignments[0];
  }
  let links = state.deliveries.filter((row: any) => row.needId === needId);
  if (!links.some((row: any) => row.replacementPlanId != null)) throw Error("Actual approved alternative delivery absent");
  if (issued(state, needId) !== need.requested) throw Error("UAT actual delivery does not fully cover the retained original need");
  if (links.some((row: any) => row.used == null)) {
    if (a.stage !== "ready_to_repair") throw Error(`UAT actual usage cannot be declared at stage ${a.stage}`);
    const session = ticketExecutionSession(state, a);
    if (session.conflict) throw Error("UAT has conflicting open visits");
    if (!session.working || !session.openVisit?.memberIds.includes(me.id)) {
      await rpc.mutate("ticketTeamExecution.resumeItem", await command(progress.resumeOperationKey!));
      await checkpoint("team-resumed");
      state = await details(); a = state.assignments[0];
    }
    const fresh = ticketExecutionSession(state, a);
    if (!fresh.working || !fresh.openVisit?.memberIds.includes(me.id)) throw Error("UAT owner is not currently executing this visit");
    const returnDelivery = returnOneActualUnit ? links.find((row: any) => row.replacementPlanId != null && row.quantity - row.returned >= 1) : null;
    progress.physicalUsages ??= links.map((row: any) => ({ deliveryId: row.deliveryId, used: row.quantity - row.returned - (returnDelivery?.deliveryId === row.deliveryId ? 1 : 0) }));
    if (progress.physicalUsages.length !== links.length || new Set(progress.physicalUsages.map(row => row.deliveryId)).size !== links.length
      || progress.physicalUsages.some(row => !links.some((link: any) => link.deliveryId === row.deliveryId && Number.isSafeInteger(row.used) && row.used >= 0 && row.used <= link.quantity - link.returned)))
      throw Error("UAT persisted physical usage no longer matches the actual deliveries");
    await checkpoint("team-physical-intent");
    const outcome = await rpc.mutate("ticketTeamExecution.outcome", { ...await command(progress.outcomeOperationKey!), outcome: "fixed", note: "UAT COPYCMMS2 — تم اختبار استخدام البديل والكمية الفعلية والمرتجع",
      usages: [], physicalUsages: progress.physicalUsages });
    await checkpoint("team-fixed", { outcome });
    state = await details(); links = state.deliveries.filter((row: any) => row.needId === needId);
  } else progress.physicalUsages = links.map((row: any) => ({ deliveryId: row.deliveryId, used: row.used }));
  const pendingByLot = new Map<number, number>();
  for (const row of links) {
    if (!Number.isSafeInteger(row.used) || row.used < 0 || row.used + row.returned > row.quantity) throw Error("Invalid persisted UAT physical usage/return balance");
    const pending = row.quantity - row.used - row.returned;
    if (pending > 0) pendingByLot.set(row.lotId, (pendingByLot.get(row.lotId) ?? 0) + pending);
  }
  if (pendingByLot.size) {
    const allocations = Array.from(pendingByLot, ([lotId, quantity]) => ({ lotId, quantity }));
    await checkpoint("team-return-intent", { allocations });
    const returned = await rpc.mutate("ticketTeamExecution.returnMaterial", { ...await command(progress.returnOperationKey!), needId, allocations });
    await checkpoint("team-returned", { returned });
  }
  state = await details();
  const result = { stage: state.assignments[0].stage, originalNeed: state.needs.find((row: any) => row.id === needId),
    actualDeliveries: state.deliveries.filter((row: any) => row.needId === needId), actualReturns: state.returns, resume: progress };
  await checkpoint("team-completed", result);
  return result;
}
