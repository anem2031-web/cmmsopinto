import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { EXTERNAL_DELEGATE_PREPURCHASE_STATUSES } from "../../../shared/external-delegate-access";
import { readScopeChunks } from "./read-batch";
import { isDelegateRole } from "../../../shared/delegate-role";

type Actor={id:number;role:string;isActive?:number};
export type ExternalDelegateJobScope={id:number;ticketId:number;ticketItemId:number|null;delegateId:number|null;status:string;
  purchaseOrderId:number|null;gateExitApprovedAt:unknown;assetBeforePhotoUrl:string|null;
  ticketExistsId:number|null;ticketMaintenancePath:string|null;ticketStatus:string|null;
  itemTicketId:number|null;itemMaintenancePath:string|null;itemStatus:string|null};
const denied=()=>new TRPCError({code:"FORBIDDEN",message:"المهمة الخارجية غير متاحة لهذا المندوب"});
const validId=(id:unknown):id is number=>Number.isSafeInteger(id)&&Number(id)>0;
export const externalDelegateScopePort={
  async jobs(ids:number[]):Promise<ExternalDelegateJobScope[]> {
    const {getDb}=await import("../db"); const connection=await getDb();
    if(!connection) throw new TRPCError({code:"INTERNAL_SERVER_ERROR",message:"تعذر التحقق من مهمة الصيانة الخارجية"});
    return readScopeChunks<ExternalDelegateJobScope>(ids,async part=>{
      const [rows]:any=await connection.execute(sql`SELECT job.id,job.ticketId,job.ticketItemId,job.delegateId,job.status,
        job.purchaseOrderId,job.gateExitApprovedAt,job.assetBeforePhotoUrl,
        ticket.id AS ticketExistsId,ticket.maintenancePath AS ticketMaintenancePath,ticket.status AS ticketStatus,
        item.ticketId AS itemTicketId,item.maintenancePath AS itemMaintenancePath,item.status AS itemStatus
        FROM external_maintenance_jobs job LEFT JOIN tickets ticket ON ticket.id=job.ticketId
        LEFT JOIN ticket_items item ON item.id=job.ticketItemId
        WHERE job.id IN (${sql.join(part.map(id=>sql`${id}`),sql`,`)})`);
      if(!Array.isArray(rows)) throw Error("Invalid external delegate scope response");
      return rows;
    });
  },
};
export function isPrepurchaseExternalJob(job:Pick<ExternalDelegateJobScope,"purchaseOrderId"|"gateExitApprovedAt"|"status">):boolean {
  return job.purchaseOrderId==null && !job.gateExitApprovedAt
    && (EXTERNAL_DELEGATE_PREPURCHASE_STATUSES as readonly string[]).includes(job.status);
}
export function isExternalDelegateJob(user:Actor,job:ExternalDelegateJobScope):boolean {
  return isDelegateRole(user.role) && user.isActive===1 && validId(user.id) && validId(job.id) && validId(job.ticketId)
    && Number(job.delegateId)===user.id && Number(job.ticketExistsId)===Number(job.ticketId) && isPrepurchaseExternalJob(job)
    && (job.ticketItemId==null ? job.ticketMaintenancePath==="C" && job.ticketStatus==="work_approved"
      : validId(job.ticketItemId) && Number(job.itemTicketId)===Number(job.ticketId) && job.itemMaintenancePath==="C" && job.itemStatus==="work_approved");
}
export async function loadExternalDelegateScopes(ids:number[],port=externalDelegateScopePort) {
  const unique=Array.from(new Set(ids)); if(unique.some(id=>!validId(id))) throw denied();
  const rows=unique.length?await port.jobs(unique):[];
  const included=new Set(unique),byId=new Map<number,ExternalDelegateJobScope>();
  for(const row of rows) { if(!included.has(Number(row.id))||byId.has(Number(row.id))) throw Error("Invalid external delegate parent scope"); byId.set(Number(row.id),row); }
  return byId;
}
export async function requireExternalDelegateJobs(user:Actor,ids:number[],port=externalDelegateScopePort) {
  if(!isDelegateRole(user.role)||user.isActive!==1||!validId(user.id)) throw denied();
  const rows=await loadExternalDelegateScopes(ids,port);
  if(ids.some(id=>!rows.has(id)||!isExternalDelegateJob(user,rows.get(id)!))) throw denied();
  return rows;
}
