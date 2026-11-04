import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { APP_ROLE } from "../../shared/roles";
import { isRoutedPurchaseItem } from "../../shared/purchase-item-review";
import { hasCommittedPurchaseItemReview } from "../../shared/purchaseItemReviewWorkflow";
import { readScopeChunks } from "../_core/authz/read-batch";

type Actor={id:number;role:string;isActive?:number};
type Database={execute(query:SQL):Promise<any>};
async function rows(database:Database,query:SQL):Promise<any[]> {
  const [result]=await database.execute(query);if(!Array.isArray(result))throw Error("Invalid delegate assignment read response");return result;
}
const denied=()=>new TRPCError({code:"FORBIDDEN",message:"إسناد الصنف متاح لمسئول المناديب المسند إليه فقط"});
const conflict=()=>new TRPCError({code:"CONFLICT",message:"الصنف لم يعد متاحًا للإسناد؛ يجب أن يكون عاديًا ومعتمد المراجعة ولم يبدأ تسعيره"});
async function manager(database:Database,actor:Actor,lock=false) {
  if(actor.role!==APP_ROLE.DELEGATE_MANAGER || !Number.isSafeInteger(actor.id) || actor.id<=0 || actor.isActive!==1)throw denied();
  const [current]=await rows(database,sql`SELECT id,role,isActive,name FROM users WHERE id=${actor.id} ${lock?sql`FOR UPDATE`:sql``}`);
  if(!current||current.role!==actor.role||Number(current.isActive)!==1)throw denied();return current;
}
async function sources(database:Database,ids:number[]) {
  return readScopeChunks(ids,part=>rows(database,sql`SELECT i.*,p.status AS purchaseOrderStatus,p.reviewedById AS orderReviewedById,p.reviewedAt AS orderReviewedAt,
      p.ticketId AS sourceTicketId,p.ticketItemId AS sourceTicketItemId,t.id AS sourceTicketExists,t.maintenancePath AS sourceTicketPath,
      ti.id AS sourceTicketItemExists,ti.ticketId AS sourceItemTicketId,ti.maintenancePath AS sourceItemPath,
      EXISTS(SELECT 1 FROM external_maintenance_jobs externalJob WHERE externalJob.purchaseOrderId=p.id) AS hasExternalJob,
      EXISTS(SELECT 1 FROM supplier_return_replacement_plans replacement WHERE replacement.purchaseOrderItemId=i.id) AS isSupplierReplacement,
      EXISTS(SELECT 1 FROM delegate_pricing_bundle_items member WHERE member.purchaseOrderItemId=i.id AND member.removedAt IS NULL) AS hasPricingBundle
    FROM purchase_order_items i INNER JOIN purchase_orders p ON p.id=i.purchaseOrderId
    LEFT JOIN tickets t ON t.id=p.ticketId LEFT JOIN ticket_items ti ON ti.id=p.ticketItemId
    WHERE i.id IN (${sql.join(part.map(id=>sql`${id}`),sql`,`)})`));
}
/** One source decision, shared by the list flag and the fresh transaction. */
export function canManagerAssignOwnItem(actor:Actor,item:any):boolean {
  if(actor.role!==APP_ROLE.DELEGATE_MANAGER||actor.isActive!==1||Number(item.delegateId)!==actor.id||item.status!=="pending"
    ||["draft","revision_needed","rejected","closed"].includes(item.purchaseOrderStatus)
    ||!item.purchaseOrderStatus||item.batchId!=null||item.delegateChangeRequestedAt!=null
    ||["estimatedUnitCost","estimatedTotalCost","estimatedById","estimatedAt","actualUnitCost","actualTotalCost","purchasedAt","purchasedById"].some(field=>item[field]!=null)
    ||Number(item.hasPricingBundle)!==0||Number(item.hasExternalJob)!==0||Number(item.isSupplierReplacement)!==0) return false;
  if(isRoutedPurchaseItem(item)?!hasCommittedPurchaseItemReview(item):item.purchaseOrderStatus==="pending_review"||item.reviewRole!=null||!Number.isSafeInteger(item.orderReviewedById)||item.orderReviewedById<=0||!item.orderReviewedAt) return false;
  if(item.sourceTicketId!=null&&Number(item.sourceTicketExists)!==Number(item.sourceTicketId))return false;
  if(item.sourceTicketItemId!=null&&(item.sourceTicketId==null||Number(item.sourceTicketItemExists)!==Number(item.sourceTicketItemId)||Number(item.sourceItemTicketId)!==Number(item.sourceTicketId)))return false;
  return item.sourceTicketPath!=="C"&&item.sourceItemPath!=="C";
}
export async function managerAssignableItemIds(database:Database,actor:Actor,itemIds:number[]) {
  const ids=Array.from(new Set(itemIds));if(ids.some(id=>!Number.isSafeInteger(id)||id<=0))throw conflict();
  if(!ids.length)return new Set<number>();await manager(database,actor);
  const included=new Set(ids),result=new Set<number>();
  for(const item of await sources(database,ids)) { if(!included.has(Number(item.id)))throw Error("Invalid assignment source scope");if(canManagerAssignOwnItem(actor,item))result.add(Number(item.id)); }
  return result;
}
export async function delegateAssignmentOptions(database:Database,actor:Actor) {
  await manager(database,actor);
  return rows(database,sql`SELECT id,name,username FROM users WHERE role='delegate' AND isActive=1 ORDER BY id`);
}
/** Caller provides one transaction; no header, source link or financial state is changed. */
export async function assignOwnDelegateItem(tx:Database,actor:Actor,input:{purchaseOrderId:number;itemId:number;delegateId:number}) {
  if(![input.purchaseOrderId,input.itemId,input.delegateId].every(id=>Number.isSafeInteger(id)&&id>0))throw conflict();
  if(actor.role!==APP_ROLE.DELEGATE_MANAGER||actor.isActive!==1)throw denied();
  const [order]=await rows(tx,sql`SELECT id FROM purchase_orders WHERE id=${input.purchaseOrderId} FOR UPDATE`);
  const [lockedItem]=await rows(tx,sql`SELECT id,purchaseOrderId FROM purchase_order_items WHERE id=${input.itemId} FOR UPDATE`);
  if(!order||!lockedItem||Number(lockedItem.purchaseOrderId)!==input.purchaseOrderId)throw denied();
  const participants=await rows(tx,sql`SELECT id,role,isActive,name FROM users WHERE id IN (${sql.join(Array.from(new Set([actor.id,input.delegateId])).sort((a,b)=>a-b).map(id=>sql`${id}`),sql`,`)}) ORDER BY id FOR UPDATE`);
  const current=participants.find(user=>Number(user.id)===actor.id),target=participants.find(user=>Number(user.id)===input.delegateId);
  if(!current||current.role!==actor.role||Number(current.isActive)!==1)throw denied();
  if(!target||target.role!==APP_ROLE.DELEGATE||Number(target.isActive)!==1)throw new TRPCError({code:"BAD_REQUEST",message:"اختر مندوبًا نشطًا"});
  const [item]=await sources(tx,[input.itemId]);
  if(!item||Number(item.purchaseOrderId)!==input.purchaseOrderId||Number(item.delegateId)!==actor.id)throw denied();
  if(!canManagerAssignOwnItem({...actor,isActive:1},item))throw conflict();
  const [written]=await tx.execute(sql`UPDATE purchase_order_items SET delegateId=${input.delegateId},delegateAssignedAt=CURRENT_TIMESTAMP
    WHERE id=${input.itemId} AND purchaseOrderId=${input.purchaseOrderId} AND delegateId=${actor.id} AND status='pending'
      AND batchId IS NULL AND estimatedUnitCost IS NULL AND estimatedTotalCost IS NULL AND estimatedById IS NULL AND estimatedAt IS NULL
      AND delegateChangeRequestedAt IS NULL`);
  if(Number(written?.affectedRows)!==1)throw conflict();
  await tx.execute(sql`INSERT INTO purchase_order_item_history (purchaseOrderItemId,purchaseOrderId,eventType,previousStatus,newStatus,previousDelegateId,newDelegateId,actorUserId,actorName,note,metadata)
    VALUES (${input.itemId},${input.purchaseOrderId},'delegate_changed','pending','pending',${actor.id},${input.delegateId},${actor.id},${current.name??null},'إسناد الصنف من مسئول المناديب',${JSON.stringify({source:"delegate_manager_assignment",previousDelegateAssignedAt:item.delegateAssignedAt??null})})`);
  await tx.execute(sql`INSERT INTO audit_logs (userId,action,entityType,entityId,oldValues,newValues) VALUES (${actor.id},'delegate_manager_assign_item','purchase_order_item',${input.itemId},${JSON.stringify({delegateId:actor.id,delegateAssignedAt:item.delegateAssignedAt??null})},${JSON.stringify({delegateId:input.delegateId,purchaseOrderId:input.purchaseOrderId})})`);
  return {itemId:input.itemId,delegateId:input.delegateId,status:"pending" as const};
}
