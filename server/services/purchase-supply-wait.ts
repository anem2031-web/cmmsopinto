import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { isRoutedPurchaseItem } from "../../shared/purchase-item-review";
import { getDelegateItemActionMode } from "../routers/purchase/actionable";
import { readScopeChunks } from "../_core/authz/read-batch";
import { SUPPLY_WAIT_EDIT_MS, supplyWaitAdmin, supplyWaitDelegate, supplyWaitReader, supplyWaitListInput, supplyWaitSaveInput,
  type SupplyWaitActor, type SupplyWaitEntry, type SupplyWaitReference } from "../../shared/purchase-supply-wait";

export type SupplyWaitPorts = {
  database: () => Promise<any>;
  readScope: (actor: SupplyWaitActor, orders: any[]) => Promise<{ filterItems: (order: any, items: any[]) => any[] }>;
};
const no = (message = "غير مصرح بالوصول إلى توضيح هذا الصنف") => { throw new TRPCError({ code: "FORBIDDEN", message }); };
const rows = async (db: any, statement: any): Promise<any[]> => (await db.execute(statement))[0];
const ids = (values: number[]) => sql.join(values.map(id => sql`${id}`), sql`,`);
const time = sql`DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%dT%H:%i:%s.%fZ')`;
const dateColumns = sql`DATE_FORMAT(createdAt,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt,
  DATE_FORMAT(updatedAt,'%Y-%m-%dT%H:%i:%s.%fZ') AS updatedAt`;
function missingTable(error: any) {
  const cause = error?.cause || error;
  return cause?.code === "ER_NO_SUCH_TABLE" && Number(cause?.errno) === 1146
    && String(cause?.sqlMessage || cause?.message || "").includes("purchase_item_supply_wait");
}
function expiry(note: any) { return Date.parse(note.createdAt) + SUPPLY_WAIT_EDIT_MS; }
function assigned(actor: SupplyWaitActor, item: any) { return supplyWaitDelegate(actor) && Number(item.delegateId) === actor.id; }
function reviewer(item: any, order: any) { return isRoutedPurchaseItem(item) ? Number(item.reviewedById) : Number(item.reviewedById || order.reviewedById); }
function entry(actor: SupplyWaitActor, item: any, order: any, note: any, now: number): SupplyWaitEntry | null {
  const admin = supplyWaitAdmin(actor), delegate = assigned(actor, item);
  const recipient = Number(order.requestedById) === actor.id || reviewer(item, order) === actor.id;
  if (!admin && !delegate && !recipient) return null;
  const visible = note && (admin || delegate || now >= expiry(note));
  return { itemId: Number(item.id), purchaseOrderId: Number(item.purchaseOrderId),
    canCreate: !note && (admin || delegate) && getDelegateItemActionMode(order.status, item) === "purchase",
    note: visible ? { kind: note.kind, reason: note.reason, expectedReceiptDate: note.expectedReceiptDate,
      createdById: Number(note.createdById), createdByName: note.createdByName, createdAt: note.createdAt,
      updatedById: Number(note.updatedById), updatedByName: note.updatedByName, updatedAt: note.updatedAt,
      revision: Number(note.revision), editableUntil: new Date(expiry(note)).toISOString(),
      canEdit: admin || delegate && now < expiry(note) } : null };
}

