/** Independent ticket-team domain. No application, database, or PMV2 imports. */
export type Outcome =
  | "ok"
  | "fixed"
  | "needs_material"
  | "blocked"
  | "external";
export type Stage =
  | "action_required"
  | "waiting_material"
  | "ready_to_repair"
  | "awaiting_review"
  | "blocked"
  | "external_requested"
  | "external_in_progress"
  | "reinstall_required"
  | "closed";
export interface UserRef {
  id: number;
  name: string;
  role: string;
  active: boolean;
}
export interface WarehouseRef {
  id: number;
  name: string;
  active: boolean;
}
export interface CatalogRef {
  id: number;
  name: string;
  unit: string;
  active: boolean;
}
export interface LocationRef {
  siteId: number;
  sectionId: number;
  assetId?: number;
}
export interface TicketRef {
  ticketId: number;
  ticketItemId: number;
  ticketNumber: string;
  title: string;
  location: LocationRef;
  responsibleManagerId: number;
  closed: boolean;
  assignmentMode: "unassigned" | "name" | "team";
  assignedToId?: number | null;
  responsibleDepartment?: string | null;
}
export interface Team {
  id: number;
  name: string;
  warehouseId: number;
  active: boolean;
  createdById: number;
  updatedById: number;
}
export interface Membership {
  teamId: number;
  userId: number;
  active: boolean;
  joinedAt: string;
  leftAt: string | null;
  updatedById: number;
}
export interface Assignment {
  id: number;
  ticketId: number;
  ticketItemId: number;
  ticketNumber: string;
  title: string;
  teamId: number;
  warehouseId: number;
  responsibleManagerId: number;
  location: LocationRef;
  stage: Stage;
  revision: number;
  materialRound: number;
  assignedById: number;
  outcome?: Outcome;
}
export interface Action {
  /** Localized read-only display; never persisted in the action ledger. */
  translatedNote?: string;
  id: number;
  assignmentId: number;
  actorId: number;
  kind: string;
  note: string;
  at: string;
  revision: number;
  operationKey: string;
}
export interface MaterialNeed {
  id: number;
  assignmentId: number;
  catalogItemId: number | null;
  name: string;
  originalName: string;
  unit: string;
  requested: number;
  requestedById: number;
  warehouseId: number;
  round: number;
  /** Technician declares total usage per material; warehouse chooses return lots. */
  used: number | null;
}
export interface DeliveryLink {
  id: number;
  needId: number;
  deliveryId: number;
  deliveryNumber: string;
  lotId: number;
  inventoryTransactionId: number;
  quantity: number;
  receivedById: number;
  used: number | null;
  returned: number;
  /** Derived from approved replacement provenance; never persisted as stock. */
  originalEquivalent?: number;
  replacementName?: string;
  physicalUnit?: string;
  physicalCatalogItemId?: number;
  replacementPlanId?: number;
}
export interface SupplyLink {
  id: number;
  needId: number;
  kind: "purchase" | "transfer";
  sourceId: number;
  sourceNumber: string;
  quantity: number;
  status: "pending" | "received" | "cancelled";
  originalEquivalent?: number;
  physicalUnit?: string;
  replacementName?: string;
}
export interface ReturnLink {
  id: number;
  deliveryLinkId: number;
  sourceDeliveryId: number;
  returnId: number;
  returnNumber: string;
  quantity: number;
  actorId: number;
}
export interface Operation {
  key: string;
  fingerprint: string;
  result: unknown;
}
export interface Snapshot {
  users: UserRef[];
  warehouses: WarehouseRef[];
  catalog: CatalogRef[];
  locations: LocationRef[];
  tickets: TicketRef[];
  teams: Team[];
  memberships: Membership[];
  assignments: Assignment[];
  actions: Action[];
  needs: MaterialNeed[];
  deliveries: DeliveryLink[];
  supplies: SupplyLink[];
  returns: ReturnLink[];
  operations: Operation[];
  nextId: number;
}
export interface Command {
  assignmentId: number;
  expectedRevision: number;
  operationKey: string;
}
export interface NeedInput {
  catalogItemId?: number;
  name?: string;
  /** Compatibility input only; catalog units are authoritative server-side. */
  unit?: string;
  quantity: number;
}
export interface CompletionInput {
  note: string;
  usages: Array<{ catalogItemId: number; used: number }>;
  /** Substitution uses actual delivery units; no rounded original-unit usage. */
  physicalUsages?: Array<{ deliveryId: number; used: number }>;
  otherMaterials?: string;
}
export class TeamTicketError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "INVALID"
      | "CONFLICT"
      | "NOT_FOUND"
      | "UNAVAILABLE",
    message: string
  ) {
    super(message);
    this.name = "TeamTicketError";
  }
}
export const outcomeLabels: Record<Outcome, string> = {
  ok: "سليم",
  fixed: "تم الإصلاح",
  needs_material: "تحتاج مواد",
  blocked: "يوجد عائق",
  external: "صيانة خارجية",
};
export const stageLabels: Record<Stage, string> = {
  action_required: "مطلوب إجراء الفريق",
  waiting_material: "بانتظار المواد",
  ready_to_repair: "المواد مستلمة — أكمل الإصلاح",
  awaiting_review: "انتهى إجراء الفريق — بانتظار المسؤول",
  blocked: "عائق بانتظار المسؤول",
  external_requested: "طلب صيانة خارجية بانتظار المسؤول",
  external_in_progress: "الصيانة الخارجية جارية",
  reinstall_required: "مطلوب إعادة التركيب",
  closed: "اكتمل تنفيذ الفريق",
};
export function integer(value: number, label: string, minimum = 1): number {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new TeamTicketError(
      "INVALID",
      `${label}: يجب إدخال عدد صحيح لا يقل عن ${minimum}`
    );
  return value;
}
export function required(value: string, label: string, max = 4000): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new TeamTicketError("INVALID", `${label} مطلوب وبحد أقصى ${max} حرف`);
  return value.trim();
}
export function issued(state: Snapshot, needId: number): number {
  return Math.round(state.deliveries
    .filter(d => d.needId === needId)
    .reduce((n, d) => n + (d.originalEquivalent ?? d.quantity), 0) * 1000) / 1000;
}
export function deliveryOriginalEquivalent(link: DeliveryLink, physical: number): number {
  const value = physical * (link.originalEquivalent ?? link.quantity) / link.quantity;
  const rounded = Math.round(value * 1000) / 1000;
  if (!Number.isFinite(value) || Math.abs(value - rounded) > 0.0000001)
    throw new TeamTicketError("INVALID", "كمية البديل الجزئية لا تمثل كمية دقيقة من الاحتياج الأصلي");
  return rounded;
}
export function remainingReturn(state: Snapshot, needId: number): number {
  const need = state.needs.find(n => n.id === needId);
  const links = state.deliveries.filter(d => d.needId === needId);
  if (need && links.some(d => d.replacementPlanId != null) && links.length > 0 && links.every(d => d.used !== null))
    return links.reduce((sum, d) => sum + Math.max(0, d.quantity - d.used! - d.returned), 0);
  if (!need || need.used === null) return 0;
  return Math.round((
    issued(state, needId) -
    need.used -
    links.reduce((sum, d) => sum + deliveryOriginalEquivalent(d, d.returned), 0)
  ) * 1000) / 1000;
}
export function isRequiredNow(stage: Stage): boolean {
  return ["action_required", "ready_to_repair", "reinstall_required"].includes(
    stage
  );
}