export class PurchaseSupplyWaitService {
  constructor(private ports: SupplyWaitPorts) {}
  private async actor(db: any, supplied: SupplyWaitActor, lock = false) {
    if (!supplyWaitReader(supplied)) no();
    const [live] = await rows(db, sql`SELECT id,role,isActive,name,username FROM users WHERE id=${supplied.id} ${lock ? sql`FOR UPDATE` : sql``}`);
    if (!live || live.role !== supplied.role || !supplyWaitReader(live)) no("تغير الحساب أو صلاحياته؛ أعد تسجيل الدخول");
    return live as SupplyWaitActor & { name?: string; username?: string };
  }
  private async load(db: any, actor: SupplyWaitActor, references: SupplyWaitReference[], lock = false) {
    const itemIds = Array.from(new Set(references.map(item => item.itemId)));
    const selected = await rows(db, sql`SELECT i.id,i.purchaseOrderId,i.delegateId,i.status,i.batchId,i.delegateChangeRequestedAt,
      i.reviewRole,i.reviewedById,i.reviewedAt FROM purchase_order_items i JOIN purchase_orders p ON p.id=i.purchaseOrderId
      WHERE i.id IN (${ids(itemIds)}) ${lock ? sql`FOR UPDATE` : sql``}`);
    const items = selected.filter(item => references.some(ref => ref.itemId === Number(item.id) && ref.purchaseOrderId === Number(item.purchaseOrderId)));
    if (!items.length) return [];
    const orderIds = Array.from(new Set(items.map(item => Number(item.purchaseOrderId))));
    const orders = await readScopeChunks<any>(orderIds, chunk => rows(db, sql`SELECT id,status,requestedById,reviewedById FROM purchase_orders WHERE id IN (${ids(chunk)})`));
    const parents = new Map(orders.map(order => [Number(order.id), order]));
    const scope = await this.ports.readScope(actor, orders);
    return items.flatMap(item => {
      const order = parents.get(Number(item.purchaseOrderId));
      return order && scope.filterItems(order, [item]).length ? [{ item, order }] : [];
    });
  }
  private async notes(db: any, itemIds: number[], lock = false) {
    if (!itemIds.length) return [];
    return readScopeChunks<any>(itemIds, chunk => rows(db, sql`SELECT itemId,purchaseOrderId,kind,reason,DATE_FORMAT(expectedReceiptDate,'%Y-%m-%d') AS expectedReceiptDate,createdById,createdByName,updatedById,updatedByName,revision,${dateColumns}
      FROM purchase_item_supply_wait WHERE itemId IN (${ids(chunk)}) ${lock ? sql`FOR UPDATE` : sql``}`));
  }
  async list(supplied: SupplyWaitActor, raw: unknown) {
    const input = supplyWaitListInput.parse(raw);
    const db = await this.ports.database();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
    const actor = await this.actor(db, supplied);
    if (input.viewerId !== actor.id || input.viewerRole !== actor.role) no();
    const selected = await this.load(db, actor, input.items);
    const [clock] = await rows(db, sql`SELECT ${time} AS serverNow`);
    let notes: any[];
    try { notes = await this.notes(db, selected.map(row => Number(row.item.id))); }
    catch (error) {
      if (missingTable(error)) return { available: false, viewerId: actor.id, viewerRole: actor.role, serverNow: String(clock.serverNow), items: [] as SupplyWaitEntry[] };
      throw error;
    }
    const byItem = new Map(notes.map(note => [Number(note.itemId), note]));
    const items = selected.flatMap(({ item, order }) => {
      const note = byItem.get(Number(item.id));
      if (note && Number(note.purchaseOrderId) !== Number(item.purchaseOrderId)) throw new TRPCError({ code: "CONFLICT", message: "تعذر التحقق من ارتباط التوضيح بالصنف" });
      const visible = entry(actor, item, order, note, Date.parse(clock.serverNow));
      return visible ? [visible] : [];
    });
    return { available: true, viewerId: actor.id, viewerRole: actor.role, serverNow: String(clock.serverNow), items };
  }
  async save(supplied: SupplyWaitActor, raw: unknown) {
    const input = supplyWaitSaveInput.parse(raw);
    if (!supplyWaitAdmin(supplied) && !supplyWaitDelegate(supplied)) no();
    const db = await this.ports.database();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
    return db.transaction(async (tx: any) => {
      const actor = await this.actor(tx, supplied, true);
      if (!supplyWaitAdmin(actor) && !supplyWaitDelegate(actor)) no();
      const [subject] = await this.load(tx, actor, [input], true);
      if (!subject) no();
      const { item, order } = subject;
      const [note] = await this.notes(tx, [input.itemId], true);
      const [clock] = await rows(tx, sql`SELECT ${time} AS serverNow`);
      const view = entry(actor, item, order, note, Date.parse(clock.serverNow));
      const conflict = () => { throw new TRPCError({ code: "CONFLICT", message: "تغير التوضيح أو انتهت مهلة الساعتين؛ حدّث البيانات" }); };
      const name = String(actor.name || actor.username || `#${actor.id}`).slice(0, 255);
      if (note) {
        if (Number(note.purchaseOrderId) !== input.purchaseOrderId || Number(note.revision) !== input.revision) conflict();
        if (!view?.note?.canEdit) no("انتهت مهلة تعديل توضيح انتظار التوريد أو لم يعد الصنف مسندًا إليك");
        const result = await tx.execute(sql`UPDATE purchase_item_supply_wait SET kind=${input.kind},expectedReceiptDate=${input.expectedReceiptDate},reason=${input.reason},
          updatedById=${actor.id},updatedByName=${name},updatedAt=UTC_TIMESTAMP(3),revision=revision+1
          WHERE itemId=${input.itemId} AND purchaseOrderId=${input.purchaseOrderId} AND revision=${input.revision}
          AND ${supplyWaitAdmin(actor) ? sql`1=1` : sql`createdAt>DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 HOUR)`}`);
        if (Number(result?.[0]?.affectedRows ?? result?.affectedRows) !== 1) conflict();
      } else {
        if (input.revision !== null) conflict();
        if (!view?.canCreate) no("إضافة التوضيح متاحة للصنف المسند إليك وهو بانتظار الشراء فقط");
        try {
          await tx.execute(sql`INSERT INTO purchase_item_supply_wait (itemId,purchaseOrderId,kind,expectedReceiptDate,reason,createdById,createdByName,createdAt,updatedById,updatedByName,updatedAt,revision)
            VALUES (${input.itemId},${input.purchaseOrderId},${input.kind},${input.expectedReceiptDate},${input.reason},${actor.id},${name},UTC_TIMESTAMP(3),${actor.id},${name},UTC_TIMESTAMP(3),0)`);
        } catch (error: any) { if ((error?.cause || error)?.code === "ER_DUP_ENTRY") conflict(); throw error; }
      }
      // The reason is intentionally absent from general comments/notifications/audit payloads before publication.
      await tx.execute(sql`INSERT INTO audit_logs(userId,action,entityType,entityId,newValues) VALUES (${actor.id},${note ? "supply_wait_update" : "supply_wait_create"},'purchase_order_item',${input.itemId},${JSON.stringify({ purchaseOrderId: input.purchaseOrderId, revision: note ? Number(note.revision) + 1 : 0 })})`);
      return { itemId: input.itemId, purchaseOrderId: input.purchaseOrderId };
    });
  }
}
